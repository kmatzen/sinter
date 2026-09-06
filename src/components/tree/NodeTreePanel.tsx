import { useModelerStore } from '../../store/modelerStore';
import { useTreeUiStore } from '../../store/treeUiStore';
import { TreeNode } from './TreeNode';
import { PartsPalette } from './PartsPalette';
import { Sparkles, ChevronsDownUp, ChevronsUpDown, X } from 'lucide-react';

/**
 * Inner content — reused by desktop sidebar and mobile overlay.
 *
 * `onClose` is passed only by the mobile overlay. It puts the dismiss control
 * in this header rather than in a second header above it, which is what the
 * slide-over used to do.
 */
export function NodeTreeContent({ onClose }: { onClose?: () => void } = {}) {
  const tree = useModelerStore((s) => s.tree);
  const expandedNodes = useModelerStore((s) => s.expandedNodes);
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const simplifyTree = useModelerStore((s) => s.simplifyTree);
  const expandAll = useModelerStore((s) => s.expandAll);
  const collapseAll = useModelerStore((s) => s.collapseAll);
  const allExpanded = tree ? expandedNodes.size > 0 : false;
  const movingNodeId = useTreeUiStore((s) => s.movingNodeId);
  const cancelMove = useTreeUiStore((s) => s.cancelMove);

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
    <div data-testid="node-tree" className="hidden lg:flex w-70 flex-col" style={{ background: 'var(--bg-panel)', borderRight: '1px solid var(--border-subtle)' }}>
      <NodeTreeContent />
    </div>
  );
}
