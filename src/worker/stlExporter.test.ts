import { describe, it, expect } from 'vitest';
import { exportBinarySTL } from './stlExporter';

describe('exportBinarySTL', () => {
  it('produces valid binary STL', () => {
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    };

    const stl = exportBinarySTL(mesh);
    expect(stl.byteLength).toBe(80 + 4 + 50); // header + count + 1 triangle

    const view = new DataView(stl);
    expect(view.getUint32(80, true)).toBe(1); // 1 triangle
  });

  it('handles multiple triangles', () => {
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
    };

    const stl = exportBinarySTL(mesh);
    const view = new DataView(stl);
    expect(view.getUint32(80, true)).toBe(2); // 2 triangles
    expect(stl.byteLength).toBe(80 + 4 + 100); // header + count + 2*50
  });

  it('header contains Sinter', () => {
    const mesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
    };

    const stl = exportBinarySTL(mesh);
    const header = new TextDecoder().decode(new Uint8Array(stl, 0, 20));
    expect(header).toContain('Sinter');
  });
});
