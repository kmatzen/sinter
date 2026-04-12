import type { BBox } from './types';
import { EDGE_TABLE, TRI_TABLE } from './tables';

export interface MeshResult {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  thickness?: Float32Array;
}

export function marchingCubes(
  grid: Float32Array,
  resolution: number,
  bbox: BBox,
): MeshResult {
  const res = resolution;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // Grid spacing
  const dx = (bbox.max[0] - bbox.min[0]) / res;
  const dy = (bbox.max[1] - bbox.min[1]) / res;
  const dz = (bbox.max[2] - bbox.min[2]) / res;

  // Edge vertex cache: key = edge index, value = vertex index
  const edgeVertexCache = new Map<number, number>();

  function gridVal(x: number, y: number, z: number): number {
    if (x < 0 || x >= res || y < 0 || y >= res || z < 0 || z >= res) return 1;
    return grid[z * res * res + y * res + x];
  }

  function gridPos(x: number, y: number, z: number): [number, number, number] {
    return [
      bbox.min[0] + (x + 0.5) * dx,
      bbox.min[1] + (y + 0.5) * dy,
      bbox.min[2] + (z + 0.5) * dz,
    ];
  }

  function computeNormal(x: number, y: number, z: number): [number, number, number] {
    const nx = gridVal(x + 1, y, z) - gridVal(x - 1, y, z);
    const ny = gridVal(x, y + 1, z) - gridVal(x, y - 1, z);
    const nz = gridVal(x, y, z + 1) - gridVal(x, y, z - 1);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    return [-nx / len, -ny / len, -nz / len];
  }

  function interpolateEdge(
    x1: number, y1: number, z1: number, v1: number,
    x2: number, y2: number, z2: number, v2: number,
  ): number {
    // Create unique edge key
    const k1 = x1 + y1 * res + z1 * res * res;
    const k2 = x2 + y2 * res + z2 * res * res;
    const edgeKey = Math.min(k1, k2) * res * res * res + Math.max(k1, k2);

    const cached = edgeVertexCache.get(edgeKey);
    if (cached !== undefined) return cached;

    // Interpolate position
    const t = Math.abs(v1) < 1e-10 ? 0 : Math.abs(v2) < 1e-10 ? 1 : Math.abs(v1) / (Math.abs(v1) + Math.abs(v2));
    const p1 = gridPos(x1, y1, z1);
    const p2 = gridPos(x2, y2, z2);
    const px = p1[0] + t * (p2[0] - p1[0]);
    const py = p1[1] + t * (p2[1] - p1[1]);
    const pz = p1[2] + t * (p2[2] - p1[2]);

    // Interpolate normal
    const n1 = computeNormal(x1, y1, z1);
    const n2 = computeNormal(x2, y2, z2);
    const nx = n1[0] + t * (n2[0] - n1[0]);
    const ny = n1[1] + t * (n2[1] - n1[1]);
    const nz = n1[2] + t * (n2[2] - n1[2]);
    const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

    const vertexIndex = positions.length / 3;
    positions.push(px, py, pz);
    normals.push(nx / nlen, ny / nlen, nz / nlen);

    edgeVertexCache.set(edgeKey, vertexIndex);
    return vertexIndex;
  }

  // Edge-to-corner mapping for marching cubes
  const edgeCorners: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  // Corner offsets (x, y, z)
  const cornerOffsets: [number, number, number][] = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];

  for (let z = 0; z < res - 1; z++) {
    for (let y = 0; y < res - 1; y++) {
      for (let x = 0; x < res - 1; x++) {
        // Get corner values
        const vals: number[] = [];
        for (let c = 0; c < 8; c++) {
          vals.push(gridVal(
            x + cornerOffsets[c][0],
            y + cornerOffsets[c][1],
            z + cornerOffsets[c][2],
          ));
        }

        // Compute cube index
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          if (vals[c] < 0) cubeIndex |= (1 << c);
        }

        if (cubeIndex === 0 || cubeIndex === 255) continue;

        // Get edge flags
        const edges = EDGE_TABLE[cubeIndex];
        if (edges === 0) continue;

        // Compute vertex for each active edge
        const edgeVertices: number[] = new Array(12).fill(-1);
        for (let e = 0; e < 12; e++) {
          if (edges & (1 << e)) {
            const [c1, c2] = edgeCorners[e];
            edgeVertices[e] = interpolateEdge(
              x + cornerOffsets[c1][0], y + cornerOffsets[c1][1], z + cornerOffsets[c1][2], vals[c1],
              x + cornerOffsets[c2][0], y + cornerOffsets[c2][1], z + cornerOffsets[c2][2], vals[c2],
            );
          }
        }

        // Generate triangles
        const triRow = TRI_TABLE[cubeIndex];
        for (let t = 0; t < triRow.length; t += 3) {
          indices.push(
            edgeVertices[triRow[t]],
            edgeVertices[triRow[t + 1]],
            edgeVertices[triRow[t + 2]],
          );
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
  };
}
