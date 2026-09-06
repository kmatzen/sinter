import { useEffect, useRef } from 'react';
import type { SDFNodeUI } from '../types/operations';
import { useModelerStore } from '../store/modelerStore';
import { workerBridge } from './workerBridge';
import { useTreeUiStore } from '../store/treeUiStore';
import { expectedChildren } from '../types/operations';

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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evalSeqRef = useRef(0);

  useEffect(() => {
    function triggerEval() {
      const tree = useModelerStore.getState().tree;
      const viewState = useTreeUiStore.getState();
      const viewKey = `${[...viewState.hiddenNodeIds].sort().join(',')}|${viewState.isolatedNodeId ?? ''}`;
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
      if (tree === prevTreeRef.current && viewKey === prevViewKeyRef.current) return;
      prevTreeRef.current = tree;
      prevViewKeyRef.current = viewKey;
      const viewportTree = projectViewportTree(tree, viewState.hiddenNodeIds, viewState.isolatedNodeId);

      // Invalidate the old render synchronously with the document change. A
      // failed or delayed evaluation must never leave an older model looking
      // like it belongs to the active tree.
      const seq = ++evalSeqRef.current;
      useModelerStore.setState({ sdfDisplay: null, evaluatedTree: null, evaluatedViewTree: null, evaluating: !!tree, error: null });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!tree) return;

      // Evaluate immediately — codegen is <1ms, no need for debounce.
      debounceRef.current = setTimeout(() => {
        workerBridge.evaluate(viewportTree)
          .then((sdf) => {
            if (seq !== evalSeqRef.current || useModelerStore.getState().tree !== tree) return;
            useModelerStore.setState({
              sdfDisplay: sdf,
              evaluatedTree: tree,
              evaluatedViewTree: viewportTree,
              lastValidTree: sdf ? tree : useModelerStore.getState().lastValidTree,
              evaluating: false,
            });
          })
          .catch((err) => {
            if (seq !== evalSeqRef.current || useModelerStore.getState().tree !== tree) return;
            useModelerStore.setState({ sdfDisplay: null, evaluatedTree: null, evaluatedViewTree: null, error: err.message, evaluating: false });
          });
      }, 0); // Immediate — codegen is <1ms
    }

    const unsub1 = useModelerStore.subscribe(triggerEval);
    const unsub2 = useTreeUiStore.subscribe(triggerEval);

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
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
}
