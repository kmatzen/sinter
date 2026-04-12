import type { ChatMessage } from '../store/chatStore';

interface LLMRequest {
  systemPrompt: string;
  messages: ChatMessage[];
  apiEndpoint: string;
  apiKey: string;
  model: string;
  provider: 'openai' | 'anthropic';
}

export async function sendLLMMessage(req: LLMRequest): Promise<string> {
  if (req.provider === 'anthropic') {
    return sendAnthropic(req);
  }
  return sendOpenAI(req);
}

async function sendAnthropic(req: LLMRequest): Promise<string> {
  const endpoint = req.apiEndpoint || 'https://api.anthropic.com';
  const response = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: 4096,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
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
      model: req.model,
      messages: [
        { role: 'system', content: req.systemPrompt },
        ...req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
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
