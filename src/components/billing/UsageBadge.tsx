import { useState, useEffect, useRef } from 'react';
import { features } from '../../config';
import { useModalStore } from '../../store/modalStore';
import { Coins } from 'lucide-react';

interface CreditPack {
  id: string;
  credits: number;
  label: string;
}

interface BillingStatus {
  credits: number;
  creditsExpireAt: string | null;
  packs: CreditPack[];
}

export function UsageBadge() {
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [showPacks, setShowPacks] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!features.billing) return;
    fetchStatus();
    const handler = () => fetchStatus();
    window.addEventListener('credits-updated', handler);
    return () => window.removeEventListener('credits-updated', handler);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showPacks) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowPacks(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPacks]);

  function fetchStatus() {
    fetch('/api/billing/status', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then(setStatus)
      .catch(() => {});
  }

  async function handleBuy(packId: string) {
    setPurchasing(true);
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ packId }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        useModalStore.getState().showToast(data.error || 'Failed to start checkout');
      }
    } catch {
      useModalStore.getState().showToast('Failed to connect to billing service');
    }
    setPurchasing(false);
  }

  if (!features.billing || !status) return null;

  const low = status.credits <= 10;
  const empty = status.credits <= 0;
  const expiryLabel = status.creditsExpireAt
    ? `Expires ${new Date(status.creditsExpireAt).toLocaleDateString()}`
    : '';
  const tooltip = empty
    ? 'No credits — click to purchase'
    : `${status.credits} credits remaining${expiryLabel ? ` (${expiryLabel})` : ''}`;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowPacks(!showPacks)}
        title={tooltip}
        aria-label={tooltip}
        aria-expanded={showPacks}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors"
        style={{
          background: empty ? 'rgba(212,90,90,0.15)' : 'var(--bg-elevated)',
          color: empty ? 'var(--accent-red)' : low ? '#d4a04a' : 'var(--text-secondary)',
          border: `1px solid ${empty ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
        }}
        onMouseEnter={(e) => { if (!empty) e.currentTarget.style.borderColor = 'var(--border-default)'; }}
        onMouseLeave={(e) => { if (!empty) e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
      >
        <Coins size={12} />
        {status.credits}
      </button>

      {showPacks && (
        <div
          className="absolute top-9 right-0 rounded-lg p-3 z-50 w-52"
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-default)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <div className="text-[10px] font-mono tracking-[0.1em] uppercase mb-2" style={{ color: 'var(--text-muted)' }}>
            Buy Credits
          </div>
          {empty && (
            <p className="text-[10px] mb-2" style={{ color: '#d4a04a' }}>
              Purchase credits to continue using AI chat.
            </p>
          )}
          <div className="flex flex-col gap-1">
            {status.packs.map((pack) => (
              <button
                key={pack.id}
                onClick={() => handleBuy(pack.id)}
                disabled={purchasing}
                className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-[11px] disabled:opacity-40 transition-colors"
                style={{
                  background: 'var(--bg-surface)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <span>{pack.label}</span>
                <span style={{ color: 'var(--accent)' }}>&rarr;</span>
              </button>
            ))}
          </div>
          {status.packs.length === 0 && (
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Credit packs not configured.</p>
          )}
        </div>
      )}
    </div>
  );
}
