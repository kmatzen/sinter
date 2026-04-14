import type { ChatMessage } from '../store/chatStore';
import { features } from '../config';

interface LLMRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  // Community mode fields (BYOK)
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

export async function sendLLMMessage(req: LLMRequest): Promise<string> {
  req = { ...req, messages: stripOldImages(req.messages) };
  if (features.serverLLM) {
    return sendViaServer(req);
  }
  return sendDirect(req);
}

// Paid edition: proxy through our server
async function sendViaServer(req: LLMRequest): Promise<string> {
  const response = await fetch('/api/llm/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      systemPrompt: req.systemPrompt,
      messages: req.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m) })),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    let errMsg: string;
    try {
      errMsg = JSON.parse(text).error;
    } catch {
      errMsg = text || response.statusText;
    }
    throw new Error(errMsg || `Server error (${response.status})`);
  }

  const data = await response.json();
  // Dispatch usage info for the credit badge
  if (data.usage) {
    window.dispatchEvent(new CustomEvent('credits-updated', { detail: data.usage }));
  }
  return data.content || '';
}

// Community edition: direct API call with user's key
async function sendDirect(req: LLMRequest): Promise<string> {
  if (!req.apiKey) throw new Error('API key required. Configure it in the settings.');

  if (req.provider === 'openai') {
    return sendOpenAI(req);
  }
  return sendAnthropic(req);
}

async function sendAnthropic(req: LLMRequest): Promise<string> {
  const endpoint = req.apiEndpoint || 'https://api.anthropic.com';
  const response = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.apiKey!,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: req.model || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({ role: m.role, content: toAnthropicContent(m) })),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.content?.[0]?.text || '';
}

async function sendOpenAI(req: LLMRequest): Promise<string> {
  const endpoint = req.apiEndpoint || 'https://api.openai.com';
  const response = await fetch(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify({
      model: req.model || 'gpt-4o',
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

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}
