import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { nodeWorldBounds } from '../../engine/nodeBounds';
import type { ThreeEngine } from '../../engine/ThreeEngine';
import type { BBox } from '../../worker/sdf/types';

/**
 * The wireframe boxes that say which node a surface belongs to.
 *
 * Before this, selecting a node changed nothing in the viewport unless the
 * Dimensions toggle happened to be on — the box was owned by `DimensionLabels`
 * and gated on `showDimensions`, which is off by default. So the entire visible
 * result of clicking a shape was a row highlighting in a side panel, and on a
 * narrow window or mobile that panel is not even on screen. The click landed,
 * the model looked identical, and there was no way to tell what had been
 * selected — which is exactly the confusion this component exists to remove.
 *
 * Three boxes, drawn on top of the shape (`depthTest: false`) because a box
 * that is inside the solid it describes is invisible:
 *
 *   selection  accent, solid    — what is selected now
 *   hover      white, faint     — what a click *would* select
 *   measured   grey             — the root's extent, when Dimensions is on and
 *                                 nothing is selected, so the dimension labels
 *                                 still have a box to annotate
 */

const SELECTED_COLOR = 0xd4845a; // --accent
const HOVER_COLOR = 0xffffff;
const MEASURED_COLOR = 0xa8a8c0;

interface BoxHandle {
  lines: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
}

function createBox(engine: ThreeEngine, color: number, opacity: number, renderOrder: number): BoxHandle {
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), material);
  lines.renderOrder = renderOrder;
  lines.visible = false;
  engine.scene.add(lines);
  return { lines, material };
}

function applyBounds(handle: BoxHandle | null, bounds: BBox | null) {
  if (!handle) return;
  if (!bounds) {
    handle.lines.visible = false;
    return;
  }
  const [x0, y0, z0] = bounds.min;
  const [x1, y1, z1] = bounds.max;
  // A zero-thickness box still has to draw its four edges in that axis, and
  // BoxGeometry with a 0 dimension degenerates them onto each other. A hair of
  // thickness keeps a flat node (a halfSpace cut face, a scaled-flat box)
  // visible as an outline rather than vanishing.
  const eps = Math.max((x1 - x0) + (y1 - y0) + (z1 - z0), 1) * 1e-4;
  const geo = new THREE.EdgesGeometry(
    new THREE.BoxGeometry(
      Math.max(x1 - x0, eps),
      Math.max(y1 - y0, eps),
      Math.max(z1 - z0, eps),
    ),
  );
  geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  handle.lines.geometry.dispose();
  handle.lines.geometry = geo;
  handle.lines.visible = true;
}

export function SelectionOverlay({ engine }: { engine: ThreeEngine | null }) {
  const tree = useModelerStore((s) => s.tree);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const selectedIds = useModelerStore((s) => s.selectedNodeIds);
  const hoveredId = useViewportStore((s) => s.hoveredNodeId);
  const showDimensions = useViewportStore((s) => s.showDimensions);

  const selectedRefs = useRef<BoxHandle[]>([]);
  const hoverRef = useRef<BoxHandle | null>(null);
  const measuredRef = useRef<BoxHandle | null>(null);

  const selectedBounds = useMemo(() => selectedIds.map((id) => nodeWorldBounds(tree, id)).filter((bounds): bounds is BBox => bounds !== null), [tree, selectedIds]);
  // Suppressed when it would land on top of the selection box: two coincident
  // outlines in different colours z-fight into a shimmer, and the information
  // ("this is what you would select") is already conveyed by the selection.
  const hoverBounds = useMemo(
    () => (hoveredId && hoveredId !== selectedId ? nodeWorldBounds(tree, hoveredId) : null),
    [tree, hoveredId, selectedId],
  );
  const measuredBounds = useMemo(
    () => (showDimensions && !selectedId && tree ? nodeWorldBounds(tree, tree.id) : null),
    [tree, selectedId, showDimensions],
  );

  useEffect(() => {
    if (!engine) return;
    hoverRef.current = createBox(engine, HOVER_COLOR, 0.4, 997);
    measuredRef.current = createBox(engine, MEASURED_COLOR, 0.5, 996);
    return () => {
      for (const ref of [hoverRef, measuredRef]) {
        const handle = ref.current;
        if (!handle) continue;
        engine.scene.remove(handle.lines);
        handle.lines.geometry.dispose();
        handle.material.dispose();
        ref.current = null;
      }
      for (const handle of selectedRefs.current) {
        engine.scene.remove(handle.lines);
        handle.lines.geometry.dispose();
        handle.material.dispose();
      }
      selectedRefs.current = [];
    };
  }, [engine]);

  useEffect(() => {
    if (!engine) return;
    while (selectedRefs.current.length < selectedBounds.length) selectedRefs.current.push(createBox(engine, SELECTED_COLOR, 0.95, 999));
    while (selectedRefs.current.length > selectedBounds.length) {
      const handle = selectedRefs.current.pop()!;
      engine.scene.remove(handle.lines);
      handle.lines.geometry.dispose();
      handle.material.dispose();
    }
    selectedBounds.forEach((bounds, index) => applyBounds(selectedRefs.current[index], bounds));
    applyBounds(hoverRef.current, hoverBounds);
    applyBounds(measuredRef.current, measuredBounds);
    engine.invalidate();
  }, [engine, selectedBounds, hoverBounds, measuredBounds]);

  return null;
}
