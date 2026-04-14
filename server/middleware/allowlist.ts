import type { Request, Response, NextFunction } from 'express';

// Restrict access to specific email addresses.
// Set ALLOWED_EMAILS env var as comma-separated list.
// If not set, all authenticated users are allowed.

export function checkAllowlist(req: Request, res: Response, next: NextFunction) {
  const allowedEmails = process.env.ALLOWED_EMAILS;
  if (!allowedEmails) return next(); // No allowlist = open to all

  // Public routes don't need allowlist
  if (!req.isAuthenticated || !req.isAuthenticated()) return next();

  const user = req.user as any;
  const allowed = allowedEmails.split(',').map((e) => e.trim().toLowerCase());

  if (allowed.includes(user.email?.toLowerCase())) return next();

  res.status(403).json({ error: 'Access restricted. This instance is invite-only.' });
}
