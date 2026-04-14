import { useState, useEffect } from 'react';
import { isDirty, markClean } from '../../store/localPersist';
import { useModelerStore } from '../../store/modelerStore';
import { useAuthStore } from '../../store/authStore';
import { useProjectStore } from '../../store/projectStore';
import { workerBridge } from '../../engine/workerBridge';
import { triggerDownload } from '../../utils/download';
import { useChatStore } from '../../store/chatStore';
import { ProjectList } from '../projects/ProjectList';
import { ImportProject } from '../projects/ImportProject';
import { features } from '../../config';
import { UsageBadge } from '../billing/UsageBadge';
import { SettingsPage } from '../settings/SettingsPage';
import { FolderOpen, Save, Undo2, Redo2, MessageSquare, FileDown, FilePlus, Share2, Link } from 'lucide-react';

export function Toolbar() {
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
  const loadProject = useProjectStore((s) => s.loadProject);
  const createProject = useProjectStore((s) => s.createProject);
  const shareToken = useProjectStore((s) => s.shareToken);
  const toggleShare = useProjectStore((s) => s.toggleShare);
  const projectId = useProjectStore((s) => s.projectId);
  const [showProjects, setShowProjects] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  // Track dirty state
  useEffect(() => {
    const check = () => setDirty(isDirty());
    const unsub = useModelerStore.subscribe(check);
    check();
    return unsub;
  }, []);

  const handleExportSTL = async () => {
    if (!tree || exporting) return;
    setExporting('STL');
    try {
      const blob = await workerBridge.exportSTL(tree);
      triggerDownload(blob, `${projectName}.stl`);
    } catch (err: any) {
      console.error('Export STL failed:', err);
    } finally {
      setExporting(null);
    }
  };

  const handleExport3MF = async () => {
    if (!tree || exporting) return;
    setExporting('3MF');
    try {
      const blob = await workerBridge.export3MF(tree);
      triggerDownload(blob, `${projectName}.3mf`);
    } catch (err: any) {
      console.error('Export 3MF failed:', err);
    } finally {
      setExporting(null);
    }
  };

  const handleSaveCloud = async () => { await save(); markClean(); setDirty(false); };

  return (
    <>
    <div className="h-11 flex items-center px-3 gap-2 shrink-0"
         style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2">
        <img src="/logo-64.png" alt="Sinter" className="w-5 h-5 rounded cursor-pointer"
             onClick={() => window.dispatchEvent(new Event('show-landing'))}
             title="Back to home" />
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project name"
          className="bg-transparent border-none text-sm font-medium w-32 focus:outline-none rounded px-1"
          style={{ color: 'var(--text-primary)' }}
        />
      </div>
      <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
      <IconBtn icon={<FilePlus size={14} />} title="New project" onClick={() => { useModelerStore.getState().setTree(null); useModelerStore.getState().setProjectName('Untitled'); }} />
      {features.cloudStorage && <IconBtn icon={<FolderOpen size={14} />} title="Projects" onClick={() => setShowProjects(true)} />}
      {features.cloudStorage && <IconBtn icon={<Save size={14} />} title={saving ? 'Saving...' : 'Save to cloud'} onClick={handleSaveCloud} disabled={saving || !dirty} />}
      {features.sharing && projectId && (
        shareToken ? (
          <IconBtn
            icon={<Link size={14} />}
            label={copied ? 'Copied!' : 'Shared'}
            title="Click to copy share link, Shift+click to revoke"
            onClick={() => {
              // Shift+click revokes the share
              if ((window.event as MouseEvent)?.shiftKey) {
                toggleShare();
                return;
              }
              const url = `${window.location.origin}/share/${shareToken}`;
              navigator.clipboard.writeText(url).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          />
        ) : (
          <IconBtn icon={<Share2 size={14} />} title="Create share link" onClick={toggleShare} />
        )
      )}
      <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
      <IconBtn icon={<Undo2 size={14} />} title="Undo" onClick={undo} />
      <IconBtn icon={<Redo2 size={14} />} title="Redo" onClick={redo} />
      <div className="flex-1" />
      <IconBtn icon={<FileDown size={14} />} label={exporting === 'STL' ? 'Exporting...' : 'STL'} title="Export STL" onClick={handleExportSTL} disabled={evaluating || !tree || !!exporting} />
      <IconBtn icon={<FileDown size={14} />} label={exporting === '3MF' ? 'Exporting...' : '3MF'} title="Export 3MF" onClick={handleExport3MF} disabled={evaluating || !tree || !!exporting} />
      <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
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
      <div className="w-px h-4 mx-1" style={{ background: 'var(--border-default)' }} />
      <UsageBadge />
      {features.auth && !user && (
        <a href="/app"
           onClick={() => localStorage.removeItem('sinter_launched')}
           className="text-[11px] px-3 py-1 rounded font-medium"
           style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
        >
          Sign In
        </a>
      )}
      {features.auth && user && (
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

    {saveError && (
      <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2 rounded-lg shadow-lg text-sm"
           style={{ background: 'var(--accent-red)', color: '#fff' }}>
        <span>{saveError}</span>
        <button onClick={clearSaveError} className="ml-2 opacity-70 hover:opacity-100">&times;</button>
      </div>
    )}

    {showProjects && (
      <ProjectList
        onSelect={async (id) => { await loadProject(id); setShowProjects(false); }}
        onNew={async () => { await createProject(); setShowProjects(false); }}
        onClose={() => setShowProjects(false)}
        onImport={() => { setShowProjects(false); setShowImport(true); }}
      />
    )}
    {showImport && (
      <ImportProject onDone={() => setShowImport(false)} />
    )}
    {showSettings && (
      <SettingsPage onClose={() => setShowSettings(false)} />
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
