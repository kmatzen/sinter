import { useViewportStore } from '../../store/viewportStore';
import { triggerDownload } from '../../utils/download';
import { Move, RotateCcw, Magnet, Camera, Ruler, Scissors, Scaling, Crosshair, Plus, Trash2, Scan } from 'lucide-react';
import type { ThreeEngine } from '../../engine/ThreeEngine';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import type { StandardView } from '../../engine/cameraViews';
import { formatLength } from '../../types/units';

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

function OrientationWidget({ engine }: { engine: ThreeEngine | null }) {
  const [axes, setAxes] = useState(() => ({ x: [50, 32], y: [32, 14], z: [32, 32] } as Record<'x' | 'y' | 'z', number[]>));
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!engine || typeof engine.viewQuaternion !== 'function' || typeof engine.onFrame !== 'function') return;
    const update = () => {
      const inverse = new THREE.Quaternion(...engine.viewQuaternion()).invert();
      const project = (axis: THREE.Vector3) => {
        const value = axis.applyQuaternion(inverse);
        return [32 + value.x * 19, 32 - value.y * 19];
      };
      setAxes({ x: project(new THREE.Vector3(1, 0, 0)), y: project(new THREE.Vector3(0, 1, 0)), z: project(new THREE.Vector3(0, 0, 1)) });
    };
    update();
    return engine.onFrame(update);
  }, [engine]);
  return (
    <div
      aria-label="Orientation widget; drag to orbit"
      className="absolute top-3 right-3 hidden sm:block w-16 h-16 rounded-lg touch-none"
      style={{ background: 'rgba(16,16,24,0.7)' }}
      onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.x; const dy = event.clientY - drag.current.y;
        drag.current.x = event.clientX; drag.current.y = event.clientY;
        engine?.orbitFromWidget(dx, dy);
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <svg aria-hidden="true" className="absolute inset-0" viewBox="0 0 64 64">
        {(['x', 'y', 'z'] as const).map((axis) => <line key={axis} x1="32" y1="32" x2={axes[axis][0]} y2={axes[axis][1]} stroke={axis === 'x' ? '#ef4444' : axis === 'y' ? '#22c55e' : '#3b82f6'} strokeWidth="2" />)}
      </svg>
      {([['x', 'right'], ['y', 'top'], ['z', 'front']] as const).map(([axis, view]) => (
        <button key={axis} aria-label={`${view[0].toUpperCase()}${view.slice(1)} view`} title={`${view} view`}
          className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full text-[9px] font-bold text-white"
          style={{ left: axes[axis][0], top: axes[axis][1], background: axis === 'x' ? '#b91c1c' : axis === 'y' ? '#15803d' : '#1d4ed8' }}
          onPointerDown={(event) => event.stopPropagation()} onClick={() => engine?.setStandardView(view)}>{axis.toUpperCase()}</button>
      ))}
    </div>
  );
}

