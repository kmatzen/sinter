import { create } from 'zustand';
import { streamLLMMessage } from '../llm/llmService';
import { buildSystemPrompt } from '../llm/systemPrompt';
import { parseResponse } from '../llm/parseResponse';
import { useModelerStore } from './modelerStore';
import { getEngineRef } from '../engine/engineRef';
import { decodeTree } from '../types/documentDecoder';
import { ensureConsent, hasConsent } from './consent';
import type { ProviderId } from '../llm/providers';
import { getProvider, isProviderId, PROVIDER_IDS } from '../llm/providers';
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Base64 PNG data URLs of viewport renders, attached to user messages */
  images?: string[];
  /** Set on assistant messages when the response couldn't be parsed into a model action */
  parseFailed?: boolean;
}

/** Per-provider settings, so switching providers does not discard credentials. */
export interface ProviderSettings {
  apiKey: string;
  apiEndpoint: string;
  model: string;
  /** Capability of `model`, as advertised by the provider catalog. */
  supportsThinking?: boolean;
}

export interface ApiConfigUpdate {
  apiKey?: string;
  apiEndpoint?: string;
  model?: string;
  provider?: ProviderId;
  supportsThinking?: boolean;
}

interface ChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  isLoading: boolean;

  /** Active provider's settings, mirrored flat for convenience. */
  apiKey: string;
  apiEndpoint: string;
  model: string;
  supportsThinking?: boolean;
  provider: ProviderId;
  /** Every provider's saved settings, keyed by id. */
  byProvider: Record<ProviderId, ProviderSettings>;

  toggleOpen: () => void;
  setApiConfig: (config: ApiConfigUpdate) => void;
  sendMessage: (content: string) => Promise<void>;
  retryLast: () => Promise<void>;
  clearMessages: () => void;
}

const SETTINGS_KEY = 'sinter_llm_settings';
const MESSAGES_KEY = 'sinter_chat_messages';

function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* */ }
  return [];
}

function saveMessages(messages: ChatMessage[]) {
  try {
    // Strip images to keep localStorage small
    const stripped = messages.map(m => m.images ? { ...m, images: undefined } : m);
    localStorage.setItem(MESSAGES_KEY, JSON.stringify(stripped));
  } catch { /* */ }
}

interface PersistedSettings {
  version: number;
  provider: ProviderId;
  byProvider: Record<ProviderId, ProviderSettings>;
}

function defaultsFor(id: ProviderId): ProviderSettings {
  return { apiKey: '', apiEndpoint: '', model: getProvider(id).defaultModel };
}

function emptyByProvider(): Record<ProviderId, ProviderSettings> {
  return PROVIDER_IDS.reduce((acc, id) => {
    acc[id] = defaultsFor(id);
    return acc;
  }, {} as Record<ProviderId, ProviderSettings>);
}

function readProviderSettings(raw: any, id: ProviderId): ProviderSettings {
  const base = defaultsFor(id);
  if (!raw || typeof raw !== 'object') return base;
  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : base.apiKey,
    apiEndpoint: typeof raw.apiEndpoint === 'string' ? raw.apiEndpoint : base.apiEndpoint,
    model: typeof raw.model === 'string' && raw.model ? raw.model : base.model,
    supportsThinking: typeof raw.supportsThinking === 'boolean' ? raw.supportsThinking : undefined,
  };
}

/**
 * Read persisted settings, migrating the v1 shape.
 *
 * v1 stored a single flat {apiKey, apiEndpoint, model, provider}. Credentials
 * are now per-provider, so a v1 record is folded into the slot for whichever
 * provider it was configured against; an unrecognised provider value falls
 * back to the default rather than leaving the store in a broken state.
 */
