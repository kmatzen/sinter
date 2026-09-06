import { NODE_DEFAULTS, type SDFNodeUI } from './operations';

interface Rule { min?: number; max?: number; integer?: boolean; boolean?: boolean }
type Schema = Record<string, Rule>;

const positive = { min: 0.1 };
const bounded = (min: number, max: number, integer = false): Rule => ({ min, max, integer });

export const PARAMETER_SCHEMAS: Record<string, Schema> = {
  box: { width: positive, height: positive, depth: positive },
  sphere: { radius: positive },
  cylinder: { radius: positive, height: positive },
  torus: { majorRadius: positive, minorRadius: positive },
  cone: { radius: positive, height: positive },
  capsule: { radius: positive, height: positive },
  ellipsoid: { width: positive, height: positive, depth: positive },
  text: { size: { min: 1 }, depth: positive },
  mesh: { resolution: bounded(8, 96, true) },
  union: { smooth: bounded(0, 20) },
  subtract: { smooth: bounded(0, 20) },
  intersect: { smooth: bounded(0, 20) },
  shell: { thickness: bounded(0.1, 20) },
  offset: { distance: bounded(-20, 20) },
  round: { radius: bounded(0, 20) },
  translate: { x: bounded(-1e6, 1e6), y: bounded(-1e6, 1e6), z: bounded(-1e6, 1e6) },
  rotate: { x: bounded(-1e6, 1e6), y: bounded(-1e6, 1e6), z: bounded(-1e6, 1e6) },
  scale: { x: bounded(0.01, 1000), y: bounded(0.01, 1000), z: bounded(0.01, 1000) },
  mirror: { mirrorX: { boolean: true }, mirrorY: { boolean: true }, mirrorZ: { boolean: true } },
  halfSpace: { axis: bounded(0, 2, true), position: bounded(-1e6, 1e6), flip: { boolean: true } },
  linearPattern: {
    axisX: bounded(-1, 1), axisY: bounded(-1, 1), axisZ: bounded(-1, 1),
    count: bounded(2, 50, true), spacing: bounded(0.1, 1e6),
  },
  circularPattern: {
    axisX: bounded(-1, 1), axisY: bounded(-1, 1), axisZ: bounded(-1, 1), count: bounded(2, 50, true),
  },
};

function applyRule(value: number, rule: Rule): number {
  let out = rule.boolean ? (value ? 1 : 0) : value;
  if (rule.integer) out = Math.round(out);
  if (rule.min !== undefined) out = Math.max(rule.min, out);
  if (rule.max !== undefined) out = Math.min(rule.max, out);
  return out;
}

/** Normalize a complete parameter record from a document or preset. */
export function normalizeNodeParams(kind: string, input: Record<string, number> | undefined): Record<string, number> {
  const schema = PARAMETER_SCHEMAS[kind] || {};
  const defaults = NODE_DEFAULTS[kind] || {};
  const out: Record<string, number> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = input?.[key];
    out[key] = applyRule(typeof value === 'number' && Number.isFinite(value) ? value : fallback, schema[key] || {});
  }
  // Preserve finite forward-compatible parameters that this client does not
  // understand; unsafe numeric payloads never enter the live tree.
  for (const [key, value] of Object.entries(input || {})) {
    if (!(key in out) && Number.isFinite(value)) out[key] = value;
  }

  if (kind === 'torus') out.minorRadius = Math.min(out.minorRadius, out.majorRadius);
  if ((kind === 'linearPattern' || kind === 'circularPattern')
      && Math.hypot(out.axisX ?? 0, out.axisY ?? 0, out.axisZ ?? 0) < 1e-8) {
    Object.assign(out, kind === 'linearPattern' ? { axisX: 1, axisY: 0, axisZ: 0 } : { axisX: 0, axisY: 1, axisZ: 0 });
  }
  return out;
}

/** Apply one editor mutation atomically; non-finite input rejects the patch. */
export function applyNodeParamPatch(node: SDFNodeUI, patch: Record<string, number>): { params?: Record<string, number>; error?: string } {
  for (const [key, value] of Object.entries(patch)) {
    if (!Number.isFinite(value)) return { error: `${key} must be a finite number` };
  }
  return { params: normalizeNodeParams(node.kind, { ...node.params, ...patch }) };
}

export function normalizeTreeParams(node: SDFNodeUI | null): SDFNodeUI | null {
  if (!node) return null;
  return { ...node, params: normalizeNodeParams(node.kind, node.params), children: node.children.map((child) => normalizeTreeParams(child)!) };
}
