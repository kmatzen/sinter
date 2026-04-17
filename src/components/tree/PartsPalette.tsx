import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { NODE_LABELS, NODE_DEFAULTS } from '../../types/operations';
import type { SDFNodeUI } from '../../types/operations';
import { useModelerStore } from '../../store/modelerStore';
import { Box, Circle, Cylinder, Donut, Cone, Pill, Egg, Merge, Minus, Combine, Shell, Expand, CircleDot, FlipHorizontal, Scissors, RotateCcw, Scaling, Move, Repeat, CircleDashed, GripVertical } from 'lucide-react';
import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  box: <Box size={14} />, sphere: <Circle size={14} />, cylinder: <Cylinder size={14} />,
  torus: <Donut size={14} />, cone: <Cone size={14} />, capsule: <Pill size={14} />, ellipsoid: <Egg size={14} />,
  union: <Merge size={13} />, subtract: <Minus size={13} />, intersect: <Combine size={13} />,
  shell: <Shell size={13} />, offset: <Expand size={13} />, round: <CircleDot size={13} />,
  mirror: <FlipHorizontal size={13} />, halfSpace: <Scissors size={13} />,
  linearPattern: <Repeat size={13} />, circularPattern: <CircleDashed size={13} />,
  translate: <Move size={13} />, rotate: <RotateCcw size={13} />, scale: <Scaling size={13} />,
};

/** Category accent colors matching the tree node pips */
const CAT_COLORS: Record<string, string> = {
  shapes: '#4aba7a',
  booleans: '#a878e8',
  modifiers: '#d4a04a',
  patterns: '#5b9ee8',
  transforms: '#5b9ee8',
};

function n(kind: string, label: string, params: Record<string, number>, children: SDFNodeUI[] = []): SDFNodeUI {
  return { id: uuidv4(), kind, label, params, children, enabled: true };
}

function simpleNodeData(kind: string): string {
  return JSON.stringify({ kind, label: NODE_LABELS[kind] || kind, params: NODE_DEFAULTS[kind] || {} });
}

function presetNodeData(builder: () => SDFNodeUI): string {
  return JSON.stringify(builder());
}

/** Compact draggable shape tile — icon-forward with label below */
function ShapeTile({ kind, color }: { kind: string; color: string }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', simpleNodeData(kind));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(simpleNodeData(kind)))}
      role="button"
      aria-label={`Add ${NODE_LABELS[kind]}`}
      className="flex flex-col items-center justify-center gap-0.5 w-[56px] h-[48px] rounded cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.background = 'var(--bg-surface)'; }}
      title={`Add ${NODE_LABELS[kind]}`}
    >
      <span style={{ color }}>{ICONS[kind]}</span>
      <span className="text-[9px] leading-none" style={{ color: 'var(--text-muted)' }}>
        {NODE_LABELS[kind]}
      </span>
    </div>
  );
}

/** Compact operation pill — icon + label inline */
function OpPill({ kind, color }: { kind: string; color: string }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', simpleNodeData(kind));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(simpleNodeData(kind)))}
      role="button"
      aria-label={`Add ${NODE_LABELS[kind]}`}
      className="flex items-center gap-1 px-1.5 py-1 rounded cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
      title={`Add ${NODE_LABELS[kind]}`}
    >
      <span style={{ color }}>{ICONS[kind]}</span>
      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
        {NODE_LABELS[kind]}
      </span>
    </div>
  );
}

/** Preset card — name + description, with a drag grip */
function PresetCard({ name, desc, dragData }: { name: string; desc: string; dragData: string }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', dragData);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(dragData))}
      role="button"
      aria-label={`Add ${name} preset: ${desc}`}
      title={`Add ${name}: ${desc}`}
      className="flex items-start gap-1.5 px-2 py-1.5 rounded cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.background = 'var(--bg-surface)'; }}
    >
      <GripVertical size={10} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
      <div className="min-w-0">
        <div className="text-[11px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{name}</div>
        <div className="text-[9px] truncate" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>{desc}</div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] tracking-[0.1em] uppercase px-0.5 pb-1 pt-2 first:pt-0" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
      {children}
    </div>
  );
}

