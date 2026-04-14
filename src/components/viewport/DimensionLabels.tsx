import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import { toSDFNode } from '../../worker/sdf/convert';
import { computeBounds } from '../../worker/sdf/bounds';
import type { SDFNodeUI } from '../../types/operations';
import type { SDFNode } from '../../worker/sdf/types';
import type { ThreeEngine } from '../../engine/ThreeEngine';

function project(point: THREE.Vector3, camera: THREE.PerspectiveCamera, w: number, h: number) {
  const v = point.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, behind: v.z > 1 };
}

function findNode(tree: SDFNodeUI, id: string): SDFNodeUI | null {
  if (tree.id === id) return tree;
  for (const child of tree.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findAncestorPath(tree: SDFNodeUI, id: string): SDFNodeUI[] | null {
  if (tree.id === id) return [];
  for (const child of tree.children) {
    const path = findAncestorPath(child, id);
    if (path !== null) return [tree, ...path];
  }
  return null;
}

function buildNodeWithAncestors(tree: SDFNodeUI, selectedId: string): SDFNode | null {
  const node = findNode(tree, selectedId);
  if (!node) return null;
  const sdfNode = toSDFNode(node);
  if (!sdfNode) return null;

  const ancestors = findAncestorPath(tree, selectedId);
  if (!ancestors) return sdfNode;

  let result = sdfNode;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const a = ancestors[i];
    if (a.kind === 'translate' || a.kind === 'rotate' || a.kind === 'scale') {
      const p = a.params;
      result = {
        kind: 'transform',
        child: result,
        tx: a.kind === 'translate' ? p.x : 0,
        ty: a.kind === 'translate' ? p.y : 0,
        tz: a.kind === 'translate' ? p.z : 0,
        rx: a.kind === 'rotate' ? p.x : 0,
        ry: a.kind === 'rotate' ? p.y : 0,
        rz: a.kind === 'rotate' ? p.z : 0,
        sx: a.kind === 'scale' ? p.x : 1,
        sy: a.kind === 'scale' ? p.y : 1,
        sz: a.kind === 'scale' ? p.z : 1,
      };
    }
  }

  return result;
}

/** SVG attribute setter shorthand */
function setAttrs(el: SVGElement, attrs: Record<string, string | number>) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
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
  const rafRef = useRef<number>(0);
  const wireframeRef = useRef<THREE.LineSegments | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dimGroupsRef = useRef<DimElements[]>([]);

  const nodeBounds = useMemo(() => {
    if (!tree) return null;
    // Use selected node if any, otherwise measure the root
    const targetId = selectedId || tree.id;
    const sdfNode = buildNodeWithAncestors(tree, targetId);
    if (!sdfNode) return null;
    return computeBounds(sdfNode);
  }, [tree, selectedId]);

  // Manage wireframe box in the Three.js scene
  useEffect(() => {
    if (!engine) return;

    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({
      color: 0xa8a8c0,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });
    const wireframe = new THREE.LineSegments(geo, mat);
    wireframe.renderOrder = 998;
    wireframe.visible = false;
    engine.scene.add(wireframe);
    wireframeRef.current = wireframe;

    return () => {
      engine.scene.remove(wireframe);
      geo.dispose();
      mat.dispose();
      wireframeRef.current = null;
    };
  }, [engine]);

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
      if (wireframeRef.current) wireframeRef.current.visible = false;
      // Hide all dim groups
      for (const dg of dimGroupsRef.current) dg.group.style.display = 'none';
      return;
    }

    const [x0, y0, z0] = nodeBounds.min;
    const [x1, y1, z1] = nodeBounds.max;
    const w = x1 - x0, h = y1 - y0, d = z1 - z0;

    // Update wireframe geometry
    if (wireframeRef.current) {
      const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
      edges.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      wireframeRef.current.geometry.dispose();
      wireframeRef.current.geometry = edges;
      wireframeRef.current.visible = true;
    }

    const ox = w * 0.12, oy = h * 0.12, oz = d * 0.12;

    // Pre-allocate world-space points for each axis
    const axes = [
      { // X — bottom front edge
        s: new THREE.Vector3(x0, y0 - oy, z1 + oz),
        e: new THREE.Vector3(x1, y0 - oy, z1 + oz),
        m: new THREE.Vector3((x0 + x1) / 2, y0 - oy, z1 + oz),
        label: w.toFixed(1),
      },
      { // Y — right front edge
        s: new THREE.Vector3(x1 + ox, y0, z1 + oz),
        e: new THREE.Vector3(x1 + ox, y1, z1 + oz),
        m: new THREE.Vector3(x1 + ox, (y0 + y1) / 2, z1 + oz),
        label: h.toFixed(1),
      },
      { // Z — bottom right edge
        s: new THREE.Vector3(x1 + ox, y0 - oy, z0),
        e: new THREE.Vector3(x1 + ox, y0 - oy, z1),
        m: new THREE.Vector3(x1 + ox, y0 - oy, (z0 + z1) / 2),
        label: d.toFixed(1),
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

      rafRef.current = requestAnimationFrame(update);
    };

    rafRef.current = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (wireframeRef.current) wireframeRef.current.visible = false;
      for (const dg of dimGroupsRef.current) dg.group.style.display = 'none';
    };
  }, [engine, nodeBounds, showDimensions]);

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
