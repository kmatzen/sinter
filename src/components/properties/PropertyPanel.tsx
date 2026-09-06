import { useState } from 'react';
import { useModelerStore } from '../../store/modelerStore';
import { workerBridge } from '../../engine/workerBridge';
import type { MeshFitResult } from '../../types/geometry';
import { NODE_LABELS, NODE_KINDS, type NamedParameter, type ParameterUnit, type SDFNodeUI } from '../../types/operations';
import { parameterUnitFor, resolveNamedParameters } from '../../types/formulas';
import { NumberInput } from './NumberInput';

function findNode(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

/** Thin section label used to group related fields */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] tracking-[0.08em] uppercase pt-3 pb-1 px-2 first:pt-0"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </div>
  );
}

/** Inline kind switcher styled as segmented control */
function KindSwitcher({ kinds, current, onChange }: { kinds: string[]; current: string; onChange: (k: string) => void }) {
  return (
    <div
      className="flex rounded-md overflow-hidden mx-2 mb-2"
      style={{ border: '1px solid var(--border-subtle)' }}
      role="radiogroup"
      aria-label="Node type"
    >
      {kinds.map((k) => (
        <button
          key={k}
          role="radio"
          aria-checked={k === current}
          onClick={() => onChange(k)}
          title={NODE_LABELS[k]}
          className="flex-1 text-[11px] py-1 tap-h transition-colors"
          style={{
            background: k === current ? 'var(--bg-elevated)' : 'transparent',
            color: k === current ? 'var(--text-primary)' : 'var(--text-muted)',
            borderRight: k !== kinds[kinds.length - 1] ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          {NODE_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

/** Inline axis checkboxes for mirror */
function AxisCheckboxes({ params, onUpdate }: { params: Record<string, number>; onUpdate: (p: Record<string, number>) => void }) {
  return (
    <div className="flex gap-1 px-2" role="group" aria-label="Mirror axes">
      {(['mirrorX', 'mirrorY', 'mirrorZ'] as const).map((key) => {
        const axis = key.replace('mirror', '');
        const active = !!params[key];
        return (
          <button
            key={key}
            onClick={() => onUpdate({ [key]: active ? 0 : 1 })}
            title={`Mirror ${axis} axis`}
            aria-label={`Mirror ${axis} axis`}
            aria-pressed={active}
            className="flex-1 h-7 tap-h rounded text-[11px] font-medium transition-colors"
            style={{
              background: active ? 'var(--accent-subtle)' : 'var(--bg-surface)',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
            }}
          >
            {axis}
          </button>
        );
      })}
    </div>
  );
}

/** Reusable X/Y/Z radio pills */
function XYZPicker({ label, value, onChange }: { label: string; value: 'x' | 'y' | 'z'; onChange: (axis: 'x' | 'y' | 'z') => void }) {
  return (
    <div className="flex gap-1 px-2 mb-1" role="radiogroup" aria-label={label}>
      {(['x', 'y', 'z'] as const).map((axis) => {
        const active = value === axis;
        return (
          <button
            key={axis}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(axis)}
            title={`${label}: ${axis.toUpperCase()}`}
            className="flex-1 h-7 tap-h rounded text-[11px] font-medium transition-colors"
            style={{
              background: active ? 'var(--accent-subtle)' : 'var(--bg-surface)',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
            }}
          >
            {axis.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}

/** Helper to get dominant axis from axisX/axisY/axisZ params */
function getActiveAxis(p: Record<string, number>): 'x' | 'y' | 'z' {
  const ax = Math.abs(p.axisX || 0), ay = Math.abs(p.axisY || 0), az = Math.abs(p.axisZ || 0);
  if (ax > ay && ax > az) return 'x';
  if (az > ay) return 'z';
  return 'y';
}

function setAxisParams(axis: 'x' | 'y' | 'z'): Record<string, number> {
  return { axisX: axis === 'x' ? 1 : 0, axisY: axis === 'y' ? 1 : 0, axisZ: axis === 'z' ? 1 : 0 };
}

function ParameterDefinitionRow({ parameter, value, all, onApply }: { parameter: NamedParameter; value: number; all: NamedParameter[]; onApply: (next: NamedParameter[]) => void }) {
  const [expression, setExpression] = useState(parameter.expression);
  const [unit, setUnit] = useState<ParameterUnit>(parameter.unit);
  return (
    <div className="rounded p-2 space-y-1.5" style={{ background: 'var(--bg-surface)' }}>
      <div className="flex items-center gap-2">
        <code className="text-[11px] flex-1 truncate" style={{ color: 'var(--accent)' }}>{parameter.name} = {value}</code>
        <select aria-label={`Unit for ${parameter.name}`} value={unit} onChange={(event) => setUnit(event.target.value as ParameterUnit)} className="text-[10px] tap-h rounded px-1 py-0.5" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }}>
          <option value="mm">mm</option><option value="deg">deg</option><option value="unitless">unitless</option>
        </select>
        <button aria-label={`Delete parameter ${parameter.name}`} onClick={() => onApply(all.filter((item) => item.name !== parameter.name))} className="text-[10px] tap-h" style={{ color: 'var(--accent-red)' }}>Delete</button>
      </div>
      <div className="flex gap-1">
        <input aria-label={`Expression for ${parameter.name}`} value={expression} maxLength={512} onChange={(event) => setExpression(event.target.value)} className="min-w-0 flex-1 tap-h rounded px-2 py-1 text-[11px] font-mono" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }} />
        <button disabled={!expression.trim()} onClick={() => onApply(all.map((item) => item.name === parameter.name ? { ...item, expression, unit } : item))} className="text-[10px] tap-h rounded px-2 disabled:opacity-40" style={{ border: '1px solid var(--border-default)' }}>Apply</button>
      </div>
    </div>
  );
}

function NamedParametersPanel() {
  const parameters = useModelerStore((state) => state.namedParameters);
  const setParameters = useModelerStore((state) => state.setNamedParameters);
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [unit, setUnit] = useState<ParameterUnit>('mm');
  const resolved = new Map(resolveNamedParameters(parameters).map((item) => [item.name, item.value]));
  const add = () => {
    if (!name.trim() || !expression.trim()) return;
    setParameters([...parameters, { name: name.trim(), expression: expression.trim(), unit }]);
    setName(''); setExpression('');
  };
  return (
    <details className="mx-2 mb-3 rounded" style={{ border: '1px solid var(--border-subtle)' }}>
      <summary className="cursor-pointer select-none px-2 py-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>Named parameters ({parameters.length})</summary>
      <div className="px-2 pb-2 space-y-2">
        {parameters.map((parameter) => <ParameterDefinitionRow key={`${parameter.name}:${parameter.expression}:${parameter.unit}`} parameter={parameter} value={resolved.get(parameter.name)!} all={parameters} onApply={setParameters} />)}
        <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
          <input aria-label="New parameter name" placeholder="name" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} className="min-w-0 tap-h rounded px-2 py-1 text-[11px] font-mono" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }} />
          <input aria-label="New parameter expression" placeholder="value/formula" value={expression} maxLength={512} onChange={(event) => setExpression(event.target.value)} className="min-w-0 tap-h rounded px-2 py-1 text-[11px] font-mono" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }} />
          <select aria-label="New parameter unit" value={unit} onChange={(event) => setUnit(event.target.value as ParameterUnit)} className="text-[10px] tap-h rounded px-1" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }}><option value="mm">mm</option><option value="deg">deg</option><option value="unitless">—</option></select>
        </div>
        <button disabled={!name.trim() || !expression.trim()} onClick={add} className="w-full tap-h rounded py-1 text-[11px] disabled:opacity-40" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>Add parameter</button>
      </div>
    </details>
  );
}

function FormulaBindings({ node }: { node: SDFNodeUI }) {
  const setExpression = useModelerStore((state) => state.setNodeExpression);
  const promote = useModelerStore((state) => state.promoteNodeParam);
  const keys = Object.keys(node.params).filter((key) => !['mirrorX', 'mirrorY', 'mirrorZ', 'axis', 'flip', 'axisX', 'axisY', 'axisZ'].includes(key));
  const [key, setKey] = useState(keys[0] ?? '');
  const [formula, setFormula] = useState('');
  const [promoteName, setPromoteName] = useState('');
  if (!keys.length) return null;
  return (
    <details className="mx-2 mt-3 rounded" style={{ border: '1px solid var(--border-subtle)' }}>
      <summary className="cursor-pointer select-none px-2 py-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>Driven properties ({Object.keys(node.expressions ?? {}).length})</summary>
      <div className="px-2 pb-2 space-y-2">
        {Object.entries(node.expressions ?? {}).map(([property, source]) => (
          <div key={property} className="text-[10px] rounded p-2" style={{ background: 'var(--bg-surface)' }}>
            <div className="flex gap-2"><code className="flex-1" style={{ color: 'var(--accent)' }}>{property} = {source}</code><button onClick={() => setExpression(node.id, property, null)} style={{ color: 'var(--accent-red)' }}>Use literal</button></div>
            <div style={{ color: 'var(--text-muted)' }}>Resolved: {node.params[property]} {parameterUnitFor(node.kind, property) === 'unitless' ? '' : parameterUnitFor(node.kind, property)}</div>
          </div>
        ))}
        <select aria-label="Property to drive" value={key} onChange={(event) => setKey(event.target.value)} className="w-full rounded px-2 py-1 text-[11px]" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }}>{keys.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <div className="flex gap-1"><input aria-label="Property formula" placeholder="formula" value={formula} onChange={(event) => setFormula(event.target.value)} className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] font-mono" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }} /><button disabled={!formula.trim()} onClick={() => { setExpression(node.id, key, formula); setFormula(''); }} className="rounded px-2 text-[10px] disabled:opacity-40" style={{ border: '1px solid var(--border-default)' }}>Drive</button></div>
        <div className="flex gap-1"><input aria-label="Promoted parameter name" placeholder="parameter name" value={promoteName} onChange={(event) => setPromoteName(event.target.value)} className="min-w-0 flex-1 rounded px-2 py-1 text-[11px] font-mono" style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }} /><button disabled={!promoteName.trim()} onClick={() => { promote(node.id, key, promoteName.trim()); setPromoteName(''); }} className="rounded px-2 text-[10px] disabled:opacity-40" style={{ border: '1px solid var(--border-default)' }}>Promote</button></div>
      </div>
    </details>
  );
}

