import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamLLMMessage, inferThinkingSupport, LLMAuthError } from './llmService';
import type { ChatMessage } from '../store/chatStore';

/** A Response whose body streams the given SSE frames. */
function sseResponse(frames: string[], ok = true, status = 200) {
  const encoder = new TextEncoder();
  return {
    ok,
    status,
    text: async () => frames.join(''),
    body: {
      getReader() {
        let i = 0;
        return {
          read: async () =>
            i < frames.length
              ? { done: false, value: encoder.encode(frames[i++]) }
              : { done: true, value: undefined },
        };
      },
    },
  };
}

function mockFetch(response: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const messages: ChatMessage[] = [{ role: 'user', content: 'make a box' }];

afterEach(() => vi.unstubAllGlobals());

describe('inferThinkingSupport', () => {
  it('matches bare Anthropic ids', () => {
    expect(inferThinkingSupport('claude-opus-4-7')).toBe(true);
    expect(inferThinkingSupport('claude-sonnet-4-5')).toBe(true);
  });

  it('matches namespaced aggregator ids', () => {
    // The previous regex tested the full id, so a namespaced id never matched
    // and extended thinking silently never engaged on OpenRouter.
    expect(inferThinkingSupport('anthropic/claude-opus-5')).toBe(true);
    expect(inferThinkingSupport('anthropic/claude-sonnet-5')).toBe(true);
  });

  it('does not match unrelated or older models', () => {
    expect(inferThinkingSupport('gpt-4o')).toBe(false);
    expect(inferThinkingSupport('openai/gpt-4o')).toBe(false);
    expect(inferThinkingSupport('claude-3-5-sonnet')).toBe(false);
  });
});

describe('provider dispatch', () => {
  it('routes anthropic over the Anthropic wire', async () => {
    const fetchMock = mockFetch(sseResponse([
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}\n\n',
    ]));

    const text = await streamLLMMessage(
      { systemPrompt: 'sp', messages, apiKey: 'sk-ant', provider: 'anthropic', model: 'claude-opus-4-7' },
      () => {},
    );

    expect(text).toBe('hi');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant');
  });

  it('routes openrouter over the OpenAI wire at its own endpoint', async () => {
    const fetchMock = mockFetch(sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));

    const text = await streamLLMMessage(
      { systemPrompt: 'sp', messages, apiKey: 'sk-or', provider: 'openrouter', model: 'anthropic/claude-opus-5' },
      () => {},
    );

    expect(text).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-or');
    expect(JSON.parse(init.body).model).toBe('anthropic/claude-opus-5');
  });

  it('honours an endpoint override', async () => {
    const fetchMock = mockFetch(sseResponse(['data: [DONE]\n\n']));
    await streamLLMMessage(
      { systemPrompt: 'sp', messages, apiKey: 'k', provider: 'openai', apiEndpoint: 'https://proxy.internal/' },
      () => {},
    );
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.internal/v1/chat/completions');
  });

  it('falls back to the registry default for an unknown provider', async () => {
    const fetchMock = mockFetch(sseResponse(['data: [DONE]\n\n']));
    await streamLLMMessage(
      { systemPrompt: 'sp', messages, apiKey: 'k', provider: 'legacy-value' as never },
      () => {},
    );
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
  });
});

describe('extended thinking', () => {
  it('prefers the catalog capability over the id heuristic', async () => {
    const fetchMock = mockFetch(sseResponse(['data: [DONE]\n\n']));
    // A model the heuristic would reject, which the catalog says can think.
    await streamLLMMessage(
      { systemPrompt: 'sp', messages, apiKey: 'k', provider: 'anthropic', model: 'some-new-model', supportsThinking: true },
      () => {},
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.max_tokens).toBe(16000);
  });

  it('honours a catalog that says the model cannot think', async () => {
    const fetchMock = mockFetch(sseResponse(['data: [DONE]\n\n']));
    await streamLLMMessage(
      { systemPrompt: 'sp', messages, apiKey: 'k', provider: 'anthropic', model: 'claude-opus-4-7', supportsThinking: false },
      () => {},
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(4096);
  });
});

describe('errors', () => {
  it('raises a distinct auth error on 401 and names the fix', async () => {
    mockFetch(sseResponse(['unauthorized'], false, 401));
    const err = await streamLLMMessage(
      { systemPrompt: 'sp', messages, apiKey: 'bad', provider: 'openrouter' },
      () => {},
    ).catch((e) => e);

    expect(err).toBeInstanceOf(LLMAuthError);
    // OAuth providers get "reconnect", key providers get "check the key".
    expect(err.message).toMatch(/Reconnect OpenRouter/);
  });

  it('tells key-based providers to check the key', async () => {
    mockFetch(sseResponse(['unauthorized'], false, 401));
    const err = await streamLLMMessage(
      { systemPrompt: 'sp', messages, apiKey: 'bad', provider: 'anthropic' },
      () => {},
    ).catch((e) => e);
    expect(err.message).toMatch(/rejected the API key/);
  });

  it('surfaces a non-auth failure with the provider label', async () => {
    mockFetch(sseResponse(['boom'], false, 500));
    await expect(
      streamLLMMessage({ systemPrompt: 'sp', messages, apiKey: 'k', provider: 'openai' }, () => {}),
    ).rejects.toThrow(/OpenAI API error \(500\)/);
  });

  it('catches an error delivered in-band on a 200 stream', async () => {
    // Aggregators report upstream failures mid-stream; without this the run
    // ends silently with empty text and looks like a successful no-op.
    mockFetch(sseResponse(['data: {"error":{"message":"upstream is down"}}\n\n']));
    await expect(
      streamLLMMessage({ systemPrompt: 'sp', messages, apiKey: 'k', provider: 'openrouter' }, () => {}),
    ).rejects.toThrow(/upstream is down/);
  });

  it('asks OAuth providers to connect when no credential is present', async () => {
    await expect(
      streamLLMMessage({ systemPrompt: 'sp', messages, provider: 'openrouter' }, () => {}),
    ).rejects.toThrow(/Connect OpenRouter/);
  });

  it('asks key providers for an API key when none is present', async () => {
    await expect(
      streamLLMMessage({ systemPrompt: 'sp', messages, provider: 'anthropic' }, () => {}),
    ).rejects.toThrow(/API key required/);
  });
});
