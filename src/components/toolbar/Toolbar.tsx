import { useState, useEffect, useRef } from 'react';
import { isDirty, markClean } from '../../store/localPersist';
import { useModelerStore } from '../../store/modelerStore';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import { workerBridge, isCancelled } from '../../engine/workerBridge';
import { triggerDownload } from '../../utils/download';
import { useChatStore } from '../../store/chatStore';
import { useViewportStore } from '../../store/viewportStore';
import { ProjectList } from '../projects/ProjectList';
import { ImportProject } from '../projects/ImportProject';
import { ImportMesh } from '../projects/ImportMesh';
import { SettingsPage } from '../settings/SettingsPage';
import { FolderOpen, Save, Undo2, Redo2, MessageSquare, FileDown, FilePlus, Share2, Link, List, SlidersHorizontal, MoreHorizontal, Upload } from 'lucide-react';

export function Toolbar({ onMobileTree, onMobileProps }: { onMobileTree?: () => void; onMobileProps?: () => void } = {}) {
  const projectName = useModelerStore((s) => s.projectName);
  const setProjectName = useModelerStore((s) => s.setProjectName);
  const tree = useModelerStore((s) => s.tree);
  const evaluating = useModelerStore((s) => s.evaluating);
  const undo = useModelerStore((s) => s.undo);
  const redo = useModelerStore((s) => s.redo);
  const toggleChat = useChatStore((s) => s.toggleOpen);
  const isChatOpen = useChatStore((s) => s.isOpen);
  const user = useAuthStore((s) => s.user);
  const save = useProjectStore((s) => s.save);
  const saving = useProjectStore((s) => s.saving);
  const saveError = useProjectStore((s) => s.saveError);
  const clearSaveError = useProjectStore((s) => s.clearSaveError);
  const shareUrl = useProjectStore((s) => s.shareUrl);
  const toggleShare = useProjectStore((s) => s.toggleShare);
  const projectId = useProjectStore((s) => s.projectId);
  const [showProjects, setShowProjects] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showImportMesh, setShowImportMesh] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [exportPreview, setExportPreview] = useState<{ blob: Blob; name: string; triangles: number; size: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  // Track dirty state
  useEffect(() => {
    const check = () => setDirty(isDirty());
    const unsub = useModelerStore.subscribe(check);
    check();
    return unsub;
  }, []);

  // Close overflow menu on outside click
  useEffect(() => {
    if (!showOverflow) return;
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setShowOverflow(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOverflow]);

  const onProgress = (stage: string, percent: number) => setExportProgress({ stage, percent });

  /**
   * Bumped by every cancel. An export captures it at the start and compares
   * before showing its preview, which is what makes the cancel button honest
   * for the whole time it is on screen.
   *
   * `workerBridge.cancelExport()` alone is not enough. The button renders
   * while `exporting && exportProgress` are set, and those are cleared in the
   * `finally` below — so it is still on screen during the stretch between the
   * worker returning the blob and React committing the preview. A cancel in
   * that window finds nothing in flight, no-ops, and the user gets the
   * download dialog they just declined. The gap is not hypothetical: reading
   * the triangle count off the blob is itself an await, and this is what made
   * the e2e cancel test fail on CI.
   */
  const exportEpoch = useRef(0);
  const exportResolution = useViewportStore((s) => s.resolution);
  const setExportResolution = useViewportStore((s) => s.setResolution);

  // Cancelling rejects the export promise, so the `catch` below runs on the
  // normal path. A cancel is a user decision, not a failure — it must not be
  // logged as one, and it must not raise the error toast.
  const handleCancelExport = () => {
    exportEpoch.current++;
    workerBridge.cancelExport();
  };

  const handleExportSTL = async () => {
    if (!tree || exporting) return;
    const epoch = exportEpoch.current;
    setExporting('STL');
    setExportProgress({ stage: 'Starting', percent: 0 });
    try {
      const blob = await workerBridge.exportSTL(tree, onProgress, exportResolution);
      const triangles = new DataView(await blob.slice(80, 84).arrayBuffer()).getUint32(0, true);
      if (exportEpoch.current !== epoch) return;
      setExportPreview({ blob, name: `${projectName}.stl`, triangles, size: blob.size });
    } catch (err: any) {
      if (!isCancelled(err)) console.error('Export STL failed:', err);
    } finally {
      setExporting(null);
      setExportProgress(null);
    }
  };

  const handleExport3MF = async () => {
    if (!tree || exporting) return;
    const epoch = exportEpoch.current;
    setExporting('3MF');
    setExportProgress({ stage: 'Starting', percent: 0 });
    try {
      const blob = await workerBridge.export3MF(tree, onProgress, exportResolution);
      // 3MF is a zip — estimate triangles from the uncompressed mesh size
      // STL: 50 bytes/tri. 3MF XML is ~120 bytes/tri on average.
      const triangles = Math.round(blob.size / 120);
      if (exportEpoch.current !== epoch) return;
      setExportPreview({ blob, name: `${projectName}.3mf`, triangles, size: blob.size });
    } catch (err: any) {
      if (!isCancelled(err)) console.error('Export 3MF failed:', err);
    } finally {
      setExporting(null);
      setExportProgress(null);
    }
  };

  const handleSaveCloud = async () => { await save(); markClean(); setDirty(false); };

  return (
    <>
    <div className="h-11 flex items-center px-2 md:px-3 gap-1 md:gap-2 shrink-0"
         style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-subtle)' }}>
      {/* Logo + name */}
      <div className="flex items-center gap-1.5 md:gap-2 min-w-0">
        <img src="/logo-64.png" alt="Sinter" className="w-5 h-5 rounded shrink-0"
             style={{ cursor: 'pointer' }}
             onClick={() => window.dispatchEvent(new Event('show-landing'))}
             title="Back to home" />
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
          className="bg-transparent border-none text-sm font-medium w-20 md:w-32 focus:outline-none rounded px-1 min-w-0"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>

      {/* Mobile-only: tree + props toggles */}
      <div className="md:hidden flex items-center gap-1">
        <IconBtn icon={<List size={14} />} title="Node tree" onClick={() => onMobileTree?.()} />
        <IconBtn icon={<SlidersHorizontal size={14} />} title="Properties" onClick={() => onMobileProps?.()} />
      </div>

      {/* Desktop-only: full toolbar */}
      <div className="hidden md:contents">
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
        <IconBtn icon={<FilePlus size={14} />} title="New project" onClick={() => { useModelerStore.getState().setTree(null); useModelerStore.getState().setProjectName('Untitled'); }} />
        <IconBtn icon={<FolderOpen size={14} />} title="Projects" onClick={() => setShowProjects(true)} />
        <IconBtn icon={<Upload size={14} />} title="Import STL" onClick={() => setShowImportMesh(true)} />
        <IconBtn icon={<Save size={14} />} title={saving ? 'Saving...' : 'Save to cloud'} onClick={handleSaveCloud} disabled={saving || !dirty} />
        {projectId && (
          shareUrl ? (
            <IconBtn
              icon={<Link size={14} />}
              label={copied ? 'Copied!' : 'Shared'}
              title="Click to copy share link, Shift+click to revoke"
              onClick={() => {
                if ((window.event as MouseEvent)?.shiftKey) { toggleShare(); return; }
                navigator.clipboard.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
              }}
            />
          ) : (
            <IconBtn icon={<Share2 size={14} />} title="Create share link" onClick={toggleShare} />
          )
        )}
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
        <IconBtn icon={<Undo2 size={14} />} title="Undo" onClick={undo} />
        <IconBtn icon={<Redo2 size={14} />} title="Redo" onClick={redo} />
      </div>

      <div className="flex-1" />

      {/* Desktop-only: export buttons */}
      <div className="hidden md:contents">
        {/*
          Export grid resolution. Cost is cubic, so this is the single biggest
          lever over a 20s export — and a draft pass is usually what you want
          when checking a shape fits before committing to the real one.
        */}
        <select
          value={exportResolution}
          onChange={(e) => setExportResolution(Number(e.target.value))}
          aria-label="Export resolution"
          title="Export resolution — cost is cubic in this"
          disabled={!!exporting}
          className="h-6 rounded text-[11px] px-1 focus:outline-none"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
        >
          <option value={128}>Draft</option>
          <option value={256}>Standard</option>
          <option value={384}>Fine</option>
        </select>
        <IconBtn icon={<FileDown size={14} />} label={exporting === 'STL' && exportProgress ? `${Math.round(exportProgress.percent)}%` : 'STL'} title="Export STL" onClick={handleExportSTL} disabled={evaluating || !tree || !!exporting} />
        <IconBtn icon={<FileDown size={14} />} label={exporting === '3MF' && exportProgress ? `${Math.round(exportProgress.percent)}%` : '3MF'} title="Export 3MF" onClick={handleExport3MF} disabled={evaluating || !tree || !!exporting} />
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
      </div>

      {/* Always visible: chat toggle */}
      <button
        onClick={toggleChat}
        title="AI Chat"
        aria-label="Toggle AI Chat"
        aria-pressed={isChatOpen}
        className="px-2 py-1 rounded font-medium flex items-center gap-1.5"
        style={{
          background: isChatOpen ? 'var(--accent)' : 'var(--bg-elevated)',
          color: isChatOpen ? 'var(--bg-deep)' : 'var(--text-secondary)',
          border: `1px solid ${isChatOpen ? 'var(--accent)' : 'var(--border-subtle)'}`,
        }}
      >
        <MessageSquare size={14} />
      </button>

      {/* Mobile-only: overflow menu */}
      <div className="md:hidden relative" ref={overflowRef}>
        <IconBtn icon={<MoreHorizontal size={14} />} title="More actions" onClick={() => setShowOverflow(!showOverflow)} />
        {showOverflow && (
          <div className="absolute top-10 right-0 rounded-lg py-1 z-50 w-48 shadow-lg"
               style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}>
            <OverflowItem label="New Project" onClick={() => { useModelerStore.getState().setTree(null); useModelerStore.getState().setProjectName('Untitled'); setShowOverflow(false); }} />
            <OverflowItem label="Open Projects" onClick={() => { setShowProjects(true); setShowOverflow(false); }} />
            <OverflowItem label={saving ? 'Saving...' : 'Save'} onClick={() => { handleSaveCloud(); setShowOverflow(false); }} disabled={saving || !dirty} />
            <OverflowDivider />
            <OverflowItem label="Undo" onClick={() => { undo(); setShowOverflow(false); }} />
            <OverflowItem label="Redo" onClick={() => { redo(); setShowOverflow(false); }} />
            <OverflowDivider />
            <OverflowItem label="Import STL" onClick={() => { setShowImportMesh(true); setShowOverflow(false); }} />
            <OverflowItem label={exporting === 'STL' && exportProgress ? `Exporting ${exportProgress.percent}%` : 'Export STL'} onClick={() => { handleExportSTL(); setShowOverflow(false); }} disabled={evaluating || !tree || !!exporting} />
            <OverflowItem label={exporting === '3MF' && exportProgress ? `Exporting ${exportProgress.percent}%` : 'Export 3MF'} onClick={() => { handleExport3MF(); setShowOverflow(false); }} disabled={evaluating || !tree || !!exporting} />
            {projectId && (
              <>
                <OverflowDivider />
                {shareUrl ? (
                  <OverflowItem label="Copy Share Link" onClick={() => {
                    navigator.clipboard.writeText(shareUrl);
                    setShowOverflow(false);
                  }} />
                ) : (
                  <OverflowItem label="Create Share Link" onClick={() => { toggleShare(); setShowOverflow(false); }} />
                )}
              </>
            )}
            <OverflowDivider />
            {!user ? (
              <OverflowItem label="Sign In" onClick={() => { localStorage.removeItem('sinter_launched'); window.location.href = '/app'; }} />
            ) : (
              <OverflowItem label="Settings" onClick={() => { setShowSettings(true); setShowOverflow(false); }} />
            )}
          </div>
        )}
      </div>

      {/* Desktop-only: sign in / avatar */}
      <div className="hidden md:contents">
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
        {!user && (
          <a href="/app"
             onClick={() => localStorage.removeItem('sinter_launched')}
             className="text-[11px] px-3 py-1 rounded font-medium"
             style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
          >
            Sign In
          </a>
        )}
        {user && (
          <button onClick={() => setShowSettings(true)} title="Settings" aria-label="Account settings" className="flex items-center gap-2 rounded px-1.5 py-1"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
            {user.avatar_url && !avatarFailed ? (
              <img src={user.avatar_url} alt={`${user.name}'s avatar`} className="w-6 h-6 rounded-full"
                   onError={() => setAvatarFailed(true)} />
            ) : (
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                   style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
                {user.name?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{user.name}</span>
          </button>
        )}
      </div>
    </div>

    {exportProgress && (
      <div data-testid="export-progress" className="h-1 w-full shrink-0" style={{ background: 'var(--bg-elevated)' }}>
        <div
          className="h-full transition-all duration-200"
          style={{ width: `${Math.round(exportProgress.percent)}%`, background: 'var(--accent)' }}
        />
      </div>
    )}

    {exporting && exportProgress && (
      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-lg shadow-lg text-sm"
           style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
        <span>{exporting} — {exportProgress.stage} {Math.round(exportProgress.percent)}%</span>
        <button
          onClick={handleCancelExport}
          title="Cancel export"
          className="px-2 py-0.5 rounded text-xs opacity-80 hover:opacity-100"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          Cancel
        </button>
      </div>
    )}

    {saveError && (
      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg text-sm"
           style={{ background: 'var(--accent-red)', color: '#fff' }}>
        <span>{saveError}</span>
        <button onClick={clearSaveError} className="ml-2 opacity-70 hover:opacity-100">&times;</button>
      </div>
    )}

    {showProjects && (
      <ProjectList
        onClose={() => setShowProjects(false)}
        onLoaded={() => setShowProjects(false)}
        onImport={() => { setShowProjects(false); setShowImport(true); }}
      />
    )}
    {showImport && (
      <ImportProject onDone={() => setShowImport(false)} />
    )}
    {showImportMesh && (
      <ImportMesh onDone={() => setShowImportMesh(false)} />
    )}
    {showSettings && (
      <SettingsPage onClose={() => setShowSettings(false)} />
    )}
    {exportPreview && (
      <ExportPreview
        triangles={exportPreview.triangles}
        size={exportPreview.size}
        name={exportPreview.name}
        onDownload={() => { triggerDownload(exportPreview.blob, exportPreview.name); setExportPreview(null); }}
        onCancel={() => setExportPreview(null)}
      />
    )}
    </>
  );
}

function IconBtn({ icon, label, title, onClick, disabled }: { icon: React.ReactNode; label?: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="px-2 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed font-medium flex items-center gap-1.5"
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.borderColor = 'var(--border-default)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
    >
      {icon}
      {label && <span className="text-[11px]">{label}</span>}
    </button>
  );
}

function OverflowItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left px-3 py-2 text-[12px] disabled:opacity-30"
      style={{ color: 'var(--text-secondary)' }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {label}
    </button>
  );
}

function OverflowDivider() {
  return <div className="my-1 mx-2 h-px" style={{ background: 'var(--border-subtle)' }} />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTriangles(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function ExportPreview({ triangles, size, name, onDownload, onCancel }: {
  triangles: number; size: number; name: string;
  onDownload: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onCancel}>
      <div className="rounded-xl p-5 w-72 shadow-xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }} onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Export Ready</h3>
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>File</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{name}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>Triangles</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{formatTriangles(triangles)}</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>File size</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{formatSize(size)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 px-3 py-1.5 rounded text-[12px] font-medium"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
            Cancel
          </button>
          <button onClick={onDownload} className="flex-1 px-3 py-1.5 rounded text-[12px] font-medium"
                  style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
