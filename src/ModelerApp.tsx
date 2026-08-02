import { useEffect, useState } from 'react';
import { NodeTreePanel, NodeTreeContent } from './components/tree/NodeTreePanel';
import { Viewport } from './components/viewport/Viewport';
import { PropertyPanel, PropertyContent } from './components/properties/PropertyPanel';
import { Toolbar } from './components/toolbar/Toolbar';
import { ChatDrawer } from './components/chat/ChatDrawer';
import { MobilePanel } from './components/mobile/MobilePanel';
import { BottomSheet } from './components/mobile/BottomSheet';
import { useEvaluator } from './engine/useEvaluator';
import { useModelerStore } from './store/modelerStore';
import { useViewportStore } from './store/viewportStore';
import { startAutoSave } from './store/projectStore';
import { startLocalAutoSave } from './store/localPersist';
import { AppModals } from './components/ui/AppModals';

/**
 * The editor, in its own module so it can be loaded on demand.
 *
 * Everything three.js reaches this app through here and through the landing
 * page's hero — 477 kB of the 927 kB bundle, half of it — and a first-time
 * visitor to `/` sees a marketing page before any of it matters. Keeping this
 * a separate chunk is what lets the landing page paint without it.
 */

function isMobile() {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

function ModelerApp() {
  useEvaluator();
  const [mobilePanel, setMobilePanel] = useState<'tree' | 'props' | null>(null);

  useEffect(() => {
    let prev = useModelerStore.getState().selectedNodeId;
    const unsub = useModelerStore.subscribe(() => {
      const curr = useModelerStore.getState().selectedNodeId;
      if (curr && curr !== prev && isMobile()) setMobilePanel('props');
      prev = curr;
    });
    return unsub;
  }, []);

  useEffect(() => {
    startAutoSave();
    startLocalAutoSave();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
      <Toolbar onMobileTree={() => setMobilePanel((p) => p === 'tree' ? null : 'tree')} onMobileProps={() => setMobilePanel((p) => p === 'props' ? null : 'props')} />
      <div className="flex flex-1 min-h-0">
        <NodeTreePanel />
        <Viewport />
        <PropertyPanel />
      </div>
      <ChatDrawer />
      <AppModals />

      {mobilePanel === 'tree' && (
        <MobilePanel title="Node Tree" side="left" onClose={() => setMobilePanel(null)}>
          <div className="flex flex-col h-full">
            <NodeTreeContent />
          </div>
        </MobilePanel>
      )}
      {mobilePanel === 'props' && (
        <BottomSheet onClose={() => setMobilePanel(null)}>
          <PropertyContent />
        </BottomSheet>
      )}
    </div>
  );
}

export default ModelerApp;
