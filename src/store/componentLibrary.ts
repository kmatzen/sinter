import { create } from 'zustand';
import type { NamedParameter, SDFNodeUI } from '../types/operations';
import type { ReusableComponent } from '../types/component';
import { decodeTree, MAX_PROJECT_JSON_CHARS } from '../types/documentDecoder';

export const COMPONENT_FILE_VERSION = 1;
export const COMPONENT_FILE_EXTENSION = '.sinter-component.json';
const STORAGE_KEY = 'sinter.personal-components.v1';
const MAX_COMPONENTS = 100;

export type PersonalComponent = ReusableComponent;

interface ProjectLibraryState {
  components: ReusableComponent[];
  replace: (components: ReusableComponent[]) => void;
  add: (component: ReusableComponent) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

export const useProjectComponentStore = create<ProjectLibraryState>((set, get) => ({
  components: [],
  replace: (components) => set({ components: components.map(decodeComponent) }),
  add: (component) => {
    const decoded = decodeComponent(component);
    if (get().components.some((item) => item.name.localeCompare(decoded.name, undefined, { sensitivity: 'accent' }) === 0)) throw new Error(`A project component named “${decoded.name}” already exists`);
    set({ components: [decoded, ...get().components] });
  },
  rename: (id, name) => {
    const normalized = name.trim();
    if (get().components.some((item) => item.id !== id && item.name.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)) throw new Error(`A project component named “${normalized}” already exists`);
    set({ components: get().components.map((item) => item.id === id ? decodeComponent({ ...item, name: normalized, updatedAt: new Date().toISOString() }) : item) });
  },
  remove: (id) => set({ components: get().components.filter((item) => item.id !== id) }),
}));

interface ComponentFile { version: 1; component: PersonalComponent }

function text(value: unknown, label: string, max: number, required = false): string {
  if (typeof value !== 'string') throw new Error(`${label} must be text`);
  const result = value.trim();
  if (required && !result) throw new Error(`${label} is required`);
  if (result.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return result;
}

function decodeParameters(value: unknown): NamedParameter[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error('Component parameters are invalid');
  const names = new Set<string>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error(`Parameter ${index + 1} is invalid`);
    const raw = entry as Record<string, unknown>;
    const name = text(raw.name, `Parameter ${index + 1} name`, 48, true);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Parameter “${name}” has an invalid name`);
    if (names.has(name)) throw new Error(`Parameter “${name}” is declared twice`);
    names.add(name);
    const expression = text(raw.expression, `Parameter ${name} expression`, 256, true);
    if (raw.unit !== 'mm' && raw.unit !== 'deg' && raw.unit !== 'unitless') throw new Error(`Parameter “${name}” has an invalid unit`);
    return { name, expression, unit: raw.unit };
  });
}

function preview(kind: string): string {
  const label = kind.slice(0, 2).toUpperCase().replace(/[^A-Z0-9]/g, '') || '3D';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64"><rect width="96" height="64" rx="8" fill="#171b22"/><path d="M48 10 73 24v27L48 64 23 51V24z" fill="#263545" stroke="#5b9ee8" stroke-width="2"/><path d="M23 24 48 38l25-14M48 38v26" fill="none" stroke="#8bbbf0"/><text x="48" y="27" text-anchor="middle" font-family="monospace" font-size="11" fill="#eef6ff">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function decodeComponent(input: unknown): PersonalComponent {
  if (!input || typeof input !== 'object') throw new Error('Component file must contain an object');
  const raw = input as Record<string, unknown>;
  const node = decodeTree(raw.node);
  if (!node) throw new Error('Component subtree is empty');
  const tagsRaw = raw.tags;
  if (!Array.isArray(tagsRaw) || tagsRaw.length > 10) throw new Error('Component tags are invalid');
  const tags = [...new Set(tagsRaw.map((tag, i) => text(tag, `Tag ${i + 1}`, 32, true).toLowerCase()))];
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt)) ? raw.updatedAt : createdAt;
  return {
    id: text(raw.id, 'Component id', 80, true),
    name: text(raw.name, 'Component name', 80, true),
    description: text(raw.description ?? '', 'Component description', 500),
    tags,
    thumbnail: typeof raw.thumbnail === 'string' && raw.thumbnail.startsWith('data:image/') ? raw.thumbnail : preview(node.kind),
    node,
    parameters: decodeParameters(raw.parameters ?? []),
    createdAt,
    updatedAt,
  };
}

export function readPersonalComponents(): PersonalComponent[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_PROJECT_JSON_CHARS) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_COMPONENTS).map(decodeComponent);
  } catch { return []; }
}

/** Keep only declarations reachable from this subtree, including parameter-to-parameter dependencies. */
export function componentParameters(node: SDFNodeUI, available: NamedParameter[]): NamedParameter[] {
  const byName = new Map(available.map((parameter) => [parameter.name, parameter]));
  const required = new Set<string>();
  const scan = (expression: string) => {
    for (const token of expression.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      if (!byName.has(token) || required.has(token)) continue;
      required.add(token);
      scan(byName.get(token)!.expression);
    }
  };
  const visit = (current: SDFNodeUI) => {
    Object.values(current.expressions ?? {}).forEach(scan);
    current.children.forEach(visit);
  };
  visit(node);
  return available.filter((parameter) => required.has(parameter.name)).map((parameter) => ({ ...parameter }));
}

function write(components: PersonalComponent[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(components.slice(0, MAX_COMPONENTS))); }
  catch { throw new Error('Could not save the component. Browser storage may be full or unavailable.'); }
}

export function createPersonalComponent(node: SDFNodeUI, name: string, description: string, tags: string[], parameters: NamedParameter[]): PersonalComponent {
  const current = readPersonalComponents();
  const normalized = name.trim();
  if (current.some((item) => item.name.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)) throw new Error(`A component named “${normalized}” already exists`);
  const component = makeReusableComponent(node, normalized, description, tags, parameters);
  write([component, ...current]);
  return component;
}

export function makeReusableComponent(node: SDFNodeUI, name: string, description: string, tags: string[], parameters: NamedParameter[]): ReusableComponent {
  const now = new Date().toISOString();
  return decodeComponent({ id: crypto.randomUUID(), name, description, tags, thumbnail: preview(node.kind), node, parameters, createdAt: now, updatedAt: now });
}

export function renamePersonalComponent(id: string, name: string): void {
  const current = readPersonalComponents();
  const normalized = name.trim();
  if (current.some((item) => item.id !== id && item.name.localeCompare(normalized, undefined, { sensitivity: 'accent' }) === 0)) throw new Error(`A component named “${normalized}” already exists`);
  const index = current.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('Component no longer exists');
  current[index] = decodeComponent({ ...current[index], name: normalized, updatedAt: new Date().toISOString() });
  write(current);
}

export function deletePersonalComponent(id: string): void { write(readPersonalComponents().filter((item) => item.id !== id)); }

export function exportComponent(component: PersonalComponent): string {
  return JSON.stringify({ version: COMPONENT_FILE_VERSION, component } satisfies ComponentFile, null, 2);
}

export function importComponent(json: string): PersonalComponent {
  const component = parseComponentFile(json);
  const current = readPersonalComponents();
  if (current.some((item) => item.name.localeCompare(component.name, undefined, { sensitivity: 'accent' }) === 0)) throw new Error(`A component named “${component.name}” already exists`);
  write([component, ...current]);
  return component;
}

export function parseComponentFile(json: string): ReusableComponent {
  if (json.length > MAX_PROJECT_JSON_CHARS) throw new Error('Component file is too large');
  const file = JSON.parse(json) as Partial<ComponentFile>;
  if (file.version !== COMPONENT_FILE_VERSION) throw new Error('Unsupported component file version');
  return decodeComponent({ ...file.component, id: crypto.randomUUID(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}