/** Inner content — reused by desktop sidebar and mobile overlay */
export function PropertyContent() {
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const tree = useModelerStore((s) => s.tree);
  const updateParams = useModelerStore((s) => s.updateNodeParams);
  const updateData = useModelerStore((s) => s.updateNodeData);
  const changeKind = useModelerStore((s) => s.changeNodeKind);

  const node = tree && selectedId ? findNode(tree, selectedId) : null;

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[11px] text-center px-8 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Select a node to<br />edit its properties
        </p>
      </div>
    );
  }

  const update = (params: Record<string, number>) => updateParams(node.id, params);
  const updateStr = (data: Record<string, string>) => updateData(node.id, data);

  return (
    <div className="py-2">
      <NamedParametersPanel />
      {NODE_KINDS.booleans.includes(node.kind as any) && (
        <KindSwitcher kinds={[...NODE_KINDS.booleans]} current={node.kind} onChange={(k) => changeKind(node.id, k)} />
      )}
      {NODE_KINDS.primitives.includes(node.kind as any) && (
        <KindSwitcher kinds={[...NODE_KINDS.primitives]} current={node.kind} onChange={(k) => changeKind(node.id, k)} />
      )}
      <NodeEditor node={node} onUpdate={update} onUpdateStr={updateStr} />
      <FormulaBindings key={node.id} node={node} />
    </div>
  );
}

