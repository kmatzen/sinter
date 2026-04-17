import { useState, useRef, useEffect } from 'react';
import { useModelerStore } from '../../store/modelerStore';
import { NODE_LABELS, nodeSummary, expectedChildren } from '../../types/operations';
import type { SDFNodeUI } from '../../types/operations';

const KIND_COLORS: Record<string, string> = {
  box: '#4aba7a', sphere: '#4aba7a', cylinder: '#4aba7a', torus: '#4aba7a',
  cone: '#4aba7a', capsule: '#4aba7a', ellipsoid: '#4aba7a',
  union: '#a878e8', subtract: '#a878e8', intersect: '#a878e8',
  shell: '#d4a04a', offset: '#d4a04a', round: '#d4a04a', mirror: '#d4a04a', halfSpace: '#d4a04a',
  linearPattern: '#e06888', circularPattern: '#e06888',
  translate: '#5b9ee8', rotate: '#5b9ee8', scale: '#5b9ee8',
  text: '#4aba7a',
};

const INDENT = 10;
const MAX_VISUAL_DEPTH = 6;

interface Props {
  node: SDFNodeUI;
  depth: number;
  isLast?: boolean;
}

export function TreeNode({ node, depth, isLast = true }: Props) {
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const expandedNodes = useModelerStore((s) => s.expandedNodes);
  const selectNode = useModelerStore((s) => s.selectNode);
  const toggleExpanded = useModelerStore((s) => s.toggleExpanded);
  const toggleNode = useModelerStore((s) => s.toggleNode);
  const removeNode = useModelerStore((s) => s.removeNode);
  const moveNode = useModelerStore((s) => s.moveNode);
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const [dragOver, setDragOver] = useState(false);

  const rowRef = useRef<HTMLDivElement>(null);
  const isSelected = selectedId === node.id;
  const expected = expectedChildren(node.kind);
  const hasChildren = node.children.length > 0 || expected > 0;
  const isExpanded = expandedNodes.has(node.id);
  const missingSlots = Math.max(0, expected - node.children.length);
  const summary = nodeSummary(node);
  const color = KIND_COLORS[node.kind] || '#888';
  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH);
  const leftPad = visualDepth * INDENT + 6;

  // Scroll selected node into view (e.g. after viewport pick)
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isSelected]);

  return (
    <div className="relative">
      {/* Vertical thread line from parent */}
      {depth > 0 && (
        <div
          className="absolute top-0"
          style={{
            left: `${(visualDepth - 1) * INDENT + 6 + 4}px`,
            width: '1px',
            height: isLast ? '13px' : '100%',
            background: 'var(--border-subtle)',
          }}
        />
      )}

      {/* Horizontal stub connecting thread to node */}
      {depth > 0 && (
        <div
          className="absolute"
          style={{
            left: `${(visualDepth - 1) * INDENT + 6 + 4}px`,
            top: '12px',
            width: `${INDENT - 4}px`,
            height: '1px',
            background: 'var(--border-subtle)',
          }}
        />
      )}

      {/* Node row */}
      <div
        ref={rowRef}
        className="flex items-center gap-1 pr-1.5 h-[26px] cursor-pointer relative"
        style={{
          paddingLeft: `${leftPad}px`,
          background: isSelected ? 'var(--accent-subtle)' : dragOver ? 'rgba(91,140,223,0.1)' : 'transparent',
          borderLeft: isSelected ? `2px solid var(--accent)` : '2px solid transparent',
          opacity: node.enabled ? 1 : 0.35,
        }}
        onClick={() => selectNode(node.id)}
        onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-hover)'; }}
        onMouseLeave={(e) => { if (!isSelected && !dragOver) e.currentTarget.style.background = 'transparent'; }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', node.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const paletteData = e.dataTransfer.getData('application/sinter-node');
          if (paletteData) {
            try { addNodeFromData(node.id, JSON.parse(paletteData)); } catch {}
            return;
          }
          const sourceId = e.dataTransfer.getData('text/plain');
          if (sourceId && sourceId !== node.id) {
            moveNode(sourceId, node.id);
          }
        }}
      >
        {/* Expand/collapse */}
        {hasChildren ? (
          <button
            className="w-4 h-4 flex items-center justify-center shrink-0"
            style={{ color: 'var(--text-muted)', fontSize: '8px' }}
            onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id); }}
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? '\u25BC' : '\u25B6'}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        {/* Kind color pip */}
        <span
          className="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ background: color }}
        />

        {/* Label */}
        <span
          className="text-[11px] font-medium truncate shrink-0"
          style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
        >
          {NODE_LABELS[node.kind] || node.kind}
        </span>

        {/* Summary */}
        <span
          className="text-[10px] truncate flex-1 font-mono"
          style={{ color: 'var(--text-muted)', opacity: 0.7 }}
        >
          {summary}
        </span>

        {/* Actions — only show on hover via CSS */}
        <span className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover-actions">
          <button
            onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }}
            className="w-5 h-5 flex items-center justify-center rounded text-[10px]"
            style={{ color: 'var(--text-muted)' }}
            title={node.enabled ? 'Disable' : 'Enable'}
            aria-label={node.enabled ? 'Disable node' : 'Enable node'}
            aria-pressed={node.enabled}
          >
            {node.enabled ? '\u25C9' : '\u25CB'}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
            className="w-5 h-5 flex items-center justify-center rounded text-[10px]"
            style={{ color: 'var(--text-muted)' }}
            title="Remove"
            aria-label="Remove node"
            onMouseEnter={(e) => { e.currentTarget.style.color = '#d45a5a'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            {'\u2715'}
          </button>
        </span>
      </div>

      {/* Children + placeholder slots */}
      {hasChildren && isExpanded && (
        <div className="relative">
          {node.children.map((child, i) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              isLast={i === node.children.length - 1 && missingSlots === 0}
            />
          ))}
          {Array.from({ length: missingSlots }).map((_, i) => (
            <PlaceholderSlot
              key={`empty-${i}`}
              parentId={node.id}
              depth={depth + 1}
              isLast={i === missingSlots - 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderSlot({ parentId, depth, isLast }: { parentId: string; depth: number; isLast: boolean }) {
  const moveNode = useModelerStore((s) => s.moveNode);
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const [dragOver, setDragOver] = useState(false);

  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH);
  const leftPad = visualDepth * INDENT + 6;

  return (
    <div className="relative">
      {/* Thread lines */}
      <div
        className="absolute top-0"
        style={{
          left: `${(visualDepth - 1) * INDENT + 6 + 4}px`,
          width: '1px',
          height: isLast ? '13px' : '100%',
          background: 'var(--border-subtle)',
        }}
      />
      <div
        className="absolute"
        style={{
          left: `${(visualDepth - 1) * INDENT + 6 + 4}px`,
          top: '12px',
          width: `${INDENT - 4}px`,
          height: '1px',
          background: 'var(--border-subtle)',
        }}
      />

      <div
        className="flex items-center h-[26px]"
        style={{
          paddingLeft: `${leftPad + 20}px`,
          background: dragOver ? 'rgba(91,140,223,0.1)' : 'transparent',
        }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const paletteData = e.dataTransfer.getData('application/sinter-node');
          if (paletteData) {
            try { addNodeFromData(parentId, JSON.parse(paletteData)); } catch {}
            return;
          }
          const sourceId = e.dataTransfer.getData('text/plain');
          if (sourceId) moveNode(sourceId, parentId);
        }}
      >
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border border-dashed"
          style={{ borderColor: dragOver ? 'var(--accent-blue)' : 'var(--border-default)', color: 'var(--text-muted)' }}
        >
          drop here
        </span>
      </div>
    </div>
  );
}