export function ViewportToolbar({ engine }: { engine: ThreeEngine | null }) {
  const [selectedNamedViewId, setSelectedNamedViewId] = useState('');
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
  const gizmoPivot = useViewportStore((s) => s.gizmoPivot);
  const setGizmoPivot = useViewportStore((s) => s.setGizmoPivot);
  const customPivot = useViewportStore((s) => s.customPivot);
  const setCustomPivot = useViewportStore((s) => s.setCustomPivot);
  const snapEnabled = useViewportStore((s) => s.snapEnabled);
  const toggleSnap = useViewportStore((s) => s.toggleSnap);
  const snapSize = useViewportStore((s) => s.snapSize);
  const setSnapSize = useViewportStore((s) => s.setSnapSize);
  const objectSnapEnabled = useViewportStore((s) => s.objectSnapEnabled);
  const toggleObjectSnap = useViewportStore((s) => s.toggleObjectSnap);
  const snapIndicator = useViewportStore((s) => s.snapIndicator);
  const displayUnit = useViewportStore((s) => s.measurementUnit);
  const decimalPrecision = useViewportStore((s) => s.measurementPrecision);
  const fractionalDenominator = useViewportStore((s) => s.measurementFractionalDenominator);
  const showDimensions = useViewportStore((s) => s.showDimensions);
  const toggleDimensions = useViewportStore((s) => s.toggleDimensions);
  const measurementMode = useViewportStore((s) => s.measurementMode);
  const toggleMeasurementMode = useViewportStore((s) => s.toggleMeasurementMode);
  const projection = useViewportStore((s) => s.projection);
  const setProjection = useViewportStore((s) => s.setProjection);
  const namedViews = useViewportStore((s) => s.namedViews);
  const addNamedView = useViewportStore((s) => s.addNamedView);
  const removeNamedView = useViewportStore((s) => s.removeNamedView);

  return (
    <>
      {/*
        Top left — gizmo, snap, dimensions.

        Wraps rather than overflowing: at 44px per button the gizmo triad, the
        snap group with its three sizes, and the dimensions toggle add up to
        more than an iPhone SE is wide. `right-3` gives the wrap something to
        wrap against, and `pl-safe` keeps it clear of a landscape notch.
      */}
      <div className="absolute top-3 left-3 right-3 sm:right-20 flex flex-wrap items-start gap-1.5 pointer-events-none [&>*]:pointer-events-auto pl-safe">
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

        <VpBtn active={objectSnapEnabled} onClick={toggleObjectSnap} title="Snap to objects, bounds, and world origin">
          <Scan size={ICON} />
        </VpBtn>
        {snapIndicator && (
          <div role="status" className="tap-h flex items-center rounded-lg px-2 text-[10px]" style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}>
            Snapped to {snapIndicator.label}
          </div>
        )}

        <BtnGroup>
          <select
            value={gizmoPivot}
            aria-label="Transform pivot"
            title="Transform pivot"
            onChange={(event) => setGizmoPivot(event.target.value as typeof gizmoPivot)}
            className="h-7 tap-h max-w-28 rounded bg-transparent px-1 text-[10px]"
            style={{ color: 'var(--text-muted)' }}
          >
            <option value="object-origin">Object origin</option>
            <option value="bounds-center">Primary bounds</option>
            <option value="selection-center">Selection center</option>
            <option value="custom">Custom pivot</option>
          </select>
          {gizmoPivot === 'custom' && (['x', 'y', 'z'] as const).map((axis, index) => (
            <label key={axis} className="flex items-center text-[9px] uppercase" style={{ color: 'var(--text-muted)' }}>
              {axis}
              <input
                type="number"
                aria-label={`Custom pivot ${axis.toUpperCase()}`}
                value={customPivot[index]}
                step="any"
                onChange={(event) => {
                  const next = [...customPivot] as [number, number, number];
                  next[index] = Number(event.target.value);
                  setCustomPivot(next);
                }}
                className="ml-0.5 h-7 w-14 tap-h rounded px-1 text-[10px]"
                style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
              />
            </label>
          ))}
        </BtnGroup>

        <BtnGroup>
          <SmallBtn active={snapEnabled} onClick={toggleSnap} title="Snap to grid">
            <Magnet size={ICON} />
          </SmallBtn>
          {snapEnabled && (
            <>
              {[1, 5, 10].map((s) => (
                <SmallBtn key={s} active={snapSize === s} onClick={() => setSnapSize(s)} title={`Snap size: ${formatLength(s, { displayUnit, decimalPrecision, fractionalDenominator })}`}>
                  {formatLength(s, { displayUnit, decimalPrecision, fractionalDenominator }, false)}
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
        <BtnGroup>
          <select
            defaultValue=""
            aria-label="Standard view"
            title="Standard view"
            onChange={(event) => {
              if (event.target.value) engine?.setStandardView(event.target.value as StandardView);
              event.target.value = '';
            }}
            className="h-7 tap-h rounded bg-transparent text-[10px] px-1"
            style={{ color: 'var(--text-muted)' }}
          >
            <option value="" disabled>View</option>
            <option value="isometric">Isometric</option>
            <option value="front">Front</option>
            <option value="back">Back</option>
            <option value="right">Right</option>
            <option value="left">Left</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
          </select>
          <SmallBtn onClick={() => engine?.zoomToFit()} title="Frame all">A</SmallBtn>
          <SmallBtn onClick={() => engine?.frameSelection()} title="Frame selection">S</SmallBtn>
          <SmallBtn
            active={projection === 'orthographic'}
            onClick={() => setProjection(projection === 'perspective' ? 'orthographic' : 'perspective')}
            title={`Projection: ${projection}. Switch to ${projection === 'perspective' ? 'orthographic' : 'perspective'}`}
          >{projection === 'perspective' ? 'P' : 'O'}</SmallBtn>
        </BtnGroup>
        <BtnGroup>
          <select
            value={selectedNamedViewId}
            aria-label="Named view"
            title="Named project views"
            onChange={(event) => {
              const view = namedViews.find((item) => item.id === event.target.value);
              if (view) engine?.applyNamedView(view);
              setSelectedNamedViewId(event.target.value);
            }}
            className="h-7 tap-h max-w-28 rounded bg-transparent text-[10px] px-1"
            style={{ color: 'var(--text-muted)' }}
          >
            <option value="" disabled>Saved views</option>
            {namedViews.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
          </select>
          <SmallBtn onClick={() => {
            if (!engine) return;
            const name = window.prompt('Name this project view:')?.trim();
            if (name) {
              const view = engine.captureNamedView(name);
              addNamedView(view);
              setSelectedNamedViewId(view.id);
            }
          }} title="Save current view"><Plus size={ICON} /></SmallBtn>
          {selectedNamedViewId && <SmallBtn onClick={() => {
            removeNamedView(selectedNamedViewId);
            setSelectedNamedViewId('');
          }} title="Delete selected named view"><Trash2 size={ICON} /></SmallBtn>}
        </BtnGroup>
      </div>
      <OrientationWidget engine={engine} />

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
