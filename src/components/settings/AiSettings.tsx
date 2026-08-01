import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../store/chatStore';
import { PROVIDER_IDS, getProvider, type ProviderId } from '../../llm/providers';
import { fetchModels, visionCapable, formatPricing, formatContext, type ModelInfo } from '../../llm/models';
import { startOpenRouterSignIn } from '../../llm/openrouter';

const CUSTOM = '__custom__';

const inputStyle = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-default)',
} as const;

type CatalogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; models: ModelInfo[] }
  | { status: 'error'; message: string };

export function AiSettings() {
  const apiKey = useChatStore((s) => s.apiKey);
  const apiEndpoint = useChatStore((s) => s.apiEndpoint);
  const model = useChatStore((s) => s.model);
  const providerId = useChatStore((s) => s.provider);
  const setApiConfig = useChatStore((s) => s.setApiConfig);

  const provider = getProvider(providerId);
  const [catalog, setCatalog] = useState<CatalogState>({ status: 'idle' });
  const [visionOnly, setVisionOnly] = useState(true);
  const [customModel, setCustomModel] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Reload the catalog whenever the provider, credential or endpoint changes.
  // A failure is not fatal: the picker degrades to free-text entry.
  useEffect(() => {
    let cancelled = false;
    if (!provider.modelsPath) {
      setCatalog({ status: 'idle' });
      return;
    }
    setCatalog({ status: 'loading' });
    fetchModels(provider, apiKey, apiEndpoint)
      .then((models) => { if (!cancelled) setCatalog({ status: 'ready', models }); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCatalog({ status: 'error', message: err instanceof Error ? err.message : 'Could not load models' });
      });
    return () => { cancelled = true; };
  }, [provider, apiKey, apiEndpoint]);

  const allModels = catalog.status === 'ready' ? catalog.models : [];

  // Vision filtering only bites where the provider publishes modalities;
  // elsewhere every model has unknown capability and is kept.
  const shownModels = useMemo(
    () => (visionOnly ? visionCapable(allModels) : allModels),
    [allModels, visionOnly],
  );

  const hiddenCount = allModels.length - shownModels.length;
  const selected = allModels.find((m) => m.id === model) ?? null;
  const inList = shownModels.some((m) => m.id === model);
  const useSelect = shownModels.length > 0 && !customModel;

  const onProviderChange = useCallback((next: ProviderId) => {
    setConnectError(null);
    setCustomModel(false);
    setApiConfig({ provider: next });
  }, [setApiConfig]);

  const onModelChange = useCallback((next: string, info?: ModelInfo | null) => {
    setApiConfig({ model: next, supportsThinking: info?.supportsReasoning });
  }, [setApiConfig]);

  const connect = useCallback(async () => {
    setConnectError(null);
    try {
      await startOpenRouterSignIn();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Could not start sign-in');
    }
  }, []);

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor="ai-provider">Provider</Label>
        <select
          id="ai-provider"
          value={providerId}
          onChange={(e) => onProviderChange(e.target.value as ProviderId)}
          className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
          style={inputStyle}
        >
          {PROVIDER_IDS.map((id) => (
            <option key={id} value={id}>{getProvider(id).label}</option>
          ))}
        </select>
      </div>

      {/* Credential: a connect button for OAuth providers, a key field otherwise. */}
      {provider.auth === 'oauth-pkce' ? (
        <div>
          <Label>Connection</Label>
          {apiKey ? (
            <div className="flex items-center gap-2">
              <span className="text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>
                Connected to {provider.label}
              </span>
              <button
                onClick={() => setApiConfig({ apiKey: '' })}
                className="text-xs px-3 py-1.5 rounded"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              onClick={() => void connect()}
              className="text-xs px-3 py-1.5 rounded font-medium"
              style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
            >
              Connect {provider.label}
            </button>
          )}
          {connectError && (
            <p className="text-[10px] mt-1" style={{ color: 'var(--danger, #f87171)' }}>{connectError}</p>
          )}
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>{provider.credentialHint}</p>
        </div>
      ) : (
        <div>
          <Label htmlFor="ai-api-key">API Key</Label>
          <input
            id="ai-api-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiConfig({ apiKey: e.target.value })}
            placeholder="Enter API key..."
            className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
            style={inputStyle}
          />
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
            Stored in your browser only. Never sent to our servers.
          </p>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label htmlFor="ai-model" className="mb-0">Model</Label>
          {allModels.length > 0 && (
            <label className="flex items-center gap-1.5 text-[10px] cursor-pointer" style={{ color: 'var(--text-muted)' }}>
              <input type="checkbox" checked={visionOnly} onChange={(e) => setVisionOnly(e.target.checked)} />
              Vision-capable only
            </label>
          )}
        </div>

        {useSelect ? (
          <select
            id="ai-model"
            value={inList ? model : CUSTOM}
            onChange={(e) => {
              if (e.target.value === CUSTOM) { setCustomModel(true); return; }
              onModelChange(e.target.value, shownModels.find((m) => m.id === e.target.value));
            }}
            className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
            style={inputStyle}
          >
            {!inList && <option value={CUSTOM}>{model || 'Select a model'}</option>}
            {shownModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
            <option value={CUSTOM}>Custom…</option>
          </select>
        ) : (
          <input
            id="ai-model"
            value={model}
            onChange={(e) => onModelChange(e.target.value, null)}
            placeholder={provider.defaultModel}
            className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
            style={inputStyle}
          />
        )}

        <div className="text-[10px] mt-1 space-y-0.5" style={{ color: 'var(--text-muted)' }}>
          {catalog.status === 'loading' && <p>Loading models…</p>}
          {catalog.status === 'error' && (
            <p>{catalog.message} — enter a model id manually.</p>
          )}
          {selected && (
            <p>
              {[formatContext(selected), formatPricing(selected)].filter(Boolean).join(' · ')}
              {selected.supportsImages === false && ' · cannot accept images'}
            </p>
          )}
          {selected?.supportsImages === false && (
            <p style={{ color: 'var(--danger, #f87171)' }}>
              Sinter sends viewport renders with every message; this model will ignore them.
            </p>
          )}
          {visionOnly && hiddenCount > 0 && (
            <p>{hiddenCount} text-only model{hiddenCount === 1 ? '' : 's'} hidden.</p>
          )}
          {customModel && shownModels.length > 0 && (
            <button className="underline" onClick={() => setCustomModel(false)}>Back to the model list</button>
          )}
        </div>
      </div>

      <div>
        <Label htmlFor="ai-endpoint">API Endpoint <span style={{ opacity: 0.5 }}>(optional)</span></Label>
        <input
          id="ai-endpoint"
          value={apiEndpoint}
          onChange={(e) => setApiConfig({ apiEndpoint: e.target.value })}
          placeholder={provider.baseUrl}
          className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
          style={inputStyle}
        />
      </div>
    </div>
  );
}

function Label({ htmlFor, children, className = '' }: { htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <label
      htmlFor={htmlFor}
      className={`text-[10px] uppercase font-mono tracking-wider block mb-1 ${className}`}
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </label>
  );
}
