import type { MeshImportInfo } from './meshImport';

type WorkerResponse = { type: 'preview'; info: MeshImportInfo } | { type: 'progress'; percent: number } |
  { type: 'result'; positions: ArrayBuffer; triangleCount: number; maxDeviation: number } | { type: 'error'; message: string };

export class MeshImportSession {
  private worker: Worker | null = new Worker(new URL('./meshImportWorker.ts', import.meta.url), { type: 'module' });
  private pending: { resolve: (value: any) => void; reject: (error: Error) => void; progress?: (percent: number) => void } | null = null;

  constructor() {
    this.worker!.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.type === 'progress') { this.pending?.progress?.(message.percent); return; }
      const pending = this.pending; this.pending = null;
      if (!pending) return;
      if (message.type === 'error') pending.reject(new Error(message.message));
      else if (message.type === 'preview') pending.resolve(message.info);
      else pending.resolve({ positions: new Float32Array(message.positions), triangleCount: message.triangleCount, maxDeviation: message.maxDeviation });
    };
    this.worker!.onerror = (event) => { const pending = this.pending; this.pending = null; pending?.reject(new Error(event.message || 'Mesh import worker failed')); };
  }

  private request<T>(message: object, transfer: Transferable[] = [], progress?: (percent: number) => void): Promise<T> {
    if (!this.worker) return Promise.reject(new Error('Mesh import was cancelled'));
    if (this.pending) return Promise.reject(new Error('Mesh import is already busy'));
    return new Promise<T>((resolve, reject) => { this.pending = { resolve, reject, progress }; this.worker!.postMessage(message, transfer); });
  }

  load(file: File): Promise<MeshImportInfo> {
    return file.arrayBuffer().then((buffer) => this.request({ type: 'load', name: file.name, buffer }, [buffer]));
  }

  finish(targetTriangles: number, progress?: (percent: number) => void): Promise<{ positions: Float32Array; triangleCount: number; maxDeviation: number }> {
    return this.request({ type: 'finish', targetTriangles }, [], progress);
  }

  cancel(): void {
    this.worker?.terminate(); this.worker = null;
    const pending = this.pending; this.pending = null; pending?.reject(new DOMException('Mesh import cancelled', 'AbortError'));
  }
}
