import { useEffect, useRef } from 'react';
import type { SDFNodeUI } from '../types/operations';
import { useModelerStore } from '../store/modelerStore';
import { workerBridge } from './workerBridge';

/**
 * Sentinel for "nothing evaluated yet".
 *
 * Distinct from `null`, which is a real tree value meaning an empty document,
 * so the first evaluate still happens for a project that loads empty.
 */
const NOT_EVALUATED = Symbol('not-evaluated');

export function useEvaluator() {
  const prevTreeRef = useRef<SDFNodeUI | null | typeof NOT_EVALUATED>(NOT_EVALUATED);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evalSeqRef = useRef(0);

  useEffect(() => {
    function triggerEval() {
      // Cancel any pending evaluation
      if (debounceRef.current) clearTimeout(debounceRef.current);

      // Evaluate immediately — codegen is <1ms, no need for debounce
      debounceRef.current = setTimeout(() => {
        const tree = useModelerStore.getState().tree;
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
        if (tree === prevTreeRef.current) return;
        prevTreeRef.current = tree;

        const seq = ++evalSeqRef.current;
        useModelerStore.getState().setEvaluating(true);
        useModelerStore.getState().setError(null);

        workerBridge.evaluate(tree)
          .then((sdf) => {
            if (seq !== evalSeqRef.current) return;
            useModelerStore.getState().setSDFDisplay(sdf);
            useModelerStore.getState().setEvaluating(false);
          })
          .catch((err) => {
            if (seq !== evalSeqRef.current) return;
            useModelerStore.getState().setError(err.message);
            useModelerStore.getState().setEvaluating(false);
          });
      }, 0); // Immediate — codegen is <1ms
    }

    const unsub1 = useModelerStore.subscribe(triggerEval);

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
    if (useModelerStore.getState().tree) triggerEval();

    return () => {
      unsub1();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
}
