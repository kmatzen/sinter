// OpenRouter sign-on (OAuth PKCE).
//
// This is the flow that removes the "go create an API key first" wall. It is
// deliberately simpler than the Google/GitHub storage flows: those need a
// Pages Function because they hold a client secret, whereas PKCE has none, so
// the whole exchange runs in the browser and no new server route exists.
//
// What comes back is a user-controlled key billed against that user's own
// OpenRouter credits. Sinter never proxies inference and never holds a
// platform key that user traffic is billed against.

import { createPkcePair } from '../auth/pkce';

const OPENROUTER_AUTH = 'https://openrouter.ai/auth';
const OPENROUTER_KEY_EXCHANGE = 'https://openrouter.ai/api/v1/auth/keys';

const PENDING_KEY = 'sinter_openrouter_pending';

/** Distinct from the storage-provider callback so the two flows never race. */
export const OPENROUTER_CALLBACK_PATH = '/auth/openrouter/callback';

interface PendingSignIn {
  codeVerifier: string;
  method: 'S256';
  /** Where to return the user once the key is stored. */
  returnTo: string;
  startedAt: number;
}

export function openRouterCallbackUrl(): string {
  return `${window.location.origin}${OPENROUTER_CALLBACK_PATH}`;
}

/**
 * Begin sign-on. Navigates away; the promise only settles if the redirect
 * does not happen.
 */
export async function startOpenRouterSignIn(returnTo = '/app'): Promise<void> {
  const { verifier, challenge, method } = await createPkcePair();

  const pending: PendingSignIn = {
    codeVerifier: verifier,
    method,
    returnTo,
    startedAt: Date.now(),
  };
  // sessionStorage, not localStorage: an abandoned handshake should not
  // outlive the tab, and the verifier is single-use.
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));

  const params = new URLSearchParams({
    callback_url: openRouterCallbackUrl(),
    code_challenge: challenge,
    code_challenge_method: method,
  });
  window.location.assign(`${OPENROUTER_AUTH}?${params}`);
}

export function hasPendingOpenRouterSignIn(): boolean {
  return sessionStorage.getItem(PENDING_KEY) !== null;
}

export interface OpenRouterSignInResult {
  apiKey: string;
  returnTo: string;
}

/**
 * Complete sign-on from the callback URL, returning the user's key.
 *
 * The pending record is cleared before the network call so a failed exchange
 * cannot leave a spent verifier behind for a retry to reuse.
 */
export async function completeOpenRouterSignIn(
  search = window.location.search,
): Promise<OpenRouterSignInResult> {
  const params = new URLSearchParams(search);

  const errorParam = params.get('error');
  if (errorParam) {
    throw new Error(`OpenRouter sign-in failed: ${params.get('error_description') || errorParam}`);
  }

  const code = params.get('code');
  if (!code) throw new Error('OpenRouter did not return an authorization code');

  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) {
    throw new Error('No pending OpenRouter sign-in — start again from settings');
  }
  sessionStorage.removeItem(PENDING_KEY);

  let pending: PendingSignIn;
  try {
    pending = JSON.parse(raw) as PendingSignIn;
  } catch {
    throw new Error('Could not read the pending OpenRouter sign-in — start again from settings');
  }

  const res = await fetch(OPENROUTER_KEY_EXCHANGE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      code_verifier: pending.codeVerifier,
      code_challenge_method: pending.method,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenRouter key exchange failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const data = await res.json().catch(() => null);
  const apiKey = typeof data?.key === 'string' ? data.key : '';
  if (!apiKey) throw new Error('OpenRouter returned no key');

  return { apiKey, returnTo: pending.returnTo || '/app' };
}

/** Drop a half-finished handshake, e.g. when the user cancels. */
export function cancelOpenRouterSignIn(): void {
  sessionStorage.removeItem(PENDING_KEY);
}
