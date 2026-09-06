import { useModelerStore } from './store/modelerStore';
import { useProjectStore } from './store/projectStore';
import { useViewportStore } from './store/viewportStore';
import { getEngineRef } from './engine/engineRef';

export function handleModelerKeyDown(e: KeyboardEvent) {
  // Saving is global within the editor. Handle it before the text-entry guard
  // so the browser's Save Page action never wins while an input has focus.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    void useProjectStore.getState().save();
    return;
  }

  if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

  if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); useModelerStore.getState().undo(); }
  if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); useModelerStore.getState().redo(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'c') useModelerStore.getState().copySelected();
  if ((e.metaKey || e.ctrlKey) && e.key === 'v') useModelerStore.getState().pasteToSelected();
  if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); useModelerStore.getState().duplicateSelected(); }
  const { gizmoMode, setGizmoMode } = useViewportStore.getState();
  if (e.key === 'w' || e.key === 'W') setGizmoMode(gizmoMode === 'translate' ? 'none' : 'translate');
  if (e.key === 'e' || e.key === 'E') setGizmoMode(gizmoMode === 'rotate' ? 'none' : 'rotate');
  if (e.key === 'r' || e.key === 'R') setGizmoMode(gizmoMode === 'scale' ? 'none' : 'scale');
  if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    if (e.shiftKey) getEngineRef()?.frameSelection();
    else getEngineRef()?.zoomToFit();
  }
  if (e.key === 'Escape') setGizmoMode('none');
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const id = useModelerStore.getState().selectedNodeId;
    if (id) useModelerStore.getState().removeNode(id);
  }
}
