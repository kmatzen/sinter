import type { WorkerRequest, WorkerResponse, ClipPlane, MeshFitResult, ExportArtifact, ExportPreflightOptions } from '../types/geometry';
import type { SDFNodeUI } from '../types/operations';
import type { SDFDisplayData } from '../store/modelerStore';

type ProgressHandler = (stage: string, percent: number) => void;

/**
 * Rejection reason for a request the caller cancelled. Distinguished from a
 * real failure so UI can reset quietly instead of reporting an error.
 */
export class CancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message);
    this.name = 'CancelledError';
  }
}

export function isCancelled(err: unknown): boolean {
  return err instanceof CancelledError || (err as any)?.name === 'CancelledError';
}

/**
 * One worker, plus the admission control that decides what it is allowed to
 * be working on.
 *
 * `inFlight` is the single rid currently posted to this worker; `queue` holds
 * rids that have been issued but deliberately not posted yet. Holding them on
 * this side of the boundary is the whole point — see WorkerBridge's comment on
 * why the worker itself cannot be asked to drop work.
 */
interface WorkerChannel {
  worker: Worker;
  /** Set when the worker's `ready` handshake arrives. Nothing is posted before. */
  isReady: boolean;
  /** Issued but not yet posted, in FIFO order. */
  queue: number[];
  /** The rid posted to this worker, or null when it is idle. */
  inFlight: number | null;
}

/**
 * One in-flight request. Registered under its correlation id when the request
 * is issued, removed when — and only when — its promise settles.
 *
 * Invariant (HandlerAgreesWithSettled in specs/WorkerBridgeFixed.tla):
 * an id is present in `pending` iff its promise has not settled. Every path
 * that deletes an entry must settle it, and vice versa.
 *
 * Note this is registration at *issue* time, not at *post* time. A queued
 * request is registered and unsettled, which is what lets it be dropped and
 * settled without the worker ever hearing about it.
 */
interface PendingRequest {
  kind: 'evaluate' | 'export' | 'fit';
  /** For evaluates: the evalSeq at issue time, used to detect supersession. */
  seq: number;
  /** Blob MIME type for exports. */
  mime: string;
  /** Which channel is serving this request, so a crash rejects only its own. */
  channel: WorkerChannel;
  /** Deferred message construction — the request is built when it is posted. */
  build: (rid: number) => WorkerRequest;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressHandler;
}

class WorkerBridge {
  /**
   * Two workers, because the worker runs each message to completion with no
   * yield point (sdfWorker.ts:203). A 256³ export takes seconds, and with a
   * single worker every viewport evaluation queued behind it — useEvaluator
   * fires on any store change, so the viewport froze for the duration of an
   * export. Giving exports their own channel removes the contention instead
   * of trying to interrupt the work.
   *
   * The split also makes termination usable as a cancel: killing the export
   * worker cannot disturb an evaluate, because no evaluate is ever on it.
   */
  private evalChannel: WorkerChannel;
  private exportChannel: WorkerChannel;

  /** Correlation id -> issued request, shared across both channels. */
  private pending = new Map<number, PendingRequest>();
  private nextRid = 1;
  private evalSeq = 0;

  constructor() {
    this.evalChannel = this.spawn();
    this.exportChannel = this.spawn();
  }

