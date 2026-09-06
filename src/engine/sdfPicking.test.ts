import { describe, it, expect } from 'vitest';
import { attributePath, attributePoint } from './sdfPicking';
import { NODE_DEFAULTS, NODE_LABELS } from '../types/operations';
import type { SDFNodeUI } from '../types/operations';
import type { Vec3 } from '../worker/sdf/types';

let counter = 0;
function node(kind: string, params: Record<string, number> = {}, children: SDFNodeUI[] = []): SDFNodeUI {
  return {
    id: `${kind}-${++counter}`,
    kind,
    label: NODE_LABELS[kind] || kind,
    params: { ...NODE_DEFAULTS[kind], ...params },
    children,
    enabled: true,
  };
}

/** The placeholder the store inserts for an unfilled child slot. */
function emptySlot(): SDFNodeUI {
  return { id: `empty-${++counter}`, kind: '_empty', label: '', params: {}, children: [], enabled: false };
}

describe('attributePath', () => {
  it('names the leaf under the point and every node above it', () => {
    const sphere = node('sphere', { radius: 5 });
    const move = node('translate', { x: 30, y: 0, z: 0 }, [sphere]);
    const box = node('box', { width: 20, height: 20, depth: 20 });
    const root = node('union', {}, [box, move]);

    // Inside the translated sphere, well clear of the box.
    expect(attributePath(root, [30, 0, 0])).toEqual([root.id, move.id, sphere.id]);
    // Inside the box, well clear of the sphere.
    expect(attributePath(root, [0, 0, 0])).toEqual([root.id, box.id]);
  });

  it('attributes a subtracted surface to the tool that cut it', () => {
    const drill = node('cylinder', { radius: 4, height: 100 });
    const stock = node('box', { width: 40, height: 40, depth: 40 });
    const root = node('subtract', {}, [stock, drill]);

    // On the axis of the drill: the material there was removed by the
    // cylinder, so the cylinder owns that surface.
    expect(attributePath(root, [0, 0, 0])).toEqual([root.id, drill.id]);
    // Out at the corner, far from the bore, the stock owns it.
    expect(attributePath(root, [18, 18, 18])).toEqual([root.id, stock.id]);
  });

  it('returns an empty path for a disabled subtree', () => {
    const box = node('box');
    box.enabled = false;
    expect(attributePath(box, [0, 0, 0])).toEqual([]);
    expect(attributePoint(box, [0, 0, 0])).toBeNull();
  });

  it('ignores unfilled placeholder slots when choosing a boolean branch', () => {
    const box = node('box', { width: 20, height: 20, depth: 20 });
    const root = node('union', {}, [box, emptySlot()]);

    // The placeholder is `enabled: false`, so the union has one real child and
    // the descent must go through it rather than treating the slot as a branch.
    expect(attributePath(root, [0, 0, 0])).toEqual([root.id, box.id]);
  });

  it('descends through modifiers and patterns to the shape underneath', () => {
    const hole = node('cylinder', { radius: 2, height: 50 });
    const pattern = node('linearPattern', { axisX: 1, axisY: 0, axisZ: 0, count: 3, spacing: 20 }, [hole]);
    const shell = node('shell', { thickness: 2 }, [pattern]);

    // Second copy of the patterned cylinder, 20mm along +X.
    expect(attributePath(shell, [20, 0, 0])).toEqual([shell.id, pattern.id, hole.id]);
  });

  it('uses the evaluator window for wide, offset linear-pattern children', () => {
    const wide = node('box', { width: 10, height: 10, depth: 10 });
    const shiftedWide = node('translate', { x: 37.5, y: 0, z: 0 }, [wide]);
    const small = node('sphere', { radius: 2 });
    const shiftedSmall = node('translate', { x: 10, y: 0, z: 0 }, [small]);
    const child = node('union', {}, [shiftedWide, shiftedSmall]);
    const pattern = node('linearPattern', { axisX: 1, axisY: 0, axisZ: 0, count: 3, spacing: 20 }, [child]);
    expect(attributePoint(pattern, [42.5, 0, 0])).toBe(wide.id);
  });

  it('selects an imported mesh instead of clearing the selection', () => {
    // `mesh` takes no children and compiles to a leaf field, but was absent
    // from the leaf set — so the descent fell through every branch to the
    // childless tail and returned nothing, which the viewport reads as "the
    // click missed the model" and deselects.
    const mesh = node('mesh', { resolution: 24 });
    mesh.data = { meshName: 'bracket.stl' };
    const move = node('translate', { x: 5, y: 0, z: 0 }, [mesh]);

    expect(attributePath(move, [5, 0, 0])).toEqual([move.id, mesh.id]);
    expect(attributePoint(move, [5, 0, 0])).toBe(mesh.id);
  });

  it('is unchanged by the transform between a point and its shape', () => {
    const box = node('box', { width: 10, height: 10, depth: 10 });
    const spin = node('rotate', { x: 0, y: 90, z: 0 }, [box]);
    const move = node('translate', { x: 0, y: 50, z: 0 }, [spin]);

    // The point is inside the box only once both transforms are undone.
    const hit: Vec3 = [0, 50, 0];
    expect(attributePath(move, hit)).toEqual([move.id, spin.id, box.id]);
  });
});

describe('attributePoint', () => {
  it('reports the last element of the path', () => {
    const sphere = node('sphere', { radius: 5 });
    const root = node('union', {}, [sphere, node('box', { width: 2, height: 2, depth: 2 })]);
    const path = attributePath(root, [0, 4.5, 0]);
    expect(attributePoint(root, [0, 4.5, 0])).toBe(path[path.length - 1]);
    expect(attributePoint(root, [0, 4.5, 0])).toBe(sphere.id);
  });
});
