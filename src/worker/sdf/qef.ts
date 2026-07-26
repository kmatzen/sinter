/**
 * QEF (Quadratic Error Function) solver for dual contouring.
 *
 * Minimizes sum_i (n_i . (x - p_i))^2 using the truncated-pseudoinverse
 * approach from "Dual Contouring of Hermite Data" (Ju, Losasso, Schaefer,
 * Warren 2002): solve A^T A relative to the mass point via an eigen
 * decomposition, inverting only eigenvalues above a fraction of the largest.
 *
 * Near-singular directions (a flat plane has one strong eigenvalue, an edge
 * has two) fall back to the mass point instead of being dragged by noise,
 * while strong directions are solved exactly — so vertices land precisely on
 * sharp edges and corners without the position bias a Tikhonov regularizer
 * introduces.
 */

import type { Vec3 } from './types';

/** Relative eigenvalue cutoff below which a direction is treated as rank-deficient */
const SINGULAR_TOLERANCE = 0.1;
const JACOBI_SWEEPS = 12;

interface Eigen3 {
  /** Eigenvalues, unordered */
  values: Vec3;
  /** Matching eigenvectors as columns: vectors[i] pairs with values[i] */
  vectors: [Vec3, Vec3, Vec3];
}

/**
 * Eigen decomposition of a symmetric 3x3 matrix via cyclic Jacobi rotations.
 * Converges quadratically; a fixed sweep count is plenty at double precision.
 */
function eigenSymmetric3(
  a00: number, a01: number, a02: number,
  a11: number, a12: number, a22: number,
): Eigen3 {
  // Matrix being diagonalized (upper triangle tracked)
  let m00 = a00, m01 = a01, m02 = a02, m11 = a11, m12 = a12, m22 = a22;
  // Accumulated rotation V (starts as identity); columns become eigenvectors
  let v00 = 1, v01 = 0, v02 = 0;
  let v10 = 0, v11 = 1, v12 = 0;
  let v20 = 0, v21 = 0, v22v = 1;

  for (let sweep = 0; sweep < JACOBI_SWEEPS; sweep++) {
    const off = m01 * m01 + m02 * m02 + m12 * m12;
    if (off < 1e-30) break;

    // Rotate away each off-diagonal element in turn: (p,q) in {(0,1),(0,2),(1,2)}
    for (let pair = 0; pair < 3; pair++) {
      let apq: number, app: number, aqq: number;
      if (pair === 0) { apq = m01; app = m00; aqq = m11; }
      else if (pair === 1) { apq = m02; app = m00; aqq = m22; }
      else { apq = m12; app = m11; aqq = m22; }

      if (Math.abs(apq) < 1e-30) continue;

      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;

      if (pair === 0) {
        // Rotate rows/cols 0,1
        const n00 = app - t * apq, n11 = aqq + t * apq;
        const n02 = c * m02 - s * m12, n12 = s * m02 + c * m12;
        m00 = n00; m11 = n11; m01 = 0; m02 = n02; m12 = n12;
        let r0: number, r1: number;
        r0 = c * v00 - s * v01; r1 = s * v00 + c * v01; v00 = r0; v01 = r1;
        r0 = c * v10 - s * v11; r1 = s * v10 + c * v11; v10 = r0; v11 = r1;
        r0 = c * v20 - s * v21; r1 = s * v20 + c * v21; v20 = r0; v21 = r1;
      } else if (pair === 1) {
        // Rotate rows/cols 0,2
        const n00 = app - t * apq, n22 = aqq + t * apq;
        const n01 = c * m01 - s * m12, n12 = s * m01 + c * m12;
        m00 = n00; m22 = n22; m02 = 0; m01 = n01; m12 = n12;
        let r0: number, r2: number;
        r0 = c * v00 - s * v02; r2 = s * v00 + c * v02; v00 = r0; v02 = r2;
        r0 = c * v10 - s * v12; r2 = s * v10 + c * v12; v10 = r0; v12 = r2;
        r0 = c * v20 - s * v22v; r2 = s * v20 + c * v22v; v20 = r0; v22v = r2;
      } else {
        // Rotate rows/cols 1,2
        const n11 = app - t * apq, n22 = aqq + t * apq;
        const n01 = c * m01 - s * m02, n02 = s * m01 + c * m02;
        m11 = n11; m22 = n22; m12 = 0; m01 = n01; m02 = n02;
        let r1: number, r2: number;
        r1 = c * v01 - s * v02; r2 = s * v01 + c * v02; v01 = r1; v02 = r2;
        r1 = c * v11 - s * v12; r2 = s * v11 + c * v12; v11 = r1; v12 = r2;
        r1 = c * v21 - s * v22v; r2 = s * v21 + c * v22v; v21 = r1; v22v = r2;
      }
    }
  }

  return {
    values: [m00, m11, m22],
    vectors: [
      [v00, v10, v20],
      [v01, v11, v21],
      [v02, v12, v22v],
    ],
  };
}

/**
 * Solve the QEF for a set of Hermite samples (surface points + normals),
 * anchored at the mass point.
 *
 * Returns the position minimizing sum_i (n_i . (x - p_i))^2, where
 * rank-deficient directions of A^T A stay at the mass point.
 */
export function solveQEF(points: Vec3[], normals: Vec3[], massPoint: Vec3): Vec3 {
  let a00 = 0, a01 = 0, a02 = 0, a11 = 0, a12 = 0, a22 = 0;
  let b0 = 0, b1 = 0, b2 = 0;

  for (let i = 0; i < points.length; i++) {
    const [nx, ny, nz] = normals[i];
    const d = nx * points[i][0] + ny * points[i][1] + nz * points[i][2];
    a00 += nx * nx; a01 += nx * ny; a02 += nx * nz;
    a11 += ny * ny; a12 += ny * nz; a22 += nz * nz;
    b0 += nx * d; b1 += ny * d; b2 += nz * d;
  }

  // Shift to mass-point-relative coordinates: solve ATA * dx = ATb - ATA * mp
  const [mx, my, mz] = massPoint;
  const r0 = b0 - (a00 * mx + a01 * my + a02 * mz);
  const r1 = b1 - (a01 * mx + a11 * my + a12 * mz);
  const r2 = b2 - (a02 * mx + a12 * my + a22 * mz);

  const { values, vectors } = eigenSymmetric3(a00, a01, a02, a11, a12, a22);

  const maxEig = Math.max(Math.abs(values[0]), Math.abs(values[1]), Math.abs(values[2]));
  if (maxEig < 1e-12) return [mx, my, mz];

  let dx = 0, dy = 0, dz = 0;
  for (let i = 0; i < 3; i++) {
    const lambda = values[i];
    if (Math.abs(lambda) <= SINGULAR_TOLERANCE * maxEig) continue; // truncate
    const [ex, ey, ez] = vectors[i];
    const proj = (ex * r0 + ey * r1 + ez * r2) / lambda;
    dx += ex * proj; dy += ey * proj; dz += ez * proj;
  }

  return [mx + dx, my + dy, mz + dz];
}
