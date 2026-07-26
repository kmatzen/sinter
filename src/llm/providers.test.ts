import { describe, it, expect } from 'vitest';
import {
  PROVIDERS,
  PROVIDER_IDS,
  getProvider,
  isProviderId,
  resolveEndpoint,
} from './providers';

describe('provider registry', () => {
  it('exposes every registered id', () => {
    expect(PROVIDER_IDS).toEqual(expect.arrayContaining(['anthropic', 'openai', 'openrouter']));
    for (const id of PROVIDER_IDS) expect(PROVIDERS[id].id).toBe(id);
  });

  it('recognises registered ids and rejects everything else', () => {
    expect(isProviderId('openrouter')).toBe(true);
    expect(isProviderId('bedrock')).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
    expect(isProviderId(null)).toBe(false);
    // Guards against inherited Object properties passing the lookup.
    expect(isProviderId('toString')).toBe(false);
    expect(isProviderId('constructor')).toBe(false);
  });

  it('falls back to a working provider for an unknown persisted value', () => {
    expect(getProvider('who-knows').id).toBe('anthropic');
    expect(getProvider(undefined).id).toBe('anthropic');
    expect(getProvider('openai').id).toBe('openai');
  });

  it('routes OpenRouter over the OpenAI wire format', () => {
    // The whole reason a third provider needs no new streaming code.
    expect(PROVIDERS.openrouter.wire).toBe('openai');
    expect(PROVIDERS.openrouter.auth).toBe('oauth-pkce');
  });

  it('only claims capability metadata where the catalog actually has it', () => {
    expect(PROVIDERS.openrouter.catalogHasCapabilities).toBe(true);
    expect(PROVIDERS.anthropic.catalogHasCapabilities).toBe(false);
    expect(PROVIDERS.openai.catalogHasCapabilities).toBe(false);
  });
});

describe('resolveEndpoint', () => {
  it('uses the registry default when there is no override', () => {
    expect(resolveEndpoint(PROVIDERS.openrouter)).toBe('https://openrouter.ai/api');
  });

  it('prefers an explicit override', () => {
    expect(resolveEndpoint(PROVIDERS.openai, 'https://proxy.internal')).toBe('https://proxy.internal');
  });

  it('ignores a blank or whitespace override', () => {
    expect(resolveEndpoint(PROVIDERS.openai, '   ')).toBe('https://api.openai.com');
    expect(resolveEndpoint(PROVIDERS.openai, '')).toBe('https://api.openai.com');
  });

  it('trims trailing slashes so callers can concatenate a path', () => {
    // Without this, "https://x/" + "/v1/models" double-slashes.
    expect(resolveEndpoint(PROVIDERS.openai, 'https://proxy.internal/')).toBe('https://proxy.internal');
    expect(resolveEndpoint(PROVIDERS.openai, 'https://proxy.internal///')).toBe('https://proxy.internal');
  });
});
