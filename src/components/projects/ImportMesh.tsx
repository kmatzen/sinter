import { useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useModelerStore } from '../../store/modelerStore';
import { parseSTL, STLParseError } from '../../worker/sdf/stl';
import type { SDFNodeUI } from '../../types/operations';

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
const MAX_TRIANGLES = 60_000;

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

export function buildMeshNode(name: string, positions: Float32Array, resolution = 48): SDFNodeUI {
  return {
    id: uuidv4(),
    kind: 'mesh',
    label: name.replace(/\.stl$/i, '').slice(0, 40) || 'Imported Mesh',
    params: { resolution },
    data: { meshPositions: toBase64(positions), meshName: name },
    children: [],
    enabled: true,
  };
}

export function ImportMesh({ onDone }: { onDone: () => void }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setBusy(true);
    try {
      const mesh = parseSTL(await file.arrayBuffer());
      if (mesh.triangleCount === 0) {
        setError('That file has no triangles in it.');
        return;
      }
      if (mesh.triangleCount > MAX_TRIANGLES) {
        setError(
          `${mesh.triangleCount.toLocaleString()} triangles is over the ${MAX_TRIANGLES.toLocaleString()} limit. ` +
          'Decimate it in your mesh editor first — the model is stored in the project file, so it has to stay small enough to save.',
        );
        return;
      }
      addNodeFromData(selectedId, buildMeshNode(file.name, mesh.positions));
      onDone();
    } catch (err) {
      setError(err instanceof STLParseError ? err.message : `Could not read that file: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-lg p-5 w-[420px] max-w-[90vw]"
           style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }}>
        <h2 className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Import STL</h2>
        <p className="text-[11px] mb-3" style={{ color: 'var(--text-muted)' }}>
          The mesh becomes an editable node you can subtract, intersect or pattern like any
          other shape. It is stored as a distance field, so fine detail is rounded to the
          field's resolution.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept=".stl,model/stl,application/sla"
          aria-label="STL file"
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
          {busy ? 'Reading…' : 'Choose an STL file'}
        </button>

        {error && (
          <div role="alert" className="text-[11px] mb-3 px-2 py-1.5 rounded"
               style={{ background: 'var(--bg-elevated)', color: 'var(--accent-red, #e06c6c)' }}>
            {error}
          </div>
        )}

        <button onClick={onDone} className="w-full px-3 py-1.5 rounded text-[12px]"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
