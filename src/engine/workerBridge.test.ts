import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WorkerRequest } from '../types/geometry';

/**
 * Regression tests for the WorkerBridge correlation-id protocol.
 *
 * The first two cases are the counterexamples TLC produced against the old
 * single-handler design (specs/WorkerBridge.tla), replayed against the real
 * bridge. Both fail on that design and pass on the current one.
 */

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  sent: WorkerRequest[] = [];

  constructor() { FakeWorker.latest = this; }
  postMessage(msg: WorkerRequest) { this.sent.push(msg); }
  terminate() {}

  emit(msg: any) { this.onmessage?.({ data: msg } as MessageEvent); }
  fail(message: string) { this.onerror?.({ message }); }
}

/** Let queued microtasks and timers run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Observe a promise's outcome without awaiting it. */
function track<T>(p: Promise<T>) {
  const state = { settled: false, value: undefined as T | undefined, error: undefined as any };
  p.then(
    (v) => { state.settled = true; state.value = v; },
    (e) => { state.settled = true; state.error = e; },
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

let bridge: typeof import('./workerBridge').workerBridge;
let worker: FakeWorker;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('Worker', FakeWorker);
  bridge = (await import('./workerBridge')).workerBridge;
  worker = FakeWorker.latest;
  worker.emit({ type: 'ready' });
  await flush();
});

describe('WorkerBridge correlation ids', () => {
  it('does not settle one evaluate with another evaluate\'s response', async () => {
    // TLC counterexample for NoCrossTalk (specs/WorkerBridge.tla).
    const first = track(bridge.evaluate(null));
    const second = track(bridge.evaluate(null));
    await flush();
    expect(worker.sent).toHaveLength(2);

    // The worker answers the FIRST request while the second is still in flight.
    worker.emit(sdfResponse(worker.sent[0].rid, 'FIRST'));
    worker.emit(sdfResponse(worker.sent[1].rid, 'SECOND'));
    await flush();

    // The old design resolved `second` with FIRST's geometry here.
    expect(second.value?.glsl).toBe('SECOND');
    // The superseded evaluate still settles, with null rather than stale data.
    expect(first.settled).toBe(true);
    expect(first.value).toBeNull();
  });

  it('settles an export whose handler would have been displaced by an evaluate', async () => {
    // TLC counterexample for NoOrphan: the export's handler is overwritten by
    // the evaluate, and its exportResult then matches neither branch of the
    // evaluate handler.
    const data = new ArrayBuffer(8);
    const exported = track(bridge.exportSTL(null));
    await flush();
    const exportRid = worker.sent[0].rid;

    const evaluated = track(bridge.evaluate(null));
    await flush();

    worker.emit({ type: 'exportResult', rid: exportRid, format: 'stl', data });
    await flush();

    // The old design left this pending forever — Toolbar's await never returned.
    expect(exported.settled).toBe(true);
    expect(exported.value).toBeInstanceOf(Blob);

    worker.emit(sdfResponse(worker.sent[1].rid, 'GLSL'));
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

    worker.emit({ type: 'progress', rid: worker.sent[0].rid, stage: 'stl-stage', percent: 10 });
    worker.emit({ type: 'progress', rid: worker.sent[1].rid, stage: '3mf-stage', percent: 20 });
    await flush();

    expect(stl).toEqual(['stl-stage']);
    expect(mf).toEqual(['3mf-stage']);
  });

  it('rejects only the request that errored', async () => {
    const exported = track(bridge.exportSTL(null));
    await flush();
    const evaluated = track(bridge.evaluate(null));
    await flush();

    worker.emit({ type: 'error', rid: worker.sent[0].rid, message: 'No geometry to export' });
    await flush();

    expect(exported.error?.message).toBe('No geometry to export');
    expect(evaluated.settled).toBe(false);

    worker.emit(sdfResponse(worker.sent[1].rid, 'GLSL'));
    await flush();
    expect(evaluated.value?.glsl).toBe('GLSL');
  });

  it('rejects every outstanding request when the worker itself fails', async () => {
    const exported = track(bridge.exportSTL(null));
    const evaluated = track(bridge.evaluate(null));
    await flush();

    worker.fail('boom');
    await flush();

    expect(exported.error?.message).toBe('boom');
    expect(evaluated.error?.message).toBe('boom');
  });

  it('ignores a duplicate response for an already-settled request', async () => {
    const evaluated = track(bridge.evaluate(null));
    await flush();
    const rid = worker.sent[0].rid;

    worker.emit(sdfResponse(rid, 'GLSL'));
    await flush();
    expect(evaluated.value?.glsl).toBe('GLSL');

    // Must not throw, and must not disturb any later request's entry.
    expect(() => worker.emit(sdfResponse(rid, 'AGAIN'))).not.toThrow();
    await flush();
    expect(evaluated.value?.glsl).toBe('GLSL');
  });
});
