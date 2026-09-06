import { create } from 'zustand';
import { budgetMessages, maxTokensFor, streamLLMMessage } from '../llm/llmService';
import { buildSystemPrompt } from '../llm/systemPrompt';
import { parseResponse, type Modification, type ParsedResponse } from '../llm/parseResponse';
import { useModelerStore } from './modelerStore';
import { getEngineRef } from '../engine/engineRef';
import { decodeTree } from '../types/documentDecoder';
import { applyNodeParamPatch } from '../types/parameterSchema';
import { expectedChildren, type NamedParameter, type SDFNodeUI } from '../types/operations';
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
  actionError?: string;
}

export interface ModelProposal {
  tree: SDFNodeUI | null;
  baseHash: string;
  summary: string[];
  affectedNodeIds: string[];
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
  pendingProposal: ModelProposal | null;
  proposalError: string | null;
  conversationKey: string;
  attachViewport: boolean;
  requestEstimate: { approximateTokens: number; imageCount: number; trimmedMessages: number } | null;

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
  applyProposal: () => void;
  discardProposal: () => void;
  switchConversation: (key: string) => void;
  bindConversation: (key: string) => void;
  setAttachViewport: (enabled: boolean) => void;
  stopGeneration: () => void;
}

const SETTINGS_KEY = 'sinter_llm_settings';
const MESSAGES_KEY = 'sinter_chat_messages';
const DEFAULT_CONVERSATION = 'session';
let activeConversationKey = DEFAULT_CONVERSATION;
let requestSequence = 0;
let activeRequest: { id: number; key: string; controller: AbortController } | null = null;

function treeHash(tree: SDFNodeUI | null, parameters: NamedParameter[] = []): string {
  return JSON.stringify({ tree, parameters });
}

function findNode(tree: SDFNodeUI | null, id: string): SDFNodeUI | null {
  if (!tree) return null;
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function updateNode(tree: SDFNodeUI, id: string, change: (node: SDFNodeUI) => SDFNodeUI): SDFNodeUI {
  if (tree.id === id) return change(tree);
  return { ...tree, children: tree.children.map((child) => updateNode(child, id, change)) };
}

function removeNode(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) return null;
  return {
    ...tree,
    children: tree.children.flatMap((child) => {
      if (child.id !== id) return [removeNode(child, id)!];
      if (['union', 'subtract', 'intersect'].includes(tree.kind)) {
        return [{ id: crypto.randomUUID(), kind: '_empty', label: '', params: {}, children: [], enabled: false }];
      }
      return [];
    }).filter(Boolean),
  };
}

/** Build and validate a proposal without touching the live model store. */
export function buildModelProposal(parsed: ParsedResponse, base: SDFNodeUI | null, parameters: NamedParameter[] = []): ModelProposal {
  if (!parsed) throw new Error('The response did not contain a model change');
  if (parsed.action === 'replace') {
    const tree = decodeTree(parsed.tree);
    return { tree, baseHash: treeHash(base, parameters), summary: ['Replace the model'], affectedNodeIds: tree ? [tree.id] : [] };
  }
  if (!base) throw new Error('There is no model to modify');

  let candidate: SDFNodeUI | null = structuredClone(base);
  const summary: string[] = [];
  const affected = new Set<string>();
  for (const change of parsed.changes) {
    candidate = applyModification(candidate, change, summary, affected);
    candidate = decodeTree(candidate, { repairMissingIds: true });
  }
  return { tree: candidate, baseHash: treeHash(base, parameters), summary, affectedNodeIds: [...affected] };
}

