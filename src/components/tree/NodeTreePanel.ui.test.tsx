import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelerStore } from '../../store/modelerStore';
import type { SDFNodeUI } from '../../types/operations';
import { NodeTreeContent } from './NodeTreePanel';
import { useTreeUiStore } from '../../store/treeUiStore';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });

const tree: SDFNodeUI = {
  id: 'root', kind: 'union', label: 'Assembly', params: { smooth: 0 }, enabled: true,
  children: [
    { id: 'body', kind: 'box', label: 'Main body', params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true },
    {
      id: 'moved', kind: 'translate', label: 'Fasteners', params: { x: 0, y: 0, z: 0 }, enabled: true,
      children: [{ id: 'hole', kind: 'cylinder', label: 'Mounting hole', params: { radius: 2, height: 10 }, children: [], enabled: true }],
    },
  ],
};

describe('node naming and search workflow', () => {
  beforeEach(() => {
    useModelerStore.getState().resetDocument(tree);
    useTreeUiStore.getState().resetViewState();
  });

  it('reveals and selects a deeply nested name while retaining its ancestors', () => {
    render(<NodeTreeContent />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search node tree' }), { target: { value: 'mounting hole' } });

    expect(screen.queryByRole('treeitem', { name: /Main body/ })).not.toBeInTheDocument();
    const result = screen.getByRole('treeitem', { name: /Mounting hole/ });
    expect(screen.getByRole('treeitem', { name: /Fasteners/ })).toBeInTheDocument();
    fireEvent.click(result);
    expect(useModelerStore.getState().selectedNodeId).toBe('hole');
  });

  it('renames from the accessible row action and commits once on Enter', () => {
    render(<NodeTreeContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Assembly' }));
    const input = screen.getByRole('textbox', { name: 'Rename Assembly' });
    fireEvent.change(input, { target: { value: 'Printer enclosure' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useModelerStore.getState().tree?.label).toBe('Printer enclosure');
    expect(screen.getByRole('treeitem', { name: /Printer enclosure/ })).toBeInTheDocument();
  });

  it('locks selection/editing and keeps hide/isolate out of document history', () => {
    render(<NodeTreeContent />);
    fireEvent.click(screen.getByRole('treeitem', { name: /Assembly/ }));
    const historyLength = useModelerStore.getState().history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Lock node' }));

    expect(useModelerStore.getState().selectedNodeId).toBeNull();
    fireEvent.click(screen.getByRole('treeitem', { name: /Assembly, Union, locked/ }));
    expect(useModelerStore.getState().selectedNodeId).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide node in viewport' }));
    fireEvent.click(screen.getByRole('button', { name: 'Isolate node in viewport' }));
    expect(useModelerStore.getState().history).toHaveLength(historyLength);
    expect(JSON.parse(useModelerStore.getState().toJSON()).tree).not.toHaveProperty('locked');
    expect(screen.getByRole('button', { name: /Show all/ })).toBeInTheDocument();
  });
});
