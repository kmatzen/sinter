import type { SDFNode, MeshFieldData, Vec3 } from './types';
import { evaluateSDF } from './evaluate';
import { sampleMeshField } from './meshField';

/**
 * Fitting a primitive to an imported mesh (#87, layer 2 — the tractable part).
 *
 * ## What this does and does not do
 *
 * The issue sketches a full pipeline: segment into regions, RANSAC-fit a
 * primitive per region, recover the CSG structure, refine against the field,
 * and detect repetition so a pattern node is emitted instead of N copies. That
 * is a research project, and the issue says so.
 *
 * This is the part underneath it, which the full pipeline would need anyway and
 * which is useful on its own: fit **one** primitive to the whole mesh, measure
 * how wrong it is in millimetres, and only offer to replace the mesh when the
 * answer is good. A large share of what people import — a spacer, a washer, a
 * bar, a ball — *is* one primitive, and turning those into editable parameters
 * is the entire point of importing into a parametric modeller rather than a
 * mesh editor.
 *
 * Segmentation, CSG recovery and repetition detection are not here.
 *
 * Orientation *is* here, for the shapes that have one. A cylinder at 30 degrees
 * is not exotic — most things people export are not axis-aligned — and getting
 * it takes a principal-axis estimate rather than a search, so it is ordinary
 * work rather than part of the research above.
 *
 * ## The issue's two open questions, answered
 *
 * **"Does the fit target the SDF or the surface?"** Both, for different jobs.
 * The optimiser minimises squared field difference over a volume of samples,
 * because that is smooth and gives a gradient everywhere — a pure surface
 * objective is flat wherever the candidate does not touch the mesh, and the
 * search stalls. But the number *reported to the user* is surface deviation in
 * millimetres, measured on the mesh's own zero level set, because "your fit is
 * 0.3mm off" is a statement someone can act on and "field RMS 0.02" is not.
 * The issue's worry — that a field fit tolerates interior error a user would
 * see on a cross-section — is answered by reporting the surface number.
 *
 * **"What is the fallback when fitting fails?"** The mesh node stays exactly
 * as it is. This never mutates anything; it returns a candidate and a residual,
 * and the caller decides. A bad fit produces a large residual and an
 * `acceptable: false`, not a bad tree.
 */

export interface FitResult {
  node: SDFNode;
  /** Human-readable primitive name, for the UI. */
  kind: string;
  /** RMS distance from the mesh's surface to the candidate's, in mm. */
  surfaceRms: number;
  /** Worst such distance, in mm. */
  surfaceMax: number;
  /** `surfaceMax` as a fraction of the mesh's bounding-box diagonal. */
  relativeError: number;
  /** Whether the fit is good enough to offer as a replacement. */
  acceptable: boolean;
}

/**
 * Relative error below which a fit is offered.
 *
 * 1% of the diagonal: on a 50mm part that is half a millimetre, around the
 * point where a printed result stops matching the original. Deliberately
 * strict — offering a bad fit is worse than offering none, because the user
 * loses the original geometry to get it.
 */
const ACCEPT_RELATIVE = 0.01;

/**
 * How much better a more complex candidate must be to displace a simpler one.
 * 2%: enough that a genuine improvement wins and a numerical tie does not.
 */
const TIE_MARGIN = 0.98;

/** Samples per axis for the volume objective the optimiser minimises. */
const VOLUME_STEPS = 12;
/** Target number of surface points for the reported residual. */
const SURFACE_TARGET = 500;

/**
 * Points on the mesh's zero level set.
 *
 * Found by walking a coarse grid and, wherever the field changes sign along an
 * axis, bisecting to the crossing. Not a mesh — a point cloud is all the
 * residual needs, and it avoids depending on the mesher here.
 */
function surfacePoints(field: MeshFieldData): Vec3[] {
  const { bbox } = field;
  const pts: Vec3[] = [];
  const N = 24;
  const at = (i: number, j: number, k: number): Vec3 => [
    bbox.min[0] + ((bbox.max[0] - bbox.min[0]) * i) / N,
    bbox.min[1] + ((bbox.max[1] - bbox.min[1]) * j) / N,
    bbox.min[2] + ((bbox.max[2] - bbox.min[2]) * k) / N,
  ];
  const f = (p: Vec3) => sampleMeshField(field, p[0], p[1], p[2]);

  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      for (let k = 0; k <= N; k++) {
        const p = at(i, j, k);
        const v = f(p);
        for (const [di, dj, dk] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as const) {
          if (i + di > N || j + dj > N || k + dk > N) continue;
          const q = at(i + di, j + dj, k + dk);
          const w = f(q);
          if ((v < 0) === (w < 0)) continue;
          // Bisect to the crossing. Ten steps puts it well under a grid cell.
          let lo = p, hi = q, vlo = v;
          for (let s = 0; s < 10; s++) {
            const mid: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
            const vm = f(mid);
            if ((vm < 0) === (vlo < 0)) { lo = mid; vlo = vm; } else { hi = mid; }
          }
          pts.push([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]);
        }
      }
    }
  }

  // Thin deterministically rather than randomly, so a fit is reproducible.
  if (pts.length <= SURFACE_TARGET) return pts;
  const stride = Math.ceil(pts.length / SURFACE_TARGET);
  return pts.filter((_, i) => i % stride === 0);
}

