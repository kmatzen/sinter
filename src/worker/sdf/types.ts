export type Vec3 = [number, number, number];

/** Values below this are identity/sharp at the engine's spatial precision. */
export const SDF_PARAM_EPSILON = 1e-9;

export type SDFNode =
  | { kind: 'box'; size: Vec3; warn?: boolean }
  | { kind: 'sphere'; radius: number; warn?: boolean }
  | { kind: 'cylinder'; radius: number; height: number; warn?: boolean }
  | { kind: 'torus'; major: number; minor: number; warn?: boolean }
  | { kind: 'cone'; radius: number; height: number; warn?: boolean }
  | { kind: 'capsule'; radius: number; height: number; warn?: boolean }
  | { kind: 'ellipsoid'; size: Vec3; warn?: boolean }
  | { kind: 'union'; a: SDFNode; b: SDFNode; k: number; warn?: boolean }
  | { kind: 'subtract'; a: SDFNode; b: SDFNode; k: number; warn?: boolean }
  | { kind: 'intersect'; a: SDFNode; b: SDFNode; k: number; warn?: boolean }
  | { kind: 'shell'; child: SDFNode; thickness: number; warn?: boolean }
  | { kind: 'offset'; child: SDFNode; distance: number; warn?: boolean }
  | { kind: 'round'; child: SDFNode; radius: number; warn?: boolean }
  | { kind: 'transform'; child: SDFNode; tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number; warn?: boolean }
  | { kind: 'mirror'; child: SDFNode; axes: Vec3; warn?: boolean }  // axes: [1,0,0] = mirror X, [0,1,0] = Y, etc. Can combine.
  | { kind: 'linearPattern'; child: SDFNode; axis: Vec3; count: number; spacing: number; warn?: boolean }
  | { kind: 'circularPattern'; child: SDFNode; axis: Vec3; count: number; warn?: boolean }
  | { kind: 'halfSpace'; axis: 'x' | 'y' | 'z'; position: number; flip: boolean; warn?: boolean }
  | { kind: 'text'; text: string; size: number; depth: number; font: string; warn?: boolean;
      glyphSegments?: { type: 'L'; x0: number; y0: number; x1: number; y1: number }[];
      glyphBeziers?: { type: 'Q'; x0: number; y0: number; x1: number; y1: number; x2: number; y2: number }[];
      glyphWidth?: number; glyphAscent?: number; glyphDescent?: number }
  /**
   * An imported mesh, carried as a baked signed-distance grid rather than as
   * triangles (#87). The grid is the single representation both evaluators
   * sample, which is what stops this becoming another node kind that means one
   * solid on the CPU and a different one on the GPU — see #85. `meshField.ts`
   * explains the trade-off the bake makes.
   */
  | { kind: 'mesh'; field: MeshFieldData; name?: string; warn?: boolean }
  | { kind: '_far'; warn?: boolean };

/** A signed-distance grid baked from a triangle mesh. See `meshField.ts`. */
export interface MeshFieldData {
  bbox: BBox;
  /** Samples per axis; the grid holds `res^3` values in x-fastest order. */
  res: number;
  data: Float32Array;
}

export interface BBox {
  min: Vec3;
  max: Vec3;
}

/**
 * Does this text node carry real outlines, or is it a box?
 *
 * The one predicate all three implementations key off — `evaluate.ts`,
 * `codegen.ts` and `bounds.ts` — because they have to agree about it or the
 * viewport, the export and the bounding box describe different solids. The
 * empty-array case is the reason it is a function: `[]` is truthy, so a
 * presence check sends the CPU down the outline path with nothing to walk
 * (min distance stays at Infinity) while the shader draws a box.
 */
export function hasGlyphOutlines(node: Extract<SDFNode, { kind: 'text' }>): boolean {
  return (node.glyphSegments?.length ?? 0) + (node.glyphBeziers?.length ?? 0) > 0;
}
