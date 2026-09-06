import { describe, expect, it } from 'vitest';
import { exactRadialMeasurement, formatMeasurement, makeAnchor, measureAnchors } from './measurement';

describe('measurement math', () => {
  it('reports deterministic distance, axis deltas, and a three-point angle', () => {
    const anchors = [makeAnchor([0, 0, 0], 'a'), makeAnchor([3, 0, 0], 'b'), makeAnchor([3, 4, 0], 'c')];
    expect(measureAnchors(anchors)).toMatchObject({ distance: 3, delta: [3, 0, 0], angle: 90 });
  });

  it('updates normalized anchors when parametric bounds change', () => {
    const anchor = makeAnchor([5, 5, 5], 'a', [0, 0, 0], [10, 10, 10]);
    expect(measureAnchors([anchor], [0, 0, 0], [20, 40, 60]).points[0]).toEqual([10, 20, 30]);
  });

  it('recognizes exact primitive diameter and formats unit preferences', () => {
    const radial = exactRadialMeasurement({ id: 'c', kind: 'cylinder', label: 'Hole', params: { radius: 6, height: 10 }, children: [], enabled: true });
    expect(radial).toEqual({ radius: 6, diameter: 12, label: 'Cylinder' });
    expect(formatMeasurement(25.4, 'in', 3)).toBe('1.000 in');
  });
});
