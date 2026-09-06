import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SDFNodeUI } from '../types/operations';

/**
 * `chatStore.sendMessage` — the path from a typed prompt to a changed model.
 *
 * This had no coverage. `chatStore.settings.test.ts` covers persistence and the
 * v1 migration; `parseResponse.test.ts` covers the parser in isolation;
 * `llmService.test.ts` covers the wire. Nothing joined them up, and the join is
 * where the app's headline feature lives: build the system prompt, attach
 * viewport renders, stream, parse, and mutate the tree.
 *
 * Two bugs shipped in this area recently — settings unreachable without an
 * account, and an unset `max_tokens` — and both were found by a person using
 * the app rather than by the suite. Neither is the sort of thing these tests
 * would have caught, but the reason they got as far as a user is that nothing
 * here is exercised automatically at all.
 *
 * The network and the GPU are stubbed. `parseResponse` deliberately is not:
 * the point is to run real model-shaped replies through the real parser, since
 * a reply that does not parse is the most likely way this silently does
 * nothing.
 */

const streamLLMMessage = vi.fn();
const captureMultiView = vi.fn();

vi.mock('../llm/llmService', () => ({
  streamLLMMessage: (...args: unknown[]) => streamLLMMessage(...args),
  maxTokensFor: () => 4096,
  budgetMessages: (messages: unknown[]) => ({
    messages, approximateTokens: 100, imageCount: 0, trimmedMessages: 0,
  }),
}));

vi.mock('../engine/engineRef', () => ({
  getEngineRef: () => ({ captureMultiView: (...a: unknown[]) => captureMultiView(...a) }),
}));

/**
 * jsdom here provides no `localStorage`, so the store's persistence would
 * throw rather than no-op. The same in-memory stub `chatStore.settings.test.ts`
 * uses, so both suites see the same storage semantics.
 */
function makeStorageStub(): Storage {
  const cell = new Map<string, string>();
  return {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => { cell.set(k, String(v)); },
    removeItem: (k: string) => { cell.delete(k); },
    clear: () => cell.clear(),
    key: (i: number) => Array.from(cell.keys())[i] ?? null,
    get length() { return cell.size; },
  } as Storage;
}

vi.stubGlobal('localStorage', makeStorageStub());

const { useChatStore } = await import('./chatStore');
const { useModelerStore } = await import('./modelerStore');

/** A reply in the shape the system prompt asks for. */
const replaceWith = (kind: string, params: Record<string, number>) =>
  '```json\n' + JSON.stringify({
    action: 'replace',
    tree: { kind, params, children: [] },
  }) + '\n```';

/** Stream `chunks` to the token callback, then resolve with the whole text. */
function respondWith(chunks: string[]) {
  streamLLMMessage.mockImplementation(async (_req: unknown, onToken: (t: string) => void) => {
    for (const c of chunks) onToken(c);
    return chunks.join('');
  });
}

const messages = () => useChatStore.getState().messages;
const lastMessage = () => messages()[messages().length - 1];

