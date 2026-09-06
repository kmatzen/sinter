import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jsonResponse } from '../functions/_shared';

const headersFile = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

describe('production security headers', () => {
  it('enforces the static application policy and enumerates required providers', () => {
    for (const header of [
      'Content-Security-Policy:', 'Strict-Transport-Security:', 'Permissions-Policy:',
      'X-Frame-Options:', 'X-Content-Type-Options:',
    ]) expect(headersFile).toContain(header);
    for (const origin of [
      'https://api.anthropic.com', 'https://api.openai.com', 'https://openrouter.ai',
      'https://www.googleapis.com', 'https://api.github.com', 'https://gist.githubusercontent.com',
    ]) expect(headersFile).toContain(origin);
    expect(headersFile).toContain("frame-ancestors 'none'");
    expect(headersFile).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('puts equivalent defensive headers on OAuth function responses', () => {
    const response = jsonResponse({ ok: true });
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(response.headers.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(response.headers.get('Permissions-Policy')).toContain('camera=()');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('keeps the sole inline JSON-LD script pinned to its exact CSP hash', () => {
    const script = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    const digest = createHash('sha256').update(script!).digest('base64');
    expect(headersFile).toContain(`'sha256-${digest}'`);
  });
});
