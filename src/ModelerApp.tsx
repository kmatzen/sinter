import { useEffect } from 'react';
import { NodeTreePanel } from './components/tree/NodeTreePanel';
import { Viewport } from './components/viewport/Viewport';
import { PropertyPanel } from './components/properties/PropertyPanel';
import { Toolbar } from './components/toolbar/Toolbar';
import { ChatDrawer } from './components/chat/ChatDrawer';
import { useEvaluator } from './engine/useEvaluator';
import { useModelerStore } from './store/modelerStore';
import { useViewportStore } from './store/viewportStore';
import { startAutoSave } from './store/projectStore';
import { startLocalAutoSave } from './store/localPersist';
import { features } from './config';
import { AppModals } from './components/ui/AppModals';

export function ModelerApp() {
  useEvaluator();
  useEffect(() => {
    if (features.autoSave) startAutoSave();
    if (features.byok) startLocalAutoSave();

    // After payment redirect, refresh credits
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      window.history.replaceState({}, '', window.location.pathname);
      window.dispatchEvent(new Event('credits-updated'));
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        useModelerStore.getState().undo();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        useModelerStore.getState().redo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        useModelerStore.getState().copySelected();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
        useModelerStore.getState().pasteToSelected();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        useModelerStore.getState().duplicateSelected();
      }
      const { gizmoMode, setGizmoMode } = useViewportStore.getState();
      if (e.key === 'w' || e.key === 'W') setGizmoMode(gizmoMode === 'translate' ? 'none' : 'translate');
      if (e.key === 'e' || e.key === 'E') setGizmoMode(gizmoMode === 'rotate' ? 'none' : 'rotate');
      if (e.key === 'r' || e.key === 'R') setGizmoMode(gizmoMode === 'scale' ? 'none' : 'scale');
      if (e.key === 'Escape') setGizmoMode('none');
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const id = useModelerStore.getState().selectedNodeId;
        if (id) useModelerStore.getState().removeNode(id);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        const json = useModelerStore.getState().toJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const name = useModelerStore.getState().projectName;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div data-testid="modeler-app" className="h-full flex flex-col overflow-hidden" style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <div className="hidden md:flex"><NodeTreePanel /></div>
        <Viewport />
        <div className="hidden lg:flex"><PropertyPanel /></div>
      </div>
      <ChatDrawer />
      <AppModals />
    </div>
  );
}
