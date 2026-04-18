export type Vec3 = [number, number, number];

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
  | { kind: '_far'; warn?: boolean };

export interface BBox {
  min: Vec3;
  max: Vec3;
}
