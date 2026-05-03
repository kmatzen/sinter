import { useConsentStore, type ConsentReason } from '../../store/consent';

const COPY: Record<ConsentReason, { title: string; body: string; accept: string }> = {
  signin: {
    title: 'Allow local sign-in storage?',
    body:
      'To sign you in, Sinter stores an OAuth access token in your browser (localStorage). The token is sent only to your storage provider (Google Drive or GitHub) — never to a Sinter server. We do not use analytics, advertising, or third-party trackers.',
    accept: 'Accept & continue',
  },
  local: {
    title: 'Allow browser storage?',
    body:
      'Sinter saves your project, settings, and preferences to your browser (localStorage and IndexedDB) so they persist between visits. Nothing is sent to a Sinter server. We do not use analytics, advertising, or third-party trackers.',
    accept: 'Accept & continue',
  },
  apikey: {
    title: 'Allow browser storage for your API key?',
    body:
      'Your AI API key is stored in your browser (localStorage) and sent only to the AI provider you select. It is never sent to a Sinter server. We do not use analytics, advertising, or third-party trackers.',
    accept: 'Accept & save',
  },
};

export function CookieConsent() {
  const pendingReason = useConsentStore((s) => s.pendingReason);
  const accept = useConsentStore((s) => s.accept);
  const decline = useConsentStore((s) => s.decline);

  if (!pendingReason) return null;
  const copy = COPY[pendingReason];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div
        className="rounded-lg p-6 max-w-md w-full"
        style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)', boxShadow: 'var(--shadow-lg)' }}
      >
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>{copy.title}</h3>
        <p className="text-[12px] leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
          {copy.body}{' '}
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
            onClick={decline}
            className="px-4 py-1.5 rounded-md text-[12px] font-medium"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            Cancel
          </button>
          <button
            onClick={accept}
            className="px-4 py-1.5 rounded-md text-[12px] font-medium"
            style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
          >
            {copy.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
