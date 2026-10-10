import { useEffect, useRef } from 'react';
import type { SDFNodeUI } from '../types/operations';
import { useModelerStore } from '../store/modelerStore';
import { workerBridge } from './workerBridge';
import { useTreeUiStore } from '../store/treeUiStore';
import { useViewportStore } from '../store/viewportStore';
import { expectedChildren } from '../types/operations';
import { toSDFNode } from '../worker/sdf/convert';
import { generateSDFFunction } from '../worker/sdf/codegen';
import { computeBounds } from '../worker/sdf/bounds';

/**
 * Produce a same-shader preview without waiting for verifiedBounds in the
 * worker. The old and newly-computed envelopes are unioned so a moving shape
 * cannot be clipped while the authoritative worker result catches up.
 */
export function optimisticUniformDisplay(
  tree: SDFNodeUI | null,
  current: ReturnType<typeof useModelerStore.getState>['sdfDisplay'],
  hotSourceIds?: Iterable<string>,
  allowShaderChange = false,
) {
  if (!tree || !current) return null;
  try {
    const root = toSDFNode(tree);
    if (!root) return null;
    const compiled = generateSDFFunction(root, { hotSourceIds });
    if (!allowShaderChange && (compiled.glsl !== current.glsl || compiled.paramCount !== current.paramCount)) return null;
    const bounds = computeBounds(root);
    const span = Math.max(
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
      10,
    );
    const margin = span * 0.1;
    return {
      ...current,
      glsl: compiled.glsl,
      paramCount: compiled.paramCount,
      paramValues: compiled.paramValues,
      textures: compiled.textures,
      hasWarn: compiled.hasWarn,
      bbMin: current.bbMin.map((value, axis) => Math.min(value, bounds.min[axis] - margin)) as [number, number, number],
      bbMax: current.bbMax.map((value, axis) => Math.max(value, bounds.max[axis] + margin)) as [number, number, number],
    };
  } catch {
    return null;
  }
}

/** Selected nodes and their ancestors are the only values kept hot. */
export function collectHotSourceIds(tree: SDFNodeUI | null, selectedIds: readonly string[]): string[] {
  if (!tree || selectedIds.length === 0) return [];
  const selected = new Set(selectedIds);
  const hot: string[] = [];
  const visit = (node: SDFNodeUI): boolean => {
    let contains = selected.has(node.id);
    for (const child of node.children) contains = visit(child) || contains;
    if (contains) hot.push(node.id);
    return contains;
  };
  visit(tree);
  return hot;
}

/**
 * Sentinel for "nothing evaluated yet".
 *
 * Distinct from `null`, which is a real tree value meaning an empty document,
 * so the first evaluate still happens for a project that loads empty.
 */
const NOT_EVALUATED = Symbol('not-evaluated');

/** Build geometry for the viewport without mutating document/export semantics. */
export function projectViewportTree(
  tree: SDFNodeUI | null,
  hiddenNodeIds: ReadonlySet<string>,
  isolatedNodeId: string | null,
): SDFNodeUI | null {
  if (!tree) return null;
  if (!isolatedNodeId && hiddenNodeIds.size === 0) return tree;
  const hide = (node: SDFNodeUI): SDFNodeUI => {
    if (hiddenNodeIds.has(node.id)) return node.enabled ? { ...node, enabled: false } : node;
    const children = node.children.map(hide);
    return children.some((child, index) => child !== node.children[index]) ? { ...node, children } : node;
  };
  if (!isolatedNodeId) return hide(tree);

  const isolate = (node: SDFNodeUI): SDFNodeUI | null => {
    if (node.id === isolatedNodeId) return hide(node);
    for (const child of node.children) {
      const projected = isolate(child);
      if (!projected) continue;
      // Unary ancestors carry transforms/modifiers that position or shape the
      // isolated part. Boolean ancestors describe relationships to siblings,
      // so skip them and show the chosen operand as a positive solid.
      return expectedChildren(node.kind) === 1
        ? hide({ ...node, children: [projected] })
        : projected;
    }
    return null;
  };
  return isolate(tree);
}

