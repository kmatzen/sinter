import { describe, it, expect } from 'vitest';
import { evaluateCPUWithProgress } from './gridEval';
import type { SDFNode, BBox } from './types';

/**
 * Sharding the grid across workers (#88 A4) splits it into z-slabs, so a slab
 * has to produce exactly the values a full run produces for that z range.
 *
 * The octree still descends the whole cube's block structure and only the
 * writes and evaluations are confined, precisely so this holds — an octree
 * rebuilt over a slab-shaped region would make different subdivision
 * decisions at the boundary and the seam would not match.
 */
describe('gridEval z-slabs', () => {
  const CASES: [string, SDFNode][] = [
    ['sphere', { kind: 'sphere', radius: 6 }],
    ['subtract', {
      kind: 'subtract', k: 0,
      a: { kind: 'box', size: [12, 12, 12] },
      b: { kind: 'sphere', radius: 7 },
    }],
    ['two disjoint spheres', {
      kind: 'union', k: 0,
      a: { kind: 'transform', child: { kind: 'sphere', radius: 3 }, tx: 0, ty: 0, tz: -7, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
      b: { kind: 'transform', child: { kind: 'sphere', radius: 3 }, tx: 0, ty: 0, tz: 7, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 },
    }],
  ];

  it.each(CASES)('%s: slabs reassemble into the full grid exactly', (_name, node) => {
    const res = 32;
    const bbox: BBox = { min: [-10, -10, -10], max: [10, 10, 10] };
    const full = evaluateCPUWithProgress(node, bbox, res, () => {});

    // Four shards, deliberately not aligned to the octree's block size, so a
    // slab boundary falls inside a block.
    const cuts = [0, 7, 15, 23, res];
    const merged = new Float32Array(res * res * res);
    const mergedBits = new Uint8Array(full.active.bits.length);
    for (let i = 0; i < cuts.length - 1; i++) {
      const part = evaluateCPUWithProgress(node, bbox, res, () => {}, { z0: cuts[i], z1: cuts[i + 1] });
      for (let z = cuts[i]; z < cuts[i + 1]; z++) {
        merged.set(part.grid.subarray(z * res * res, (z + 1) * res * res), z * res * res);
      }
      for (let b = 0; b < mergedBits.length; b++) mergedBits[b] |= part.active.bits[b];
    }

    expect(Array.from(merged)).toEqual(Array.from(full.grid));
    // The mask may be wider than a single run's — a slab marks blocks its own
    // dilation touches — but it must never be narrower, or the mesher skips a
    // cell that has geometry in it.
    for (let b = 0; b < mergedBits.length; b++) {
      if (full.active.bits[b]) expect(mergedBits[b]).toBe(1);
    }
  });
});
