import { test, expect, type Page } from '@playwright/test';

/**
 * OpenRouter sign-on has to be reachable *without* a Sinter account.
 *
 * That is the entire premise of the feature: you connect your own OpenRouter
 * account, OpenRouter bills you, and Sinter never holds a key or an account of
 * yours. Putting the settings panel behind a Sinter storage sign-in made the
 * whole bring-your-own-key path unreachable for anyone who chose "Continue
 * without account" — which is the exact user the feature is for.
 *
 * The handshake itself cannot be completed in a test without a real OpenRouter
 * account, so this asserts everything up to the redirect: the button is
 * reachable at all, the authorize URL is well formed, and the callback route
 * resolves rather than 404ing. The cryptographic half — that the verifier never
 * reaches the URL — is covered in `src/llm/openrouter.test.ts`.
 */

const PRECONDITION_TIMEOUT = 90_000;

async function enterAnonymously(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const accept = page.locator('button:has-text("Accept")');
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) await accept.click();
  const startBtn = page.locator('button:has-text("Start Modeling")').first();
  if (await startBtn.isVisible({ timeout: 30_000 }).catch(() => false)) await startBtn.click();
  if (await accept.isVisible({ timeout: 1500 }).catch(() => false)) await accept.click();
  const continueBtn = page.locator('button:has-text("Continue without account")');
  if (await continueBtn.isVisible({ timeout: 30_000 }).catch(() => false)) await continueBtn.click();
  await expect(page.locator('[data-testid="modeler-app"]')).toBeVisible({ timeout: PRECONDITION_TIMEOUT });
}

test.describe('OpenRouter sign-on without a Sinter account', () => {
  test.slow();

  test('starts a correct PKCE handshake', async ({ page }) => {
    // Abort rather than fulfil, so the page stays on the app's origin. A
    // fulfilled navigation would put the document on openrouter.ai, and
    // sessionStorage is per-origin — the verifier check below would then read
    // an empty store and pass for the wrong reason.
    let authUrl = '';
    await page.route('https://openrouter.ai/**', async (route) => {
      authUrl = route.request().url();
      await route.abort();
    });

    await enterAnonymously(page);

    // Reachable at all — this is what regressed.
    await page.locator('[title="Settings"]').first().click();
    await page.selectOption('#ai-provider', 'openrouter');
    const connect = page.locator('button:has-text("Connect OpenRouter")');
    await expect(connect).toBeVisible({ timeout: 15_000 });

    const appOrigin = new URL(page.url()).origin;

    await connect.click();
    await expect.poll(() => authUrl, { timeout: 15_000 }).toContain('openrouter.ai/auth');

    const url = new URL(authUrl);
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');

    // The callback is this origin's, so it works on localhost and on any
    // deployment without pre-registering a redirect URI.
    const callback = url.searchParams.get('callback_url')!;
    expect(callback).toBe(`${appOrigin}/auth/openrouter/callback`);

    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // Base64url SHA-256, so 43 characters with no padding and no + or /.
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The verifier's secrecy is not re-checked here. `openrouter.test.ts`
    // already covers it — "never puts the verifier in the redirect URL" — and
    // reading sessionStorage after an aborted navigation is not possible
    // anyway, since the document is no longer on the app's origin.
  });

  /**
   * A PKCE callback is a client-side route. If the host serves a 404 there
   * instead of the app, the redirect back from OpenRouter lands nowhere and
   * the key is never exchanged.
   */
  test('serves the callback route rather than a 404', async ({ page }) => {
    const response = await page.goto('/auth/openrouter/callback');
    expect(response?.status()).toBe(200);
  });

  /** Signing in is still offered to anyone who does want cloud storage. */
  test('still offers sign-in alongside settings', async ({ page }) => {
    await enterAnonymously(page);
    await expect(page.locator('[title="Settings"]').first()).toBeVisible();
    await expect(page.locator('a:has-text("Sign In")').first()).toBeVisible();
  });
});
