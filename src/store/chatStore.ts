import { create } from 'zustand';
import { sendLLMMessage } from '../llm/llmService';
import { buildSystemPrompt } from '../llm/systemPrompt';
import { parseResponse } from '../llm/parseResponse';
import { useModelerStore } from './modelerStore';
import { getEngineRef } from '../engine/engineRef';
import { features } from '../config';

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

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isOpen: false,
  isLoading: false,

  apiKey: '',
  apiEndpoint: '',
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  showSettings: false,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),
  clearMessages: () => set({ messages: [] }),

  setApiConfig: (config) =>
    set((s) => ({
      apiKey: config.apiKey ?? s.apiKey,
      apiEndpoint: config.apiEndpoint ?? s.apiEndpoint,
      model: config.model ?? s.model,
      provider: config.provider ?? s.provider,
    })),

  sendMessage: async (content: string) => {
    const state = get();

    // Community edition: check for API key
    if (features.byok && !state.apiKey) {
      set((s) => ({
        messages: [...s.messages, { role: 'user', content }, { role: 'assistant', content: 'Please configure your API key in the settings (gear icon) to use AI chat.' }],
      }));
      return;
    }

    // Capture viewport renders to give Claude visual context
    const engine = getEngineRef();
    const images = engine && useModelerStore.getState().tree
      ? engine.captureMultiView(256)
      : undefined;

    const userMessage: ChatMessage = { role: 'user', content, images };
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
        } else if (parsed.action === 'modify' && parsed.changes) {
          applyModifications(parsed.changes);
        }
      }
    } catch (err: any) {
      const msg = err.message?.includes('limit')
        ? 'You\'re out of credits. Purchase more from the credits button in the toolbar to continue using AI chat.'
        : `Error: ${err.message}`;
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
