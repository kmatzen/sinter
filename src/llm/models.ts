// Model catalog.
//
// The model field used to be free text, so a typo surfaced as a raw 404 from
// the provider and nothing checked whether the chosen model could actually see
// an image — which matters because every Sinter request carries viewport
// renders. This module turns a provider's catalog endpoint into a normalised
// list the picker can filter and annotate.

import type { ProviderDef } from './providers';
import { resolveEndpoint } from './providers';

export interface ModelInfo {
  id: string;
  label: string;
  contextLength?: number;
  /**
   * Tri-state on purpose. `undefined` means the provider publishes no modality
   * metadata; that is different from "known to be text-only" and the two must
   * not be conflated, or we would hide working models behind a vision filter.
   */
  supportsImages?: boolean;
  supportsReasoning?: boolean;
  /** USD per token, as published. */
  promptPrice?: number;
  completionPrice?: number;
}

/** Credentials/headers a catalog request needs, which vary by wire format. */
function catalogHeaders(provider: ProviderDef, apiKey: string): Record<string, string> {
  if (provider.wire === 'anthropic') {
    return {
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      ...(apiKey ? { 'x-api-key': apiKey } : {}),
    };
  }
  // Sent only when present: OpenRouter's catalog is public, so the model list
  // can be browsed before the user connects an account.
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function num(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Normalise one raw catalog entry. Shapes differ per provider; ids do not. */
function normalize(raw: any, provider: ProviderDef): ModelInfo | null {
  const id = typeof raw?.id === 'string' ? raw.id : null;
  if (!id) return null;

  const info: ModelInfo = {
    id,
    label: typeof raw.name === 'string' ? raw.name
      : typeof raw.display_name === 'string' ? raw.display_name
      : id,
  };

  if (!provider.catalogHasCapabilities) return info;

  const modalities = raw?.architecture?.input_modalities;
  if (Array.isArray(modalities)) info.supportsImages = modalities.includes('image');

  const contextLength = num(raw?.context_length);
  if (contextLength !== undefined) info.contextLength = contextLength;

  const params = raw?.supported_parameters;
  if (Array.isArray(params)) info.supportsReasoning = params.includes('reasoning');

  const prompt = num(raw?.pricing?.prompt);
  if (prompt !== undefined) info.promptPrice = prompt;
  const completion = num(raw?.pricing?.completion);
  if (completion !== undefined) info.completionPrice = completion;

  return info;
}

/**
 * Fetch and normalise a provider's catalog.
 *
 * Throws on failure; callers are expected to fall back to free-text entry
 * rather than blocking the settings panel on a catalog the network ate.
 */
export async function fetchModels(
  provider: ProviderDef,
  apiKey: string,
  endpointOverride?: string,
): Promise<ModelInfo[]> {
  if (!provider.modelsPath) return [];
  const url = `${resolveEndpoint(provider, endpointOverride)}${provider.modelsPath}`;

  const res = await fetch(url, { headers: catalogHeaders(provider, apiKey) });
  if (!res.ok) {
    throw new Error(`Could not load ${provider.label} models (${res.status})`);
  }
  const body = await res.json();
  const rows: unknown[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];

  const models = rows
    .map((row) => normalize(row, provider))
    .filter((m): m is ModelInfo => m !== null);

  models.sort((a, b) => a.id.localeCompare(b.id));
  return models;
}

/**
 * Keep models that can accept an image. Unknown capability is kept: absence of
 * metadata is not evidence of absence of vision.
 */
export function visionCapable(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => m.supportsImages !== false);
}

/** "$3.00 / M in · $15.00 / M out" — published per-token prices, scaled. */
export function formatPricing(model: ModelInfo): string | null {
  if (model.promptPrice === undefined && model.completionPrice === undefined) return null;
  const perMillion = (v?: number) => (v === undefined ? '?' : `$${(v * 1_000_000).toFixed(2)}`);
  return `${perMillion(model.promptPrice)} / M in · ${perMillion(model.completionPrice)} / M out`;
}

export function formatContext(model: ModelInfo): string | null {
  if (!model.contextLength) return null;
  const k = model.contextLength / 1000;
  return k >= 1000 ? `${(k / 1000).toFixed(k % 1000 === 0 ? 0 : 1)}M context` : `${Math.round(k)}K context`;
}
