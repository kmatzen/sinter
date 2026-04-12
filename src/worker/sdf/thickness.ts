import type { BBox } from './types';

// For each mesh vertex, estimate local wall thickness by marching inward
// along the negative normal through the SDF grid until the sign flips back to positive.
export function computeThickness(
  positions: Float32Array,
  normals: Float32Array,
  grid: Float32Array,
  resolution: number,
  bbox: BBox,
): Float32Array {
  const numVerts = positions.length / 3;
  const thickness = new Float32Array(numVerts);
  const dx = (bbox.max[0] - bbox.min[0]) / resolution;
  const dy = (bbox.max[1] - bbox.min[1]) / resolution;
  const dz = (bbox.max[2] - bbox.min[2]) / resolution;
  const step = Math.min(dx, dy, dz);
  const maxDist = Math.max(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  );

  for (let v = 0; v < numVerts; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    // Inward normal (negative of outward normal)
    const nx = -normals[v * 3];
    const ny = -normals[v * 3 + 1];
    const nz = -normals[v * 3 + 2];

    // March inward until SDF becomes positive (we've exited the object on the other side)
    let dist = step;
    let found = false;
    while (dist < maxDist) {
      const sx = px + nx * dist;
      const sy = py + ny * dist;
      const sz = pz + nz * dist;

      // Sample SDF from grid via trilinear interpolation
      const sdfVal = sampleGrid(grid, resolution, bbox, sx, sy, sz);
      if (sdfVal > 0) {
        // We've exited — thickness is the distance traveled
        thickness[v] = dist;
        found = true;
        break;
      }
      dist += step;
    }

    if (!found) {
      thickness[v] = maxDist; // Solid through-and-through (or very thick)
    }
  }

  return thickness;
}

function sampleGrid(grid: Float32Array, res: number, bbox: BBox, x: number, y: number, z: number): number {
  // Convert world coords to grid coords
  const gx = ((x - bbox.min[0]) / (bbox.max[0] - bbox.min[0])) * res - 0.5;
  const gy = ((y - bbox.min[1]) / (bbox.max[1] - bbox.min[1])) * res - 0.5;
  const gz = ((z - bbox.min[2]) / (bbox.max[2] - bbox.min[2])) * res - 0.5;

  // Clamp to grid bounds
  const ix = Math.max(0, Math.min(res - 1, Math.floor(gx)));
  const iy = Math.max(0, Math.min(res - 1, Math.floor(gy)));
  const iz = Math.max(0, Math.min(res - 1, Math.floor(gz)));

  return grid[iz * res * res + iy * res + ix];
}
