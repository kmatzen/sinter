import 'dotenv/config';
import { fileURLToPath } from 'url';
import express from 'express';
import session from 'express-session';
import SqliteStore from 'better-sqlite3-session-store';
import passport from 'passport';
import cors from 'cors';
import path from 'path';
import db from './db';
import { setupAuth } from './auth';
import { checkAllowlist } from './middleware/allowlist';
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';
import llmRoutes from './routes/llm';
import billingRoutes from './routes/billing';
import { startStorageBillingCron } from './storageBilling';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const isDev = process.env.NODE_ENV !== 'production';

// Require SESSION_SECRET in production
if (!isDev && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret-change-me')) {
  console.error('FATAL: SESSION_SECRET must be set in production');
  process.exit(1);
}

// Middleware
app.use(express.json({ limit: '10mb' }));

// Site password gate (set SITE_PASSWORD to enable).
// When set, OAuth sign-in routes require Basic Auth.
// Landing page and static files remain public.
const sitePassword = process.env.SITE_PASSWORD;
if (sitePassword) {
  const gatedPaths = ['/api/auth/google', '/api/auth/github'];
  app.use((req, res, next) => {
    if (!gatedPaths.some((p) => req.path.startsWith(p))) return next();
    const auth = req.headers.authorization;
    if (auth) {
      const [scheme, encoded] = auth.split(' ');
      if (scheme === 'Basic') {
        const [, pass] = Buffer.from(encoded, 'base64').toString().split(':');
        if (pass === sitePassword) return next();
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Sinter"');
    res.status(401).send('Access restricted');
  });
}

// Tell the frontend whether sign-in is available
app.get('/api/auth/config', (_req, res) => {
  res.json({ signInEnabled: !sitePassword });
});

// Security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors({
  origin: isDev ? 'http://localhost:5173' : (process.env.BASE_URL || false),
  credentials: true,
}));

// Sessions with SQLite store
const SessionStore = SqliteStore(session);

app.use(session({
  store: new SessionStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: !isDev,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: isDev ? 'lax' : 'strict',
  },
}));

// Passport
setupAuth();
app.use(passport.initialize());
app.use(passport.session());

// Allowlist check (after auth, before API routes)
app.use('/api/projects', checkAllowlist);
app.use('/api/llm', checkAllowlist);
app.use('/api/billing', checkAllowlist);

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/llm', llmRoutes);
app.use('/api/billing', billingRoutes);

// In production, serve the built frontend
if (!isDev) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sinter server running on port ${PORT}`);
  if (!isDev) startStorageBillingCron();
  if (isDev) {
    console.log(`Frontend dev server should be at http://localhost:5173`);
    console.log(`API server at http://localhost:${PORT}`);
  }
});