/** Desktop sidebar wrapper */
export function PropertyPanel() {
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const tree = useModelerStore((s) => s.tree);
  const node = tree && selectedId ? findNode(tree, selectedId) : null;

  if (!node) {
    return (
      <div className="hidden lg:flex w-72 items-center justify-center" style={{ background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-subtle)' }}>
        <p className="text-[11px] text-center px-8 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Select a node to<br />edit its properties
        </p>
      </div>
    );
  }

  return (
    <div className="hidden lg:block w-72 overflow-y-auto" style={{ background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-subtle)' }}>
      <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>
          Properties
        </span>
      </div>
      <PropertyContent />
    </div>
  );
}

/**
 * Offer to replace an imported mesh with the primitive that best matches it
 * (#87 layer 2).
 *
 * The residual is shown in millimetres whether the fit is good or not, and the
 * Replace button only appears when it is good. That is the honest shape for
 * this: accepting a bad fit costs the user their original geometry, so the
 * failure has to be a *stated number* rather than a silent no-op or, worse, a
 * confident wrong tree.
 */
function FitPrimitive({ node }: { node: SDFNodeUI }) {
  const replaceNode = useModelerStore((s) => s.replaceNode);
  const [busy, setBusy] = useState(false);
  const [fit, setFit] = useState<MeshFitResult | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const mesh = node.data?.meshPositions;
    if (!mesh) return;
    setBusy(true);
    setError(null);
    try {
      setFit(await workerBridge.fitMesh(mesh, node.params.resolution));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!fit?.node) return;
    // One history entry, so undoing the fit is one press and never leaves the
    // tree with the mesh gone and the primitive not yet in.
    replaceNode(node.id, fit.node);
  };

  const mm = (v: number) => `${v.toFixed(2)} mm`;

  return (
    <>
      <SectionLabel>Fit a primitive</SectionLabel>
      <div className="px-2">
        <button
          onClick={run}
          disabled={busy}
          className="w-full h-7 tap-h rounded text-[11px] font-medium"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Fitting…' : 'Find best primitive'}
        </button>

        {error && (
          <div role="alert" className="text-[10px] mt-2" style={{ color: 'var(--accent-red, #e06c6c)' }}>{error}</div>
        )}

        {fit === null && (
          <div className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
            There is no solid in this mesh to fit.
          </div>
        )}

        {fit && (
          <div className="mt-2 text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            <div style={{ color: 'var(--text-secondary)' }}>
              {fit.kind} — worst {mm(fit.surfaceMax)}, rms {mm(fit.surfaceRms)}
            </div>
            {fit.acceptable ? (
              <>
                <div className="mt-0.5">
                  {(fit.relativeError * 100).toFixed(1)}% of the part's size. Replacing loses the
                  original mesh.
                </div>
                <button
                  onClick={apply}
                  className="w-full h-7 tap-h rounded text-[11px] font-medium mt-2"
                  style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
                >
                  Replace with {fit.kind}
                </button>
              </>
            ) : (
              <div className="mt-0.5">
                No single primitive matches this shape — off by {(fit.relativeError * 100).toFixed(1)}%
                of its size. Keeping the mesh.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function NodeEditor({ node, onUpdate, onUpdateStr }: { node: SDFNodeUI; onUpdate: (p: Record<string, number>) => void; onUpdateStr: (d: Record<string, string>) => void }) {
  const p = node.params;

  switch (node.kind) {
    case 'box':
      return (
        <>
          <SectionLabel>Dimensions</SectionLabel>
          <NumberInput label="Width" value={p.width} min={0.1} onChange={(v) => onUpdate({ width: v })} />
          <NumberInput label="Height" value={p.height} min={0.1} onChange={(v) => onUpdate({ height: v })} />
          <NumberInput label="Depth" value={p.depth} min={0.1} onChange={(v) => onUpdate({ depth: v })} />
        </>
      );
    case 'sphere':
      return (
        <>
          <SectionLabel>Dimensions</SectionLabel>
          <NumberInput label="Radius" value={p.radius} min={0.1} onChange={(v) => onUpdate({ radius: v })} />
        </>
      );
    case 'cylinder':
      return (
        <>
          <SectionLabel>Dimensions</SectionLabel>
          <NumberInput label="Radius" value={p.radius} min={0.1} onChange={(v) => onUpdate({ radius: v })} />
          <NumberInput label="Height" value={p.height} min={0.1} onChange={(v) => onUpdate({ height: v })} />
        </>
      );
    case 'torus':
      return (
        <>
          <SectionLabel>Dimensions</SectionLabel>
          <NumberInput label="Major R" value={p.majorRadius} min={0.1} onChange={(v) => onUpdate({ majorRadius: v })} />
          <NumberInput label="Minor R" value={p.minorRadius} min={0.1} onChange={(v) => onUpdate({ minorRadius: v })} />
        </>
      );
    case 'cone':
      return (
        <>
          <SectionLabel>Dimensions</SectionLabel>
          <NumberInput label="Radius" value={p.radius} min={0.1} onChange={(v) => onUpdate({ radius: v })} />
          <NumberInput label="Height" value={p.height} min={0.1} onChange={(v) => onUpdate({ height: v })} />
        </>
      );
    case 'capsule':
      return (
        <>
          <SectionLabel>Dimensions</SectionLabel>
          <NumberInput label="Radius" value={p.radius} min={0.1} onChange={(v) => onUpdate({ radius: v })} />
          <NumberInput label="Height" value={p.height} min={0.1} onChange={(v) => onUpdate({ height: v })} />
        </>
      );
    case 'ellipsoid':
      return (
        <>
          <SectionLabel>Dimensions</SectionLabel>
          <NumberInput label="Width" value={p.width} min={0.1} onChange={(v) => onUpdate({ width: v })} />
          <NumberInput label="Height" value={p.height} min={0.1} onChange={(v) => onUpdate({ height: v })} />
          <NumberInput label="Depth" value={p.depth} min={0.1} onChange={(v) => onUpdate({ depth: v })} />
        </>
      );
    case 'union': case 'subtract': case 'intersect':
      return (
        <>
          <SectionLabel>Blending</SectionLabel>
          <NumberInput label="Smooth" value={p.smooth} min={0} max={20} step={0.5} unit="mm" onChange={(v) => onUpdate({ smooth: v })} />
          <div className="text-[10px] px-2 mt-0.5" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
            0 = sharp edge, &gt;0 = fillet radius
          </div>
        </>
      );
    case 'shell':
      return (
        <>
          <SectionLabel>Shell</SectionLabel>
          <NumberInput label="Thickness" value={p.thickness} min={0.1} max={20} step={0.5} onChange={(v) => onUpdate({ thickness: v })} />
        </>
      );
    case 'offset':
      return (
        <>
          <SectionLabel>Offset</SectionLabel>
          <NumberInput label="Distance" value={p.distance} min={-20} max={20} step={0.5} onChange={(v) => onUpdate({ distance: v })} />
        </>
      );
    case 'round':
      return (
        <>
          <SectionLabel>Rounding</SectionLabel>
          <NumberInput label="Radius" value={p.radius} min={0} max={20} step={0.5} onChange={(v) => onUpdate({ radius: v })} />
        </>
      );
    case 'translate':
      return (
        <>
          <SectionLabel>Position</SectionLabel>
          <NumberInput label="X" value={p.x} unit="mm" onChange={(v) => onUpdate({ x: v })} />
          <NumberInput label="Y" value={p.y} unit="mm" onChange={(v) => onUpdate({ y: v })} />
          <NumberInput label="Z" value={p.z} unit="mm" onChange={(v) => onUpdate({ z: v })} />
        </>
      );
    case 'rotate':
      return (
        <>
          <SectionLabel>Rotation</SectionLabel>
          <NumberInput label="X" value={p.x} unit="deg" onChange={(v) => onUpdate({ x: v })} />
          <NumberInput label="Y" value={p.y} unit="deg" onChange={(v) => onUpdate({ y: v })} />
          <NumberInput label="Z" value={p.z} unit="deg" onChange={(v) => onUpdate({ z: v })} />
        </>
      );
    case 'scale':
      return (
        <>
          <SectionLabel>Scale</SectionLabel>
          <NumberInput label="X" value={p.x} min={0.01} step={0.1} unit="x" onChange={(v) => onUpdate({ x: v })} />
          <NumberInput label="Y" value={p.y} min={0.01} step={0.1} unit="x" onChange={(v) => onUpdate({ y: v })} />
          <NumberInput label="Z" value={p.z} min={0.01} step={0.1} unit="x" onChange={(v) => onUpdate({ z: v })} />
        </>
      );
    case 'mesh':
      return (
        <>
          <SectionLabel>Source</SectionLabel>
          <div className="px-2 mb-2 text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}
               title={node.data?.meshName || 'Imported mesh'}>
            {node.data?.meshName || 'Imported mesh'}
          </div>
          <div role="status" className="mx-2 mb-2 px-2 py-1.5 rounded text-[10px] leading-snug"
               style={{ background: 'var(--bg-elevated)', color: 'var(--accent-orange, #d9a441)' }}>
            Closed-manifold edges verified. Self-intersections are not checked;
            boolean and export results use ray-parity approximation.
          </div>
          <SectionLabel>Field Resolution</SectionLabel>
          <NumberInput
            label="Grid"
            value={(p.resolution as number) ?? 48}
            min={8}
            max={96}
            step={8}
            unit=""
            onChange={(v) => onUpdate({ resolution: Math.round(v) })}
          />
          {/*
            The one knob that matters for an imported mesh, and the reason it is
            exposed rather than hidden: the mesh is stored as a baked distance
            grid, so this is exactly how much detail survives. Raising it costs
            bake time and texture memory cubically, which is why it is stepped
            and capped rather than free-form.
          */}
          <div className="px-2 pt-1 text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            Samples per axis. Detail finer than one cell is rounded off; higher
            costs bake time and memory cubically.
          </div>
          <FitPrimitive node={node} />
        </>
      );
    case 'text':
      return (
        <>
          <SectionLabel>Content</SectionLabel>
          <div className="px-2 mb-1">
            <input
              type="text"
              value={node.data?.text || ''}
              onChange={(e) => onUpdateStr({ text: e.target.value })}
              onBlur={(e) => onUpdateStr({ text: e.target.value })}
              aria-label="Text content"
              className="w-full rounded h-7 tap-h px-2 text-[12px] focus:outline-none"
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-default)',
              }}
              placeholder="Enter text..."
            />
          </div>
          <SectionLabel>Size</SectionLabel>
          <NumberInput label="Size" value={p.size as number} min={1} onChange={(v) => onUpdate({ size: v })} />
          <NumberInput label="Depth" value={p.depth as number} min={0.1} step={0.5} onChange={(v) => onUpdate({ depth: v })} />
        </>
      );
    case 'mirror':
      return (
        <>
          <SectionLabel>Mirror Axes</SectionLabel>
          <AxisCheckboxes params={p} onUpdate={onUpdate} />
        </>
      );
    case 'halfSpace':
      return (
        <>
          <SectionLabel>Cut Axis</SectionLabel>
          <XYZPicker
            label="Cut axis"
            value={p.axis === 0 ? 'x' : p.axis === 2 ? 'z' : 'y'}
            onChange={(a) => onUpdate({ axis: a === 'x' ? 0 : a === 'z' ? 2 : 1 })}
          />
          <SectionLabel>Keep Side</SectionLabel>
          <div className="flex gap-1 px-2" role="radiogroup" aria-label="Keep side">
            {[{ label: '+', val: 0, desc: 'Keep positive side' }, { label: '\u2212', val: 1, desc: 'Keep negative side' }].map(({ label, val, desc }) => {
              const active = (p.flip || 0) === val;
              return (
                <button
                  key={val}
                  role="radio"
                  aria-checked={active}
                  title={desc}
                  aria-label={desc}
                  onClick={() => onUpdate({ flip: val })}
                  className="flex-1 h-7 tap-h rounded text-[11px] font-medium transition-colors"
                  style={{
                    background: active ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                    color: active ? 'var(--accent)' : 'var(--text-muted)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--border-subtle)'}`,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <SectionLabel>Cut Position</SectionLabel>
          <NumberInput label="Position" value={p.position} unit="mm" onChange={(v) => onUpdate({ position: v })} />
        </>
      );
    case 'linearPattern':
      return (
        <>
          <SectionLabel>Pattern</SectionLabel>
          <NumberInput label="Count" value={p.count} min={2} max={50} step={1} unit="" onChange={(v) => onUpdate({ count: Math.round(v) })} />
          <NumberInput label="Spacing" value={p.spacing} min={0.1} onChange={(v) => onUpdate({ spacing: v })} />
          <SectionLabel>Direction</SectionLabel>
          <XYZPicker label="Pattern direction" value={getActiveAxis(p)} onChange={(a) => onUpdate(setAxisParams(a))} />
        </>
      );
    case 'circularPattern':
      return (
        <>
          <SectionLabel>Pattern</SectionLabel>
          <NumberInput label="Count" value={p.count} min={2} max={50} step={1} unit="" onChange={(v) => onUpdate({ count: Math.round(v) })} />
          <SectionLabel>Rotation Axis</SectionLabel>
          <XYZPicker label="Rotation axis" value={getActiveAxis(p)} onChange={(a) => onUpdate(setAxisParams(a))} />
        </>
      );
    default:
      return (
        <div className="text-[11px] px-2 py-2" style={{ color: 'var(--text-muted)' }}>
          No editable parameters
        </div>
      );
  }
}
