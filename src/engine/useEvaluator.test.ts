import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, cleanup } from '@testing-library/react';
import type { SDFNodeUI } from '../types/operations';
import type { SDFDisplayData } from '../store/modelerStore';

/**
 * Regression tests for the mount-time evaluation in `useEvaluator`.
 *
 * The hook drives the viewport: it asks the worker to evaluate the current tree
 * and hands the result to `setSDFDisplay`, which is the only thing `SdfMesh`
 * draws from. It learns about work to do by subscribing to the store — and a
 * subscription only reports *future* mutations.
 *
 * A loaded project is hydrated into the store before the editor mounts, so
 * nothing mutates the store afterwards and the subscription never fires: the
 * viewport stayed empty until the first node-tree edit (#68). A freshly created
 * project masked the bug, because creating it *is* a mutation that lands after
 * the subscription attaches.
 *
 * These tests pre-populate the store and then mount, which is the broken order.
 */

const evaluate = vi.fn<(tree: SDFNodeUI | null) => Promise<unknown>>();

vi.mock('./workerBridge', () => ({
  workerBridge: {
    evaluate: (tree: SDFNodeUI | null) => evaluate(tree),
  },
}));

// Imported after the mock is registered so the hook picks up the fake bridge.
const { useEvaluator } = await import('./useEvaluator');
const { useModelerStore } = await import('../store/modelerStore');
const { useTreeUiStore } = await import('../store/treeUiStore');

const box = (width = 100): SDFNodeUI => ({
  id: 'box-1',
  kind: 'box',
  label: 'Box',
  params: { width, height: 30, depth: 50 },
  children: [],
  enabled: true,
});

/** A plausible evaluate result — only its identity matters here. */
const display: SDFDisplayData = { glsl: 'float sdf(vec3 p){return 1.0;}', paramCount: 0, paramValues: [], textures: [], bbMin: [-1, -1, -1], bbMax: [1, 1, 1], hasWarn: false };

/** Let the hook's setTimeout(0) and the promise continuation run. */
const flush = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Hydrate a tree the way loading a project does: directly, before mount. */
function hydrate(tree: SDFNodeUI | null) {
  useModelerStore.setState({ tree, sdfDisplay: null, evaluatedTree: null, lastValidTree: null, evaluating: false, error: null });
}

beforeEach(() => {
  evaluate.mockReset();
  evaluate.mockResolvedValue(display);
  hydrate(null);
  useTreeUiStore.getState().resetViewState();
});

afterEach(() => {
  cleanup();
});

