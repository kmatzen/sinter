import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import type { SDFNodeUI } from '../../types/operations';
import { MeasurementOverlay } from './MeasurementOverlay';

const CYLINDER: SDFNodeUI = {
  id: 'cylinder', kind: 'cylinder', label: 'Pin hole', params: { radius: 3, height: 10 }, children: [], enabled: true,
};

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal('crypto', { randomUUID: () => 'pin-1' });
  useModelerStore.setState({ tree: CYLINDER, sdfDisplay: {
    glsl: 'x', paramCount: 0, paramValues: [], textures: [], bbMin: [-3, -5, -3], bbMax: [3, 5, 3], hasWarn: false,
  }});
  useViewportStore.setState({
    measurementMode: true, measurementPoints: [], pinnedMeasurements: [], measurementUnit: 'mm', measurementPrecision: 2,
  });
});

describe('MeasurementOverlay', () => {
  it('reports deterministic distance and exact primitive source diameter', () => {
    useViewportStore.setState({ measurementPoints: [
      { nodeId: 'cylinder', normalized: [0, 0.5, 0.5], fallback: [-3, 0, 0] },
      { nodeId: 'cylinder', normalized: [1, 0.5, 0.5], fallback: [3, 0, 0] },
    ] });
    render(<MeasurementOverlay />);
    expect(screen.getAllByText('6.00 mm', { selector: '.font-mono' })).toHaveLength(2);
    expect(screen.getByText('Cylinder diameter*')).toBeInTheDocument();
    expect(screen.getByText(/viewport approximations/i)).toBeInTheDocument();
  });

  it('offers keyboard-accessible bounds targets and invalidates deleted pins', () => {
    render(<MeasurementOverlay />);
    fireEvent.click(screen.getByRole('button', { name: 'Bounds min' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(screen.getByText(/Cylinder ⌀ 6.00 mm/)).toBeInTheDocument();

    act(() => useModelerStore.setState({ tree: null }));
    expect(screen.getByText(/target deleted — re-pick/)).toBeInTheDocument();
    expect(screen.queryByText(/Cylinder ⌀/)).not.toBeInTheDocument();
  });

  it('undoes a point with Backspace and exits with Escape', () => {
    useViewportStore.setState({ measurementPoints: [
      { nodeId: 'cylinder', normalized: [0.5, 0.5, 0.5], fallback: [0, 0, 0] },
    ] });
    render(<MeasurementOverlay />);
    fireEvent.keyDown(window, { key: 'Backspace' });
    expect(useViewportStore.getState().measurementPoints).toEqual([]);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useViewportStore.getState().measurementMode).toBe(false);
  });
});
