import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberInput } from './NumberInput';
import { useModelerStore } from '../../store/modelerStore';

const box = () => ({
  id: 'box', kind: 'box', label: 'Box',
  params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true,
});

describe('NumberInput constraints', () => {
  beforeEach(() => {
    const tree = box();
    useModelerStore.setState({ tree, history: [tree], historyIndex: 0, historyTransaction: null });
  });

  it('clamps keyboard stepping at the same minimum as typed input', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Scale" value={0.01} min={0.01} step={0.1} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('Scale'), { key: 'ArrowDown' });
    fireEvent.keyUp(screen.getByLabelText('Scale'), { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith(0.01);
  });

  it('clamps keyboard stepping at a maximum', () => {
    const onChange = vi.fn();
    render(<NumberInput label="Count" value={50} min={2} max={50} step={1} onChange={onChange} />);
    fireEvent.keyDown(screen.getByLabelText('Count'), { key: 'ArrowUp' });
    fireEvent.keyUp(screen.getByLabelText('Count'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith(50);
  });

  it('commits one undo entry for a complete label scrub', () => {
    const update = (width: number) => useModelerStore.getState().updateNodeParams('box', { width });
    render(<NumberInput label="Width" value={10} min={1} max={100} onChange={update} />);

    fireEvent.pointerDown(screen.getByText('Width'), { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 120 });
    fireEvent.pointerMove(window, { clientX: 140 });
    fireEvent.pointerUp(window);

    expect(useModelerStore.getState().history).toHaveLength(2);
    const changed = useModelerStore.getState().tree!.params.width;
    expect(changed).toBeGreaterThan(10);
    useModelerStore.getState().undo();
    expect(useModelerStore.getState().tree!.params.width).toBe(10);
  });

  it('restores the starting value when a scrub is cancelled', () => {
    const update = (width: number) => useModelerStore.getState().updateNodeParams('box', { width });
    render(<NumberInput label="Width" value={10} min={1} max={100} onChange={update} />);

    fireEvent.pointerDown(screen.getByText('Width'), { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 160 });
    fireEvent.pointerCancel(window);

    expect(useModelerStore.getState().tree!.params.width).toBe(10);
    expect(useModelerStore.getState().history).toHaveLength(1);
  });

  it('coalesces repeated keyboard changes on a range input', () => {
    const update = (width: number) => useModelerStore.getState().updateNodeParams('box', { width });
    render(<NumberInput label="Width" value={10} min={1} max={100} onChange={update} />);
    const slider = screen.getByLabelText('Width slider');

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.change(slider, { target: { value: '11' } });
    fireEvent.change(slider, { target: { value: '12' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight' });

    expect(useModelerStore.getState().tree!.params.width).toBe(12);
    expect(useModelerStore.getState().history).toHaveLength(2);
  });
});
