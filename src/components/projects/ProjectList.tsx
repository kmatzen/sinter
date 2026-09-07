import { useState, useEffect, useRef } from 'react';
import { triggerDownload } from '../../utils/download';
import { useModalStore } from '../../store/modalStore';
import { useAuthStore, getCurrentProvider } from '../../store/authStore';
import { useProjectStore, deleteCloudProject, loadThumbnail, requestDocumentReplacement } from '../../store/projectStore';
import { getStorageProvider, type ProviderName, type ProjectMeta } from '../../storage';
import { deleteLocalBackup, readLocalBackupJSON, useLocalBackupStore, writeLocalBackupJSON } from '../../store/localPersist';
import { encodeTransferredProject, moveCloudProjectToLocal } from '../../storage/projectTransfer';
import { decodeProjectDocument } from '../../types/documentDecoder';
import { useDialogFocus } from '../ui/useDialogFocus';

interface CloudProject extends ProjectMeta {
  source: 'cloud';
  provider: ProviderName;
  thumbnail: string | null;
}

interface LocalProject {
  id: string;
  name: string;
  thumbnail: null;
  updated_at: string;
  source: 'local';
}

interface Props {
  onClose: () => void;
  onLoaded: () => void;
  onImport?: () => void;
}

async function getLocalProjects(): Promise<LocalProject[]> {
  const json = await readLocalBackupJSON();
  if (!json) return [];
  try {
    const data = decodeProjectDocument(JSON.parse(json));
    return [{
      id: 'local_default',
      name: data.projectName || 'Untitled',
      thumbnail: null,
      updated_at: useLocalBackupStore.getState().lastSavedAt ?? new Date().toISOString(),
      source: 'local',
    }];
  } catch {
    return [];
  }
}

