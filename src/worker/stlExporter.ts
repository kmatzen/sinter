interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function exportBinarySTL(mesh: MeshData): ArrayBuffer {
  const { positions, normals, indices } = mesh;
  const numTriangles = indices.length / 3;
  const bufferSize = 80 + 4 + numTriangles * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  const headerText = 'Exported from Modeler';
  for (let i = 0; i < headerText.length; i++) {
    view.setUint8(i, headerText.charCodeAt(i));
  }

  view.setUint32(80, numTriangles, true);

  let offset = 84;
  for (let t = 0; t < numTriangles; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    const nx = (normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3]) / 3;
    const ny = (normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1]) / 3;
    const nz = (normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2]) / 3;

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
