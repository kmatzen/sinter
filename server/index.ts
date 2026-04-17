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
import authRoutes from './routes/auth';
import projectRoutes from './routes/projects';

const app = express();
const PORT = parseInt(process.env.PORT || '3000');
const isDev = process.env.NODE_ENV !== 'production';

// Trust proxy in production (Fly.io terminates TLS at the proxy layer)
if (!isDev) app.set('trust proxy', 1);

// Require SESSION_SECRET in production
if (!isDev && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'dev-secret-change-me')) {
  console.error('FATAL: SESSION_SECRET must be set in production');
  process.exit(1);
}

app.use(express.json({ limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});

if (!isDev && !process.env.BASE_URL) {
  console.error('FATAL: BASE_URL must be set in production');
  process.exit(1);
}

app.use(cors({
  origin: isDev ? 'http://localhost:5173' : process.env.BASE_URL!,
  credentials: true,
}));

// Sessions with SQLite store
const SessionStore = SqliteStore(session);

const sessionMiddleware = session({
  store: new SessionStore({ client: db, expired: { clear: true, intervalMs: 900000 } }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: !isDev,
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax',
  },
});

setupAuth();
const passportInit = passport.initialize();
const passportSession = passport.session();

// Attach session + passport on auth/project routes or when consent cookie exists
const consentPaths = ['/api/auth', '/api/projects'];
app.use((req, res, next) => {
  const hasConsent = req.headers.cookie?.includes('sinter_cookie_consent=accepted');
  const needsSession = hasConsent || consentPaths.some((p) => req.path.startsWith(p));
  if (!needsSession) return next();
  sessionMiddleware(req, res, () => {
    passportInit(req, res, () => {
      passportSession(req, res, next);
    });
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);

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
  if (isDev) {
    console.log(`Frontend dev server should be at http://localhost:5173`);
    console.log(`API server at http://localhost:${PORT}`);
  }
});
