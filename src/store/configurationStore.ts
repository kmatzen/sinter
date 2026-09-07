import { create } from 'zustand';
import { useModelerStore } from './modelerStore';
import type { NamedParameter } from '../types/operations';
import type { NamedConfiguration } from '../types/configuration';
import { parametersForConfiguration } from '../types/configuration';
import { resolveNamedParameters, resolveTreeFormulas } from '../types/formulas';

interface ConfigurationState {
  configurations: NamedConfiguration[];
  activeId: string | null;
  baseParameters: NamedParameter[];
  reset: (configurations?: NamedConfiguration[], activeId?: string | null, baseParameters?: NamedParameter[]) => void;
  add: (name?: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  setOverride: (id: string, parameter: string, expression: string | null) => void;
  activate: (id: string | null) => void;
  refreshBase: () => void;
}

const cloneConfigurations = (items: NamedConfiguration[]) => items.map((item) => ({ ...item, overrides: { ...item.overrides } }));
function uniqueName(items: NamedConfiguration[], requested: string, exceptId?: string): string {
  const base = (requested.trim() || 'Configuration').slice(0, 80);
  const used = new Set(items.filter((item) => item.id !== exceptId).map((item) => item.name.toLocaleLowerCase()));
  if (!used.has(base.toLocaleLowerCase())) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base.slice(0, Math.max(1, 79 - String(suffix).length))} ${suffix}`;
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function apply(base: NamedParameter[], items: NamedConfiguration[], activeId: string | null): void {
  const active = items.find((item) => item.id === activeId);
  const parameters = parametersForConfiguration(base, active);
  resolveNamedParameters(parameters);
  const model = useModelerStore.getState();
  const tree = resolveTreeFormulas(model.tree, parameters);
  const history = [...model.history];
  const parameterHistory = [...model.parameterHistory];
  history[model.historyIndex] = tree;
  parameterHistory[model.historyIndex] = parameters;
  useModelerStore.setState({ tree, namedParameters: parameters, history, parameterHistory, error: null });
}

export const useConfigurationStore = create<ConfigurationState>((set, get) => ({
  configurations: [], activeId: null, baseParameters: [],
  reset: (configurations = [], activeId = null, baseParameters = useModelerStore.getState().namedParameters) => {
    const items = cloneConfigurations(configurations);
    const validActive = items.some((item) => item.id === activeId) ? activeId : null;
    set({ configurations: items, activeId: validActive, baseParameters: baseParameters.map((item) => ({ ...item })) });
  },
  add: (name) => {
    const state = get();
    const item = { id: crypto.randomUUID(), name: uniqueName(state.configurations, name || `Configuration ${state.configurations.length + 1}`), overrides: {} };
    set({ configurations: [...state.configurations, item] });
  },
  duplicate: (id) => set((state) => {
    const source = state.configurations.find((item) => item.id === id);
    if (!source) return state;
    return { configurations: [...state.configurations, { id: crypto.randomUUID(), name: uniqueName(state.configurations, `${source.name} copy`), overrides: { ...source.overrides } }] };
  }),
  remove: (id) => {
    const state = get();
    const items = state.configurations.filter((item) => item.id !== id);
    const activeId = state.activeId === id ? null : state.activeId;
    set({ configurations: items, activeId });
    if (activeId !== state.activeId) apply(state.baseParameters, items, activeId);
  },
  rename: (id, name) => set((state) => ({ configurations: state.configurations.map((item) => item.id === id ? { ...item, name: uniqueName(state.configurations, name || item.name, id) } : item) })),
  move: (id, direction) => set((state) => {
    const from = state.configurations.findIndex((item) => item.id === id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= state.configurations.length) return state;
    const configurations = [...state.configurations];
    [configurations[from], configurations[to]] = [configurations[to], configurations[from]];
    return { configurations };
  }),
  setOverride: (id, parameter, expression) => {
    const state = get();
    const items = state.configurations.map((item) => {
      if (item.id !== id) return item;
      const overrides = { ...item.overrides };
      if (expression === null || !expression.trim()) delete overrides[parameter];
      else overrides[parameter] = expression.trim();
      return { ...item, overrides };
    });
    // Resolve first; invalid expressions leave both the table and active model untouched.
    try { resolveNamedParameters(parametersForConfiguration(state.baseParameters, items.find((item) => item.id === id))); }
    catch (error) {
      useModelerStore.getState().setError(error instanceof Error ? error.message : 'Configuration override is invalid');
      return;
    }
    if (state.activeId === id) apply(state.baseParameters, items, id);
    set({ configurations: items });
  },
  activate: (id) => {
    const state = get();
    const activeId = id && state.configurations.some((item) => item.id === id) ? id : null;
    apply(state.baseParameters, state.configurations, activeId);
    set({ activeId });
  },
  refreshBase: () => {
    const state = get();
    const current = useModelerStore.getState().namedParameters;
    const previous = new Map(state.baseParameters.map((item) => [item.name, item]));
    const baseParameters = current.map((item) => state.activeId && previous.has(item.name) ? { ...item, expression: previous.get(item.name)!.expression } : { ...item });
    const names = new Set(baseParameters.map((item) => item.name));
    const configurations = state.configurations.map((item) => ({ ...item, overrides: Object.fromEntries(Object.entries(item.overrides).filter(([name]) => names.has(name))) }));
    set({ baseParameters, configurations });
  },
}));
