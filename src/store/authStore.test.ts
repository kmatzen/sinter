import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Regression tests for single-flight token refresh.
 *
 * The first case is the counterexample TLC produced against the old design
 * (specs/TokenRefresh.tla): two concurrent callers snapshot the same auth
 * record, both refresh, and the second writes based on a read the record has
 * already moved past.
 */

const refreshGoogleToken = vi.fn();

class RefreshError extends Error {
  constructor(message: string, readonly definitive: boolean) {
    super(message);
    this.name = 'RefreshError';
  }
}

vi.mock('../auth/oauth', () => ({
  startSignIn: vi.fn(),
  completeSignIn: vi.fn(),
  fetchUserProfile: vi.fn(),
  refreshGoogleToken: (...args: unknown[]) => refreshGoogleToken(...args),
  RefreshError,
}));
vi.mock('../storage', () => ({ clearProviderCaches: vi.fn() }));

const AUTH_KEY = 'sinter_auth';

/** An auth record already inside the 60s refresh window. */
function expiringAuth(accessToken = 'old-token') {
  return {
    provider: 'google',
    accessToken,
    refreshToken: 'refresh-1',
    expiresAt: Date.now() + 1_000,
    user: { id: 'u1', email: 'a@b.c', name: 'A', avatar_url: '', provider: 'google' },
  };
}

/**
 * In-memory localStorage. jsdom does not reliably expose one here, and the
 * store's whole contract is about what lands in this cell, so an explicit
 * stub is both more portable and easier to assert against.
 */
function makeStorageStub(): Storage {
  const cell = new Map<string, string>();
  return {
    getItem: (k) => cell.get(k) ?? null,
    setItem: (k, v) => void cell.set(k, String(v)),
    removeItem: (k) => void cell.delete(k),
    clear: () => cell.clear(),
    key: (i) => [...cell.keys()][i] ?? null,
    get length() { return cell.size; },
  } as Storage;
}

const readStored = () => {
  const raw = localStorage.getItem(AUTH_KEY);
  return raw ? JSON.parse(raw) : null;
};

let useAuthStore: typeof import('./authStore').useAuthStore;
let getCurrentProvider: typeof import('./authStore').getCurrentProvider;

beforeEach(async () => {
  vi.resetModules();
  refreshGoogleToken.mockReset();
  vi.stubGlobal('localStorage', makeStorageStub());
  localStorage.setItem(AUTH_KEY, JSON.stringify(expiringAuth()));
  const authModule = await import('./authStore');
  useAuthStore = authModule.useAuthStore;
  getCurrentProvider = authModule.getCurrentProvider;
});

afterEach(() => vi.unstubAllGlobals());

