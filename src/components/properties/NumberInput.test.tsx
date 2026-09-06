import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NumberInput } from './NumberInput';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';

const box = () => ({
  id: 'box', kind: 'box', label: 'Box',
  params: { width: 10, height: 10, depth: 10 }, children: [], enabled: true,
});

describe('NumberInput constraints', () => {
  beforeEach(() => {
    const tree = box();
    useModelerStore.setState({ tree, history: [tree], historyIndex: 0, historyTransaction: null });
    useViewportStore.getState().setUnitPreferences({ displayUnit: 'mm', decimalPrecision: 2, fractionalDenominator: 16 });
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

  it('commits a typed Enter edit exactly once', () => {
    const update = (width: number) => useModelerStore.getState().updateNodeParams('box', { width });
    render(<NumberInput label="Width" value={10} min={1} max={100} onChange={update} />);
    const input = screen.getByLabelText('Width');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // jsdom does not synthesize React's blur event from HTMLElement.blur().
    fireEvent.blur(input);

    expect(useModelerStore.getState().tree!.params.width).toBe(42);
    expect(useModelerStore.getState().history).toHaveLength(2);
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

  it('shows canonical millimeters in the selected project unit', () => {
    useViewportStore.getState().setUnitPreferences({ displayUnit: 'in', decimalPrecision: 3, fractionalDenominator: 16 });
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={25.4} onChange={onChange} />);

    expect(screen.getByLabelText('Width')).toHaveValue('1.000');
    expect(screen.getByText('in')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('converts bare property input from the selected unit to millimeters', () => {
    useViewportStore.getState().setUnitPreferences({ displayUnit: 'in', decimalPrecision: 2, fractionalDenominator: 16 });
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={25.4} onChange={onChange} />);
    const input = screen.getByLabelText('Width');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(50.8);
  });

  it('accepts mixed explicit units independently of the display unit', () => {
    useViewportStore.getState().setUnitPreferences({ displayUnit: 'cm', decimalPrecision: 2, fractionalDenominator: 16 });
    const onChange = vi.fn();
    render(<NumberInput label="Width" value={10} onChange={onChange} />);
    const input = screen.getByLabelText('Width');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1 in + 12.7mm' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith(38.1);
  });

  it('changes presentation without rewriting canonical geometry', () => {
    const onChange = vi.fn();
    const { rerender } = render(<NumberInput label="Width" value={25.4} onChange={onChange} />);

    act(() => {
      useViewportStore.getState().setUnitPreferences({ displayUnit: 'in', decimalPrecision: 4, fractionalDenominator: 16 });
    });
    rerender(<NumberInput label="Width" value={25.4} onChange={onChange} />);

    expect(screen.getByLabelText('Width')).toHaveValue('1.0000');
    expect(onChange).not.toHaveBeenCalled();
  });
});
