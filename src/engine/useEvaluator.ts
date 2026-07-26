import { useEffect, useRef } from 'react';
import { useModelerStore } from '../store/modelerStore';
import { workerBridge } from './workerBridge';

export function useEvaluator() {
  const prevKeyRef = useRef<string>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evalSeqRef = useRef(0);

  useEffect(() => {
    function triggerEval() {
      // Cancel any pending evaluation
      if (debounceRef.current) clearTimeout(debounceRef.current);

      // Evaluate immediately — codegen is <1ms, no need for debounce
      debounceRef.current = setTimeout(() => {
        const tree = useModelerStore.getState().tree;
        const key = JSON.stringify(tree);
        if (key === prevKeyRef.current) return;
        prevKeyRef.current = key;

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
    // `prevKeyRef` starts as '' and no tree serialises to that, so this always
    // evaluates once; identical follow-up states are still de-duped by the key
    // check, and under StrictMode's double-mount the first pass's pending timer
    // is cleared by cleanup before it can run, leaving exactly one evaluation.
    if (useModelerStore.getState().tree) triggerEval();

    return () => {
      unsub1();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
}
