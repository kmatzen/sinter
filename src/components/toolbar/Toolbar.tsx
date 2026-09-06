import { useState, useEffect, useRef } from 'react';
import { useModelerStore } from '../../store/modelerStore';
import { useAuthStore } from '../../store/authStore';
import { isCloudDirty, requestDocumentReplacement, useProjectStore } from '../../store/projectStore';
import { workerBridge, isCancelled } from '../../engine/workerBridge';
import { triggerDownload } from '../../utils/download';
import { useChatStore } from '../../store/chatStore';
import { useViewportStore } from '../../store/viewportStore';
import { ProjectList } from '../projects/ProjectList';
import { ImportProject } from '../projects/ImportProject';
import { ImportMesh } from '../projects/ImportMesh';
import { SettingsPage } from '../settings/SettingsPage';
import { FolderOpen, Save, Undo2, Redo2, MessageSquare, FileDown, FilePlus, Share2, Link, List, SlidersHorizontal, MoreHorizontal, Upload, Settings, History, Trash2, Search } from 'lucide-react';
import { useLocalBackupStore } from '../../store/localPersist';
import { useModalStore } from '../../store/modalStore';
import { isTreeExportable } from '../../types/operations';
import { useDialogFocus } from '../ui/useDialogFocus';
import type { ExportConformance, ExportDiagnostics } from '../../types/geometry';
import { dimensionsOutsideBuildVolume, useManufacturingProfileStore } from '../../store/manufacturingProfile';
import { commandById, OPEN_COMMAND_PALETTE_EVENT, runEditorCommand, TOOLBAR_COMMAND_EVENT } from '../../commands/editorCommands';
import { formatLength } from '../../types/units';

function hasImportedMesh(node: ReturnType<typeof useModelerStore.getState>['tree']): boolean {
  return !!node && (node.kind === 'mesh' || node.children.some(hasImportedMesh));
}

