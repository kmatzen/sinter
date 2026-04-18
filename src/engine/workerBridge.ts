import type { WorkerRequest, WorkerResponse, ClipPlane } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';
import type { SDFDisplayData } from '../store/modelerStore';

type ResponseHandler = (response: WorkerResponse) => void;
type ProgressHandler = (stage: string, percent: number) => void;

class WorkerBridge {
  private worker: Worker;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private responseHandler: ResponseHandler | null = null;
  private progressHandler: ProgressHandler | null = null;
  private evalSeq = 0;

  constructor() {
    this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });

    this.worker = new Worker(new URL('../worker/sdfWorker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') { this.resolveReady(); return; }
      if (msg.type === 'progress') { if (this.progressHandler) this.progressHandler(msg.stage, msg.percent); return; }
      if (this.responseHandler) this.responseHandler(msg);
    };

    this.worker.onerror = (err) => console.error('Worker error:', err);
  }

  async evaluate(tree: SDFNodeUI | null, _resolution?: number, clip?: ClipPlane): Promise<SDFDisplayData | null> {
    await this.readyPromise;
    const seq = ++this.evalSeq;
    return new Promise((resolve, reject) => {
      this.responseHandler = (msg) => {
        // Ignore responses for stale evaluate calls
        if (seq !== this.evalSeq) return;
        if (msg.type === 'sdf') {
          if (!msg.glsl) {
            resolve(null);
          } else {
            resolve({ glsl: msg.glsl, paramCount: msg.paramCount, paramValues: msg.paramValues, textures: msg.textures || [], bbMin: msg.bbMin, bbMax: msg.bbMax, hasWarn: !!msg.hasWarn });
          }
        } else if (msg.type === 'error') reject(new Error(msg.message));
      };
      const req: WorkerRequest = { type: 'evaluate', tree, clip };
      this.worker.postMessage(req);
    });
  }

  async exportSTL(tree: SDFNodeUI | null, onProgress?: ProgressHandler): Promise<Blob> {
    await this.readyPromise;
    return new Promise((resolve, reject) => {
      this.progressHandler = onProgress || null;
      this.responseHandler = (msg) => {
        if (msg.type === 'exportResult') { this.progressHandler = null; resolve(new Blob([msg.data], { type: 'application/octet-stream' })); }
        else if (msg.type === 'error') { this.progressHandler = null; reject(new Error(msg.message)); }
      };
      this.worker.postMessage({ type: 'exportSTL', tree } as WorkerRequest);
    });
  }

  async export3MF(tree: SDFNodeUI | null, onProgress?: ProgressHandler): Promise<Blob> {
    await this.readyPromise;
    return new Promise((resolve, reject) => {
      this.progressHandler = onProgress || null;
      this.responseHandler = (msg) => {
        if (msg.type === 'exportResult') { this.progressHandler = null; resolve(new Blob([msg.data], { type: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' })); }
        else if (msg.type === 'error') { this.progressHandler = null; reject(new Error(msg.message)); }
      };
      this.worker.postMessage({ type: 'export3MF', tree } as WorkerRequest);
    });
  }
}

export const workerBridge = new WorkerBridge();
