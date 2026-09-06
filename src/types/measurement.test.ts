import { describe, expect, it } from 'vitest';
import type { SDFNodeUI } from './operations';
import { NODE_DEFAULTS, NODE_LABELS } from './operations';
import { attributePointDetails } from '../engine/sdfPicking';
import { exactRadialMeasurement, formatMeasurement, makeAnchor, makeTargetMeasurementAnchor, measureAnchors, measurePoints, resolveMeasurementAnchor, resolveMeasurementAnchors } from './measurement';

let id = 0;
const node = (kind: string, params: Record<string, number> = {}, children: SDFNodeUI[] = []): SDFNodeUI => ({
  id: `${kind}-${++id}`, kind, label: NODE_LABELS[kind] ?? kind,
  params: { ...NODE_DEFAULTS[kind], ...params }, children, enabled: true,
});

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
    expect(formatMeasurement(1000, 'm', 2)).toBe('1.00 m');
    expect(formatMeasurement(25.4 * 14.5, 'ft-in', 2, 16)).toBe('1′ 2 1/2″');
  });

  it('does not move a target-relative anchor when an unrelated sibling changes root bounds', () => {
    const sphere = node('sphere', { radius: 5 });
    const moved = node('translate', { x: 10, y: 0, z: 0 }, [sphere]);
    const tree = moved;
    const hit: [number, number, number] = [15, 0, 0];
    const attribution = attributePointDetails(tree, hit)!;
    const anchor = makeTargetMeasurementAnchor(tree, attribution, hit)!;
    expect(resolveMeasurementAnchor(tree, anchor)).toEqual(hit);

    const expandedSibling = node('box', { width: 1_000, height: 20, depth: 20 });
    const changed = node('union', {}, [tree, expandedSibling]);
    expect(resolveMeasurementAnchor(changed, anchor)).toEqual(hit);
  });

  it('replays current ancestor translation, rotation, and scale', () => {
    const box = node('box', { width: 2, height: 2, depth: 2 });
    const scale = node('scale', { x: 2, y: 1, z: 1 }, [box]);
    const rotate = node('rotate', { x: 0, y: 90, z: 0 }, [scale]);
    const translate = node('translate', { x: 10, y: 0, z: 0 }, [rotate]);
    const attribution = attributePointDetails(translate, [10, 0, -2])!;
    const anchor = makeTargetMeasurementAnchor(translate, attribution, [10, 0, -2])!;
    expect(resolveMeasurementAnchor(translate, anchor)?.map((value) => Math.round(value * 1e9) / 1e9)).toEqual([10, 0, -2]);

    const changed = { ...translate, params: { ...translate.params, x: 20 } };
    expect(resolveMeasurementAnchor(changed, anchor)?.map((value) => Math.round(value * 1e9) / 1e9)).toEqual([20, 0, -2]);
  });

  it('retains linear-pattern instance identity when spacing changes', () => {
    const sphere = node('sphere', { radius: 2 });
    const pattern = node('linearPattern', { axisX: 1, axisY: 0, axisZ: 0, count: 3, spacing: 20 }, [sphere]);
    const hit: [number, number, number] = [22, 0, 0];
    const anchor = makeTargetMeasurementAnchor(pattern, attributePointDetails(pattern, hit)!, hit)!;
    expect(anchor.patternInstances?.[pattern.id]).toBe(1);
    expect(resolveMeasurementAnchor(pattern, anchor)).toEqual(hit);
    const changed = { ...pattern, params: { ...pattern.params, spacing: 30 } };
    expect(resolveMeasurementAnchor(changed, anchor)).toEqual([32, 0, 0]);
  });

  it('retains circular-pattern and mirror instance identity', () => {
    const sphere = node('sphere', { radius: 2 });
    const shifted = node('translate', { x: 10, y: 0, z: 0 }, [sphere]);
    const circular = node('circularPattern', { axisX: 0, axisY: 1, axisZ: 0, count: 4 }, [shifted]);
    const circularHit: [number, number, number] = [0, 0, 10];
    const circularAnchor = makeTargetMeasurementAnchor(circular, attributePointDetails(circular, circularHit)!, circularHit)!;
    expect(resolveMeasurementAnchor(circular, circularAnchor)?.map((value) => Math.round(value * 1e6) / 1e6)).toEqual(circularHit);
    const denser = { ...circular, params: { ...circular.params, count: 8 } };
    expect(resolveMeasurementAnchor(denser, circularAnchor)?.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([7.071068, 0, 7.071068]);

    const mirror = node('mirror', { mirrorX: 1, mirrorY: 0, mirrorZ: 0 }, [shifted]);
    const mirrorHit: [number, number, number] = [-12, 0, 0];
    const mirrorAnchor = makeTargetMeasurementAnchor(mirror, attributePointDetails(mirror, mirrorHit)!, mirrorHit)!;
    expect(resolveMeasurementAnchor(mirror, mirrorAnchor)).toEqual(mirrorHit);
    const movedFurther = { ...mirror, children: [{ ...shifted, params: { ...shifted.params, x: 20 } }] };
    expect(resolveMeasurementAnchor(movedFurther, mirrorAnchor)).toEqual([-22, 0, 0]);
  });

  it('supports multi-node measurements and invalidates a deleted ownership path', () => {
    const a = node('sphere', { radius: 1 });
    const b = node('sphere', { radius: 1 });
    const movedB = node('translate', { x: 10, y: 0, z: 0 }, [b]);
    const tree = node('union', {}, [a, movedB]);
    const anchors = [[1, 0, 0], [9, 0, 0]].map((hit) => makeTargetMeasurementAnchor(tree, attributePointDetails(tree, hit as [number, number, number])!, hit as [number, number, number])!);
    const points = resolveMeasurementAnchors(tree, anchors)!;
    expect(measurePoints(points).distance).toBe(8);
    expect(resolveMeasurementAnchor(a, anchors[1])).toBeNull();
  });
});
