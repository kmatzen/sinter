import { useRef, useEffect, useState } from 'react';
import { ThreeEngine } from '../../engine/ThreeEngine';
import { ViewportToolbar } from './ViewportToolbar';
import { ShortcutOverlay } from './ShortcutOverlay';
import { DimensionLabels } from './DimensionLabels';
import { SelectionOverlay } from './SelectionOverlay';
import { SelectionBreadcrumb } from './SelectionBreadcrumb';
import { useModelerStore } from '../../store/modelerStore';
import { setEngineRef } from '../../engine/engineRef';
import { ModelErrorNotice } from './ModelErrorNotice';
import { MeasurementOverlay } from './MeasurementOverlay';

export function Viewport() {
  const evaluating = useModelerStore((s) => s.evaluating);
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<ThreeEngine | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let eng: ThreeEngine;
    try {
      eng = new ThreeEngine(containerRef.current);
    } catch (error) {
      console.error('3D preview initialization failed:', error);
      setEngineError(error instanceof Error ? error.message : String(error));
      return;
    }
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

      {engineError && (
        <div role="alert" className="absolute inset-0 z-20 flex items-center justify-center p-6 text-center">
          <div className="max-w-md rounded-lg p-5" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}>
            <h2 className="text-sm font-medium mb-2">3D preview unavailable</h2>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Sinter needs WebGL 2 for its interactive preview. Enable hardware acceleration or update your browser and graphics driver, then reload. Your node tree remains editable and locally recoverable.
            </p>
            <details className="mt-3 text-left text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <summary>Technical detail</summary>
              <code className="block mt-1 break-all">{engineError}</code>
            </details>
          </div>
        </div>
      )}

      <SelectionOverlay engine={engine} />
      <DimensionLabels engine={engine} />
      <SelectionBreadcrumb />
      <MeasurementOverlay />
      <ViewportToolbar engine={engine} />
      <ShortcutOverlay />

      {/* Evaluating overlay — centered spinner on the shape */}
      {evaluating && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="w-8 h-8 border-2 rounded-full animate-spin"
               style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
        </div>
      )}
      <ModelErrorNotice />
    </div>
  );
}