const PRESET_CATEGORIES = [
  {
    category: 'Enclosures',
    items: [
      { name: 'Rounded Enclosure', desc: 'Hollow box with rounded edges', build: () =>
        n('shell', 'Hollow', { thickness: 2 }, [n('round', 'Round', { radius: 3 }, [n('box', 'Body', { width: 80, height: 30, depth: 60 })])]) },
      { name: 'Arduino Case', desc: '74x30x59mm with mounts', build: () =>
        n('union', 'Case', { smooth: 0 }, [
          n('shell', 'Shell', { thickness: 2 }, [n('round', 'Round', { radius: 2 }, [n('box', 'Body', { width: 74, height: 30, depth: 59 })])]),
          n('mirror', 'Mounts', { mirrorX: 1, mirrorY: 0, mirrorZ: 1 }, [
            n('translate', 'Pos', { x: 31, y: -13, z: 24 }, [n('subtract', 'Standoff', { smooth: 0 }, [n('cylinder', 'Post', { radius: 3, height: 6 }), n('cylinder', 'Hole', { radius: 1.6, height: 8 })])])])]) },
      { name: 'Cylindrical Container', desc: 'Round container with lip', build: () =>
        n('shell', 'Hollow', { thickness: 2 }, [n('union', 'Body', { smooth: 0.5 }, [n('cylinder', 'Body', { radius: 25, height: 40 }), n('translate', 'Lip', { x: 0, y: 20, z: 0 }, [n('cylinder', 'Ring', { radius: 27, height: 4 })])])]) },
    ],
  },
  {
    category: 'Fasteners',
    items: [
      { name: 'M3 Standoff', desc: '3.2mm clearance hole', build: () =>
        n('subtract', 'Standoff', { smooth: 0 }, [n('cylinder', 'Post', { radius: 4, height: 8 }), n('cylinder', 'Hole', { radius: 1.6, height: 10 })]) },
      { name: '4x Mount Pattern', desc: 'Mirrored standoffs', build: () =>
        n('mirror', 'Mirror XZ', { mirrorX: 1, mirrorY: 0, mirrorZ: 1 }, [n('translate', 'Pos', { x: 25, y: 0, z: 15 }, [n('subtract', 'Standoff', { smooth: 0 }, [n('cylinder', 'Post', { radius: 4, height: 8 }), n('cylinder', 'Hole', { radius: 1.6, height: 10 })])])]) },
      { name: 'Snap-Fit Clip', desc: 'Cantilever clip', build: () =>
        n('union', 'Clip', { smooth: 0.5 }, [n('box', 'Beam', { width: 3, height: 12, depth: 2 }), n('translate', 'Hook', { x: 0, y: 6, z: 1 }, [n('box', 'Hook', { width: 3, height: 2, depth: 3 })])]) },
      { name: 'Wall Bracket', desc: 'L-bracket with holes', build: () =>
        n('subtract', 'Bracket', { smooth: 0 }, [n('union', 'L', { smooth: 2 }, [n('box', 'V', { width: 30, height: 40, depth: 4 }), n('translate', 'H', { x: 0, y: -18, z: 13 }, [n('box', 'Base', { width: 30, height: 4, depth: 30 })])]), n('translate', 'Hole', { x: 0, y: 10, z: 0 }, [n('cylinder', 'Screw', { radius: 2.1, height: 10 })])]) },
    ],
  },
  {
    category: 'Patterns',
    items: [
      { name: 'Vent Grid', desc: 'Linear slot array', build: () =>
        n('linearPattern', 'Vents', { axisX: 1, axisY: 0, axisZ: 0, count: 5, spacing: 6 }, [n('round', 'Round', { radius: 0.5 }, [n('box', 'Slot', { width: 3, height: 20, depth: 2 })])]) },
      { name: 'Circular Vents', desc: 'Radial hole array', build: () =>
        n('circularPattern', 'Vents', { axisX: 0, axisY: 0, axisZ: 1, count: 8 }, [n('translate', 'Pos', { x: 12, y: 0, z: 0 }, [n('capsule', 'Hole', { radius: 2, height: 6 })])]) },
      { name: 'Honeycomb', desc: 'Hex-ish hole pattern', build: () =>
        n('circularPattern', 'Ring', { axisX: 0, axisY: 0, axisZ: 1, count: 6 }, [n('translate', 'Pos', { x: 10, y: 0, z: 0 }, [n('cylinder', 'Hole', { radius: 3, height: 4 })])]) },
    ],
  },
  {
    category: 'Functional',
    items: [
      { name: 'Knob', desc: 'Grip with shaft hole', build: () =>
        n('subtract', 'Knob', { smooth: 0 }, [n('union', 'Body', { smooth: 1 }, [n('cylinder', 'Grip', { radius: 12, height: 15 }), n('translate', 'Top', { x: 0, y: 7, z: 0 }, [n('sphere', 'Dome', { radius: 12 })])]), n('cylinder', 'Shaft', { radius: 3, height: 20 })]) },
      { name: 'Phone Stand', desc: 'Angled phone holder', build: () =>
        n('union', 'Stand', { smooth: 2 }, [n('box', 'Base', { width: 60, height: 5, depth: 40 }), n('translate', 'Back', { x: 0, y: 20, z: -15 }, [n('rotate', 'Angle', { x: 15, y: 0, z: 0 }, [n('box', 'Support', { width: 60, height: 40, depth: 5 })])]), n('translate', 'Lip', { x: 0, y: 5, z: 10 }, [n('box', 'Lip', { width: 60, height: 8, depth: 5 })])]) },
      { name: 'Cable Clip', desc: 'C-shaped cable clip', build: () =>
        n('subtract', 'Clip', { smooth: 0 }, [n('union', 'Body', { smooth: 1 }, [n('cylinder', 'Ring', { radius: 8, height: 10 }), n('translate', 'Tab', { x: 0, y: 0, z: -8 }, [n('box', 'Tab', { width: 16, height: 10, depth: 4 })])]), n('cylinder', 'Hole', { radius: 5, height: 12 }), n('translate', 'Gap', { x: 0, y: 8, z: 0 }, [n('box', 'Opening', { width: 4, height: 8, depth: 12 })])]) },
      { name: 'Gear', desc: '12-tooth with axle hole', build: () =>
        n('subtract', 'Gear', { smooth: 0 }, [n('union', 'Body', { smooth: 0 }, [n('cylinder', 'Hub', { radius: 10, height: 5 }), n('circularPattern', 'Teeth', { axisX: 0, axisY: 1, axisZ: 0, count: 12 }, [n('translate', 'Pos', { x: 11, y: 0, z: 0 }, [n('box', 'Tooth', { width: 4, height: 5, depth: 3 })])])]), n('cylinder', 'Axle', { radius: 2.5, height: 8 })]) },
    ],
  },
];

