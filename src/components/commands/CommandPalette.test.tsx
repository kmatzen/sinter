import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette, rankCommands } from './CommandPalette';
import { editorCommands, OPEN_COMMAND_PALETTE_EVENT } from '../../commands/editorCommands';
import { useModelerStore } from '../../store/modelerStore';

describe('CommandPalette', () => {
  const storage = new Map<string, string>();
  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      clear: () => storage.clear(),
    });
    useModelerStore.getState().resetDocument(null, 'Untitled');
  });

  const open = () => act(() => { window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT)); });

  it('filters commands and invokes the active result', () => {
    render(<CommandPalette />);
    open();
    const search = screen.getByRole('textbox', { name: 'Search commands' });
    fireEvent.change(search, { target: { value: 'add sphere' } });
    expect(screen.getByRole('option', { name: /add sphere/i })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(useModelerStore.getState().tree?.kind).toBe('sphere');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('shows disabled reasons instead of hiding invalid actions', () => {
    render(<CommandPalette />);
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search commands' }), { target: { value: 'delete selected' } });
    const option = screen.getByRole('option', { name: /delete selected node/i });
    expect(option).toBeDisabled();
  });

  it('ranks recent commands first without changing filtered relevance', () => {
    const ranked = rankCommands([
      editorCommands.find((command) => command.id === 'project.new')!,
      editorCommands.find((command) => command.id === 'project.save')!,
    ], ['project.save']);
    expect(ranked[0].id).toBe('project.save');
  });

  it('ranks context-valid commands ahead of unavailable recent commands', () => {
    const ranked = rankCommands([
      editorCommands.find((command) => command.id === 'edit.delete')!,
      editorCommands.find((command) => command.id === 'add.sphere')!,
    ], ['edit.delete']);
    expect(ranked.map((command) => command.id)).toEqual(['add.sphere', 'edit.delete']);
  });

  it('supports keyboard navigation, Escape, and focus restoration', async () => {
    render(<><button>Opener</button><CommandPalette /></>);
    const opener = screen.getByRole('button', { name: 'Opener' });
    opener.focus();
    open();
    const search = screen.getByRole('textbox', { name: 'Search commands' });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
