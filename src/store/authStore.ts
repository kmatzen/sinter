import { create } from 'zustand';
import type { ProviderName } from '../storage/types';
import {
  startSignIn as startOAuth,
  completeSignIn,
  refreshGoogleToken,
  fetchUserProfile,
} from '../auth/oauth';
import { clearProviderCaches } from '../storage';

const AUTH_KEY = 'sinter_auth';

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
    if (persisted.provider === 'google' && persisted.expiresAt && Date.now() > persisted.expiresAt - 60_000) {
      if (!persisted.refreshToken) {
        // Refresh token missing: force re-auth.
        writePersisted(null);
        set({ user: null });
        throw new Error('Session expired — please sign in again');
      }
      try {
        const refreshed = await refreshGoogleToken(persisted.refreshToken);
        const updated: PersistedAuth = { ...persisted, accessToken: refreshed.accessToken, expiresAt: refreshed.expiresAt };
        writePersisted(updated);
        return refreshed.accessToken;
      } catch (err) {
        writePersisted(null);
        set({ user: null });
        throw err;
      }
    }
    return persisted.accessToken;
  },
}));

export function getCurrentProvider(): ProviderName | null {
  return readPersisted()?.provider ?? null;
}
