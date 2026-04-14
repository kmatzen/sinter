import { useModelerStore } from '../../store/modelerStore';
import { NODE_KINDS, NODE_LABELS } from '../../types/operations';
import { Box, Circle, Cylinder, Donut, Cone, Pill, Egg, Type, Merge, Minus, Combine, Shell, Expand, CircleDot, FlipHorizontal, Scissors, RotateCcw as RotateIcon, Scaling, Move, Repeat, CircleDashed } from 'lucide-react';
import type { ReactNode } from 'react';

const NODE_ICONS: Record<string, ReactNode> = {
  box: <Box size={12} />,
  sphere: <Circle size={12} />,
  cylinder: <Cylinder size={12} />,
  torus: <Donut size={12} />,
  cone: <Cone size={12} />,
  capsule: <Pill size={12} />,
  ellipsoid: <Egg size={12} />,
  text: <Type size={12} />,
  union: <Merge size={12} />,
  subtract: <Minus size={12} />,
  intersect: <Combine size={12} />,
  shell: <Shell size={12} />,
  offset: <Expand size={12} />,
  round: <CircleDot size={12} />,
  mirror: <FlipHorizontal size={12} />,
  halfSpace: <Scissors size={12} />,
  linearPattern: <Repeat size={12} />,
  circularPattern: <CircleDashed size={12} />,
  translate: <Move size={12} />,
  rotate: <RotateIcon size={12} />,
  scale: <Scaling size={12} />,
};

interface Props {
  onClose: () => void;
}

export function AddNodeMenu({ onClose }: Props) {
  const tree = useModelerStore((s) => s.tree);
  const selectedNodeId = useModelerStore((s) => s.selectedNodeId);
  const addPrimitive = useModelerStore((s) => s.addPrimitive);
  const wrapSelected = useModelerStore((s) => s.wrapSelected);

  const handleAddPrimitive = (kind: string) => {
    addPrimitive(kind);
    onClose();
  };

  const handleWrap = (kind: string) => {
    wrapSelected(kind);
    onClose();
  };

  return (
    <div className="p-2 space-y-2" style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
      <div>
        <div className="font-mono text-[9px] tracking-[0.15em] uppercase px-1 mb-1" style={{ color: 'var(--text-muted)' }}>Primitives</div>
        <div className="flex flex-wrap gap-1">
          {NODE_KINDS.primitives.map((kind) => (
            <button
              key={kind}
              onClick={() => handleAddPrimitive(kind)}
              className="text-[11px] px-2 py-1 rounded flex items-center gap-1.5"
              style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            >
              {NODE_ICONS[kind]}{NODE_LABELS[kind]}
            </button>
          ))}
        </div>
      </div>

      {tree && selectedNodeId && (
        <>
          <div>
            <div className="font-mono text-[9px] tracking-[0.15em] uppercase px-1 mb-1" style={{ color: 'var(--text-muted)' }}>Booleans</div>
            <div className="flex flex-wrap gap-1">
              {NODE_KINDS.booleans.map((kind) => (
                <button
                  key={kind}
                  onClick={() => handleWrap(kind)}
                  className="text-[11px] px-2 py-1 rounded flex items-center gap-1.5"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                >
                  {NODE_ICONS[kind]}{NODE_LABELS[kind]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] tracking-[0.15em] uppercase px-1 mb-1" style={{ color: 'var(--text-muted)' }}>Modifiers</div>
            <div className="flex flex-wrap gap-1">
              {NODE_KINDS.modifiers.map((kind) => (
                <button
                  key={kind}
                  onClick={() => handleWrap(kind)}
                  className="text-[11px] px-2 py-1 rounded flex items-center gap-1.5"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                >
                  {NODE_ICONS[kind]}{NODE_LABELS[kind]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] tracking-[0.15em] uppercase px-1 mb-1" style={{ color: 'var(--text-muted)' }}>Patterns & Transforms</div>
            <div className="flex flex-wrap gap-1">
              {[...NODE_KINDS.patterns, ...NODE_KINDS.transforms].map((kind) => (
                <button
                  key={kind}
                  onClick={() => handleWrap(kind)}
                  className="text-[11px] px-2 py-1 rounded flex items-center gap-1.5"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
                >
                  {NODE_ICONS[kind]}{NODE_LABELS[kind]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
