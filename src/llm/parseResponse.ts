import type { SDFNodeUI } from '../types/operations';
import { decodeTree, MAX_PROJECT_JSON_CHARS } from '../types/documentDecoder';

export interface ReplaceAction {
  action: 'replace';
  tree: SDFNodeUI;
}

export interface ModifyAction {
  action: 'modify';
  changes: Modification[];
}

export interface Modification {
  update?: string;
  params: Record<string, number>;
  addChild?: string;
  node?: unknown;
  remove?: string;
  wrapIn?: string;
  wrapper?: unknown;
}

export type ParsedResponse = ReplaceAction | ModifyAction | null;

const MAX_MODIFICATIONS = 100;

function shortId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function decodeModifications(input: unknown): Modification[] | null {
  if (!Array.isArray(input) || input.length > MAX_MODIFICATIONS) return null;
  const result: Modification[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const change = value as Record<string, unknown>;
    if (shortId(change.update) && change.params && typeof change.params === 'object' && !Array.isArray(change.params)) {
      const entries = Object.entries(change.params as Record<string, unknown>);
      if (entries.length > 32 || entries.some(([key, param]) => key.length > 64 || typeof param !== 'number' || !Number.isFinite(param))) return null;
      result.push({ update: change.update, params: Object.fromEntries(entries) as Record<string, number> });
    } else if (shortId(change.addChild) && change.node && typeof change.node === 'object') {
      result.push({ addChild: change.addChild, node: change.node, params: {} });
    } else if (shortId(change.remove)) {
      result.push({ remove: change.remove, params: {} });
    } else if (shortId(change.wrapIn) && change.wrapper && typeof change.wrapper === 'object') {
      result.push({ wrapIn: change.wrapIn, wrapper: change.wrapper, params: {} });
    } else return null;
  }
  return result;
}

export function parseResponse(response: string): ParsedResponse {
  if (response.length > MAX_PROJECT_JSON_CHARS) return null;
  const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  let jsonStr: string;

  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  } else {
    const firstBrace = response.indexOf('{');
    const lastBrace = response.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) return null;
    jsonStr = response.substring(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(jsonStr);

    if (parsed.action === 'replace' && parsed.tree) {
      const tree = decodeTree(parsed.tree, { repairMissingIds: true });
      if (tree) return { action: 'replace', tree };
    }

    if (parsed.action === 'modify' && Array.isArray(parsed.changes)) {
      const changes = decodeModifications(parsed.changes);
      if (changes) return { action: 'modify', changes };
    }

    // If it looks like a bare tree node (has kind + params), treat as replace
    if (parsed.kind && parsed.params) {
      const tree = decodeTree(parsed, { repairMissingIds: true });
      if (tree) return { action: 'replace', tree };
    }

    return null;
  } catch {
    return null;
  }
}
