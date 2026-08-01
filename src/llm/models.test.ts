import { describe, it, expect, vi, afterEach } from 'vitest';
import { PROVIDERS } from './providers';
import { fetchModels, visionCapable, formatPricing, formatContext, type ModelInfo } from './models';

/** A trimmed row in the shape OpenRouter's catalog actually returns. */
function openRouterRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'anthropic/claude-opus-5',
    name: 'Claude Opus 5',
    context_length: 1_000_000,
    architecture: { input_modalities: ['text', 'image', 'file'], output_modalities: ['text'] },
    pricing: { prompt: '0.00001', completion: '0.00005' },
    supported_parameters: ['max_tokens', 'reasoning', 'tools'],
    ...overrides,
  };
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchModels', () => {
  it('normalises capability metadata when the provider publishes it', async () => {
    mockFetchOnce({ data: [openRouterRow()] });
    const [model] = await fetchModels(PROVIDERS.openrouter, '');

    expect(model.id).toBe('anthropic/claude-opus-5');
    expect(model.label).toBe('Claude Opus 5');
    expect(model.supportsImages).toBe(true);
    expect(model.supportsReasoning).toBe(true);
    expect(model.contextLength).toBe(1_000_000);
    // Prices arrive as strings and must survive as numbers.
    expect(model.promptPrice).toBe(0.00001);
    expect(model.completionPrice).toBe(0.00005);
  });

  it('marks a text-only model as unable to accept images', async () => {
    mockFetchOnce({ data: [openRouterRow({ architecture: { input_modalities: ['text'] } })] });
    const [model] = await fetchModels(PROVIDERS.openrouter, '');
    expect(model.supportsImages).toBe(false);
  });

  it('leaves capability undefined for providers whose catalog carries none', async () => {
    // OpenAI's /v1/models is just ids. Inventing capability here would let the
    // picker claim knowledge it does not have.
    mockFetchOnce({ data: [{ id: 'gpt-4o', object: 'model' }] });
    const [model] = await fetchModels(PROVIDERS.openai, 'sk-test');

    expect(model.id).toBe('gpt-4o');
    expect(model.supportsImages).toBeUndefined();
    expect(model.supportsReasoning).toBeUndefined();
  });

  it('sends provider-appropriate auth headers', async () => {
    const anthropicFetch = mockFetchOnce({ data: [{ id: 'claude-opus-4-7' }] });
    await fetchModels(PROVIDERS.anthropic, 'sk-ant-test');
    const [, init] = anthropicFetch.mock.calls[0];
    expect(init.headers['x-api-key']).toBe('sk-ant-test');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');

    const openaiFetch = mockFetchOnce({ data: [{ id: 'gpt-4o' }] });
    await fetchModels(PROVIDERS.openai, 'sk-test');
    expect(openaiFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer sk-test');
  });

  it('omits the auth header entirely when there is no key', async () => {
    // OpenRouter's catalog is public, so models are browsable before connecting.
    const fetchMock = mockFetchOnce({ data: [openRouterRow()] });
    await fetchModels(PROVIDERS.openrouter, '');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it('builds the catalog URL from an endpoint override without doubling slashes', async () => {
    const fetchMock = mockFetchOnce({ data: [] });
    await fetchModels(PROVIDERS.openrouter, '', 'https://proxy.internal/');
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.internal/v1/models');
  });

  it('throws on a failed catalog request so the caller can fall back', async () => {
    mockFetchOnce({ error: 'nope' }, false, 401);
    await expect(fetchModels(PROVIDERS.openrouter, 'bad')).rejects.toThrow(/401/);
  });

  it('skips malformed rows rather than failing the whole list', async () => {
    mockFetchOnce({ data: [openRouterRow(), { name: 'no id here' }, null] });
    const models = await fetchModels(PROVIDERS.openrouter, '');
    expect(models).toHaveLength(1);
  });
});

describe('visionCapable', () => {
  const models: ModelInfo[] = [
    { id: 'sees', label: 'sees', supportsImages: true },
    { id: 'blind', label: 'blind', supportsImages: false },
    { id: 'unknown', label: 'unknown' },
  ];

  it('drops only models known to be text-only', () => {
    expect(visionCapable(models).map((m) => m.id)).toEqual(['sees', 'unknown']);
  });

  it('keeps models of unknown capability', () => {
    // Absence of metadata is not evidence of absence of vision; hiding these
    // would empty the picker for providers that publish no modalities.
    expect(visionCapable([{ id: 'x', label: 'x' }])).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('scales per-token prices to per-million', () => {
    expect(formatPricing({ id: 'a', label: 'a', promptPrice: 0.00001, completionPrice: 0.00005 }))
      .toBe('$10.00 / M in · $50.00 / M out');
  });

  it('returns null when no pricing is published', () => {
    expect(formatPricing({ id: 'a', label: 'a' })).toBeNull();
  });

  it('renders context length in K and M', () => {
    expect(formatContext({ id: 'a', label: 'a', contextLength: 128_000 })).toBe('128K context');
    expect(formatContext({ id: 'a', label: 'a', contextLength: 1_000_000 })).toBe('1M context');
    expect(formatContext({ id: 'a', label: 'a' })).toBeNull();
  });
});
