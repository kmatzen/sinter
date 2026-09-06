import { useState, useRef, useEffect, useMemo } from 'react';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { useTreeUiStore } from '../../store/treeUiStore';
import { NODE_LABELS, nodeSummary, expectedChildren, incompleteNodeIds } from '../../types/operations';
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
  incompleteIds?: Set<string>;
  forceExpanded?: boolean;
  groupNames?: string[];
}

export function TreeNode({ node, depth, isLast = true, incompleteIds: incompleteIdsProp, forceExpanded = false, groupNames: groupNamesProp }: Props) {
  // Only subscribe to tree at the root level (when incompleteIdsProp is not provided)
  const tree = useModelerStore((s) => incompleteIdsProp ? null : s.tree);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const selectedIds = useModelerStore((s) => s.selectedNodeIds);
  const expandedNodes = useModelerStore((s) => s.expandedNodes);
  const selectNode = useModelerStore((s) => s.selectNode);
  const toggleExpanded = useModelerStore((s) => s.toggleExpanded);
  const toggleNode = useModelerStore((s) => s.toggleNode);
  const removeNode = useModelerStore((s) => s.removeNode);
  const duplicateSelected = useModelerStore((s) => s.duplicateSelected);
  const moveNode = useModelerStore((s) => s.moveNode);
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const renameNode = useModelerStore((s) => s.renameNode);
  const setNodeGroup = useModelerStore((s) => s.setNodeGroup);
  // Subscribe to booleans so only rows whose hover state changes re-render.
  const isHovered = useViewportStore((s) => s.hoveredNodeId === node.id);
  const setHoveredNode = useViewportStore((s) => s.setHoveredNode);
  const movingNodeId = useTreeUiStore((s) => s.movingNodeId);
  const beginMove = useTreeUiStore((s) => s.beginMove);
  const cancelMove = useTreeUiStore((s) => s.cancelMove);
  const isLocked = useTreeUiStore((s) => s.lockedNodeIds.has(node.id));
  const isHidden = useTreeUiStore((s) => s.hiddenNodeIds.has(node.id));
  const isolatedNodeId = useTreeUiStore((s) => s.isolatedNodeId);
  const toggleLocked = useTreeUiStore((s) => s.toggleLocked);
  const toggleHidden = useTreeUiStore((s) => s.toggleHidden);
  const isolate = useTreeUiStore((s) => s.isolate);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState(node.label);
  const actionsRef = useRef<HTMLDetailsElement>(null);

  // Compute incomplete IDs once at the root, pass down to children
  const incompleteIds = useMemo(
    () => incompleteIdsProp ?? incompleteNodeIds(tree),
    [incompleteIdsProp, tree],
  );
  const isIncomplete = node.enabled && incompleteIds.has(node.id);
  const isMoving = movingNodeId === node.id;
  const isMoveTarget = !!movingNodeId && !isMoving;

  const rowRef = useRef<HTMLDivElement>(null);
  const isSelected = selectedIds.includes(node.id);
  const isPrimary = selectedId === node.id;
  const expected = expectedChildren(node.kind);
  const hasChildren = node.children.length > 0 || expected > 0;
  const isExpanded = forceExpanded || expandedNodes.has(node.id) || isIncomplete;
  const missingSlots = Math.max(0, expected - node.children.length);
  const summary = nodeSummary(node);
  const color = KIND_COLORS[node.kind] || '#888';
  const kindLabel = NODE_LABELS[node.kind] || node.kind;
  const displayLabel = node.label || kindLabel;
  const accessibleLabel = displayLabel === kindLabel ? kindLabel : `${displayLabel}, ${kindLabel}`;
  const groupNames = useMemo(() => {
    if (groupNamesProp) return groupNamesProp;
    const names = new Set<string>();
    const visit = (current: SDFNodeUI | null) => {
      if (!current) return;
      if (current.group) names.add(current.group);
      current.children.forEach(visit);
    };
    visit(tree ?? node);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [groupNamesProp, tree, node]);
  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH);
  const leftPad = visualDepth * INDENT + 6;

  // Scroll selected node into view (e.g. after viewport pick)
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
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
        role="treeitem"
        tabIndex={isPrimary || (!selectedId && depth === 0) ? 0 : -1}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-label={`${accessibleLabel}${isIncomplete ? ', incomplete' : ''}${node.enabled ? '' : ', disabled'}${isLocked ? ', locked' : ''}${isHidden ? ', hidden in viewport' : ''}${isolatedNodeId === node.id ? ', isolated' : ''}`}
        className="flex items-center gap-1 pr-1.5 h-[26px] tap-h cursor-pointer relative"
        style={{
          paddingLeft: `${leftPad}px`,
          background: isMoveTarget ? 'rgba(91,140,223,0.18)'
            : isMoving ? 'var(--accent-subtle)'
            : isSelected ? 'var(--accent-subtle)'
            : dragOver ? 'rgba(91,140,223,0.1)'
            : isHovered ? 'var(--bg-hover)'
            : isIncomplete ? 'rgba(212,90,90,0.08)' : 'transparent',
          borderLeft: isMoving ? '2px solid var(--accent-blue)'
            : isSelected ? `2px solid var(--accent)`
            : isHovered ? '2px solid rgba(255,255,255,0.35)'
            : isIncomplete ? '2px solid rgba(212,90,90,0.5)' : '2px solid transparent',
          opacity: node.enabled && !isHidden ? 1 : 0.35,
        }}
        onClick={(event) => {
          // While a move is in flight the whole row is a destination, so a tap
          // places the node instead of changing the selection. Tapping the node
          // being moved is the cancel.
          if (movingNodeId) {
            if (movingNodeId !== node.id) moveNode(movingNodeId, node.id);
            cancelMove();
            return;
          }
          if (!isLocked) selectNode(node.id, event.metaKey || event.ctrlKey ? 'toggle' : event.shiftKey ? 'range' : 'replace');
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (movingNodeId) {
              if (movingNodeId !== node.id) moveNode(movingNodeId, node.id);
              cancelMove();
            } else if (!isLocked) selectNode(node.id, event.metaKey || event.ctrlKey ? 'toggle' : event.shiftKey ? 'range' : 'replace');
          } else if (event.key === 'ArrowRight' && hasChildren && !isExpanded) {
            event.preventDefault(); toggleExpanded(node.id);
          } else if (event.key === 'ArrowLeft' && hasChildren && isExpanded) {
            event.preventDefault(); toggleExpanded(node.id);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const rows = [...event.currentTarget.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []];
            const index = rows.indexOf(event.currentTarget);
            rows[index + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
          }
        }}
        onMouseEnter={() => setHoveredNode(node.id)}
        onMouseLeave={() => setHoveredNode(null)}
        draggable={!renaming && !isLocked}
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
            className="w-4 h-4 tap flex items-center justify-center shrink-0"
            style={{ color: 'var(--text-muted)', fontSize: '8px' }}
            onClick={(e) => { e.stopPropagation(); toggleExpanded(node.id); }}
            title={isExpanded ? 'Collapse' : 'Expand'}
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
            aria-expanded={isExpanded}
          >
            {isExpanded ? '\u25BC' : '\u25B6'}
          </button>
        ) : (
          <span className="w-4 tap-w shrink-0" />
        )}

        {/* Kind color pip */}
        <span
          className="w-[6px] h-[6px] rounded-full shrink-0"
          style={{ background: color }}
        />

        {/* Label */}
        {renaming ? (
          <input
            autoFocus
            aria-label={`Rename ${node.label}`}
            value={draftLabel}
            maxLength={256}
            className="min-w-0 w-28 h-5 px-1 rounded text-[11px]"
            style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--accent)' }}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setDraftLabel(event.target.value)}
            onBlur={() => { renameNode(node.id, draftLabel); setRenaming(false); }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') { setDraftLabel(node.label); setRenaming(false); rowRef.current?.focus(); }
            }}
          />
        ) : (
          <span
            className="text-[11px] font-medium truncate shrink-0 max-w-28"
            style={{ color: isIncomplete ? '#d45a5a' : isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
            title={`${displayLabel} (${kindLabel})`}
            onDoubleClick={(event) => { event.stopPropagation(); if (!isLocked) { setDraftLabel(node.label); setRenaming(true); } }}
          >
            {displayLabel}
          </span>
        )}

        {/* Incomplete warning */}
        {isIncomplete && (
          <span
            className="text-[9px] shrink-0"
            style={{ color: '#d45a5a' }}
            title={missingSlots > 0 ? `Needs ${missingSlots} more ${missingSlots === 1 ? 'child' : 'children'}` : 'Has incomplete children'}
          >
            {'\u26A0'}
          </span>
        )}

        {/* Summary */}
        <span
          className="text-[10px] truncate flex-1 font-mono"
          style={{ color: 'var(--text-muted)' }}
        >
          {summary}
        </span>

        {node.group && (
          <span className="max-w-20 truncate rounded px-1 text-[9px]" style={{ color: 'var(--accent-blue)', background: 'rgba(91,140,223,0.12)' }} title={`Group: ${node.group}`}>
            {node.group}
          </span>
        )}

        {/* One discoverable action menu instead of eight cramped icon targets. */}
        <details ref={actionsRef} className={`relative shrink-0 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover-actions'}`} onClick={(event) => event.stopPropagation()}>
          <summary role="button" aria-label={`Actions for ${displayLabel}`} className="w-5 h-5 tap flex items-center justify-center rounded text-[13px] cursor-pointer" style={{ color: 'var(--text-muted)', listStyle: 'none' }}>⋯</summary>
          <div aria-label={`${displayLabel} actions`} className="absolute right-0 top-6 z-40 w-48 rounded py-1 shadow-lg" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-default)' }}>
            <button disabled={isLocked} onClick={() => { setDraftLabel(node.label); setRenaming(true); actionsRef.current?.removeAttribute('open'); }} className="w-full tap-h text-left px-2 py-1.5 text-[11px] disabled:opacity-40">Rename</button>
            <label className="block px-2 py-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Group
              <select
                aria-label={`Group ${displayLabel}`}
                value={node.group ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setNodeGroup(node.id, value === '__new' ? `${displayLabel} group` : value || null);
                  actionsRef.current?.removeAttribute('open');
                }}
                className="mt-1 w-full tap-h rounded px-1 text-[11px]"
                style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
              >
                <option value="">Ungrouped</option>
                {groupNames.map((group) => <option key={group} value={group}>{group}</option>)}
                {!node.group && <option value="__new">Create “{displayLabel} group”</option>}
              </select>
            </label>
            <button onClick={() => { toggleHidden(node.id); actionsRef.current?.removeAttribute('open'); }} className="w-full tap-h text-left px-2 py-1.5 text-[11px]">{isHidden ? 'Show in viewport' : 'Hide in viewport'}</button>
            <button onClick={() => { isolate(isolatedNodeId === node.id ? null : node.id); actionsRef.current?.removeAttribute('open'); }} className="w-full tap-h text-left px-2 py-1.5 text-[11px]">{isolatedNodeId === node.id ? 'Exit isolate' : 'Isolate in viewport'}</button>
            <button onClick={() => { if (!isLocked && isSelected) selectNode(null); toggleLocked(node.id); actionsRef.current?.removeAttribute('open'); }} className="w-full tap-h text-left px-2 py-1.5 text-[11px]">{isLocked ? 'Unlock' : 'Lock'}</button>
            <button onClick={() => { if (isMoving) cancelMove(); else beginMove(node.id); actionsRef.current?.removeAttribute('open'); }} className="w-full tap-h text-left px-2 py-1.5 text-[11px]">{isMoving ? 'Cancel move' : 'Move into another node'}</button>
            <button onClick={() => { selectNode(node.id); duplicateSelected(); actionsRef.current?.removeAttribute('open'); }} className="w-full tap-h text-left px-2 py-1.5 text-[11px]">Duplicate</button>
            <button onClick={() => { toggleNode(node.id); actionsRef.current?.removeAttribute('open'); }} className="w-full tap-h text-left px-2 py-1.5 text-[11px]">{node.enabled ? 'Disable geometry' : 'Enable geometry'}</button>
            <button onClick={() => removeNode(node.id)} className="w-full tap-h text-left px-2 py-1.5 text-[11px]" style={{ color: 'var(--accent-red)' }}>Delete</button>
          </div>
        </details>
      </div>

      {/* Children + placeholder slots */}
      {hasChildren && isExpanded && (
        <div className="relative">
          {node.children.map((child, i) => (
            child.kind === '_empty' ? (
              <PlaceholderSlot
                key={child.id}
                parentId={node.id}
                depth={depth + 1}
                isLast={i === node.children.length - 1 && missingSlots === 0}
                urgent={isIncomplete}
              />
            ) : (
              <TreeNode
                key={child.id}
                node={child}
                depth={depth + 1}
                isLast={i === node.children.length - 1 && missingSlots === 0}
                incompleteIds={incompleteIds}
                forceExpanded={forceExpanded}
                groupNames={groupNames}
              />
            )
          ))}
          {Array.from({ length: missingSlots }).map((_, i) => (
            <PlaceholderSlot
              key={`empty-${i}`}
              parentId={node.id}
              depth={depth + 1}
              isLast={i === missingSlots - 1}
              urgent={isIncomplete}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlaceholderSlot({ parentId, depth, isLast, urgent }: { parentId: string; depth: number; isLast: boolean; urgent?: boolean }) {
  const moveNode = useModelerStore((s) => s.moveNode);
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const movingNodeId = useTreeUiStore((s) => s.movingNodeId);
  const cancelMove = useTreeUiStore((s) => s.cancelMove);
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
        className="flex items-center h-[26px] tap-h"
        style={{
          paddingLeft: `${leftPad + 20}px`,
          background: movingNodeId ? 'rgba(91,140,223,0.18)' : dragOver ? 'rgba(91,140,223,0.1)' : 'transparent',
          cursor: movingNodeId ? 'pointer' : undefined,
        }}
        onClick={() => {
          if (!movingNodeId) return;
          moveNode(movingNodeId, parentId);
          cancelMove();
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
          style={{
            borderColor: dragOver ? 'var(--accent-blue)' : urgent ? 'rgba(212,90,90,0.5)' : 'var(--border-default)',
            color: urgent ? '#d45a5a' : 'var(--text-muted)',
            background: urgent ? 'rgba(212,90,90,0.06)' : 'transparent',
          }}
        >
          {movingNodeId ? 'move here' : urgent ? '\u26A0 needs shape' : 'drop here'}
        </span>
      </div>
    </div>
  );
}
