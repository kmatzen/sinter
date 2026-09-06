/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import type { ExportConformance, WorkerRequest } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';
import { isTreeExportable } from '../types/operations';
import type { SDFNode, BBox } from './sdf/types';
import { computeBounds } from './sdf/bounds';
import { verifiedBounds } from './sdf/interval';
import { evaluateCPUWithProgress } from './sdf/gridEval';
import { fitPrimitive } from './sdf/fitPrimitive';
import { bakeMeshField } from './sdf/meshField';
import { decodeMeshPositions, DEFAULT_MESH_RESOLUTION } from './sdf/convert';
import type { MeshFitResult } from '../types/geometry';
import { generateSDFFunction } from './sdf/codegen';
import { dualContour } from './sdf/dualContour';
import { exportBinarySTL } from './stlExporter';
import { export3MF } from './exporters';
import { toSDFNode } from './sdf/convert';
import { simplifyMesh } from './sdf/simplify';
import { CLUSTER_ERROR_VOXELS, SIMPLIFY_ERROR_VOXELS, PROJECT_TOLERANCE_VOXELS } from './sdf/budgets';
import { analyzeMesh, analyzeOverhangs, analyzeWallThickness, removeDegenerateTriangles, projectVerticesToSurface } from './sdf/meshRepair';
import { validateModelingEnvelope } from './sdf/modelingEnvelope';
import { partitionExportComponents, planComponentSampling } from './sdf/exportComponents';
import type { MeshResult } from './sdf/marchingCubes';
import { combineConformance, conformanceSourceBudget, sampleActiveGridSurface, verifyMeshConformance } from './sdf/meshConformance';

self.postMessage({ type: 'ready' });

type ProgressFn = (stage: string, percent: number) => void;

/**
 * Export grid resolution, clamped.
 *
 * The ceiling is memory, not patience. The grid alone is `res^3` floats:
 *
 *   128 -> 8 MB     256 -> 67 MB     384 -> 226 MB     512 -> 537 MB
 *
 * and the mesher's buffers sit on top of that. 384 is already a large
 * allocation for a worker; 512 is most of a browser tab's budget before any
 * geometry exists, and running out there loses the export rather than slowing
 * it. So the ceiling matches the highest setting the UI offers, instead of
 * leaving a programmatic caller a way to reach a resolution nobody has run.
 *
 * The floor keeps a mis-set value producing a coarse part rather than an
 * unusable one.
 */
