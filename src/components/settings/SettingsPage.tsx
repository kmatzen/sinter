import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { useChatStore } from '../../store/chatStore';

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [avatarFailed, setAvatarFailed] = useState(false);

  const apiKey = useChatStore((s) => s.apiKey);
  const apiEndpoint = useChatStore((s) => s.apiEndpoint);
  const model = useChatStore((s) => s.model);
  const provider = useChatStore((s) => s.provider);
  const setApiConfig = useChatStore((s) => s.setApiConfig);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}
         onClick={onClose}>
      <div className="w-full max-w-[520px] max-h-[80vh] overflow-y-auto rounded-lg" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
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

          {/* AI Configuration */}
          <div>
            <SectionLabel>AI Configuration</SectionLabel>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] uppercase font-mono tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setApiConfig({ provider: e.target.value as 'openai' | 'anthropic' })}
                  className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiConfig({ apiKey: e.target.value })}
                  placeholder="Enter API key..."
                  className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                />
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Stored in your browser only. Never sent to our servers.
                </p>
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>Model</label>
                <input
                  value={model}
                  onChange={(e) => setApiConfig({ model: e.target.value })}
                  className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase font-mono tracking-wider block mb-1" style={{ color: 'var(--text-muted)' }}>API Endpoint <span style={{ opacity: 0.5 }}>(optional)</span></label>
                <input
                  value={apiEndpoint}
                  onChange={(e) => setApiConfig({ apiEndpoint: e.target.value })}
                  placeholder={provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com'}
                  className="w-full rounded px-2 py-1.5 text-sm focus:outline-none"
                  style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
                />
              </div>
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
