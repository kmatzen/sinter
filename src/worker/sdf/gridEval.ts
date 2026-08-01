import { evaluateSDF } from './evaluate';
import { evaluateInterval } from './interval';
import type { SDFNode, BBox } from './types';

/**
 * Octree-accelerated grid evaluation.  Evaluates the SDF at the center
 * of each octree cell; if |sdf| > cell diagonal the entire region is
 * uniform (fully inside or outside) and all voxels are filled with
 * that value without further evaluation.  Only cells near the surface
 * are recursively subdivided down to individual voxels.
 */
export function evaluateCPUWithProgress(
  root: SDFNode, bbox: BBox, res: number, onProgress: (pct: number) => void,
): { grid: Float32Array; active: ActiveBlocks } {
  const grid = new Float32Array(res * res * res);

  /**
   * Which blocks the octree had to descend into.
   *
   * A block it filled uniformly was *proved* free of surface by an interval
   * enclosure excluding zero, so every voxel in it shares a sign and no dual
   * contouring cell wholly inside it can straddle. Recording the rest lets the
   * mesher iterate them instead of rediscovering activity by reading eight
   * corners of every cell in the grid — at 256 that is 33M cell visits for
   * roughly 360k active ones.
   */
  const nb = Math.ceil(res / ACTIVE_BLOCK) ;
  const marks = new Uint8Array(nb * nb * nb);
  const markVoxelRange = (x0: number, y0: number, z0: number, size: number) => {
    const bx1 = Math.min(nb - 1, ((x0 + size - 1) / ACTIVE_BLOCK) | 0);
    const by1 = Math.min(nb - 1, ((y0 + size - 1) / ACTIVE_BLOCK) | 0);
    const bz1 = Math.min(nb - 1, ((z0 + size - 1) / ACTIVE_BLOCK) | 0);
    for (let bz = (z0 / ACTIVE_BLOCK) | 0; bz <= bz1; bz++)
      for (let by = (y0 / ACTIVE_BLOCK) | 0; by <= by1; by++)
        for (let bx = (x0 / ACTIVE_BLOCK) | 0; bx <= bx1; bx++)
          marks[bz * nb * nb + by * nb + bx] = 1;
  };
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;
  const r2 = res * res;

  let evaluated = 0;
  const totalVoxels = res * res * res;
  let lastPct = -1;

  function reportProgress() {
    const pct = Math.round((evaluated / totalVoxels) * 60);
    if (pct > lastPct) { lastPct = pct; onProgress(pct); }
  }

  // Fill a block of voxels with a constant value
  function fillBlock(x0: number, y0: number, z0: number, size: number, val: number) {
    const x1 = Math.min(x0 + size, res);
    const y1 = Math.min(y0 + size, res);
    const z1 = Math.min(z0 + size, res);
    for (let z = z0; z < z1; z++) {
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          grid[z * r2 + y * res + x] = val;
        }
      }
    }
    evaluated += (x1 - x0) * (y1 - y0) * (z1 - z0);
  }

  function subdivide(x0: number, y0: number, z0: number, size: number) {
    if (x0 >= res || y0 >= res || z0 >= res) return;

    if (size <= 1) {
      // Single voxel — evaluate directly
      grid[z0 * r2 + y0 * res + x0] = evaluateSDF(root, [
        bbox.min[0] + (x0 + 0.5) * dx,
        bbox.min[1] + (y0 + 0.5) * dy,
        bbox.min[2] + (z0 + 0.5) * dz,
      ]);
      markVoxelRange(x0, y0, z0, 1);
      evaluated++;
      if ((evaluated & 0xFFFF) === 0) reportProgress();
      return;
    }

    // Evaluate SDF at the center of this block
    const cx = x0 + size * 0.5, cy = y0 + size * 0.5, cz = z0 + size * 0.5;
    const wx = cx * dx + bbox.min[0], wy = cy * dy + bbox.min[1], wz = cz * dz + bbox.min[2];
    const val = evaluateSDF(root, [wx, wy, wz]);

    // Whether this block is uniform is decided by an interval enclosure of the
    // field over the block, not by comparing the centre sample against the
    // block diagonal.  The latter is only valid when the field never
    // overstates distance, which several nodes did not honour (#70, #71) —
    // and when it is wrong the block is filled solid or empty and the surface
    // inside it is erased.  An interval that excludes zero is a proof.
    const cell: BBox = {
      min: [bbox.min[0] + x0 * dx, bbox.min[1] + y0 * dy, bbox.min[2] + z0 * dz],
      max: [bbox.min[0] + (x0 + size) * dx, bbox.min[1] + (y0 + size) * dy, bbox.min[2] + (z0 + size) * dz],
    };
    const enclosure = evaluateInterval(root, cell);
    if (enclosure.lo > 0 || enclosure.hi < 0) {
      // Provably no surface in this block — fill it and stop descending.
      fillBlock(x0, y0, z0, size, val);
      reportProgress();
      return;
    }

    // Subdivide into 8 children
    const half = size >> 1;
    if (half === 0) {
      // Can't subdivide further — evaluate remaining voxels directly
      const x1 = Math.min(x0 + size, res);
      const y1 = Math.min(y0 + size, res);
      const z1 = Math.min(z0 + size, res);
      for (let z = z0; z < z1; z++) {
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            grid[z * r2 + y * res + x] = evaluateSDF(root, [
              bbox.min[0] + (x + 0.5) * dx,
              bbox.min[1] + (y + 0.5) * dy,
              bbox.min[2] + (z + 0.5) * dz,
            ]);
            evaluated++;
          }
        }
      }
      markVoxelRange(x0, y0, z0, size);
      reportProgress();
      return;
    }

    subdivide(x0, y0, z0, half);
    subdivide(x0 + half, y0, z0, half);
    subdivide(x0, y0 + half, z0, half);
    subdivide(x0 + half, y0 + half, z0, half);
    subdivide(x0, y0, z0 + half, half);
    subdivide(x0 + half, y0, z0 + half, half);
    subdivide(x0, y0 + half, z0 + half, half);
    subdivide(x0 + half, y0 + half, z0 + half, half);
  }

  // Start with power-of-2 block size that covers the grid
  let blockSize = 1;
  while (blockSize < res) blockSize <<= 1;

  subdivide(0, 0, 0, blockSize);

  return { grid, active: dilateBlocks(marks, nb) };
}

