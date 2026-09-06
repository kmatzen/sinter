import { describe, expect, it } from 'vitest';
import { standardViewPose, type StandardView } from './cameraViews';

const bounds = { min: [-10, -20, -30] as [number, number, number], max: [30, 40, 50] as [number, number, number] };

describe('standard camera views', () => {
  it.each([
    ['front', [0, 0, 1]], ['back', [0, 0, -1]],
    ['right', [1, 0, 0]], ['left', [-1, 0, 0]],
    ['top', [0, 1, 0]], ['bottom', [0, -1, 0]],
  ] as Array<[StandardView, [number, number, number]]>)('%s is exactly axis-aligned', (view, expected) => {
    const pose = standardViewPose(bounds, view, 50);
    const delta = pose.position.map((value, axis) => (value - pose.target[axis]) / pose.distance);
    expect(delta[0]).toBeCloseTo(expected[0], 12);
    expect(delta[1]).toBeCloseTo(expected[1], 12);
    expect(delta[2]).toBeCloseTo(expected[2], 12);
  });

  it('uses fixed non-collinear up vectors for top and bottom', () => {
    expect(standardViewPose(bounds, 'top', 50).up).toEqual([0, 0, -1]);
    expect(standardViewPose(bounds, 'bottom', 50).up).toEqual([0, 0, 1]);
  });

  it('frames a zero-size selection with a finite useful distance', () => {
    const pose = standardViewPose({ min: [2, 2, 2], max: [2, 2, 2] }, 'isometric', 50);
    expect(Number.isFinite(pose.distance)).toBe(true);
    expect(pose.distance).toBeGreaterThan(0);
  });
});
