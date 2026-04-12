export type Vec3 = [number, number, number];

export type SDFNode =
  | { kind: 'box'; size: Vec3 }
  | { kind: 'sphere'; radius: number }
  | { kind: 'cylinder'; radius: number; height: number }
  | { kind: 'torus'; major: number; minor: number }
  | { kind: 'union'; a: SDFNode; b: SDFNode; k: number }
  | { kind: 'subtract'; a: SDFNode; b: SDFNode; k: number }
  | { kind: 'intersect'; a: SDFNode; b: SDFNode; k: number }
  | { kind: 'shell'; child: SDFNode; thickness: number }
  | { kind: 'offset'; child: SDFNode; distance: number }
  | { kind: 'round'; child: SDFNode; radius: number }
  | { kind: 'transform'; child: SDFNode; tx: number; ty: number; tz: number; rx: number; ry: number; rz: number; sx: number; sy: number; sz: number }
  | { kind: 'mirror'; child: SDFNode; axes: Vec3 }  // axes: [1,0,0] = mirror X, [0,1,0] = Y, etc. Can combine.
  | { kind: 'linearPattern'; child: SDFNode; axis: Vec3; count: number; spacing: number }
  | { kind: 'circularPattern'; child: SDFNode; axis: Vec3; count: number }
  | { kind: 'halfSpace'; axis: 'x' | 'y' | 'z'; position: number };

export interface BBox {
  min: Vec3;
  max: Vec3;
}