export function loadSettings(): PersistedSettings {
  const fallback: PersistedSettings = {
    version: 2,
    provider: 'anthropic',
    byProvider: emptyByProvider(),
  };

  let parsed: any;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return fallback;
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object') return fallback;

  const provider: ProviderId = isProviderId(parsed.provider) ? parsed.provider : 'anthropic';
  const byProvider = emptyByProvider();

  if (parsed.byProvider && typeof parsed.byProvider === 'object') {
    for (const id of PROVIDER_IDS) {
      byProvider[id] = readProviderSettings(parsed.byProvider[id], id);
    }
  } else {
    // v1: a single credential set belonging to the then-active provider.
    byProvider[provider] = readProviderSettings(parsed, provider);
  }

  return { version: 2, provider, byProvider };
}

async function saveSettings(s: PersistedSettings) {
  if (!hasConsent()) {
    const granted = await ensureConsent('apikey');
    if (!granted) return;
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* */ }
}

const initialSettings = loadSettings();
const initialActive = initialSettings.byProvider[initialSettings.provider];

export const useChatStore = create<ChatState>((set, get) => ({
  messages: loadMessages(),
  isOpen: false,
  isLoading: false,

  apiKey: initialActive.apiKey,
  apiEndpoint: initialActive.apiEndpoint,
  model: initialActive.model,
  supportsThinking: initialActive.supportsThinking,
  provider: initialSettings.provider,
  byProvider: initialSettings.byProvider,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  clearMessages: () => { set({ messages: [] }); saveMessages([]); },

  setApiConfig: (config) => {
    set((s) => {
      // Defaults come from the *target* provider's saved settings, so a
      // switch restores that provider's own credentials instead of carrying
      // the previous provider's key across (which would only ever 401).
      // Explicitly-passed fields still apply, letting a caller switch
      // provider and set its key in one update.
      const provider = config.provider ?? s.provider;
      const current = s.byProvider[provider] ?? defaultsFor(provider);

      const next: ProviderSettings = {
        apiKey: config.apiKey ?? current.apiKey,
        apiEndpoint: config.apiEndpoint ?? current.apiEndpoint,
        model: config.model ?? current.model,
        // A new model invalidates the old model's capability flag; only an
        // explicit value (or an unchanged model) keeps it.
        supportsThinking:
          config.supportsThinking !== undefined
            ? config.supportsThinking
            : config.model !== undefined && config.model !== current.model
              ? undefined
              : current.supportsThinking,
      };

      const byProvider = { ...s.byProvider, [provider]: next };
      saveSettings({ version: 2, provider, byProvider });

      return {
        provider,
        byProvider,
        apiKey: next.apiKey,
        apiEndpoint: next.apiEndpoint,
        model: next.model,
        supportsThinking: next.supportsThinking,
      };
    });
  },

  sendMessage: async (content: string) => {
    const state = get();

    if (!state.apiKey) {
      const def = getProvider(state.provider);
      const hint = def.auth === 'oauth-pkce'
        ? `Connect ${def.label} in the settings (gear icon) to use AI chat.`
        : 'Please configure your API key in the settings (gear icon) to use AI chat.';
      set((s) => ({
        messages: [...s.messages, { role: 'user', content }, { role: 'assistant', content: hint }],
      }));
      return;
    }

    // Capture viewport renders to give Claude visual context
    const engine = getEngineRef();
    const capture = engine && useModelerStore.getState().tree
      ? engine.captureMultiView(256)
      : null;

    const images = capture?.images;
    // Prepend image description to user message so the model understands the visual context
    const augmentedContent = capture?.description
      ? `[Attached: ${capture.description}]\n\n${content}`
      : content;

    const userMessage: ChatMessage = { role: 'user', content: augmentedContent, images };
    // Add user message + empty assistant placeholder for streaming
    const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '' };
    set((s) => {
      const msgs = [...s.messages, userMessage, assistantPlaceholder];
      saveMessages(msgs);
      return { messages: msgs, isLoading: true };
    });

    try {
      const currentTree = useModelerStore.getState().tree;
      const systemPrompt = buildSystemPrompt(currentTree);
      const messages = get().messages.slice(0, -1); // exclude the empty placeholder
      const response = await streamLLMMessage(
        {
          systemPrompt,
          messages,
          apiKey: state.apiKey,
          apiEndpoint: state.apiEndpoint,
          model: state.model,
          provider: state.provider,
          supportsThinking: state.supportsThinking,
        },
        (token) => {
          // Append each token to the last (assistant) message
          set((s) => {
            const msgs = s.messages.slice();
            const last = msgs[msgs.length - 1];
            msgs[msgs.length - 1] = { ...last, content: last.content + token };
            return { messages: msgs };
          });
        },
      );

      // Ensure the final message content matches the full response
      const parsed = parseResponse(response);
      const parseFailed = !parsed && response.length > 0;
      set((s) => {
        const msgs = s.messages.slice();
        msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: response, parseFailed: parseFailed || undefined };
        saveMessages(msgs);
        return { messages: msgs, isLoading: false };
      });

      if (parsed) {
        const store = useModelerStore.getState();
        if (parsed.action === 'replace' && parsed.tree) {
          store.setTree(parsed.tree);
          zoomToFitAfterEval();
        } else if (parsed.action === 'modify' && parsed.changes) {
          applyModifications(parsed.changes);
          zoomToFitAfterEval();
        }
      }
    } catch (err: any) {
      const msg = `Error: ${err.message}`;
      set((s) => {
        const msgs = s.messages.slice();
        const last = msgs[msgs.length - 1];
        if (last.role === 'assistant' && !last.content) {
          msgs[msgs.length - 1] = { role: 'assistant', content: msg };
        } else {
          msgs.push({ role: 'assistant', content: msg });
        }
        saveMessages(msgs);
        return { messages: msgs, isLoading: false };
      });
    }
  },

  retryLast: async () => {
    const { messages, isLoading } = get();
    if (isLoading || messages.length < 2) return;
    // Find the last user message (skip the failed assistant response)
    const last = messages[messages.length - 1];
    if (last.role !== 'assistant') return;
    // Remove the failed assistant message, re-extract the user content
    const userMsg = messages[messages.length - 2];
    if (userMsg.role !== 'user') return;
    // Strip the "[Attached: ...]" prefix to get the original user text
    const content = userMsg.content.replace(/^\[Attached:[^\]]*\]\n\n/, '');
    // Remove the last two messages (user + failed assistant)
    set((s) => {
      const msgs = s.messages.slice(0, -2);
      saveMessages(msgs);
      return { messages: msgs };
    });
    // Re-send
    await get().sendMessage(content);
  },
}));

