// Provider registry.
//
// Providers used to be a closed union threaded by hand through llmService,
// chatStore and SettingsPage, so adding one meant editing all three. The two
// axes that actually vary are the wire format (how a request is shaped and a
// stream decoded) and the auth mode (how the user supplies a credential).
// Everything else is data, so a new provider is normally an entry in this
// table rather than new streaming code.

/** How requests are shaped and streams decoded. */
export type WireFormat = 'anthropic' | 'openai';

/** How the user supplies a credential. */
export type AuthMode = 'api-key' | 'oauth-pkce';

export type ProviderId = 'anthropic' | 'openai' | 'openrouter';

export interface ProviderDef {
  id: ProviderId;
  label: string;
  wire: WireFormat;
  auth: AuthMode;
  /** Origin used when the user has not overridden the endpoint. */
  baseUrl: string;
  defaultModel: string;
  /**
   * Catalog endpoint, relative to the active endpoint origin. Absent when the
   * provider publishes no machine-readable list.
   */
  modelsPath?: string;
  /**
   * True when the catalog carries capability metadata (modalities, pricing).
   * Where it does not, the picker must not claim to know what a model supports.
   */
  catalogHasCapabilities: boolean;
  /** Shown under the credential control in settings. */
  credentialHint: string;
}

export const PROVIDERS: Record<ProviderId, ProviderDef> = {
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    wire: 'anthropic',
    auth: 'api-key',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-opus-4-7',
    modelsPath: '/v1/models',
    catalogHasCapabilities: false,
    credentialHint: 'Create a key at console.anthropic.com. Stored in your browser only.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    wire: 'openai',
    auth: 'api-key',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o',
    modelsPath: '/v1/models',
    catalogHasCapabilities: false,
    credentialHint: 'Create a key at platform.openai.com. Stored in your browser only.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    // OpenRouter normalises to the OpenAI schema, so the existing adapter
    // handles it unchanged.
    wire: 'openai',
    auth: 'oauth-pkce',
    baseUrl: 'https://openrouter.ai/api',
    defaultModel: 'anthropic/claude-opus-5',
    modelsPath: '/v1/models',
    catalogHasCapabilities: true,
    credentialHint:
      'Connect once and OpenRouter bills your own account directly. Sinter never sees your payment details and never proxies your requests.',
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}

/** Registry lookup that tolerates an unknown persisted value. */
export function getProvider(id: unknown): ProviderDef {
  return isProviderId(id) ? PROVIDERS[id] : PROVIDERS.anthropic;
}

/**
 * The origin to talk to: an explicit user override wins, otherwise the
 * registry default. Trailing slashes are trimmed so callers can concatenate.
 */
export function resolveEndpoint(provider: ProviderDef, override?: string): string {
  const base = override?.trim() || provider.baseUrl;
  return base.replace(/\/+$/, '');
}