describe('useEvaluator', () => {
  it('evaluates a tree that was already in the store when it mounted (#68)', async () => {
    hydrate(box());

    renderHook(() => useEvaluator());
    await flush();

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][0]).toMatchObject({ kind: 'box' });
    // The point of the fix: something to draw actually reaches the viewport.
    expect(useModelerStore.getState().sdfDisplay).toBe(display);
    expect(useModelerStore.getState().evaluating).toBe(false);
  });

  it('does not evaluate on mount when there is nothing to draw', async () => {
    hydrate(null);

    renderHook(() => useEvaluator());
    await flush();

    // An empty editor would only round-trip the worker to set sdfDisplay back
    // to null while flashing the evaluating indicator.
    expect(evaluate).not.toHaveBeenCalled();
    expect(useModelerStore.getState().evaluating).toBe(false);
  });

  it('still evaluates a tree that arrives after mount', async () => {
    renderHook(() => useEvaluator());
    await flush();
    expect(evaluate).not.toHaveBeenCalled();

    useModelerStore.getState().setTree(box());
    await flush();

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(useModelerStore.getState().sdfDisplay).toBe(display);
  });

  it('does not re-evaluate when the tree is unchanged', async () => {
    hydrate(box());

    renderHook(() => useEvaluator());
    await flush();
    expect(evaluate).toHaveBeenCalledTimes(1);

    // A store mutation that leaves the tree alone — selection, in this case —
    // fires the subscription but must not re-run the worker.
    useModelerStore.getState().selectNode('box-1');
    await flush();

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('re-evaluates a viewport-only projection when a node is hidden', async () => {
    const tree: SDFNodeUI = {
      id: 'union', kind: 'union', label: 'Union', params: { smooth: 0 }, enabled: true,
      children: [box(100), { ...box(20), id: 'box-2' }],
    };
    hydrate(tree);
    renderHook(() => useEvaluator());
    await flush();
    evaluate.mockClear();

    useTreeUiStore.getState().toggleHidden('box-2');
    await flush();

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect((evaluate.mock.calls[0][0] as SDFNodeUI).children[1].enabled).toBe(false);
    expect(useModelerStore.getState().tree).toBe(tree);
    expect(useModelerStore.getState().evaluatedTree).toBe(tree);
  });

  it('isolates an operand as a positive solid while retaining unary transforms', async () => {
    const target = { ...box(20), id: 'target' };
    const tree: SDFNodeUI = {
      id: 'move', kind: 'translate', label: 'Move', params: { x: 12, y: 0, z: 0 }, enabled: true,
      children: [{
        id: 'cut', kind: 'subtract', label: 'Cut', params: { smooth: 0 }, enabled: true,
        children: [box(100), target],
      }],
    };
    hydrate(tree);
    useTreeUiStore.getState().isolate('target');
    renderHook(() => useEvaluator());
    await flush();

    expect(evaluate.mock.calls[0][0]).toMatchObject({
      id: 'move', kind: 'translate', children: [{ id: 'target', kind: 'box' }],
    });
  });

  it('re-evaluates once the tree actually changes', async () => {
    hydrate(box(100));

    renderHook(() => useEvaluator());
    await flush();
    expect(evaluate).toHaveBeenCalledTimes(1);

    useModelerStore.getState().setTree(box(200));
    await flush();

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[1][0]).toMatchObject({ params: { width: 200 } });
  });

  it('clears a previous display immediately and keeps it cleared after failure', async () => {
    const oldTree = box(100);
    hydrate(oldTree);
    useModelerStore.setState({ sdfDisplay: display, evaluatedTree: oldTree });
    evaluate.mockRejectedValueOnce(new Error('codegen failed'));
    renderHook(() => useEvaluator());

    expect(useModelerStore.getState().sdfDisplay).toBeNull();
    await flush();
    expect(useModelerStore.getState()).toMatchObject({
      sdfDisplay: null, evaluatedTree: null, evaluating: false, error: 'codegen failed',
    });
  });

  it('ignores a stale failure after a newer revision succeeds', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    evaluate.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const firstTree = box(100);
    hydrate(firstTree);
    renderHook(() => useEvaluator());
    await flush();

    const secondTree = box(200);
    useModelerStore.getState().setTree(secondTree);
    await flush();
    second.resolve(display);
    await flush();
    first.reject(new Error('old failure'));
    await flush();

    expect(useModelerStore.getState()).toMatchObject({
      tree: secondTree, sdfDisplay: display, evaluatedTree: secondTree, error: null,
    });
  });

  it('evaluates exactly once across a StrictMode-style double mount', async () => {
    hydrate(box());

    // StrictMode mounts, tears down, and remounts the effect. Cleanup clears the
    // pending timer before it fires, so the remount performs the only evaluation.
    const { unmount } = renderHook(() => useEvaluator());
    unmount();
    renderHook(() => useEvaluator());
    await flush();

    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});

/**
 * The dedup key used to be `JSON.stringify(tree)`.
 *
 * The hook subscribes to the whole store, and `setEvaluating`/`setSDFDisplay`
 * are themselves `set()` calls — so one user edit fired the subscription three
 * times and serialised the entire tree three times to conclude twice that it
 * had already seen it (#88 B1, B2). Identity is both cheaper and enough, since
 * every mutation builds a new tree.
 */
describe('useEvaluator dedup', () => {
  beforeEach(() => {
    evaluate.mockReset();
    evaluate.mockResolvedValue(null);
    useModelerStore.setState({ tree: null, sdfDisplay: null, evaluating: false, error: null });
  });

  afterEach(cleanup);

  it('does not re-evaluate when only the evaluation status changes', async () => {
    useModelerStore.setState({ tree: box() });
    renderHook(() => useEvaluator());
    await flush();
    expect(evaluate).toHaveBeenCalledTimes(1);

    // Exactly what the hook's own success path does to the store.
    useModelerStore.getState().setEvaluating(true);
    useModelerStore.getState().setSDFDisplay(null);
    useModelerStore.getState().setEvaluating(false);
    await flush();

    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('does not re-evaluate when only the selection changes', async () => {
    useModelerStore.setState({ tree: box() });
    renderHook(() => useEvaluator());
    await flush();
    evaluate.mockClear();

    useModelerStore.getState().selectNode('box-1');
    useModelerStore.getState().selectNode(null);
    await flush();

    expect(evaluate).not.toHaveBeenCalled();
  });

  it('evaluates once per real edit, not once per store event', async () => {
    useModelerStore.setState({ tree: box() });
    renderHook(() => useEvaluator());
    await flush();
    evaluate.mockClear();

    useModelerStore.getState().updateNodeParams('box-1', { width: 120 });
    await flush();

    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
