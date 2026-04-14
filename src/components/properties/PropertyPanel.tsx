import { useModelerStore } from '../../store/modelerStore';
import { NODE_LABELS, NODE_KINDS, type SDFNodeUI } from '../../types/operations';
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
      style={{ color: 'var(--text-muted)', opacity: 0.7 }}
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
          className="flex-1 text-[11px] py-1 transition-colors"
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
            className="flex-1 h-7 rounded text-[11px] font-medium transition-colors"
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

/** Inline radio pills for axis selection */
function AxisRadio({ value, onUpdate }: { value: number; onUpdate: (p: Record<string, number>) => void }) {
  return (
    <div className="flex gap-1 px-2 mb-1" role="radiogroup" aria-label="Cut axis">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => {
        const active = value === i;
        return (
          <button
            key={axis}
            role="radio"
            aria-checked={active}
            onClick={() => onUpdate({ axis: i })}
            title={`Cut along ${axis} axis`}
            className="flex-1 h-7 rounded text-[11px] font-medium transition-colors"
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

export function PropertyPanel() {
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const tree = useModelerStore((s) => s.tree);
  const updateParams = useModelerStore((s) => s.updateNodeParams);
  const updateData = useModelerStore((s) => s.updateNodeData);
  const changeKind = useModelerStore((s) => s.changeNodeKind);

  const node = tree && selectedId ? findNode(tree, selectedId) : null;

  if (!node) {
    return (
      <div className="w-72 flex items-center justify-center" style={{ background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-subtle)' }}>
        <p className="text-[11px] text-center px-8 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Select a node to<br />edit its properties
        </p>
      </div>
    );
  }

  const update = (params: Record<string, number>) => updateParams(node.id, params);
  const updateStr = (data: Record<string, string>) => updateData(node.id, data);

  return (
    <div className="w-72 overflow-y-auto" style={{ background: 'var(--bg-panel)', borderLeft: '1px solid var(--border-subtle)' }}>
      {/* Header */}
      <div className="px-3 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>
          Properties
        </span>
      </div>

      <div className="py-2">
        {/* Kind switcher for compatible groups */}
        {NODE_KINDS.booleans.includes(node.kind as any) && (
          <KindSwitcher kinds={[...NODE_KINDS.booleans]} current={node.kind} onChange={(k) => changeKind(node.id, k)} />
        )}
        {NODE_KINDS.primitives.includes(node.kind as any) && (
          <KindSwitcher kinds={[...NODE_KINDS.primitives]} current={node.kind} onChange={(k) => changeKind(node.id, k)} />
        )}

        {/* Parameters */}
        <NodeEditor node={node} onUpdate={update} onUpdateStr={updateStr} />
      </div>
    </div>
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
              className="w-full rounded h-7 px-2 text-[12px] focus:outline-none"
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
          <AxisRadio value={p.axis} onUpdate={onUpdate} />
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
                  className="flex-1 h-7 rounded text-[11px] font-medium transition-colors"
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
          <NumberInput label="X" value={p.axisX} unit="" step={1} onChange={(v) => onUpdate({ axisX: v })} />
          <NumberInput label="Y" value={p.axisY} unit="" step={1} onChange={(v) => onUpdate({ axisY: v })} />
          <NumberInput label="Z" value={p.axisZ} unit="" step={1} onChange={(v) => onUpdate({ axisZ: v })} />
        </>
      );
    case 'circularPattern':
      return (
        <>
          <SectionLabel>Pattern</SectionLabel>
          <NumberInput label="Count" value={p.count} min={2} max={50} step={1} unit="" onChange={(v) => onUpdate({ count: Math.round(v) })} />
          <SectionLabel>Rotation Axis</SectionLabel>
          <NumberInput label="X" value={p.axisX} unit="" step={1} onChange={(v) => onUpdate({ axisX: v })} />
          <NumberInput label="Y" value={p.axisY} unit="" step={1} onChange={(v) => onUpdate({ axisY: v })} />
          <NumberInput label="Z" value={p.axisZ} unit="" step={1} onChange={(v) => onUpdate({ axisZ: v })} />
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
