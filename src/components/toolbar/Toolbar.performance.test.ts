import { describe, expect, it } from 'vitest';
import { modelerChangeAffectsCloudDocument, viewportChangeAffectsCloudDocument } from '../../store/cloudDirtyInvalidation';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';

describe('cloud dirty-state invalidation', () => {
  it('ignores evaluator publications that are not persisted', () => {
    const previous = useModelerStore.getState();
    expect(modelerChangeAffectsCloudDocument({ ...previous, evaluating: !previous.evaluating }, previous)).toBe(false);
    expect(modelerChangeAffectsCloudDocument({ ...previous, sdfDisplay: null, error: 'preview failed' }, previous)).toBe(false);
    expect(modelerChangeAffectsCloudDocument({ ...previous, tree: previous.tree ? { ...previous.tree } : ({
      id: 'box', kind: 'box', label: 'Box', params: {}, children: [], enabled: true,
    }) }, previous)).toBe(true);
  });

  it('ignores hover and dragging but includes persisted viewport metadata', () => {
    const previous = useViewportStore.getState();
    expect(viewportChangeAffectsCloudDocument({ ...previous, hoveredNodeId: 'box' }, previous)).toBe(false);
    expect(viewportChangeAffectsCloudDocument({ ...previous, dragging: !previous.dragging }, previous)).toBe(false);
    expect(viewportChangeAffectsCloudDocument({ ...previous, namedViews: [...previous.namedViews] }, previous)).toBe(true);
  });
});
