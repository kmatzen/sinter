import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WorkerRequest } from '../types/geometry';

/**
 * Regression tests for the WorkerBridge protocol.
 *
 * The correlation-id cases replay counterexamples TLC produced against the
 * original single-handler design (specs/WorkerBridge.tla). The channel cases
 * cover the export/evaluate split: exports get their own worker so viewport
 * evaluations never queue behind a 256³ export. The admission-control and
 * cancellation cases cover #51 — see specs/WorkerBridgeCancel.tla.
 *
 * Note the protocol change the admission-control tests encode: at most one
 * request per channel is posted at a time. Requests issued behind it are held
 * by the bridge, which is what makes it possible to drop them.
 */

class FakeWorker {
  /** Every worker constructed, in order: [0] evaluates, [1] exports. */
  static instances: FakeWorker[] = [];

  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  sent: WorkerRequest[] = [];
  terminated = false;

  constructor() { FakeWorker.instances.push(this); }
  postMessage(msg: WorkerRequest) { this.sent.push(msg); }
  terminate() { this.terminated = true; }

  emit(msg: any) { this.onmessage?.({ data: msg } as MessageEvent); }
  fail(message: string) { this.onerror?.({ message }); }
}

/** Let queued microtasks and timers run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/**
 * Observe a promise's outcome without awaiting it. `settleCount` exists so a
 * cancel racing an in-flight completion can be shown to settle exactly once —
 * the specific hazard #51 names.
 */
function track<T>(p: Promise<T>) {
  const state = { settled: false, settleCount: 0, value: undefined as T | undefined, error: undefined as any };
  p.then(
    (v) => { state.settled = true; state.settleCount++; state.value = v; },
    (e) => { state.settled = true; state.settleCount++; state.error = e; },
  );
  return state;
}

function sdfResponse(rid: number, glsl: string) {
  return {
    type: 'sdf', rid, glsl,
    paramCount: 0, paramValues: [],
    bbMin: [0, 0, 0], bbMax: [1, 1, 1],
  };
}

const exportResult = (rid: number) => ({
  type: 'exportResult', rid, format: 'stl', data: new ArrayBuffer(8), vertexCount: 6, triangleCount: 2,
  diagnostics: { watertight: true, boundaryEdges: 0, nonManifoldEdges: 0, inconsistentEdges: 0, degenerateTriangles: 0, invalidIndices: 0, nonFiniteVertices: 0, zeroAreaTriangles: 0, dimensions: [1, 2, 3] },
  conformance: { status: 'verified', tolerance: 0.1, meshToSourceMax: 0.02, meshToSourceRms: 0.01, sourceToMeshMax: 0.03, sourceToMeshRms: 0.02, maxDeviation: 0.03, rmsDeviation: 0.015, meshSamples: 20, sourceSamples: 30 },
});

let bridge: typeof import('./workerBridge').workerBridge;
let evalWorker: FakeWorker;
let exportWorker: FakeWorker;

beforeEach(async () => {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  bridge = (await import('./workerBridge')).workerBridge;

  expect(FakeWorker.instances).toHaveLength(2);
  [evalWorker, exportWorker] = FakeWorker.instances;
  evalWorker.emit({ type: 'ready' });
  exportWorker.emit({ type: 'ready' });
  await flush();
});

