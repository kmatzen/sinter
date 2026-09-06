import type { ChatMessage } from '../store/chatStore';
import type { ProviderDef, ProviderId } from './providers';
import { getProvider, resolveEndpoint } from './providers';

interface LLMRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  apiKey?: string;
  apiEndpoint?: string;
  model?: string;
  provider?: ProviderId;
  /**
   * Whether the selected model advertises extended thinking, taken from the
   * provider catalog. Undefined means the catalog said nothing and we fall
   * back to inferring from the model id.
   */
  supportsThinking?: boolean;
  signal?: AbortSignal;
}

export interface ContextEstimate {
  messages: ChatMessage[];
  approximateTokens: number;
  imageCount: number;
  trimmedMessages: number;
}

/** Predictable character/image budget with room reserved for the reply. */
export function budgetMessages(
  messages: ChatMessage[], systemPrompt: string, contextTokens: number, outputTokens: number,
): ContextEstimate {
  messages = stripOldImages(messages);
  const budget = Math.max(4_000, contextTokens - outputTokens);
  const cost = (message: ChatMessage) => Math.ceil(message.content.length / 4) + (message.images?.length ?? 0) * 1_000 + 8;
  const systemCost = Math.ceil(systemPrompt.length / 4) + 16;
  const kept: ChatMessage[] = [];
  let used = systemCost;
  for (let i = messages.length - 1; i >= 0; i--) {
    let message = messages[i];
    let next = cost(message);
    if (kept.length === 0 && used + next > budget) {
      const imageCost = (message.images?.length ?? 0) * 1_000 + 8;
      const marker = '\n[message truncated to fit model context]';
      const availableChars = Math.max(0, (budget - used - imageCost) * 4 - marker.length);
      message = { ...message, content: `${message.content.slice(0, availableChars)}${marker}` };
      next = cost(message);
    } else if (used + next > budget) break;
    kept.unshift(message);
    used += next;
  }
  return {
    messages: kept,
    approximateTokens: used,
    imageCount: kept.reduce((total, message) => total + (message.images?.length ?? 0), 0),
    trimmedMessages: messages.length - kept.length,
  };
}

/** Convert a ChatMessage to Anthropic's content block format (text + images) */
function toAnthropicContent(msg: ChatMessage): any {
  if (!msg.images?.length) return msg.content;
  const blocks: any[] = [];
  for (const dataUrl of msg.images) {
    // Extract base64 from data URL: "data:image/png;base64,..."
    const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (match) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: match[1], data: match[2] },
      });
    }
  }
  blocks.push({ type: 'text', text: msg.content });
  return blocks;
}

/** Convert a ChatMessage to OpenAI's content format (text + image_url) */
function toOpenAIContent(msg: ChatMessage): any {
  if (!msg.images?.length) return msg.content;
  const parts: any[] = [];
  for (const dataUrl of msg.images) {
    parts.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'low' } });
  }
  parts.push({ type: 'text', text: msg.content });
  return parts;
}

/** Only keep images on the last user message to avoid bloating the payload */
function stripOldImages(messages: ChatMessage[]): ChatMessage[] {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') { lastUserIdx = i; break; }
  }
  return messages.map((m, i) =>
    m.images && i !== lastUserIdx ? { ...m, images: undefined } : m
  );
}

/**
 * Last-resort guess at extended thinking support, used only when the provider
 * published no capability metadata. Aggregator ids are namespaced
 * ("anthropic/claude-opus-5"), so the vendor prefix is stripped first —
 * matching against the full id silently never fires.
 */
export function inferThinkingSupport(model: string): boolean {
  const bare = model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model;
  return /^claude-(opus|sonnet)-(?:[4-9]|\d{2,})/i.test(bare);
}

function resolveThinking(req: LLMRequest, model: string): boolean {
  return req.supportsThinking ?? inferThinkingSupport(model);
}

/**
 * A provider rejected the credential. Surfaced distinctly so the UI can tell
 * the user to reconnect rather than showing a bare 401.
 */
export class LLMAuthError extends Error {
  constructor(readonly provider: ProviderDef, readonly status: number, detail: string) {
    super(
      provider.auth === 'oauth-pkce'
        ? `${provider.label} rejected the connection (${status}). Reconnect ${provider.label} in settings.${detail ? ` ${detail}` : ''}`
        : `${provider.label} rejected the API key (${status}). Check the key in settings.${detail ? ` ${detail}` : ''}`,
    );
    this.name = 'LLMAuthError';
  }
}

/**
 * Output-token budget for a request.
 *
 * One number, both wire formats. The reply is an SDF tree as JSON plus a
 * sentence of explanation — a few hundred tokens for anything typical — so
 * these are already generous; the ceiling exists to stop a provider reserving
 * its model's entire output window against the user's balance.
 */
export function maxTokensFor(req: LLMRequest, model: string): number {
  return resolveThinking(req, model) ? 16000 : 4096;
}

/**
 * A 402 means the provider would not start the request, and its own body says
 * why far better than a generic message would — but it arrives as several
 * kilobytes of nested JSON with the same sentence repeated five times in
 * `previous_errors`. Surfacing the message and dropping the rest is the
 * difference between an actionable error and a wall of text.
 */
function conciseDetail(status: number, detail: string): string {
  if (status !== 402) return detail;
  try {
    const parsed = JSON.parse(detail);
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message) return message;
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return detail;
}

