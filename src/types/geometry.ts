import type { SDFNodeUI } from './operations';

export interface TriangulatedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  thickness?: Float32Array;
}

export interface ClipPlane {
  axis: 'x' | 'y' | 'z';
  position: number;
}

export type WorkerRequest =
  | { type: 'evaluate'; tree: SDFNodeUI | null; resolution?: number; clip?: ClipPlane }
  | { type: 'exportSTL'; tree: SDFNodeUI | null }
  | { type: 'export3MF'; tree: SDFNodeUI | null };

export type WorkerResponse =
  | { type: 'mesh'; positions: ArrayBuffer; normals: ArrayBuffer; indices: ArrayBuffer; thickness?: ArrayBuffer }
  | { type: 'sdf'; glsl: string; paramCount: number; paramValues: number[]; textures?: { name: string; width: number; height: number; data: number[] }[]; bbMin: [number, number, number]; bbMax: [number, number, number] }
  | { type: 'exportResult'; format: 'stl' | '3mf'; data: ArrayBuffer }
  | { type: 'error'; message: string }
  | { type: 'ready' };
