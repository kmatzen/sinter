import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../engine/workerBridge', () => ({ workerBridge: { fitMesh: vi.fn() } }));
import { PropertyContent } from './PropertyPanel';
import { useModelerStore } from '../../store/modelerStore';

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
});