/** Block size, in voxels, of the active-cell mask. */
const ACTIVE_BLOCK = 8;

export interface ActiveBlocks {
  /** Blocks per axis. */
  nb: number;
  /** 1 where a dual-contouring cell may straddle. */
  bits: Uint8Array;
}

/**
 * Grow the mask by one block in every direction.
 *
 * A cell spans two voxels per axis, so one whose origin sits in the last voxel
 * of a block reaches into the next one. Two adjacent blocks the octree filled
 * uniformly cannot disagree in sign — the field is provably non-zero
 * throughout each closed block, and they share a face — so every straddling
 * cell has a corner in a descended block, and this dilation covers the cells
 * whose origin lies just outside one.
 *
 * Erring wide only costs cells visited; erring narrow is a hole in the mesh.
 */
function dilateBlocks(marks: Uint8Array, nb: number): ActiveBlocks {
  const out = new Uint8Array(marks.length);
  for (let z = 0; z < nb; z++) {
    for (let y = 0; y < nb; y++) {
      for (let x = 0; x < nb; x++) {
        if (!marks[z * nb * nb + y * nb + x]) continue;
        for (let dz = -1; dz <= 1; dz++) {
          const nz = z + dz; if (nz < 0 || nz >= nb) continue;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = y + dy; if (ny < 0 || ny >= nb) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx; if (nx < 0 || nx >= nb) continue;
              out[nz * nb * nb + ny * nb + nx] = 1;
            }
          }
        }
      }
    }
  }
  return { nb, bits: out };
}
