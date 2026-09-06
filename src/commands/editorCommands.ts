import { getEngineRef } from '../engine/engineRef';
import { useModelerStore } from '../store/modelerStore';
import { useProjectStore } from '../store/projectStore';
import { useViewportStore } from '../store/viewportStore';
import { isTreeExportable, NODE_LABELS } from '../types/operations';

export type CommandCategory = 'Project' | 'Edit' | 'Add' | 'Tree' | 'View' | 'Help';

export interface EditorCommand {
  id: string;
  title: string;
  category: CommandCategory;
  aliases?: string[];
  shortcut?: string;
  shortcutDescription?: string;
  unavailableReason?: () => string | null;
  run: () => void | Promise<unknown>;
}

export const OPEN_COMMAND_PALETTE_EVENT = 'sinter-open-command-palette';
export const TOOLBAR_COMMAND_EVENT = 'sinter-toolbar-command';
export const TOGGLE_SHORTCUT_HELP_EVENT = 'sinter-toggle-shortcut-help';

function toolbar(id: string): void {
  window.dispatchEvent(new CustomEvent(TOOLBAR_COMMAND_EVENT, { detail: id }));
}

const selectedReason = () => useModelerStore.getState().selectedNodeId ? null : 'Select a node first';
const treeReason = () => useModelerStore.getState().tree ? null : 'Add geometry first';
const pasteReason = () => {
  const state = useModelerStore.getState();
  if (!state.clipboard) return 'Copy a node first';
  return state.tree && !state.selectedNodeId ? 'Select a destination node first' : null;
};
const exportReason = () => {
  const state = useModelerStore.getState();
  if (!state.tree) return 'Add geometry first';
  if (!isTreeExportable(state.tree)) return 'Complete every enabled operation first';
  if (state.evaluating || !state.sdfDisplay || state.evaluatedTree !== state.tree) return 'Wait for model evaluation to finish';
  return null;
};

const primitives = ['box', 'sphere', 'cylinder', 'torus', 'cone', 'capsule', 'ellipsoid'];
const wrappers = ['union', 'subtract', 'intersect', 'shell', 'offset', 'round', 'mirror', 'halfSpace', 'linearPattern', 'circularPattern', 'translate', 'rotate', 'scale'];