export function ProjectList({ onClose, onLoaded, onImport }: Props) {
  const [cloudProjects, setCloudProjects] = useState<CloudProject[]>([]);
  const [localProjectList, setLocalProjectList] = useState<LocalProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const user = useAuthStore((s) => s.user);
  const loadProject = useProjectStore((s) => s.loadProject);
  const createProject = useProjectStore((s) => s.createProject);
  const loadLocalDocument = useProjectStore((s) => s.loadLocalDocument);
  const surface = useRef<HTMLDivElement>(null);
  useDialogFocus(surface, onClose);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function loadCloud() {
      const provider = getCurrentProvider();
      if (!provider) {
        setLoading(false);
        return;
      }
      try {
        const accessToken = await useAuthStore.getState().getAccessToken();
        const storage = getStorageProvider(provider);
        const list = await storage.list(accessToken, controller.signal);
        if (cancelled) return;
        const withThumbs: CloudProject[] = await Promise.all(
          list.map(async (p) => ({
            ...p,
            source: 'cloud' as const,
            provider,
            thumbnail: await loadThumbnail(provider, p.externalId),
          })),
        );
        if (!cancelled) setCloudProjects(withThumbs);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('Failed to list cloud projects:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCloud();
    return () => { cancelled = true; controller.abort(); };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    void getLocalProjects().then((projects) => { if (!cancelled) setLocalProjectList(projects); });
    return () => { cancelled = true; };
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }

  const selectCloud = (p: CloudProject) => requestDocumentReplacement(async () => {
    try {
      await loadProject(p.provider, p.externalId, p.name);
      onLoaded();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Failed to load');
    }
  });

  const selectLocal = (_p: LocalProject) => requestDocumentReplacement(async () => {
    // Local project is already loaded by startLocalAutoSave on app boot.
    // Selecting it just clears any cloud project state.
    try {
      const raw = await readLocalBackupJSON();
      if (raw) {
        const data = decodeProjectDocument(JSON.parse(raw));
        loadLocalDocument(data.projectName || 'Untitled', data.tree, data.parameters, data.views, data.measurements, data.units, data.components);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Local backup could not be opened');
      return;
    }
    onLoaded();
  });

  const handleDeleteCloud = (p: CloudProject, e: React.MouseEvent) => {
    e.stopPropagation();
    useModalStore.getState().showConfirm(
      `Delete "${p.name}" from your ${p.provider === 'google' ? 'Drive' : 'Gists'}? This cannot be undone.`,
      async () => {
        try {
          await deleteCloudProject(p.provider, p.externalId);
          setCloudProjects((prev) => prev.filter((x) => x.externalId !== p.externalId));
          showToast(`Deleted "${p.name}"`);
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : 'Delete failed');
        }
      },
    );
  };

  const handleDeleteLocal = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (id === 'local_default') await deleteLocalBackup();
      setLocalProjectList(await getLocalProjects());
      showToast('Deleted from browser');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Local delete failed');
    }
  };

  const handleDownloadCloud = async (p: CloudProject, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const accessToken = await useAuthStore.getState().getAccessToken();
      const body = await getStorageProvider(p.provider).read(accessToken, p.externalId);
      const json = encodeTransferredProject(p.name, body, true);
      triggerDownload(new Blob([json], { type: 'application/json' }), `${p.name}.json`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const moveToLocal = async (p: CloudProject, replaceExisting: boolean) => {
    try {
      const result = await moveCloudProjectToLocal({
        destination: {
          read: readLocalBackupJSON,
          write: writeLocalBackupJSON,
          clear: deleteLocalBackup,
        },
        projectName: p.name,
        replaceExisting,
        readSource: async () => {
          const accessToken = await useAuthStore.getState().getAccessToken();
          return getStorageProvider(p.provider).read(accessToken, p.externalId);
        },
        deleteSource: () => deleteCloudProject(p.provider, p.externalId),
      });
      if (result.status === 'moved') setCloudProjects((prev) => prev.filter((x) => x.externalId !== p.externalId));
      setLocalProjectList(await getLocalProjects());
      showToast(result.status === 'moved'
        ? `Moved "${p.name}" to browser`
        : `Copied "${p.name}" to browser; cloud deletion failed, so both copies were kept`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Move failed');
    }
  };

  const handleMoveToLocal = async (p: CloudProject, e: React.MouseEvent) => {
    e.stopPropagation();
    if (await readLocalBackupJSON() !== null) {
      useModalStore.getState().showConfirm(
        `Replace the existing browser project with "${p.name}"? The current browser project will be overwritten.`,
        () => { void moveToLocal(p, true); },
      );
      return;
    }
    void moveToLocal(p, false);
  };

  const handleMoveToCloud = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const provider = getCurrentProvider();
    if (!provider) {
      showToast('Sign in to enable cloud storage');
      return;
    }
    const legacy = await readLocalBackupJSON();
    if (!legacy) return;
    let data;
    try { data = decodeProjectDocument(JSON.parse(legacy)); } catch { return; }
    try {
      const accessToken = await useAuthStore.getState().getAccessToken();
      const storage = getStorageProvider(provider);
      const name = data.projectName || 'Untitled';
      const result = await storage.create(accessToken, name, {
        version: 2,
        thumbnail: data.thumbnail,
        tree: data.tree ?? null,
        checkpoints: data.checkpoints,
        parameters: data.parameters,
        views: data.views,
        measurements: data.measurements,
      });
      await deleteLocalBackup();
      setLocalProjectList(await getLocalProjects());
      setCloudProjects((prev) => [
        {
          externalId: result.externalId,
          name,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: 'cloud',
          provider,
          thumbnail: null,
        },
        ...prev,
      ]);
      showToast(`Moved "${name}" to cloud`);
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Move failed');
    }
  };

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    } catch { return d; }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div ref={surface} role="dialog" aria-modal="true" aria-labelledby="projects-title" className="w-[520px] max-h-[75vh] flex flex-col rounded-lg"
           style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
           onClick={(e) => e.stopPropagation()}>

        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span id="projects-title" className="font-mono text-[11px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>Projects</span>
          <div className="flex gap-2">
            {onImport && (
              <button onClick={onImport} className="text-[11px] px-2.5 py-1 rounded font-medium"
                      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
                Import File
              </button>
            )}
            <button onClick={() => requestDocumentReplacement(() => { createProject(); onLoaded(); })} className="text-[11px] px-2.5 py-1 rounded font-medium"
                    style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
              + New Project
            </button>
            <button onClick={onClose} aria-label="Close projects" className="text-sm ml-1" style={{ color: 'var(--text-muted)' }}>{'✕'}</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && <div className="text-sm text-center py-8" style={{ color: 'var(--text-muted)' }}>Loading...</div>}

          {localProjectList.length > 0 && (
            <div className="mb-4">
              <div className="flex items-center gap-2 px-2 mb-2">
                <span className="font-mono text-[9px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>Local (Browser)</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
              </div>
              {localProjectList.map((p) => (
                <div key={p.id}
                     className="flex items-center gap-3 px-3 py-2.5 rounded cursor-pointer group"
                     style={{ background: 'transparent' }}
                     onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                     onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <button onClick={() => selectLocal(p)} aria-label={`Open ${p.name} from browser storage`} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                  <div className="w-10 h-10 rounded flex items-center justify-center text-xs shrink-0"
                       style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>3D</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                    <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Stored in browser &middot; {formatDate(p.updated_at)}</div>
                  </div>
                  </button>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                    {user && (
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

          <div>
            <div className="flex items-center gap-2 px-2 mb-2">
              <span className="font-mono text-[9px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>Cloud</span>
              <div className="flex-1 h-px" style={{ background: 'var(--border-subtle)' }} />
            </div>
            {!loading && cloudProjects.length === 0 && (
              <div className="text-xs text-center py-4" style={{ color: 'var(--text-muted)' }}>
                {user ? 'No cloud projects yet. Save one to get started.' : 'Sign in to see your cloud projects.'}
              </div>
            )}
            {cloudProjects.map((p) => (
              <div key={p.externalId}
                   className="flex items-center gap-3 px-3 py-2.5 rounded cursor-pointer group"
                   style={{ background: 'transparent' }}
                   onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                   onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <button onClick={() => selectCloud(p)} aria-label={`Open ${p.name} from ${p.provider === 'google' ? 'Google Drive' : 'GitHub Gists'}`} className="flex flex-1 min-w-0 items-center gap-3 text-left">
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" className="w-10 h-10 rounded object-cover shrink-0" style={{ background: 'var(--bg-elevated)' }} />
                ) : (
                  <div className="w-10 h-10 rounded flex items-center justify-center text-xs shrink-0"
                       style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>3D</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{p.name}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {p.provider === 'google' ? 'Google Drive' : 'GitHub Gist'} &middot; {formatDate(p.updatedAt)}
                  </div>
                </div>
                </button>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                  <button onClick={(e) => handleMoveToLocal(p, e)}
                          className="text-[11px] px-2 py-1 rounded flex items-center gap-1"
                          style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
                          title="Move to browser storage">
                    <span>&#x2193;</span> Local
                  </button>
                  <button onClick={(e) => handleDownloadCloud(p, e)}
                          className="text-[11px] px-2 py-1 rounded flex items-center gap-1"
                          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                          title="Download as .json file">
                    <span>&#x21E9;</span> File
                  </button>
                  <button onClick={(e) => handleDeleteCloud(p, e)}
                          className="text-[11px] px-2 py-1 rounded"
                          style={{ color: 'var(--accent-red)' }}
                          title="Delete from cloud">
                    &#x2715;
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {toast && (
          <div role="status" aria-live="polite" className="px-5 py-2.5 text-xs font-medium text-center"
               style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