const DEFAULT_EXPORT_RESOLUTION = 256;
const MAX_EXPORT_RESOLUTION = 384;
function exportResolution(requested: number | undefined): number {
  if (!requested || !Number.isFinite(requested)) return DEFAULT_EXPORT_RESOLUTION;
  return Math.max(32, Math.min(MAX_EXPORT_RESOLUTION, Math.round(requested)));
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
 *   2. Manifold dual contouring with SVD QEF vertex placement, collapsing
 *      cells one vertex can represent so a flat face never becomes thousands
 *      of triangles that step 4 would only have to take away again
 *   3. Degenerate-face cleanup
 *   4. Error-bounded QEM simplification
 *   5. Newton projection of the surviving vertices back onto the SDF
 *      zero set, clearing the residual bias simplification introduced
 */
function evaluateAndMeshWithProgress(tree: SDFNodeUI | null, resolution: number, progress: ProgressFn) {
  if (!tree) return null;
  const root = toSDFNode(tree);
  if (!root) return null;
  validateModelingEnvelope(root);

  const components = partitionExportComponents(root);
  const meshes: MeshResult[] = [];
  const conformances: ExportConformance[] = [];
  let achievedTolerance = 0;
  const report = (index: number, stage: string, localPercent: number) =>
    progress(components.length > 1 ? `${stage} (${index + 1}/${components.length})` : stage,
      ((index + localPercent / 95) / components.length) * 95);
  for (let index = 0; index < components.length; index++) {
    const component = components[index];
    const bbox = prepareBBox(component);
    const plan = planComponentSampling(component, bbox, resolution, MAX_EXPORT_RESOLUTION);
    const componentResolution = plan.resolution;
    const voxel = Math.max(...plan.voxel);
    achievedTolerance = Math.max(achievedTolerance, plan.tolerance);
    report(index, 'Evaluating SDF grid', 0);
    const { grid, active } = evaluateCPUWithProgress(component, bbox, componentResolution, (pct) => report(index, 'Evaluating SDF grid', pct));
    report(index, 'Generating mesh', 60);
    const raw = dualContour(grid, componentResolution, bbox, component, (pct) => report(index, 'Generating mesh', 60 + pct * 0.2), active, voxel * CLUSTER_ERROR_VOXELS);
    if (raw.indices.length === 0) throw new Error(`Export could not resolve component ${index + 1} of ${components.length} at ${voxel.toPrecision(4)} mm per voxel; increase export quality or enlarge the feature`);
    report(index, 'Simplifying mesh', 80);
    const simplified = simplifyMesh(removeDegenerateTriangles(raw), { maxError: voxel * SIMPLIFY_ERROR_VOXELS }, (pct) => report(index, 'Simplifying mesh', 80 + pct * 0.12));
    report(index, 'Refining surface', 92);
    const mesh = projectVerticesToSurface(simplified, component, voxel * PROJECT_TOLERANCE_VOXELS);
    report(index, 'Verifying geometry', 94);
    const source = sampleActiveGridSurface(grid, componentResolution, bbox, active, conformanceSourceBudget(mesh));
    const conformance = verifyMeshConformance(mesh, component, bbox, plan.tolerance, {
      sourcePoints: source.points,
      sourceCoverageComplete: source.coverageComplete,
    });
    if (conformance.status === 'failed') {
      throw new Error(`Export geometry deviates by ${conformance.maxDeviation.toPrecision(4)} mm, exceeding the verified ${conformance.tolerance.toPrecision(4)} mm tolerance`);
    }
    meshes.push(mesh);
    conformances.push(conformance);
  }
  const conformance = combineConformance(conformances);
  if (meshes.length === 1) return { mesh: meshes[0], achievedTolerance, componentCount: components.length, conformance };
  const positionCount = meshes.reduce((sum, mesh) => sum + mesh.positions.length, 0);
  const normalCount = meshes.reduce((sum, mesh) => sum + mesh.normals.length, 0);
  const indexCount = meshes.reduce((sum, mesh) => sum + mesh.indices.length, 0);
  const positions = new Float32Array(positionCount), normals = new Float32Array(normalCount), indices = new Uint32Array(indexCount);
  let positionOffset = 0, normalOffset = 0, indexOffset = 0, vertexOffset = 0;
  for (const mesh of meshes) {
    positions.set(mesh.positions, positionOffset); normals.set(mesh.normals, normalOffset);
    for (let i = 0; i < mesh.indices.length; i++) indices[indexOffset + i] = mesh.indices[i] + vertexOffset;
    positionOffset += mesh.positions.length; normalOffset += mesh.normals.length; indexOffset += mesh.indices.length; vertexOffset += mesh.positions.length / 3;
  }
  return { mesh: { positions, normals, indices }, achievedTolerance, componentCount: components.length, conformance };
}

/**
 * Turn the fitter's output back into a document node.
 *
 * Only handles what `fitPrimitive` emits — a primitive, optionally inside one
 * transform — rather than being a general inverse of `toSDFNode`. A general one
 * would be a second source of truth for the conversion and would rot.
 */
function toUINode(node: SDFNode): SDFNodeUI {
  const id = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  switch (node.kind) {
    case 'box':
      return { id: id(), kind: 'box', label: 'Box', params: { width: node.size[0], height: node.size[1], depth: node.size[2] }, children: [], enabled: true };
    case 'sphere':
      return { id: id(), kind: 'sphere', label: 'Sphere', params: { radius: node.radius }, children: [], enabled: true };
    case 'cylinder':
      return { id: id(), kind: 'cylinder', label: 'Cylinder', params: { radius: node.radius, height: node.height }, children: [], enabled: true };
    case 'capsule':
      return { id: id(), kind: 'capsule', label: 'Capsule', params: { radius: node.radius, height: node.height }, children: [], enabled: true };
    case 'transform': {
      let out = toUINode(node.child);
      if (node.rx || node.ry || node.rz) {
        out = { id: id(), kind: 'rotate', label: 'Rotate', params: { x: node.rx, y: node.ry, z: node.rz }, children: [out], enabled: true };
      }
      if (node.tx || node.ty || node.tz) {
        out = { id: id(), kind: 'translate', label: 'Translate', params: { x: node.tx, y: node.ty, z: node.tz }, children: [out], enabled: true };
      }
      return out;
    }
    default:
      throw new Error(`fit produced an unexpected node kind: ${node.kind}`);
  }
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
        validateModelingEnvelope(root);
        const bbox = prepareBBox(root);
        const bbMin: [number, number, number] = [...bbox.min];
        const bbMax: [number, number, number] = [...bbox.max];
        const compiled = generateSDFFunction(root);
        self.postMessage({ type: 'sdf', rid, glsl: compiled.glsl, paramCount: compiled.paramCount, paramValues: compiled.paramValues, textures: compiled.textures, bbMin, bbMax, hasWarn: compiled.hasWarn });
        break;
      }

      case 'fitMesh': {
        const positions = decodeMeshPositions(req.meshPositions);
        const res = Math.max(8, Math.min(96, Math.round(req.resolution || DEFAULT_MESH_RESOLUTION)));
        const fit = fitPrimitive(bakeMeshField(positions, res));
        const out: MeshFitResult | null = fit === null ? null : {
          kind: fit.kind,
          surfaceMax: fit.surfaceMax,
          surfaceRms: fit.surfaceRms,
          relativeError: fit.relativeError,
          acceptable: fit.acceptable,
          node: toUINode(fit.node),
        };
        self.postMessage({ type: 'fitResult', rid, fit: out });
        break;
      }

      case 'exportSTL': {
        if (!isTreeExportable(req.tree)) {
          self.postMessage({ type: 'error', rid, message: 'Complete every enabled operation before exporting' }); return;
        }
        const progress: ProgressFn = (stage, percent) => {
          self.postMessage({ type: 'progress', rid, stage, percent: Math.round(percent) });
        };
        const result = evaluateAndMeshWithProgress(req.tree, exportResolution(req.resolution), progress);
        if (!result) { self.postMessage({ type: 'error', rid, message: 'No geometry to export' }); return; }
        const { mesh, achievedTolerance, componentCount, conformance } = result;
        progress('Encoding STL', 95);
        const data = exportBinarySTL(mesh);
        const preflight = req.preflight ?? { overhangAngle: 45, buildDirection: 'z', minimumWallThickness: 1.2 };
        const diagnostics = { ...analyzeMesh(mesh), overhang: analyzeOverhangs(mesh, preflight), thickness: analyzeWallThickness(mesh, preflight.minimumWallThickness) };
        self.postMessage({ type: 'exportResult', rid, format: 'stl' as const, data,
          vertexCount: mesh.positions.length / 3, triangleCount: mesh.indices.length / 3, diagnostics, achievedTolerance, componentCount, conformance }, [data]);
        break;
      }

      case 'export3MF': {
        if (!isTreeExportable(req.tree)) {
          self.postMessage({ type: 'error', rid, message: 'Complete every enabled operation before exporting' }); return;
        }
        const progress: ProgressFn = (stage, percent) => {
          self.postMessage({ type: 'progress', rid, stage, percent: Math.round(percent) });
        };
        const result = evaluateAndMeshWithProgress(req.tree, exportResolution(req.resolution), progress);
        if (!result) { self.postMessage({ type: 'error', rid, message: 'No geometry to export' }); return; }
        const { mesh, achievedTolerance, componentCount, conformance } = result;
        progress('Encoding 3MF', 95);
        const data = export3MF(mesh);
        const preflight = req.preflight ?? { overhangAngle: 45, buildDirection: 'z', minimumWallThickness: 1.2 };
        const diagnostics = { ...analyzeMesh(mesh), overhang: analyzeOverhangs(mesh, preflight), thickness: analyzeWallThickness(mesh, preflight.minimumWallThickness) };
        self.postMessage({ type: 'exportResult', rid, format: '3mf' as const, data,
          vertexCount: mesh.positions.length / 3, triangleCount: mesh.indices.length / 3, diagnostics, achievedTolerance, componentCount, conformance }, [data]);
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', rid, message: err.message || String(err) });
  }
};
