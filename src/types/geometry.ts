import type { SDFNodeUI } from './operations';

export interface TriangulatedMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  thickness?: Float32Array;
}

export interface ExportArtifact {
  blob: Blob;
  vertexCount: number;
  triangleCount: number;
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
  | { type: 'export3MF'; rid: number; tree: SDFNodeUI | null; resolution?: number }
  // Fit a primitive to an imported mesh (#87). Carries the mesh rather than a
  // node id, because the worker holds no document — the store does.
  | { type: 'fitMesh'; rid: number; meshPositions: string; resolution?: number };

/** What a primitive fit tells the user. See `fitPrimitive.ts`. */
export interface MeshFitResult {
  /** Human-readable primitive name, e.g. "Cylinder (Y)". */
  kind: string;
  /** Worst distance from the mesh's surface to the fitted primitive's, in mm. */
  surfaceMax: number;
  /** RMS of the same, in mm. */
  surfaceRms: number;
  /** `surfaceMax` as a fraction of the part's diagonal. */
  relativeError: number;
  /** Whether the fit is close enough to offer as a replacement. */
  acceptable: boolean;
  /** The tree to swap in, if the user accepts it. */
  node: SDFNodeUI;
}

export type WorkerResponse =
  | { type: 'mesh'; rid: number; positions: ArrayBuffer; normals: ArrayBuffer; indices: ArrayBuffer; thickness?: ArrayBuffer }
  | { type: 'sdf'; rid: number; glsl: string; paramCount: number; paramValues: number[]; textures?: { name: string; width: number; height: number; data: number[] }[]; bbMin: [number, number, number]; bbMax: [number, number, number]; hasWarn?: boolean }
  | { type: 'exportResult'; rid: number; format: 'stl' | '3mf'; data: ArrayBuffer; vertexCount: number; triangleCount: number }
  | { type: 'fitResult'; rid: number; fit: MeshFitResult | null }
  | { type: 'progress'; rid: number; stage: string; percent: number }
  | { type: 'error'; rid: number; message: string }
  | { type: 'ready' };