export function useEvaluator() {
  const prevTreeRef = useRef<SDFNodeUI | null | typeof NOT_EVALUATED>(NOT_EVALUATED);
  const prevViewKeyRef = useRef<string | null>(null);
  const prevHotKeyRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evalSeqRef = useRef(0);
  const acceptedEvalSeqRef = useRef(0);

  useEffect(() => {
    function triggerEval(force = false) {
      const tree = useModelerStore.getState().tree;
      const viewState = useTreeUiStore.getState();
      const viewKey = `${[...viewState.hiddenNodeIds].sort().join(',')}|${viewState.isolatedNodeId ?? ''}`;
      const viewportTree = projectViewportTree(tree, viewState.hiddenNodeIds, viewState.isolatedNodeId);
      const hotSourceIds = collectHotSourceIds(viewportTree, useModelerStore.getState().selectedNodeIds);
      const hotKey = hotSourceIds.join(',');
        // Object identity, not a serialisation.
        //
        // This subscribes to the whole store, and `setEvaluating` and
        // `setSDFDisplay` are themselves `set()` calls — so one user edit fired
        // this three times, and each time serialised the entire tree just to
        // decide it had already seen it. On a large model that is the most
        // expensive thing in the interactive path after the evaluation itself,
        // and it also meant `verifiedBounds` was proved three times per edit
        // rather than once (#88 B1, B2).
        //
        // Every mutation goes through `commit()`, which builds a new tree, and
        // undo/redo restore clones — so a changed tree is always a different
        // object. The converse (a new object with identical content) costs one
        // extra evaluation that the bridge supersedes anyway, which is a much
        // better trade than stringifying a megabyte on every store event.
      if (!force && tree === prevTreeRef.current && viewKey === prevViewKeyRef.current && hotKey === prevHotKeyRef.current) return;
      const selectionOnly = tree === prevTreeRef.current && viewKey === prevViewKeyRef.current && hotKey !== prevHotKeyRef.current;
      prevTreeRef.current = tree;
      prevViewKeyRef.current = viewKey;
      prevHotKeyRef.current = hotKey;

      // Numeric property edits normally retain identical GLSL: values live in
      // u_p and SdfMesh can upload them without compiling a material. Publish
      // that preview synchronously; verified bounds and validation still run
      // in the worker and replace it with the authoritative result.
      const optimistic = optimisticUniformDisplay(viewportTree, useModelerStore.getState().sdfDisplay, hotSourceIds, selectionOnly);
      if (optimistic) useModelerStore.setState({ sdfDisplay: optimistic });
      if (selectionOnly && optimistic) return;

      // Keep the last accepted display while the replacement is evaluated.
      // SdfMesh stages and compiles a replacement before swapping materials;
      // clearing sdfDisplay here destroyed that material first, turning a
      // recoverable shader-capacity/compile failure into a blank viewport.
      // evaluatedTree still identifies which revision the visible preview
      // belongs to, and the evaluating overlay makes the pending state clear.
      const seq = ++evalSeqRef.current;
      const dragging = useViewportStore.getState().dragging;
      useModelerStore.setState({ evaluating: !!tree && !dragging, error: null });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!tree) return;

      // A same-shader continuous edit already has an exact live preview.
      // verifiedBounds is hundreds of milliseconds on a complex tree; running
      // it repeatedly in the worker competes with rendering and can only return
      // stale intermediate envelopes. Verify the final value on pointer-up.
      if (dragging && optimistic) return;

      // Evaluate immediately — codegen is <1ms, no need for debounce.
      debounceRef.current = setTimeout(() => {
        workerBridge.evaluate(viewportTree, undefined, undefined, hotSourceIds)
          .then((sdf) => {
            const exact = seq === evalSeqRef.current && useModelerStore.getState().tree === tree;
            // During a continuous gizmo drag, pointer events can arrive faster
            // than the worker round trip. Requiring an exact tree identity
            // discarded every completed frame until pointer-up. Accept the
            // newest completed intermediate result while dragging; its GLSL
            // structure is unchanged, so SdfMesh takes the uniform-only path.
            const liveDragFrame = !!sdf
              && useViewportStore.getState().dragging
              && seq > acceptedEvalSeqRef.current;
            if (!exact && !liveDragFrame) return;
            acceptedEvalSeqRef.current = seq;
            useModelerStore.setState({
              sdfDisplay: sdf,
              evaluatedTree: tree,
              evaluatedViewTree: viewportTree,
              lastValidTree: sdf ? tree : useModelerStore.getState().lastValidTree,
              evaluating: exact ? false : useModelerStore.getState().evaluating,
            });
          })
          .catch((err) => {
            if (seq !== evalSeqRef.current || useModelerStore.getState().tree !== tree) return;
            useModelerStore.setState({ error: err.message, evaluating: false });
          });
      }, 0); // Immediate — codegen is <1ms
    }

    const unsub1 = useModelerStore.subscribe(() => triggerEval());
    const unsub2 = useTreeUiStore.subscribe(() => triggerEval());
    const unsub3 = useViewportStore.subscribe((state, previous) => {
      if (previous.dragging && !state.dragging) triggerEval(true);
    });

    // Evaluate whatever is already in the store, because subscribing only
    // reacts to *future* mutations. A loaded project is hydrated into the store
    // before this hook mounts, so without this the worker is never asked to
    // evaluate: `sdfDisplay` stays null and the viewport renders nothing until
    // the first node-tree edit happens to fire the subscription (#68). It also
    // blanked shared project links, which always open a pre-populated tree.
    //
    // Guarded on a non-null tree: an empty editor has nothing to draw, and
    // evaluating null would only round-trip the worker to set `sdfDisplay`
    // back to null while flashing the evaluating indicator.
    //
    // `prevTreeRef` starts at the NOT_EVALUATED sentinel, which no tree can
    // equal, so this always evaluates once; identical follow-up states are
    // still de-duped by the identity check, and under StrictMode's
    // double-mount the first pass's pending timer is cleared by cleanup before
    // it can run, leaving exactly one evaluation.
    triggerEval();

    return () => {
      unsub1();
      unsub2();
      unsub3();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
}
