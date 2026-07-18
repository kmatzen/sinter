import type { WorkerRequest, WorkerResponse, ClipPlane } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';
import type { SDFDisplayData } from '../store/modelerStore';

type ProgressHandler = (stage: string, percent: number) => void;

/**
 * One in-flight request. Registered under its correlation id when the request
 * is posted, removed when — and only when — its promise settles.
 *
 * Invariant (HandlerAgreesWithSettled in specs/WorkerBridgeFixed.tla):
 * an id is present in `pending` iff its promise has not settled. Every path
 * that deletes an entry must settle it, and vice versa.
 */
interface PendingRequest {
  kind: 'evaluate' | 'export';
  /** For evaluates: the evalSeq at issue time, used to detect supersession. */
  seq: number;
  /** Blob MIME type for exports. */
  mime: string;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressHandler;
}

class WorkerBridge {
  private worker: Worker;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  /** Correlation id -> in-flight request. Replaces the old single handler slot. */
  private pending = new Map<number, PendingRequest>();
  private nextRid = 1;
  private evalSeq = 0;

  constructor() {
    this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });

    this.worker = new Worker(new URL('../worker/sdfWorker.ts', import.meta.url), { type: 'module' });

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') { this.resolveReady(); return; }

      // Route by correlation id alone — never by message type. A response for
      // an unknown id is one we have already settled; drop it.
      const req = this.pending.get(msg.rid);
      if (!req) return;

      if (msg.type === 'progress') {
        req.onProgress?.(msg.stage, msg.percent);
        return;
      }

      this.pending.delete(msg.rid);

      if (msg.type === 'error') {
        req.reject(new Error(msg.message));
        return;
      }

      if (req.kind === 'evaluate') {
        if (msg.type !== 'sdf') {
          req.reject(new Error(`Unexpected '${msg.type}' response for evaluate request`));
          return;
        }
        // A superseded evaluate still settles. Staleness is the caller's
        // concern — useEvaluator has its own evalSeq guard — but the promise
        // must never be stranded.
        if (req.seq !== this.evalSeq) { req.resolve(null); return; }
        if (!msg.glsl) { req.resolve(null); return; }
        req.resolve({
          glsl: msg.glsl,
          paramCount: msg.paramCount,
          paramValues: msg.paramValues,
          textures: msg.textures || [],
          bbMin: msg.bbMin,
          bbMax: msg.bbMax,
          hasWarn: !!msg.hasWarn,
        });
        return;
      }

      if (msg.type !== 'exportResult') {
        req.reject(new Error(`Unexpected '${msg.type}' response for export request`));
        return;
      }
      req.resolve(new Blob([msg.data], { type: req.mime }));
    };

    // A worker-level failure settles everything outstanding; otherwise every
    // pending promise hangs forever.
    this.worker.onerror = (err) => {
      console.error('Worker error:', err);
      const outstanding = [...this.pending.values()];
      this.pending.clear();
      for (const req of outstanding) {
        req.reject(new Error(err.message || 'Worker error'));
      }
    };
  }

  private async issue<T>(
    build: (rid: number) => WorkerRequest,
    entry: Omit<PendingRequest, 'resolve' | 'reject'>,
  ): Promise<T> {
    await this.readyPromise;
    const rid = this.nextRid++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(rid, { ...entry, resolve, reject });
      this.worker.postMessage(build(rid));
    });
  }

  async evaluate(tree: SDFNodeUI | null, _resolution?: number, clip?: ClipPlane): Promise<SDFDisplayData | null> {
    const seq = ++this.evalSeq;
    return this.issue<SDFDisplayData | null>(
      (rid) => ({ type: 'evaluate', rid, tree, clip }),
      { kind: 'evaluate', seq, mime: '' },
    );
  }

  async exportSTL(tree: SDFNodeUI | null, onProgress?: ProgressHandler): Promise<Blob> {
    return this.issue<Blob>(
      (rid) => ({ type: 'exportSTL', rid, tree }),
      { kind: 'export', seq: 0, mime: 'application/octet-stream', onProgress },
    );
  }

  async export3MF(tree: SDFNodeUI | null, onProgress?: ProgressHandler): Promise<Blob> {
    return this.issue<Blob>(
      (rid) => ({ type: 'export3MF', rid, tree }),
      { kind: 'export', seq: 0, mime: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', onProgress },
    );
  }
}

export const workerBridge = new WorkerBridge();
