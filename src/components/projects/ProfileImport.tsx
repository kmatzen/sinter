import { useState } from 'react';
import { parseRevolveProfile } from '../../worker/sdf/profile';
import { parseDxfProfile, parseSvgProfile, profileUnitScaleToMm, rescaleProfileImport, type ProfileImportResult, type ProfileUnit } from '../../worker/sdf/profileImport';

export function ProfileImport({ revolve, validate, onCommit }: { revolve: boolean; validate?: (source: string) => unknown; onCommit: (profile: string) => void }) {
  const [preview, setPreview] = useState<ProfileImportResult | null>(null);
  const [source, setSource] = useState<{ name: string; text: string } | null>(null);
  const [chordTolerance, setChordTolerance] = useState(0.25);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const parse = (fileName: string, text: string, tolerance: number, scale?: Pick<ProfileImportResult, 'scaleToMm' | 'unit'>) => {
    const imported = fileName.toLowerCase().endsWith('.dxf') || !/<svg\b/i.test(text)
      ? parseDxfProfile(text, tolerance)
      : parseSvgProfile(text, tolerance);
    const result = scale ? rescaleProfileImport(imported, scale.scaleToMm, scale.unit) : imported;
    if (validate) validate(JSON.stringify(result.profile));
    else if (revolve) parseRevolveProfile(JSON.stringify(result.profile));
    return result;
  };
  const choose = async (file?: File) => {
    if (!file) return;
    setName(file.name); setError(null); setPreview(null);
    try {
      const text = await file.text();
      setSource({ name: file.name, text });
      setPreview(parse(file.name, text, chordTolerance));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import profile'); }
  };
  const rescale = (scale: number, unit?: ProfileUnit) => {
    if (!preview) return;
    try { const next = rescaleProfileImport(preview, scale, unit); if (validate) validate(JSON.stringify(next.profile)); else if (revolve) parseRevolveProfile(JSON.stringify(next.profile)); setPreview(next); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid scale'); }
  };

  return <div className="mx-2 mt-2 rounded p-2" style={{ border: '1px solid var(--border-subtle)' }}>
    <label className="block text-[10px] mb-1" style={{ color: 'var(--text-secondary)' }}>Import SVG or ASCII DXF
      <input className="block w-full mt-1 text-[10px]" aria-label="Import profile file" type="file" accept=".svg,.dxf,image/svg+xml" onChange={(event) => void choose(event.target.files?.[0])} />
    </label>
    {name && <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{name}</div>}
    {error && <div role="alert" className="text-[10px] mt-1" style={{ color: 'var(--accent-red, #e06c6c)' }}>{error}</div>}
    {preview && <>
      <div role="status" className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
        {preview.dimensions[0].toFixed(2)} × {preview.dimensions[1].toFixed(2)} mm
      </div>
      <label className="block text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>Curve chord tolerance (source units)
        <input aria-label="Curve chord tolerance" type="number" min="0.01" max="10" step="0.01" value={chordTolerance}
          onChange={(event) => {
            const tolerance = Math.min(10, Math.max(0.01, Number(event.target.value)));
            if (!Number.isFinite(tolerance)) return;
            setChordTolerance(tolerance);
            if (!source) return;
            try { setPreview(parse(source.name, source.text, tolerance, preview)); setError(null); }
            catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import profile'); }
          }} className="block w-full rounded px-1 text-[10px]"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
      </label>
      <div className="flex gap-1 mt-1">
        <select aria-label="Profile source units" value={preview.unit} onChange={(event) => rescale(profileUnitScaleToMm(event.target.value as ProfileUnit), event.target.value as ProfileUnit)}
          className="rounded px-1 text-[10px]" style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
          {(['mm', 'cm', 'in', 'px', 'unitless'] as ProfileUnit[]).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
        <input aria-label="Profile millimetres per source unit" type="number" min="0.000001" step="0.01" value={preview.scaleToMm}
          onChange={(event) => rescale(Number(event.target.value))} className="min-w-0 flex-1 rounded px-1 text-[10px]"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }} />
        <span className="text-[9px] self-center" style={{ color: 'var(--text-muted)' }}>mm/unit</span>
      </div>
      {preview.warnings.map((warning) => <div key={warning} role="note" className="text-[10px] mt-1" style={{ color: 'var(--accent-amber, #d4a04a)' }}>{warning}</div>)}
      <button type="button" className="w-full mt-2 rounded py-1 text-[10px]" style={{ background: 'var(--accent)', color: 'white' }}
        onClick={() => onCommit(JSON.stringify(preview.profile))}>Use imported profile</button>
    </>}
  </div>;
}
