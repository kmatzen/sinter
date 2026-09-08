import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useModelerStore } from '../../store/modelerStore';
import { arcGeometry, profileLoopBoundsPoints, type PolygonProfile, type Vec2 } from '../../worker/sdf/profile';

interface Props {
  value?: string;
  fallback: string;
  revolve: boolean;
  validate: (value: string) => PolygonProfile;
  onCommit: (value: string) => void;
}

const serialize = (profile: PolygonProfile) => JSON.stringify(profile);
const clone = (profile: PolygonProfile): PolygonProfile => ({
  outer: profile.outer.map((p) => [...p]), holes: profile.holes.map((loop) => loop.map((p) => [...p])),
  ...(profile.bulges ? { bulges: [...profile.bulges] } : {}),
  ...(profile.holeBulges ? { holeBulges: profile.holeBulges.map((bulges) => [...bulges]) } : {}),
} as PolygonProfile);

function loopPath(loop: Vec2[], bulges: number[] = []): string {
  let path = `M ${loop[0][0]} ${-loop[0][1]}`;
  loop.forEach((a, i) => {
    const b = loop[(i + 1) % loop.length], bulge = bulges[i] || 0;
    if (!bulge) { path += ` L ${b[0]} ${-b[1]}`; return; }
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const sweep = 4 * Math.atan(bulge), radius = chord * (1 + bulge * bulge) / (4 * Math.abs(bulge));
    path += ` A ${radius} ${radius} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${bulge > 0 ? 1 : 0} ${b[0]} ${-b[1]}`;
  });
  return `${path} Z`;
}

function CommittedNumber({ label, value, min, onCommit }: { label: string; value: number; min?: number; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Math.round(value * 1000) / 1000));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  const commit = () => {
    const number = Number(draft);
    if (Number.isFinite(number) && (min === undefined || number >= min) && number !== value) onCommit(number);
    else setDraft(String(Math.round(value * 1000) / 1000));
  };
  return <label className="text-[10px]">{label}<input aria-label={label} type="number" min={min} value={draft} onChange={(event) => setDraft(event.target.value)}
    onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="w-full rounded px-1" /></label>;
}

