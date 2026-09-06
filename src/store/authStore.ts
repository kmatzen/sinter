import { create } from 'zustand';
import type { ProviderName } from '../storage/types';
import {
  startSignIn as startOAuth,
  completeSignIn,
  refreshGoogleToken,
  fetchUserProfile,
  RefreshError,
} from '../auth/oauth';
import { clearProviderCaches } from '../storage';

const AUTH_KEY = 'sinter_auth';

/** The in-flight refresh, shared by all concurrent getAccessToken callers. */
let refreshInFlight: Promise<string> | null = null;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar_url: string;
  provider: ProviderName;
}

interface PersistedAuth {
  provider: ProviderName;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  user: AuthUser;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  checked: boolean;

  checkAuth: () => Promise<void>;
  signIn: (provider: ProviderName) => Promise<void>;
  completeOAuthCallback: () => Promise<void>;
  logout: () => Promise<void>;
  /** Returns a valid access token for the current user's provider, refreshing if needed. */
  getAccessToken: () => Promise<string>;
}

function readPersisted(): PersistedAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid auth envelope');
    const auth = value as Record<string, unknown>;
    if (auth.provider !== 'google' && auth.provider !== 'github') throw new Error('invalid auth provider');
    if (typeof auth.accessToken !== 'string' || !auth.accessToken.trim() || auth.accessToken.length > 64 * 1024) {
      throw new Error('invalid access token');
    }
    if (auth.refreshToken !== null && (typeof auth.refreshToken !== 'string' || !auth.refreshToken.trim() || auth.refreshToken.length > 64 * 1024)) {
      throw new Error('invalid refresh token');
    }
    if (typeof auth.expiresAt !== 'number' || !Number.isFinite(auth.expiresAt) || auth.expiresAt < 0) {
      throw new Error('invalid token expiry');
    }
    if (!auth.user || typeof auth.user !== 'object' || Array.isArray(auth.user)) throw new Error('invalid auth user');
    const user = auth.user as Record<string, unknown>;
    const boundedString = (field: string, max: number, required = false) => {
      const item = user[field];
      return typeof item === 'string' && item.length <= max && (!required || !!item.trim());
    };
    if (!boundedString('id', 512, true) || !boundedString('email', 2_048) ||
        !boundedString('name', 2_048, true) || !boundedString('avatar_url', 16_384) ||
        user.provider !== auth.provider) {
      throw new Error('invalid auth user');
    }
    return auth as unknown as PersistedAuth;
  } catch {
    // Corrupt or stale structural data must not keep hydrating a phantom
    // signed-in state on every launch. Storage itself can be unavailable, so
    // clearing remains best effort.
    try { localStorage.removeItem(AUTH_KEY); } catch { /* unavailable storage */ }
    return null;
  }
}

function writePersisted(auth: PersistedAuth | null) {
  if (auth) localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  else localStorage.removeItem(AUTH_KEY);
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  checked: false,

  checkAuth: async () => {
    const persisted = readPersisted();
    if (!persisted) {
      set({ user: null, loading: false, checked: true });
      return;
    }
    set({ user: persisted.user, loading: false, checked: true });
  },

  signIn: async (provider) => {
    await startOAuth(provider);
    // startOAuth navigates away; this resolves only if redirect doesn't happen.
  },

  completeOAuthCallback: async () => {
    const result = await completeSignIn();
    const profile = await fetchUserProfile(result.provider, result.accessToken);
    const user: AuthUser = { ...profile, provider: result.provider };
    writePersisted({
      provider: result.provider,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      user,
    });
    set({ user, loading: false, checked: true });
  },

  logout: async () => {
    writePersisted(null);
    clearProviderCaches();
    set({ user: null });
    window.location.href = '/';
  },

  getAccessToken: async () => {
    const persisted = readPersisted();
    if (!persisted) throw new Error('Not signed in');

    // Refresh Google tokens that are within 60s of expiry.
    const needsRefresh =
      persisted.provider === 'google' &&
      persisted.expiresAt &&
      Date.now() > persisted.expiresAt - 60_000;
    if (!needsRefresh) return persisted.accessToken;

    if (!persisted.refreshToken) {
      // Refresh token missing: force re-auth.
      writePersisted(null);
      set({ user: null });
      throw new Error('Session expired — please sign in again');
    }

    // Single-flight. There are nine independent getAccessToken call sites and
    // they can overlap freely (autosave firing while the user clicks Share).
    // Without this, each one issues its own refresh and each writes the shared
    // localStorage record based on a snapshot taken before its await — so one
    // caller's failure clobbers a session another caller just established.
    // See specs/TokenRefresh.tla.
    if (refreshInFlight) return refreshInFlight;

    const refreshToken = persisted.refreshToken;
    refreshInFlight = (async () => {
      try {
        const refreshed = await refreshGoogleToken(refreshToken);
        // Re-read rather than spreading the pre-await snapshot: the record may
        // have been replaced (second tab finished a sign-in) or removed
        // (logout) while this refresh was in flight, and neither should be
        // resurrected.
        const current = readPersisted();
        if (!current) throw new Error('Signed out during refresh');
        writePersisted({ ...current, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt });
        return refreshed.accessToken;
      } catch (err) {
        // Only a dead grant clears the session. A network blip or 5xx fails
        // this call but leaves the user signed in.
        if (err instanceof RefreshError && err.definitive) {
          writePersisted(null);
          set({ user: null });
        }
        throw err;
      } finally {
        refreshInFlight = null;
      }
    })();

    return refreshInFlight;
  },
}));

export function getCurrentProvider(): ProviderName | null {
  return readPersisted()?.provider ?? null;
}