export function Toolbar({ onMobileTree, onMobileProps }: { onMobileTree?: () => void; onMobileProps?: () => void } = {}) {
  const projectName = useModelerStore((s) => s.projectName);
  const setProjectName = useModelerStore((s) => s.setProjectName);
  const tree = useModelerStore((s) => s.tree);
  const evaluating = useModelerStore((s) => s.evaluating);
  const evaluatedTree = useModelerStore((s) => s.evaluatedTree);
  const setError = useModelerStore((s) => s.setError);
  const selectedNodeId = useModelerStore((s) => s.selectedNodeId);
  const clipboard = useModelerStore((s) => s.clipboard);
  const toggleChat = useChatStore((s) => s.toggleOpen);
  const isChatOpen = useChatStore((s) => s.isOpen);
  const user = useAuthStore((s) => s.user);
  const save = useProjectStore((s) => s.save);
  const saving = useProjectStore((s) => s.saving);
  const saveError = useProjectStore((s) => s.saveError);
  const saveConflict = useProjectStore((s) => s.saveConflict);
  const clearSaveError = useProjectStore((s) => s.clearSaveError);
  const reloadRemote = useProjectStore((s) => s.reloadRemote);
  const saveAsCopy = useProjectStore((s) => s.saveAsCopy);
  const overwriteRemote = useProjectStore((s) => s.overwriteRemote);
  const checkpoints = useProjectStore((s) => s.checkpoints);
  const createCheckpoint = useProjectStore((s) => s.createCheckpoint);
  const restoreCheckpoint = useProjectStore((s) => s.restoreCheckpoint);
  const deleteCheckpoint = useProjectStore((s) => s.deleteCheckpoint);
  const shareUrl = useProjectStore((s) => s.shareUrl);
  const toggleShare = useProjectStore((s) => s.toggleShare);
  const projectId = useProjectStore((s) => s.projectId);
  const projectProvider = useProjectStore((s) => s.provider);
  const createProject = useProjectStore((s) => s.createProject);
  const backupStatus = useLocalBackupStore((s) => s.status);
  const backupError = useLocalBackupStore((s) => s.error);
  const [showProjects, setShowProjects] = useState(false);
  const [copied, setCopied] = useState(false);
  const [nodeCopied, setNodeCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showImportMesh, setShowImportMesh] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<{ stage: string; percent: number } | null>(null);
  const [exportPreview, setExportPreview] = useState<{ blob: Blob; name: string; triangles: number; size: number; diagnostics: ExportDiagnostics; conformance: ExportConformance; approximateSource: boolean; achievedTolerance?: number; componentCount?: number } | null>(null);
  const [dirty, setDirty] = useState(() => isCloudDirty());
  const overflowRef = useRef<HTMLDivElement>(null);

  // Cloud dirtiness is distinct from the browser backup. A successful local
  // autosave must never disable retrying a failed or not-yet-attempted cloud
  // save.
  useEffect(() => {
    const check = () => setDirty(isCloudDirty());
    const unsubModel = useModelerStore.subscribe(check);
    const unsubProject = useProjectStore.subscribe(check);
    check();
    return () => { unsubModel(); unsubProject(); };
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

  const handleToggleShare = async () => {
    setShareError(null);
    try {
      await toggleShare();
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Sharing change failed');
    }
  };

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
   * download dialog they just declined.
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
      const { blob, triangleCount: triangles, diagnostics, conformance, achievedTolerance, componentCount } = await workerBridge.exportSTL(tree, onProgress, exportResolution);
      if (exportEpoch.current !== epoch) return;
      setExportPreview({ blob, name: `${projectName}.stl`, triangles, size: blob.size, diagnostics, conformance, approximateSource: hasImportedMesh(tree), achievedTolerance, componentCount });
    } catch (err: any) {
      if (!isCancelled(err)) setError(`STL export failed: ${err?.message || String(err)}`);
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
      const { blob, triangleCount: triangles, diagnostics, conformance, achievedTolerance, componentCount } = await workerBridge.export3MF(tree, onProgress, exportResolution);
      if (exportEpoch.current !== epoch) return;
      setExportPreview({ blob, name: `${projectName}.3mf`, triangles, size: blob.size, diagnostics, conformance, approximateSource: hasImportedMesh(tree), achievedTolerance, componentCount });
    } catch (err: any) {
      if (!isCancelled(err)) setError(`3MF export failed: ${err?.message || String(err)}`);
    } finally {
      setExporting(null);
      setExportProgress(null);
    }
  };

  const handleSaveCloud = async () => { await save(); };

  useEffect(() => {
    const handleCommand = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id === 'new') requestDocumentReplacement(createProject);
      else if (id === 'open') setShowProjects(true);
      else if (id === 'import-project') setShowImport(true);
      else if (id === 'import-mesh') setShowImportMesh(true);
      else if (id === 'settings') setShowSettings(true);
      else if (id === 'versions') setShowVersions(true);
      else if (id === 'export-stl') void handleExportSTL();
      else if (id === 'export-3mf') void handleExport3MF();
      else if (id === 'share') {
        if (shareUrl) void navigator.clipboard.writeText(shareUrl).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
        else void handleToggleShare();
      }
    };
    window.addEventListener(TOOLBAR_COMMAND_EVENT, handleCommand);
    return () => window.removeEventListener(TOOLBAR_COMMAND_EVENT, handleCommand);
  });

  return (
    <>
    <div className="h-11 flex items-center gap-1 lg:gap-2 shrink-0 px-safe-plus"
         style={{
           background: 'var(--bg-panel)',
           borderBottom: '1px solid var(--border-subtle)',
           // Base horizontal padding, folded in with the landscape notch inset.
           ['--safe-pad-x' as any]: '0.5rem',
         }}>
      {/* Logo + name */}
      <div className="flex items-center gap-1.5 lg:gap-2 min-w-0">
        <img src="/logo-64.png" alt="Sinter" className="w-5 h-5 rounded shrink-0"
             style={{ cursor: 'pointer' }}
             onClick={() => window.dispatchEvent(new Event('show-landing'))}
             title="Back to home" />
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
          className="bg-transparent border-none text-sm font-medium w-24 lg:w-32 focus:outline-none rounded px-1 min-w-0 tap-h"
          style={{ color: 'var(--text-primary)' }}
        />
        {backupStatus !== 'idle' && (
          <span role="status" title={backupError ?? undefined} className="hidden md:inline text-[10px] whitespace-nowrap"
                style={{ color: backupStatus === 'failed' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
            {backupStatus === 'saving' ? 'Backing up…' : backupStatus === 'failed' ? 'Backup failed' : 'Saved locally'}
          </span>
        )}
      </div>

      {/* Mobile-only: tree + props toggles */}
      <div className="lg:hidden flex items-center gap-1">
        <IconBtn icon={<List size={14} />} title="Node tree" onClick={() => onMobileTree?.()} />
        <IconBtn icon={<SlidersHorizontal size={14} />} title="Properties" onClick={() => onMobileProps?.()} />
      </div>

      {/* Desktop-only: full toolbar */}
      <div className="hidden lg:contents">
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
        <IconBtn icon={<FilePlus size={14} />} title="New project" onClick={() => requestDocumentReplacement(createProject)} />
        <IconBtn icon={<FolderOpen size={14} />} title="Projects" onClick={() => setShowProjects(true)} />
        <IconBtn icon={<Upload size={14} />} title="Import STL" onClick={() => setShowImportMesh(true)} />
        <IconBtn icon={<Save size={14} />} title={saving ? 'Saving...' : 'Save to cloud'} onClick={handleSaveCloud} disabled={saving || !dirty} />
        {projectId && <IconBtn icon={<History size={14} />} title="Project versions" onClick={() => setShowVersions(true)} />}
        {projectId && (
          shareUrl ? (
            <IconBtn
              icon={<Link size={14} />}
              label={copied ? 'Copied!' : 'Shared'}
              title={projectProvider === 'github' ? 'Copy share link (GitHub gist links cannot be revoked without deleting the project)' : 'Copy share link'}
              onClick={() => {
                navigator.clipboard.writeText(shareUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
              }}
            />
          ) : (
            <IconBtn icon={<Share2 size={14} />} title="Create share link" onClick={handleToggleShare} />
          )
        )}
        {projectId && shareUrl && projectProvider === 'google' && (
          <IconBtn icon={<Share2 size={14} />} title="Revoke share link" onClick={handleToggleShare} />
        )}
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
        <IconBtn icon={<Undo2 size={14} />} title={commandById('edit.undo')!.title} onClick={() => { runEditorCommand('edit.undo'); }} />
        <IconBtn icon={<Redo2 size={14} />} title={commandById('edit.redo')!.title} onClick={() => { runEditorCommand('edit.redo'); }} />
      </div>

      <div className="flex-1" />

      <IconBtn icon={<Search size={14} />} title="Command palette (Ctrl/Command+K)" onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))} />

      {/* Desktop-only: export buttons */}
      <div className="hidden lg:contents">
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
        <IconBtn icon={<FileDown size={14} />} label={exporting === 'STL' && exportProgress ? `${Math.round(exportProgress.percent)}%` : 'STL'} title="Export STL" onClick={handleExportSTL} disabled={evaluating || evaluatedTree !== tree || !isTreeExportable(tree) || !!exporting} />
        <IconBtn icon={<FileDown size={14} />} label={exporting === '3MF' && exportProgress ? `${Math.round(exportProgress.percent)}%` : '3MF'} title="Export 3MF" onClick={handleExport3MF} disabled={evaluating || evaluatedTree !== tree || !isTreeExportable(tree) || !!exporting} />
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
      </div>

      {/* Always visible: chat toggle */}
      <button
        onClick={toggleChat}
        title="AI Chat"
        aria-label="Toggle AI Chat"
        aria-pressed={isChatOpen}
        className="px-2 py-1 rounded font-medium flex items-center justify-center gap-1.5 tap"
        style={{
          background: isChatOpen ? 'var(--accent)' : 'var(--bg-elevated)',
          color: isChatOpen ? 'var(--bg-deep)' : 'var(--text-secondary)',
          border: `1px solid ${isChatOpen ? 'var(--accent)' : 'var(--border-subtle)'}`,
        }}
      >
        <MessageSquare size={14} />
      </button>

      {/* Mobile-only: overflow menu */}
      <div className="lg:hidden relative" ref={overflowRef}>
        <IconBtn icon={<MoreHorizontal size={14} />} title="More actions" onClick={() => setShowOverflow(!showOverflow)} />
        {showOverflow && (
          <div className="absolute top-10 right-0 rounded-lg py-1 z-50 w-48 shadow-lg"
               style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}>
            <OverflowItem label="New Project" onClick={() => { requestDocumentReplacement(createProject); setShowOverflow(false); }} />
            <OverflowItem label="Open Projects" onClick={() => { setShowProjects(true); setShowOverflow(false); }} />
            <OverflowItem label={saving ? 'Saving...' : 'Save'} onClick={() => { handleSaveCloud(); setShowOverflow(false); }} disabled={saving || !dirty} />
            {projectId && <OverflowItem label="Project Versions" onClick={() => { setShowVersions(true); setShowOverflow(false); }} />}
            <OverflowDivider />
            <OverflowItem label={commandById('edit.undo')!.title} onClick={() => { runEditorCommand('edit.undo'); setShowOverflow(false); }} />
            <OverflowItem label={commandById('edit.redo')!.title} onClick={() => { runEditorCommand('edit.redo'); setShowOverflow(false); }} />
            <OverflowItem label={nodeCopied ? 'Node copied!' : commandById('edit.copy')!.title} disabled={!selectedNodeId} onClick={() => {
              runEditorCommand('edit.copy');
              setNodeCopied(true);
              setTimeout(() => setNodeCopied(false), 1200);
            }} />
            <OverflowItem label={commandById('edit.paste')!.title} disabled={!clipboard || (!!tree && !selectedNodeId)} onClick={() => {
              runEditorCommand('edit.paste');
              setShowOverflow(false);
            }} />
            <OverflowDivider />
            <OverflowItem label="Import STL" onClick={() => { setShowImportMesh(true); setShowOverflow(false); }} />
            {/*
              Export resolution was desktop-only, which put the biggest cost
              lever in the app — the grid is cubic — out of reach of exactly the
              devices that need it most. A phone exporting at Fine is a minutes-
              long wait it never agreed to.
            */}
            <div className="flex items-center justify-between px-3 py-2 gap-2">
              <span className="text-[12px] shrink-0" style={{ color: 'var(--text-muted)' }}>Resolution</span>
              <select
                value={exportResolution}
                onChange={(e) => setExportResolution(Number(e.target.value))}
                aria-label="Export resolution"
                disabled={!!exporting}
                className="rounded text-[12px] px-2 tap-h focus:outline-none"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
              >
                <option value={128}>Draft</option>
                <option value={256}>Standard</option>
                <option value={384}>Fine</option>
              </select>
            </div>
            <OverflowItem label={exporting === 'STL' && exportProgress ? `Exporting ${exportProgress.percent}%` : 'Export STL'} onClick={() => { handleExportSTL(); setShowOverflow(false); }} disabled={evaluating || evaluatedTree !== tree || !isTreeExportable(tree) || !!exporting} />
            <OverflowItem label={exporting === '3MF' && exportProgress ? `Exporting ${exportProgress.percent}%` : 'Export 3MF'} onClick={() => { handleExport3MF(); setShowOverflow(false); }} disabled={evaluating || evaluatedTree !== tree || !isTreeExportable(tree) || !!exporting} />
            {projectId && (
              <>
                <OverflowDivider />
                {shareUrl ? (
                  /*
                   * Desktop gets a "Copied!" state on the button; this wrote to
                   * the clipboard and closed the menu, so the only evidence it
                   * had worked was pasting somewhere else. Hold the menu item
                   * open long enough to say so.
                   */
                  <OverflowItem label={copied ? 'Copied!' : 'Copy Share Link'} onClick={() => {
                    navigator.clipboard.writeText(shareUrl).then(() => {
                      setCopied(true);
                      setTimeout(() => { setCopied(false); setShowOverflow(false); }, 1200);
                    });
                  }} />
                ) : (
                  <OverflowItem label="Create Share Link" onClick={() => { void handleToggleShare(); setShowOverflow(false); }} />
                )}
                {shareUrl && projectProvider === 'google' && (
                  <OverflowItem label="Revoke Share Link" onClick={() => { void handleToggleShare(); setShowOverflow(false); }} />
                )}
                {shareUrl && projectProvider === 'github' && (
                  <p className="px-3 py-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>GitHub gist links cannot be revoked without deleting the project.</p>
                )}
              </>
            )}
            <OverflowDivider />
            <OverflowItem label="Settings" onClick={() => { setShowSettings(true); setShowOverflow(false); }} />
            {!user && (
              <OverflowItem label="Sign In" onClick={() => { localStorage.removeItem('sinter_launched'); window.location.href = '/app'; }} />
            )}
          </div>
        )}
      </div>

      {/* Desktop-only: settings / sign in / avatar */}
      <div className="hidden lg:contents">
        <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
        {/*
          Not gated on `user`. Settings is where the AI provider is configured,
          and OpenRouter sign-on exists precisely so you do not need a Sinter
          account to use the chat — putting it behind one made the whole
          bring-your-own-key path unreachable for anyone who chose "Continue
          without account".
        */}
        <IconBtn icon={<Settings size={14} />} title="Settings" onClick={() => setShowSettings(true)} />
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
      <div data-testid="export-progress" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(exportProgress.percent)} className="h-1 w-full shrink-0" style={{ background: 'var(--bg-elevated)' }}>
        <div
          className="h-full transition-all duration-200"
          style={{ width: `${Math.round(exportProgress.percent)}%`, background: 'var(--accent)' }}
        />
      </div>
    )}

    {exporting && exportProgress && (
      <div role="status" aria-live="polite" className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-lg shadow-lg text-sm"
           style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}>
        <span>{exporting} — {exportProgress.stage} {Math.round(exportProgress.percent)}%</span>
        <button
          onClick={handleCancelExport}
          title="Cancel export"
          className="px-2 py-0.5 rounded text-xs opacity-80 hover:opacity-100 tap"
          style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}
        >
          Cancel
        </button>
      </div>
    )}

    {saveError && (
      <div role="alert" aria-live="assertive" className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg text-sm"
           style={{ background: 'var(--accent-red)', color: '#fff' }}>
        <span>{saveError}</span>
        {saveConflict && <>
          <button className="underline whitespace-nowrap" onClick={() => void reloadRemote()}>Reload cloud</button>
          <button className="underline whitespace-nowrap" onClick={() => void saveAsCopy()}>Save as copy</button>
          <button className="underline whitespace-nowrap" onClick={() => void overwriteRemote()}>Overwrite</button>
        </>}
        <button onClick={clearSaveError} aria-label="Dismiss save error" className="ml-2 opacity-70 hover:opacity-100">&times;</button>
      </div>
    )}

    {shareError && (
      <div role="alert" className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg text-sm"
           style={{ background: 'var(--accent-red)', color: '#fff' }}>
        <span>{shareError}</span>
        <button onClick={() => setShareError(null)} aria-label="Dismiss sharing error" className="ml-2 opacity-70 hover:opacity-100">&times;</button>
      </div>
    )}

    {backupStatus === 'failed' && backupError && (
      <div role="alert" className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2 rounded-lg shadow-lg text-sm max-w-[min(90vw,640px)]"
           style={{ background: 'var(--accent-red)', color: '#fff' }}>
        <span>{backupError}</span>
        <button
          onClick={() => triggerDownload(new Blob([useModelerStore.getState().toJSON()], { type: 'application/json' }), `${projectName}.json`)}
          className="shrink-0 underline font-medium"
        >
          Download project
        </button>
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
    {showVersions && (
      <VersionsDialog
        checkpoints={checkpoints}
        saving={saving}
        onCreate={createCheckpoint}
        onRestore={restoreCheckpoint}
        onDelete={deleteCheckpoint}
        onClose={() => setShowVersions(false)}
      />
    )}
    {exportPreview && (
      <ExportPreview
        triangles={exportPreview.triangles}
        size={exportPreview.size}
        name={exportPreview.name}
        diagnostics={exportPreview.diagnostics}
        conformance={exportPreview.conformance}
        approximateSource={exportPreview.approximateSource}
        achievedTolerance={exportPreview.achievedTolerance}
        componentCount={exportPreview.componentCount}
        onDownload={() => { triggerDownload(exportPreview.blob, exportPreview.name); setExportPreview(null); }}
        onCancel={() => setExportPreview(null)}
      />
    )}
    </>
  );
}

