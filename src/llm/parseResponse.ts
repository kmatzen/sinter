import type { SDFNodeUI } from '../types/operations';

export interface ReplaceAction {
  action: 'replace';
  tree: SDFNodeUI;
}

export interface ModifyAction {
  action: 'modify';
  changes: { update: string; params: Record<string, number> }[];
}

export type ParsedResponse = ReplaceAction | ModifyAction | null;

export function parseResponse(response: string): ParsedResponse {
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
      const tree = validateNode(parsed.tree);
      if (tree) return { action: 'replace', tree };
    }

    if (parsed.action === 'modify' && Array.isArray(parsed.changes)) {
      return { action: 'modify', changes: parsed.changes };
    }

    // If it looks like a bare tree node (has kind + params), treat as replace
    if (parsed.kind && parsed.params) {
      const tree = validateNode(parsed);
      if (tree) return { action: 'replace', tree };
    }

    return null;
  } catch {
    return null;
  }
}

function validateNode(obj: any): SDFNodeUI | null {
  if (!obj || !obj.kind || !obj.params) return null;
  return {
    id: String(obj.id || crypto.randomUUID()),
    kind: obj.kind,
    label: String(obj.label || obj.kind),
    params: obj.params,
    children: Array.isArray(obj.children)
      ? obj.children.map(validateNode).filter((c: any): c is SDFNodeUI => c !== null)
      : [],
    enabled: obj.enabled !== false,
  };
}
