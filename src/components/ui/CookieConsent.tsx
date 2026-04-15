import { useState, useEffect, useCallback } from 'react';

const CONSENT_KEY = 'sinter_cookie_consent';

export function hasConsent(): boolean {
  return !!localStorage.getItem(CONSENT_KEY);
}

/** Dispatch this event to show the consent modal (e.g. when user clicks Sign In without consent) */
export function requestConsent() {
  window.dispatchEvent(new Event('show-cookie-consent'));
}

export function CookieConsent() {
  const [mode, setMode] = useState<'banner' | 'modal' | null>(null);

  const accept = useCallback(() => {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    document.cookie = `${CONSENT_KEY}=accepted; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
    setMode(null);
    window.dispatchEvent(new Event('cookie-consent-accepted'));
  }, []);

  useEffect(() => {
    if (!localStorage.getItem(CONSENT_KEY)) {
      setMode('banner');
    }
    const handler = () => {
      if (!localStorage.getItem(CONSENT_KEY)) setMode('modal');
    };
    window.addEventListener('show-cookie-consent', handler);
    return () => window.removeEventListener('show-cookie-consent', handler);
  }, []);

  if (!mode) return null;

  if (mode === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
        <div
          className="rounded-lg p-6 max-w-md w-full"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)' }}
        >
          <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Cookie Consent Required</h3>
          <p className="text-[12px] leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
            Sign-in and cloud features require cookies for authentication. By continuing, you agree to our use of cookies. See our{' '}
            <button
              onClick={() => window.dispatchEvent(new Event('show-privacy'))}
              className="underline"
              style={{ color: 'var(--accent)' }}
            >
              Privacy Policy
            </button>.
          </p>
          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setMode('banner')}
              className="px-4 py-1.5 rounded-md text-[12px] font-medium"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            >
              Dismiss
            </button>
            <button
              onClick={accept}
              className="px-4 py-1.5 rounded-md text-[12px] font-medium"
              style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
            >
              Accept & Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Banner mode
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 flex justify-center">
      <div
        className="flex items-center gap-4 px-5 py-3 rounded-lg max-w-xl"
        style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)' }}
      >
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          We use cookies for authentication and to remember your preferences. See our{' '}
          <button
            onClick={() => window.dispatchEvent(new Event('show-privacy'))}
            className="underline"
            style={{ color: 'var(--accent)' }}
          >
            Privacy Policy
          </button>.
        </p>
        <button
          onClick={accept}
          className="shrink-0 px-4 py-1.5 rounded-md text-[12px] font-medium"
          style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
        >
          Accept
        </button>
      </div>
    </div>
  );
}
