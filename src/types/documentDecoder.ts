import { NODE_DEFAULTS, NODE_LABELS, expectedChildren, type SDFNodeUI } from './operations';
import { normalizeNodeParams } from './parameterSchema';
import type { ProjectCheckpoint, ProjectFileBody } from '../storage/types';
import type { NamedParameter } from './operations';
import { hasValidCameraBasis, type NamedProjectView } from './view';
import { FormulaError, resolveNamedParameters, resolveTreeFormulas } from './formulas';
import { STLParseError, STL_TOPOLOGY_STATUS, validateSTLTopology } from '../worker/sdf/stl';
import { MODEL_SPATIAL_LIMIT_MM } from './modelingEnvelope';
import type { PinnedMeasurement } from './measurement';
import { DEFAULT_UNIT_PREFERENCES, type UnitPreferences } from './units';

export const CURRENT_DOCUMENT_VERSION = 2;
export const MAX_PROJECT_CHECKPOINTS = 10;
export const MAX_DOCUMENT_NODES = 1_000;
export const MAX_DOCUMENT_DEPTH = 64;
export const MAX_PROJECT_JSON_CHARS = 40 * 1024 * 1024;
export const MAX_MESH_BASE64_CHARS = 3 * 1024 * 1024;

const MAX_LABEL_CHARS = 256;
const MAX_PROJECT_NAME_CHARS = 256;
const MAX_THUMBNAIL_CHARS = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 10_000;
const MAX_GLYPH_CHARS = 2 * 1024 * 1024;
const MAX_GLYPH_SEGMENTS = 20_000;
const MAX_GLYPH_COORDINATE = 1_000_000;
const MAX_GENERIC_DATA_CHARS = 8 * 1024 * 1024;
const MAX_NAMED_PARAMETERS = 100;
const MAX_EXPRESSION_CHARS = 512;
const KNOWN_KINDS = new Set([...Object.keys(NODE_DEFAULTS), '_empty']);

export class DocumentDecodeError extends Error {
  constructor(message: string) {
    super(`Project validation failed: ${message}`);
    this.name = 'DocumentDecodeError';
  }
}

interface DecodeOptions {
  /** Legacy documents may omit IDs, labels, enabled, and newer parameters. */
  legacy?: boolean;
  /** AI nodes commonly omit IDs; synthesize stable path-derived IDs. */
  repairMissingIds?: boolean;
}

interface Context extends DecodeOptions {
  ids: Set<string>;
  nodes: number;
  stringChars: number;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DocumentDecodeError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function generatedId(path: number[], ids: Set<string>): string {
  const base = `migrated-${path.length ? path.join('-') : 'root'}`;
  let id = base;
  let suffix = 2;
  while (ids.has(id)) id = `${base}-${suffix++}`;
  return id;
}

function validateMeshPayload(value: string, path: string): void {
  if (value.length === 0 || value.length > MAX_MESH_BASE64_CHARS) {
    throw new DocumentDecodeError(`${path} mesh payload is empty or exceeds the 3 MiB encoded limit`);
  }
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new DocumentDecodeError(`${path} mesh payload is not valid base64`);
  }
  let binary: string;
  try { binary = atob(value); } catch { throw new DocumentDecodeError(`${path} mesh payload is not valid base64`); }
  if (binary.length === 0 || binary.length % 36 !== 0) {
    throw new DocumentDecodeError(`${path} mesh payload must contain whole Float32 triangles`);
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const values = new Float32Array(bytes.buffer);
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i]) || Math.abs(values[i]) > MODEL_SPATIAL_LIMIT_MM) {
      throw new DocumentDecodeError(`${path} mesh coordinate ${i} is non-finite or outside the ±${MODEL_SPATIAL_LIMIT_MM} mm modeling envelope`);
    }
  }
  try {
    validateSTLTopology(values);
  } catch (error) {
    if (error instanceof STLParseError) {
      throw new DocumentDecodeError(`${path} imported mesh is not a valid solid: ${error.message}`);
    }
    throw error;
  }
}

function accountString(context: Context, value: string): void {
  context.stringChars += value.length;
  if (context.stringChars > MAX_PROJECT_JSON_CHARS) {
    throw new DocumentDecodeError('document string data exceeds the supported size');
  }
}

