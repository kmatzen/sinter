import { useViewportStore } from '../../store/viewportStore';
import { triggerDownload } from '../../utils/download';
import { Move, RotateCcw, Magnet, Camera, Ruler, Scissors, Scaling, Crosshair } from 'lucide-react';
import type { ThreeEngine } from '../../engine/ThreeEngine';
import type { ReactNode } from 'react';

const BTN = 'w-7 h-7 tap rounded flex items-center justify-center transition-colors';
const ICON = 13;

function VpBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg px-1 py-0.5" style={{ background: 'rgba(16,16,24,0.7)' }}>
      <button
        onClick={onClick}
        title={title}
        aria-label={title}
        aria-pressed={active}
        className={BTN}
        style={{
          background: active ? 'var(--accent)' : 'transparent',
          color: active ? 'var(--bg-deep)' : 'var(--text-muted)',
        }}
        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? 'var(--accent)' : 'transparent'; }}
      >
        {children}
      </button>
    </div>
  );
}

function BtnGroup({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-center gap-0.5 rounded-lg px-1 py-0.5"
      style={{ background: 'rgba(16,16,24,0.7)' }}
    >
      {children}
    </div>
  );
}

function SmallBtn({ active, onClick, title, children }: { active?: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className="w-7 h-7 tap rounded flex items-center justify-center text-[10px] font-medium transition-colors"
      style={{
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--bg-deep)' : 'var(--text-muted)',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--bg-hover)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = active ? 'var(--accent)' : 'transparent'; }}
    >
      {children}
    </button>
  );
}

export function ViewportToolbar({ engine }: { engine: ThreeEngine | null }) {
  const clipEnabled = useViewportStore((s) => s.clipEnabled);
  const toggleClip = useViewportStore((s) => s.toggleClip);
  const clipAxis = useViewportStore((s) => s.clipAxis);
  const setClipAxis = useViewportStore((s) => s.setClipAxis);
  const clipFlip = useViewportStore((s) => s.clipFlip);
  const setClipFlip = useViewportStore((s) => s.setClipFlip);
  const clipPosition = useViewportStore((s) => s.clipPosition);
  const setClipPosition = useViewportStore((s) => s.setClipPosition);
  const gizmoMode = useViewportStore((s) => s.gizmoMode);
  const setGizmoMode = useViewportStore((s) => s.setGizmoMode);
  const gizmoSpace = useViewportStore((s) => s.gizmoSpace);
  const toggleGizmoSpace = useViewportStore((s) => s.toggleGizmoSpace);
  const snapEnabled = useViewportStore((s) => s.snapEnabled);
  const toggleSnap = useViewportStore((s) => s.toggleSnap);
  const snapSize = useViewportStore((s) => s.snapSize);
  const setSnapSize = useViewportStore((s) => s.setSnapSize);
  const showDimensions = useViewportStore((s) => s.showDimensions);
  const toggleDimensions = useViewportStore((s) => s.toggleDimensions);
  const measurementMode = useViewportStore((s) => s.measurementMode);
  const toggleMeasurementMode = useViewportStore((s) => s.toggleMeasurementMode);

  return (
    <>
      {/*
        Top left — gizmo, snap, dimensions.

        Wraps rather than overflowing: at 44px per button the gizmo triad, the
        snap group with its three sizes, and the dimensions toggle add up to
        more than an iPhone SE is wide. `right-3` gives the wrap something to
        wrap against, and `pl-safe` keeps it clear of a landscape notch.
      */}
      <div className="absolute top-3 left-3 right-3 flex flex-wrap items-start gap-1.5 pointer-events-none [&>*]:pointer-events-auto pl-safe">
        <BtnGroup>
          {([['translate', 'Move (W)', Move], ['rotate', 'Rotate (E)', RotateCcw], ['scale', 'Scale (R)', Scaling]] as const).map(([mode, title, Icon]) => (
            <SmallBtn
              key={mode}
              active={gizmoMode === mode}
              onClick={() => setGizmoMode(gizmoMode === mode ? 'none' : mode)}
              title={title}
            >
              <Icon size={ICON} />
            </SmallBtn>
          ))}
          <SmallBtn active={gizmoSpace === 'local'} onClick={toggleGizmoSpace} title={`Transform space: ${gizmoSpace}. Switch to ${gizmoSpace === 'world' ? 'local' : 'world'}`}>
            {gizmoSpace === 'world' ? 'W' : 'L'}
          </SmallBtn>
        </BtnGroup>

        <BtnGroup>
          <SmallBtn active={snapEnabled} onClick={toggleSnap} title="Snap to grid">
            <Magnet size={ICON} />
          </SmallBtn>
          {snapEnabled && (
            <>
              {[1, 5, 10].map((s) => (
                <SmallBtn key={s} active={snapSize === s} onClick={() => setSnapSize(s)} title={`Snap size: ${s}mm`}>
                  {s}
                </SmallBtn>
              ))}
            </>
          )}
        </BtnGroup>

        <VpBtn active={showDimensions} onClick={toggleDimensions} title="Dimensions">
          <Ruler size={ICON} />
        </VpBtn>
        <VpBtn active={measurementMode} onClick={toggleMeasurementMode} title="Measure surfaces">
          <Crosshair size={ICON} />
        </VpBtn>
      </div>

      {/* Bottom right — screenshot */}
      <div className="absolute bottom-3 right-3 pb-safe pr-safe">
        <VpBtn onClick={() => {
          if (!engine) return;
          engine.takeScreenshot((blob) => { if (blob) triggerDownload(blob, 'screenshot.png'); });
        }} title="Screenshot">
          <Camera size={ICON} />
        </VpBtn>
      </div>

      {/*
        Bottom left — tools + clip.

        `right-16` leaves the screenshot button its corner; without it the
        expanded clip row (six axis buttons, a slider and a readout) wraps
        straight under it. `pb-safe` keeps the row off the home indicator.
      */}
      <div className="absolute bottom-3 left-3 right-16 flex flex-wrap items-end gap-1.5 pointer-events-none [&>*]:pointer-events-auto pb-safe pl-safe">
        <VpBtn active={clipEnabled} onClick={toggleClip} title="Clipping plane">
          <Scissors size={ICON} />
        </VpBtn>

        {clipEnabled && (
          <BtnGroup>
            {(['x', 'y', 'z'] as const).flatMap((axis) =>
              ([false, true] as const).map((flip) => {
                const label = `${flip ? '\u2212' : '+'}${axis.toUpperCase()}`;
                const active = clipAxis === axis && clipFlip === flip;
                return (
                  <SmallBtn
                    key={label}
                    active={active}
                    onClick={() => { setClipAxis(axis); setClipFlip(flip); }}
                    title={`Clip ${flip ? 'negative' : 'positive'} ${axis.toUpperCase()}`}
                  >
                    {label}
                  </SmallBtn>
                );
              })
            )}
            <input
              type="range"
              min={-100}
              max={100}
              step={0.5}
              value={clipPosition}
              aria-label="Clip plane position"
              onChange={(e) => setClipPosition(parseFloat(e.target.value))}
              className="w-20 h-1 ml-1 tap-h"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span className="text-[10px] w-9 text-right font-mono" style={{ color: 'var(--text-muted)' }}>
              {clipPosition.toFixed(1)}
            </span>
          </BtnGroup>
        )}
      </div>
    </>
  );
}
