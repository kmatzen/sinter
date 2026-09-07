import { useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useModelerStore } from '../../store/modelerStore';
import { MAX_STL_TRIANGLES, STL_TOPOLOGY_STATUS } from '../../worker/sdf/stl';
import { MeshImportSession } from '../../worker/meshImportClient';
import { estimatedStoredMeshBytes, MAX_IMPORT_PROJECT_BYTES, type MeshImportInfo } from '../../worker/meshImport';
import type { SDFNodeUI } from '../../types/operations';
import { useDialogFocus } from '../ui/useDialogFocus';
import { useViewportStore } from '../../store/viewportStore';
import { toMillimeters, type DisplayUnit } from '../../types/units';

const STL_UNIT_KEY = 'sinter_stl_import_unit';
type STLUnit = Exclude<DisplayUnit, 'ft-in'>;
type MeshOrientation = 'z-up' | 'y-up' | 'x-up';

function initialSTLUnit(projectUnit: DisplayUnit): STLUnit {
  try {
    const remembered = localStorage.getItem(STL_UNIT_KEY);
    if (remembered === 'mm' || remembered === 'cm' || remembered === 'm' || remembered === 'in') return remembered;
  } catch { /* preference persistence is best effort */ }
  return projectUnit === 'ft-in' ? 'in' : projectUnit;
}

/**
 * STL import (#87, layer 1).
 *
 * Parses on the main thread, which is fine — an STL is a flat array read, and
 * even a large one is tens of milliseconds. The expensive part is baking the
 * distance field, and that happens in the worker on the next evaluate, where
 * it belongs.
 */

/**
 * Triangle ceiling.
 *
 * The mesh is stored in the document, so it goes through undo history, project
 * JSON and localStorage. At 36 bytes a triangle a 200k-triangle scan is 7MB
 * before base64, which is past what any of those want to carry. Above the cap
 * the import is refused with the number, rather than silently decimating —
 * a user who exported at that density chose it, and quietly throwing most of
 * it away is worse than saying no.
 */
function toBase64(floats: Float32Array): string {
  const bytes = new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength);
  let bin = '';
  // Chunked: String.fromCharCode.apply blows the argument limit somewhere
  // around 100k, and a megabyte of mesh is well past it.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(bin);
}

export function orientMesh(positions: Float32Array, orientation: MeshOrientation): Float32Array {
  const result = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (orientation === 'y-up') { result[i] = x; result[i + 1] = -z; result[i + 2] = y; }
    else if (orientation === 'x-up') { result[i] = -z; result[i + 1] = y; result[i + 2] = x; }
    else { result[i] = x; result[i + 1] = y; result[i + 2] = z; }
  }
  return result;
}

export function buildMeshNode(name: string, positions: Float32Array, resolution = 48, sourceUnit: STLUnit = 'mm', orientation: MeshOrientation = 'z-up', unitScaleToMillimeters?: number, declaredUnit?: string): SDFNodeUI {
  const oriented = orientMesh(positions, orientation);
  const scale = unitScaleToMillimeters ?? (sourceUnit === 'mm' ? 1 : toMillimeters(1, sourceUnit));
  const scaled = scale === 1 ? oriented : Float32Array.from(oriented, (value) => value * scale);
  return {
    id: uuidv4(),
    kind: 'mesh',
    label: name.replace(/\.(stl|obj|3mf)$/i, '').slice(0, 40) || 'Imported Mesh',
    params: { resolution },
    data: { meshPositions: toBase64(scaled), meshName: name, meshTopology: STL_TOPOLOGY_STATUS, meshImportUnit: sourceUnit, meshImportOrientation: orientation, ...(declaredUnit ? { meshImportDeclaredUnit: declaredUnit } : {}) },
    children: [],
    enabled: true,
  };
}