describe('getAccessToken single-flight refresh', () => {
  it('issues one refresh for concurrent callers', async () => {
    refreshGoogleToken.mockResolvedValue({ accessToken: 'new-token', expiresAt: Date.now() + 3_600_000 });

    const results = await Promise.all([
      useAuthStore.getState().getAccessToken(),
      useAuthStore.getState().getAccessToken(),
      useAuthStore.getState().getAccessToken(),
    ]);

    // The old design fired one refresh per caller.
    expect(refreshGoogleToken).toHaveBeenCalledTimes(1);
    expect(results).toEqual(['new-token', 'new-token', 'new-token']);
    expect(readStored().accessToken).toBe('new-token');
  });

  it('does not sign the user out when a concurrent caller fails', async () => {
    // The TLC counterexample: two callers refresh from the same snapshot, one
    // succeeds, the other's outcome must not clobber the established session.
    let call = 0;
    refreshGoogleToken.mockImplementation(async () => {
      call += 1;
      if (call === 1) return { accessToken: 'new-token', expiresAt: Date.now() + 3_600_000 };
      throw new RefreshError('network down', false);
    });

    const [a, b] = await Promise.allSettled([
      useAuthStore.getState().getAccessToken(),
      useAuthStore.getState().getAccessToken(),
    ]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    // Single-flight means the second call never issued a competing refresh,
    // so there is no second outcome to wipe the record.
    expect(refreshGoogleToken).toHaveBeenCalledTimes(1);
    expect(readStored()).not.toBeNull();
    expect(readStored().accessToken).toBe('new-token');
  });

  it('keeps the session on a transient failure', async () => {
    refreshGoogleToken.mockRejectedValue(new RefreshError('502 Bad Gateway', false));

    await expect(useAuthStore.getState().getAccessToken()).rejects.toThrow('502 Bad Gateway');

    // The old design called writePersisted(null) here, turning a gateway blip
    // into a forced re-auth.
    expect(readStored()).not.toBeNull();
    expect(readStored().refreshToken).toBe('refresh-1');
  });

  it('clears the session when the grant is definitively dead', async () => {
    refreshGoogleToken.mockRejectedValue(new RefreshError('invalid_grant', true));

    await expect(useAuthStore.getState().getAccessToken()).rejects.toThrow('invalid_grant');

    expect(readStored()).toBeNull();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('does not resurrect a record removed during the refresh', async () => {
    refreshGoogleToken.mockImplementation(async () => {
      // Logout lands while the refresh is in flight.
      localStorage.removeItem(AUTH_KEY);
      return { accessToken: 'new-token', expiresAt: Date.now() + 3_600_000 };
    });

    await expect(useAuthStore.getState().getAccessToken()).rejects.toThrow('Signed out during refresh');
    expect(readStored()).toBeNull();
  });

  it('allows a fresh refresh after the previous one settles', async () => {
    refreshGoogleToken.mockResolvedValue({ accessToken: 'new-token', expiresAt: Date.now() + 1_000 });
    await useAuthStore.getState().getAccessToken();
    // Still inside the refresh window, so the next call refreshes again —
    // the in-flight slot must have been released.
    await useAuthStore.getState().getAccessToken();
    expect(refreshGoogleToken).toHaveBeenCalledTimes(2);
  });

  it('skips refresh entirely for a token that is not near expiry', async () => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ ...expiringAuth('fresh'), expiresAt: Date.now() + 3_600_000 }));
    await expect(useAuthStore.getState().getAccessToken()).resolves.toBe('fresh');
    expect(refreshGoogleToken).not.toHaveBeenCalled();
  });
});

describe('persisted authentication decoding', () => {
  it.each([
    ['unknown provider', { ...expiringAuth(), provider: 'dropbox', user: { ...expiringAuth().user, provider: 'dropbox' } }],
    ['missing access token', { ...expiringAuth(), accessToken: undefined }],
    ['non-string access token', { ...expiringAuth(), accessToken: 42 }],
    ['empty access token', { ...expiringAuth(), accessToken: '   ' }],
    ['non-string refresh token', { ...expiringAuth(), refreshToken: 42 }],
    ['empty refresh token', { ...expiringAuth(), refreshToken: '' }],
    ['invalid expiry', { ...expiringAuth(), expiresAt: 'tomorrow' }],
    ['negative expiry', { ...expiringAuth(), expiresAt: -1 }],
    ['missing user', { ...expiringAuth(), user: undefined }],
    ['empty user id', { ...expiringAuth(), user: { ...expiringAuth().user, id: '' } }],
    ['mismatched user provider', { ...expiringAuth(), user: { ...expiringAuth().user, provider: 'github' } }],
  ])('clears %s instead of restoring a phantom session', async (_label, record) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(record));

    await useAuthStore.getState().checkAuth();

    expect(useAuthStore.getState()).toMatchObject({ user: null, loading: false, checked: true });
    expect(localStorage.getItem(AUTH_KEY)).toBeNull();
    expect(getCurrentProvider()).toBeNull();
    await expect(useAuthStore.getState().getAccessToken()).rejects.toThrow('Not signed in');
  });

  it.each([
    ['google', expiringAuth()],
    ['github', { ...expiringAuth('github-token'), provider: 'github', refreshToken: null, expiresAt: 0,
      user: { ...expiringAuth().user, provider: 'github' } }],
  ])('restores a valid %s session', async (provider, record) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(record));
    await useAuthStore.getState().checkAuth();
    expect(useAuthStore.getState().user?.provider).toBe(provider);
    expect(getCurrentProvider()).toBe(provider);
  });
});