function applyModification(
  tree: SDFNodeUI | null,
  change: Modification,
  summary: string[],
  affected: Set<string>,
): SDFNodeUI | null {
  if (!tree) throw new Error('A change removed the model before the proposal ended');
  if (change.update) {
    const target = findNode(tree, change.update);
    if (!target) throw new Error(`Node ${change.update} no longer exists`);
    const result = applyNodeParamPatch(target, change.params);
    if (!result.params) throw new Error(result.error ?? `Invalid parameters for ${target.label}`);
    affected.add(target.id);
    summary.push(`Update ${target.label}`);
    return updateNode(tree, target.id, (node) => {
      const expressions = Object.fromEntries(Object.entries(node.expressions ?? {}).filter(([key]) => !(key in change.params)));
      return { ...node, params: result.params!, expressions: Object.keys(expressions).length ? expressions : undefined };
    });
  }
  if (change.addChild && change.node) {
    const target = findNode(tree, change.addChild);
    if (!target) throw new Error(`Parent node ${change.addChild} no longer exists`);
    const emptyIndex = target.children.findIndex((child) => child.kind === '_empty');
    if (emptyIndex < 0 && target.children.length >= expectedChildren(target.kind)) throw new Error(`${target.label} has no empty child input`);
    affected.add(target.id);
    summary.push(`Add a child to ${target.label}`);
    return updateNode(tree, target.id, (node) => {
      if (emptyIndex < 0) return { ...node, children: [...node.children, change.node as SDFNodeUI] };
      const children = [...node.children];
      children[emptyIndex] = change.node as SDFNodeUI;
      return { ...node, children };
    });
  }
  if (change.remove) {
    const target = findNode(tree, change.remove);
    if (!target) throw new Error(`Node ${change.remove} no longer exists`);
    affected.add(target.id);
    summary.push(`Remove ${target.label}`);
    return removeNode(tree, target.id);
  }
  if (change.wrapIn && change.wrapper) {
    const target = findNode(tree, change.wrapIn);
    if (!target) throw new Error(`Node ${change.wrapIn} no longer exists`);
    const wrapper = change.wrapper as SDFNodeUI;
    affected.add(target.id);
    summary.push(`Wrap ${target.label} in ${typeof wrapper.label === 'string' ? wrapper.label : String(wrapper.kind ?? 'operation')}`);
    return updateNode(tree, target.id, () => ({ ...wrapper, children: [target] }));
  }
  throw new Error('The response contains an unsupported change');
}