describe('chatStore.sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureMultiView.mockReturnValue(null);
    vi.stubGlobal('localStorage', makeStorageStub());
    useChatStore.getState().switchConversation(`test:${crypto.randomUUID()}`);
    useChatStore.setState({
      messages: [], isLoading: false, pendingProposal: null, proposalError: null,
      requestEstimate: null, attachViewport: true, apiKey: 'k', provider: 'anthropic',
    });
    useModelerStore.getState().resetDocument(null, 'Untitled');
  });

  afterEach(() => {
    useModelerStore.setState({ tree: null });
  });

  it('previews a replace action and applies it only after confirmation', async () => {
    respondWith([replaceWith('sphere', { radius: 12 })]);

    await useChatStore.getState().sendMessage('make a ball');

    expect(streamLLMMessage).toHaveBeenCalledTimes(1);
    expect(useModelerStore.getState().tree).toBeNull();
    expect(useChatStore.getState().pendingProposal?.summary).toEqual(['Replace the model']);
    useChatStore.getState().applyProposal();
    const tree = useModelerStore.getState().tree!;
    expect(tree.kind).toBe('sphere');
    expect(tree.params.radius).toBe(12);
  });

  it('applies a multi-change proposal atomically as one undo entry', async () => {
    const base: SDFNodeUI = {
      id: 'u', kind: 'union', label: 'Union', params: { smooth: 0 }, enabled: true,
      children: [
        { id: 'a', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true },
        { id: 'b', kind: 'sphere', label: 'Sphere', params: { radius: 5 }, children: [], enabled: true },
      ],
    };
    useModelerStore.getState().resetDocument(base, 'Model');
    respondWith([JSON.stringify({ action: 'modify', changes: [
      { update: 'a', params: { width: 20 } },
      { update: 'b', params: { radius: 8 } },
    ] })]);

    await useChatStore.getState().sendMessage('resize both');
    expect(useModelerStore.getState().tree?.children[0].params.width).toBe(10);
    const beforeHistory = useModelerStore.getState().history.length;
    useChatStore.getState().applyProposal();
    expect(useModelerStore.getState().tree?.children[0].params.width).toBe(20);
    expect(useModelerStore.getState().tree?.children[1].params.radius).toBe(8);
    expect(useModelerStore.getState().history).toHaveLength(beforeHistory + 1);
  });

  it('rejects a mixed proposal entirely when a later operation is invalid', async () => {
    const base = { id: 'a', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(base, 'Model');
    respondWith([JSON.stringify({ action: 'modify', changes: [
      { update: 'a', params: { width: 20 } },
      { addChild: 'a', node: { kind: 'sphere', params: { radius: 2 }, children: [] } },
    ] })]);

    await useChatStore.getState().sendMessage('make invalid changes');

    expect(useModelerStore.getState().tree?.params.width).toBe(10);
    expect(useChatStore.getState().pendingProposal).toBeNull();
    expect(lastMessage().actionError).toMatch(/no empty child input/);
  });

  it('refuses to apply a proposal after the user edits its base model', async () => {
    const base = { id: 'a', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(base, 'Model');
    respondWith([JSON.stringify({ action: 'modify', changes: [{ update: 'a', params: { width: 20 } }] })]);
    await useChatStore.getState().sendMessage('resize it');
    useModelerStore.getState().updateNodeParams('a', { height: 30 });

    useChatStore.getState().applyProposal();

    expect(useModelerStore.getState().tree?.params.width).toBe(10);
    expect(useModelerStore.getState().tree?.params.height).toBe(30);
    expect(useChatStore.getState().proposalError).toMatch(/changed after/);
  });

  it('refuses a proposal after formula definitions change even when geometry is numerically equal', async () => {
    const base = { id: 'a', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 }, expressions: { width: 'w' }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(base, 'Model', [{ name: 'w', expression: '10', unit: 'mm' }]);
    respondWith([JSON.stringify({ action: 'modify', changes: [{ update: 'a', params: { height: 20 } }] })]);
    await useChatStore.getState().sendMessage('make it taller');
    useModelerStore.getState().setNamedParameters([{ name: 'w', expression: '5 + 5', unit: 'mm' }]);

    useChatStore.getState().applyProposal();

    expect(useModelerStore.getState().tree?.params.height).toBe(10);
    expect(useChatStore.getState().proposalError).toMatch(/changed after/);
  });

  it('treats an explicit AI numeric update as replacing that property formula', async () => {
    const base = { id: 'a', kind: 'box', label: 'Box', params: { width: 10, height: 10, depth: 10 }, expressions: { width: 'w' }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(base, 'Model', [{ name: 'w', expression: '10', unit: 'mm' }]);
    respondWith([JSON.stringify({ action: 'modify', changes: [{ update: 'a', params: { width: 20 } }] })]);
    await useChatStore.getState().sendMessage('set width literally to 20');
    useChatStore.getState().applyProposal();
    expect(useModelerStore.getState().tree?.params.width).toBe(20);
    expect(useModelerStore.getState().tree?.expressions).toBeUndefined();
  });

  it('streams tokens into the assistant message as they arrive', async () => {
    const seen: string[] = [];
    streamLLMMessage.mockImplementation(async (_req: unknown, onToken: (t: string) => void) => {
      for (const c of ['Here', ' you', ' go']) {
        onToken(c);
        seen.push(lastMessage().content);
      }
      return 'Here you go';
    });

    await useChatStore.getState().sendMessage('hi');

    // Each token was visible before the next arrived, which is what makes the
    // reply appear progressively rather than in one jump at the end.
    expect(seen).toEqual(['Here', 'Here you', 'Here you go']);
  });

  it('switches projects without carrying the previous transcript', () => {
    const projectA = useChatStore.getState().conversationKey;
    useChatStore.setState({ messages: [{ role: 'user', content: 'project A secret' }] });
    useChatStore.getState().switchConversation('project:b');
    expect(messages()).toEqual([]);
    useChatStore.setState({ messages: [{ role: 'user', content: 'project B' }] });
    useChatStore.getState().switchConversation(projectA);
    expect(messages()).toEqual([{ role: 'user', content: 'project A secret' }]);
  });

  it('stops a stream on project switch and ignores its late tokens', async () => {
    streamLLMMessage.mockImplementation((_req: { signal: AbortSignal }, onToken: (text: string) => void) =>
      new Promise((_resolve, reject) => {
        _req.signal.addEventListener('abort', () => {
          onToken('late token');
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }));
    const pending = useChatStore.getState().sendMessage('project A request');
    await vi.waitFor(() => expect(useChatStore.getState().isLoading).toBe(true));

    useChatStore.getState().switchConversation('project:b');
    await pending;

    expect(messages()).toEqual([]);
    expect(useChatStore.getState().isLoading).toBe(false);
  });

  it('stops generation and leaves the request retryable', async () => {
    streamLLMMessage.mockImplementationOnce((req: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => req.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))));
    const pending = useChatStore.getState().sendMessage('try this');
    await vi.waitFor(() => expect(useChatStore.getState().isLoading).toBe(true));
    useChatStore.getState().stopGeneration();
    await pending;
    expect(lastMessage().content).toMatch(/stopped/i);
    expect(lastMessage().parseFailed).toBe(true);

    respondWith([replaceWith('sphere', { radius: 3 })]);
    await useChatStore.getState().retryLast();
    expect(useChatStore.getState().pendingProposal?.tree?.kind).toBe('sphere');
  });

  /**
   * A model that answers in prose instead of JSON must be *flagged*, not
   * silently ignored. Without `parseFailed` the user sees a friendly reply and
   * an unchanged model, with nothing to indicate the two are related.
   */
  it('flags a reply it could not parse, and leaves the tree alone', async () => {
    useModelerStore.setState({ tree: { id: 'keep', kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true } });
    respondWith(['I would suggest starting with a cylinder.']);

    await useChatStore.getState().sendMessage('advise me');

    expect(lastMessage().parseFailed).toBe(true);
    expect(useModelerStore.getState().tree!.id).toBe('keep');
  });

  it('does not flag a reply that parsed', async () => {
    respondWith([replaceWith('box', { width: 5, height: 5, depth: 5 })]);
    await useChatStore.getState().sendMessage('a cube');
    expect(lastMessage().parseFailed).toBeUndefined();
  });

  it('clears the loading flag on success', async () => {
    respondWith([replaceWith('sphere', { radius: 4 })]);
    await useChatStore.getState().sendMessage('ball');
    expect(useChatStore.getState().isLoading).toBe(false);
  });

  describe('without a credential', () => {
    it('does not call the model, and says how to fix it', async () => {
      useChatStore.setState({ apiKey: '', provider: 'anthropic' });

      await useChatStore.getState().sendMessage('hello');

      expect(streamLLMMessage).not.toHaveBeenCalled();
      expect(lastMessage().content).toMatch(/API key/i);
    });

    /**
     * An OAuth provider has no key to paste, so telling someone to configure
     * one sends them looking for something that does not exist.
     */
    it('tells an OAuth provider to connect rather than to paste a key', async () => {
      useChatStore.setState({ apiKey: '', provider: 'openrouter' });

      await useChatStore.getState().sendMessage('hello');

      expect(lastMessage().content).toMatch(/Connect OpenRouter/i);
      expect(lastMessage().content).not.toMatch(/API key/i);
    });
  });

  describe('when the model call fails', () => {
    it('replaces the empty placeholder rather than leaving a blank message', async () => {
      streamLLMMessage.mockRejectedValue(new Error('OpenRouter API error (402): out of credit'));

      await useChatStore.getState().sendMessage('hi');

      // One user message and one assistant message — not an empty placeholder
      // followed by a separate error.
      expect(messages()).toHaveLength(2);
      expect(lastMessage().role).toBe('assistant');
      expect(lastMessage().content).toContain('402');
      expect(useChatStore.getState().isLoading).toBe(false);
    });

    it('leaves the tree untouched', async () => {
      useModelerStore.setState({ tree: { id: 'keep', kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true } });
      streamLLMMessage.mockRejectedValue(new Error('network down'));

      await useChatStore.getState().sendMessage('change it');

      expect(useModelerStore.getState().tree!.id).toBe('keep');
    });
  });

  describe('viewport context', () => {
    it('attaches renders and describes them when there is a model to look at', async () => {
      useModelerStore.setState({ tree: { id: 'b', kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true } });
      captureMultiView.mockReturnValue({ images: ['data:image/webp;base64,AAA'], description: 'Model bounding box: 1 x 1 x 1 mm.' });
      respondWith([replaceWith('sphere', { radius: 2 })]);

      await useChatStore.getState().sendMessage('make it round');

      const sent = streamLLMMessage.mock.calls[0][0] as { messages: { content: string; images?: string[] }[] };
      const user = sent.messages[sent.messages.length - 1];
      expect(user.images).toEqual(['data:image/webp;base64,AAA']);
      // The description is prepended so the model knows what the images are;
      // without it they arrive as unexplained pictures.
      expect(user.content).toContain('Model bounding box');
      expect(user.content).toContain('make it round');
    });

    it('sends no renders when there is nothing modelled yet', async () => {
      respondWith([replaceWith('sphere', { radius: 2 })]);

      await useChatStore.getState().sendMessage('start me off');

      expect(captureMultiView).not.toHaveBeenCalled();
      const sent = streamLLMMessage.mock.calls[0][0] as { messages: { images?: string[] }[] };
      expect(sent.messages[sent.messages.length - 1].images).toBeUndefined();
    });

    it('lets the user disable viewport attachments for a request', async () => {
      useModelerStore.setState({ tree: { id: 'b', kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true } });
      useChatStore.setState({ attachViewport: false });
      respondWith([replaceWith('sphere', { radius: 2 })]);
      await useChatStore.getState().sendMessage('no images');
      expect(captureMultiView).not.toHaveBeenCalled();
      expect(useChatStore.getState().requestEstimate?.imageCount).toBe(0);
    });
  });

  /**
   * Images are stripped before persisting: four base64 webp renders per turn
   * would fill the localStorage quota within a handful of messages, and losing
   * the whole history to a quota error is worse than losing the thumbnails.
   */
  it('persists the transcript without the attached images', async () => {
    useModelerStore.setState({ tree: { id: 'b', kind: 'box', label: 'Box', params: { width: 1, height: 1, depth: 1 }, children: [], enabled: true } });
    captureMultiView.mockReturnValue({ images: ['data:image/webp;base64,AAA'], description: 'd' });
    respondWith([replaceWith('sphere', { radius: 2 })]);

    await useChatStore.getState().sendMessage('hello');

    const saved = localStorage.getItem('sinter_chat_messages')!;
    expect(saved).toBeTruthy();
    expect(saved).not.toContain('base64');
    const persisted = JSON.parse(saved);
    expect(persisted.version).toBe(2);
    expect(persisted.conversations[useChatStore.getState().conversationKey]).toHaveLength(2);
  });
});
