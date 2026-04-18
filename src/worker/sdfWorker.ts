/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import type { WorkerRequest, ClipPlane } from '../types/geometry';
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

const RESOLUTION = 192;

self.postMessage({ type: 'ready' });

function evaluateAndMesh(tree: SDFNodeUI | null, resolution = RESOLUTION, _clip?: ClipPlane) {
  if (!tree) return null;
  let root = toSDFNode(tree);
  if (!root) return null;

  // Clipping is handled on the GPU side, not in the SDF

  const bbox = computeBounds(root);
  const margin = Math.max(
    (bbox.max[0] - bbox.min[0]) * 0.1,
    (bbox.max[1] - bbox.min[1]) * 0.1,
    (bbox.max[2] - bbox.min[2]) * 0.1,
    1,
  );
  bbox.min = [bbox.min[0] - margin, bbox.min[1] - margin, bbox.min[2] - margin];
  bbox.max = [bbox.max[0] + margin, bbox.max[1] + margin, bbox.max[2] + margin];

  const grid = evaluateCPU(root, bbox, resolution);

  const mesh = dualContour(grid, resolution, bbox, root);

  return mesh;
}

function evaluateCPU(root: SDFNode, bbox: BBox, res: number): Float32Array {
  const grid = new Float32Array(res * res * res);
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;

  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        grid[z * res * res + y * res + x] = evaluateSDF(root, [
          bbox.min[0] + (x + 0.5) * dx,
          bbox.min[1] + (y + 0.5) * dy,
          bbox.min[2] + (z + 0.5) * dz,
        ]);
      }
    }
  }
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
        const bbox = computeBounds(root);
        const margin = Math.max(
          (bbox.max[0] - bbox.min[0]) * 0.1,
          (bbox.max[1] - bbox.min[1]) * 0.1,
          (bbox.max[2] - bbox.min[2]) * 0.1,
          1,
        );
        const bbMin: [number, number, number] = [bbox.min[0] - margin, bbox.min[1] - margin, bbox.min[2] - margin];
        const bbMax: [number, number, number] = [bbox.max[0] + margin, bbox.max[1] + margin, bbox.max[2] + margin];
        const compiled = generateSDFFunction(root);
        self.postMessage({ type: 'sdf', glsl: compiled.glsl, paramCount: compiled.paramCount, paramValues: compiled.paramValues, textures: compiled.textures, bbMin, bbMax });
        break;
      }

      case 'exportSTL': {
        const mesh = evaluateAndMesh(req.tree, 256);
        if (!mesh) { self.postMessage({ type: 'error', message: 'No geometry to export' }); return; }
        const simplified = simplifyMesh(mesh, 0.5);
        const data = exportBinarySTL(simplified);
        self.postMessage({ type: 'exportResult', format: 'stl' as const, data }, [data]);
        break;
      }

      case 'export3MF': {
        const mesh = evaluateAndMesh(req.tree, 256);
        if (!mesh) { self.postMessage({ type: 'error', message: 'No geometry to export' }); return; }
        const simplified = simplifyMesh(mesh, 0.5);
        const data = export3MF(simplified);
        self.postMessage({ type: 'exportResult', format: '3mf' as const, data }, [data]);
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
