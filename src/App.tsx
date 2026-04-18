import { useEffect, useState } from 'react';
import { NodeTreePanel, NodeTreeContent } from './components/tree/NodeTreePanel';
import { Viewport } from './components/viewport/Viewport';
import { PropertyPanel, PropertyContent } from './components/properties/PropertyPanel';
import { Toolbar } from './components/toolbar/Toolbar';
import { ChatDrawer } from './components/chat/ChatDrawer';
import { MobilePanel } from './components/mobile/MobilePanel';
import { BottomSheet } from './components/mobile/BottomSheet';
import { LoginPage } from './components/auth/LoginPage';
import { LandingPage } from './components/landing/LandingPage';
import { SharedViewer } from './components/share/SharedViewer';
import { CookieConsent } from './components/ui/CookieConsent';
import { useEvaluator } from './engine/useEvaluator';
import { useModelerStore } from './store/modelerStore';
import { useViewportStore } from './store/viewportStore';
import { useAuthStore } from './store/authStore';
import { startAutoSave } from './store/projectStore';
import { startLocalAutoSave } from './store/localPersist';
import { AppModals } from './components/ui/AppModals';

function App() {
  const hasAppPath = window.location.pathname.startsWith('/app');
  const initialShareMatch = window.location.pathname.match(/^\/share\/([0-9a-f]{64})$/i);
  const [shareToken, setShareToken] = useState<string | null>(initialShareMatch ? initialShareMatch[1] : null);
  const [showLanding, setShowLanding] = useState(!hasAppPath && !initialShareMatch);
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checked = useAuthStore((s) => s.checked);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const handler = () => setShowLanding(true);
    window.addEventListener('show-landing', handler);
    return () => window.removeEventListener('show-landing', handler);
  }, []);

  const hasConsent = !!localStorage.getItem('sinter_cookie_consent');

  let content;

  if (shareToken) {
    content = <SharedViewer token={shareToken} onOpenEditor={() => setShareToken(null)} />;
  } else if (showLanding || !hasConsent) {
    content = <LandingPage onLaunch={() => { localStorage.setItem('sinter_launched', '1'); setShowLanding(false); }} />;
  } else if (!localStorage.getItem('sinter_launched') && (loading || !checked)) {
    content = (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <div className="text-zinc-400 text-sm">Loading...</div>
      </div>
    );
  } else if (!localStorage.getItem('sinter_launched') && !user) {
    content = <LoginPage />;
  } else {
    content = <ModelerApp />;
  }

  return (
    <>
      {content}
      <CookieConsent />
    </>
  );
}

function ModelerApp() {
  useEvaluator();
  const [mobilePanel, setMobilePanel] = useState<'tree' | 'props' | null>(null);

  useEffect(() => {
    startAutoSave();
    startLocalAutoSave();
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
      <Toolbar onMobileTree={() => setMobilePanel((p) => p === 'tree' ? null : 'tree')} onMobileProps={() => setMobilePanel((p) => p === 'props' ? null : 'props')} />
      <div className="flex flex-1 min-h-0">
        <NodeTreePanel />
        <Viewport />
        <PropertyPanel />
      </div>
      <ChatDrawer />
      <AppModals />

      {/* Mobile overlays */}
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

export default App;