/** Squared field difference over a volume of samples — the optimiser's objective. */
function volumeCost(field: MeshFieldData, node: SDFNode): number {
  const { bbox } = field;
  let sum = 0;
  let n = 0;
  for (let i = 0; i <= VOLUME_STEPS; i++) {
    const x = bbox.min[0] + ((bbox.max[0] - bbox.min[0]) * i) / VOLUME_STEPS;
    for (let j = 0; j <= VOLUME_STEPS; j++) {
      const y = bbox.min[1] + ((bbox.max[1] - bbox.min[1]) * j) / VOLUME_STEPS;
      for (let k = 0; k <= VOLUME_STEPS; k++) {
        const z = bbox.min[2] + ((bbox.max[2] - bbox.min[2]) * k) / VOLUME_STEPS;
        const d = evaluateSDF(node, [x, y, z]) - sampleMeshField(field, x, y, z);
        sum += d * d;
        n++;
      }
    }
  }
  return sum / n;
}

/** Surface residual, in millimetres, of `node` against the mesh's own surface. */
function surfaceResidual(node: SDFNode, pts: Vec3[]): { rms: number; max: number } {
  if (pts.length === 0) return { rms: Infinity, max: Infinity };
  let sum = 0;
  let max = 0;
  for (const p of pts) {
    const d = Math.abs(evaluateSDF(node, p));
    sum += d * d;
    if (d > max) max = d;
  }
  return { rms: Math.sqrt(sum / pts.length), max };
}

/**
 * Symmetric 3x3 eigendecomposition by cyclic Jacobi rotation.
 *
 * Returns the eigenvectors as columns, unordered. Jacobi rather than a closed
 * form because it is unconditionally stable for symmetric matrices — a
 * covariance of a point cloud can be near-degenerate (a sphere's is a multiple
 * of the identity) and a closed form takes square roots of quantities that go
 * slightly negative there.
 */
function eigenvectors(m: number[][]): Vec3[] {
  const a = m.map((r) => [...r]);
  let v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 24; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += a[p][q] * a[p][q];
    if (off < 1e-18) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-20) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s2 = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s2 * akq;
          a[k][q] = s2 * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s2 * aqk;
          a[q][k] = s2 * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s2 * vkq;
          v[k][q] = s2 * vkp + c * vkq;
        }
      }
    }
  }
  return [0, 1, 2].map((j) => {
    const e: Vec3 = [v[0][j], v[1][j], v[2][j]];
    const l = Math.hypot(e[0], e[1], e[2]) || 1;
    return [e[0] / l, e[1] / l, e[2] / l] as Vec3;
  });
}

/**
 * Euler angles, in the transform node's own X-then-Y-then-Z order, that carry
 * +Y onto `d`.
 *
 * Applying rx then ry to (0,1,0) gives (sin(rx)sin(ry), cos(rx), sin(rx)cos(ry)),
 * so rz is free and left at zero — one fewer parameter for the optimiser to
 * wander in, and any spin about the axis is a no-op for the shapes this is used
 * for.
 */
function eulerForAxis(d: Vec3): { rx: number; ry: number } {
  const deg = 180 / Math.PI;
  const y = Math.max(-1, Math.min(1, d[1]));
  const rx = Math.acos(y);
  if (Math.sin(rx) < 1e-9) return { rx: rx * deg, ry: 0 };
  return { rx: rx * deg, ry: Math.atan2(d[0], d[2]) * deg };
}

/** Wrap a primitive in a translate, since the primitives are all origin-centred. */
function placed(child: SDFNode, t: Vec3): SDFNode {
  if (t[0] === 0 && t[1] === 0 && t[2] === 0) return child;
  return { kind: 'transform', child, tx: t[0], ty: t[1], tz: t[2], rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 };
}

interface Candidate {
  kind: string;
  /** Free parameters, in whatever order `build` expects. */
  params: number[];
  build: (p: number[]) => SDFNode;
  /**
   * True when the refined parameters have collapsed this into a shape another
   * candidate already covers.
   *
   * A capsule whose height falls to twice its radius *is* a sphere, and it has
   * one more free parameter to absorb the bake's asymmetry with — so it beats
   * the sphere on residual and an imported ball comes back as
   * "Capsule (fitted axis)". Ordering and a tie margin are not enough, because
   * the win is real; the answer has to be thrown out for being a worse
   * description of the same shape.
   */
  degenerate?: (p: number[]) => boolean;
}

