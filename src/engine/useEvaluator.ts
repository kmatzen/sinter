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

    return () => {
      unsub1();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
}
