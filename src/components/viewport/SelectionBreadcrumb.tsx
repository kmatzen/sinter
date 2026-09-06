import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { nodePath } from '../../engine/nodeBounds';

/**
 * Names the node under the pointer, and where it sits in the tree.
 *
 * The gap this fills: picking always resolves to a *leaf* primitive, because
 * "which shape is this pixel" has no other answer — but the tree the user is
 * reasoning about is mostly the operations above that leaf. Clicking the flat
 * face left by a subtract selects the cylinder that cut it, which is correct
 * and reads as arbitrary unless something says `Subtract › Move › Cylinder`.
 *
 * So: while the pointer is over geometry, this shows what a click *would*
 * select, outlined in white to match the hover box. Otherwise it shows what is
 * selected, outlined in the accent to match the selection box, with every crumb
 * clickable — which is also the only way to reach an ancestor, since a click on
 * the model can never land on one.
 */

const SEPARATOR = '›';

/**
 * Longest chain shown in full. Beyond it, the root and the last three are kept
 * and the middle becomes an ellipsis — deep trees are exactly where this chip
 * earns its place, and also exactly where showing every crumb would squash them
 * all to unreadable stubs. The root stays reachable because "select the whole
 * assembly" is the one jump worth a single click from anywhere.
 */
const MAX_CRUMBS = 4;

type Crumb = { id: string; label: string; kind: string };

function collapse(crumbs: Crumb[]): (Crumb | 'ellipsis')[] {
  if (crumbs.length <= MAX_CRUMBS) return crumbs;
  return [crumbs[0], 'ellipsis', ...crumbs.slice(-(MAX_CRUMBS - 1))];
}

export function SelectionBreadcrumb() {
  const tree = useModelerStore((s) => s.tree);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const selectNode = useModelerStore((s) => s.selectNode);
  const hoveredId = useViewportStore((s) => s.hoveredNodeId);
  const hoverSource = useViewportStore((s) => s.hoverSource);
  const setHoveredNode = useViewportStore((s) => s.setHoveredNode);

  if (!tree) return null;

  // Only a hover over the *geometry* is a preview of what a click would do.
  // A hover over a tree row or over these crumbs is the pointer already being
  // somewhere clickable, and flipping this chip to "click to select" there
  // would both mislead and disable the crumb under the cursor.
  const previewing = !!hoveredId && hoveredId !== selectedId && hoverSource === 'viewport';
  const crumbs = nodePath(tree, previewing ? hoveredId : selectedId);
  const shown = collapse(crumbs);

  if (crumbs.length === 0) {
    // Worth saying out loud exactly once, in the place the answer will appear:
    // tap-to-select is not visible as an affordance until you try it.
    return (
      <div
        data-testid="selection-breadcrumb"
        className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[60%]"
      >
        <div
          className="rounded-lg px-2.5 py-1 text-[10px] leading-normal font-mono text-center"
          style={{ background: 'rgba(16,16,24,0.7)', color: 'var(--text-muted)' }}
        >
          Click a surface to select its node
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="selection-breadcrumb"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-20 max-w-[60%]"
    >
      <div
        className="rounded-lg px-2.5 py-1 flex items-center gap-1 overflow-hidden"
        style={{
          background: 'rgba(16,16,24,0.7)',
          border: `1px solid ${previewing ? 'rgba(255,255,255,0.25)' : 'var(--accent)'}`,
        }}
      >
        {previewing && (
          <span className="text-[9px] font-mono uppercase tracking-wider shrink-0" style={{ color: 'var(--text-muted)' }}>
            Click to select
          </span>
        )}
        {shown.map((crumb, i) => {
          const isLast = i === shown.length - 1;
          if (crumb === 'ellipsis') {
            return (
              <span key="ellipsis" className="flex items-center gap-1 shrink-0">
                <span className="text-[10px]" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                  {SEPARATOR}
                </span>
                <span
                  className="text-[10px] font-mono px-1"
                  style={{ color: 'var(--text-muted)' }}
                  title={`${crumbs.length - MAX_CRUMBS + 1} more levels`}
                >
                  {'…'}
                </span>
              </span>
            );
          }
          return (
            <span key={crumb.id} className="flex items-center gap-1 min-w-0">
              {i > 0 && (
                <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                  {SEPARATOR}
                </span>
              )}
              <button
                // While previewing, the crumbs describe geometry under the
                // cursor rather than a menu — clicking through the preview
                // would select whatever the pointer happened to be over on its
                // way to the chip.
                disabled={previewing}
                onClick={() => selectNode(crumb.id)}
                onMouseEnter={() => { if (!previewing) setHoveredNode(crumb.id); }}
                onMouseLeave={() => { if (!previewing) setHoveredNode(null); }}
                title={previewing ? undefined : `Select ${crumb.label}`}
                className="tap text-[10px] font-mono truncate px-1 rounded disabled:cursor-default"
                style={{
                  color: isLast ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: isLast ? 600 : 400,
                }}
              >
                {crumb.label}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}
