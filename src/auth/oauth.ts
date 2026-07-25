// Client-side OAuth helpers (PKCE for Google, code flow for GitHub).
// The Pages Function holds the client secret; the browser holds the
// resulting access token.

import type { ProviderName } from '../storage/types';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GITHUB_AUTH = 'https://github.com/login/oauth/authorize';

const GOOGLE_SCOPES = ['openid', 'profile', 'email', 'https://www.googleapis.com/auth/drive.file'];
const GITHUB_SCOPES = ['user:email', 'gist'];

const PENDING_KEY = 'sinter_oauth_pending';

interface PendingState {
  provider: ProviderName;
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  startedAt: number;
}

function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(input: string): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(hash);
}

function callbackUrl(): string {
  return `${window.location.origin}/auth/callback`;
}

export function getClientId(provider: ProviderName): string {
  if (provider === 'google') return import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
  return import.meta.env.VITE_GITHUB_CLIENT_ID || '';
}

export async function startSignIn(provider: ProviderName): Promise<void> {
  const clientId = getClientId(provider);
  if (!clientId) {
    throw new Error(`${provider} OAuth is not configured (missing VITE_${provider.toUpperCase()}_CLIENT_ID)`);
  }
  const state = randomString(24);
  const redirectUri = callbackUrl();
  const pending: PendingState = { provider, state, redirectUri, startedAt: Date.now() };

  let url: string;
  if (provider === 'google') {
    const codeVerifier = randomString(64);
    const challenge = base64url(await sha256(codeVerifier));
    pending.codeVerifier = codeVerifier;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    url = `${GOOGLE_AUTH}?${params}`;
  } else {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: GITHUB_SCOPES.join(' '),
      state,
      allow_signup: 'true',
    });
    url = `${GITHUB_AUTH}?${params}`;
  }

  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.assign(url);
}

export interface ExchangeResult {
  provider: ProviderName;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // ms epoch; 0 means "no expiry tracked"
}

export async function completeSignIn(): Promise<ExchangeResult> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const errorParam = params.get('error');
  if (errorParam) throw new Error(`OAuth error: ${params.get('error_description') || errorParam}`);
  if (!code || !state) throw new Error('Missing code or state in OAuth callback');

  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) throw new Error('No pending OAuth flow (start over from the sign-in page)');
  const pending = JSON.parse(raw) as PendingState;
  sessionStorage.removeItem(PENDING_KEY);
  if (pending.state !== state) throw new Error('OAuth state mismatch (possible CSRF)');

  const url = `/api/auth/${pending.provider}/exchange`;
  const body = pending.provider === 'google'
    ? { code, code_verifier: pending.codeVerifier, redirect_uri: pending.redirectUri }
    : { code, redirect_uri: pending.redirectUri };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Token exchange failed (${res.status})`);
  }
  const data = await res.json();
  const expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : 0;
  return {
    provider: pending.provider,
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt,
  };
}

/**
 * A refresh that failed. `definitive` distinguishes "this refresh token is
 * dead, sign the user out" from "the network hiccuped, keep the session".
 * Treating the two alike turns a dropped packet into a forced re-auth.
 */
export class RefreshError extends Error {
  constructor(message: string, readonly definitive: boolean) {
    super(message);
    this.name = 'RefreshError';
  }
}

export async function refreshGoogleToken(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetch('/api/auth/google/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    // 400 invalid_grant / 401: the grant is genuinely gone. Anything else
    // (5xx, 429, gateway errors) is transient — a fetch rejection never
    // reaches here at all and is transient by construction.
    const definitive = res.status === 400 || res.status === 401;
    throw new RefreshError(err.error || `Refresh failed (${res.status})`, definitive);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
}

export async function fetchUserProfile(provider: ProviderName, accessToken: string): Promise<UserProfile> {
  if (provider === 'google') {
    const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Failed to fetch Google profile (${res.status})`);
    const data = await res.json();
    return {
      id: data.id,
      email: data.email || '',
      name: data.name || data.email || 'User',
      avatar_url: data.picture || '',
    };
  }
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`Failed to fetch GitHub profile (${res.status})`);
  const data = await res.json();
  let email = data.email || '';
  if (!email) {
    try {
      const e = await fetch('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
      });
      if (e.ok) {
        const emails = (await e.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        const primary = emails.find((x) => x.primary && x.verified) || emails[0];
        if (primary) email = primary.email;
      }
    } catch { /* best effort */ }
  }
  return {
    id: String(data.id),
    email,
    name: data.name || data.login || 'User',
    avatar_url: data.avatar_url || '',
  };
}
