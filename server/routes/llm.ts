import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { rateLimit } from '../middleware/rateLimit';
import db from '../db';

const router = Router();
router.use(requireAuth);
router.use(rateLimit({ windowMs: 60_000, max: 20, message: 'Too many AI requests. Please wait a moment.' }));

// Anthropic pricing (per token)
const INPUT_COST = 3 / 1_000_000;    // $3 per 1M input tokens
const OUTPUT_COST = 15 / 1_000_000;   // $15 per 1M output tokens
const DOLLARS_PER_CREDIT = 0.05;     // 1 credit = $0.05

function tokensToCredits(inputTokens: number, outputTokens: number): number {
  const cost = (inputTokens * INPUT_COST) + (outputTokens * OUTPUT_COST);
  return Math.max(1, Math.ceil(cost / DOLLARS_PER_CREDIT));
}

router.post('/chat', async (req, res) => {
  const user = req.user as any;

  // Check credits before making the call (need at least 1, and not expired)
  const dbUser = db.prepare('SELECT credits, credits_expire_at FROM users WHERE id = ?').get(user.id) as any;
  if (!dbUser || dbUser.credits <= 0) {
    return res.status(402).json({ error: 'No credits remaining. Purchase credits to use AI chat.' });
  }
  if (dbUser.credits_expire_at && new Date(dbUser.credits_expire_at) < new Date()) {
    // Expire the credits
    db.prepare('UPDATE users SET credits = 0, credits_expire_at = NULL WHERE id = ?').run(user.id);
    return res.status(402).json({ error: 'Your credits have expired. Purchase new credits to continue.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'AI service not configured' });
  }

  const { messages, systemPrompt } = req.body;
  if (!messages || !Array.isArray(messages)) {
    console.error('[llm] validation: messages not array', typeof messages);
    return res.status(400).json({ error: 'messages array required' });
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m.role || m.content === undefined || m.content === null) {
      console.error(`[llm] validation: msg[${i}] bad format`, { role: m.role, contentType: typeof m.content, hasContent: m.content !== undefined });
      return res.status(400).json({ error: `Invalid message format at index ${i}` });
    }
    if (!['user', 'assistant'].includes(m.role)) {
      console.error(`[llm] validation: msg[${i}] bad role: ${m.role}`);
      return res.status(400).json({ error: `Invalid message role: ${m.role}` });
    }
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: typeof systemPrompt === 'string' ? systemPrompt.slice(0, 50000) : '',
        messages: messages.slice(-50).map((m: any) => ({
          role: m.role,
          // Content can be a string or array of content blocks (text + images)
          content: typeof m.content === 'string' ? m.content.slice(0, 10000) : m.content,
        })),
      }),
    });

    if (!response.ok) {
      const status = response.status;
      console.error(`Anthropic API error: ${status}`, await response.text());
      if (status === 429) {
        return res.status(429).json({ error: 'AI service is busy. Please try again in a moment.' });
      }
      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';

    // Calculate actual cost from token usage
    const inputTokens = data.usage?.input_tokens || 0;
    const outputTokens = data.usage?.output_tokens || 0;
    const creditCost = tokensToCredits(inputTokens, outputTokens);

    // Deduct credits
    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(creditCost, user.id);
    const updated = db.prepare('SELECT credits FROM users WHERE id = ?').get(user.id) as any;

    console.log(`[llm] ${user.email}: ${inputTokens}in/${outputTokens}out = ${creditCost} credits. Balance: ${updated.credits}`);

    res.json({
      content,
      usage: {
        inputTokens,
        outputTokens,
        creditsUsed: creditCost,
        creditsRemaining: updated.credits,
      },
    });
  } catch (err: any) {
    console.error('LLM request failed:', err.message);
    res.status(502).json({ error: 'AI service temporarily unavailable' });
  }
});

export default router;