async function raiseForStatus(res: Response, provider: ProviderDef): Promise<never> {
  const detail = await res.text().catch(() => '');
  if (res.status === 401 || res.status === 403) {
    throw new LLMAuthError(provider, res.status, detail.slice(0, 200));
  }
  throw new Error(`${provider.label} API error (${res.status}): ${conciseDetail(res.status, detail)}`);
}

/**
 * Stream an LLM response, calling onToken with each text chunk as it arrives.
 * Returns the full response text when complete.
 */
export async function streamLLMMessage(
  req: LLMRequest,
  onToken: (text: string) => void,
): Promise<string> {
  req = { ...req, messages: stripOldImages(req.messages) };
  const provider = getProvider(req.provider);
  if (!req.apiKey) {
    throw new Error(
      provider.auth === 'oauth-pkce'
        ? `Connect ${provider.label} in the settings to use AI chat.`
        : 'API key required. Configure it in the settings.',
    );
  }

  return provider.wire === 'anthropic'
    ? streamAnthropic(req, provider, onToken)
    : streamOpenAI(req, provider, onToken);
}

/** Parse an SSE stream, yielding {event, data} for each complete event. */
async function* parseSSE(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentData = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    // Keep the last potentially incomplete line in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim();
      } else if (line.startsWith('data: ')) {
        currentData += line.slice(6);
      } else if (line === '') {
        // Empty line = end of event
        if (currentData) {
          yield { event: currentEvent, data: currentData };
        }
        currentEvent = '';
        currentData = '';
      }
    }
  }
  // Flush any remaining event
  if (currentData) {
    yield { event: currentEvent, data: currentData };
  }
}

async function streamAnthropic(
  req: LLMRequest,
  provider: ProviderDef,
  onToken: (text: string) => void,
): Promise<string> {
  const endpoint = resolveEndpoint(provider, req.apiEndpoint);
  const model = req.model || provider.defaultModel;
  const useThinking = resolveThinking(req, model);

  const body: any = {
    model,
    max_tokens: maxTokensFor(req, model),
    stream: true,
    messages: req.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m) })),
  };

  body.system = req.systemPrompt;
  if (useThinking) {
    body.thinking = { type: 'adaptive' };
    body.output_config = { effort: 'max' };
    body.temperature = 1;
  }

  const response = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.apiKey!,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });

  if (!response.ok) await raiseForStatus(response, provider);

  const reader = response.body!.getReader();
  let fullText = '';

  for await (const { event, data } of parseSSE(reader)) {
    if (event === 'error') {
      let msg = data;
      try { msg = JSON.parse(data).error?.message || data; } catch {}
      throw new Error(`${provider.label} stream error: ${msg}`);
    }
    if (data === '[DONE]') break;

    let parsed: any;
    try { parsed = JSON.parse(data); } catch { continue; }

    // Stream only text deltas (skip thinking deltas)
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      const text = parsed.delta.text;
      fullText += text;
      onToken(text);
    }
  }

  return fullText;
}

/**
 * OpenAI-compatible streaming. Also serves OpenRouter, which normalises to
 * this schema — the only differences are the endpoint and the optional
 * attribution headers below.
 */
async function streamOpenAI(
  req: LLMRequest,
  provider: ProviderDef,
  onToken: (text: string) => void,
): Promise<string> {
  const endpoint = resolveEndpoint(provider, req.apiEndpoint);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${req.apiKey}`,
  };
  if (provider.id === 'openrouter' && typeof window !== 'undefined') {
    // Optional attribution; OpenRouter uses these for its public rankings.
    headers['HTTP-Referer'] = window.location.origin;
    headers['X-Title'] = 'Sinter';
  }

  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: req.model || provider.defaultModel,
      stream: true,
      // Omitting this is not "no limit" — it is "the model's limit". OpenRouter
      // reserves credit against `max_tokens` up front, so an unset value made
      // it reserve the model's full output window (65536 on some) and reject
      // the request outright with a 402 for anyone whose balance could not
      // cover a reservation they were never going to spend.
      //
      // The Anthropic path has always capped this. The asymmetry arrived with
      // the provider registry and went unnoticed because a direct OpenAI or
      // Anthropic key is usually attached to an account with real credit —
      // whereas OpenRouter is the provider people reach for precisely to try
      // it with a few dollars.
      max_tokens: maxTokensFor(req, req.model || provider.defaultModel),
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...req.messages.map((m) => ({ role: m.role, content: toOpenAIContent(m) })),
      ],
    }),
    signal: req.signal,
  });

  if (!response.ok) await raiseForStatus(response, provider);

  const reader = response.body!.getReader();
  let fullText = '';

  for await (const { data } of parseSSE(reader)) {
    if (data === '[DONE]') break;

    let parsed: any;
    try { parsed = JSON.parse(data); } catch { continue; }

    // An error can arrive in-band on a 200 stream (a mid-stream upstream
    // failure at the aggregator), so it has to be caught here too.
    if (parsed.error) {
      throw new Error(`${provider.label} stream error: ${parsed.error.message || 'unknown error'}`);
    }

    const text = parsed.choices?.[0]?.delta?.content;
    if (text) {
      fullText += text;
      onToken(text);
    }
  }

  return fullText;
}
