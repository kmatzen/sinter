import { describe, it, expect, beforeEach } from 'vitest';
import { useViewportStore } from './viewportStore';

beforeEach(() => {
  useViewportStore.setState({ hoveredNodeId: null, hoverSource: null });
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