describe('WorkerBridge channels', () => {
  it('sends evaluates and exports to different workers', async () => {
    void bridge.evaluate(null);
    void bridge.exportSTL(null);
    await flush();

    expect(evalWorker.sent.map((r) => r.type)).toEqual(['evaluate']);
    expect(exportWorker.sent.map((r) => r.type)).toEqual(['exportSTL']);
  });

  it('settles an evaluate while an export is still running', async () => {
    // The point of the split. With one worker the export occupied it and the
    // evaluate could not be answered until the export finished, freezing the
    // viewport for the duration.
    const exported = track(bridge.exportSTL(null));
    await flush();
    const evaluated = track(bridge.evaluate(null));
    await flush();

    evalWorker.emit(sdfResponse(evalWorker.sent[0].rid, 'GLSL'));
    await flush();

    expect(evaluated.settled).toBe(true);
    expect(evaluated.value?.glsl).toBe('GLSL');
    expect(exported.settled).toBe(false);

    // And the export still completes afterwards.
    exportWorker.emit(exportResult(exportWorker.sent[0].rid));
    await flush();
    expect(exported.value?.blob).toBeInstanceOf(Blob);
    expect(exported.value?.triangleCount).toBe(2);
  });

  it('routes both export formats to the export worker, one at a time', async () => {
    void bridge.exportSTL(null);
    await flush();
    void bridge.export3MF(null);
    await flush();

    // The second export is held, not posted: the worker meshes to completion
    // and queueing behind it in the worker would forfeit the ability to drop it.
    expect(exportWorker.sent.map((r) => r.type)).toEqual(['exportSTL']);

    exportWorker.emit(exportResult(exportWorker.sent[0].rid));
    await flush();

    expect(exportWorker.sent.map((r) => r.type)).toEqual(['exportSTL', 'export3MF']);
    expect(evalWorker.sent).toHaveLength(0);
  });

  it('rejects only the crashed worker\'s requests', async () => {
    const exported = track(bridge.exportSTL(null));
    const evaluated = track(bridge.evaluate(null));
    await flush();

    evalWorker.fail('eval worker died');
    await flush();

    expect(evaluated.error?.message).toBe('eval worker died');
    // The export lives on a different worker and must be untouched.
    expect(exported.settled).toBe(false);

    exportWorker.emit(exportResult(exportWorker.sent[0].rid));
    await flush();
    expect(exported.value?.blob).toBeInstanceOf(Blob);
  });

  it('rejects queued requests on a crashed worker too', async () => {
    // The worker is not respawned on error, so a held request would otherwise
    // wait for a run that can never happen.
    const first = track(bridge.exportSTL(null));
    await flush();
    const queued = track(bridge.export3MF(null));
    await flush();
    expect(exportWorker.sent).toHaveLength(1);

    exportWorker.fail('export worker died');
    await flush();

    expect(first.error?.message).toBe('export worker died');
    expect(queued.error?.message).toBe('export worker died');
  });
});

