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
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Assembly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Assembly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }));

    expect(useModelerStore.getState().selectedNodeId).toBeNull();
    fireEvent.click(screen.getByRole('treeitem', { name: /Assembly, Union, locked/ }));
    expect(useModelerStore.getState().selectedNodeId).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Assembly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide in viewport' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Assembly' }));
    fireEvent.click(screen.getByRole('button', { name: 'Isolate in viewport' }));
    expect(useModelerStore.getState().history).toHaveLength(historyLength);
    expect(JSON.parse(useModelerStore.getState().toJSON()).tree).not.toHaveProperty('locked');
    expect(screen.getByRole('button', { name: /Show all/ })).toBeInTheDocument();
  });

  it('groups nodes, exposes folder shortcuts, and renames a group atomically', () => {
    render(<NodeTreeContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Main body' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Group Main body' }), { target: { value: '__new' } });

    expect(screen.getByRole('region', { name: 'Node groups' })).toHaveTextContent('Main body group (1)');
    fireEvent.click(screen.getByRole('button', { name: 'Group Main body group, 1 node' }));
    fireEvent.click(screen.getByRole('button', { name: 'Main body' }));
    expect(useModelerStore.getState().selectedNodeId).toBe('body');

    const input = screen.getByRole('textbox', { name: 'Rename group Main body group' });
    fireEvent.change(input, { target: { value: 'Shell' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useModelerStore.getState().tree?.children[0].group).toBe('Shell');
    expect(screen.getByRole('button', { name: 'Group Shell, 1 node' })).toBeInTheDocument();
  });

  it('supports additive touch selection and exposes atomic bulk actions', () => {
    render(<NodeTreeContent />);
    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Main body to selection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Fasteners to selection' }));

    expect(useModelerStore.getState().selectedNodeIds).toEqual(['body', 'moved']);
    expect(screen.getByLabelText('Multiple selection actions')).toHaveTextContent('2 selected');
    const historyLength = useModelerStore.getState().history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Enable/disable' }));
    expect(useModelerStore.getState().tree?.children.map((node) => node.enabled)).toEqual([false, false]);
    expect(useModelerStore.getState().history).toHaveLength(historyLength + 1);
  });
});