function validateGlyphPayload(value: string, path: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(value); }
  catch { throw new DocumentDecodeError(`${path} glyph data is invalid JSON`); }
  const glyph = record(parsed, `${path}.data.glyphPaths`);
  const allowed = new Set(['segs', 'bezs', 'w', 'a', 'd']);
  for (const key of Object.keys(glyph)) {
    if (!allowed.has(key)) throw new DocumentDecodeError(`${path}.data.glyphPaths.${key} is not supported`);
  }
  const metric = (key: 'w' | 'a' | 'd') => {
    const number = glyph[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > MAX_GLYPH_COORDINATE) {
      throw new DocumentDecodeError(`${path}.data.glyphPaths.${key} must be a bounded finite number`);
    }
    return number;
  };
  const width = metric('w'), ascent = metric('a'), descent = metric('d');
  if (width <= 0 || ascent <= descent) {
    throw new DocumentDecodeError(`${path}.data.glyphPaths metrics do not describe a positive glyph box`);
  }
  const segments = glyph.segs ?? [];
  const beziers = glyph.bezs ?? [];
  if (!Array.isArray(segments) || !Array.isArray(beziers)) {
    throw new DocumentDecodeError(`${path}.data.glyphPaths outlines must be arrays`);
  }
  if (segments.length + beziers.length === 0 || segments.length + beziers.length > MAX_GLYPH_SEGMENTS) {
    throw new DocumentDecodeError(`${path}.data.glyphPaths outline count is empty or exceeds ${MAX_GLYPH_SEGMENTS}`);
  }
  const finiteCoordinate = (item: Record<string, unknown>, key: string, itemPath: string) => {
    const number = item[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > MAX_GLYPH_COORDINATE) {
      throw new DocumentDecodeError(`${itemPath}.${key} must be a bounded finite number`);
    }
  };
  segments.forEach((input, index) => {
    const itemPath = `${path}.data.glyphPaths.segs[${index}]`;
    const segment = record(input, itemPath);
    if (Object.keys(segment).some((key) => !['type', 'x0', 'y0', 'x1', 'y1'].includes(key))) {
      throw new DocumentDecodeError(`${itemPath} contains unsupported fields`);
    }
    if (segment.type !== 'L') throw new DocumentDecodeError(`${itemPath}.type must be L`);
    for (const key of ['x0', 'y0', 'x1', 'y1']) finiteCoordinate(segment, key, itemPath);
  });
  beziers.forEach((input, index) => {
    const itemPath = `${path}.data.glyphPaths.bezs[${index}]`;
    const bezier = record(input, itemPath);
    if (Object.keys(bezier).some((key) => !['type', 'x0', 'y0', 'x1', 'y1', 'x2', 'y2'].includes(key))) {
      throw new DocumentDecodeError(`${itemPath} contains unsupported fields`);
    }
    if (bezier.type !== 'Q') throw new DocumentDecodeError(`${itemPath}.type must be Q`);
    for (const key of ['x0', 'y0', 'x1', 'y1', 'x2', 'y2']) finiteCoordinate(bezier, key, itemPath);
  });
}

function decodeData(kind: string, input: unknown, path: string, context: Context): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  const raw = record(input, `${path}.data`);
  const allowed = kind === 'mesh' ? new Set(['meshPositions', 'meshName', 'meshTopology'])
    : kind === 'text' ? new Set(['text', 'glyphPaths']) : new Set<string>();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.length > 64) throw new DocumentDecodeError(`${path}.data contains an overlong key`);
    if ((kind === 'mesh' || kind === 'text') && !allowed.has(key)) {
      throw new DocumentDecodeError(`${path}.data.${key} is not supported for ${kind}`);
    }
    if (typeof value !== 'string') throw new DocumentDecodeError(`${path}.data.${key} must be a string`);
    accountString(context, value);
    if (key === 'meshPositions') validateMeshPayload(value, path);
    else if (key === 'text' && value.length > MAX_TEXT_CHARS) throw new DocumentDecodeError(`${path} text exceeds ${MAX_TEXT_CHARS} characters`);
    else if (key === 'glyphPaths') {
      if (value.length > MAX_GLYPH_CHARS) throw new DocumentDecodeError(`${path} glyph data is too large`);
      validateGlyphPayload(value, path);
    } else if (value.length > (allowed.has(key) ? MAX_LABEL_CHARS : MAX_GENERIC_DATA_CHARS)) {
      throw new DocumentDecodeError(`${path}.data.${key} is too long`);
    }
    out[key] = value;
  }
  if (kind === 'mesh' && typeof out.meshPositions !== 'string') {
    throw new DocumentDecodeError(`${path} imported mesh has no geometry payload`);
  }
  if (kind === 'mesh') out.meshTopology = STL_TOPOLOGY_STATUS;
  return Object.keys(out).length ? out : undefined;
}

