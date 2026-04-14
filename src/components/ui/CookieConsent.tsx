import { useState, useEffect } from 'react';

const CONSENT_KEY = 'sinter_cookie_consent';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(CONSENT_KEY)) {
      setVisible(true);
    }
  }, []);

  function accept() {
    localStorage.setItem(CONSENT_KEY, 'accepted');
    // Set a cookie so the server knows consent was given (365 days)
    document.cookie = `${CONSENT_KEY}=accepted; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 flex justify-center">
      <div
        className="flex items-center gap-4 px-5 py-3 rounded-lg max-w-xl"
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-default)',
          boxShadow: 'var(--shadow-lg)',
        }}
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
