import { useState, useEffect } from 'react';
import { features } from '../../config';
import { triggerDownload } from '../../utils/download';
import { useModalStore } from '../../store/modalStore';

interface CloudProject {
  id: string;
  name: string;
  thumbnail: string | null;
  created_at: string;
  updated_at: string;
  source: 'cloud';
}

interface LocalProject {
  id: string;
  name: string;
  thumbnail: null;
  updated_at: string;
  source: 'local';
}


interface Props {
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
  onImport?: () => void;
}

const LOCAL_PROJECTS_KEY = 'sinter_local_projects';

function getLocalProjects(): LocalProject[] {
  try {
    const raw = localStorage.getItem(LOCAL_PROJECTS_KEY);
    if (raw) return JSON.parse(raw);
    // Check for legacy single-project format
    const legacy = localStorage.getItem('sinter_local_project');
    if (legacy) {
      const data = JSON.parse(legacy);
      return [{
        id: 'local_default',
        name: data.projectName || 'Untitled',
        thumbnail: null,
        updated_at: new Date().toISOString(),
        source: 'local',
      }];
    }
  } catch { /* */ }
  return [];
}

export function ProjectList({ onSelect, onNew, onClose, onImport }: Props) {
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([]);
  const [localProjectList, setLocalProjectList] = useState<LocalProject[]>(getLocalProjects());
  const [loading, setLoading] = useState(features.cloudStorage);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!features.cloudStorage) { setLoading(false); return; }
    fetch('/api/projects', { credentials: 'include' })
      .then((r) => r.json())
      .then((data) => {
        setCloudProjects(data.map((p: any) => ({ ...p, source: 'cloud' })));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  const handleDeleteCloud = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    useModalStore.getState().showConfirm('Delete this cloud project? This cannot be undone.', async () => {
      await fetch(`/api/projects/${id}`, { method: 'DELETE', credentials: 'include' });
      setCloudProjects((p) => p.filter((x) => x.id !== id));
      showToast('Deleted from cloud');
    });
  };

  const handleDeleteLocal = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (id === 'local_default') {
      localStorage.removeItem('sinter_local_project');
    }
    setLocalProjectList(getLocalProjects());
    showToast('Deleted from browser');
  };

  const handleDownloadCloud = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/projects/${id}`, { credentials: 'include' });
      const data = await res.json();
      const json = JSON.stringify({ projectName: data.name, tree: data.tree_json }, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      triggerDownload(blob, `${name}.json`);
    } catch { /* */ }
  };

  const handleMoveToLocal = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/projects/${id}`, { credentials: 'include' });
      const data = await res.json();
      const json = JSON.stringify({ projectName: data.name, tree: data.tree_json });
      localStorage.setItem('sinter_local_project', json);
      // Delete from cloud
      await fetch(`/api/projects/${id}`, { method: 'DELETE', credentials: 'include' });
      setCloudProjects((prev) => prev.filter((p) => p.id !== id));
      setLocalProjectList(getLocalProjects());
      showToast(`Moved "${data.name}" to browser`);
    } catch {
      showToast('Failed to move');
    }
  };

  const handleMoveToCloud = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const legacy = localStorage.getItem('sinter_local_project');
    if (!legacy) return;
    let data: any;
    try { data = JSON.parse(legacy); } catch { return; }
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: data.projectName || 'Untitled', tree_json: data.tree }),
      });
      if (!res.ok) {
        const err = await res.json();
        showToast(err.error || 'Move failed');
        return;
      }
      const result = await res.json();
      // Remove from local
      localStorage.removeItem('sinter_local_project');
      setLocalProjectList(getLocalProjects());
      setCloudProjects((prev) => [{
        id: result.id,
        name: data.projectName || 'Untitled',
        thumbnail: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        source: 'cloud',
      }, ...prev]);
      showToast(`Moved "${data.projectName || 'Untitled'}" to cloud`);
    } catch {
      showToast('Move failed — storage allocation may be required');
    }
  };

  const formatDate = (d: string) => {
    try { return new Date(d.includes('Z') ? d : d + 'Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return d; }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-[520px] max-h-[75vh] flex flex-col rounded-lg"
           style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
           onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="font-mono text-[11px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>Projects</span>
          <div className="flex gap-2">
            {onImport && (
              <button onClick={onImport} className="text-[11px] px-2.5 py-1 rounded font-medium"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                Import File
              </button>
            )}
            <button onClick={onNew} className="text-[11px] px-2.5 py-1 rounded font-medium"
                    style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
              + New Project
            </button>
            <button onClick={onClose} className="text-sm ml-1" style={{ color: 'var(--text-muted)' }}>{'\u2715'}</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && <div className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Loading...</div>}

          {/* Local projects */}
          {localProjectList.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 px-2 mb-2">
                <span className="font-mono text-[9px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>Local (Browser)</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              </div>
              {localProjectList.map((p) => (
                <div key={p.id}
                     onClick={() => { onSelect(p.id); }}
                     className="flex items-center gap-3 px-3 py-2.5 rounded cursor-pointer group"
                     style={{ background: 'transparent' }}
                     onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                     onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <div className="w-10 h-10 rounded flex items-center justify-center text-xs shrink-0"
                       style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>3D</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Stored in browser &middot; {formatDate(p.updated_at)}</div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {features.cloudStorage && (
                      <button onClick={handleMoveToCloud}
                              className="text-[11px] px-2 py-1 rounded flex items-center gap-1"
                              style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                              title="Move to cloud storage">
                        <span>&#x2191;</span> Cloud
                      </button>
                    )}
                    <button onClick={(e) => handleDeleteLocal(p.id, e)}
                            className="text-[11px] px-2 py-1 rounded"
                            style={{ color: 'var(--accent-red)' }}
                            title="Delete from browser">
                      &#x2715;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Cloud projects */}
          {features.cloudStorage && (
            <div>
              <div className="flex items-center gap-2 px-2 mb-2">
                <span className="font-mono text-[9px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>Cloud</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              </div>
              {!loading && cloudProjects.length === 0 && (
                <div className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>
                  No cloud projects. Save requires credits.
                </div>
              )}
              {cloudProjects.map((p) => (
                <div key={p.id}
                     onClick={() => onSelect(p.id)}
                     className="flex items-center gap-3 px-3 py-2.5 rounded cursor-pointer group"
                     style={{ background: 'transparent' }}
                     onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                     onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  {p.thumbnail ? (
                    <img src={p.thumbnail} alt="" className="w-10 h-10 rounded object-cover shrink-0" style={{ background: 'var(--bg-elevated)' }} />
                  ) : (
                    <div className="w-10 h-10 rounded flex items-center justify-center text-xs shrink-0"
                         style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>3D</div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Cloud &middot; {formatDate(p.updated_at)}</div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => handleMoveToLocal(p.id, e)}
                            className="text-[11px] px-2 py-1 rounded flex items-center gap-1"
                            style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                            title="Move to browser storage">
                      <span>&#x2193;</span> Local
                    </button>
                    <button onClick={(e) => handleDownloadCloud(p.id, p.name, e)}
                            className="text-[11px] px-2 py-1 rounded flex items-center gap-1"
                            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                            title="Download as .json file">
                      <span>&#x21E9;</span> File
                    </button>
                    <button onClick={(e) => handleDeleteCloud(p.id, e)}
                            className="text-[11px] px-2 py-1 rounded"
                            style={{ color: 'var(--accent-red)' }}
                            title="Delete from cloud">
                      &#x2715;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="px-5 py-2.5 text-xs font-medium text-center"
               style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
