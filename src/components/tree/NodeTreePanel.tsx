import { useModelerStore } from '../../store/modelerStore';
import { TreeNode } from './TreeNode';
import { PartsPalette } from './PartsPalette';
import { Sparkles, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';

/** Inner content — reused by desktop sidebar and mobile overlay */
export function NodeTreeContent() {
  const tree = useModelerStore((s) => s.tree);
  const expandedNodes = useModelerStore((s) => s.expandedNodes);
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const simplifyTree = useModelerStore((s) => s.simplifyTree);
  const expandAll = useModelerStore((s) => s.expandAll);
  const collapseAll = useModelerStore((s) => s.collapseAll);
  const allExpanded = tree ? expandedNodes.size > 0 : false;

  return (
    <>
      <div className="px-3 py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>
          Node Tree
        </span>
        <div className="flex items-center gap-1">
        {tree && (
          <button
            onClick={allExpanded ? collapseAll : expandAll}
            title={allExpanded ? 'Collapse all' : 'Expand all'}
            className="w-6 h-6 rounded flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            {allExpanded ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
          </button>
        )}
        {tree && (
          <button
            onClick={simplifyTree}
            title="Simplify tree: remove identity transforms, collapse redundant nodes"
            className="w-6 h-6 rounded flex items-center justify-center"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
          >
            <Sparkles size={12} />
          </button>
        )}
        </div>
      </div>

      {/* Tree view */}
      <div
        data-testid="tree-nodes"
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
        {tree && <TreeNode node={tree} depth={0} />}
      </div>

      <PartsPalette />
    </>
  );
}

/** Desktop sidebar wrapper */
export function NodeTreePanel() {
  return (
    <div data-testid="node-tree" className="hidden md:flex w-70 flex-col" style={{ background: 'var(--bg-panel)', borderRight: '1px solid var(--border-subtle)' }}>
      <NodeTreeContent />
    </div>
  );
}
