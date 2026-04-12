/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import type { WorkerRequest, ClipPlane } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';
import type { SDFNode, BBox } from './sdf/types';
import { evaluateSDF } from './sdf/evaluate';
import { computeBounds } from './sdf/bounds';
import { generateGLSL } from './sdf/codegen';
import { GPUEvaluator } from './sdf/gpu';
import { marchingCubes } from './sdf/marchingCubes';
import { exportBinarySTL } from './stlExporter';
import { export3MF } from './exporters';
import { computeThickness } from './sdf/thickness';

const RESOLUTION = 128;

let gpu: GPUEvaluator | null = null;

function init() {
  try {
    gpu = new GPUEvaluator();
  } catch (err: any) {
    console.warn('GPU not available, using CPU fallback:', err.message);
  }
  self.postMessage({ type: 'ready' });
}

init();

// Convert UI tree to internal SDFNode (strip UI metadata)
function toSDFNode(ui: SDFNodeUI): SDFNode | null {
  if (!ui.enabled) return null;

  const p = ui.params;
  const children = ui.children.map(toSDFNode).filter((c): c is SDFNode => c !== null);

  switch (ui.kind) {
    case 'box': return { kind: 'box', size: [p.width, p.height, p.depth] };
    case 'sphere': return { kind: 'sphere', radius: p.radius };
    case 'cylinder': return { kind: 'cylinder', radius: p.radius, height: p.height };
    case 'torus': return { kind: 'torus', major: p.majorRadius, minor: p.minorRadius };

    case 'union':
    case 'subtract':
    case 'intersect':
      if (children.length < 2) return children[0] || null;
      return { kind: ui.kind as 'union' | 'subtract' | 'intersect', a: children[0], b: children[1], k: p.smooth || 0 };

    case 'shell':
      if (children.length < 1) return null;
      return { kind: 'shell', child: children[0], thickness: p.thickness };

    case 'offset':
      if (children.length < 1) return null;
      return { kind: 'offset', child: children[0], distance: p.distance };

    case 'round':
      if (children.length < 1) return null;
      return { kind: 'round', child: children[0], radius: p.radius };

    case 'translate':
    case 'rotate':
    case 'scale':
      if (children.length < 1) return null;
      return {
        kind: 'transform',
        child: children[0],
        tx: ui.kind === 'translate' ? p.x : 0,
        ty: ui.kind === 'translate' ? p.y : 0,
        tz: ui.kind === 'translate' ? p.z : 0,
        rx: ui.kind === 'rotate' ? p.x : 0,
        ry: ui.kind === 'rotate' ? p.y : 0,
        rz: ui.kind === 'rotate' ? p.z : 0,
        sx: ui.kind === 'scale' ? p.x : 1,
        sy: ui.kind === 'scale' ? p.y : 1,
        sz: ui.kind === 'scale' ? p.z : 1,
      };

    case 'mirror':
      if (children.length < 1) return null;
      return { kind: 'mirror', child: children[0], axes: [p.mirrorX ? 1 : 0, p.mirrorY ? 1 : 0, p.mirrorZ ? 1 : 0] as [number, number, number] };

    case 'linearPattern':
      if (children.length < 1) return null;
      return {
        kind: 'linearPattern',
        child: children[0],
        axis: [p.axisX || 0, p.axisY || 0, p.axisZ || 0] as [number, number, number],
        count: p.count || 2,
        spacing: p.spacing || 10,
      };

    case 'circularPattern':
      if (children.length < 1) return null;
      return {
        kind: 'circularPattern',
        child: children[0],
        axis: [p.axisX || 0, p.axisY || 1, p.axisZ || 0] as [number, number, number],
        count: p.count || 4,
      };

    default: return null;
  }
}

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

  let grid: Float32Array;

  if (gpu) {
    const glsl = generateGLSL(root);
    grid = gpu.evaluate(glsl, bbox, resolution);
  } else {
    grid = evaluateCPU(root, bbox, resolution);
  }

  const mesh = marchingCubes(grid, resolution, bbox);

  // Compute wall thickness for each vertex
  if (mesh.positions.length > 0) {
    const thick = computeThickness(mesh.positions, mesh.normals, grid, resolution, bbox);
    return { ...mesh, thickness: thick };
  }

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
        const mesh = evaluateAndMesh(req.tree, req.resolution || RESOLUTION, req.clip);
        if (!mesh) {
          const empty = new ArrayBuffer(0);
          self.postMessage({ type: 'mesh', positions: empty, normals: empty, indices: empty }, [empty]);
          return;
        }
        const posBuf = mesh.positions.buffer as ArrayBuffer;
        const normBuf = mesh.normals.buffer as ArrayBuffer;
        const idxBuf = mesh.indices.buffer as ArrayBuffer;
        const transfers = [posBuf, normBuf, idxBuf];
        const msg: any = { type: 'mesh', positions: posBuf, normals: normBuf, indices: idxBuf };
        if (mesh.thickness) {
          msg.thickness = mesh.thickness.buffer as ArrayBuffer;
          transfers.push(msg.thickness);
        }
        self.postMessage(msg, transfers);
        break;
      }

      case 'exportSTL': {
        const mesh = evaluateAndMesh(req.tree, 256);
        if (!mesh) { self.postMessage({ type: 'error', message: 'No geometry to export' }); return; }
        const data = exportBinarySTL(mesh);
        self.postMessage({ type: 'exportResult', format: 'stl' as const, data }, [data]);
        break;
      }

      case 'export3MF': {
        const mesh = evaluateAndMesh(req.tree, 256);
        if (!mesh) { self.postMessage({ type: 'error', message: 'No geometry to export' }); return; }
        const data = export3MF(mesh);
        self.postMessage({ type: 'exportResult', format: '3mf' as const, data }, [data]);
        break;
      }
    }
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
