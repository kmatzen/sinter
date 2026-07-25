import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WorkerRequest } from '../types/geometry';

/**
 * Regression tests for the WorkerBridge protocol.
 *
 * The correlation-id cases replay counterexamples TLC produced against the
 * original single-handler design (specs/WorkerBridge.tla). The channel cases
 * cover the export/evaluate split: exports get their own worker so viewport
 * evaluations never queue behind a 256³ export.
 */

class FakeWorker {
  /** Every worker constructed, in order: [0] evaluates, [1] exports. */
  static instances: FakeWorker[] = [];

  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  sent: WorkerRequest[] = [];

  constructor() { FakeWorker.instances.push(this); }
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

const exportResult = (rid: number) => ({
  type: 'exportResult', rid, format: 'stl', data: new ArrayBuffer(8),
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
    expect(exported.value).toBeInstanceOf(Blob);
  });

  it('routes both export formats to the export worker', async () => {
    void bridge.exportSTL(null);
    await flush();
    void bridge.export3MF(null);
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
    expect(exported.value).toBeInstanceOf(Blob);
  });
});

describe('WorkerBridge correlation ids', () => {
  it('does not settle one evaluate with another evaluate\'s response', async () => {
    // TLC counterexample for NoCrossTalk (specs/WorkerBridge.tla).
    const first = track(bridge.evaluate(null));
    const second = track(bridge.evaluate(null));
    await flush();
    expect(evalWorker.sent).toHaveLength(2);

    // The worker answers the FIRST request while the second is still in flight.
    evalWorker.emit(sdfResponse(evalWorker.sent[0].rid, 'FIRST'));
    evalWorker.emit(sdfResponse(evalWorker.sent[1].rid, 'SECOND'));
    await flush();

    // The old design resolved `second` with FIRST's geometry here.
    expect(second.value?.glsl).toBe('SECOND');
    // The superseded evaluate still settles, with null rather than stale data.
    expect(first.settled).toBe(true);
    expect(first.value).toBeNull();
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
    expect(exported.value).toBeInstanceOf(Blob);

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

    exportWorker.emit({ type: 'progress', rid: exportWorker.sent[0].rid, stage: 'stl-stage', percent: 10 });
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
  });
});