/**
 * Starting guesses, one per primitive shape.
 *
 * Analytic rather than random: the mesh's own extent already says what a box
 * would be, and where a sphere's centre and radius would be. Coordinate
 * descent then only has to polish, which is what keeps this fast enough to run
 * on import rather than as a background job.
 */
function candidates(solidBounds: { min: Vec3; max: Vec3; centre: Vec3 }, pts: Vec3[]): Candidate[] {
  const { min, max, centre } = solidBounds;
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  // Simplest first. A capsule whose height falls to twice its radius *is* a
  // sphere, and a cylinder can imitate a box badly enough to tie on a coarse
  // field — so ties must resolve to the shape with fewer parameters, or an
  // imported ball comes back as "Capsule (X)" and the user is handed two
  // knobs where one would do.
  const out: Candidate[] = [
    {
      kind: 'Sphere',
      params: [centre[0], centre[1], centre[2], Math.max(size[0], size[1], size[2]) / 2],
      build: (p) => placed({ kind: 'sphere', radius: Math.abs(p[3]) }, [p[0], p[1], p[2]]),
    },
    {
      kind: 'Box',
      params: [centre[0], centre[1], centre[2], size[0], size[1], size[2]],
      build: (p) => placed({ kind: 'box', size: [Math.abs(p[3]), Math.abs(p[4]), Math.abs(p[5])] }, [p[0], p[1], p[2]]),
    },
  ];

  // A cylinder and a capsule per axis. The primitives are Y-axis, so the other
  // two axes come from a quarter-turn rather than from a separate node kind.
  const axes: { name: string; rx: number; rz: number; h: number; r: number }[] = [
    { name: 'Y', rx: 0, rz: 0, h: size[1], r: Math.max(size[0], size[2]) / 2 },
    { name: 'X', rx: 0, rz: 90, h: size[0], r: Math.max(size[1], size[2]) / 2 },
    { name: 'Z', rx: 90, rz: 0, h: size[2], r: Math.max(size[0], size[1]) / 2 },
  ];
  for (const a of axes) {
    const spin = (child: SDFNode, p: number[]): SDFNode => ({
      kind: 'transform', child,
      tx: p[0], ty: p[1], tz: p[2],
      rx: a.rx, ry: 0, rz: a.rz, sx: 1, sy: 1, sz: 1,
    });
    out.push({
      kind: `Cylinder (${a.name})`,
      params: [centre[0], centre[1], centre[2], a.r, a.h],
      build: (p) => spin({ kind: 'cylinder', radius: Math.abs(p[3]), height: Math.abs(p[4]) }, p),
    });
    out.push({
      kind: `Capsule (${a.name})`,
      params: [centre[0], centre[1], centre[2], a.r, a.h],
      build: (p) => spin({ kind: 'capsule', radius: Math.abs(p[3]), height: Math.abs(p[4]) }, p),
      degenerate: (p) => Math.abs(p[4]) <= Math.abs(p[3]) * 2.1,
    });
  }
  // Oriented candidates, from the principal axes of the surface point cloud.
  //
  // Three axes rather than one, because which eigenvector is the cylinder's
  // depends on its proportions: a long rod's axis is the direction of greatest
  // spread, a flat disc's is the least. Trying all three costs three more
  // refinements and removes the need to guess.
  for (const axis of principalAxes(pts, centre)) {
    // Already covered by the axis-aligned candidates above, and a duplicate
    // just spends a refinement to arrive at the same answer.
    if (Math.max(Math.abs(axis[0]), Math.abs(axis[1]), Math.abs(axis[2])) > 0.999) continue;
    const { rx, ry } = eulerForAxis(axis);
    const ext = extentAlong(pts, centre, axis);
    const oriented = (kind: 'cylinder' | 'capsule') => (p: number[]): SDFNode => ({
      kind: 'transform',
      child: kind === 'cylinder'
        ? { kind: 'cylinder', radius: Math.abs(p[3]), height: Math.abs(p[4]) }
        : { kind: 'capsule', radius: Math.abs(p[3]), height: Math.abs(p[4]) },
      tx: p[0], ty: p[1], tz: p[2], rx, ry: ry, rz: 0, sx: 1, sy: 1, sz: 1,
    });
    const seed = [centre[0], centre[1], centre[2], ext.radius, ext.height];
    out.push({ kind: 'Cylinder (fitted axis)', params: seed, build: oriented('cylinder') });
    out.push({
      kind: 'Capsule (fitted axis)', params: [...seed], build: oriented('capsule'),
      degenerate: (p) => Math.abs(p[4]) <= Math.abs(p[3]) * 2.1,
    });
  }

  return out;
}

