import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AiSettings } from './AiSettings';
import { useChatStore } from '../../store/chatStore';

vi.mock('../../store/consent', () => ({
  ensureConsent: vi.fn(async () => true),
  hasConsent: () => true,
}));

const startOpenRouterSignIn = vi.fn(async () => {});
vi.mock('../../llm/openrouter', () => ({
  startOpenRouterSignIn: (...args: unknown[]) => startOpenRouterSignIn(...(args as [])),
  OPENROUTER_CALLBACK_PATH: '/auth/openrouter/callback',
}));

const CATALOG = {
  data: [
    {
      id: 'anthropic/claude-opus-5',
      name: 'Claude Opus 5',
      context_length: 1_000_000,
      architecture: { input_modalities: ['text', 'image'] },
      pricing: { prompt: '0.00001', completion: '0.00005' },
      supported_parameters: ['reasoning'],
    },
    {
      id: 'some/text-only-model',
      name: 'Text Only Model',
      context_length: 32_000,
      architecture: { input_modalities: ['text'] },
      pricing: { prompt: '0.000001', completion: '0.000002' },
      supported_parameters: [],
    },
  ],
};

function resetStore(overrides: Parameters<ReturnType<typeof useChatStore.getState>['setApiConfig']>[0] = {}) {
  useChatStore.setState({
    provider: 'anthropic',
    apiKey: '',
    apiEndpoint: '',
    model: 'claude-opus-4-7',
    supportsThinking: undefined,
    byProvider: {
      anthropic: { apiKey: '', apiEndpoint: '', model: 'claude-opus-4-7' },
      openai: { apiKey: '', apiEndpoint: '', model: 'gpt-4o' },
      openrouter: { apiKey: '', apiEndpoint: '', model: 'anthropic/claude-opus-5' },
    },
  });
  if (Object.keys(overrides).length) useChatStore.getState().setApiConfig(overrides);
}

beforeEach(() => {
  startOpenRouterSignIn.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => CATALOG, text: async () => '',
  }));
  resetStore();
});

afterEach(() => vi.unstubAllGlobals());

describe('AiSettings', () => {
  it('lists every registered provider', () => {
    render(<AiSettings />);
    const providerSelect = screen.getByLabelText(/provider/i) as HTMLSelectElement;
    const labels = Array.from(providerSelect.options).map((o) => o.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Anthropic', 'OpenAI', 'OpenRouter']));
  });

  it('shows a Connect button instead of a key field for OpenRouter', async () => {
    resetStore({ provider: 'openrouter' });
    render(<AiSettings />);

    expect(screen.getByRole('button', { name: /connect openrouter/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/enter api key/i)).not.toBeInTheDocument();
  });

  it('shows a key field for key-based providers', () => {
    render(<AiSettings />);
    expect(screen.getByPlaceholderText(/enter api key/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect/i })).not.toBeInTheDocument();
  });

  it('starts the OAuth flow when Connect is clicked', async () => {
    resetStore({ provider: 'openrouter' });
    render(<AiSettings />);
    fireEvent.click(screen.getByRole('button', { name: /connect openrouter/i }));
    await waitFor(() => expect(startOpenRouterSignIn).toHaveBeenCalled());
  });

  it('offers a disconnect once connected', () => {
    resetStore({ provider: 'openrouter', apiKey: 'sk-or-user' });
    render(<AiSettings />);
    expect(screen.getByText(/connected to openrouter/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    expect(useChatStore.getState().apiKey).toBe('');
  });

  it('replaces the free-text model field with a catalog picker', async () => {
    resetStore({ provider: 'openrouter' });
    render(<AiSettings />);

    // The old UI had no list at all; a typo produced a raw 404 at send time.
    const select = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => {
      expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent))
        .toContain('Claude Opus 5');
    });
  });

  it('hides text-only models by default and says how many', async () => {
    resetStore({ provider: 'openrouter' });
    render(<AiSettings />);

    await waitFor(() => expect(screen.getByText(/1 text-only model hidden/i)).toBeInTheDocument());
    const select = await screen.findByRole('combobox', { name: /model/i });
    const labels = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).not.toContain('Text Only Model');
  });

  it('reveals text-only models when the vision filter is turned off', async () => {
    resetStore({ provider: 'openrouter' });
    render(<AiSettings />);
    await waitFor(() => expect(screen.getByText(/1 text-only model hidden/i)).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText(/vision-capable only/i));

    const select = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() => {
      expect(Array.from((select as HTMLSelectElement).options).map((o) => o.textContent))
        .toContain('Text Only Model');
    });
  });

  it('warns when the selected model cannot see the viewport renders', async () => {
    resetStore({ provider: 'openrouter', model: 'some/text-only-model' });
    render(<AiSettings />);
    fireEvent.click(await screen.findByLabelText(/vision-capable only/i));

    await waitFor(() =>
      expect(screen.getByText(/sends viewport renders with every message/i)).toBeInTheDocument());
  });

  it('records the capability flag when a model is picked from the catalog', async () => {
    resetStore({ provider: 'openrouter', model: 'placeholder' });
    render(<AiSettings />);
    const select = await screen.findByRole('combobox', { name: /model/i });
    await waitFor(() =>
      expect(Array.from((select as HTMLSelectElement).options).some((o) => o.value === 'anthropic/claude-opus-5')).toBe(true));

    fireEvent.change(select, { target: { value: 'anthropic/claude-opus-5' } });

    const state = useChatStore.getState();
    expect(state.model).toBe('anthropic/claude-opus-5');
    // Taken from supported_parameters, not guessed from the id.
    expect(state.supportsThinking).toBe(true);
  });

  it('shows pricing and context for the selected model', async () => {
    resetStore({ provider: 'openrouter', model: 'anthropic/claude-opus-5' });
    render(<AiSettings />);
    await waitFor(() =>
      expect(screen.getByText(/1M context · \$10\.00 \/ M in · \$50\.00 \/ M out/)).toBeInTheDocument());
  });

  it('falls back to free-text entry when the catalog cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, text: async () => 'down', json: async () => ({}),
    }));
    resetStore({ provider: 'openrouter' });
    render(<AiSettings />);

    // A dead catalog must not block configuring the panel.
    await waitFor(() => expect(screen.getByText(/enter a model id manually/i)).toBeInTheDocument());
    expect(await screen.findByRole('textbox', { name: /model/i })).toBeInTheDocument();
  });

  it('switching provider swaps in that provider\'s own settings', async () => {
    resetStore();
    useChatStore.getState().setApiConfig({ apiKey: 'sk-ant' });
    render(<AiSettings />);

    fireEvent.change(screen.getByLabelText(/provider/i), { target: { value: 'openai' } });

    await waitFor(() => expect(useChatStore.getState().provider).toBe('openai'));
    expect(useChatStore.getState().apiKey).toBe('');
    expect((screen.getByPlaceholderText(/enter api key/i) as HTMLInputElement).value).toBe('');
  });
});
