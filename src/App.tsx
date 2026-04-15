import { useEffect, useState, lazy, Suspense } from 'react';
import { LoginPage } from './components/auth/LoginPage';
import { CookieConsent } from './components/ui/CookieConsent';
import { useAuthStore } from './store/authStore';
import { features } from './config';

// Lazy load heavy components — landing page visitors don't need Three.js
const LandingPage = lazy(() => import('./components/landing/LandingPage').then(m => ({ default: m.LandingPage })));
const SharedViewer = lazy(() => import('./components/share/SharedViewer').then(m => ({ default: m.SharedViewer })));
const ModelerApp = lazy(() => import('./ModelerApp').then(m => ({ default: m.ModelerApp })));

function App() {
  const hasAppPath = window.location.pathname.startsWith('/app');
  const hasBillingReturn = new URLSearchParams(window.location.search).has('session_id');
  const initialShareMatch = window.location.pathname.match(/^\/share\/([0-9a-f]{64})$/i);
  const [shareToken, setShareToken] = useState<string | null>(initialShareMatch ? initialShareMatch[1] : null);
  const [showLanding, setShowLanding] = useState(!hasAppPath && !hasBillingReturn && !initialShareMatch);
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);
  const checked = useAuthStore((s) => s.checked);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  useEffect(() => {
    if (features.auth) {
      checkAuth();
    }
  }, [checkAuth]);

  useEffect(() => {
    const handler = () => setShowLanding(true);
    window.addEventListener('show-landing', handler);
    return () => window.removeEventListener('show-landing', handler);
  }, []);

  const fallback = (
    <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-deep)' }}>
      <div className="w-8 h-8 border-2 rounded-full animate-spin"
           style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  let content;

  if (shareToken) {
    content = <SharedViewer token={shareToken} onOpenEditor={() => setShareToken(null)} />;
  } else if (showLanding) {
    content = <LandingPage onLaunch={() => { localStorage.setItem('sinter_launched', '1'); setShowLanding(false); }} />;
  } else if (features.auth && !localStorage.getItem('sinter_launched') && (loading || !checked)) {
    content = fallback;
  } else if (features.auth && !localStorage.getItem('sinter_launched') && !user) {
    content = <LoginPage />;
  } else {
    content = <ModelerApp />;
  }

  return (
    <Suspense fallback={fallback}>
      {content}
      <CookieConsent />
    </Suspense>
  );
}

export default App;
