import { describe, expect, it } from 'vitest';
import { computeBounds } from './bounds';
import { evaluateSDF } from './evaluate';
import { partitionExportComponents, planComponentSampling } from './exportComponents';
import type { SDFNode } from './types';
import { evaluateCPUWithProgress } from './gridEval';
import { dualContour } from './dualContour';

const movedSphere = (x: number): SDFNode => ({
  kind: 'transform', child: { kind: 'sphere', radius: 0.5 },
  tx: x, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
});

describe('export component partitioning', () => {
  it('gives widely separated small islands independent local bounds', () => {
    const root: SDFNode = { kind: 'union', a: movedSphere(-500), b: movedSphere(500), k: 0 };
    const components = partitionExportComponents(root);
    expect(components).toHaveLength(2);
    expect(components.map((node) => computeBounds(node).max[0] - computeBounds(node).min[0])).toEqual([1, 1]);
    expect(evaluateSDF(components[0], [-500, 0, 0])).toBeLessThan(0);
    expect(evaluateSDF(components[1], [500, 0, 0])).toBeLessThan(0);
  });

  it('meshes every distant island without a grid spanning the empty distance', () => {
    const root: SDFNode = { kind: 'union', a: movedSphere(-500), b: movedSphere(500), k: 0 };
    for (const component of partitionExportComponents(root)) {
      const bounds = computeBounds(component);
      const bbox = { min: bounds.min.map((value) => value - 1) as [number, number, number], max: bounds.max.map((value) => value + 1) as [number, number, number] };
      const { grid, active } = evaluateCPUWithProgress(component, bbox, 32, () => {});
      const mesh = dualContour(grid, 32, bbox, component, undefined, active);
      expect(mesh.indices.length).toBeGreaterThan(0);
      for (let axis = 0; axis < 3; axis++) {
        const values = Array.from({ length: mesh.positions.length / 3 }, (_, index) => mesh.positions[index * 3 + axis]);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThan(2);
      }
    }
  });

  it('keeps touching and overlapping union operands in one CSG component', () => {
    const root: SDFNode = { kind: 'union', a: movedSphere(0), b: movedSphere(1), k: 0 };
    expect(partitionExportComponents(root)).toEqual([root]);
  });

  it('does not split smooth unions or boolean atoms', () => {
    const smooth: SDFNode = { kind: 'union', a: movedSphere(-500), b: movedSphere(500), k: 2 };
    const cut: SDFNode = { kind: 'subtract', a: movedSphere(-500), b: movedSphere(500), k: 0 };
    expect(partitionExportComponents(smooth)).toEqual([smooth]);
    expect(partitionExportComponents(cut)).toEqual([cut]);
  });

  it('automatically refines for a small cutter within the bounded grid budget', () => {
    const cut: SDFNode = { kind: 'subtract', a: { kind: 'box', size: [100, 100, 100] }, b: { kind: 'sphere', radius: 0.5 }, k: 0 };
    const plan = planComponentSampling(cut, { min: [-51, -51, -51], max: [51, 51, 51] }, 128, 384);
    expect(plan.resolution).toBe(204);
    expect(plan.voxel).toEqual([0.5, 0.5, 0.5]);
    expect(plan.tolerance).toBe(0.5);
  });

  it('fails before meshing when a thin shell cannot be resolved safely', () => {
    const shell: SDFNode = { kind: 'shell', child: { kind: 'box', size: [100, 100, 100] }, thickness: 0.1 };
    expect(() => planComponentSampling(shell, { min: [-51, -51, -51], max: [51, 51, 51] }, 128, 384))
      .toThrow(/cannot resolve a 0\.1000 mm source feature.*384³ grid limit/i);
  });

  it('detects narrow walls left by a large internal cutter', () => {
    const hollow: SDFNode = { kind: 'subtract', a: { kind: 'box', size: [100, 100, 100] }, b: { kind: 'box', size: [99.9, 99.9, 99.9] }, k: 0 };
    expect(() => planComponentSampling(hollow, { min: [-51, -51, -51], max: [51, 51, 51] }, 256, 384))
      .toThrow(/cannot resolve a 0\.05000 mm source feature/i);
  });
});
