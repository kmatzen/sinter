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

// Every request carries a correlation id `rid`, echoed back on every response
// it produces. The bridge routes responses by rid alone — never by message
// type — so concurrent requests cannot displace or settle each other. See
// specs/WorkerBridgeFixed.tla.
export type WorkerRequest =
  | { type: 'evaluate'; rid: number; tree: SDFNodeUI | null; resolution?: number; clip?: ClipPlane }
  // `resolution` is the export grid's samples per axis. Optional so an older
  // persisted request, or a caller that does not care, still means "the
  // default" rather than "zero".
  | { type: 'exportSTL'; rid: number; tree: SDFNodeUI | null; resolution?: number }
  | { type: 'export3MF'; rid: number; tree: SDFNodeUI | null; resolution?: number };

export type WorkerResponse =
  | { type: 'mesh'; rid: number; positions: ArrayBuffer; normals: ArrayBuffer; indices: ArrayBuffer; thickness?: ArrayBuffer }
  | { type: 'sdf'; rid: number; glsl: string; paramCount: number; paramValues: number[]; textures?: { name: string; width: number; height: number; data: number[] }[]; bbMin: [number, number, number]; bbMax: [number, number, number]; hasWarn?: boolean }
  | { type: 'exportResult'; rid: number; format: 'stl' | '3mf'; data: ArrayBuffer }
  | { type: 'progress'; rid: number; stage: string; percent: number }
  | { type: 'error'; rid: number; message: string }
  | { type: 'ready' };
