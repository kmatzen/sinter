import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { Strategy as GitHubStrategy } from 'passport-github2';
import { v4 as uuidv4 } from 'uuid';
import db from './db';

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  provider: string;
  provider_id: string;
}

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser((id: string, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
  done(null, user || null);
});

function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return url;
  } catch { /* invalid URL */ }
  return '';
}

function upsertUser(profile: { provider: string; id: string; email: string; name: string; avatar: string }): User {
  // Sanitize inputs
  profile.name = String(profile.name || '').slice(0, 200);
  profile.email = String(profile.email || '').slice(0, 320);
  profile.avatar = sanitizeUrl(String(profile.avatar || ''));
  const existing = db.prepare('SELECT * FROM users WHERE provider_id = ?').get(profile.id) as User | undefined;

  if (existing) {
    db.prepare('UPDATE users SET name = ?, avatar_url = ?, email = ?, last_login = datetime(\'now\') WHERE id = ?')
      .run(profile.name, profile.avatar, profile.email, existing.id);
    return { ...existing, name: profile.name, avatar_url: profile.avatar, email: profile.email };
  }

  const id = uuidv4();
  db.prepare('INSERT INTO users (id, email, name, avatar_url, provider, provider_id, last_login) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))')
    .run(id, profile.email, profile.name, profile.avatar, profile.provider, profile.id);

  return { id, email: profile.email, name: profile.name, avatar_url: profile.avatar, provider: profile.provider, provider_id: profile.id };
}

export function setupAuth() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: `${baseUrl}/api/auth/google/callback`,
    }, (_accessToken, _refreshToken, profile, done) => {
      const user = upsertUser({
        provider: 'google',
        id: profile.id,
        email: profile.emails?.[0]?.value || '',
        name: profile.displayName || '',
        avatar: profile.photos?.[0]?.value || '',
      });
      done(null, user);
    }));
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy({
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: `${baseUrl}/api/auth/github/callback`,
    }, (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
      const user = upsertUser({
        provider: 'github',
        id: profile.id,
        email: profile.emails?.[0]?.value || '',
        name: profile.displayName || profile.username || '',
        avatar: profile.photos?.[0]?.value || '',
      });
      done(null, user);
    }));
  }
}