/** Principal axes of the surface point cloud, as unit vectors. */
function principalAxes(pts: Vec3[], centre: Vec3): Vec3[] {
  if (pts.length < 8) return [];
  const c = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] += d[i] * d[j];
  }
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) c[i][j] /= pts.length;
  return eigenvectors(c);
}

/** Height along an axis and radius about it, for a starting guess. */
function extentAlong(pts: Vec3[], centre: Vec3, axis: Vec3): { radius: number; height: number } {
  let lo = Infinity, hi = -Infinity, r = 0;
  for (const p of pts) {
    const d: Vec3 = [p[0] - centre[0], p[1] - centre[1], p[2] - centre[2]];
    const t = d[0] * axis[0] + d[1] * axis[1] + d[2] * axis[2];
    if (t < lo) lo = t;
    if (t > hi) hi = t;
    const rad = Math.hypot(d[0] - axis[0] * t, d[1] - axis[1] * t, d[2] - axis[2] * t);
    if (rad > r) r = rad;
  }
  return { radius: r, height: hi - lo };
}

/**
 * Coordinate descent with a shrinking step.
 *
 * Not gradient descent: the objective is a sampled sum over a field that is
 * itself an interpolated grid, so a numerical gradient is noisy and costs as
 * much as just trying the step. Coordinate descent needs no derivative, cannot
 * diverge, and the parameter count is six at most.
 */
function refine(field: MeshFieldData, c: Candidate, scale: number): number[] {
  let params = [...c.params];
  let best = volumeCost(field, c.build(params));
  let step = scale * 0.08;
  for (let pass = 0; pass < 24 && step > scale * 1e-4; pass++) {
    let improved = false;
    for (let i = 0; i < params.length; i++) {
      for (const dir of [1, -1]) {
        const trial = [...params];
        trial[i] += dir * step;
        const cost = volumeCost(field, c.build(trial));
        if (cost < best) { best = cost; params = trial; improved = true; break; }
      }
    }
    if (!improved) step *= 0.5;
  }
  return params;
}

/** Bounds of the actual solid, which is tighter than the padded field box. */
function solidExtent(field: MeshFieldData): { min: Vec3; max: Vec3; centre: Vec3 } | null {
  const { bbox } = field;
  const N = 24;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i <= N; i++) {
    const x = bbox.min[0] + ((bbox.max[0] - bbox.min[0]) * i) / N;
    for (let j = 0; j <= N; j++) {
      const y = bbox.min[1] + ((bbox.max[1] - bbox.min[1]) * j) / N;
      for (let k = 0; k <= N; k++) {
        const z = bbox.min[2] + ((bbox.max[2] - bbox.min[2]) * k) / N;
        if (sampleMeshField(field, x, y, z) > 0) continue;
        if (x < min[0]) min[0] = x; if (x > max[0]) max[0] = x;
        if (y < min[1]) min[1] = y; if (y > max[1]) max[1] = y;
        if (z < min[2]) min[2] = z; if (z > max[2]) max[2] = z;
      }
    }
  }
  if (!Number.isFinite(min[0])) return null;
  return { min, max, centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
}

/**
 * Fit the best single primitive to a baked mesh field.
 *
 * Returns null only when the mesh has no solid in it at all. Otherwise it
 * always returns its best answer *with the residual*, even a bad one — the
 * caller shows the number and decides. Reporting "this does not fit, and here
 * is by how much" is more useful than reporting nothing.
 */
export function fitPrimitive(field: MeshFieldData): FitResult | null {
  const extent = solidExtent(field);
  if (extent === null) return null;

  const diag = Math.hypot(
    extent.max[0] - extent.min[0],
    extent.max[1] - extent.min[1],
    extent.max[2] - extent.min[2],
  );
  if (!(diag > 0)) return null;

  const pts = surfacePoints(field);
  let best: FitResult | null = null;

  for (const c of candidates(extent, pts)) {
    const params = refine(field, c, diag);
    if (c.degenerate?.(params)) continue;
    const node = c.build(params);
    const { rms, max } = surfaceResidual(node, pts);
    const relativeError = max / diag;
    const result: FitResult = {
      node, kind: c.kind,
      surfaceRms: rms, surfaceMax: max, relativeError,
      acceptable: relativeError <= ACCEPT_RELATIVE,
    };
    // Ranked on the surface residual, which is the number the user is shown —
    // ranking on the volume cost the optimiser used could pick a candidate that
    // scores well in the interior and visibly misses the surface.
    //
    // A later candidate has to be meaningfully better, not merely better, so
    // that the simplest-first ordering above actually decides ties.
    if (best === null || result.surfaceRms < best.surfaceRms * TIE_MARGIN) best = result;
  }

  return best;
}
