import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../middleware/requireAuth';
import db from '../db';
import type { User } from '../auth';
import { canUseStorage } from '../storageBilling';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');

// Input validation
const MAX_NAME_LENGTH = 255;
const MAX_TREE_SIZE = 10 * 1024 * 1024; // 10MB

function validateName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || null;
}

function projectPath(userId: string, projectId: string): string {
  // Prevent path traversal by validating IDs are UUIDs
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('Invalid project ID');
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Invalid user ID');
  const dir = path.join(PROJECTS_DIR, userId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${projectId}.json`);
}

function readTree(userId: string, projectId: string): any {
  try {
    const p = projectPath(userId, projectId);
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function writeTree(userId: string, projectId: string, tree: any): void {
  const json = JSON.stringify(tree);
  if (json.length > MAX_TREE_SIZE) throw new Error('Project too large');
  const p = projectPath(userId, projectId);
  fs.writeFileSync(p, json);
}

function deleteTree(userId: string, projectId: string): void {
  try { fs.unlinkSync(projectPath(userId, projectId)); } catch { /* may not exist */ }
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
router.get('/shared/:token', (req, res) => {
  if (!checkShareRateLimit(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  // Validate token format (64-char hex = 32 bytes)
  if (!/^[0-9a-f]{64}$/i.test(req.params.token)) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  const project = db.prepare('SELECT id, name, user_id FROM projects WHERE share_token = ?').get(req.params.token) as any;
  if (!project) return res.status(404).json({ error: 'Not found' });
  project.tree_json = readTree(project.user_id, project.id);
  delete project.user_id;
  res.json(project);
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
router.get('/:id', (req, res) => {
  const user = req.user as User;
  const project = db.prepare(
    'SELECT id, name, created_at, updated_at, share_token FROM projects WHERE id = ? AND user_id = ?'
  ).get(req.params.id, user.id) as any;
  if (!project) return res.status(404).json({ error: 'Not found' });
  project.tree_json = readTree(user.id, project.id);
  res.json(project);
});

// Create project
router.post('/', (req, res) => {
  const user = req.user as User;
  const id = uuidv4();
  const name = validateName(req.body.name) || 'Untitled';
  const storageCheck = canUseStorage(user.id);
  if (!storageCheck.allowed) {
    return res.status(402).json({ error: storageCheck.reason });
  }
  const thumbnail = typeof req.body.thumbnail === 'string' ? req.body.thumbnail.slice(0, 200000) : null;
  db.prepare('INSERT INTO projects (id, user_id, name, thumbnail) VALUES (?, ?, ?, ?)').run(id, user.id, name, thumbnail);
  try {
    if (req.body.tree_json) writeTree(user.id, id, req.body.tree_json);
  } catch (err: any) {
    // Clean up DB entry if file write fails
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return res.status(400).json({ error: err.message || 'Failed to save project data' });
  }
  res.json({ id });
});

// Update project
router.put('/:id', (req, res) => {
  const user = req.user as User;
  const name = validateName(req.body.name);
  const thumbnail = typeof req.body.thumbnail === 'string' ? req.body.thumbnail.slice(0, 200000) : null;
  const result = db.prepare(
    "UPDATE projects SET name = COALESCE(?, name), thumbnail = COALESCE(?, thumbnail), updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).run(name, thumbnail, req.params.id, user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  try {
    if (req.body.tree_json) writeTree(user.id, req.params.id, req.body.tree_json);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to save project data' });
  }
  res.json({ ok: true });
});

// Delete project
router.delete('/:id', (req, res) => {
  const user = req.user as User;
  const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(req.params.id, user.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
  deleteTree(user.id, req.params.id);
  res.json({ ok: true });
});

// Toggle share (generate/revoke public link)
router.post('/:id/share', (req, res) => {
  const user = req.user as User;
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').get(req.params.id, user.id) as any;
  if (!project) return res.status(404).json({ error: 'Not found' });
  // Use 32 bytes (64 hex chars) for strong tokens
  const token = project.share_token ? null : crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE projects SET share_token = ? WHERE id = ?').run(token, req.params.id);
  res.json({ share_token: token });
});

export default router;
