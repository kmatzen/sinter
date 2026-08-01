// PKCE primitives shared by the storage sign-in flow (Google) and the
// OpenRouter LLM sign-on. Both need the same verifier/challenge pair; keeping
// one implementation avoids the two drifting on encoding details.

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(length = 64): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256(input: string): Promise<Uint8Array> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(hash);
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = randomString(64);
  const challenge = base64url(await sha256(verifier));
  return { verifier, challenge, method: 'S256' };
}
