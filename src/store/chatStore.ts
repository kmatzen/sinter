import { create } from 'zustand';
import { sendLLMMessage } from '../llm/llmService';
import { buildSystemPrompt } from '../llm/systemPrompt';
import { parseResponse } from '../llm/parseResponse';
import { useModelerStore } from './modelerStore';
import { getEngineRef } from '../engine/engineRef';
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  /** Base64 PNG data URLs of viewport renders, attached to user messages */
  images?: string[];
}

interface ChatState {
  messages: ChatMessage[];
  isOpen: boolean;
  isLoading: boolean;

  // BYOK settings (community edition only)
  apiKey: string;
  apiEndpoint: string;
  model: string;
  provider: 'openai' | 'anthropic';
  showSettings: boolean;

  toggleOpen: () => void;
  toggleSettings: () => void;
  setApiConfig: (config: { apiKey?: string; apiEndpoint?: string; model?: string; provider?: 'openai' | 'anthropic' }) => void;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

const SETTINGS_KEY = 'sinter_llm_settings';

function loadSettings(): { apiKey: string; apiEndpoint: string; model: string; provider: 'openai' | 'anthropic' } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        apiKey: parsed.apiKey || '',
        apiEndpoint: parsed.apiEndpoint || '',
        model: parsed.model || 'claude-opus-4-7',
        provider: parsed.provider || 'anthropic',
      };
    }
  } catch { /* */ }
  return { apiKey: '', apiEndpoint: '', model: 'claude-opus-4-7', provider: 'anthropic' };
}

function saveSettings(s: { apiKey: string; apiEndpoint: string; model: string; provider: string }) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch { /* */ }
}

const initialSettings = loadSettings();

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  isLoading: false,

  apiKey: initialSettings.apiKey,
  apiEndpoint: initialSettings.apiEndpoint,
  model: initialSettings.model,
  provider: initialSettings.provider,
  showSettings: false,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  clearMessages: () => set({ messages: [] }),

  setApiConfig: (config) => {
    set((s) => {
      const updated = {
        apiKey: config.apiKey ?? s.apiKey,
        apiEndpoint: config.apiEndpoint ?? s.apiEndpoint,
        model: config.model ?? s.model,
        provider: config.provider ?? s.provider,
      };
      saveSettings(updated);
      return updated;
    });
  },

  sendMessage: async (content: string) => {
    const state = get();

    if (!state.apiKey) {
      set((s) => ({
        messages: [...s.messages, { role: 'user', content }, { role: 'assistant', content: 'Please configure your API key in the settings (gear icon) to use AI chat.' }],
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
    set((s) => ({ messages: [...s.messages, userMessage], isLoading: true }));

    try {
      const currentTree = useModelerStore.getState().tree;
      const systemPrompt = buildSystemPrompt(currentTree);
      const messages = [...get().messages];
      const response = await sendLLMMessage({
        systemPrompt,
        messages,
        // BYOK fields (only used in community edition)
        apiKey: state.apiKey,
        apiEndpoint: state.apiEndpoint,
        model: state.model,
        provider: state.provider,
      });

      const assistantMessage: ChatMessage = { role: 'assistant', content: response };
      set((s) => ({ messages: [...s.messages, assistantMessage], isLoading: false }));

      const parsed = parseResponse(response);
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
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: msg }],
        isLoading: false,
      }));
    }
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
      store.setTree(tree);
    } else if (change.remove) {
      store.removeNode(change.remove);
      tree = useModelerStore.getState().tree;
    } else if (change.wrapIn && change.wrapper) {
      tree = wrapNodeIn(tree!, change.wrapIn, change.wrapper);
      if (tree) store.setTree(tree);
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
