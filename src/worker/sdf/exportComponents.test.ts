import { describe, expect, it } from 'vitest';
import { computeBounds } from './bounds';
import { evaluateSDF } from './evaluate';
import { partitionExportComponents } from './exportComponents';
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
});
