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
import { OPENROUTER_CALLBACK_PATH, completeOpenRouterSignIn } from './llm/openrouter';
import { useChatStore } from './store/chatStore';

type Route =
  | { kind: 'landing' }
  | { kind: 'app' }
  | { kind: 'login' }
  | { kind: 'shared' }
  | { kind: 'oauth-callback' }
  | { kind: 'openrouter-callback' }
  | { kind: 'legacy-share-redirect'; token: string }
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

function detectRoute(): Route {
  const path = window.location.pathname;
  if (path === OPENROUTER_CALLBACK_PATH) return { kind: 'openrouter-callback' };
  if (path === '/auth/callback') return { kind: 'oauth-callback' };
  if (path === '/shared') return { kind: 'shared' };
  const legacyShare = path.match(/^\/share\/([0-9a-f]{64})$/i);
  if (legacyShare) return { kind: 'legacy-share-redirect', token: legacyShare[1] };
  if (path.startsWith('/app')) return { kind: 'app' };
  return { kind: 'landing' };
}

interface LegacyShareMap { [token: string]: { provider: 'google' | 'github'; id: string } }

async function resolveLegacyShare(token: string): Promise<Route> {
  try {
    const res = await fetch('/legacy-shares.json');
    if (!res.ok) return { kind: 'error', message: 'Share link not found' };
    const map = (await res.json()) as LegacyShareMap;
    const entry = map[token];
    if (!entry) return { kind: 'error', message: 'Share link not found' };
    window.history.replaceState({}, '', `/shared#provider=${entry.provider}&id=${entry.id}`);
    return { kind: 'shared' };
  } catch {
    return { kind: 'error', message: 'Share link not found' };
  }
}

function App() {
  const [route, setRoute] = useState<Route>(() => detectRoute());
  const [showLanding, setShowLanding] = useState(route.kind === 'landing');
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checked = useAuthStore((s) => s.checked);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const completeOAuthCallback = useAuthStore((s) => s.completeOAuthCallback);

  useEffect(() => { void checkAuth(); }, [checkAuth]);

  useEffect(() => {
    if (route.kind === 'oauth-callback') {
      completeOAuthCallback()
        .then(() => {
          window.history.replaceState({}, '', '/app');
          setRoute({ kind: 'app' });
          setShowLanding(false);
        })
        .catch((err: unknown) => {
          setRoute({ kind: 'error', message: err instanceof Error ? err.message : 'Sign-in failed' });
        });
    } else if (route.kind === 'openrouter-callback') {
      // Distinct from the storage sign-in above: this exchanges a PKCE code
      // for the user's own OpenRouter key and stores it as the chat
      // credential. It does not touch the storage-provider session.
      completeOpenRouterSignIn()
        .then(({ apiKey, returnTo }) => {
          useChatStore.getState().setApiConfig({ provider: 'openrouter', apiKey });
          window.history.replaceState({}, '', returnTo);
          setRoute({ kind: 'app' });
          setShowLanding(false);
        })
        .catch((err: unknown) => {
          setRoute({ kind: 'error', message: err instanceof Error ? err.message : 'OpenRouter sign-in failed' });
        });
    } else if (route.kind === 'legacy-share-redirect') {
      void resolveLegacyShare(route.token).then(setRoute);
    }
  }, [route, completeOAuthCallback]);

  useEffect(() => {
    const handler = () => {
      window.history.replaceState({}, '', '/');
      setRoute({ kind: 'landing' });
      setShowLanding(true);
    };
    window.addEventListener('show-landing', handler);
    return () => window.removeEventListener('show-landing', handler);
  }, []);

  let content;
  if (route.kind === 'error') {
    content = (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-deep)' }}>
        <div className="text-center">
          <div className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>{route.message}</div>
          <a href="/" className="text-sm underline" style={{ color: 'var(--accent)' }}>Go to Sinter</a>
        </div>
      </div>
    );
  } else if (route.kind === 'oauth-callback' || route.kind === 'openrouter-callback' || route.kind === 'legacy-share-redirect' || route.kind === 'loading') {
    content = (
      <div className="h-full flex items-center justify-center bg-zinc-900">
        <div className="text-zinc-400 text-sm">Loading...</div>
      </div>
    );
  } else if (route.kind === 'shared') {
    content = <SharedViewer onOpenEditor={() => setRoute({ kind: 'app' })} />;
  } else if (showLanding) {
    content = <LandingPage onLaunch={() => { localStorage.setItem('sinter_launched', '1'); setShowLanding(false); setRoute({ kind: 'app' }); }} />;
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

export default App;
