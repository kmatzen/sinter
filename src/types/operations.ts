export interface SDFNodeUI {
  id: string;
  kind: string;
  label: string;
  params: Record<string, number>;
  data?: Record<string, string>;  // for string params like text content
  children: SDFNodeUI[];
  enabled: boolean;
}

// All valid node kinds
export const NODE_KINDS = {
  primitives: ['box', 'sphere', 'cylinder', 'torus', 'cone', 'capsule'] as const,
  booleans: ['union', 'subtract', 'intersect'] as const,
  modifiers: ['shell', 'offset', 'round', 'mirror', 'halfSpace'] as const,
  patterns: ['linearPattern', 'circularPattern'] as const,
  transforms: ['translate', 'rotate', 'scale'] as const,
};

export const NODE_LABELS: Record<string, string> = {
  box: 'Box',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  torus: 'Torus',
  cone: 'Cone',
  capsule: 'Capsule',
  ellipsoid: 'Ellipsoid',
  text: 'Text',
  union: 'Union',
  subtract: 'Subtract',
  intersect: 'Intersect',
  shell: 'Shell',
  offset: 'Offset',
  round: 'Round',
  mirror: 'Mirror',
  halfSpace: 'Half-Space Cut',
  linearPattern: 'Linear Pattern',
  circularPattern: 'Circular Pattern',
  translate: 'Translate',
  rotate: 'Rotate',
  scale: 'Scale',
};

export const NODE_DEFAULTS: Record<string, Record<string, number>> = {
  box: { width: 50, height: 30, depth: 50 },
  sphere: { radius: 20 },
  cylinder: { radius: 15, height: 30 },
  torus: { majorRadius: 20, minorRadius: 5 },
  cone: { radius: 15, height: 30 },
  capsule: { radius: 10, height: 30 },
  ellipsoid: { width: 30, height: 20, depth: 40 },
  text: { size: 10, depth: 2 },
  union: { smooth: 0 },
  subtract: { smooth: 0 },
  intersect: { smooth: 0 },
  shell: { thickness: 2 },
  offset: { distance: 1 },
  round: { radius: 2 },
  mirror: { mirrorX: 1, mirrorY: 0, mirrorZ: 0 },
  halfSpace: { axis: 1, position: 0, flip: 0 },
  linearPattern: { axisX: 1, axisY: 0, axisZ: 0, count: 3, spacing: 20 },
  circularPattern: { axisX: 0, axisY: 1, axisZ: 0, count: 6 },
  translate: { x: 0, y: 0, z: 0 },
  rotate: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
};

// How many children each kind expects
export function expectedChildren(kind: string): number {
  if (NODE_KINDS.primitives.includes(kind as any)) return 0;
  if (NODE_KINDS.booleans.includes(kind as any)) return 2;
  return 1; // modifiers, transforms, patterns wrap one child
}

// Check if a tree is complete (all required children filled)
export function isTreeValid(node: SDFNodeUI | null): boolean {
  if (!node) return false;
  if (!node.enabled) return true; // disabled nodes don't count
  const expected = expectedChildren(node.kind);
  if (node.children.length < expected) return false;
  return node.children.every(child => isTreeValid(child));
}

export function isPrimitive(kind: string): boolean {
  return NODE_KINDS.primitives.includes(kind as any);
}

export function isBoolean(kind: string): boolean {
  return NODE_KINDS.booleans.includes(kind as any);
}

export function nodeSummary(node: SDFNodeUI): string {
  const p = node.params;
  switch (node.kind) {
    case 'box': return `${p.width}\u00d7${p.height}\u00d7${p.depth}`;
    case 'sphere': return `r=${p.radius}`;
    case 'cylinder': return `r=${p.radius} h=${p.height}`;
    case 'torus': return `R=${p.majorRadius} r=${p.minorRadius}`;
    case 'cone': return `r=${p.radius} h=${p.height}`;
    case 'capsule': return `r=${p.radius} h=${p.height}`;
    case 'ellipsoid': return `${p.width}\u00d7${p.height}\u00d7${p.depth}`;
    case 'union': case 'subtract': case 'intersect':
      return p.smooth > 0 ? `smooth=${p.smooth}` : 'sharp';
    case 'shell': return `${p.thickness}mm`;
    case 'offset': return `${p.distance}mm`;
    case 'round': return `r=${p.radius}`;
    case 'translate': return `${p.x}, ${p.y}, ${p.z}`;
    case 'rotate': return `${p.x}\u00b0, ${p.y}\u00b0, ${p.z}\u00b0`;
    case 'scale': return `${p.x}, ${p.y}, ${p.z}`;
    case 'mirror': {
      const axes = [p.mirrorX && 'X', p.mirrorY && 'Y', p.mirrorZ && 'Z'].filter(Boolean).join('');
      return axes || 'none';
    }
    case 'linearPattern': return `${p.count}\u00d7 @ ${p.spacing}mm`;
    case 'circularPattern': return `${p.count}\u00d7 circular`;
    case 'text': return `"${node.data?.text || 'Text'}" ${p.size}mm`;
    default: return '';
  }
}
