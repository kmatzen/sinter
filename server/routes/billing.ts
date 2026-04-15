import { Router } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../middleware/requireAuth';
import { rateLimit } from '../middleware/rateLimit';
import db from '../db';
import type { User } from '../auth';
import { lemonSqueezySetup, createCheckout } from '@lemonsqueezy/lemonsqueezy.js';
import { allocateStorage, getUserStorageBytes } from '../storageBilling';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const STORAGE_LIMIT_MB = parseInt(process.env.STORAGE_LIMIT_MB || '0');
const isDev = process.env.NODE_ENV !== 'production';

const router = Router();

// Credit packs — variant IDs come from Lemon Squeezy dashboard
const CREDIT_PACKS = [
  { id: 'pack_100', credits: 100, label: '100 credits', variantEnvKey: 'LEMONSQUEEZY_VARIANT_100' },
  { id: 'pack_500', credits: 500, label: '500 credits', variantEnvKey: 'LEMONSQUEEZY_VARIANT_500' },
  { id: 'pack_1000', credits: 1000, label: '1000 credits', variantEnvKey: 'LEMONSQUEEZY_VARIANT_1000' },
];

// Map variant IDs to credit amounts for webhook processing
function variantToCredits(variantId: number): number {
  for (const pack of CREDIT_PACKS) {
    const envVal = process.env[pack.variantEnvKey];
    if (envVal && parseInt(envVal) === variantId) return pack.credits;
  }
  return 0;
}

const FREE_CREDITS = 0;

// Initialize Lemon Squeezy SDK
function initLemonSqueezy(): boolean {
  const apiKey = process.env.LEMONSQUEEZY_API_KEY;
  if (!apiKey) return false;
  lemonSqueezySetup({ apiKey });
  return true;
}

// Get billing status
router.get('/status', requireAuth, (req, res) => {
  const user = req.user as User;
  const dbUser = db.prepare('SELECT credits, credits_expire_at, storage_allocation_mb, storage_expires_at, grace_period_start FROM users WHERE id = ?').get((user as any).id) as any;
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
      available: !!process.env[p.variantEnvKey],
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

// Purchase credits via Lemon Squeezy checkout
const checkoutLimit = rateLimit({ windowMs: 60_000, max: 5, message: 'Too many checkout attempts.' });
router.post('/checkout', requireAuth, checkoutLimit, async (req, res) => {
  if (!initLemonSqueezy()) return res.status(500).json({ error: 'Payments not configured' });

  const storeId = process.env.LEMONSQUEEZY_STORE_ID;
  if (!storeId) return res.status(500).json({ error: 'Payments not configured' });

  const user = req.user as any;
  const { packId } = req.body;
  const pack = CREDIT_PACKS.find((p) => p.id === packId);
  if (!pack) return res.status(400).json({ error: 'Invalid pack' });

  const variantId = process.env[pack.variantEnvKey];
  if (!variantId) return res.status(400).json({ error: 'Pack not available' });

  const baseUrl = isDev ? 'http://localhost:5173' : (process.env.BASE_URL || 'http://localhost:3000');

  try {
    const checkout = await createCheckout(storeId, variantId, {
      productOptions: {
        redirectUrl: `${baseUrl}/app?billing=success`,
        receiptButtonText: 'Back to Sinter',
        receiptLinkUrl: `${baseUrl}/app`,
      },
      checkoutData: {
        email: user.email,
        custom: {
          user_id: user.id,
          pack_id: pack.id,
          credits: String(pack.credits),
        },
      },
    });

    const checkoutUrl = checkout.data?.data.attributes.url;
    if (!checkoutUrl) throw new Error('No checkout URL returned');

    res.json({ url: checkoutUrl });
  } catch (err: any) {
    console.error('Lemon Squeezy checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Lemon Squeezy webhook — order_created event
router.post('/webhook', async (req, res) => {
  const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(403).json({ error: 'Not configured' });

  const signature = req.headers['x-signature'] as string;
  if (!signature) return res.status(401).json({ error: 'Missing signature' });

  // Verify HMAC-SHA256 signature
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString() : JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const digest = hmac.update(rawBody).digest('hex');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = typeof req.body === 'string' || Buffer.isBuffer(req.body)
    ? JSON.parse(rawBody)
    : req.body;

  const eventName = payload.meta?.event_name;

  if (eventName === 'order_created') {
    const customData = payload.meta?.custom_data;
    const userId = customData?.user_id;
    const variantId = payload.data?.attributes?.first_order_item?.variant_id;
    const credits = customData?.credits
      ? parseInt(customData.credits)
      : variantToCredits(variantId);

    if (userId && credits > 0) {
      // Atomic: prevent double-crediting
      const orderId = payload.data?.id;
      const key = `ls_order_${orderId}`;
      const inserted = db.prepare('INSERT OR IGNORE INTO used_sessions (key) VALUES (?)').run(key);
      if (inserted.changes === 0) {
        console.log(`[billing] duplicate webhook for order ${orderId}, skipping`);
        return res.json({ received: true });
      }

      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE users SET credits = credits + ?, credits_expire_at = ?, grace_period_start = NULL WHERE id = ?').run(credits, expiresAt, userId);
      console.log(`[billing] credited ${credits} to user ${userId}, expires ${expiresAt}`);
    }
  }

  res.json({ received: true });
});

export default router;