export function ProfileEditor({ value, fallback, revolve, validate, onCommit }: Props) {
  const [profile, setProfile] = useState(() => {
    try { return validate(value || fallback); }
    catch { return validate(fallback); }
  });
  const [loopIndex, setLoopIndex] = useState(0);
  const [vertexIndex, setVertexIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const transaction = useRef(false);
  const dragCleanup = useRef<((commit: boolean) => void) | null>(null);

  useEffect(() => () => dragCleanup.current?.(false), []);

  useEffect(() => {
    try { setProfile(validate(value || fallback)); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid profile'); }
  }, [value, fallback, validate]);

  const loops = [profile.outer, ...profile.holes];
  const selectedLoopIndex = Math.min(loopIndex, loops.length - 1);
  const activeLoop = loops[selectedLoopIndex];
  const selectedVertexIndex = Math.min(vertexIndex, activeLoop.length - 1);
  const activeVertex = activeLoop[selectedVertexIndex];
  const activeBulges = selectedLoopIndex === 0 ? profile.bulges : profile.holeBulges?.[selectedLoopIndex - 1];
  const activeBulge = activeBulges?.[selectedVertexIndex] || 0;
  const points = loops.flatMap((loop, index) => profileLoopBoundsPoints(loop, index === 0 ? profile.bulges : profile.holeBulges?.[index - 1]));
  const bounds = useMemo(() => {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const width = Math.max(maxX - minX, 1), height = Math.max(maxY - minY, 1), pad = Math.max(width, height) * 0.12;
    return { minX, maxX, minY, maxY, width, height, pad };
  }, [profile]);

  const commitCandidate = (candidate: PolygonProfile) => {
    try {
      const checked = validate(serialize(candidate));
      setProfile(checked); setError(null); onCommit(serialize(checked));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid profile');
      return false;
    }
  };
  const updateVertex = (point: Vec2) => {
    const candidate = clone(profile);
    (selectedLoopIndex === 0 ? candidate.outer : candidate.holes[selectedLoopIndex - 1])[selectedVertexIndex] = point;
    commitCandidate(candidate);
  };
  const updateBulge = (bulge: number) => {
    const candidate = clone(profile);
    if (selectedLoopIndex === 0) {
      candidate.bulges ??= Array(candidate.outer.length).fill(0);
      candidate.bulges[selectedVertexIndex] = bulge;
    } else {
      candidate.holeBulges ??= candidate.holes.map((loop) => Array(loop.length).fill(0));
      candidate.holeBulges[selectedLoopIndex - 1][selectedVertexIndex] = bulge;
    }
    commitCandidate(candidate);
  };
  const scaleDimension = (axis: 0 | 1, nextSize: number) => {
    const oldSize = axis === 0 ? bounds.width : bounds.height;
    if (!Number.isFinite(nextSize) || nextSize <= 0 || oldSize <= 0) return;
    const center = revolve && axis === 0 ? bounds.minX : axis === 0 ? (bounds.minX + bounds.maxX) / 2 : (bounds.minY + bounds.maxY) / 2;
    const candidate = clone(profile);
    for (const loop of [candidate.outer, ...candidate.holes]) for (const point of loop) point[axis] = center + (point[axis] - center) * nextSize / oldSize;
    commitCandidate(candidate);
  };
  const addVertex = () => {
    const candidate = clone(profile), loop = selectedLoopIndex === 0 ? candidate.outer : candidate.holes[selectedLoopIndex - 1];
    const next = loop[(selectedVertexIndex + 1) % loop.length];
    const sourceBulges = selectedLoopIndex === 0 ? candidate.bulges : candidate.holeBulges?.[selectedLoopIndex - 1];
    const sourceBulge = sourceBulges?.[selectedVertexIndex] || 0;
    let midpoint: Vec2 = [(loop[selectedVertexIndex][0] + next[0]) / 2, (loop[selectedVertexIndex][1] + next[1]) / 2];
    if (sourceBulge) {
      const arc = arcGeometry(loop[selectedVertexIndex], next, sourceBulge), angle = arc.start + arc.sweep / 2;
      midpoint = [arc.center[0] + arc.radius * Math.cos(angle), arc.center[1] + arc.radius * Math.sin(angle)];
    }
    loop.splice(selectedVertexIndex + 1, 0, midpoint);
    const hadBulges = selectedLoopIndex === 0 ? !!candidate.bulges : !!candidate.holeBulges?.[selectedLoopIndex - 1];
    const bulges = selectedLoopIndex === 0 ? (candidate.bulges ??= Array(loop.length - 1).fill(0)) : (candidate.holeBulges ??= candidate.holes.map((item) => Array(item.length).fill(0)))[selectedLoopIndex - 1];
    const original = bulges[selectedVertexIndex] || 0, half = Math.tan(Math.atan(original) / 2);
    bulges[selectedVertexIndex] = half;
    if (hadBulges || selectedLoopIndex === 0) bulges.splice(selectedVertexIndex + 1, 0, half);
    else bulges[selectedVertexIndex + 1] = half;
    if (commitCandidate(candidate)) setVertexIndex(selectedVertexIndex + 1);
  };
  const removeVertex = () => {
    if (activeLoop.length <= 3) { setError('A profile loop must retain at least three vertices'); return; }
    const candidate = clone(profile), loop = selectedLoopIndex === 0 ? candidate.outer : candidate.holes[selectedLoopIndex - 1];
    const bulges = selectedLoopIndex === 0 ? candidate.bulges : candidate.holeBulges?.[selectedLoopIndex - 1];
    if (bulges) { bulges[(selectedVertexIndex - 1 + loop.length) % loop.length] = 0; bulges.splice(selectedVertexIndex, 1); }
    loop.splice(selectedVertexIndex, 1);
    if (commitCandidate(candidate)) setVertexIndex(Math.max(0, selectedVertexIndex - 1));
  };

  const beginDrag = (event: ReactPointerEvent<SVGCircleElement>, targetLoop: number, targetVertex: number) => {
    event.preventDefault();
    dragCleanup.current?.(false);
    setLoopIndex(targetLoop); setVertexIndex(targetVertex);
    const svg = event.currentTarget.ownerSVGElement!;
    const store = useModelerStore.getState();
    if (!store.historyTransaction) { store.beginHistoryTransaction(); transaction.current = true; }
    const move = (next: PointerEvent) => {
      const rect = svg.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = bounds.minX - bounds.pad + (next.clientX - rect.left) / rect.width * (bounds.width + 2 * bounds.pad);
      const y = bounds.maxY + bounds.pad - (next.clientY - rect.top) / rect.height * (bounds.height + 2 * bounds.pad);
      const candidate = clone(profile);
      (targetLoop === 0 ? candidate.outer : candidate.holes[targetLoop - 1])[targetVertex] = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
      commitCandidate(candidate);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      dragCleanup.current = null;
      if (transaction.current) { transaction.current = false; commit ? store.commitHistoryTransaction() : store.cancelHistoryTransaction(); }
    };
    const up = () => finish(true), cancel = () => finish(false);
    dragCleanup.current = finish;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };

  return <div className="mx-2 rounded p-2 space-y-2" style={{ border: '1px solid var(--border-subtle)' }}>
    <svg aria-label="Profile shape editor" role="img" viewBox={`${bounds.minX - bounds.pad} ${-(bounds.maxY + bounds.pad)} ${bounds.width + 2 * bounds.pad} ${bounds.height + 2 * bounds.pad}`}
      className="block w-full h-36 rounded" style={{ background: 'var(--bg-deep)', touchAction: 'none' }}>
      {loops.map((loop, index) => <g key={index}>
        <path d={loopPath(loop, index === 0 ? profile.bulges : profile.holeBulges?.[index - 1])} fill={index ? 'var(--bg-deep)' : 'var(--accent-subtle)'} fillRule="evenodd" stroke="var(--accent)" strokeWidth={Math.max(bounds.width, bounds.height) / 180} />
        {loop.map(([x, y], point) => <g key={point}>
          <circle cx={x} cy={-y} r={Math.max(bounds.width, bounds.height) / 35} fill={index === loopIndex && point === vertexIndex ? 'white' : 'var(--accent)'} pointerEvents="none" />
          <circle cx={x} cy={-y} r={Math.max(bounds.width, bounds.height) / 10} fill="transparent" style={{ cursor: 'grab' }}
            aria-label={`${index ? `Hole ${index}` : 'Outer'} vertex ${point + 1}`} tabIndex={0}
            onFocus={() => { setLoopIndex(index); setVertexIndex(point); }} onPointerDown={(event) => beginDrag(event, index, point)} />
        </g>)}
      </g>)}
    </svg>
    <div className="grid grid-cols-2 gap-1">
      <CommittedNumber label={revolve ? 'Profile radial span' : 'Profile width'} value={bounds.width} min={0.01} onCommit={(value) => scaleDimension(0, value)} />
      <CommittedNumber label="Profile height" value={bounds.height} min={0.01} onCommit={(value) => scaleDimension(1, value)} />
    </div>
    <CommittedNumber label="Selected edge bulge" value={activeBulge} onCommit={updateBulge} />
    <div className="grid grid-cols-2 gap-1">
      <CommittedNumber label={revolve ? 'Selected vertex radius' : 'Selected vertex X'} value={activeVertex[0]} onCommit={(value) => updateVertex([value, activeVertex[1]])} />
      <CommittedNumber label={revolve ? 'Selected vertex axial position' : 'Selected vertex Y'} value={activeVertex[1]} onCommit={(value) => updateVertex([activeVertex[0], value])} />
    </div>
    <div className="flex gap-1">
      <select aria-label="Profile loop" value={loopIndex} onChange={(event) => { setLoopIndex(Number(event.target.value)); setVertexIndex(0); }} className="min-w-0 flex-1 rounded text-[10px]">
        <option value={0}>Outer loop</option>{profile.holes.map((_, index) => <option key={index} value={index + 1}>Hole {index + 1}</option>)}
      </select>
      <button type="button" onClick={addVertex} className="rounded px-2 text-[10px]" aria-label="Add vertex after selected">Add point</button>
      <button type="button" onClick={removeVertex} className="rounded px-2 text-[10px]" aria-label="Remove selected vertex">Remove</button>
    </div>
    {error && <div role="alert" className="text-[10px]" style={{ color: 'var(--accent-red, #e06c6c)' }}>{error}</div>}
  </div>;
}
