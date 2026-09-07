/// <reference lib="webworker" />
import { parseMeshImport, reduceImportedMesh, type MeshImportInfo } from './meshImport';

type Request = { type: 'load'; name: string; buffer: ArrayBuffer } | { type: 'finish'; targetTriangles: number };
type Response = { type: 'preview'; info: MeshImportInfo } | { type: 'progress'; percent: number } |
  { type: 'result'; positions: ArrayBuffer; triangleCount: number } | { type: 'error'; message: string };

let positions: Float32Array | null = null;

self.onmessage = (event: MessageEvent<Request>) => {
  try {
    if (event.data.type === 'load') {
      const parsed = parseMeshImport(event.data.buffer, event.data.name);
      positions = parsed.positions;
      self.postMessage({ type: 'preview', info: parsed.info } satisfies Response);
      return;
    }
    if (!positions) throw new Error('Choose a mesh file before importing');
    const result = reduceImportedMesh(positions, event.data.targetTriangles, (percent) => {
      self.postMessage({ type: 'progress', percent } satisfies Response);
    });
    positions = null;
    const buffer = result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer;
    self.postMessage({ type: 'result', positions: buffer, triangleCount: result.length / 9 } satisfies Response, [buffer]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) } satisfies Response);
  }
};
