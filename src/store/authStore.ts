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
    return JSON.parse(raw) as PersistedAuth;
  } catch {
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
