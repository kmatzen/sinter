interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function export3MF(mesh: MeshData): ArrayBuffer {
  const { positions, indices } = mesh;

  const uniqueVertices: string[] = [];
  for (let i = 0; i < positions.length; i += 3) {
    uniqueVertices.push(
      `        <vertex x="${positions[i]}" y="${positions[i + 1]}" z="${positions[i + 2]}" />`,
    );
  }

  const triangles: string[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    triangles.push(
      `        <triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}" />`,
    );
  }

  const modelXml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">
      <mesh>
        <vertices>
${uniqueVertices.join('\n')}
        </vertices>
        <triangles>
${triangles.join('\n')}
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  return createMinimalZip([
    { name: '[Content_Types].xml', data: new TextEncoder().encode(contentTypesXml) },
    { name: '_rels/.rels', data: new TextEncoder().encode(relsXml) },
    { name: '3D/3dmodel.model', data: new TextEncoder().encode(modelXml) },
  ]);
}

interface ZipEntry { name: string; data: Uint8Array; }

function createMinimalZip(entries: ZipEntry[]): ArrayBuffer {
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const localHeader = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(localHeader);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, 0, true);
    lv.setUint32(14, crc32(entry.data), true);
    lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    new Uint8Array(localHeader).set(nameBytes, 30);
    localHeaders.push(new Uint8Array(localHeader));

    const centralHeader = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(centralHeader);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc32(entry.data), true);
    cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, localOffset, true);
    new Uint8Array(centralHeader).set(nameBytes, 46);
    centralHeaders.push(new Uint8Array(centralHeader));

    localOffset += 30 + nameBytes.length + entry.data.length;
  }

  let centralDirSize = 0;
  for (const ch of centralHeaders) centralDirSize += ch.length;

  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, localOffset, true);

  const totalSize = localOffset + centralDirSize + 22;
  const result = new Uint8Array(totalSize);
  let pos = 0;
  for (let i = 0; i < entries.length; i++) {
    result.set(localHeaders[i], pos); pos += localHeaders[i].length;
    result.set(entries[i].data, pos); pos += entries[i].data.length;
  }
  for (const ch of centralHeaders) { result.set(ch, pos); pos += ch.length; }
  result.set(new Uint8Array(eocd), pos);
  return result.buffer;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
