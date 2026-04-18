/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import type { WorkerRequest } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';
import type { SDFNode, BBox } from './sdf/types';
import { evaluateSDF } from './sdf/evaluate';
import { computeBounds } from './sdf/bounds';
import { generateSDFFunction } from './sdf/codegen';
import { dualContour } from './sdf/dualContour';
import { exportBinarySTL } from './stlExporter';
import { export3MF } from './exporters';
import { toSDFNode } from './sdf/convert';
import { simplifyMesh } from './sdf/simplify';

self.postMessage({ type: 'ready' });

type ProgressFn = (stage: string, percent: number) => void;

function prepareBBox(root: SDFNode): BBox {
  const bbox = computeBounds(root);
  const margin = Math.max(
    (bbox.max[0] - bbox.min[0]) * 0.1,
    (bbox.max[1] - bbox.min[1]) * 0.1,
    (bbox.max[2] - bbox.min[2]) * 0.1,
    1,
  );
  bbox.min = [bbox.min[0] - margin, bbox.min[1] - margin, bbox.min[2] - margin];
  bbox.max = [bbox.max[0] + margin, bbox.max[1] + margin, bbox.max[2] + margin];
  return bbox;
}

function evaluateAndMeshWithProgress(tree: SDFNodeUI | null, resolution: number, progress: ProgressFn) {
  if (!tree) return null;
  let root = toSDFNode(tree);
  if (!root) return null;

  const bbox = prepareBBox(root);

  // Grid evaluation with progress
  progress('Evaluating SDF grid', 0);
  const grid = evaluateCPUWithProgress(root, bbox, resolution, (pct) => {
    progress('Evaluating SDF grid', pct);
  });

  // Dual contouring (60-80%)
  progress('Generating mesh', 60);
  const mesh = dualContour(grid, resolution, bbox, root, (pct) => {
    progress('Generating mesh', 60 + pct * 0.2);
  });

  return mesh;
}

/**
 * Octree-accelerated grid evaluation.  Evaluates the SDF at the center
 * of each octree cell; if |sdf| > cell diagonal the entire region is
 * uniform (fully inside or outside) and all voxels are filled with
 * that value without further evaluation.  Only cells near the surface
 * are recursively subdivided down to individual voxels.
 */
function evaluateCPUWithProgress(root: SDFNode, bbox: BBox, res: number, onProgress: (pct: number) => void): Float32Array {
  const grid = new Float32Array(res * res * res);
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
      evaluated++;
      if ((evaluated & 0xFFFF) === 0) reportProgress();
      return;
    }

    // Evaluate SDF at the center of this block
    const cx = x0 + size * 0.5, cy = y0 + size * 0.5, cz = z0 + size * 0.5;
    const wx = cx * dx + bbox.min[0], wy = cy * dy + bbox.min[1], wz = cz * dz + bbox.min[2];
    const val = evaluateSDF(root, [wx, wy, wz]);

    // Cell diagonal in world space
    const diag = Math.sqrt((size * dx) ** 2 + (size * dy) ** 2 + (size * dz) ** 2);

    if (Math.abs(val) > diag * 0.6) {
      // Entire block is uniform — fill without further evaluation
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

  return grid;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  try {
    switch (req.type) {
      case 'evaluate': {
        if (!req.tree) {
          self.postMessage({ type: 'sdf', glsl: '', paramCount: 0, paramValues: [], bbMin: [0,0,0], bbMax: [0,0,0] });
          return;
        }
        const root = toSDFNode(req.tree);
        if (!root) {
          self.postMessage({ type: 'sdf', glsl: '', paramCount: 0, paramValues: [], bbMin: [0,0,0], bbMax: [0,0,0] });
          return;
        }
        const bbox = prepareBBox(root);
        const bbMin: [number, number, number] = [...bbox.min];
        const bbMax: [number, number, number] = [...bbox.max];
        const compiled = generateSDFFunction(root);
        self.postMessage({ type: 'sdf', glsl: compiled.glsl, paramCount: compiled.paramCount, paramValues: compiled.paramValues, textures: compiled.textures, bbMin, bbMax, hasWarn: compiled.hasWarn });
        break;
      }

      case 'exportSTL': {
        const progress: ProgressFn = (stage, percent) => {
          self.postMessage({ type: 'progress', stage, percent: Math.round(percent) });
        };
        const mesh = evaluateAndMeshWithProgress(req.tree, 256, progress);
        if (!mesh) { self.postMessage({ type: 'error', message: 'No geometry to export' }); return; }
        progress('Simplifying mesh', 80);
        const simplified = simplifyMesh(mesh, 0.5, (pct) => {
          progress('Simplifying mesh', 80 + pct * 0.15);
        });
        progress('Encoding STL', 95);
        const data = exportBinarySTL(simplified);
        self.postMessage({ type: 'exportResult', format: 'stl' as const, data }, [data]);
        break;
      }

      case 'export3MF': {
        const progress: ProgressFn = (stage, percent) => {
          self.postMessage({ type: 'progress', stage, percent: Math.round(percent) });
        };
        const mesh = evaluateAndMeshWithProgress(req.tree, 256, progress);
        if (!mesh) { self.postMessage({ type: 'error', message: 'No geometry to export' }); return; }
        progress('Simplifying mesh', 80);
        const simplified = simplifyMesh(mesh, 0.5, (pct) => {
          progress('Simplifying mesh', 80 + pct * 0.15);
        });
        progress('Encoding 3MF', 95);
        const data = export3MF(simplified);
        self.postMessage({ type: 'exportResult', format: '3mf' as const, data }, [data]);
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
