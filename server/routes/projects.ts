import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { requireAuth } from '../middleware/requireAuth';
import db from '../db';
import type { User } from '../auth';
import { getStorageProvider, getUserToken } from '../storageProviders';

// Input validation
const MAX_NAME_LENGTH = 255;
const MAX_TREE_SIZE = 10 * 1024 * 1024; // 10MB

function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || null;
}

// Simple rate limiter for unauthenticated endpoints
const shareRateLimit = new Map<string, { count: number; resetAt: number }>();
function checkShareRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = shareRateLimit.get(ip);
  if (!entry || now > entry.resetAt) {
    shareRateLimit.set(ip, { count: 1, resetAt: now + 60000 }); // 1 minute window
    return true;
  }
  if (entry.count >= 30) return false; // 30 requests per minute
  entry.count++;
  return true;
}

const router = Router();

// --- PUBLIC ROUTES (before auth middleware) ---

// Public view of shared project (no auth required, rate limited)
router.get('/shared/:token', async (req, res) => {
  if (!checkShareRateLimit(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  // Validate token format (64-char hex = 32 bytes)
  if (!/^[0-9a-f]{64}$/i.test(req.params.token)) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  const project = db.prepare(
    'SELECT id, name, user_id, storage_provider, storage_external_id FROM projects WHERE share_token = ?'
  ).get(req.params.token) as any;
  if (!project) return res.status(404).json({ error: 'Not found' });

  try {
    let treeJson = null;
    if (project.storage_provider && project.storage_external_id) {
      const { accessToken } = await getUserToken(project.user_id);
      const provider = getStorageProvider(project.storage_provider);
      const content = await provider.read(accessToken, project.storage_external_id);
      treeJson = JSON.parse(content);
    }
    res.json({ id: project.id, name: project.name, tree_json: treeJson });
  } catch (err: any) {
    console.error('Shared project read failed:', err.message);
    res.status(502).json({ error: 'Failed to load shared project from external storage' });
  }
});

// --- AUTHENTICATED ROUTES ---
router.use(requireAuth);

// List user's projects (metadata + thumbnail)
router.get('/', (req, res) => {
  const user = req.user as User;
  const projects = db.prepare(
    'SELECT id, name, thumbnail, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC'
  ).all(user.id);
  res.json(projects);
});

// Get single project
router.get('/:id', async (req, res) => {
  const user = req.user as User;
  const project = db.prepare(
    'SELECT id, name, created_at, updated_at, share_token, storage_provider, storage_external_id FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, user.id) as any;
  if (!project) return res.status(404).json({ error: 'Not found' });

  try {
    let treeJson = null;
    if (project.storage_provider && project.storage_external_id) {
      const { accessToken } = await getUserToken(user.id);
      const provider = getStorageProvider(project.storage_provider);
      const content = await provider.read(accessToken, project.storage_external_id);
      treeJson = JSON.parse(content);
    }
    res.json({ ...project, tree_json: treeJson, storage_provider: undefined, storage_external_id: undefined });
  } catch (err: any) {
    console.error('Project read failed:', err.message);
    res.status(502).json({ error: 'Failed to load project from external storage' });
  }
});

// Create project
router.post('/', async (req, res) => {
  const user = req.user as User;
  const id = uuidv4();
  const name = validateName(req.body.name) || 'Untitled';
  const thumbnail = typeof req.body.thumbnail === 'string' ? req.body.thumbnail.slice(0, 200000) : null;

  try {
    const { provider: storageProvider, accessToken } = await getUserToken(user.id);
    const provider = getStorageProvider(storageProvider);

    let externalId: string | null = null;
    if (req.body.tree_json) {
      const json = JSON.stringify(req.body.tree_json);
      if (json.length > MAX_TREE_SIZE) {
        return res.status(400).json({ error: 'Project too large' });
      }
      const result = await provider.create(accessToken, id, json, false);
      externalId = result.externalId;
    }

    db.prepare(
      'INSERT INTO projects (id, user_id, name, thumbnail, storage_provider, storage_external_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, user.id, name, thumbnail, storageProvider, externalId);

    res.json({ id });
  } catch (err: any) {
    console.error('Project create failed:', err.message);
    res.status(502).json({ error: err.message || 'Failed to create project in external storage' });
  }
});

// Update project
router.put('/:id', async (req, res) => {
  const user = req.user as User;
  const project = db.prepare(
    'SELECT id, storage_provider, storage_external_id FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, user.id) as any;
  if (!project) return res.status(404).json({ error: 'Not found' });

  const name = validateName(req.body.name);
  const thumbnail = typeof req.body.thumbnail === 'string' ? req.body.thumbnail.slice(0, 200000) : null;

  db.prepare(
    "UPDATE projects SET name = COALESCE(?, name), thumbnail = COALESCE(?, thumbnail), updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(name, thumbnail, req.params.id, user.id);

  try {
    if (req.body.tree_json) {
      const json = JSON.stringify(req.body.tree_json);
      if (json.length > MAX_TREE_SIZE) {
        return res.status(400).json({ error: 'Project too large' });
      }
      const { accessToken } = await getUserToken(user.id);
      const storageProvider = project.storage_provider || (await getUserToken(user.id)).provider;
      const provider = getStorageProvider(storageProvider);

      if (project.storage_external_id) {
        await provider.update(accessToken, project.storage_external_id, json);
      } else {
        // Project didn't have external storage yet — create it
        const result = await provider.create(accessToken, req.params.id, json, false);
        db.prepare('UPDATE projects SET storage_provider = ?, storage_external_id = ? WHERE id = ?')
          .run(storageProvider, result.externalId, req.params.id);
      }
    }
    res.json({ ok: true });
  } catch (err: any) {
    console.error('Project update failed:', err.message);
    res.status(502).json({ error: err.message || 'Failed to update project in external storage' });
  }
});

// Delete project
router.delete('/:id', async (req, res) => {
  const user = req.user as User;
  const project = db.prepare(
    'SELECT storage_provider, storage_external_id FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, user.id) as any;
  if (!project) return res.status(404).json({ error: 'Not found' });

  // Delete from external storage first
  if (project.storage_provider && project.storage_external_id) {
    try {
      const { accessToken } = await getUserToken(user.id);
      const provider = getStorageProvider(project.storage_provider);
      await provider.delete(accessToken, project.storage_external_id);
    } catch (err: any) {
      console.error('External storage delete failed:', err.message);
      // Continue with DB deletion even if external delete fails
    }
  }

  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
  res.json({ ok: true });
});

// Toggle share (generate/revoke public link)
router.post('/:id/share', async (req, res) => {
  const user = req.user as User;
  const project = db.prepare(
    'SELECT id, share_token, storage_provider, storage_external_id FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, user.id) as any;
  if (!project) return res.status(404).json({ error: 'Not found' });

  // Use 32 bytes (64 hex chars) for strong tokens
  const token = project.share_token ? null : crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE projects SET share_token = ? WHERE id = ?').run(token, req.params.id);

  // Update visibility in external storage (Google Drive only; GitHub gists are always accessible by URL)
  if (project.storage_provider === 'google' && project.storage_external_id) {
    try {
      const { accessToken } = await getUserToken(user.id);
      const provider = getStorageProvider('google');
      await provider.setPublic(accessToken, project.storage_external_id, !!token);
    } catch (err: any) {
      console.error('Failed to update sharing permission:', err.message);
    }
  }

  res.json({ share_token: token });
});

export default router;
