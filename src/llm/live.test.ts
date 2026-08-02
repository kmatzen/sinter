import { describe, it, expect } from 'vitest';
import { streamLLMMessage } from './llmService';
import { buildSystemPrompt } from './systemPrompt';
import { parseResponse } from './parseResponse';
import { getProvider, isProviderId } from './providers';
import { toSDFNode } from '../worker/sdf/convert';
import { computeBounds } from '../worker/sdf/bounds';
import { evaluateSDF } from '../worker/sdf/evaluate';
import type { SDFNodeUI } from '../types/operations';

/**
 * The one path nothing else covers: a real model, over the real wire, producing
 * geometry.
 *
 * Everything between a typed prompt and a changed model is already tested in
 * pieces — `llmService.test.ts` for the wire, `parseResponse.test.ts` for the
 * parser, `chatStore.send.test.ts` for the join with both stubbed. All of that
 * can be green while the headline feature does not work, because none of it
 * asks the question that matters: does a model, given *this* system prompt,
 * actually answer in a form this app can turn into a solid?
 *
 * Two bugs this year shipped in exactly that gap — settings unreachable without
 * an account, and an unset `max_tokens` — and both were found by a person using
 * the app rather than by the suite.
 *
 * So this asserts on evaluated geometry rather than on JSON shape. A reply can
 * parse perfectly and still describe nothing, or describe a shape nowhere near
 * what was asked for; bounds and field samples are what distinguish "the wire
 * works" from "the feature works".
 *
 * Skipped unless `SINTER_LIVE_API_KEY` is set, because it costs real money and
 * hits a real network. That is an opt-in, not a default:
 *
 *   SINTER_LIVE_API_KEY=sk-... npm run test:live
 *
 *   SINTER_LIVE_PROVIDER   anthropic | openai | openrouter   (default: openrouter)
 *   SINTER_LIVE_MODEL      overrides the provider's default model
 *
 * These are live-model assertions, so they are written against *capability*,
 * not exact output: that a cube asked for in millimetres comes back the size
 * requested, not that two models phrase the tree the same way. A failure here
 * means the feature is broken for a real user, which is the only reason to
 * spend money on a test.
 */

const API_KEY = process.env.SINTER_LIVE_API_KEY;
const PROVIDER_ENV = process.env.SINTER_LIVE_PROVIDER ?? 'openrouter';
const PROVIDER = isProviderId(PROVIDER_ENV) ? PROVIDER_ENV : 'openrouter';
const MODEL = process.env.SINTER_LIVE_MODEL || getProvider(PROVIDER).defaultModel;

/** One turn through the real send path, minus the store and the viewport. */
async function ask(prompt: string, currentTree: SDFNodeUI | null = null) {
  const text = await streamLLMMessage(
    {
      systemPrompt: buildSystemPrompt(currentTree),
      messages: [{ role: 'user', content: prompt }],
      apiKey: API_KEY,
      model: MODEL,
      provider: PROVIDER,
    },
    () => {},
  );
  return { text, parsed: parseResponse(text) };
}

/** Size of a tree's axis-aligned bounds, in millimetres. */
function sizeOf(ui: SDFNodeUI): [number, number, number] {
  const node = toSDFNode(ui);
  expect(node, 'the tree converted to nothing evaluable').not.toBeNull();
  const b = computeBounds(node!);
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

describe.skipIf(!API_KEY)(`live model (${PROVIDER} / ${MODEL})`, () => {
  /**
   * The falsifiable one. "20 mm cube" has exactly one right answer, so this
   * catches a model that returns well-formed JSON describing the wrong thing —
   * and it catches the app sending a prompt that fails to establish that units
   * are millimetres, which is the single most likely way this feature is subtly
   * wrong rather than obviously broken.
   */
  it('turns a request for a 20 mm cube into a 20 mm cube', async () => {
    const { text, parsed } = await ask('Make a 20mm cube.');

    expect(parsed, `model replied with no usable JSON:\n${text.slice(0, 600)}`).not.toBeNull();
    expect(parsed!.action).toBe('replace');

    const size = sizeOf((parsed as { tree: SDFNodeUI }).tree);
    for (const s of size) expect(s).toBeCloseTo(20, 0);
  });

  /**
   * A tree that converts is not the same as a tree with a solid in it. An empty
   * union, a subtraction that removes everything, or a shape built at the wrong
   * scale all convert fine and all export an empty STL. Sampling the field at
   * the centre is the cheapest honest check that something is actually there.
   */
  it('produces a solid, not just a well-formed tree', async () => {
    const { text, parsed } = await ask('Design a simple L-shaped wall bracket about 60mm tall.');

    expect(parsed, `model replied with no usable JSON:\n${text.slice(0, 600)}`).not.toBeNull();
    expect(parsed!.action).toBe('replace');

    const tree = (parsed as { tree: SDFNodeUI }).tree;
    const node = toSDFNode(tree)!;
    const b = computeBounds(node);

    // Something printable: not a speck, not a kilometre.
    const size = sizeOf(tree);
    for (const s of size) {
      expect(s).toBeGreaterThan(1);
      expect(s).toBeLessThan(1000);
    }

    // At least one sample inside the bounds is inside the solid. A grid rather
    // than the centre alone, because an L-bracket's centre is fresh air.
    let insideCount = 0;
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        for (let k = 0; k < 5; k++) {
          const p: [number, number, number] = [
            b.min[0] + ((i + 0.5) / 5) * (b.max[0] - b.min[0]),
            b.min[1] + ((j + 0.5) / 5) * (b.max[1] - b.min[1]),
            b.min[2] + ((k + 0.5) / 5) * (b.max[2] - b.min[2]),
          ];
          if (evaluateSDF(node, p) < 0) insideCount++;
        }
      }
    }
    expect(insideCount, 'the tree evaluates to empty space everywhere inside its own bounds')
      .toBeGreaterThan(0);
  });

  /**
   * The second turn. Editing an existing model is most of what the feature is
   * for, and it exercises the branch of the system prompt that serialises the
   * current tree — a branch the first-turn tests never reach.
   */
  it('edits the model it is given rather than starting over', async () => {
    const existing: SDFNodeUI = {
      id: 'root', kind: 'box', label: 'Box',
      params: { width: 20, height: 20, depth: 20 },
      children: [], enabled: true,
    };

    const { text, parsed } = await ask('Make it 40mm wide. Leave the other dimensions alone.', existing);
    expect(parsed, `model replied with no usable JSON:\n${text.slice(0, 600)}`).not.toBeNull();

    if (parsed!.action === 'modify') {
      // A modify action names the node and the new params; the store applies it.
      const widths = parsed!.changes.flatMap((c) => Object.entries(c.params))
        .filter(([k]) => k === 'width').map(([, v]) => v);
      expect(widths, `no width in changes: ${JSON.stringify(parsed!.changes)}`).toContain(40);
    } else {
      const [x, , z] = sizeOf(parsed!.tree);
      expect(x).toBeCloseTo(40, 0);
      // The untouched axis stayed put — a model that rebuilds from scratch and
      // silently rescales everything is a worse outcome than one that refuses.
      expect(z).toBeCloseTo(20, 0);
    }
  });
});
