import { useRef, useEffect, useState } from 'react';
import { ThreeEngine } from '../../engine/ThreeEngine';
import { ViewportToolbar } from './ViewportToolbar';
import { ShortcutOverlay } from './ShortcutOverlay';
import { DimensionLabels } from './DimensionLabels';
import { useModelerStore } from '../../store/modelerStore';
import { setEngineRef } from '../../engine/engineRef';

export function Viewport() {
  const evaluating = useModelerStore((s) => s.evaluating);
  const error = useModelerStore((s) => s.error);
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<ThreeEngine | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const eng = new ThreeEngine(containerRef.current);
    setEngine(eng);
    setEngineRef(eng);
    return () => {
      eng.dispose();
      setEngine(null);
      setEngineRef(null);
    };
  }, []);

  return (
    <div className="flex-1 relative min-w-0 overflow-hidden">
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 50% 40%, #252538 0%, #111118 100%)' }} />
      <div ref={containerRef} className="absolute inset-0" />

      <DimensionLabels engine={engine} />
      <ViewportToolbar engine={engine} />
      <ShortcutOverlay />

      {/* Evaluating overlay — centered spinner on the shape */}
      {evaluating && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-8 h-8 border-2 rounded-full animate-spin"
               style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      )}
      {error && (
        <div className="absolute bottom-3 left-3 right-60 bg-red-900/90 px-3 py-2 rounded text-sm text-red-200">
          {error}
        </div>
      )}
    </div>
  );
}