function loadMessages(key = activeConversationKey): ChatMessage[] {
  try {
    const raw = localStorage.getItem(MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // v1 was one global array. Keep it only in the initial session rather
    // than silently attaching it to the first cloud project opened.
    if (Array.isArray(parsed)) return key === DEFAULT_CONVERSATION ? parsed : [];
    if (parsed?.version === 2 && parsed.conversations && Array.isArray(parsed.conversations[key])) {
      return parsed.conversations[key];
    }
  } catch { /* */ }
  return [];
}

function saveMessages(messages: ChatMessage[], key = activeConversationKey) {
  try {
    // Strip images to keep localStorage small
    const stripped = messages.map(m => m.images ? { ...m, images: undefined } : m);
    const raw = localStorage.getItem(MESSAGES_KEY);
    let conversations: Record<string, ChatMessage[]> = {};
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.version === 2 && parsed.conversations) conversations = parsed.conversations;
      else if (Array.isArray(parsed)) conversations[DEFAULT_CONVERSATION] = parsed;
    }
    localStorage.setItem(MESSAGES_KEY, JSON.stringify({
      version: 2,
      conversations: { ...conversations, [key]: stripped },
    }));
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
  pendingProposal: null,
  proposalError: null,
  conversationKey: DEFAULT_CONVERSATION,
  attachViewport: true,
  requestEstimate: null,

  apiKey: initialActive.apiKey,
  apiEndpoint: initialActive.apiEndpoint,
  model: initialActive.model,
  supportsThinking: initialActive.supportsThinking,
  provider: initialSettings.provider,
  byProvider: initialSettings.byProvider,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  clearMessages: () => { set({ messages: [], pendingProposal: null, proposalError: null }); saveMessages([]); },
  discardProposal: () => set({ pendingProposal: null, proposalError: null }),
  setAttachViewport: (enabled) => set({ attachViewport: enabled }),
  stopGeneration: () => {
    activeRequest?.controller.abort();
  },
  switchConversation: (key) => {
    if (!key || key === get().conversationKey) return;
    activeRequest?.controller.abort();
    requestSequence++;
    saveMessages(get().messages, get().conversationKey);
    activeConversationKey = key;
    set({
      conversationKey: key,
      messages: loadMessages(key),
      isLoading: false,
      pendingProposal: null,
      proposalError: null,
      requestEstimate: null,
    });
  },
  bindConversation: (key) => {
    if (!key || key === get().conversationKey) return;
    saveMessages(get().messages, key);
    activeConversationKey = key;
    set({ conversationKey: key });
  },
  applyProposal: () => {
    const proposal = get().pendingProposal;
    if (!proposal) return;
    const model = useModelerStore.getState();
    if (treeHash(model.tree, model.namedParameters) !== proposal.baseHash) {
      set({ proposalError: 'The model changed after this proposal was created. Ask the assistant to try again.' });
      return;
    }
    useModelerStore.getState().setTree(proposal.tree);
    set({ pendingProposal: null, proposalError: null });
    zoomToFitAfterEval();
  },

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

    const conversationKey = state.conversationKey;
    const requestId = ++requestSequence;
    const controller = new AbortController();
    activeRequest?.controller.abort();
    activeRequest = { id: requestId, key: conversationKey, controller };
    const isCurrent = () => activeRequest?.id === requestId && get().conversationKey === conversationKey;

    // Capture viewport renders to give Claude visual context
    const engine = getEngineRef();
    const capture = state.attachViewport && engine && useModelerStore.getState().tree
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
      const currentModel = useModelerStore.getState();
      const currentTree = currentModel.tree;
      const systemPrompt = buildSystemPrompt(currentTree, currentModel.namedParameters);
      const unbudgeted = get().messages.slice(0, -1); // exclude the empty placeholder
      const providerDef = getProvider(state.provider);
      const estimate = budgetMessages(
        unbudgeted, systemPrompt, providerDef.contextTokens,
        maxTokensFor({
          systemPrompt, messages: unbudgeted, apiKey: state.apiKey, apiEndpoint: state.apiEndpoint,
          model: state.model, provider: state.provider, supportsThinking: state.supportsThinking,
        }, state.model || providerDef.defaultModel),
      );
      if (isCurrent()) set({ requestEstimate: {
        approximateTokens: estimate.approximateTokens,
        imageCount: estimate.imageCount,
        trimmedMessages: estimate.trimmedMessages,
      } });
      const response = await streamLLMMessage(
        {
          systemPrompt,
          messages: estimate.messages,
          apiKey: state.apiKey,
          apiEndpoint: state.apiEndpoint,
          model: state.model,
          provider: state.provider,
          supportsThinking: state.supportsThinking,
          signal: controller.signal,
        },
        (token) => {
          if (!isCurrent()) return;
          // Append each token to the last (assistant) message
          set((s) => {
            const msgs = s.messages.slice();
            const last = msgs[msgs.length - 1];
            msgs[msgs.length - 1] = { ...last, content: last.content + token };
            return { messages: msgs };
          });
        },
      );

      if (!isCurrent()) return;

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
        try {
          const proposal = buildModelProposal(parsed, currentTree, currentModel.namedParameters);
          set({ pendingProposal: proposal, proposalError: null });
        } catch (error) {
          const actionError = error instanceof Error ? error.message : 'The proposed model change is invalid';
          set((s) => {
            const msgs = [...s.messages];
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], actionError };
            saveMessages(msgs);
            return { messages: msgs, pendingProposal: null, proposalError: actionError };
          });
        }
      }
    } catch (err: any) {
      if (!isCurrent()) return;
      const stopped = err?.name === 'AbortError';
      const msg = stopped ? 'Generation stopped. You can retry this request.' : `Error: ${err.message}`;
      set((s) => {
        const msgs = s.messages.slice();
        const last = msgs[msgs.length - 1];
        if (last.role === 'assistant' && !last.content) {
          msgs[msgs.length - 1] = { role: 'assistant', content: msg, parseFailed: stopped || undefined };
        } else {
          msgs.push({ role: 'assistant', content: msg });
        }
        saveMessages(msgs);
        return { messages: msgs, isLoading: false };
      });
    } finally {
      if (activeRequest?.id === requestId) activeRequest = null;
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
