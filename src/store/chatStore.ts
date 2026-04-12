import { create } from 'zustand';
import { sendLLMMessage } from '../llm/llmService';
import { buildSystemPrompt } from '../llm/systemPrompt';
import { parseResponse } from '../llm/parseResponse';
import { useModelerStore } from './modelerStore';


export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatState {
  messages: ChatMessage[];
  apiEndpoint: string;
  apiKey: string;
  model: string;
  provider: 'openai' | 'anthropic';
  isOpen: boolean;
  isLoading: boolean;
  showSettings: boolean;

  toggleOpen: () => void;
  toggleSettings: () => void;
  setApiConfig: (config: { apiEndpoint?: string; apiKey?: string; model?: string; provider?: 'openai' | 'anthropic' }) => void;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  apiEndpoint: '',
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  provider: 'anthropic',
  isOpen: false,
  isLoading: false,
  showSettings: false,

  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  toggleSettings: () => set((s) => ({ showSettings: !s.showSettings })),

  setApiConfig: (config) =>
    set((s) => ({
      apiEndpoint: config.apiEndpoint ?? s.apiEndpoint,
      apiKey: config.apiKey ?? s.apiKey,
      model: config.model ?? s.model,
      provider: config.provider ?? s.provider,
    })),

  clearMessages: () => set({ messages: [] }),

  sendMessage: async (content: string) => {
    const state = get();
    if (!state.apiKey) {
      set((s) => ({
        messages: [...s.messages, { role: 'user', content }, { role: 'assistant', content: 'Please configure your API key in the settings (gear icon) to use AI chat.' }],
      }));
      return;
    }

    const userMessage: ChatMessage = { role: 'user', content };
    set((s) => ({ messages: [...s.messages, userMessage], isLoading: true }));

    try {
      const currentTree = useModelerStore.getState().tree;
      const systemPrompt = buildSystemPrompt(currentTree);
      const messages = [...get().messages];
      const response = await sendLLMMessage({
        systemPrompt,
        messages,
        apiEndpoint: state.apiEndpoint,
        apiKey: state.apiKey,
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
      set((s) => ({
        messages: [...s.messages, { role: 'assistant', content: `Error: ${err.message}` }],
        isLoading: false,
      }));
    }
  },
}));

interface ModifyChange {
  update?: string;
  params?: Record<string, number>;
  nodeId?: string;
}

function applyModifications(changes: ModifyChange[]) {
  const store = useModelerStore.getState();
  for (const change of changes) {
    const id = change.update || change.nodeId;
    if (id && change.params) {
      store.updateNodeParams(id, change.params);
    }
  }
}
