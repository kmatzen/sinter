import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useViewportStore } from './viewportStore';

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
  useViewportStore.setState({
    hoveredNodeId: null, hoverSource: null, gizmoSpace: 'world', measurementMode: false,
    measurementPoints: [], pinnedMeasurements: [], measurementUnit: 'mm', measurementPrecision: 2,
  });
});

describe('measurements', () => {
  const anchor = (nodeId: string, x: number) => ({ nodeId, normalized: [x, 0, 0] as [number, number, number], fallback: [x, 0, 0] as [number, number, number] });

  it('keeps at most three points, supports point undo, and pins a snapshot', () => {
    const store = useViewportStore.getState();
    store.addMeasurementPoint(anchor('a', 0));
    store.addMeasurementPoint(anchor('a', 1));
    store.addMeasurementPoint(anchor('a', 2));
    store.addMeasurementPoint(anchor('a', 3));
    expect(useViewportStore.getState().measurementPoints.map((item) => item.fallback[0])).toEqual([1, 2, 3]);

    useViewportStore.getState().removeMeasurementPoint();
    expect(useViewportStore.getState().measurementPoints).toHaveLength(2);
    useViewportStore.getState().pinMeasurement();
    expect(useViewportStore.getState().measurementPoints).toEqual([]);
    expect(useViewportStore.getState().pinnedMeasurements[0].anchors).toHaveLength(2);
  });

  it('allows a single primitive point to be pinned and persists display preferences', () => {
    useViewportStore.getState().addMeasurementPoint(anchor('cylinder', 0.5));
    useViewportStore.getState().pinMeasurement();
    expect(useViewportStore.getState().pinnedMeasurements).toHaveLength(1);

    useViewportStore.getState().setMeasurementUnit('in');
    useViewportStore.getState().setMeasurementPrecision(9);
    expect(localStorage.getItem('sinter_measurement_unit')).toBe('in');
    expect(localStorage.getItem('sinter_measurement_precision')).toBe('6');
  });

  it('uses two decimals when no saved precision exists', async () => {
    vi.resetModules();
    const fresh = await import('./viewportStore');
    expect(fresh.useViewportStore.getState().measurementPrecision).toBe(2);
  });
});

describe('gizmo space', () => {
  it('switches between visible world/local modes and persists the preference', () => {
    useViewportStore.getState().toggleGizmoSpace();
    expect(useViewportStore.getState().gizmoSpace).toBe('local');
    expect(localStorage.getItem('sinter_gizmo_space')).toBe('local');

    useViewportStore.getState().toggleGizmoSpace();
    expect(useViewportStore.getState().gizmoSpace).toBe('world');
    expect(localStorage.getItem('sinter_gizmo_space')).toBe('world');
  });
});

describe('hovered node', () => {
  it('records where the hover came from', () => {
    useViewportStore.getState().setHoveredNode('a', 'viewport');
    expect(useViewportStore.getState()).toMatchObject({ hoveredNodeId: 'a', hoverSource: 'viewport' });

    useViewportStore.getState().setHoveredNode('a', 'ui');
    expect(useViewportStore.getState().hoverSource).toBe('ui');
  });

  it('defaults to a UI hover, since the viewport is the case that must say so', () => {
    useViewportStore.getState().setHoveredNode('a');
    expect(useViewportStore.getState().hoverSource).toBe('ui');
  });

  it('drops the source along with the node', () => {
    useViewportStore.getState().setHoveredNode('a', 'viewport');
    useViewportStore.getState().setHoveredNode(null);
    expect(useViewportStore.getState()).toMatchObject({ hoveredNodeId: null, hoverSource: null });
  });

  it('does not notify when nothing changed', () => {
    // Hover is written from a pointermove handler, so a no-op write is the
    // common case, not the rare one — and every subscriber of this store
    // invalidates the viewport frame when it fires.
    useViewportStore.getState().setHoveredNode('a', 'viewport');
    let notifications = 0;
    const unsub = useViewportStore.subscribe(() => { notifications++; });

    useViewportStore.getState().setHoveredNode('a', 'viewport');
    expect(notifications).toBe(0);

    useViewportStore.getState().setHoveredNode('b', 'viewport');
    expect(notifications).toBe(1);

    unsub();
  });
});
