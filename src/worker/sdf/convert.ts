import type { SDFNodeUI } from '../../types/operations';
import type { SDFNode, MeshFieldData } from './types';
import { bakeMeshField } from './meshField';

/**
 * Baked mesh fields, keyed by the mesh data and the resolution asked for.
 *
 * Baking is `res^3` closest-point queries against a BVH — seconds for a real
 * part — and `toSDFNode` runs on every evaluate. Without this, dragging any
 * unrelated slider would re-bake every imported mesh in the tree.
 *
 * Unbounded on purpose: the key includes the mesh, so the only way to grow it
 * is to import more meshes, and a tree holds its own meshes alive anyway.
 */
const fieldCache = new Map<string, MeshFieldData>();

/** FNV-1a, so the cache key is not the whole megabyte of base64. */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + s.length;
}

export function decodeMeshPositions(b64: string): Float32Array {
  const floats = decodeBase64Floats(b64);
  // Whole triangles only.
  return floats.subarray(0, Math.floor(floats.length / 9) * 9);
}

function decodeBase64Floats(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Copy rather than view: the byte offset of a Uint8Array from `atob` is 0,
  // but its buffer length need not be a multiple of 4 if the data is corrupt,
  // and a misaligned view throws where a truncating copy degrades.
  const floats = new Float32Array(Math.floor(bytes.length / 4));
  new Uint8Array(floats.buffer).set(bytes.subarray(0, floats.length * 4));
  return floats;
}

/** Resolution of the baked grid, unless the node overrides it. */
export const DEFAULT_MESH_RESOLUTION = 48;

/** Recursively mark an entire subtree with warn=true */
function markWarn(node: SDFNode): SDFNode {
  return { ...node, warn: true } as SDFNode;
}

/** Convert UI tree to internal SDFNode (strip UI metadata) */
export function toSDFNode(ui: SDFNodeUI): SDFNode | null {
  if (!ui.enabled) return null;

  const p = ui.params;
  const children = ui.children.map(toSDFNode).filter((c): c is SDFNode => c !== null);

  switch (ui.kind) {
    case 'box': return { kind: 'box', size: [p.width, p.height, p.depth] };
    case 'sphere': return { kind: 'sphere', radius: p.radius };
    case 'cylinder': return { kind: 'cylinder', radius: p.radius, height: p.height };
    case 'torus': return { kind: 'torus', major: p.majorRadius as number, minor: p.minorRadius as number };
    case 'cone': return { kind: 'cone', radius: p.radius, height: p.height };
    case 'capsule': return { kind: 'capsule', radius: p.radius, height: p.height };
    case 'ellipsoid': return { kind: 'ellipsoid', size: [p.width, p.height, p.depth] };

    case 'mesh': {
      const b64 = ui.data?.meshPositions;
      if (!b64) return null;
      const res = Math.max(8, Math.min(96, Math.round(p.resolution || DEFAULT_MESH_RESOLUTION)));
      const key = `${hashString(b64)}@${res}`;
      let field = fieldCache.get(key);
      if (!field) {
        const positions = decodeBase64Floats(b64);
        // Whole triangles only. A truncated file is the importer's problem to
        // report, not something to bake half of.
        field = bakeMeshField(positions.subarray(0, Math.floor(positions.length / 9) * 9), res);
        fieldCache.set(key, field);
      }
      return { kind: 'mesh', field, name: ui.data?.meshName };
    }

    case 'text': {
      const glyphData = ui.data?.glyphPaths ? JSON.parse(ui.data.glyphPaths) : null;
      return {
        kind: 'text', text: ui.data?.text || 'Text', size: p.size || 10, depth: p.depth || 2, font: 'sans-serif',
        glyphSegments: glyphData?.segs,
        glyphBeziers: glyphData?.bezs,
        glyphWidth: glyphData?.w,
        glyphAscent: glyphData?.a,
        glyphDescent: glyphData?.d,
      };
    }

    case 'union':
    case 'subtract':
    case 'intersect':
      if (children.length < 2) return children[0] ? markWarn(children[0]) : null;
      return { kind: ui.kind as 'union' | 'subtract' | 'intersect', a: children[0], b: children[1], k: p.smooth || 0 };

    case 'shell':
      if (children.length < 1) return null;
      return { kind: 'shell', child: children[0], thickness: p.thickness };

    case 'offset':
      if (children.length < 1) return null;
      return { kind: 'offset', child: children[0], distance: p.distance };

    case 'round':
      if (children.length < 1) return null;
      return { kind: 'round', child: children[0], radius: p.radius };

    case 'translate':
    case 'rotate':
    case 'scale':
      if (children.length < 1) return null;
      return {
        kind: 'transform',
        child: children[0],
        tx: ui.kind === 'translate' ? (p.x ?? 0) : 0,
        ty: ui.kind === 'translate' ? (p.y ?? 0) : 0,
        tz: ui.kind === 'translate' ? (p.z ?? 0) : 0,
        rx: ui.kind === 'rotate' ? (p.x ?? 0) : 0,
        ry: ui.kind === 'rotate' ? (p.y ?? 0) : 0,
        rz: ui.kind === 'rotate' ? (p.z ?? 0) : 0,
        sx: ui.kind === 'scale' ? (p.x ?? 1) : 1,
        sy: ui.kind === 'scale' ? (p.y ?? 1) : 1,
        sz: ui.kind === 'scale' ? (p.z ?? 1) : 1,
      };

    case 'halfSpace':
      if (children.length < 1) return null;
      return {
        kind: 'intersect',
        a: children[0],
        b: { kind: 'halfSpace', axis: p.axis === 0 ? 'x' : p.axis === 2 ? 'z' : 'y', position: p.position, flip: !!p.flip },
        k: 0,
      };

    case 'mirror':
      if (children.length < 1) return null;
      return { kind: 'mirror', child: children[0], axes: [p.mirrorX ? 1 : 0, p.mirrorY ? 1 : 0, p.mirrorZ ? 1 : 0] as [number, number, number] };

    case 'linearPattern': {
      if (children.length < 1) return null;
      const hasLinAxis = (p.axisX || 0) !== 0 || (p.axisY || 0) !== 0 || (p.axisZ || 0) !== 0;
      return {
        kind: 'linearPattern',
        child: children[0],
        axis: hasLinAxis ? [p.axisX || 0, p.axisY || 0, p.axisZ || 0] as [number, number, number] : [1, 0, 0],
        count: p.count || 2,
        spacing: p.spacing || 10,
      };
    }

    case 'circularPattern': {
      if (children.length < 1) return null;
      // Default to Y axis if none specified (all zeros)
      const hasAxis = (p.axisX || 0) !== 0 || (p.axisY || 0) !== 0 || (p.axisZ || 0) !== 0;
      return {
        kind: 'circularPattern',
        child: children[0],
        axis: hasAxis ? [p.axisX || 0, p.axisY || 0, p.axisZ || 0] as [number, number, number] : [0, 1, 0],
        count: p.count || 4,
      };
    }

    default: return null;
  }
}