function decodeNode(input: unknown, path: number[], depth: number, context: Context): SDFNodeUI {
  const labelPath = path.length ? `tree.children[${path.join('].children[')}]` : 'tree';
  if (depth > MAX_DOCUMENT_DEPTH) throw new DocumentDecodeError(`tree exceeds maximum depth ${MAX_DOCUMENT_DEPTH}`);
  if (++context.nodes > MAX_DOCUMENT_NODES) throw new DocumentDecodeError(`tree exceeds maximum node count ${MAX_DOCUMENT_NODES}`);
  const raw = record(input, labelPath);
  if (typeof raw.kind !== 'string' || !KNOWN_KINDS.has(raw.kind)) {
    throw new DocumentDecodeError(`${labelPath}.kind is unknown`);
  }
  const kind = raw.kind;

  let id: string;
  if (typeof raw.id === 'string' && raw.id.trim() && raw.id.length <= 128) id = raw.id;
  else if (context.legacy || context.repairMissingIds) id = generatedId(path, context.ids);
  else throw new DocumentDecodeError(`${labelPath}.id is missing or invalid`);
  if (context.ids.has(id)) throw new DocumentDecodeError(`duplicate node id at ${labelPath}`);
  context.ids.add(id);

  const defaults = NODE_DEFAULTS[kind] ?? {};
  const rawParams = record(raw.params ?? (context.legacy ? {} : undefined), `${labelPath}.params`);
  const params: Record<string, number> = {};
  for (const [key, value] of Object.entries(rawParams)) {
    if (!(key in defaults)) throw new DocumentDecodeError(`${labelPath}.params.${key} is not supported`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new DocumentDecodeError(`${labelPath}.params.${key} must be finite`);
    params[key] = value;
  }
  if (!context.legacy) {
    for (const key of Object.keys(defaults)) {
      if (!(key in params)) throw new DocumentDecodeError(`${labelPath}.params.${key} is required`);
    }
  }

  if (!Array.isArray(raw.children)) {
    if (!context.legacy) throw new DocumentDecodeError(`${labelPath}.children must be an array`);
  }
  const childrenInput = Array.isArray(raw.children) ? raw.children : [];
  const capacity = kind === '_empty' ? 0 : expectedChildren(kind);
  // Incomplete operations are valid editor state (the outline renders their
  // vacant inputs). Extra children are not: the evaluator ignores them, which
  // would make saved geometry silently differ from the document tree.
  if (childrenInput.length > capacity) {
    throw new DocumentDecodeError(`${labelPath} (${kind}) accepts at most ${capacity} child${capacity === 1 ? '' : 'ren'}`);
  }
  const children = childrenInput.map((child, index) => decodeNode(child, [...path, index], depth + 1, context));

  let label = NODE_LABELS[kind] ?? '';
  if (typeof raw.label === 'string') {
    if (raw.label.length > MAX_LABEL_CHARS) throw new DocumentDecodeError(`${labelPath}.label is too long`);
    label = raw.label || label;
    accountString(context, raw.label);
  } else if (!context.legacy && !context.repairMissingIds && kind !== '_empty') {
    throw new DocumentDecodeError(`${labelPath}.label must be a string`);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') {
    throw new DocumentDecodeError(`${labelPath}.enabled must be boolean`);
  }

  let group: string | undefined;
  if (raw.group !== undefined) {
    if (typeof raw.group !== 'string' || !raw.group.trim() || raw.group.length > MAX_LABEL_CHARS) {
      throw new DocumentDecodeError(`${labelPath}.group must be a non-empty string of at most ${MAX_LABEL_CHARS} characters`);
    }
    group = raw.group.trim();
    accountString(context, group);
  }

  const data = decodeData(kind, raw.data, labelPath, context);
  let expressions: Record<string, string> | undefined;
  if (raw.expressions !== undefined) {
    const input = record(raw.expressions, `${labelPath}.expressions`);
    expressions = {};
    for (const [key, value] of Object.entries(input)) {
      if (!(key in defaults)) throw new DocumentDecodeError(`${labelPath}.expressions.${key} is not a numeric property`);
      if (typeof value !== 'string' || !value.trim() || value.length > MAX_EXPRESSION_CHARS) {
        throw new DocumentDecodeError(`${labelPath}.expressions.${key} must be a non-empty expression of at most ${MAX_EXPRESSION_CHARS} characters`);
      }
      expressions[key] = value.trim();
    }
    if (!Object.keys(expressions).length) expressions = undefined;
  }
  const normalizedParams = normalizeNodeParams(kind, params);
  if (!context.legacy && kind !== 'rotate') {
    for (const key of Object.keys(defaults)) {
      if (!Object.is(normalizedParams[key], params[key])) {
        throw new DocumentDecodeError(
          `${labelPath}.params.${key} is outside the supported modeling domain; ` +
          `use a value that does not require clamping`,
        );
      }
    }
  }
  return {
    id, kind, label,
    params: normalizedParams,
    ...(group ? { group } : {}),
    ...(data ? { data } : {}),
    ...(expressions ? { expressions } : {}),
    children,
    enabled: raw.enabled !== false,
  };
}

export function decodeTree(input: unknown, options: DecodeOptions = {}): SDFNodeUI | null {
  if (input === null || input === undefined) return null;
  return decodeNode(input, [], 1, { ...options, ids: new Set(), nodes: 0, stringChars: 0 });
}

export interface DecodedProject {
  version: 2;
  projectName: string;
  thumbnail: string | null;
  tree: SDFNodeUI | null;
  checkpoints: Array<ProjectCheckpoint & { tree: SDFNodeUI | null }>;
  parameters: NamedParameter[];
  views: NamedProjectView[];
  measurements: PinnedMeasurement[];
  units: UnitPreferences;
}

const MAX_NAMED_VIEWS = 20;
const MAX_PINNED_MEASUREMENTS = 20;

function decodeUnitPreferences(input: unknown, path: string): UnitPreferences {
  if (input === undefined) return { ...DEFAULT_UNIT_PREFERENCES };
  const raw = record(input, path);
  if (raw.displayUnit !== 'mm' && raw.displayUnit !== 'cm' && raw.displayUnit !== 'm' &&
      raw.displayUnit !== 'in' && raw.displayUnit !== 'ft-in') {
    throw new DocumentDecodeError(`${path}.displayUnit is invalid`);
  }
  if (!Number.isInteger(raw.decimalPrecision) || (raw.decimalPrecision as number) < 0 || (raw.decimalPrecision as number) > 6) {
    throw new DocumentDecodeError(`${path}.decimalPrecision must be an integer from 0 to 6`);
  }
  if (![2, 4, 8, 16, 32, 64].includes(raw.fractionalDenominator as number)) {
    throw new DocumentDecodeError(`${path}.fractionalDenominator is invalid`);
  }
  return { displayUnit: raw.displayUnit, decimalPrecision: raw.decimalPrecision as number,
    fractionalDenominator: raw.fractionalDenominator as UnitPreferences['fractionalDenominator'] };
}

function finiteVec3(input: unknown, path: string): [number, number, number] {
  if (!Array.isArray(input) || input.length !== 3 || input.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new DocumentDecodeError(`${path} must contain three finite numbers`);
  }
  return [input[0] as number, input[1] as number, input[2] as number];
}

function lengthSquared(value: [number, number, number]): number {
  return value[0] ** 2 + value[1] ** 2 + value[2] ** 2;
}

function decodeNamedViews(input: unknown): NamedProjectView[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_NAMED_VIEWS) {
    throw new DocumentDecodeError(`project.views must contain at most ${MAX_NAMED_VIEWS} views`);
  }
  const ids = new Set<string>();
  return input.map((item, index) => {
    const path = `project.views[${index}]`;
    const raw = record(item, path);
    if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 128 || ids.has(raw.id)) throw new DocumentDecodeError(`${path}.id is missing, invalid, or duplicated`);
    ids.add(raw.id);
    if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > MAX_LABEL_CHARS) throw new DocumentDecodeError(`${path}.name is invalid`);
    if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) throw new DocumentDecodeError(`${path}.createdAt is invalid`);
    if (raw.projection !== 'perspective' && raw.projection !== 'orthographic') throw new DocumentDecodeError(`${path}.projection is invalid`);
    if (typeof raw.verticalSpan !== 'number' || !Number.isFinite(raw.verticalSpan) || raw.verticalSpan <= 0 || raw.verticalSpan > 100_000) throw new DocumentDecodeError(`${path}.verticalSpan is invalid`);
    const clipping = record(raw.clipping, `${path}.clipping`);
    if (typeof clipping.enabled !== 'boolean' || typeof clipping.flip !== 'boolean' ||
        (clipping.axis !== 'x' && clipping.axis !== 'y' && clipping.axis !== 'z') ||
        typeof clipping.position !== 'number' || !Number.isFinite(clipping.position)) throw new DocumentDecodeError(`${path}.clipping is invalid`);
    const position = finiteVec3(raw.position, `${path}.position`);
    const target = finiteVec3(raw.target, `${path}.target`);
    const up = finiteVec3(raw.up, `${path}.up`);
    const offset: [number, number, number] = [position[0] - target[0], position[1] - target[1], position[2] - target[2]];
    if (lengthSquared(offset) < 1e-12) throw new DocumentDecodeError(`${path}.position must differ from its target`);
    if (lengthSquared(up) < 1e-12) throw new DocumentDecodeError(`${path}.up must be non-zero`);
    if (!hasValidCameraBasis(position, target, up)) throw new DocumentDecodeError(`${path}.up must not be parallel to the viewing direction`);
    return {
      id: raw.id, name: raw.name.trim(), createdAt: raw.createdAt,
      position, target, up,
      projection: raw.projection, verticalSpan: raw.verticalSpan,
      clipping: { enabled: clipping.enabled, axis: clipping.axis, position: clipping.position, flip: clipping.flip },
    };
  });
}

