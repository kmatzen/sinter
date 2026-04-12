import { useEffect, useRef } from 'react';
import { useModelerStore } from '../store/modelerStore';
import { useViewportStore } from '../store/viewportStore';
import { workerBridge } from './workerBridge';
import type { ClipPlane } from '../types/geometry';

export function useEvaluator() {
  const prevKeyRef = useRef<string>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function triggerEval() {
      const tree = useModelerStore.getState().tree;
      const { resolution, clipEnabled, clipAxis, clipPosition } = useViewportStore.getState();

      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        const clip: ClipPlane | undefined = clipEnabled
          ? { axis: clipAxis, position: clipPosition }
          : undefined;
        const key = JSON.stringify(tree) + ':' + resolution + ':' + JSON.stringify(clip);
        if (key === prevKeyRef.current) return;
        prevKeyRef.current = key;

        useModelerStore.getState().setEvaluating(true);
        useModelerStore.getState().setError(null);

        workerBridge.evaluate(tree, resolution, clip)
          .then((mesh) => {
            useModelerStore.getState().setMesh(mesh);
            useModelerStore.getState().setEvaluating(false);
          })
          .catch((err) => {
            useModelerStore.getState().setError(err.message);
            useModelerStore.getState().setEvaluating(false);
          });
      }, 100);
    }

    const unsub1 = useModelerStore.subscribe(triggerEval);
    const unsub2 = useViewportStore.subscribe(triggerEval);

    return () => {
      unsub1();
      unsub2();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
}
