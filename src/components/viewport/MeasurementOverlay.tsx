import { useEffect, useMemo, useState } from 'react';
import { Copy, Pin, RotateCcw, Trash2, X } from 'lucide-react';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { nodeWorldBounds } from '../../engine/nodeBounds';
import {
  exactRadialMeasurement,
  findMeasurementNode,
  formatMeasurement,
  makeAnchor,
  measurePoints,
  resolveMeasurementAnchors,
  type MeasurementAnchor,
  type Point3,
} from '../../types/measurement';
import type { DisplayUnit } from '../../types/units';

function validAnchors(tree: ReturnType<typeof useModelerStore.getState>['tree'], anchors: MeasurementAnchor[]) {
  return resolveMeasurementAnchors(tree, anchors) !== null;
}

function measurementText(
  tree: ReturnType<typeof useModelerStore.getState>['tree'], anchors: MeasurementAnchor[],
  unit: DisplayUnit, precision: number, denominator: 2 | 4 | 8 | 16 | 32 | 64,
) {
  const points = resolveMeasurementAnchors(tree, anchors);
  if (!points) return '';
  const result = measurePoints(points);
  const lines = result.points.map((point, index) =>
    `Point ${index + 1}: ${point.map((value) => formatMeasurement(value, unit, precision, denominator)).join(', ')}`,
  );
  if (result.distance !== undefined) lines.push(`Distance: ${formatMeasurement(result.distance, unit, precision, denominator)}`);
  if (result.delta) lines.push(`Delta: ${result.delta.map((value) => formatMeasurement(value, unit, precision, denominator)).join(', ')}`);
  if (result.angle !== undefined) lines.push(`Angle: ${result.angle.toFixed(precision)}°`);
  return lines.join('\n');
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-muted)' }}>{label}</span><span className="font-mono">{value}</span></div>;
}

