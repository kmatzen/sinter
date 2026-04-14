import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../middleware/requireAuth';
import db from '../db';
import type { User } from '../auth';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const STORAGE_LIMIT_MB = parseInt(process.env.STORAGE_LIMIT_MB || '0');

const router = Router();

// Credit packs available for purchase
const CREDIT_PACKS = [
  { id: 'pack_100', credits: 100, label: '100 credits', priceEnvKey: 'STRIPE_PRICE_100' },
  { id: 'pack_500', credits: 500, label: '500 credits', priceEnvKey: 'STRIPE_PRICE_500' },
  { id: 'pack_1000', credits: 1000, label: '1000 credits', priceEnvKey: 'STRIPE_PRICE_1000' },
];

const FREE_CREDITS = 0;
const CREDITS_PER_100MB = 1; // 1 credit per 100MB per month for storage

// Get billing status
router.get('/status', requireAuth, (req, res) => {
  const user = req.user as User;
  const dbUser = db.prepare('SELECT credits, credits_expire_at, storage_allocation_mb, storage_expires_at, grace_period_start FROM users WHERE id = ?').get((user as any).id) as any;
  // Zero out expired credits
  let credits = dbUser?.credits ?? FREE_CREDITS;
  const creditsExpireAt = dbUser?.credits_expire_at || null;
  if (creditsExpireAt && new Date(creditsExpireAt) < new Date()) {
    credits = 0;
    db.prepare('UPDATE users SET credits = 0, credits_expire_at = NULL WHERE id = ?').run((user as any).id);
  }
  const gracePeriodStart = dbUser?.grace_period_start || null;

  const userId = (user as any).id;
  const projectCount = (db.prepare('SELECT COUNT(*) as c FROM projects WHERE user_id = ?').get(userId) as any)?.c || 0;
  const totalSizeBytes = getUserStorageBytes(userId);

  res.json({
    credits,
    creditsExpireAt: credits > 0 ? creditsExpireAt : null,
    packs: CREDIT_PACKS.map((p) => ({
      id: p.id,
      credits: p.credits,
      label: p.label,
      available: !!process.env[p.priceEnvKey],
    })).filter((p) => p.available),
    storage: {
      projectCount,
      usedMB: Math.round(totalSizeBytes / 1024 / 1024 * 10) / 10,
      allocationMB: dbUser?.storage_allocation_mb || 0,
      expiresAt: dbUser?.storage_expires_at || null,
      gracePeriodStart: gracePeriodStart,
      gracePeriodDays: 30,
    },
  });
});

// Allocate credits toward storage
router.post('/allocate-storage', requireAuth, (req, res) => {
  const user = req.user as any;
  const { credits } = req.body;
  if (!credits || typeof credits !== 'number' || credits < 1) {
    return res.status(400).json({ error: 'Specify credits to allocate (minimum 1)' });
  }
  const result = allocateStorage(user.id, Math.floor(credits));
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ allocationMB: result.allocationMB, expiresAt: result.expiresAt });
});

// Purchase credits
router.post('/checkout', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(500).json({ error: 'Payments not configured' });

  const user = req.user as any;
  const { packId } = req.body;
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) return res.status(400).json({ error: 'Invalid pack' });

  const priceId = process.env[pack.priceEnvKey];
  if (!priceId) return res.status(400).json({ error: 'Pack not available' });

  const isDev = process.env.NODE_ENV !== 'production';
  const baseUrl = isDev ? 'http://localhost:5173' : (process.env.BASE_URL || 'http://localhost:3000');

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/app?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/app?billing=cancel`,
      metadata: { userId: user.id, packId: pack.id, credits: String(pack.credits) },
    });

    res.json({ url: session.url });
  } catch (err: any) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Verify a checkout session and add credits (called from frontend on redirect)
router.post('/verify', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(500).json({ error: 'Not configured' });

  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    console.log('[billing] verify session:', sessionId, 'status:', session.payment_status, 'metadata:', session.metadata);
    if (session.payment_status !== 'paid') {
      return res.json({ credited: false, reason: 'not paid', status: session.payment_status });
    }

    const userId = session.metadata?.userId;
    const credits = parseInt(session.metadata?.credits || '0');
    const user = req.user as any;

    if (userId !== user.id) return res.status(403).json({ error: 'Session mismatch' });

    // Check if already credited (idempotent)
    const key = `checkout_${sessionId}`;
    const existing = db.prepare('SELECT 1 FROM used_sessions WHERE key = ?').get(key);
    if (existing) return res.json({ credited: false, already: true });

    console.log('[billing] crediting', credits, 'credits to user', userId);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET credits = credits + ?, credits_expire_at = ?, grace_period_start = NULL WHERE id = ?').run(credits, expiresAt, userId);

    // Mark as used
    db.prepare('INSERT OR IGNORE INTO used_sessions (key) VALUES (?)').run(key);

    res.json({ credited: true, credits });
  } catch (err: any) {
    console.error('Verify error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Stripe webhook
router.post('/webhook', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(403).json({ error: 'Not configured' });

  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(403).json({ error: 'Not configured' });

  try {
    const event = stripe.webhooks.constructEvent(
      JSON.stringify(req.body),
      sig,
      webhookSecret,
    );

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any;
      const userId = session.metadata?.userId;
      const credits = parseInt(session.metadata?.credits || '0');
      if (userId && credits > 0) {
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        db.prepare('UPDATE users SET credits = credits + ?, credits_expire_at = ?, grace_period_start = NULL WHERE id = ?').run(credits, expiresAt, userId);
        console.log(`Added ${credits} credits to user ${userId}, expires ${expiresAt}`);
      }
    }

    res.json({ received: true });
  } catch (err: any) {
    res.status(400).send(`Webhook error: ${err.message}`);
  }
});

// Track usage — deduct 1 credit per request
export function trackUsage(userId: string): { allowed: boolean; remaining: number } {
  const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as any;
  if (!user) return { allowed: false, remaining: 0 };

  const credits = user.credits ?? 0;
  if (credits <= 0) return { allowed: false, remaining: 0 };

  db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ?').run(userId);
  return { allowed: true, remaining: credits - 1 };
}

import Stripe from 'stripe';
import { allocateStorage, getUserStorageBytes } from '../storageBilling';

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY not set');
    return null;
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

export default router;