type Tab = 'shapes' | 'operations' | 'presets';

export function PartsPalette() {
  const [tab, setTab] = useState<Tab>('shapes');

  return (
    <div className="flex flex-col" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      {/* Content */}
      <div className="p-2 overflow-y-auto" style={{ maxHeight: '220px' }}>
        {tab === 'shapes' && (
          <div className="flex flex-wrap gap-1 justify-center">
            {(['box', 'sphere', 'cylinder', 'torus', 'cone', 'capsule', 'ellipsoid'] as const).map((kind) => (
              <ShapeTile key={kind} kind={kind} color={CAT_COLORS.shapes} />
            ))}
          </div>
        )}

        {tab === 'operations' && (
          <div>
            <SectionHeader>Booleans</SectionHeader>
            <div className="flex flex-wrap gap-1">
              {(['union', 'subtract', 'intersect'] as const).map((kind) => (
                <OpPill key={kind} kind={kind} color={CAT_COLORS.booleans} />
              ))}
            </div>

            <SectionHeader>Modifiers</SectionHeader>
            <div className="flex flex-wrap gap-1">
              {(['shell', 'offset', 'round', 'mirror', 'halfSpace'] as const).map((kind) => (
                <OpPill key={kind} kind={kind} color={CAT_COLORS.modifiers} />
              ))}
            </div>

            <SectionHeader>Patterns & Transforms</SectionHeader>
            <div className="flex flex-wrap gap-1">
              {(['linearPattern', 'circularPattern', 'translate', 'rotate', 'scale'] as const).map((kind) => (
                <OpPill key={kind} kind={kind} color={CAT_COLORS.transforms} />
              ))}
            </div>
          </div>
        )}

        {tab === 'presets' && (
          <div>
            {PRESET_CATEGORIES.map((cat) => (
              <div key={cat.category}>
                <SectionHeader>{cat.category}</SectionHeader>
                <div className="flex flex-col gap-1">
                  {cat.items.map((item) => (
                    <PresetCard key={item.name} name={item.name} desc={item.desc} dragData={presetNodeData(item.build)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tab bar — pinned at bottom */}
      <div
        className="flex mx-2 mb-2 rounded-md overflow-hidden shrink-0"
        style={{ border: '1px solid var(--border-subtle)' }}
        role="tablist"
        aria-label="Parts palette"
      >
        {([['shapes', 'Shapes'], ['operations', 'Ops'], ['presets', 'Presets']] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="flex-1 text-[10px] py-1 font-medium transition-colors"
            style={{
              background: tab === key ? 'var(--bg-elevated)' : 'transparent',
              color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
              borderRight: key !== 'presets' ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
