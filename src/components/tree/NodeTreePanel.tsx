import { useModelerStore } from '../../store/modelerStore';
import { useTreeUiStore } from '../../store/treeUiStore';
import { TreeNode } from './TreeNode';
import { PartsPalette } from './PartsPalette';
import { NODE_LABELS } from '../../types/operations';
import { Sparkles, ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SDFNodeUI } from '../../types/operations';

export function filterNodeTree(node: SDFNodeUI | null, query: string): SDFNodeUI | null {
  if (!node) return null;
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return node;
  const searchable = `${node.label} ${NODE_LABELS[node.kind] ?? node.kind} ${node.kind} ${node.group ?? ''}`.toLocaleLowerCase();
  const ownMatch = terms.every((term) => searchable.includes(term));
  const children = node.children
    .map((child) => filterNodeTree(child, query))
    .filter((child): child is SDFNodeUI => child !== null);
  return ownMatch || children.length ? { ...node, children: ownMatch ? node.children : children } : null;
}

export function groupedNodes(tree: SDFNodeUI | null): Map<string, SDFNodeUI[]> {
  const groups = new Map<string, SDFNodeUI[]>();
  const visit = (node: SDFNodeUI) => {
    if (node.group) groups.set(node.group, [...(groups.get(node.group) ?? []), node]);
    node.children.forEach(visit);
  };
  if (tree) visit(tree);
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function NodeGroupFolder({ name, nodes }: { name: string; nodes: SDFNodeUI[] }) {
  const renameGroup = useModelerStore((state) => state.renameGroup);
  const selectNode = useModelerStore((state) => state.selectNode);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  return (
    <details className="group rounded" style={{ background: 'var(--bg-surface)' }}>
      <summary role="button" aria-label={`Group ${name}, ${nodes.length} ${nodes.length === 1 ? 'node' : 'nodes'}`} className="tap-h cursor-pointer px-2 py-1 text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
        {name} <span style={{ color: 'var(--text-muted)' }}>({nodes.length})</span>
      </summary>
      <div className="px-2 pb-2">
        <input
          aria-label={`Rename group ${name}`}
          value={draft}
          maxLength={256}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => { renameGroup(name, draft); setDraft(draft.trim() || name); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              renameGroup(name, event.currentTarget.value);
              setDraft(event.currentTarget.value.trim() || name);
              event.currentTarget.blur();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(name);
            }
          }}
          className="w-full tap-h rounded px-1 text-[11px]"
          style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {nodes.map((node) => (
            <button key={node.id} onClick={() => selectNode(node.id)} className="tap-h rounded px-2 text-[10px]" style={{ color: 'var(--accent-blue)', border: '1px solid var(--border-subtle)' }}>
              {node.label || NODE_LABELS[node.kind] || node.kind}
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

/**
 * Inner content — reused by desktop sidebar and mobile overlay.
 *
 * `onClose` is passed only by the mobile overlay. It puts the dismiss control
 * in this header rather than in a second header above it, which is what the
 * slide-over used to do.
 */
export function NodeTreeContent({ onClose }: { onClose?: () => void } = {}) {
  const [query, setQuery] = useState('');
  const tree = useModelerStore((s) => s.tree);
  const expandedNodes = useModelerStore((s) => s.expandedNodes);
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const simplifyTree = useModelerStore((s) => s.simplifyTree);
  const expandAll = useModelerStore((s) => s.expandAll);
  const collapseAll = useModelerStore((s) => s.collapseAll);
  const allExpanded = tree ? expandedNodes.size > 0 : false;
  const movingNodeId = useTreeUiStore((s) => s.movingNodeId);
  const selectedNodeId = useModelerStore((s) => s.selectedNodeId);
  const cancelMove = useTreeUiStore((s) => s.cancelMove);
  const hiddenCount = useTreeUiStore((s) => s.hiddenNodeIds.size);
  const isolatedNodeId = useTreeUiStore((s) => s.isolatedNodeId);
  const showAll = useTreeUiStore((s) => s.showAll);
  const selectedLabel = (() => {
    const find = (node: typeof tree): string | null => {
      if (!node) return null;
      if (node.id === selectedNodeId) return node.label || NODE_LABELS[node.kind];
      for (const child of node.children) { const label = find(child); if (label) return label; }
      return null;
    };
    return find(tree);
  })();
  const filteredTree = useMemo(() => filterNodeTree(tree, query), [tree, query]);
  const groups = useMemo(() => groupedNodes(tree), [tree]);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">
        {selectedLabel ? `Selected ${selectedLabel}` : 'No model node selected'}
      </div>

      <div className="px-3 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>
          Node Tree
        </span>
        <div className="flex items-center gap-1">
        {(hiddenCount > 0 || isolatedNodeId) && (
          <button
            onClick={showAll}
            title="Show all nodes in viewport"
            className="h-6 tap-h px-2 rounded text-[10px]"
            style={{ background: 'var(--bg-elevated)', color: 'var(--accent-blue)', border: '1px solid var(--border-subtle)' }}
          >
            Show all
          </button>
        )}
        {tree && (
          <button
            onClick={allExpanded ? collapseAll : expandAll}
            title={allExpanded ? 'Collapse all' : 'Expand all'}
            className="w-6 h-6 tap rounded flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
          </button>
        )}
        {tree && (
          <button
            onClick={simplifyTree}
            title="Simplify tree: remove identity transforms, collapse redundant nodes"
            className="w-6 h-6 tap rounded flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            <Sparkles size={12} />
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close node tree"
            className="w-6 h-6 tap rounded flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            <X size={12} />
          </button>
        )}
        </div>
      </div>

      {tree && (
        <div className="px-2 py-1.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-1">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find name or kind"
              aria-label="Search node tree"
              className="min-w-0 flex-1 h-7 tap-h rounded px-2 text-[11px]"
              style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}
            />
            {query && <button onClick={() => setQuery('')} aria-label="Clear node search" className="w-7 h-7 tap rounded" style={{ color: 'var(--text-muted)' }}>×</button>}
          </div>
          {query && <div role="status" className="mt-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {filteredTree ? 'Matching nodes shown with their context' : 'No matching nodes'}
          </div>}
        </div>
      )}

      {groups.size > 0 && (
        <section aria-label="Node groups" className="px-2 py-1.5 space-y-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          {[...groups].map(([name, nodes]) => <NodeGroupFolder key={name} name={name} nodes={nodes} />)}
        </section>
      )}

      {/*
        Move mode is the only state in the tree where a tap does something
        other than select, so it says so. Without the banner the tree just
        silently stops selecting, which reads as a bug.
      */}
      {movingNodeId && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 shrink-0"
             style={{ background: 'rgba(91,140,223,0.15)', borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            Tap a node to move it there
          </span>
          <button
            onClick={cancelMove}
            className="text-[11px] px-2 py-1 tap-h rounded shrink-0"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Tree view */}
      <div
        data-testid="tree-nodes"
        role="tree"
        aria-label="Model node tree"
        className="flex-1 overflow-y-auto py-1"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/sinter-node')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const paletteData = e.dataTransfer.getData('application/sinter-node');
          if (paletteData) {
            e.preventDefault();
            try { addNodeFromData(null, JSON.parse(paletteData)); } catch {}
          }
        }}
      >
        {!tree && (
          <div className="p-6 text-center">
            <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>No model yet</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Add a shape from the palette below, or use AI Chat.
            </p>
          </div>
        )}
        {tree && filteredTree && <TreeNode node={filteredTree} depth={0} forceExpanded={Boolean(query)} />}
      </div>

      <PartsPalette />
    </>
  );
}

/** Desktop sidebar wrapper */
export function NodeTreePanel() {
  return (
    <div data-testid="node-tree" className="hidden lg:flex w-70 flex-col" style={{ background: 'var(--bg-panel)', borderRight: '1px solid var(--border-subtle)' }}>
      <NodeTreeContent />
    </div>
  );
}
