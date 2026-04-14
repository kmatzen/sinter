import fs from 'fs';
import path from 'path';
import db from './db';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const GRACE_PERIOD_DAYS = 30;

// Storage model: prepaid allocation
// - User explicitly allocates credits toward storage (1 credit = 100MB for 30 days)
// - Allocation expires after 30 days
// - If expired and not renewed, grace period starts
// - After grace period, projects are deleted
//
// DB columns on users:
//   storage_allocation_mb  - how much storage they've paid for
//   storage_expires_at     - when their current allocation expires
//   grace_period_start     - when grace period started (null = no grace)

export function getUserStorageBytes(userId: string): number {
  const userDir = path.join(PROJECTS_DIR, userId);
  let total = 0;
  try {
    for (const f of fs.readdirSync(userDir)) {
      try { total += fs.statSync(path.join(userDir, f)).size; } catch { /* */ }
    }
  } catch { /* */ }
  return total;
}

// Allocate storage: user spends credits to reserve storage for 30 days
export function allocateStorage(userId: string, creditAmount: number): { success: boolean; error?: string; allocationMB?: number; expiresAt?: string } {
  const user = db.prepare('SELECT credits, storage_allocation_mb, storage_expires_at FROM users WHERE id = ?').get(userId) as any;
  if (!user) return { success: false, error: 'User not found' };
  if (user.credits < creditAmount) return { success: false, error: `Not enough credits. You have ${user.credits}.` };
  if (creditAmount < 1) return { success: false, error: 'Minimum 1 credit (100MB for 30 days).' };

  const allocationMB = creditAmount * 100; // 1 credit = 100MB
  const now = new Date();

  // If they have an active allocation, extend from current expiry; otherwise from now
  let expiresAt: Date;
  const currentExpiry = user.storage_expires_at ? new Date(user.storage_expires_at) : null;
  if (currentExpiry && currentExpiry > now) {
    // Extend from current expiry, take the max allocation
    expiresAt = new Date(currentExpiry);
    expiresAt.setDate(expiresAt.getDate() + 30);
  } else {
    // New allocation starts now
    expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + 30);
  }

  // Use the larger of current or new allocation
  const newAllocation = Math.max(user.storage_allocation_mb || 0, allocationMB);

  db.prepare(
    'UPDATE users SET credits = credits - ?, storage_allocation_mb = ?, storage_expires_at = ?, grace_period_start = NULL WHERE id = ?'
  ).run(creditAmount, newAllocation, expiresAt.toISOString(), userId);

  return { success: true, allocationMB: newAllocation, expiresAt: expiresAt.toISOString() };
}

// Check if user can store data
export function canUseStorage(userId: string): { allowed: boolean; reason?: string } {
  const user = db.prepare('SELECT storage_allocation_mb, storage_expires_at, grace_period_start FROM users WHERE id = ?').get(userId) as any;
  if (!user) return { allowed: false, reason: 'User not found' };

  const alloc = user.storage_allocation_mb || 0;
  if (alloc <= 0) return { allowed: false, reason: 'No storage allocated. Spend credits to enable cloud storage.' };

  const expiry = user.storage_expires_at ? new Date(user.storage_expires_at) : null;
  if (!expiry || expiry < new Date()) {
    if (user.grace_period_start) {
      return { allowed: false, reason: 'Storage expired. Renew to keep your projects.' };
    }
    return { allowed: false, reason: 'Storage expired. Renew to continue saving.' };
  }

  const usedBytes = getUserStorageBytes(userId);
  const usedMB = usedBytes / (1024 * 1024);
  if (usedMB >= alloc) {
    return { allowed: false, reason: `Storage full (${alloc}MB). Allocate more credits or delete projects.` };
  }

  return { allowed: true };
}

// Daily cron: check for expired allocations, manage grace periods, delete expired projects
export function runStorageBilling() {
  const now = new Date();
  const users = db.prepare(
    'SELECT id, email, storage_allocation_mb, storage_expires_at, grace_period_start FROM users WHERE storage_allocation_mb > 0'
  ).all() as any[];

  for (const user of users) {
    const expiry = user.storage_expires_at ? new Date(user.storage_expires_at) : null;
    if (!expiry || expiry > now) continue; // Still active

    const storageBytes = getUserStorageBytes(user.id);
    if (storageBytes <= 0) {
      // No data stored, just reset allocation
      db.prepare('UPDATE users SET storage_allocation_mb = 0, storage_expires_at = NULL, grace_period_start = NULL WHERE id = ?').run(user.id);
      continue;
    }

    // Allocation expired with data on disk
    if (!user.grace_period_start) {
      db.prepare('UPDATE users SET grace_period_start = ? WHERE id = ?').run(now.toISOString(), user.id);
      console.log(`[storage] Allocation expired for ${user.email}. Grace period started (${GRACE_PERIOD_DAYS} days).`);
      continue;
    }

    // Check if grace period is over
    const graceStart = new Date(user.grace_period_start);
    const daysSinceGrace = (now.getTime() - graceStart.getTime()) / 86400000;

    if (daysSinceGrace >= GRACE_PERIOD_DAYS) {
      console.log(`[storage] Grace expired for ${user.email}. Deleting projects.`);
      const userDir = path.join(PROJECTS_DIR, user.id);
      try {
        for (const f of fs.readdirSync(userDir)) fs.unlinkSync(path.join(userDir, f));
        fs.rmdirSync(userDir);
      } catch { /* */ }
      db.prepare('DELETE FROM projects WHERE user_id = ?').run(user.id);
      db.prepare('UPDATE users SET storage_allocation_mb = 0, storage_expires_at = NULL, grace_period_start = NULL WHERE id = ?').run(user.id);
      console.log(`[storage] Deleted all projects for ${user.email}`);
    }
  }
}

export function startStorageBillingCron() {
  try { runStorageBilling(); } catch (e) { console.error('[storage] error:', e); }
  setInterval(() => {
    try { runStorageBilling(); } catch (e) { console.error('[storage] error:', e); }
  }, 24 * 60 * 60 * 1000);
}
