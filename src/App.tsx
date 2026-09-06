import { useEffect, useState, lazy, Suspense } from 'react';

/**
 * The editor and the shared-project viewer are loaded on demand.
 *
 * Both pull three.js, which is 477 kB of a 927 kB bundle. A first-time visitor
 * to `/` gets a marketing page, and blocking its first paint on the renderer
 * they have not asked for yet is the single largest thing this bundle was
 * doing wrong.
 */
const ModelerApp = lazy(() => import('./ModelerApp'));
const SharedViewer = lazy(() =>
  import('./components/share/SharedViewer').then((m) => ({ default: m.SharedViewer })),
);

/**
 * Shown while a route's chunk arrives. Deliberately identical to the
 * loading state the OAuth callbacks already render, so a slow network looks
 * like the app is starting rather than like something went wrong.
 */
function RouteFallback() {
  return (
    <div className="h-full flex items-center justify-center bg-zinc-900">
      <div className="text-zinc-400 text-sm">Loading...</div>
    </div>
  );
}
import { LoginPage } from './components/auth/LoginPage';
import { LandingPage } from './components/landing/LandingPage';
import { CookieConsent } from './components/ui/CookieConsent';
import { useAuthStore } from './store/authStore';
import { OPENROUTER_CALLBACK_PATH, completeOpenRouterSignIn } from './llm/openrouter';
import { useChatStore } from './store/chatStore';
import { LegalPage } from './components/legal/LegalPage';

type Route =
  | { kind: 'landing' }
  | { kind: 'app' }
  | { kind: 'login' }
  | { kind: 'shared' }
  | { kind: 'oauth-callback' }
  | { kind: 'openrouter-callback' }
  | { kind: 'legal'; document: 'terms' | 'privacy' }
  | { kind: 'legacy-share-redirect'; token: string }
  | { kind: 'loading' }
  | { kind: 'error'; message: string };

function detectRoute(): Route {
  const path = window.location.pathname;
  if (path === OPENROUTER_CALLBACK_PATH) return { kind: 'openrouter-callback' };
  if (path === '/auth/callback') return { kind: 'oauth-callback' };
  if (path === '/shared') return { kind: 'shared' };
  if (path === '/terms' || path === '/terms/') return { kind: 'legal', document: 'terms' };
  if (path === '/privacy' || path === '/privacy/') return { kind: 'legal', document: 'privacy' };
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
  } else if (route.kind === 'legal') {
    content = <LegalPage kind={route.document} />;
  } else if (route.kind === 'shared') {
    content = <Suspense fallback={<RouteFallback />}><SharedViewer onOpenEditor={() => setRoute({ kind: 'app' })} /></Suspense>;
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
    content = <Suspense fallback={<RouteFallback />}><ModelerApp /></Suspense>;
  }

  return (
    <>
      {content}
      <CookieConsent />
    </>
  );
}

export default App;
