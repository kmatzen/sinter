/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import type { WorkerRequest } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';
import type { SDFNode, BBox } from './sdf/types';
import { computeBounds } from './sdf/bounds';
import { verifiedBounds } from './sdf/interval';
import { evaluateCPUWithProgress } from './sdf/gridEval';
import { generateSDFFunction } from './sdf/codegen';
import { dualContour } from './sdf/dualContour';
import { exportBinarySTL } from './stlExporter';
import { export3MF } from './exporters';
import { toSDFNode } from './sdf/convert';
import { simplifyMesh } from './sdf/simplify';
import { removeDegenerateTriangles, projectVerticesToSurface } from './sdf/meshRepair';

self.postMessage({ type: 'ready' });

type ProgressFn = (stage: string, percent: number) => void;

/**
 * Export grid resolution, clamped.
 *
 * Cost is cubic in this, so the ceiling is not politeness — 512 is eight times
 * the work of 256, and 256 already dominates the export. The floor keeps a
 * mis-set value from producing a mesh too coarse to be a part rather than
 * merely a fast one.
 */
const DEFAULT_EXPORT_RESOLUTION = 256;
function exportResolution(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return DEFAULT_EXPORT_RESOLUTION;
  return Math.max(32, Math.min(512, Math.round(requested)));
}

function prepareBBox(root: SDFNode): BBox {
  // `computeBounds` is only the starting hint.  The grid the mesh is built on
  // comes from `verifiedBounds`, which asks the field itself where it can be
  // negative instead of composing a rule per node kind — the mesher should not
  // be able to clip geometry just because a bounds rule and the evaluator
  // disagree, which is what #70 and #73 both were.
  const bbox = verifiedBounds(root, computeBounds(root)) ?? computeBounds(root);
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

/**
 * Full export meshing pipeline:
 *   1. SDF grid evaluation (interval-verified octree descent)
 *   2. Manifold dual contouring with SVD QEF vertex placement
 *   3. Degenerate-face cleanup
 *   4. Error-bounded QEM simplification (budget: 5% of a voxel)
 *   5. Newton projection of the surviving vertices back onto the SDF
 *      zero set, clearing the residual bias simplification introduced
 */
function evaluateAndMeshWithProgress(tree: SDFNodeUI | null, resolution: number, progress: ProgressFn) {
  if (!tree) return null;
  const root = toSDFNode(tree);
  if (!root) return null;

  const bbox = prepareBBox(root);
  const voxel = Math.max(
    (bbox.max[0] - bbox.min[0]) / resolution,
    (bbox.max[1] - bbox.min[1]) / resolution,
    (bbox.max[2] - bbox.min[2]) / resolution,
  );

  // Grid evaluation with progress (0-60%)
  progress('Evaluating SDF grid', 0);
  const { grid, active } = evaluateCPUWithProgress(root, bbox, resolution, (pct) => {
    progress('Evaluating SDF grid', pct);
  });

  // Dual contouring (60-80%)
  progress('Generating mesh', 60);
  const raw = dualContour(grid, resolution, bbox, root, (pct) => {
    progress('Generating mesh', 60 + pct * 0.2);
  }, active);
  if (raw.indices.length === 0) return null;

  // Simplification (80-92%)
  progress('Simplifying mesh', 80);
  const simplified = simplifyMesh(removeDegenerateTriangles(raw), { maxError: voxel * 0.05 }, (pct) => {
    progress('Simplifying mesh', 80 + pct * 0.12);
  });

  // Surface snap (92-95%)
  progress('Refining surface', 92);
  return projectVerticesToSurface(simplified, root, voxel * 0.5);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const rid = req.rid;

  try {
    switch (req.type) {
      case 'evaluate': {
        if (!req.tree) {
          self.postMessage({ type: 'sdf', rid, glsl: '', paramCount: 0, paramValues: [], bbMin: [0,0,0], bbMax: [0,0,0] });
          return;
        }
        const root = toSDFNode(req.tree);
        if (!root) {
          self.postMessage({ type: 'sdf', rid, glsl: '', paramCount: 0, paramValues: [], bbMin: [0,0,0], bbMax: [0,0,0] });
          return;
        }
        const bbox = prepareBBox(root);
        const bbMin: [number, number, number] = [...bbox.min];
        const bbMax: [number, number, number] = [...bbox.max];
        const compiled = generateSDFFunction(root);
        self.postMessage({ type: 'sdf', rid, glsl: compiled.glsl, paramCount: compiled.paramCount, paramValues: compiled.paramValues, textures: compiled.textures, bbMin, bbMax, hasWarn: compiled.hasWarn });
        break;
      }

      case 'exportSTL': {
        const progress: ProgressFn = (stage, percent) => {
          self.postMessage({ type: 'progress', rid, stage, percent: Math.round(percent) });
        };
        const mesh = evaluateAndMeshWithProgress(req.tree, exportResolution(req.resolution), progress);
        if (!mesh) { self.postMessage({ type: 'error', rid, message: 'No geometry to export' }); return; }
        progress('Encoding STL', 95);
        const data = exportBinarySTL(mesh);
        self.postMessage({ type: 'exportResult', rid, format: 'stl' as const, data }, [data]);
        break;
      }

      case 'export3MF': {
        const progress: ProgressFn = (stage, percent) => {
          self.postMessage({ type: 'progress', rid, stage, percent: Math.round(percent) });
        };
        const mesh = evaluateAndMeshWithProgress(req.tree, exportResolution(req.resolution), progress);
        if (!mesh) { self.postMessage({ type: 'error', rid, message: 'No geometry to export' }); return; }
        progress('Encoding 3MF', 95);
        const data = export3MF(mesh);
        self.postMessage({ type: 'exportResult', rid, format: '3mf' as const, data }, [data]);
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', rid, message: err.message || String(err) });
  }
};
