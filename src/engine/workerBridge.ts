import type { WorkerRequest, WorkerResponse, TriangulatedMesh, ClipPlane } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';

type ResponseHandler = (response: WorkerResponse) => void;

class WorkerBridge {
  private worker: Worker;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private responseHandler: ResponseHandler | null = null;

  constructor() {
    this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });

    this.worker = new Worker(new URL('../worker/sdfWorker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') { this.resolveReady(); return; }
      if (this.responseHandler) this.responseHandler(msg);
    };

    this.worker.onerror = (err) => console.error('Worker error:', err);
  }

  async evaluate(tree: SDFNodeUI | null, resolution?: number, clip?: ClipPlane): Promise<TriangulatedMesh | null> {
    await this.readyPromise;
    return new Promise((resolve, reject) => {
      this.responseHandler = (msg) => {
        if (msg.type === 'mesh') {
          if (msg.positions.byteLength === 0) {
            resolve(null);
          } else {
            const result: any = {
              positions: new Float32Array(msg.positions),
              normals: new Float32Array(msg.normals),
              indices: new Uint32Array(msg.indices),
            };
            if ((msg as any).thickness) {
              result.thickness = new Float32Array((msg as any).thickness);
            }
            resolve(result);
          }
        } else if (msg.type === 'error') reject(new Error(msg.message));
      };
      const req: WorkerRequest = { type: 'evaluate', tree, resolution, clip };
      this.worker.postMessage(req);
    });
  }

  async exportSTL(tree: SDFNodeUI | null): Promise<Blob> {
    await this.readyPromise;
    return new Promise((resolve, reject) => {
      this.responseHandler = (msg) => {
        if (msg.type === 'exportResult') resolve(new Blob([msg.data], { type: 'application/octet-stream' }));
        else if (msg.type === 'error') reject(new Error(msg.message));
      };
      this.worker.postMessage({ type: 'exportSTL', tree } as WorkerRequest);
    });
  }

  async export3MF(tree: SDFNodeUI | null): Promise<Blob> {
    await this.readyPromise;
    return new Promise((resolve, reject) => {
      this.responseHandler = (msg) => {
        if (msg.type === 'exportResult') resolve(new Blob([msg.data], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' }));
        else if (msg.type === 'error') reject(new Error(msg.message));
      };
      this.worker.postMessage({ type: 'export3MF', tree } as WorkerRequest);
    });
  }
}

export const workerBridge = new WorkerBridge();