export const editorCommands: EditorCommand[] = [
  { id: 'project.new', title: 'New project', category: 'Project', aliases: ['clear document'], run: () => toolbar('new') },
  { id: 'project.open', title: 'Open projects', category: 'Project', aliases: ['files'], run: () => toolbar('open') },
  { id: 'project.import-project', title: 'Import project file', category: 'Project', aliases: ['open json', 'upload project'], run: () => toolbar('import-project') },
  { id: 'project.import-mesh', title: 'Import STL mesh', category: 'Project', aliases: ['upload mesh'], run: () => toolbar('import-mesh') },
  { id: 'project.save', title: 'Save project', category: 'Project', aliases: ['cloud'], shortcut: 'Mod+S', shortcutDescription: 'Save project', run: () => { void useProjectStore.getState().save(); } },
  { id: 'project.export-stl', title: 'Export STL', category: 'Project', unavailableReason: exportReason, run: () => toolbar('export-stl') },
  { id: 'project.export-3mf', title: 'Export 3MF', category: 'Project', unavailableReason: exportReason, run: () => toolbar('export-3mf') },
  { id: 'project.share', title: 'Create or copy share link', category: 'Project', aliases: ['publish link'], unavailableReason: () => useProjectStore.getState().projectId ? null : 'Save the project to cloud first', run: () => toolbar('share') },
  { id: 'project.versions', title: 'Open project versions', category: 'Project', aliases: ['checkpoints', 'history'], unavailableReason: () => useProjectStore.getState().projectId ? null : 'Save the project to cloud first', run: () => toolbar('versions') },
  { id: 'project.settings', title: 'Open settings', category: 'Project', aliases: ['preferences'], run: () => toolbar('settings') },

  { id: 'edit.undo', title: 'Undo', category: 'Edit', shortcut: 'Mod+Z', shortcutDescription: 'Undo', unavailableReason: () => useModelerStore.getState().historyIndex > 0 ? null : 'Nothing to undo', run: () => useModelerStore.getState().undo() },
  { id: 'edit.redo', title: 'Redo', category: 'Edit', shortcut: 'Mod+Shift+Z', shortcutDescription: 'Redo', unavailableReason: () => { const s = useModelerStore.getState(); return s.historyIndex < s.history.length - 1 ? null : 'Nothing to redo'; }, run: () => useModelerStore.getState().redo() },
  { id: 'edit.copy', title: 'Copy selected node', category: 'Edit', shortcut: 'Mod+C', shortcutDescription: 'Copy node', unavailableReason: selectedReason, run: () => useModelerStore.getState().copySelected() },
  { id: 'edit.paste', title: 'Paste node', category: 'Edit', shortcut: 'Mod+V', shortcutDescription: 'Paste node', unavailableReason: pasteReason, run: () => useModelerStore.getState().pasteToSelected() },
  { id: 'edit.duplicate', title: 'Duplicate selected node', category: 'Edit', shortcut: 'Mod+D', shortcutDescription: 'Duplicate node', unavailableReason: selectedReason, run: () => useModelerStore.getState().duplicateSelected() },
  { id: 'edit.delete', title: 'Delete selected node', category: 'Edit', shortcut: 'Delete', shortcutDescription: 'Remove selected node', unavailableReason: selectedReason, run: () => { const s = useModelerStore.getState(); if (s.selectedNodeId) s.removeNode(s.selectedNodeId); } },
  { id: 'tree.simplify', title: 'Simplify model tree', category: 'Tree', aliases: ['normalize'], unavailableReason: treeReason, run: () => useModelerStore.getState().simplifyTree() },
  { id: 'tree.toggle-selected', title: 'Enable or disable selected node', category: 'Tree', aliases: ['toggle visibility'], unavailableReason: selectedReason, run: () => { const s = useModelerStore.getState(); if (s.selectedNodeId) s.toggleNode(s.selectedNodeId); } },
  { id: 'tree.expand-all', title: 'Expand all tree nodes', category: 'Tree', unavailableReason: treeReason, run: () => useModelerStore.getState().expandAll() },
  { id: 'tree.collapse-all', title: 'Collapse all tree nodes', category: 'Tree', unavailableReason: treeReason, run: () => useModelerStore.getState().collapseAll() },

  ...primitives.map((kind): EditorCommand => ({
    id: `add.${kind}`, title: `Add ${NODE_LABELS[kind]}`, category: 'Add', aliases: [kind, 'shape', 'primitive'],
    run: () => useModelerStore.getState().addPrimitive(kind),
  })),
  ...wrappers.map((kind): EditorCommand => ({
    id: `wrap.${kind}`, title: `Wrap selection in ${NODE_LABELS[kind]}`, category: 'Add', aliases: [kind, 'operation', 'modifier'],
    unavailableReason: selectedReason, run: () => useModelerStore.getState().wrapSelected(kind),
  })),

  { id: 'view.move', title: 'Toggle move tool', category: 'View', shortcut: 'W', shortcutDescription: 'Move tool', run: () => { const s = useViewportStore.getState(); s.setGizmoMode(s.gizmoMode === 'translate' ? 'none' : 'translate'); } },
  { id: 'view.rotate', title: 'Toggle rotate tool', category: 'View', shortcut: 'E', shortcutDescription: 'Rotate tool', run: () => { const s = useViewportStore.getState(); s.setGizmoMode(s.gizmoMode === 'rotate' ? 'none' : 'rotate'); } },
  { id: 'view.scale', title: 'Toggle scale tool', category: 'View', shortcut: 'R', shortcutDescription: 'Scale tool', run: () => { const s = useViewportStore.getState(); s.setGizmoMode(s.gizmoMode === 'scale' ? 'none' : 'scale'); } },
  { id: 'view.frame-all', title: 'Frame all geometry', category: 'View', shortcut: 'F', shortcutDescription: 'Frame all geometry', run: () => getEngineRef()?.zoomToFit() },
  { id: 'view.frame-selection', title: 'Frame selected node', category: 'View', shortcut: 'Shift+F', shortcutDescription: 'Frame selected operation', run: () => getEngineRef()?.frameSelection() },
  { id: 'view.projection', title: 'Toggle perspective / orthographic', category: 'View', aliases: ['camera projection'], run: () => { const s = useViewportStore.getState(); s.setProjection(s.projection === 'perspective' ? 'orthographic' : 'perspective'); } },
  { id: 'view.dimensions', title: 'Toggle dimensions', category: 'View', run: () => useViewportStore.getState().toggleDimensions() },
  { id: 'view.measure', title: 'Measure surfaces', category: 'View', aliases: ['ruler'], run: () => useViewportStore.getState().toggleMeasurementMode() },
  { id: 'view.clipping', title: 'Toggle clipping plane', category: 'View', aliases: ['section cut'], run: () => useViewportStore.getState().toggleClip() },
  { id: 'view.clear-tool', title: 'Deselect transform tool', category: 'View', shortcut: 'Escape', shortcutDescription: 'Deselect tool', run: () => useViewportStore.getState().setGizmoMode('none') },
  { id: 'help.command-palette', title: 'Open command palette', category: 'Help', aliases: ['search actions'], shortcut: 'Mod+K', shortcutDescription: 'Open command palette', run: () => { window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT)); } },
  { id: 'help.shortcuts', title: 'Keyboard shortcuts and accessibility help', category: 'Help', aliases: ['help'], shortcut: '?', shortcutDescription: 'Toggle shortcut help', run: () => { window.dispatchEvent(new Event(TOGGLE_SHORTCUT_HELP_EVENT)); } },
];

export function commandById(id: string): EditorCommand | undefined {
  return editorCommands.find((command) => command.id === id);
}

export function runEditorCommand(id: string): boolean {
  const command = commandById(id);
  if (!command || command.unavailableReason?.()) return false;
  void command.run();
  return true;
}

export function validateCommandRegistry(commands = editorCommands): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const shortcuts = new Map<string, string>();
  for (const command of commands) {
    if (ids.has(command.id)) errors.push(`Duplicate command id: ${command.id}`);
    ids.add(command.id);
    if (command.shortcut) {
      const key = command.shortcut.toLowerCase();
      const previous = shortcuts.get(key);
      if (previous) errors.push(`Shortcut ${command.shortcut} conflicts between ${previous} and ${command.id}`);
      shortcuts.set(key, command.id);
    }
  }
  return errors;
}

export function searchCommands(query: string, commands = editorCommands): EditorCommand[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return commands;
  return commands.filter((command) => {
    const haystack = [command.title, command.category, command.shortcut, ...(command.aliases ?? [])].filter(Boolean).join(' ').toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export const shortcutHelpCommands = editorCommands.filter((command) => command.shortcut && command.shortcutDescription);
