import { useState } from 'react';
import { useModelerStore } from '../../store/modelerStore';
import { triggerDownload } from '../../utils/download';
import { buildRecoveryFile } from '../ui/recovery';

export function ModelErrorNotice() {
  const error = useModelerStore((state) => state.error);
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);
  if (!error) return null;

  const retry = () => {
    const state = useModelerStore.getState();
    if (!state.tree) return;
    // A new root identity retriggers useEvaluator without changing document
    // content or adding an undo entry.
    useModelerStore.setState({ tree: { ...state.tree }, error: null });
  };

  const revert = () => {
    const state = useModelerStore.getState();
    if (state.lastValidTree) state.setTree(state.lastValidTree);
  };

  const download = async () => {
    const recovery = await buildRecoveryFile();
    if (!recovery) {
      setRecoveryStatus('No serializable recovery file is available.');
      return;
    }
    triggerDownload(new Blob([recovery.json], { type: 'application/json' }), recovery.filename);
    setRecoveryStatus(`Downloaded ${recovery.source}.`);
  };

  const state = useModelerStore.getState();
  const canRevert = !!state.lastValidTree && state.lastValidTree !== state.tree;
  return (
    <div role="alert" className="absolute bottom-3 left-3 right-3 lg:right-60 bg-red-900/95 px-3 py-2 rounded text-sm text-red-100 z-20">
      <div>{error}</div>
      <div className="flex flex-wrap gap-3 mt-1 text-xs">
        {state.tree && <button className="underline" onClick={retry}>Retry evaluation</button>}
        {canRevert && <button className="underline" onClick={revert}>Revert to last valid model</button>}
        <button className="underline" onClick={() => { void download(); }}>Download recovery</button>
        <button className="underline" onClick={() => useModelerStore.getState().setError(null)}>Dismiss</button>
      </div>
      {recoveryStatus && <div role="status" className="mt-1 text-xs">{recoveryStatus}</div>}
    </div>
  );
}