export function MeasurementOverlay() {
  const tree = useModelerStore((state) => state.tree);
  const display = useModelerStore((state) => state.sdfDisplay);
  const mode = useViewportStore((state) => state.measurementMode);
  const anchors = useViewportStore((state) => state.measurementPoints);
  const pinned = useViewportStore((state) => state.pinnedMeasurements);
  const unit = useViewportStore((state) => state.measurementUnit);
  const precision = useViewportStore((state) => state.measurementPrecision);
  const denominator = useViewportStore((state) => state.measurementFractionalDenominator);
  const clear = useViewportStore((state) => state.clearMeasurement);
  const undo = useViewportStore((state) => state.removeMeasurementPoint);
  const pin = useViewportStore((state) => state.pinMeasurement);
  const removePinned = useViewportStore((state) => state.removePinnedMeasurement);
  const addPoint = useViewportStore((state) => state.addMeasurementPoint);
  const setUnit = useViewportStore((state) => state.setMeasurementUnit);
  const setPrecision = useViewportStore((state) => state.setMeasurementPrecision);
  const setDenominator = useViewportStore((state) => state.setMeasurementFractionalDenominator);
  const toggleMode = useViewportStore((state) => state.toggleMeasurementMode);
  const [copied, setCopied] = useState(false);

  const structuralBounds = useMemo(() => tree ? nodeWorldBounds(tree, tree.id) : null, [tree]);
  const min = structuralBounds?.min ?? display?.bbMin;
  const max = structuralBounds?.max ?? display?.bbMax;
  const currentPoints = useMemo(() => resolveMeasurementAnchors(tree, anchors), [tree, anchors]);
  const current = useMemo(() => measurePoints(currentPoints ?? []), [currentPoints]);
  const currentValid = currentPoints !== null;
  const sourceNode = anchors.length ? findMeasurementNode(tree, anchors[anchors.length - 1].nodeId) : null;
  const radial = exactRadialMeasurement(sourceNode);

  useEffect(() => {
    if (!mode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'Escape') { event.preventDefault(); toggleMode(); }
      if ((event.key === 'Backspace' || event.key === 'Delete') && anchors.length) { event.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, anchors.length, toggleMode, undo]);

  if (!mode && pinned.length === 0) return null;

  const addBound = (point: Point3) => {
    if (!tree || !min || !max) return;
    addPoint(makeAnchor(point, tree.id, min, max, { path: [tree.id], patternInstances: {}, mirrorSigns: {} }, point));
  };
  const copy = async () => {
    if (!currentValid || anchors.length === 0) return;
    await navigator.clipboard.writeText(measurementText(tree, anchors, unit, precision, denominator));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <aside aria-label="Measurements" className="absolute z-20 top-14 left-3 w-72 max-w-[calc(100%_-_1.5rem)] rounded-lg p-3 text-[11px] pointer-events-auto shadow-lg"
           style={{ background: 'rgba(16,16,24,0.94)', border: '1px solid var(--border-default)', color: 'var(--text-secondary)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <strong className="text-xs" style={{ color: 'var(--text-primary)' }}>Measurements</strong>
        {mode && <button aria-label="Close measurement tool" onClick={toggleMode} className="p-1 rounded"><X size={13} /></button>}
      </div>

      {mode && (
        <>
          <p role="status" className="mb-2" style={{ color: 'var(--accent)' }}>
            {anchors.length === 0 ? 'Pick the first surface point.' : anchors.length === 1 ? 'Point 1 set — pick the second point.' : 'Pick a third point for an angle, or pin this measurement.'}
          </p>
          {!currentValid && anchors.length > 0 ? (
            <p role="alert" className="mb-2" style={{ color: 'var(--accent-red)' }}>A target was deleted. Clear and pick it again.</p>
          ) : (
            <div className="space-y-1 mb-2">
              {current.points.map((point, index) => <Metric key={index} label={`P${index + 1}`} value={point.map((v) => formatMeasurement(v, unit, precision, denominator)).join(', ')} />)}
              {current.distance !== undefined && <Metric label="Distance" value={formatMeasurement(current.distance, unit, precision, denominator)} />}
              {current.delta && <Metric label="Δ X / Y / Z" value={current.delta.map((v) => formatMeasurement(v, unit, precision, denominator)).join(' / ')} />}
              {current.angle !== undefined && <Metric label="Angle" value={`${current.angle.toFixed(precision)}°`} />}
              {radial && <Metric label={`${radial.label} diameter*`} value={formatMeasurement(radial.diameter, unit, precision, denominator)} />}
            </div>
          )}
          <p className="mb-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Surface picks are viewport approximations. *Primitive values are exact source parameters before ancestor transforms.
          </p>
          {min && max && tree && (
            <div className="flex flex-wrap gap-1 mb-2" aria-label="Keyboard measurement targets">
              <button className="px-2 py-1 rounded" style={{ background: 'var(--bg-elevated)' }} onClick={() => addBound([...min] as Point3)}>Bounds min</button>
              <button className="px-2 py-1 rounded" style={{ background: 'var(--bg-elevated)' }} onClick={() => addBound([...max] as Point3)}>Bounds max</button>
              <button className="px-2 py-1 rounded" style={{ background: 'var(--bg-elevated)' }} onClick={() => addBound(min.map((v, i) => (v + max[i]) / 2) as Point3)}>Center</button>
            </div>
          )}
          <div className="flex flex-wrap gap-1 mb-3">
            <button onClick={undo} disabled={!anchors.length} aria-label="Undo measurement point" className="p-1.5 rounded disabled:opacity-40" style={{ background: 'var(--bg-elevated)' }}><RotateCcw size={12} /></button>
            <button onClick={clear} disabled={!anchors.length} aria-label="Clear measurement" className="p-1.5 rounded disabled:opacity-40" style={{ background: 'var(--bg-elevated)' }}><Trash2 size={12} /></button>
            <button onClick={pin} disabled={!anchors.length || !currentValid} className="px-2 py-1 rounded flex items-center gap-1 disabled:opacity-40" style={{ background: 'var(--bg-elevated)' }}><Pin size={12} /> Pin</button>
            <button onClick={() => void copy()} disabled={!anchors.length || !currentValid} className="px-2 py-1 rounded flex items-center gap-1 disabled:opacity-40" style={{ background: 'var(--bg-elevated)' }}><Copy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
            <select aria-label="Measurement units" value={unit} onChange={(event) => setUnit(event.target.value as DisplayUnit)} className="rounded px-1" style={{ background: 'var(--bg-elevated)' }}>
              <option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option><option value="in">in</option><option value="ft-in">ft / in</option>
            </select>
            {unit === 'ft-in' ? (
              <select aria-label="Measurement fraction precision" value={denominator} onChange={(event) => setDenominator(Number(event.target.value) as 2 | 4 | 8 | 16 | 32 | 64)} className="rounded px-1" style={{ background: 'var(--bg-elevated)' }}>
                {[2,4,8,16,32,64].map((n) => <option key={n} value={n}>nearest 1/{n}″</option>)}
              </select>
            ) : <select aria-label="Measurement precision" value={precision} onChange={(event) => setPrecision(Number(event.target.value))} className="rounded px-1" style={{ background: 'var(--bg-elevated)' }}>{[0,1,2,3,4,5,6].map((n) => <option key={n} value={n}>{n} decimals</option>)}</select>}
          </div>
        </>
      )}

      {pinned.length > 0 && <div className="space-y-1.5 border-t pt-2" style={{ borderColor: 'var(--border-subtle)' }}>
        {pinned.map((item, index) => {
          const valid = validAnchors(tree, item.anchors);
          const points = valid ? resolveMeasurementAnchors(tree, item.anchors) : null;
          const result = points ? measurePoints(points) : null;
          const radial = valid ? exactRadialMeasurement(findMeasurementNode(tree, item.anchors[item.anchors.length - 1]?.nodeId)) : null;
          const summary = result?.distance !== undefined
            ? formatMeasurement(result.distance, unit, precision, denominator)
            : radial ? `${radial.label} ⌀ ${formatMeasurement(radial.diameter, unit, precision, denominator)}` : 'Point saved';
          return <div key={item.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5" style={{ background: 'var(--bg-elevated)' }}>
            <span>{valid ? `#${index + 1}: ${summary}` : `#${index + 1}: target deleted — re-pick`}</span>
            <button aria-label={`Remove pinned measurement ${index + 1}`} onClick={() => removePinned(item.id)}><X size={12} /></button>
          </div>;
        })}
      </div>}
    </aside>
  );
}
