import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThreeEngine } from '../../engine/ThreeEngine';
import { useViewportStore } from '../../store/viewportStore';
import { ViewportToolbar } from './ViewportToolbar';

describe('ViewportToolbar camera controls', () => {
  beforeEach(() => {
    useViewportStore.setState({ clipEnabled: false, measurementMode: false, showDimensions: false, projection: 'perspective', namedViews: [], gizmoPivot: 'selection-center', customPivot: [0, 0, 0] });
  });

  it('saves, recalls, and removes named project views from the compact control', () => {
    const view = {
      id: 'view-1', name: 'Detail', createdAt: '2026-09-06T12:00:00Z',
      position: [0, 0, 10] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number],
      projection: 'perspective' as const, verticalSpan: 10,
      clipping: { enabled: false, axis: 'y' as const, position: 0, flip: false },
    };
    const captureNamedView = vi.fn(() => view);
    const applyNamedView = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('Detail');
    render(<ViewportToolbar engine={{ captureNamedView, applyNamedView } as unknown as ThreeEngine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save current view' }));
    expect(useViewportStore.getState().namedViews).toEqual([view]);
    fireEvent.change(screen.getByLabelText('Named view'), { target: { value: 'view-1' } });
    expect(applyNamedView).toHaveBeenCalledWith(view);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected named view' }));
    expect(useViewportStore.getState().namedViews).toEqual([]);
  });

  it('offers every exact standard view in one compact control', () => {
    const setStandardView = vi.fn();
    render(<ViewportToolbar engine={{ setStandardView } as unknown as ThreeEngine} />);
    const select = screen.getByLabelText('Standard view');
    for (const name of ['Isometric', 'Front', 'Back', 'Right', 'Left', 'Top', 'Bottom']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    fireEvent.change(select, { target: { value: 'top' } });
    expect(setStandardView).toHaveBeenCalledWith('top');
  });

  it('keeps both mobile view selectors at the shared touch-target height', () => {
    render(<ViewportToolbar engine={null} />);
    expect(screen.getByRole('combobox', { name: 'Standard view' })).toHaveClass('tap-h');
    expect(screen.getByRole('combobox', { name: 'Named view' })).toHaveClass('tap-h');
  });

  it('exposes every pivot mode and editable custom coordinates', () => {
    render(<ViewportToolbar engine={null} />);
    const pivot = screen.getByRole('combobox', { name: 'Transform pivot' });
    for (const name of ['Object origin', 'Primary bounds', 'Selection center', 'Custom pivot']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    fireEvent.change(pivot, { target: { value: 'custom' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Custom pivot X' }), { target: { value: '12.5' } });
    expect(useViewportStore.getState()).toMatchObject({ gizmoPivot: 'custom', customPivot: [12.5, 0, 0] });
  });

  it('exposes frame-all and frame-selection commands', () => {
    const zoomToFit = vi.fn();
    const frameSelection = vi.fn();
    render(<ViewportToolbar engine={{ zoomToFit, frameSelection } as unknown as ThreeEngine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Frame all' }));
    fireEvent.click(screen.getByRole('button', { name: 'Frame selection' }));
    expect(zoomToFit).toHaveBeenCalledTimes(1);
    expect(frameSelection).toHaveBeenCalledTimes(1);
  });

  it('offers a compact perspective/orthographic toggle', () => {
    render(<ViewportToolbar engine={null} />);
    fireEvent.click(screen.getByRole('button', { name: /projection: perspective/i }));
    expect(useViewportStore.getState().projection).toBe('orthographic');
    expect(screen.getByRole('button', { name: /projection: orthographic/i })).toHaveTextContent('O');
  });

  it('provides a desktop orientation widget with axis clicks and drag orbiting', () => {
    const setStandardView = vi.fn();
    const orbitFromWidget = vi.fn();
    const engine = {
      viewQuaternion: () => [0, 0, 0, 1], onFrame: (fn: () => void) => { fn(); return () => {}; },
      setStandardView, orbitFromWidget,
    } as unknown as ThreeEngine;
    render(<ViewportToolbar engine={engine} />);
    fireEvent.click(screen.getByRole('button', { name: 'Right view' }));
    expect(setStandardView).toHaveBeenCalledWith('right');
    const widget = screen.getByLabelText(/orientation widget/i);
    fireEvent.pointerDown(widget, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(widget, { pointerId: 1, clientX: 15, clientY: 7 });
    expect(orbitFromWidget).toHaveBeenCalledWith(5, -3);
  });
});