function VersionsDialog({ checkpoints, saving, onCreate, onRestore, onDelete, onClose }: {
  checkpoints: import('../../store/projectStore').LiveCheckpoint[];
  saving: boolean;
  onCreate: (name: string) => Promise<boolean>;
  onRestore: (id: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  useDialogFocus(surface, onClose);
  const create = async () => {
    if (await onCreate(name)) setName('');
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div ref={surface} role="dialog" aria-modal="true" aria-labelledby="versions-title" className="w-full max-w-lg rounded-xl p-5 shadow-xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 id="versions-title" className="font-semibold" style={{ color: 'var(--text-primary)' }}>Project versions</h2>
          <button onClick={onClose} aria-label="Close project versions" className="px-2">×</button>
        </div>
        <p className="text-[11px] mb-4" style={{ color: 'var(--text-muted)' }}>Stored atomically with this cloud project. The 10 newest versions are retained.</p>
        <div className="flex gap-2 mb-4">
          <input value={name} maxLength={256} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void create(); }} placeholder="Name this version" aria-label="Version name" className="min-w-0 flex-1 rounded px-3 py-2 text-sm" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
          <button disabled={saving || !name.trim()} onClick={() => void create()} className="rounded px-3 py-2 text-sm font-medium disabled:opacity-50" style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>Create</button>
        </div>
        <div className="max-h-72 overflow-y-auto space-y-2">
          {checkpoints.length === 0 && <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>No saved versions yet.</p>}
          {[...checkpoints].reverse().map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded p-3" style={{ background: 'var(--bg-elevated)' }}>
              <div className="min-w-0 flex-1">
                <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{new Date(item.createdAt).toLocaleString()}</p>
              </div>
              <button disabled={saving} onClick={() => void onRestore(item.id)} className="text-xs rounded px-2 py-1 disabled:opacity-50" style={{ border: '1px solid var(--border-default)' }}>Restore</button>
              <button disabled={saving} onClick={() => useModalStore.getState().showConfirm(`Delete version “${item.name}”?`, () => { void onDelete(item.id); }, { confirmLabel: 'Delete' })} aria-label={`Delete version ${item.name}`} className="rounded p-1.5 disabled:opacity-50" style={{ color: 'var(--accent-red)' }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function IconBtn({ icon, label, title, onClick, disabled }: { icon: React.ReactNode; label?: string; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="px-2 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-1.5 tap"
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
      className="w-full text-left px-3 py-2 text-[12px] disabled:opacity-30 tap-h"
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

function ExportPreview({ triangles, size, name, diagnostics, conformance, approximateSource, achievedTolerance, componentCount, onDownload, onCancel }: {
  triangles: number; size: number; name: string;
  diagnostics: ExportDiagnostics;
  conformance: ExportConformance;
  approximateSource: boolean;
  achievedTolerance?: number;
  componentCount?: number;
  onDownload: () => void; onCancel: () => void;
}) {
  const displayUnit = useViewportStore((s) => s.measurementUnit);
  const decimalPrecision = useViewportStore((s) => s.measurementPrecision);
  const fractionalDenominator = useViewportStore((s) => s.measurementFractionalDenominator);
  const surface = useRef<HTMLDivElement>(null);
  const profile = useManufacturingProfileStore();
  const outsideVolume = dimensionsOutsideBuildVolume(diagnostics.dimensions, profile);
  useDialogFocus(surface, onCancel);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onCancel}>
      <div ref={surface} role="dialog" aria-modal="true" aria-labelledby="export-ready-title" className="rounded-xl p-5 w-72 shadow-xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }} onClick={(e) => e.stopPropagation()}>
        <h3 id="export-ready-title" className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Export Ready</h3>
        <div className="space-y-2 mb-4">
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>File</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{name}</span>
          </div>
          {achievedTolerance !== undefined && <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>Surface tolerance</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>≤ {achievedTolerance.toPrecision(3)} mm</span>
          </div>}
          {componentCount !== undefined && componentCount > 1 && <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>Verified components</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{componentCount}</span>
          </div>}
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>Geometry fidelity</span>
            <span className="font-medium" style={{ color: conformance.status === 'verified' ? 'var(--accent-green)' : 'var(--warning, #f59e0b)' }}>
              {conformance.status === 'verified' ? 'Verified samples' : 'Inconclusive'}
            </span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>Maximum deviation</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{conformance.maxDeviation.toPrecision(3)} mm</span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>RMS deviation</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{conformance.rmsDeviation.toPrecision(3)} mm</span>
          </div>
          {conformance.status === 'inconclusive' && (
            <p role="alert" className="text-[11px] leading-relaxed rounded p-2" style={{ color: 'var(--warning, #f59e0b)', background: 'var(--bg-elevated)' }}>
              Bidirectional sampling could not verify this export within {conformance.tolerance.toPrecision(3)} mm. Download remains available for inspection.
            </p>
          )}
          <details className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <summary className="cursor-pointer select-none">Geometry verification details</summary>
            <div className="mt-2 space-y-1 font-mono">
              <p>mesh→source: max {conformance.meshToSourceMax.toPrecision(3)} mm, RMS {conformance.meshToSourceRms.toPrecision(3)} mm ({conformance.meshSamples} samples)</p>
              <p>source→mesh: max {conformance.sourceToMeshMax.toPrecision(3)} mm, RMS {conformance.sourceToMeshRms.toPrecision(3)} mm ({conformance.sourceSamples} samples)</p>
            </div>
          </details>
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>Dimensions</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
              {diagnostics.dimensions.map((value) => formatLength(value, { displayUnit, decimalPrecision, fractionalDenominator }, false)).join(' × ')}{displayUnit === 'ft-in' ? '' : ` ${displayUnit}`}
            </span>
          </div>
          <div className="flex justify-between text-[12px]">
            <span style={{ color: 'var(--text-muted)' }}>Mesh validity</span>
            <span className="font-medium" style={{ color: diagnostics.watertight ? 'var(--accent-green)' : 'var(--warning, #f59e0b)' }}>
              {diagnostics.watertight ? 'Watertight' : 'Needs review'}
            </span>
          </div>
          {!diagnostics.watertight && (
            <p role="alert" className="text-[11px] leading-relaxed rounded p-2" style={{ color: 'var(--text-secondary)', background: 'var(--bg-elevated)' }}>
              Measured on the exported mesh: {[
                diagnostics.boundaryEdges && `${diagnostics.boundaryEdges} boundary edges`,
                diagnostics.nonManifoldEdges && `${diagnostics.nonManifoldEdges} non-manifold edges`,
                diagnostics.inconsistentEdges && `${diagnostics.inconsistentEdges} inconsistently wound edges`,
                diagnostics.degenerateTriangles && `${diagnostics.degenerateTriangles} repeated-index triangles`,
                diagnostics.zeroAreaTriangles && `${diagnostics.zeroAreaTriangles} zero-area triangles`,
                diagnostics.invalidIndices && `${diagnostics.invalidIndices} invalid indices`,
                diagnostics.nonFiniteVertices && `${diagnostics.nonFiniteVertices} non-finite vertices`,
              ].filter(Boolean).join(', ')}. Download remains available for inspection.
            </p>
          )}
          {approximateSource && (
            <p role="alert" className="text-[11px] leading-relaxed rounded p-2" style={{ color: 'var(--warning, #f59e0b)', background: 'var(--bg-elevated)' }}>
              Source includes an imported mesh. Edge topology was verified, but
              self-intersections were not; this export uses ray-parity approximation.
            </p>
          )}
          {outsideVolume && (
            <p role="alert" className="text-[11px] leading-relaxed rounded p-2" style={{ color: 'var(--warning, #f59e0b)', background: 'var(--bg-elevated)' }}>
              Part exceeds the configured {profile.buildVolume.join(' × ')} mm build volume.
            </p>
          )}
          <details className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <summary className="cursor-pointer select-none">Print profile</summary>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <ProfileInput label="Nozzle" value={profile.nozzleDiameter} onChange={(nozzleDiameter) => profile.updateProfile({ nozzleDiameter })} />
              <ProfileInput label="Layer" value={profile.layerHeight} onChange={(layerHeight) => profile.updateProfile({ layerHeight })} />
              <ProfileInput label="Tolerance" value={profile.tolerance} onChange={(tolerance) => profile.updateProfile({ tolerance })} />
              {profile.buildVolume.map((value, axis) => (
                <ProfileInput key={axis} label={`Build ${'XYZ'[axis]}`} value={value} onChange={(next) => {
                  const buildVolume = [...profile.buildVolume] as [number, number, number];
                  buildVolume[axis] = next;
                  profile.updateProfile({ buildVolume });
                }} />
              ))}
            </div>
            <p className="mt-2" style={{ color: 'var(--text-muted)' }}>Advisory values in millimeters. Thickness and overhang analysis are resolution dependent.</p>
          </details>
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
          <button onClick={onCancel} className="flex-1 px-3 py-1.5 rounded text-[12px] font-medium tap-h"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
            Cancel
          </button>
          <button onClick={onDownload} className="flex-1 px-3 py-1.5 rounded text-[12px] font-medium tap-h"
                  style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1">
      <span>{label} (mm)</span>
      <input type="number" min="0.01" step="0.01" value={value}
             onChange={(event) => onChange(Number(event.target.value))}
             className="w-full rounded px-2 py-1 font-mono"
             style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }} />
    </label>
  );
}
