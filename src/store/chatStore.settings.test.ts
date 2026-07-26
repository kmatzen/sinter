import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Consent gates persistence; granting it keeps these tests about the settings
// shape rather than about the cookie banner.
vi.mock('./consent', () => ({
  ensureConsent: vi.fn(async () => true),
  hasConsent: () => true,
}));

const SETTINGS_KEY = 'sinter_llm_settings';

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

/** Seed persisted settings, then import the store fresh so it reads them. */
async function importStoreWith(persisted: unknown) {
  vi.resetModules();
  const storage = makeStorageStub();
  if (persisted !== undefined) storage.setItem(SETTINGS_KEY, JSON.stringify(persisted));
  vi.stubGlobal('localStorage', storage);
  const mod = await import('./chatStore');
  return { ...mod, storage };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', makeStorageStub());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('settings migration', () => {
  it('folds a v1 record into the slot for its provider', async () => {
    // v1 shape: one flat credential set belonging to the then-active provider.
    const { loadSettings } = await importStoreWith({
      apiKey: 'sk-ant-old',
      apiEndpoint: 'https://proxy.example',
      model: 'claude-opus-4-7',
      provider: 'anthropic',
    });

    const settings = loadSettings();
    expect(settings.provider).toBe('anthropic');
    expect(settings.byProvider.anthropic).toMatchObject({
      apiKey: 'sk-ant-old',
      apiEndpoint: 'https://proxy.example',
      model: 'claude-opus-4-7',
    });
    // The key belonged to Anthropic and must not leak into other providers.
    expect(settings.byProvider.openai.apiKey).toBe('');
    expect(settings.byProvider.openrouter.apiKey).toBe('');
  });

  it('migrates a v1 OpenAI record into the OpenAI slot', async () => {
    const { loadSettings } = await importStoreWith({
      apiKey: 'sk-openai-old', apiEndpoint: '', model: 'gpt-4o', provider: 'openai',
    });
    const settings = loadSettings();
    expect(settings.provider).toBe('openai');
    expect(settings.byProvider.openai.apiKey).toBe('sk-openai-old');
    expect(settings.byProvider.anthropic.apiKey).toBe('');
  });

  it('falls back to a usable provider when the persisted one is unknown', async () => {
    // Widening the union must not strand a user on a value we cannot resolve.
    const { loadSettings } = await importStoreWith({ apiKey: 'k', provider: 'some-removed-provider' });
    expect(loadSettings().provider).toBe('anthropic');
  });

  it('reads a v2 record back unchanged', async () => {
    const v2 = {
      version: 2,
      provider: 'openrouter',
      byProvider: {
        anthropic: { apiKey: 'a', apiEndpoint: '', model: 'claude-opus-4-7' },
        openai: { apiKey: 'o', apiEndpoint: '', model: 'gpt-4o' },
        openrouter: { apiKey: 'r', apiEndpoint: '', model: 'anthropic/claude-opus-5', supportsThinking: true },
      },
    };
    const { loadSettings } = await importStoreWith(v2);
    const settings = loadSettings();
    expect(settings.provider).toBe('openrouter');
    expect(settings.byProvider.openrouter.apiKey).toBe('r');
    expect(settings.byProvider.openrouter.supportsThinking).toBe(true);
    expect(settings.byProvider.anthropic.apiKey).toBe('a');
  });

  it('survives absent, corrupt and non-object records', async () => {
    for (const bad of [undefined, '"not-an-object"', null]) {
      vi.resetModules();
      const storage = makeStorageStub();
      if (bad !== undefined) storage.setItem(SETTINGS_KEY, bad === null ? 'not json at all' : bad);
      vi.stubGlobal('localStorage', storage);
      const { loadSettings } = await import('./chatStore');
      const settings = loadSettings();
      expect(settings.provider).toBe('anthropic');
      expect(settings.byProvider.anthropic.model).toBeTruthy();
    }
  });

  it('defaults each provider to its own model', async () => {
    const { loadSettings } = await importStoreWith(undefined);
    const { byProvider } = loadSettings();
    expect(byProvider.openrouter.model).toBe('anthropic/claude-opus-5');
    expect(byProvider.openai.model).toBe('gpt-4o');
    // A namespaced default would be meaningless talking to Anthropic directly.
    expect(byProvider.anthropic.model).not.toContain('/');
  });
});

describe('setApiConfig', () => {
  it('keeps credentials separate per provider across a switch', async () => {
    const { useChatStore } = await importStoreWith(undefined);
    const { setApiConfig } = useChatStore.getState();

    setApiConfig({ apiKey: 'sk-ant' });
    expect(useChatStore.getState().apiKey).toBe('sk-ant');

    setApiConfig({ provider: 'openai' });
    // Carrying the Anthropic key over to OpenAI would only ever 401.
    expect(useChatStore.getState().apiKey).toBe('');

    setApiConfig({ apiKey: 'sk-openai' });
    setApiConfig({ provider: 'anthropic' });
    expect(useChatStore.getState().apiKey).toBe('sk-ant');

    setApiConfig({ provider: 'openai' });
    expect(useChatStore.getState().apiKey).toBe('sk-openai');
  });

  it('switches provider and sets its key in one update', async () => {
    // The OAuth callback does exactly this.
    const { useChatStore } = await importStoreWith(undefined);
    useChatStore.getState().setApiConfig({ provider: 'openrouter', apiKey: 'sk-or-v1-user' });

    const state = useChatStore.getState();
    expect(state.provider).toBe('openrouter');
    expect(state.apiKey).toBe('sk-or-v1-user');
    expect(state.byProvider.openrouter.apiKey).toBe('sk-or-v1-user');
  });

  it('switching provider restores that provider\'s model', async () => {
    const { useChatStore } = await importStoreWith(undefined);
    const { setApiConfig } = useChatStore.getState();

    setApiConfig({ model: 'claude-sonnet-4-5' });
    setApiConfig({ provider: 'openrouter' });
    expect(useChatStore.getState().model).toBe('anthropic/claude-opus-5');
    setApiConfig({ provider: 'anthropic' });
    expect(useChatStore.getState().model).toBe('claude-sonnet-4-5');
  });

  it('drops a stale capability flag when the model changes', async () => {
    const { useChatStore } = await importStoreWith(undefined);
    const { setApiConfig } = useChatStore.getState();

    setApiConfig({ model: 'anthropic/claude-opus-5', supportsThinking: true });
    expect(useChatStore.getState().supportsThinking).toBe(true);

    // A different model's capability is unknown until the catalog says so;
    // keeping the old flag would send thinking params to a model without it.
    setApiConfig({ model: 'some/other-model' });
    expect(useChatStore.getState().supportsThinking).toBeUndefined();
  });

  it('keeps the capability flag when unrelated fields change', async () => {
    const { useChatStore } = await importStoreWith(undefined);
    const { setApiConfig } = useChatStore.getState();

    setApiConfig({ model: 'anthropic/claude-opus-5', supportsThinking: true });
    setApiConfig({ apiEndpoint: 'https://proxy.example' });
    expect(useChatStore.getState().supportsThinking).toBe(true);
  });

  it('persists in the v2 shape', async () => {
    const { useChatStore, storage } = await importStoreWith(undefined);
    useChatStore.getState().setApiConfig({ provider: 'openrouter', apiKey: 'sk-or' });

    const written = JSON.parse(storage.getItem(SETTINGS_KEY)!);
    expect(written.version).toBe(2);
    expect(written.provider).toBe('openrouter');
    expect(written.byProvider.openrouter.apiKey).toBe('sk-or');
  });
});
