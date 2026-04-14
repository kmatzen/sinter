interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function exportBinarySTL(mesh: MeshData): ArrayBuffer {
  const { positions, indices } = mesh;
  const numTriangles = indices.length / 3;
  const bufferSize = 80 + 4 + numTriangles * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  const headerText = 'Exported from Sinter';
  for (let i = 0; i < headerText.length; i++) {
    view.setUint8(i, headerText.charCodeAt(i));
  }

  view.setUint32(80, numTriangles, true);

  let offset = 84;
  for (let t = 0; t < numTriangles; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    // Face normal from cross product (correct for slicers)
    const ax = positions[i0 * 3], ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
    const bx = positions[i1 * 3], by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
    const cx = positions[i2 * 3], cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len; ny /= len; nz /= len;

    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    for (const idx of [i0, i1, i2]) {
      view.setFloat32(offset, positions[idx * 3], true); offset += 4;
      view.setFloat32(offset, positions[idx * 3 + 1], true); offset += 4;
      view.setFloat32(offset, positions[idx * 3 + 2], true); offset += 4;
    }

    view.setUint16(offset, 0, true); offset += 2;
  }

  return buffer;
}
