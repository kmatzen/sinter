import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editorCommands, runEditorCommand, searchCommands, validateCommandRegistry } from './editorCommands';
import { useModelerStore } from '../store/modelerStore';

describe('editor command registry', () => {
  beforeEach(() => useModelerStore.getState().resetDocument(null, 'Untitled'));

  it('has unique ids and no shortcut conflicts', () => {
    expect(validateCommandRegistry()).toEqual([]);
  });

  it('searches title, aliases, category, and shortcut using all query terms', () => {
    expect(searchCommands('sphere shape').map((command) => command.id)).toContain('add.sphere');
    expect(searchCommands('cloud save').map((command) => command.id)).toContain('project.save');
    expect(searchCommands('mod+k').map((command) => command.id)).toEqual(['help.command-palette']);
    expect(searchCommands('definitely absent')).toEqual([]);
  });

  it('explains unavailable context and will not run a disabled command', () => {
    const remove = editorCommands.find((command) => command.id === 'edit.delete')!;
    expect(remove.unavailableReason?.()).toMatch(/select/i);
    const spy = vi.spyOn(useModelerStore.getState(), 'removeNode');
    expect(runEditorCommand('edit.delete')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('runs context-valid actions against the current selection deterministically', () => {
    expect(runEditorCommand('add.box')).toBe(true);
    const id = useModelerStore.getState().selectedNodeId;
    expect(id).not.toBeNull();
    expect(runEditorCommand('edit.delete')).toBe(true);
    expect(useModelerStore.getState().tree).toBeNull();
  });
});