describe('WorkerBridge correlation ids', () => {
  it('does not settle one evaluate with another evaluate\'s response', async () => {
    // TLC counterexample for NoCrossTalk (specs/WorkerBridge.tla). Under
    // admission control the two are no longer in flight together, so the
    // hazard takes its surviving form: a *late* response for an already
    // settled id must not settle the request that followed it.
    const first = track(bridge.evaluate(null));
    await flush();
    const second = track(bridge.evaluate(null));
    await flush();

    const firstRid = evalWorker.sent[0].rid;
    evalWorker.emit(sdfResponse(firstRid, 'FIRST'));
    await flush();

    // The superseded evaluate settles, with null rather than stale data.
    expect(first.settled).toBe(true);
    expect(first.value).toBeNull();

    // Only now is the second posted, under its own id.
    expect(evalWorker.sent).toHaveLength(2);
    const secondRid = evalWorker.sent[1].rid;
    expect(secondRid).not.toBe(firstRid);

    // A duplicate of the first response must not reach the second request.
    evalWorker.emit(sdfResponse(firstRid, 'FIRST AGAIN'));
    await flush();
    expect(second.settled).toBe(false);

    evalWorker.emit(sdfResponse(secondRid, 'SECOND'));
    await flush();
    expect(second.value?.glsl).toBe('SECOND');
    expect(second.settleCount).toBe(1);
  });

  it('settles an export whose handler would have been displaced by an evaluate', async () => {
    // TLC counterexample for NoOrphan. The single handler slot is gone, and so
    // is the shared worker, but the settlement guarantee is what matters.
    const exported = track(bridge.exportSTL(null));
    await flush();
    const evaluated = track(bridge.evaluate(null));
    await flush();

    exportWorker.emit(exportResult(exportWorker.sent[0].rid));
    await flush();

    // The old design left this pending forever — Toolbar's await never returned.
    expect(exported.settled).toBe(true);
    expect(exported.value?.blob).toBeInstanceOf(Blob);

    evalWorker.emit(sdfResponse(evalWorker.sent[0].rid, 'GLSL'));
    await flush();
    expect(evaluated.settled).toBe(true);
  });

  it('routes progress to the originating export only', async () => {
    const stl: string[] = [];
    const mf: string[] = [];
    void bridge.exportSTL(null, (stage) => stl.push(stage));
    await flush();
    void bridge.export3MF(null, (stage) => mf.push(stage));
    await flush();

    const stlRid = exportWorker.sent[0].rid;
    exportWorker.emit({ type: 'progress', rid: stlRid, stage: 'stl-stage', percent: 10 });
    await flush();
    expect(stl).toEqual(['stl-stage']);
    expect(mf).toEqual([]);

    // Finish the STL so the 3MF is posted, then check its progress is its own.
    exportWorker.emit(exportResult(stlRid));
    await flush();
    exportWorker.emit({ type: 'progress', rid: exportWorker.sent[1].rid, stage: '3mf-stage', percent: 20 });
    await flush();

    expect(stl).toEqual(['stl-stage']);
    expect(mf).toEqual(['3mf-stage']);
  });

  it('rejects only the request that errored', async () => {
    const exported = track(bridge.exportSTL(null));
    await flush();
    const evaluated = track(bridge.evaluate(null));
    await flush();

    exportWorker.emit({ type: 'error', rid: exportWorker.sent[0].rid, message: 'No geometry to export' });
    await flush();

    expect(exported.error?.message).toBe('No geometry to export');
    expect(evaluated.settled).toBe(false);

    evalWorker.emit(sdfResponse(evalWorker.sent[0].rid, 'GLSL'));
    await flush();
    expect(evaluated.value?.glsl).toBe('GLSL');
  });

  it('ignores a duplicate response for an already-settled request', async () => {
    const evaluated = track(bridge.evaluate(null));
    await flush();
    const rid = evalWorker.sent[0].rid;

    evalWorker.emit(sdfResponse(rid, 'GLSL'));
    await flush();
    expect(evaluated.value?.glsl).toBe('GLSL');

    // Must not throw, and must not disturb any later request's entry.
    expect(() => evalWorker.emit(sdfResponse(rid, 'AGAIN'))).not.toThrow();
    await flush();
    expect(evaluated.value?.glsl).toBe('GLSL');
    expect(evaluated.settleCount).toBe(1);
  });
});

describe('WorkerBridge admission control (#51)', () => {
  it('posts at most one evaluate at a time', async () => {
    void bridge.evaluate(null);
    void bridge.evaluate(null);
    void bridge.evaluate(null);
    await flush();

    expect(evalWorker.sent).toHaveLength(1);
  });

  it('drops a queued evaluate superseded by a newer one, without running it', async () => {
    // The #51 case: ten edits used to post ten full evaluations and discard
    // nine results. The nine must now never reach the worker at all.
    const inFlight = track(bridge.evaluate(null));
    await flush();
    const superseded = track(bridge.evaluate(null));
    await flush();
    const newest = track(bridge.evaluate(null));
    await flush();

    // Settled immediately, with no worker round trip.
    expect(superseded.settled).toBe(true);
    expect(superseded.value).toBeNull();
    expect(inFlight.settled).toBe(false);
    expect(newest.settled).toBe(false);
    expect(evalWorker.sent).toHaveLength(1);

    // The one already posted cannot be recalled; it completes and settles null.
    evalWorker.emit(sdfResponse(evalWorker.sent[0].rid, 'STALE'));
    await flush();
    expect(inFlight.value).toBeNull();

    // Only the newest is then run — two evaluations for three edits.
    expect(evalWorker.sent).toHaveLength(2);
    evalWorker.emit(sdfResponse(evalWorker.sent[1].rid, 'NEWEST'));
    await flush();
    expect(newest.value?.glsl).toBe('NEWEST');
  });

  it('does not supersede queued exports when an evaluate is issued', async () => {
    const exported = track(bridge.exportSTL(null));
    await flush();
    const queuedExport = track(bridge.export3MF(null));
    await flush();

    void bridge.evaluate(null);
    void bridge.evaluate(null);
    await flush();

    expect(queuedExport.settled).toBe(false);
    exportWorker.emit(exportResult(exportWorker.sent[0].rid));
    await flush();
    expect(exported.value?.blob).toBeInstanceOf(Blob);
    expect(exportWorker.sent).toHaveLength(2);
  });
});

