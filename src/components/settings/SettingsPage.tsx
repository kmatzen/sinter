import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [avatarFailed, setAvatarFailed] = useState(false);

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
          {user && (
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
              <div className="flex items-center gap-3 mb-4 p-3 rounded-lg" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Storage: {user.provider === 'github' ? 'GitHub Gists' : 'Google Drive'}
                </span>
              </div>
              <button onClick={logout}
                      className="text-xs px-3 py-1.5 rounded"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                Sign Out
              </button>
            </div>
          )}

          {/* Pricing breakdown */}
          <div>
            <SectionLabel>About</SectionLabel>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
              {[
                { action: 'Modeling tools', cost: 'Free' },
                { action: 'STL / 3MF export', cost: 'Free' },
                { action: 'AI chat', cost: 'BYOK' },
                { action: 'Cloud storage', cost: 'Your account' },
                { action: 'Project sharing', cost: 'Free' },
              ].map((item, i) => (
                <div key={item.action}
                     className="flex items-center justify-between px-4 py-2.5"
                     style={{
                       background: i % 2 === 0 ? 'var(--bg-surface)' : 'transparent',
                       borderBottom: i < 4 ? '1px solid var(--border-subtle)' : 'none',
                     }}>
                  <span className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{item.action}</span>
                  <span className="text-[11px] font-mono" style={{ color: 'var(--accent-green)' }}>
                    {item.cost}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs mt-3 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Your projects are stored in your own {user?.provider === 'github' ? 'GitHub Gists' : 'Google Drive'}.
              AI chat uses your own API key — configure it in the chat panel (gear icon).
            </p>
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
