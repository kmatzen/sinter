import { useState } from 'react';
import { NODE_LABELS, NODE_DEFAULTS } from '../../types/operations';
import type { SDFNodeUI } from '../../types/operations';
import { PRESET_CATEGORIES, formatSize } from './presets';
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
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', simpleNodeData(kind));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(simpleNodeData(kind)))}
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
    </button>
  );
}

/** Compact operation pill — icon + label inline */
function OpPill({ kind, color }: { kind: string; color: string }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', simpleNodeData(kind));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(simpleNodeData(kind)))}
      aria-label={`Add ${NODE_LABELS[kind]}`}
      className="flex items-center gap-1 px-1.5 py-1 tap-h rounded cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
      title={`Add ${NODE_LABELS[kind]}`}
    >
      <span style={{ color }}>{ICONS[kind]}</span>
      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
        {NODE_LABELS[kind]}
      </span>
    </button>
  );
}

/**
 * Preset card — name, envelope, description, with a drag grip.
 *
 * The envelope is rendered from the preset's `size`, never written into its
 * description. `presets.test.ts` holds `size` to the geometry, so this is the
 * only place a user-visible dimension can come from.
 */
function PresetCard({ name, size, desc, dragData }: { name: string; size: string; desc: string; dragData: string }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', dragData);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(dragData))}
      aria-label={`Add ${name} preset, ${size}: ${desc}`}
      title={`Add ${name} — ${size}: ${desc}`}
      className="flex items-start gap-1.5 px-2 py-1.5 tap-h rounded cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.background = 'var(--bg-surface)'; }}
    >
      <GripVertical size={10} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
      <div className="min-w-0">
        <div className="text-[11px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{name}</div>
        <div className="text-[9px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>{size}</div>
        <div className="text-[9px] truncate" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>{desc}</div>
      </div>
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] tracking-[0.1em] uppercase px-0.5 pb-1 pt-2 first:pt-0" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
      {children}
    </div>
  );
}

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
                    <PresetCard key={item.name} name={item.name} size={formatSize(item.size)} desc={item.desc} dragData={presetNodeData(item.build)} />
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
            className="flex-1 text-[10px] py-1 tap-h font-medium transition-colors"
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
