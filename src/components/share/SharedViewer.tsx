import { useEffect, useRef, useState } from 'react';
import { ThreeEngine } from '../../engine/ThreeEngine';
import { useModelerStore } from '../../store/modelerStore';
import { useEvaluator } from '../../engine/useEvaluator';
import { getStorageProvider, parseShareHash, type ProviderName } from '../../storage';
import { useProjectStore } from '../../store/projectStore';

export function SharedViewer({ onOpenEditor }: { onOpenEditor: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [, setEngine] = useState<ThreeEngine | null>(null);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEvaluator();

  useEffect(() => {
    const parsed = parseShareHash(window.location.hash);
    if (!parsed) {
      setError('Invalid share link');
      setLoading(false);
      return;
    }
    let cancelled = false;
    async function load(provider: ProviderName, id: string) {
      try {
        const storage = getStorageProvider(provider);
        const body = await storage.read(null, id);
        if (cancelled) return;
        const tree = body?.tree ?? null;
        useProjectStore.getState().loadLocalDocument('Shared project', tree, body.parameters);
        // Provider doesn't return the project name on anonymous read.
        // Best-effort fallback: leave it as "Shared project".
        setProjectName('Shared project');
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load shared project');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load(parsed.provider, parsed.id);
    return () => { cancelled = true; };
  }, []);

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
          <div className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>{error}</div>
          <a href="/" className="text-sm underline" style={{ color: 'var(--accent)' }}>Go to Sinter</a>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)' }}>
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
