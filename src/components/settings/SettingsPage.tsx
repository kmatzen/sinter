import { useState, useEffect } from 'react';
import { useAuthStore } from '../../store/authStore';
import { features } from '../../config';
import { useModalStore } from '../../store/modalStore';

interface BillingStatus {
  credits: number;
  packs: { id: string; credits: number; label: string }[];
  storage: { projectCount: number; usedMB: number; allocationMB: number; expiresAt: string | null; gracePeriodStart: string | null; gracePeriodDays: number };
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    if (!features.billing) return;
    fetch('/api/billing/status', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then(setStatus);
  }, []);

  async function handleAllocateStorage(credits: number) {
    try {
      const res = await fetch('/api/billing/allocate-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ credits }),
      });
      const data = await res.json();
      if (!res.ok) { useModalStore.getState().showToast(data.error || 'Failed'); return; }
      // Refetch status
      fetch('/api/billing/status', { credentials: 'include' })
        .then((r) => r.ok ? r.json() : null)
        .then(setStatus);
      window.dispatchEvent(new Event('credits-updated'));
    } catch { /* */ }
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
      if (data.url) window.location.href = data.url;
    } catch { /* */ }
    setPurchasing(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}
         onClick={onClose}>
      <div className="w-[520px] max-h-[80vh] overflow-y-auto rounded-lg" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
           onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="font-mono text-[11px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>Settings</span>
          <button onClick={onClose} className="text-sm" style={{ color: 'var(--text-muted)' }}>{'\u2715'}</button>
        </div>

        <div className="px-6 py-5 space-y-8">
          {/* Account */}
          {features.auth && user && (
            <div>
              <SectionLabel>Account</SectionLabel>
              <div className="flex items-center gap-3 mb-4">
                {user.avatar_url && !avatarFailed ? (
                  <img src={user.avatar_url} alt="" className="w-10 h-10 rounded-full"
                       onError={() => setAvatarFailed(true)} />
                ) : (
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                       style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
                    {user.name?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
                <div>
                  <div className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{user.name}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{user.email}</div>
                </div>
              </div>
              <button onClick={logout}
                      className="text-xs px-3 py-1.5 rounded"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                Sign Out
              </button>
            </div>
          )}

          {/* Credits */}
          {features.billing && (
            <div>
              <SectionLabel>AI Credits</SectionLabel>
              <div className="p-4 rounded-lg mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {status?.credits ?? '—'}
                  </span>
                  <span className="text-sm" style={{ color: 'var(--text-muted)' }}>credits remaining</span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  AI chat costs vary by message length (typically 1–10 credits). Credits expire 30 days after purchase.
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Buy more credits</p>
                {status?.packs.map((pack) => (
                  <button
                    key={pack.id}
                    onClick={() => handleBuy(pack.id)}
                    disabled={purchasing}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-lg disabled:opacity-50"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
                    onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-default)'}
                    onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                  >
                    <span>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{pack.label}</span>
                      <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
                        (${(pack.credits <= 100 ? 5 : pack.credits <= 500 ? 20 : 35)})
                      </span>
                    </span>
                    <span className="text-xs font-mono" style={{ color: 'var(--accent)' }}>Buy &rarr;</span>
                  </button>
                ))}
                {(!status?.packs || status.packs.length === 0) && (
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Credit packs not available yet.</p>
                )}
              </div>
            </div>
          )}

          {/* Storage */}
          {features.cloudStorage && (
            <div>
              <SectionLabel>Cloud Storage</SectionLabel>
              <div className="p-4 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {status?.storage?.projectCount ?? 0} projects
                  </span>
                  <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                    {(status?.storage?.usedMB ?? 0).toFixed(1)} / {status?.storage?.allocationMB ?? 0} MB
                  </span>
                </div>
                {(status?.storage?.allocationMB ?? 0) > 0 && (
                  <div className="w-full h-1.5 rounded-full overflow-hidden mb-3" style={{ background: 'var(--bg-elevated)' }}>
                    <div className="h-full rounded-full" style={{
                      background: 'var(--accent)',
                      width: `${Math.min(100, ((status?.storage?.usedMB ?? 0) / (status?.storage?.allocationMB || 1)) * 100)}%`,
                    }} />
                  </div>
                )}
                {status?.storage?.expiresAt && (
                  <div className="flex items-center justify-between py-2 px-3 rounded mb-3"
                       style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Expires</span>
                    <span className="font-mono text-xs" style={{ color: 'var(--text-primary)' }}>
                      {new Date(status.storage.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  </div>
                )}
                {status?.storage?.gracePeriodStart && (
                  <div className="py-2 px-3 rounded mb-3"
                       style={{ background: 'rgba(212,90,90,0.15)', border: '1px solid rgba(212,90,90,0.3)' }}>
                    <p className="text-xs font-medium" style={{ color: 'var(--accent-red)' }}>
                      Storage expired — renew within {
                        Math.max(0, 30 - Math.floor((Date.now() - new Date(status.storage.gracePeriodStart).getTime()) / 86400000))
                      } days or projects will be deleted. Download them now with "To Local" in the project list.
                    </p>
                  </div>
                )}

                {/* Allocate storage */}
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Allocate credits for storage (1 credit = 100MB for 30 days)
                  </p>
                  <div className="flex gap-2">
                    {[1, 5, 10].map((amt) => (
                      <button key={amt} onClick={() => handleAllocateStorage(amt)}
                              className="flex-1 py-2 rounded text-xs font-medium"
                              style={{ background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
                              onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--border-default)'}
                              onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-subtle)'}>
                        {amt} cr &rarr; {amt * 100}MB
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Pricing breakdown */}
          <div>
            <SectionLabel>Pricing</SectionLabel>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
              {[
                { action: 'Modeling tools', cost: 'Free', highlight: true },
                { action: 'STL / 3MF export', cost: 'Free', highlight: true },
                { action: 'AI chat message', cost: '~1–15 cr' },
                { action: 'Cloud storage', cost: '1 cr / 100 MB / 30 days' },
              ].map((item, i) => (
                <div key={item.action}
                     className="flex items-center justify-between px-4 py-2.5"
                     style={{
                       background: i % 2 === 0 ? 'var(--bg-surface)' : 'transparent',
                       borderBottom: i < 4 ? '1px solid var(--border-subtle)' : 'none',
                     }}>
                  <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{item.action}</span>
                  <span className="text-[11px] font-mono"
                        style={{ color: item.highlight ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                    {item.cost}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[10px] tracking-[0.15em] uppercase mb-3" style={{ color: 'var(--text-muted)' }}>
      {children}
    </p>
  );
}
