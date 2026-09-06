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
  diagnostics: ExportDiagnostics;
  achievedTolerance?: number;
  componentCount?: number;
  conformance: ExportConformance;
}

export interface ExportConformance {
  status: 'verified' | 'failed' | 'inconclusive';
  tolerance: number;
  meshToSourceMax: number;
  meshToSourceRms: number;
  sourceToMeshMax: number;
  sourceToMeshRms: number;
  maxDeviation: number;
  rmsDeviation: number;
  meshSamples: number;
  sourceSamples: number;
}

export interface ExportDiagnostics {
  watertight: boolean;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  degenerateTriangles: number;
  invalidIndices: number;
  nonFiniteVertices: number;
  zeroAreaTriangles: number;
  dimensions: [number, number, number];
  overhang?: OverhangDiagnostics;
}

export type BuildDirection = 'x' | '-x' | 'y' | '-y' | 'z' | '-z';
export interface ExportPreflightOptions { overhangAngle: number; buildDirection: BuildDirection; }
export interface OverhangDiagnostics extends ExportPreflightOptions {
  riskyTriangles: number;
  analyzedTriangles: number;
  affectedTriangleIds: number[];
  affectedBounds: { min: [number, number, number]; max: [number, number, number] } | null;
  affectedIdsTruncated: boolean;
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
  | { type: 'exportSTL'; rid: number; tree: SDFNodeUI | null; resolution?: number; preflight?: ExportPreflightOptions }
  | { type: 'export3MF'; rid: number; tree: SDFNodeUI | null; resolution?: number; preflight?: ExportPreflightOptions }
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
  | { type: 'exportResult'; rid: number; format: 'stl' | '3mf'; data: ArrayBuffer; vertexCount: number; triangleCount: number; diagnostics: ExportDiagnostics; achievedTolerance?: number; componentCount?: number; conformance: ExportConformance }
  | { type: 'fitResult'; rid: number; fit: MeshFitResult | null }
  | { type: 'progress'; rid: number; stage: string; percent: number }
  | { type: 'error'; rid: number; message: string }
  | { type: 'ready' };
