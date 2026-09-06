import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { nodeWorldBounds } from '../../engine/nodeBounds';
import type { ThreeEngine } from '../../engine/ThreeEngine';
import type { SDFNodeUI } from '../../types/operations';

function project(point: THREE.Vector3, camera: THREE.Camera, w: number, h: number) {
  const v = point.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind: v.z > 1 };
}

/** SVG attribute setter shorthand */
function setAttrs(el: SVGElement, attrs: Record<string, string | number>) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
}

function usesConservativeModifierBounds(node: SDFNodeUI | null): boolean {
  if (!node) return false;
  const inexactChild = (child: typeof node): boolean => {
    if (!child) return false;
    if (child.kind === 'ellipsoid') return true;
    if (child.kind === 'scale') {
      const s = [child.params.x ?? 1, child.params.y ?? 1, child.params.z ?? 1];
      if (Math.max(...s) - Math.min(...s) > 1e-9) return true;
    }
    return child.children.some(inexactChild);
  };
  if (['round', 'offset', 'shell'].includes(node.kind) && inexactChild(node.children[0])) return true;
  return node.children.some(usesConservativeModifierBounds);
}

function findNodeForBounds(tree: SDFNodeUI | null, id: string | null): SDFNodeUI | null {
  if (!tree || !id) return null;
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNodeForBounds(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * One dimension axis: line + two end circles + label text.
 * All elements are created once and mutated per frame.
 */
interface DimElements {
  group: SVGGElement;
  line: SVGLineElement;
  c1: SVGCircleElement;
  c2: SVGCircleElement;
  text: SVGTextElement;
}

function createDimGroup(parent: SVGSVGElement): DimElements {
  const ns = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(ns, 'g');

  const line = document.createElementNS(ns, 'line');
  setAttrs(line, { stroke: 'var(--accent)', 'stroke-width': 1, opacity: 0.6, 'stroke-dasharray': '4 3' });

  const c1 = document.createElementNS(ns, 'circle');
  setAttrs(c1, { r: 2, fill: 'var(--accent)', opacity: 0.6 });

  const c2 = document.createElementNS(ns, 'circle');
  setAttrs(c2, { r: 2, fill: 'var(--accent)', opacity: 0.6 });

  const text = document.createElementNS(ns, 'text');
  setAttrs(text, {
    'text-anchor': 'middle',
    'dominant-baseline': 'middle',
    fill: 'var(--text-primary)',
    'font-size': 11,
    'font-family': 'JetBrains Mono, monospace',
    filter: 'url(#label-bg)',
  });

  group.append(line, c1, c2, text);
  parent.append(group);
  return { group, line, c1, c2, text };
}

export function DimensionLabels({ engine }: { engine: ThreeEngine | null }) {
  const tree = useModelerStore((s) => s.tree);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const showDimensions = useViewportStore((s) => s.showDimensions);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dimGroupsRef = useRef<DimElements[]>([]);

  // The box these annotate is drawn by `SelectionOverlay`, which owns every
  // wireframe in the scene now — the selection needs one whether or not
  // dimensions are showing, and two components drawing boxes over the same
  // bounds would only differ in colour.
  const nodeBounds = useMemo(
    // Use selected node if any, otherwise measure the root
    () => nodeWorldBounds(tree, selectedId || tree?.id || null),
    [tree, selectedId],
  );
  const conservative = useMemo(
    () => usesConservativeModifierBounds(findNodeForBounds(tree, selectedId || tree?.id || null)),
    [tree, selectedId],
  );

  // Ensure we have exactly 3 dim groups in the SVG (X, Y, Z)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Create groups if needed
    while (dimGroupsRef.current.length < 3) {
      dimGroupsRef.current.push(createDimGroup(svg));
    }
  }, []);

  // Update wireframe and labels each frame — direct DOM mutation, no React state
  useEffect(() => {
    if (!engine || !showDimensions || !nodeBounds) {
      // Hide all dim groups
      for (const dg of dimGroupsRef.current) dg.group.style.display = 'none';
      return;
    }

    const [x0, y0, z0] = nodeBounds.min;
    const [x1, y1, z1] = nodeBounds.max;
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;

    const ox = w * 0.12, oy = h * 0.12, oz = d * 0.12;

    // Pre-allocate world-space points for each axis
    const axes = [
      { // X — bottom front edge
        s: new THREE.Vector3(x0, y0 - oy, z1 + oz),
        e: new THREE.Vector3(x1, y0 - oy, z1 + oz),
        m: new THREE.Vector3((x0 + x1) / 2, y0 - oy, z1 + oz),
        label: `${conservative ? '≤' : ''}${w.toFixed(1)}`,
      },
      { // Y — right front edge
        s: new THREE.Vector3(x1 + ox, y0, z1 + oz),
        e: new THREE.Vector3(x1 + ox, y1, z1 + oz),
        m: new THREE.Vector3(x1 + ox, (y0 + y1) / 2, z1 + oz),
        label: `${conservative ? '≤' : ''}${h.toFixed(1)}`,
      },
      { // Z — bottom right edge
        s: new THREE.Vector3(x1 + ox, y0 - oy, z0),
        e: new THREE.Vector3(x1 + ox, y0 - oy, z1),
        m: new THREE.Vector3(x1 + ox, y0 - oy, (z0 + z1) / 2),
        label: `${conservative ? '≤' : ''}${d.toFixed(1)}`,
      },
    ];

    const update = () => {
      const cw = engine.container.clientWidth;
      const ch = engine.container.clientHeight;
      const cam = engine.camera;
      const groups = dimGroupsRef.current;

      for (let i = 0; i < 3; i++) {
        const ax = axes[i];
        const dg = groups[i];
        const pM = project(ax.m, cam, cw, ch);

        if (pM.behind) {
          dg.group.style.display = 'none';
          continue;
        }

        const pS = project(ax.s, cam, cw, ch);
        const pE = project(ax.e, cam, cw, ch);

        dg.group.style.display = '';
        setAttrs(dg.line, { x1: pS.x, y1: pS.y, x2: pE.x, y2: pE.y });
        setAttrs(dg.c1, { cx: pS.x, cy: pS.y });
        setAttrs(dg.c2, { cx: pE.x, cy: pE.y });
        setAttrs(dg.text, { x: pM.x, y: pM.y });
        dg.text.textContent = ax.label;
      }

    };

    // Driven by the engine rather than by an independent rAF loop. The loop
    // that used to live here recomputed three projections and wrote ~15 SVG
    // attributes plus textContent every frame, whether or not the camera had
    // moved — main-thread style and layout work competing with GL submission —
    // and with on-demand rendering it would have gone on doing that long after
    // the renderer went quiet. `onFrame` fires exactly when a new frame was
    // drawn, which is exactly when these labels can have moved.
    const off = engine.onFrame(update);
    return () => {
      off();
      for (const dg of dimGroupsRef.current) dg.group.style.display = 'none';
    };
  }, [engine, nodeBounds, showDimensions, conservative]);

  return (
    <svg ref={svgRef} className="absolute inset-0 w-full h-full pointer-events-none z-10" style={{ overflow: 'visible' }}>
      <defs>
        <filter id="label-bg" x="-0.15" y="-0.15" width="1.3" height="1.3">
          <feFlood floodColor="var(--bg-deep)" floodOpacity="0.75" />
          <feComposite in="SourceGraphic" />
        </filter>
      </defs>
    </svg>
  );
}
