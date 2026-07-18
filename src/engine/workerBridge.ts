import type { WorkerRequest, WorkerResponse, ClipPlane } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';
import type { SDFDisplayData } from '../store/modelerStore';

type ProgressHandler = (stage: string, percent: number) => void;

/** A worker plus its `ready` handshake. */
interface WorkerChannel {
  worker: Worker;
  ready: Promise<void>;
}

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
  /** Which channel is serving this request, so a crash rejects only its own. */
  channel: WorkerChannel;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressHandler;
}

class WorkerBridge {
  /**
   * Two workers, because the worker runs each message to completion with no
   * yield point (sdfWorker.ts:165). A 256³ export takes seconds, and with a
   * single worker every viewport evaluation queued behind it — useEvaluator
   * fires on any store change, so the viewport froze for the duration of an
   * export. Giving exports their own channel removes the contention instead
   * of trying to interrupt the work.
   *
   * This is not cancellation: a superseded evaluate still runs to completion,
   * it just no longer waits on an export. See #51.
   */
  private evalChannel: WorkerChannel;
  private exportChannel: WorkerChannel;

  /** Correlation id -> in-flight request, shared across both channels. */
  private pending = new Map<number, PendingRequest>();
  private nextRid = 1;
  private evalSeq = 0;

  constructor() {
    this.evalChannel = this.spawn();
    this.exportChannel = this.spawn();
  }

  private spawn(): WorkerChannel {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

    const worker = new Worker(new URL('../worker/sdfWorker.ts', import.meta.url), { type: 'module' });
    const channel: WorkerChannel = { worker, ready };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') { resolveReady(); return; }
      this.dispatch(msg);
    };

    // A worker-level failure settles everything outstanding on THAT channel;
    // otherwise those promises hang. Requests on the other worker are
    // unaffected and must be left alone.
    worker.onerror = (err) => {
      console.error('Worker error:', err);
      for (const [rid, req] of [...this.pending]) {
        if (req.channel !== channel) continue;
        this.pending.delete(rid);
        req.reject(new Error(err.message || 'Worker error'));
      }
    };

    return channel;
  }

  /** Route a response by correlation id alone — never by message type. */
  private dispatch(msg: Extract<WorkerResponse, { rid: number }>) {
    // A response for an unknown id is one we have already settled; drop it.
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
  }

  private async issue<T>(
    channel: WorkerChannel,
    build: (rid: number) => WorkerRequest,
    entry: Omit<PendingRequest, 'resolve' | 'reject' | 'channel'>,
  ): Promise<T> {
    await channel.ready;
    const rid = this.nextRid++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(rid, { ...entry, channel, resolve, reject });
      channel.worker.postMessage(build(rid));
    });
  }

  async evaluate(tree: SDFNodeUI | null, _resolution?: number, clip?: ClipPlane): Promise<SDFDisplayData | null> {
    const seq = ++this.evalSeq;
    return this.issue<SDFDisplayData | null>(
      this.evalChannel,
      (rid) => ({ type: 'evaluate', rid, tree, clip }),
      { kind: 'evaluate', seq, mime: '' },
    );
  }

  async exportSTL(tree: SDFNodeUI | null, onProgress?: ProgressHandler): Promise<Blob> {
    return this.issue<Blob>(
      this.exportChannel,
      (rid) => ({ type: 'exportSTL', rid, tree }),
      { kind: 'export', seq: 0, mime: 'application/octet-stream', onProgress },
    );
  }

  async export3MF(tree: SDFNodeUI | null, onProgress?: ProgressHandler): Promise<Blob> {
    return this.issue<Blob>(
      this.exportChannel,
      (rid) => ({ type: 'export3MF', rid, tree }),
      { kind: 'export', seq: 0, mime: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', onProgress },
    );
  }
}

export const workerBridge = new WorkerBridge();