function applyModifications(changes: any[]) {
  const store = useModelerStore.getState();
  let tree = store.tree;
  if (!tree) return;

  for (const change of changes) {
    if (change.update && change.params) {
      store.updateNodeParams(change.update, change.params);
      tree = useModelerStore.getState().tree;
    } else if (change.addChild && change.node) {
      tree = addChildToNode(tree!, change.addChild, change.node);
      tree = decodeTree(tree, { repairMissingIds: true });
      store.setTree(tree);
    } else if (change.remove) {
      store.removeNode(change.remove);
      tree = useModelerStore.getState().tree;
    } else if (change.wrapIn && change.wrapper) {
      tree = wrapNodeIn(tree!, change.wrapIn, change.wrapper);
      if (tree) {
        tree = decodeTree(tree, { repairMissingIds: true });
        store.setTree(tree);
      }
    }
  }
}

function addChildToNode(tree: any, parentId: string, newChild: any): any {
  if (tree.id === parentId) return { ...tree, children: [...tree.children, newChild] };
  return { ...tree, children: tree.children.map((c: any) => addChildToNode(c, parentId, newChild)) };
}

function wrapNodeIn(tree: any, targetId: string, wrapper: any): any {
  if (tree.id === targetId) return { ...wrapper, children: [tree] };
  return { ...tree, children: tree.children.map((c: any) => wrapNodeIn(c, targetId, wrapper)) };
}

/** Wait for the SDF evaluator to produce a new bounding box, then zoom to fit */
function zoomToFitAfterEval() {
  const unsub = useModelerStore.subscribe((state) => {
    if (state.sdfDisplay && !state.evaluating) {
      unsub();
      const engine = getEngineRef();
      if (engine) engine.zoomToFit();
    }
  });
}