function decodeMeasurements(input: unknown, path: string): PinnedMeasurement[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_PINNED_MEASUREMENTS) {
    throw new DocumentDecodeError(`${path} must contain at most ${MAX_PINNED_MEASUREMENTS} measurements`);
  }
  const ids = new Set<string>();
  return input.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const raw = record(item, itemPath);
    if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 128 || ids.has(raw.id)) {
      throw new DocumentDecodeError(`${itemPath}.id is missing, invalid, or duplicated`);
    }
    ids.add(raw.id);
    if (typeof raw.createdAt !== 'string' || !Number.isFinite(Date.parse(raw.createdAt))) {
      throw new DocumentDecodeError(`${itemPath}.createdAt is invalid`);
    }
    if (!Array.isArray(raw.anchors) || raw.anchors.length < 1 || raw.anchors.length > 3) {
      throw new DocumentDecodeError(`${itemPath}.anchors must contain one to three anchors`);
    }
    const anchors = raw.anchors.map((input, anchorIndex) => {
      const anchorPath = `${itemPath}.anchors[${anchorIndex}]`;
      const anchor = record(input, anchorPath);
      if (typeof anchor.nodeId !== 'string' || !anchor.nodeId || anchor.nodeId.length > 128) {
        throw new DocumentDecodeError(`${anchorPath}.nodeId is invalid`);
      }
      const normalized = finiteVec3(anchor.normalized, `${anchorPath}.normalized`);
      const fallback = finiteVec3(anchor.fallback, `${anchorPath}.fallback`);
      if ([...normalized, ...fallback].some((value) => Math.abs(value) > MODEL_SPATIAL_LIMIT_MM)) {
        throw new DocumentDecodeError(`${anchorPath} coordinates exceed the modeling envelope`);
      }
      let pathIds: string[] | undefined;
      if (anchor.path !== undefined) {
        if (!Array.isArray(anchor.path) || anchor.path.length < 1 || anchor.path.length > MAX_DOCUMENT_DEPTH ||
            anchor.path.some((id) => typeof id !== 'string' || !id || id.length > 128)) {
          throw new DocumentDecodeError(`${anchorPath}.path is invalid`);
        }
        pathIds = [...anchor.path] as string[];
        if (pathIds[pathIds.length - 1] !== anchor.nodeId) throw new DocumentDecodeError(`${anchorPath}.path must end at nodeId`);
      }
      const decodeInstanceMap = (input: unknown, field: string): Record<string, number> | undefined => {
        if (input === undefined) return undefined;
        const values = record(input, `${anchorPath}.${field}`);
        if (Object.keys(values).length > MAX_DOCUMENT_DEPTH) throw new DocumentDecodeError(`${anchorPath}.${field} has too many entries`);
        const result: Record<string, number> = {};
        for (const [id, value] of Object.entries(values)) {
          if (!id || id.length > 128 || typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 1_000) {
            throw new DocumentDecodeError(`${anchorPath}.${field}.${id} is invalid`);
          }
          result[id] = value;
        }
        return result;
      };
      let mirrorSigns: Record<string, [number, number, number]> | undefined;
      if (anchor.mirrorSigns !== undefined) {
        const values = record(anchor.mirrorSigns, `${anchorPath}.mirrorSigns`);
        if (Object.keys(values).length > MAX_DOCUMENT_DEPTH) throw new DocumentDecodeError(`${anchorPath}.mirrorSigns has too many entries`);
        mirrorSigns = {};
        for (const [id, value] of Object.entries(values)) {
          const signs = finiteVec3(value, `${anchorPath}.mirrorSigns.${id}`);
          if (!id || id.length > 128 || signs.some((sign) => sign !== -1 && sign !== 1)) throw new DocumentDecodeError(`${anchorPath}.mirrorSigns.${id} is invalid`);
          mirrorSigns[id] = signs;
        }
      }
      return {
        nodeId: anchor.nodeId, normalized, fallback,
        ...(pathIds ? { path: pathIds } : {}),
        ...(anchor.patternInstances !== undefined ? { patternInstances: decodeInstanceMap(anchor.patternInstances, 'patternInstances')! } : {}),
        ...(mirrorSigns ? { mirrorSigns } : {}),
      };
    });
    return { id: raw.id, createdAt: raw.createdAt, anchors };
  });
}

