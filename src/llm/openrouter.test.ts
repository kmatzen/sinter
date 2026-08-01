import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startOpenRouterSignIn,
  completeOpenRouterSignIn,
  cancelOpenRouterSignIn,
  hasPendingOpenRouterSignIn,
  openRouterCallbackUrl,
  OPENROUTER_CALLBACK_PATH,
} from './openrouter';

const PENDING_KEY = 'sinter_openrouter_pending';

/** jsdom's sessionStorage is not dependable here; the flow's whole contract
 *  is about what lands in this cell, so assert against an explicit stub. */
function makeStorageStub(): Storage {
  const cell = new Map<string, string>();
  return {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => { cell.set(k, String(v)); },
    removeItem: (k: string) => { cell.delete(k); },
    clear: () => cell.clear(),
    key: (i: number) => Array.from(cell.keys())[i] ?? null,
    get length() { return cell.size; },
  } as Storage;
}

let assigned: string | null = null;

beforeEach(() => {
  assigned = null;
  vi.stubGlobal('sessionStorage', makeStorageStub());
  vi.stubGlobal('location', {
    origin: 'https://sinter.test',
    search: '',
    assign: (url: string) => { assigned = url; },
  });
  vi.stubGlobal('window', {
    location: {
      origin: 'https://sinter.test',
      search: '',
      assign: (url: string) => { assigned = url; },
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('startOpenRouterSignIn', () => {
  it('redirects with an S256 challenge and our callback URL', async () => {
    await startOpenRouterSignIn();

    expect(assigned).toBeTruthy();
    const url = new URL(assigned!);
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe(`https://sinter.test${OPENROUTER_CALLBACK_PATH}`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');

    const challenge = url.searchParams.get('code_challenge')!;
    expect(challenge).toBeTruthy();
    // base64url: no padding, no + or /
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('never puts the verifier in the redirect URL', async () => {
    await startOpenRouterSignIn();
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!);
    expect(pending.codeVerifier).toBeTruthy();
    // Leaking the verifier through the URL would defeat PKCE entirely.
    expect(assigned).not.toContain(pending.codeVerifier);
  });

  it('sends a fresh challenge each time', async () => {
    await startOpenRouterSignIn();
    const first = new URL(assigned!).searchParams.get('code_challenge');
    await startOpenRouterSignIn();
    const second = new URL(assigned!).searchParams.get('code_challenge');
    expect(first).not.toBe(second);
  });

  it('records where to return the user', async () => {
    await startOpenRouterSignIn('/app?project=1');
    const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY)!);
    expect(pending.returnTo).toBe('/app?project=1');
  });
});

describe('completeOpenRouterSignIn', () => {
  async function startAndGetVerifier() {
    await startOpenRouterSignIn();
    return JSON.parse(sessionStorage.getItem(PENDING_KEY)!).codeVerifier as string;
  }

  it('exchanges the code for the user key and clears the handshake', async () => {
    const verifier = await startAndGetVerifier();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ key: 'sk-or-user-key' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await completeOpenRouterSignIn('?code=auth-code-123');

    expect(result.apiKey).toBe('sk-or-user-key');
    expect(result.returnTo).toBe('/app');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      code: 'auth-code-123',
      code_verifier: verifier,
      code_challenge_method: 'S256',
    });
    // No client secret: that is what makes this safe to run in the browser.
    expect(init.body).not.toMatch(/client_secret/);

    expect(hasPendingOpenRouterSignIn()).toBe(false);
  });

  it('consumes the verifier even when the exchange fails', async () => {
    await startAndGetVerifier();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, text: async () => 'bad code',
    }));

    await expect(completeOpenRouterSignIn('?code=stale')).rejects.toThrow(/400/);
    // A single-use verifier must not survive for a retry to replay.
    expect(hasPendingOpenRouterSignIn()).toBe(false);
  });

  it('rejects a callback with no pending handshake', async () => {
    await expect(completeOpenRouterSignIn('?code=abc')).rejects.toThrow(/No pending OpenRouter sign-in/);
  });

  it('reports the provider error when the user cancels', async () => {
    await startAndGetVerifier();
    await expect(
      completeOpenRouterSignIn('?error=access_denied&error_description=User%20cancelled'),
    ).rejects.toThrow(/User cancelled/);
  });

  it('rejects a callback with no code', async () => {
    await startAndGetVerifier();
    await expect(completeOpenRouterSignIn('?state=whatever')).rejects.toThrow(/did not return an authorization code/);
  });

  it('rejects a response that carries no key', async () => {
    await startAndGetVerifier();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ ok: true }),
    }));
    await expect(completeOpenRouterSignIn('?code=abc')).rejects.toThrow(/no key/);
  });
});

describe('housekeeping', () => {
  it('builds the callback URL from the current origin', () => {
    expect(openRouterCallbackUrl()).toBe(`https://sinter.test${OPENROUTER_CALLBACK_PATH}`);
  });

  it('uses a path distinct from the storage sign-in callback', () => {
    // Sharing /auth/callback would make the two flows race on one redirect.
    expect(OPENROUTER_CALLBACK_PATH).not.toBe('/auth/callback');
  });

  it('cancel drops a half-finished handshake', async () => {
    await startOpenRouterSignIn();
    expect(hasPendingOpenRouterSignIn()).toBe(true);
    cancelOpenRouterSignIn();
    expect(hasPendingOpenRouterSignIn()).toBe(false);
  });
});
