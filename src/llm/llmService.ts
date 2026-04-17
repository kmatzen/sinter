import type { ChatMessage } from '../store/chatStore';

interface LLMRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  apiKey?: string;
  apiEndpoint?: string;
  model?: string;
  provider?: 'openai' | 'anthropic';
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

/** Check if a model supports extended thinking */
function supportsExtendedThinking(model: string): boolean {
  // Claude 4.5 and 4.6+ models support extended thinking
  return /claude-(opus|sonnet)-4/i.test(model);
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
  if (!req.apiKey) throw new Error('API key required. Configure it in the settings.');

  if (req.provider === 'openai') {
    return streamOpenAI(req, onToken);
  }
  return streamAnthropic(req, onToken);
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

async function streamAnthropic(req: LLMRequest, onToken: (text: string) => void): Promise<string> {
  const endpoint = req.apiEndpoint || 'https://api.anthropic.com';
  const model = req.model || 'claude-opus-4-7';
  const useThinking = supportsExtendedThinking(model);

  const body: any = {
    model,
    max_tokens: useThinking ? 16000 : 4096,
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
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err}`);
  }

  const reader = response.body!.getReader();
  let fullText = '';

  for await (const { event, data } of parseSSE(reader)) {
    if (event === 'error') {
      let msg = data;
      try { msg = JSON.parse(data).error?.message || data; } catch {}
      throw new Error(`Anthropic stream error: ${msg}`);
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

async function streamOpenAI(req: LLMRequest, onToken: (text: string) => void): Promise<string> {
  const endpoint = req.apiEndpoint || 'https://api.openai.com';
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model || 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...req.messages.map((m) => ({ role: m.role, content: toOpenAIContent(m) })),
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error (${response.status}): ${err}`);
  }

  const reader = response.body!.getReader();
  let fullText = '';

  for await (const { data } of parseSSE(reader)) {
    if (data === '[DONE]') break;

    let parsed: any;
    try { parsed = JSON.parse(data); } catch { continue; }

    const text = parsed.choices?.[0]?.delta?.content;
    if (text) {
      fullText += text;
      onToken(text);
    }
  }

  return fullText;
}