  private spawn(): WorkerChannel {
    const worker = new Worker(new URL('../worker/sdfWorker.ts', import.meta.url), { type: 'module' });
    const channel: WorkerChannel = { worker, isReady: false, queue: [], inFlight: null };

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        channel.isReady = true;
        this.pump(channel);
        return;
      }
      this.dispatch(msg);
    };

    // A worker-level failure settles everything outstanding on THAT channel —
    // queued as well as in flight, since this worker is not respawned and will
    // never run them. Otherwise those promises hang. Requests on the other
    // worker are unaffected and must be left alone.
    worker.onerror = (err) => {
      console.error('Worker error:', err);
      this.settleChannel(channel, () => new Error(err.message || 'Worker error'));
    };

    return channel;
  }

  /**
   * Post the next queued request, if the worker is idle and ready.
   *
   * At most one request per channel is ever outstanding with the worker. That
   * is what makes supersession possible: work the bridge is still holding can
   * be dropped, and dropping it is the only form of cancellation available for
   * queued work (see `evaluate`).
   */
  private pump(channel: WorkerChannel) {
    if (!channel.isReady || channel.inFlight !== null) return;
    while (channel.queue.length > 0) {
      const rid = channel.queue.shift()!;
      const req = this.pending.get(rid);
      // Settled while queued — dropped by supersession or by a cancel.
      if (!req) continue;
      channel.inFlight = rid;
      channel.worker.postMessage(req.build(rid));
      return;
    }
  }

  /** Settle and deregister every request on a channel, then clear its queue. */
  private settleChannel(channel: WorkerChannel, error: () => Error) {
    for (const [rid, req] of [...this.pending]) {
      if (req.channel !== channel) continue;
      this.pending.delete(rid);
      req.reject(error());
    }
    channel.queue = [];
    channel.inFlight = null;
  }

  /** Route a response by correlation id alone — never by message type. */
  private dispatch(msg: Extract<WorkerResponse, { rid: number }>) {
    // A response for an unknown id is one we have already settled; drop it.
    // This is the path a terminated worker's last message would take, and the
    // reason a cancel racing an in-flight completion cannot settle twice.
    const req = this.pending.get(msg.rid);
    if (!req) return;

    if (msg.type === 'progress') {
      req.onProgress?.(msg.stage, msg.percent);
      return;
    }

    this.pending.delete(msg.rid);
    const channel = req.channel;
    if (channel.inFlight === msg.rid) channel.inFlight = null;

    try {
      this.settle(req, msg);
    } finally {
      // The worker is free; hand it the next request whatever the outcome.
      this.pump(channel);
    }
  }

  private settle(req: PendingRequest, msg: Extract<WorkerResponse, { rid: number }>) {
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

    if (req.kind === 'fit') {
      if (msg.type !== 'fitResult') {
        req.reject(new Error(`Unexpected '${msg.type}' response for fit request`));
        return;
      }
      req.resolve(msg.fit);
      return;
    }

    if (msg.type !== 'exportResult') {
      req.reject(new Error(`Unexpected '${msg.type}' response for export request`));
      return;
    }
    req.resolve({
      blob: new Blob([msg.data], { type: req.mime }),
      vertexCount: msg.vertexCount,
      triangleCount: msg.triangleCount,
      diagnostics: msg.diagnostics,
      achievedTolerance: msg.achievedTolerance,
      componentCount: msg.componentCount,
      conformance: msg.conformance,
    } satisfies ExportArtifact);
  }

  private issue<T>(
    channel: WorkerChannel,
    build: (rid: number) => WorkerRequest,
    entry: Omit<PendingRequest, 'resolve' | 'reject' | 'channel' | 'build'>,
  ): Promise<T> {
    const rid = this.nextRid++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(rid, { ...entry, channel, build, resolve, reject });
      channel.queue.push(rid);
      this.pump(channel);
    });
  }

  /**
   * Evaluate the tree for the viewport.
   *
   * Issuing an evaluate supersedes any evaluate still sitting in the queue:
   * its result would be discarded by `useEvaluator`'s seq guard anyway, so
   * running it is pure waste. Ten edits in quick succession used to post ten
   * full evaluations and throw nine away; now nine are settled with `null`
   * without ever reaching the worker.
   *
   * The one already posted cannot be recalled. That leaves at most a single
   * stale evaluation running at any time, which is the floor for a worker
   * that never yields — see the note in `cancelExport` on why a `cancel`
   * message would not lower it.
   */
  async evaluate(tree: SDFNodeUI | null, _resolution?: number, clip?: ClipPlane): Promise<SDFDisplayData | null> {
    this.dropQueued(this.evalChannel, 'evaluate', (req) => req.resolve(null));
    const seq = ++this.evalSeq;
    return this.issue<SDFDisplayData | null>(
      this.evalChannel,
      (rid) => ({ type: 'evaluate', rid, tree, clip }),
      { kind: 'evaluate', seq, mime: '' },
    );
  }

  /** Settle and remove every queued (not yet posted) request of a given kind. */
  private dropQueued(
    channel: WorkerChannel,
    kind: PendingRequest['kind'],
    settle: (req: PendingRequest) => void,
  ) {
    channel.queue = channel.queue.filter((rid) => {
      const req = this.pending.get(rid);
      if (!req || req.kind !== kind) return !!req;
      this.pending.delete(rid);
      settle(req);
      return false;
    });
  }

  async exportSTL(tree: SDFNodeUI | null, onProgress?: ProgressHandler, resolution?: number, preflight?: ExportPreflightOptions): Promise<ExportArtifact> {
    return this.issue<ExportArtifact>(
      this.exportChannel,
      (rid) => ({ type: 'exportSTL', rid, tree, resolution, preflight }),
      { kind: 'export', seq: 0, mime: 'application/octet-stream', onProgress },
    );
  }

  async export3MF(tree: SDFNodeUI | null, onProgress?: ProgressHandler, resolution?: number, preflight?: ExportPreflightOptions): Promise<ExportArtifact> {
    return this.issue<ExportArtifact>(
      this.exportChannel,
      (rid) => ({ type: 'export3MF', rid, tree, resolution, preflight }),
      { kind: 'export', seq: 0, mime: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', onProgress },
    );
  }

  /**
   * Fit a primitive to an imported mesh (#87).
   *
   * On the export channel, not the evaluate one. It is a seconds-long compute
   * like an export, and putting it there keeps the viewport responsive while it
   * runs — and means `cancelExport` already covers it, rather than needing a
   * second cancellation path.
   */
  async fitMesh(meshPositions: string, resolution?: number): Promise<MeshFitResult | null> {
    return this.issue<MeshFitResult | null>(
      this.exportChannel,
      (rid) => ({ type: 'fitMesh', rid, meshPositions, resolution }),
      { kind: 'fit', seq: 0, mime: '' },
    );
  }

  /**
   * Abort exports: queued ones are dropped, the running one is killed.
   *
   * Termination rather than a cooperative flag, because a cooperative flag
   * cannot be delivered. A dedicated worker drains its message queue only
   * *between* invocations of `self.onmessage`, and `sdfWorker` runs each
   * message to completion (sdfWorker.ts:203). A `cancel` message posted while
   * a 256³ export is meshing is not read until that export has finished — at
   * which point there is nothing left to cancel. Checking a cancelled-rid set
   * inside `evaluateCPUWithProgress`'s recursion does not help for the same
   * reason: the set can never have been updated.
   *
   * The mechanisms that would work are a `SharedArrayBuffer` flag polled with
   * `Atomics.load`, which needs cross-origin isolation (COOP/COEP) and would
   * break the OAuth popups and cross-origin avatars this app depends on; or
   * making the mesher `async` and yielding to the event loop periodically,
   * which puts an await in the hot recursion. `terminate()` costs a worker
   * respawn and is total, which for a user-initiated abort is exactly right.
   *
   * Safe only because exports have their own worker: no evaluate is ever on
   * this channel, so nothing else is collateral. The terminated worker's
   * pending requests are rejected here, so any message that escaped before
   * termination lands on an unknown rid in `dispatch` and is dropped — a
   * cancel racing an in-flight completion settles the request exactly once.
   */
  cancelExport(): void {
    const channel = this.exportChannel;
    // Nothing outstanding: do not pay a respawn to cancel nothing.
    if (channel.inFlight === null && channel.queue.length === 0) return;

    this.settleChannel(channel, () => new CancelledError('Export cancelled'));
    channel.worker.terminate();
    this.exportChannel = this.spawn();
  }
}

export const workerBridge = new WorkerBridge();
