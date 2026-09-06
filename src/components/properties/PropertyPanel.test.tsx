import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../engine/workerBridge', () => ({ workerBridge: { fitMesh: vi.fn() } }));
import { PropertyContent } from './PropertyPanel';
import { useModelerStore } from '../../store/modelerStore';
import { useTreeUiStore } from '../../store/treeUiStore';

const box = {
  id: 'box', kind: 'box', label: 'Box', params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true,
};

describe('property formulas', () => {
  beforeEach(() => {
    useModelerStore.getState().resetDocument(box, 'Formula test', []);
    useModelerStore.getState().selectNode('box');
  });
  afterEach(cleanup);

  it('creates a parameter and binds a property to its formula', () => {
    render(<PropertyContent />);
    fireEvent.click(screen.getByText('Named parameters (0)'));
    fireEvent.change(screen.getByLabelText('New parameter name'), { target: { value: 'wall' } });
    fireEvent.change(screen.getByLabelText('New parameter expression'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('Add parameter'));

    fireEvent.click(screen.getByText('Driven properties (0)'));
    fireEvent.change(screen.getByLabelText('Property formula'), { target: { value: 'wall * 2' } });
    fireEvent.click(screen.getByText('Drive'));

    expect(useModelerStore.getState().tree?.params.width).toBe(8);
    expect(useModelerStore.getState().tree?.expressions?.width).toBe('wall * 2');
    expect(screen.getByText(/width = wall \* 2/)).toBeInTheDocument();
  });

  it('promotes a literal property to a named parameter', () => {
    render(<PropertyContent />);
    fireEvent.click(screen.getByText('Driven properties (0)'));
    fireEvent.change(screen.getByLabelText('Property to drive'), { target: { value: 'height' } });
    fireEvent.change(screen.getByLabelText('Promoted parameter name'), { target: { value: 'bodyHeight' } });
    fireEvent.click(screen.getByText('Promote'));
    expect(useModelerStore.getState().namedParameters[0]).toEqual({ name: 'bodyHeight', expression: '20', unit: 'mm' });
    expect(useModelerStore.getState().tree?.expressions?.height).toBe('bodyHeight');
  });

  it('does not expose editing controls for a locked node', () => {
    useTreeUiStore.getState().toggleLocked('box');
    render(<PropertyContent />);

    expect(screen.getByRole('status')).toHaveTextContent('This node is locked');
    expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();
    expect(screen.queryByText(/Driven properties/)).not.toBeInTheDocument();
  });

  it('shows and edits the effective world transform as one undoable change', () => {
    const tree = {
      id: 'move', kind: 'translate', label: 'Move', params: { x: 5, y: 0, z: 0 }, enabled: true,
      children: [box],
    };
    useModelerStore.getState().resetDocument(tree, 'Transform test', []);
    useModelerStore.getState().selectNode('box');
    const before = useModelerStore.getState().historyIndex;
    render(<PropertyContent />);

    expect(screen.getByText('Effective transform · world')).toBeInTheDocument();
    const xInputs = screen.getAllByLabelText('X');
    expect(xInputs[0]).toHaveValue('5.00');
    fireEvent.change(xInputs[0], { target: { value: '12' } });
    fireEvent.blur(xInputs[0]);

    expect(useModelerStore.getState().historyIndex).toBe(before + 1);
    expect(useModelerStore.getState().selectedNodeId).toBe('box');
    act(() => useModelerStore.getState().undo());
    expect(useModelerStore.getState().historyIndex).toBe(before);
  });
});