function decodeNamedParameters(input: unknown, path: string): NamedParameter[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > MAX_NAMED_PARAMETERS) {
    throw new DocumentDecodeError(`${path} must contain at most ${MAX_NAMED_PARAMETERS} parameters`);
  }
  const definitions = input.map((item, index): NamedParameter => {
    const raw = record(item, `${path}[${index}]`);
    if (typeof raw.name !== 'string' || raw.name.length > 64) throw new DocumentDecodeError(`${path}[${index}].name is invalid`);
    if (typeof raw.expression !== 'string' || raw.expression.length > MAX_EXPRESSION_CHARS) throw new DocumentDecodeError(`${path}[${index}].expression is invalid`);
    if (raw.unit !== 'mm' && raw.unit !== 'deg' && raw.unit !== 'unitless') throw new DocumentDecodeError(`${path}[${index}].unit is invalid`);
    return { name: raw.name, expression: raw.expression, unit: raw.unit };
  });
  try { resolveNamedParameters(definitions); }
  catch (error) { throw new DocumentDecodeError(error instanceof FormulaError ? `${path}: ${error.message}` : `${path} is invalid`); }
  return definitions;
}

/** Decode current cloud envelopes and migrate legacy exported/local envelopes. */
export function decodeProjectDocument(input: unknown, fallbackName = 'Untitled'): DecodedProject {
  const raw = record(input, 'project');
  const hasVersion = Object.prototype.hasOwnProperty.call(raw, 'version');
  if (hasVersion && raw.version !== 1 && raw.version !== CURRENT_DOCUMENT_VERSION) {
    throw new DocumentDecodeError(`document version ${String(raw.version)} is not supported by this app`);
  }
  const legacy = !hasVersion;
  if (!Object.prototype.hasOwnProperty.call(raw, 'tree')) throw new DocumentDecodeError('project.tree is required');
  const projectName = typeof raw.projectName === 'string' ? raw.projectName : fallbackName;
  if (projectName.length > MAX_PROJECT_NAME_CHARS) throw new DocumentDecodeError('project name is too long');
  const thumbnail = raw.thumbnail === undefined || raw.thumbnail === null ? null : raw.thumbnail;
  if (thumbnail !== null && (typeof thumbnail !== 'string' || thumbnail.length > MAX_THUMBNAIL_CHARS)) {
    throw new DocumentDecodeError('thumbnail is invalid or too large');
  }
  const checkpointInput = raw.version === 2 ? raw.checkpoints ?? [] : [];
  const parameters = raw.version === 2 ? decodeNamedParameters(raw.parameters, 'project.parameters') : [];
  const views = raw.version === 2 ? decodeNamedViews(raw.views) : [];
  const measurements = raw.version === 2 ? decodeMeasurements(raw.measurements, 'project.measurements') : [];
  const units = raw.version === 2 ? decodeUnitPreferences(raw.units, 'project.units') : { ...DEFAULT_UNIT_PREFERENCES };
  if (!Array.isArray(checkpointInput) || checkpointInput.length > MAX_PROJECT_CHECKPOINTS) {
    throw new DocumentDecodeError(`project checkpoints must be an array of at most ${MAX_PROJECT_CHECKPOINTS}`);
  }
  const checkpointIds = new Set<string>();
  const checkpoints = checkpointInput.map((input, index) => {
    const checkpoint = record(input, `project.checkpoints[${index}]`);
    if (typeof checkpoint.id !== 'string' || !checkpoint.id || checkpoint.id.length > 128 || checkpointIds.has(checkpoint.id)) {
      throw new DocumentDecodeError(`project.checkpoints[${index}].id is missing, invalid, or duplicated`);
    }
    checkpointIds.add(checkpoint.id);
    if (typeof checkpoint.name !== 'string' || !checkpoint.name.trim() || checkpoint.name.length > MAX_LABEL_CHARS) {
      throw new DocumentDecodeError(`project.checkpoints[${index}].name is invalid`);
    }
    if (typeof checkpoint.createdAt !== 'string' || !Number.isFinite(Date.parse(checkpoint.createdAt))) {
      throw new DocumentDecodeError(`project.checkpoints[${index}].createdAt is invalid`);
    }
    if (!Object.prototype.hasOwnProperty.call(checkpoint, 'tree')) {
      throw new DocumentDecodeError(`project.checkpoints[${index}].tree is required`);
    }
    const checkpointParameters = decodeNamedParameters(checkpoint.parameters, `project.checkpoints[${index}].parameters`);
    const checkpointViews = Object.prototype.hasOwnProperty.call(checkpoint, 'views')
      ? decodeNamedViews(checkpoint.views) : undefined;
    const checkpointMeasurements = Object.prototype.hasOwnProperty.call(checkpoint, 'measurements')
      ? decodeMeasurements(checkpoint.measurements, `project.checkpoints[${index}].measurements`) : undefined;
    const checkpointUnits = Object.prototype.hasOwnProperty.call(checkpoint, 'units')
      ? decodeUnitPreferences(checkpoint.units, `project.checkpoints[${index}].units`) : undefined;
    let tree = decodeTree(checkpoint.tree);
    try { tree = resolveTreeFormulas(tree, checkpointParameters); }
    catch (error) { throw new DocumentDecodeError(`project.checkpoints[${index}]: ${error instanceof Error ? error.message : 'invalid formulas'}`); }
    return {
      id: checkpoint.id,
      name: checkpoint.name.trim(),
      createdAt: checkpoint.createdAt,
      tree,
      parameters: checkpointParameters,
      ...(checkpointViews ? { views: checkpointViews } : {}),
      ...(checkpointMeasurements ? { measurements: checkpointMeasurements } : {}),
      ...(checkpointUnits ? { units: checkpointUnits } : {}),
    };
  });
  let tree = decodeTree(raw.tree, { legacy, repairMissingIds: legacy });
  try { tree = resolveTreeFormulas(tree, parameters); }
  catch (error) { throw new DocumentDecodeError(error instanceof Error ? error.message : 'project formulas are invalid'); }
  return {
    version: 2,
    projectName: projectName || fallbackName,
    thumbnail,
    tree,
    checkpoints,
    parameters,
    views,
    measurements,
    units,
  };
}

export function decodeProjectFileBody(input: unknown): ProjectFileBody {
  const decoded = decodeProjectDocument(input);
  return { version: 2, thumbnail: decoded.thumbnail, tree: decoded.tree, checkpoints: decoded.checkpoints, parameters: decoded.parameters, views: decoded.views, measurements: decoded.measurements, units: decoded.units };
}