export function ImportMesh({ onDone, replaceNode }: { onDone: () => void; replaceNode?: SDFNodeUI }) {
  const projectUnit = useViewportStore((s) => s.measurementUnit);
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const replaceNodeInTree = useModelerStore((s) => s.replaceNode);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: File; info: MeshImportInfo; session: MeshImportSession } | null>(null);
  const [prepared, setPrepared] = useState<{ positions: Float32Array; triangleCount: number; maxDeviation: number } | null>(null);
  const [targetTriangles, setTargetTriangles] = useState(MAX_STL_TRIANGLES);
  const [progress, setProgress] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<MeshOrientation>(() => (replaceNode?.data?.meshImportOrientation as MeshOrientation) || 'z-up');
  const [resolution, setResolution] = useState(() => Number(replaceNode?.params.resolution) || 48);
  const [sourceUnit, setSourceUnit] = useState<STLUnit>(() => (replaceNode?.data?.meshImportUnit as STLUnit) || initialSTLUnit(projectUnit));
  const inputRef = useRef<HTMLInputElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const close = () => { pending?.session.cancel(); onDone(); };
  const commitImported = (node: SDFNodeUI) => {
    if (replaceNode) replaceNodeInTree(replaceNode.id, { ...node, id: replaceNode.id, label: replaceNode.label });
    else addNodeFromData(selectedId, node);
  };
  useDialogFocus(surface, close);

  const handleFile = async (file: File) => {
    pending?.session.cancel();
    setError(null);
    setPending(null);
    setPrepared(null);
    setBusy(true);
    const session = new MeshImportSession();
    try {
      const info = await session.load(file);
      setTargetTriangles(Math.min(info.triangleCount, MAX_STL_TRIANGLES));
      setPending({ file, info, session });
    } catch (err) {
      session.cancel();
      setError(err instanceof Error ? err.message : `Could not read that file: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div ref={surface} role="dialog" aria-modal="true" aria-labelledby="import-stl-title" className="rounded-lg p-5 w-[420px] max-w-[90vw] max-h-[90vh] overflow-y-auto"
           style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}>
        <h2 id="import-stl-title" className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{replaceNode ? 'Reimport mesh' : 'Import mesh'}</h2>
        <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
          The mesh becomes an editable node you can subtract, intersect or pattern like any
          other shape. It is stored as a distance field, so fine detail is rounded to the
          field's resolution.
        </p>
        {replaceNode && <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
          Choose {replaceNode.data?.meshName || 'the source mesh'} again. Browsers do not retain portable file access; the saved unit, orientation, resolution, label, and node identity will be reused. Confirming replaces it in one undo step.
        </p>}

        <input
          ref={inputRef}
          type="file"
          accept=".stl,.obj,.3mf,model/stl,application/sla,text/plain,model/obj,model/3mf,application/vnd.ms-package.3dmanufacturing-3dmodel+xml"
          aria-label="Mesh file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = '';
          }}
        />

        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full px-3 py-2 rounded text-[12px] font-medium mb-3"
          style={{ background: 'var(--accent)', color: 'var(--bg-deep)', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Reading in worker…' : 'Choose an STL, OBJ, or 3MF file'}
        </button>

        {error && (
          <div role="alert" className="text-[11px] mb-3 px-2 py-1.5 rounded"
               style={{ background: 'var(--bg-elevated)', color: 'var(--accent-red, #e06c6c)' }}>
            {error}
          </div>
        )}

        {pending && (
          <div className="text-[11px] mb-3 px-2 py-2 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
            <label className="flex items-center justify-between gap-3 mb-2">
              <span>{pending.info.format.toUpperCase()} coordinate unit</span>
              {pending.info.declaredUnit ? <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{pending.info.declaredUnit} (declared)</span> : <select aria-label="STL coordinate unit" value={sourceUnit} onChange={(event) => setSourceUnit(event.target.value as STLUnit)} className="rounded px-2 py-1" style={{ background: 'var(--bg-panel)' }}>
                <option value="mm">millimeters</option><option value="cm">centimeters</option><option value="m">meters</option><option value="in">inches</option>
              </select>}
            </label>
            <div className="mb-2" style={{ color: 'var(--text-muted)' }}>
              {pending.info.declaredUnit ? `The 3MF unit declaration scales coordinates into Sinter’s canonical millimeters.` : `STL and OBJ files contain no reliable unit metadata. This explicit choice scales coordinates into Sinter’s canonical millimeters and is remembered for the next import.`}
            </div>
            <div style={{ color: 'var(--text-primary)' }}>
              {pending.info.triangleCount.toLocaleString()} triangles · closed manifold · {pending.info.componentCount} shell{pending.info.componentCount === 1 ? '' : 's'}
            </div>
            <div className="mt-1 font-mono" style={{ color: 'var(--text-muted)' }}>
              Bounds {pending.info.boundsMin.map((value, axis) => ((pending.info.boundsMax[axis] - value) * (pending.info.declaredUnit ? pending.info.unitScaleToMillimeters : (sourceUnit === 'mm' ? 1 : toMillimeters(1, sourceUnit)))).toFixed(2)).join(' × ')} mm
            </div>
            <div className="mt-1" style={{ color: 'var(--text-muted)' }}>Estimated stored geometry {(estimatedStoredMeshBytes(targetTriangles) / 1024 / 1024).toFixed(2)} MB of the {MAX_IMPORT_PROJECT_BYTES / 1024 / 1024} MB per-mesh project limit, before undo/history copies.</div>
            <label className="flex items-center justify-between gap-3 mt-2">
              <span>Triangles after import</span>
              <select disabled={prepared !== null} aria-label="Triangles after import" value={targetTriangles} onChange={(event) => { setTargetTriangles(Number(event.target.value)); setPrepared(null); }} className="rounded px-2 py-1" style={{ background: 'var(--bg-panel)' }}>
                {[pending.info.triangleCount, 60000, 30000, 15000].filter((value, index, all) => value <= pending.info.triangleCount && estimatedStoredMeshBytes(value) <= MAX_IMPORT_PROJECT_BYTES && all.indexOf(value) === index).map((value) => <option key={value} value={value}>{value.toLocaleString()}{value === pending.info.triangleCount ? ' (original)' : ''}</option>)}
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 mt-2">
              <span>Source up axis</span>
              <select aria-label="Source up axis" value={orientation} onChange={(event) => setOrientation(event.target.value as MeshOrientation)} className="rounded px-2 py-1" style={{ background: 'var(--bg-panel)' }}>
                <option value="z-up">Z up (no rotation)</option><option value="y-up">Y up → Z up</option><option value="x-up">X up → Z up</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 mt-2">
              <span>Distance-field resolution</span>
              <select aria-label="Distance-field resolution" value={resolution} onChange={(event) => setResolution(Number(event.target.value))} className="rounded px-2 py-1" style={{ background: 'var(--bg-panel)' }}>
                <option value="32">Draft (32³)</option><option value="48">Standard (48³)</option><option value="64">Detailed (64³)</option>
              </select>
            </label>
            <div className="mt-1" style={{ color: 'var(--text-muted)' }}>Features below about {(Math.max(...pending.info.boundsMax.map((value, axis) => value - pending.info.boundsMin[axis])) * (pending.info.declaredUnit ? pending.info.unitScaleToMillimeters : (sourceUnit === 'mm' ? 1 : toMillimeters(1, sourceUnit))) / resolution).toFixed(2)} mm may be softened at this resolution.</div>
            {targetTriangles < pending.info.triangleCount && <div className="mt-1" style={{ color: 'var(--accent-orange, #d9a441)' }}>Simplification is explicit and may soften details. The original file is not modified.</div>}
            {prepared && <div role="status" className="mt-1" style={{ color: 'var(--text-primary)' }}>
              Prepared {prepared.triangleCount.toLocaleString()} triangles · sampled maximum deviation {(prepared.maxDeviation * (pending.info.declaredUnit ? pending.info.unitScaleToMillimeters : (sourceUnit === 'mm' ? 1 : toMillimeters(1, sourceUnit)))).toFixed(3)} mm. Review this error before confirming.
            </div>}
            <div className="mt-1" style={{ color: 'var(--accent-orange, #d9a441)' }}>
              Self-intersections cannot currently be ruled out. Import uses ray-parity approximation and the mesh will remain visibly marked.
            </div>
            <button
              disabled={busy}
              onClick={async () => {
                if (prepared) {
                  commitImported(buildMeshNode(pending.file.name, prepared.positions, resolution, pending.info.declaredUnit ? 'mm' : sourceUnit, orientation, pending.info.declaredUnit ? pending.info.unitScaleToMillimeters : undefined, pending.info.declaredUnit));
                  pending.session.cancel(); onDone(); return;
                }
                try { localStorage.setItem(STL_UNIT_KEY, sourceUnit); } catch { /* preference persistence is best effort */ }
                setBusy(true); setProgress(0); setError(null);
                try {
                  const result = await pending.session.finish(targetTriangles, setProgress);
                  if (targetTriangles < pending.info.triangleCount) { setPrepared(result); setBusy(false); setProgress(null); }
                  else {
                    commitImported(buildMeshNode(pending.file.name, result.positions, resolution, pending.info.declaredUnit ? 'mm' : sourceUnit, orientation, pending.info.declaredUnit ? pending.info.unitScaleToMillimeters : undefined, pending.info.declaredUnit));
                    pending.session.cancel(); onDone();
                  }
                } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); setProgress(null); }
              }}
              className="w-full px-3 py-2 rounded text-[12px] font-medium mt-2"
              style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
            >
              {prepared ? 'Confirm import' : progress === null ? 'Import approximately' : `Simplifying… ${Math.round(progress)}%`}
            </button>
          </div>
        )}

        <button onClick={close} className="w-full px-3 py-1.5 rounded text-[12px]"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
