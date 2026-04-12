import { useModelerStore } from '../../store/modelerStore';
import { NODE_LABELS, nodeSummary } from '../../types/operations';
import type { SDFNodeUI } from '../../types/operations';

const KIND_COLORS: Record<string, string> = {
  box: 'bg-emerald-600', sphere: 'bg-emerald-600', cylinder: 'bg-emerald-600', torus: 'bg-emerald-600',
  union: 'bg-purple-600', subtract: 'bg-purple-600', intersect: 'bg-purple-600',
  shell: 'bg-amber-600', offset: 'bg-amber-600', round: 'bg-amber-600', mirror: 'bg-amber-600',
  linearPattern: 'bg-pink-600', circularPattern: 'bg-pink-600',
  translate: 'bg-sky-600', rotate: 'bg-sky-600', scale: 'bg-sky-600',
};

interface Props {
  node: SDFNodeUI;
  depth: number;
}

export function TreeNode({ node, depth }: Props) {
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const expandedNodes = useModelerStore((s) => s.expandedNodes);
  const selectNode = useModelerStore((s) => s.selectNode);
  const toggleExpanded = useModelerStore((s) => s.toggleExpanded);
  const toggleNode = useModelerStore((s) => s.toggleNode);
  const removeNode = useModelerStore((s) => s.removeNode);

  const isSelected = selectedId === node.id;
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  const summary = nodeSummary(node);

  return (
    <div>
      <div
        className={`
          flex items-center gap-1.5 pr-2 py-1 cursor-pointer transition-colors
          ${isSelected ? 'bg-blue-900/40' : 'hover:bg-zinc-800/50'}
          ${!node.enabled ? 'opacity-40' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => selectNode(node.id)}
      >
        {/* Expand/collapse arrow */}
        <button
          className={`w-4 h-4 flex items-center justify-center text-[10px] text-zinc-500 ${hasChildren ? 'hover:text-zinc-300' : 'invisible'}`}
          onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpanded(node.id); }}
        >
          {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : ''}
        </button>

        {/* Kind badge */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${KIND_COLORS[node.kind] || 'bg-zinc-600'} text-white font-medium shrink-0`}>
          {NODE_LABELS[node.kind] || node.kind}
        </span>

        {/* Summary */}
        <span className="text-xs text-zinc-400 truncate flex-1">{summary}</span>

        {/* Toggle enable */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleNode(node.id); }}
          className="text-zinc-400 hover:text-zinc-200 text-[11px] shrink-0"
          title={node.enabled ? 'Disable' : 'Enable'}
        >
          {node.enabled ? '\u25C9' : '\u25CB'}
        </button>

        {/* Delete */}
        <button
          onClick={(e) => { e.stopPropagation(); removeNode(node.id); }}
          className="text-zinc-500 hover:text-red-400 text-[11px] shrink-0"
          title="Remove"
        >
          {'\u2715'}
        </button>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
