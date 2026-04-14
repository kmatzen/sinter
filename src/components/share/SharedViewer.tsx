import { useEffect, useRef, useState } from 'react';
import { ThreeEngine } from '../../engine/ThreeEngine';
import { useModelerStore } from '../../store/modelerStore';
import { useEvaluator } from '../../engine/useEvaluator';

export function SharedViewer({ token, onOpenEditor }: { token: string; onOpenEditor: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setEngine] = useState<ThreeEngine | null>(null);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEvaluator();

  // Fetch shared project
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/projects/shared/${token}`);
        if (!res.ok) {
          setError(res.status === 404 ? 'Project not found or link expired' : 'Failed to load');
          setLoading(false);
          return;
        }
        const data = await res.json();
        setProjectName(data.name || 'Untitled');
        const store = useModelerStore.getState();
        if (data.tree_json) {
          const tree = typeof data.tree_json === 'string' ? JSON.parse(data.tree_json) : data.tree_json;
          store.setTree(tree);
        }
      } catch {
        setError('Failed to load shared project');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  // Init engine
  useEffect(() => {
    if (!containerRef.current) return;
    const eng = new ThreeEngine(containerRef.current);
    setEngine(eng);
    return () => { eng.dispose(); setEngine(null); };
  }, []);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center" style={{ background: 'var(--bg-deep)' }}>
        <div className="text-center">
          <div className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            {error}
          </div>
          <a
            href="/"
            className="text-sm underline"
            style={{ color: 'var(--accent)' }}
          >
            Go to Sinter
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
      {/* Minimal header */}
      <div className="h-11 flex items-center px-4 gap-3 shrink-0" style={{ background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-subtle)' }}>
        <a href="/" className="flex items-center gap-2" title="Go to Sinter">
          <img src="/logo-64.png" alt="Sinter" className="w-5 h-5 rounded" />
          <span className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Sinter</span>
        </a>
        <div className="w-px h-4" style={{ background: 'var(--border-default)' }} />
        <span className="text-sm font-medium">{projectName}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
          Read-only
        </span>
        <div className="flex-1" />
        <button
          onClick={() => {
            // Set project name so the modeler picks it up; tree is already in store
            useModelerStore.getState().setProjectName(projectName);
            localStorage.setItem('sinter_launched', '1');
            window.history.replaceState({}, '', '/app');
            onOpenEditor();
          }}
          className="text-[11px] px-3 py-1 rounded font-medium cursor-pointer"
          style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
        >
          Open in Editor
        </button>
      </div>

      {/* Viewport */}
      <div className="flex-1 relative min-h-0 overflow-hidden">
        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, #252538 0%, #111118 100%)' }} />
        <div ref={containerRef} className="absolute inset-0" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-8 h-8 border-2 rounded-full animate-spin"
                 style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
          </div>
        )}
      </div>
    </div>
  );
}