describe('WorkerBridge export cancellation (#51)', () => {
  it('rejects the running export with CancelledError and kills its worker', async () => {
    const exported = track(bridge.exportSTL(null));
    await flush();
    expect(exportWorker.sent).toHaveLength(1);

    bridge.cancelExport();
    await flush();

    expect(exported.settled).toBe(true);
    expect(exported.error?.name).toBe('CancelledError');
    // A cooperative flag could not have stopped this work — the worker never
    // reads its message queue mid-job. Termination is the only lever.
    expect(exportWorker.terminated).toBe(true);
  });

  it('drops queued exports as well as the running one', async () => {
    const running = track(bridge.exportSTL(null));
    await flush();
    const queued = track(bridge.export3MF(null));
    await flush();

    bridge.cancelExport();
    await flush();

    expect(running.error?.name).toBe('CancelledError');
    expect(queued.error?.name).toBe('CancelledError');
  });

  it('settles exactly once when a cancel races an in-flight completion', async () => {
    // The hazard #51 names. The worker may already have posted its result
    // before terminate() lands; that message must not settle the request a
    // second time, nor strand it.
    const exported = track(bridge.exportSTL(null));
    await flush();
    const rid = exportWorker.sent[0].rid;

    bridge.cancelExport();
    // The in-flight completion, arriving after the cancel.
    exportWorker.emit(exportResult(rid));
    await flush();

    expect(exported.settleCount).toBe(1);
    expect(exported.error?.name).toBe('CancelledError');
  });

  it('leaves evaluates untouched', async () => {
    const evaluated = track(bridge.evaluate(null));
    track(bridge.exportSTL(null));
    await flush();

    bridge.cancelExport();
    await flush();

    expect(evaluated.settled).toBe(false);
    expect(evalWorker.terminated).toBe(false);
    evalWorker.emit(sdfResponse(evalWorker.sent[0].rid, 'GLSL'));
    await flush();
    expect(evaluated.value?.glsl).toBe('GLSL');
  });

  it('respawns the export worker so the next export works', async () => {
    track(bridge.exportSTL(null));
    await flush();
    bridge.cancelExport();
    await flush();

    expect(FakeWorker.instances).toHaveLength(3);
    const fresh = FakeWorker.instances[2];
    fresh.emit({ type: 'ready' });
    await flush();

    const next = track(bridge.exportSTL(null));
    await flush();
    expect(fresh.sent.map((r) => r.type)).toEqual(['exportSTL']);

    fresh.emit(exportResult(fresh.sent[0].rid));
    await flush();
    expect(next.value?.blob).toBeInstanceOf(Blob);
  });

  it('is a no-op when nothing is exporting', async () => {
    bridge.cancelExport();
    await flush();

    // No respawn: cancelling nothing must not cost a worker startup, and must
    // not discard a warm worker.
    expect(FakeWorker.instances).toHaveLength(2);
    expect(exportWorker.terminated).toBe(false);
  });
});
