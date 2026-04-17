import type { SDFNodeUI } from '../types/operations';
import type { Vec3 } from '../worker/sdf/types';
import { toSDFNode } from '../worker/sdf/convert';
import { evaluateSDF } from '../worker/sdf/evaluate';

/** Inverse-transform a point through a UI transform node. */
function inverseTransform(ui: SDFNodeUI, p: Vec3): Vec3 {
  const params = ui.params;
  let [px, py, pz] = p;

  if (ui.kind === 'translate') {
    return [px - (params.x ?? 0), py - (params.y ?? 0), pz - (params.z ?? 0)];
  }

  if (ui.kind === 'scale') {
    const sx = params.x ?? 1, sy = params.y ?? 1, sz = params.z ?? 1;
    return [px / sx, py / sy, pz / sz];
  }

  if (ui.kind === 'rotate') {
    // Inverse rotation: Z then Y then X (matches evaluate.ts)
    {
      const a = -(params.z ?? 0) * Math.PI / 180;
      const c = Math.cos(a), s = Math.sin(a);
      [px, py] = [px * c - py * s, px * s + py * c];
    }
    {
      const a = -(params.y ?? 0) * Math.PI / 180;
      const c = Math.cos(a), s = Math.sin(a);
      [px, pz] = [px * c + pz * s, -px * s + pz * c];
    }
    {
      const a = -(params.x ?? 0) * Math.PI / 180;
      const c = Math.cos(a), s = Math.sin(a);
      [py, pz] = [py * c - pz * s, py * s + pz * c];
    }
    return [px, py, pz];
  }

  return p;
}

const PRIMITIVES = new Set([
  'box', 'sphere', 'cylinder', 'torus', 'cone', 'capsule', 'ellipsoid', 'text',
]);

/**
 * Determine which leaf node in the UI tree "owns" the surface at the given
 * world-space point. Returns the node ID of the deepest contributing primitive.
 */
export function attributePoint(ui: SDFNodeUI, p: Vec3): string | null {
  if (!ui.enabled) return null;

  if (PRIMITIVES.has(ui.kind)) return ui.id;

  const enabledChildren = ui.children.filter(c => c.enabled);

  // Booleans: decide which child owns the surface
  if (ui.kind === 'union' || ui.kind === 'subtract' || ui.kind === 'intersect') {
    if (enabledChildren.length === 0) return null;
    if (enabledChildren.length === 1) return attributePoint(enabledChildren[0], p);

    const [childA, childB] = enabledChildren;
    const sdfA = toSDFNode(childA);
    const sdfB = toSDFNode(childB);
    if (!sdfA) return attributePoint(childB, p);
    if (!sdfB) return attributePoint(childA, p);

    const dA = evaluateSDF(sdfA, p);
    const dB = evaluateSDF(sdfB, p);

    if (ui.kind === 'union') {
      return attributePoint(dA <= dB ? childA : childB, p);
    } else if (ui.kind === 'subtract') {
      return attributePoint(dA >= -dB ? childA : childB, p);
    } else {
      return attributePoint(dA >= dB ? childA : childB, p);
    }
  }

  // Transforms: inverse-transform point then recurse
  if (ui.kind === 'translate' || ui.kind === 'rotate' || ui.kind === 'scale') {
    if (enabledChildren.length === 0) return null;
    return attributePoint(enabledChildren[0], inverseTransform(ui, p));
  }

  // Mirror: fold point
  if (ui.kind === 'mirror') {
    if (enabledChildren.length === 0) return null;
    const mp: Vec3 = [
      ui.params.mirrorX ? Math.abs(p[0]) : p[0],
      ui.params.mirrorY ? Math.abs(p[1]) : p[1],
      ui.params.mirrorZ ? Math.abs(p[2]) : p[2],
    ];
    return attributePoint(enabledChildren[0], mp);
  }

  // Linear pattern: find nearest copy, undo repetition
  if (ui.kind === 'linearPattern') {
    if (enabledChildren.length === 0) return null;
    const params = ui.params;
    const hasAxis = (params.axisX || 0) !== 0 || (params.axisY || 0) !== 0 || (params.axisZ || 0) !== 0;
    const ax: Vec3 = hasAxis ? [params.axisX || 0, params.axisY || 0, params.axisZ || 0] : [1, 0, 0];
    const axLen = Math.sqrt(ax[0] ** 2 + ax[1] ** 2 + ax[2] ** 2);
    if (axLen < 1e-8) return attributePoint(enabledChildren[0], p);
    const nax: Vec3 = [ax[0] / axLen, ax[1] / axLen, ax[2] / axLen];
    const dot = p[0] * nax[0] + p[1] * nax[1] + p[2] * nax[2];
    const count = params.count || 2;
    const spacing = params.spacing || 10;
    const totalLen = spacing * (count - 1);
    const clamped = Math.max(0, Math.min(totalLen, dot));
    const idx = Math.round(clamped / spacing);

    const sdfChild = toSDFNode(enabledChildren[0]);
    if (!sdfChild) return null;
    let bestDist = Infinity;
    let bestP: Vec3 = p;
    for (let di = -1; di <= 1; di++) {
      const i = idx + di;
      if (i < 0 || i >= count) continue;
      const offset = i * spacing;
      const lp: Vec3 = [p[0] - nax[0] * offset, p[1] - nax[1] * offset, p[2] - nax[2] * offset];
      const d = evaluateSDF(sdfChild, lp);
      if (d < bestDist) { bestDist = d; bestP = lp; }
    }
    return attributePoint(enabledChildren[0], bestP);
  }

  // Circular pattern: find nearest sector, undo rotation
  if (ui.kind === 'circularPattern') {
    if (enabledChildren.length === 0) return null;
    const params = ui.params;
    const hasAxis = (params.axisX || 0) !== 0 || (params.axisY || 0) !== 0 || (params.axisZ || 0) !== 0;
    const ax: Vec3 = hasAxis ? [params.axisX || 0, params.axisY || 0, params.axisZ || 0] : [0, 1, 0];
    const isX = Math.abs(ax[0]) > Math.abs(ax[1]) && Math.abs(ax[0]) > Math.abs(ax[2]);
    const isZ = !isX && Math.abs(ax[2]) > Math.abs(ax[1]);
    const count = params.count || 4;

    let angle: number, radius: number;
    if (isX) {
      angle = Math.atan2(p[2], p[1]);
      radius = Math.sqrt(p[1] ** 2 + p[2] ** 2);
    } else if (isZ) {
      angle = Math.atan2(p[1], p[0]);
      radius = Math.sqrt(p[0] ** 2 + p[1] ** 2);
    } else {
      angle = Math.atan2(p[2], p[0]);
      radius = Math.sqrt(p[0] ** 2 + p[2] ** 2);
    }
    const sector = (2 * Math.PI) / count;
    const sect = Math.round(angle / sector);

    const sdfChild = toSDFNode(enabledChildren[0]);
    if (!sdfChild) return null;
    let bestDist = Infinity;
    let bestP: Vec3 = p;
    for (let di = -1; di <= 1; di++) {
      const a = angle - (sect + di) * sector;
      const c = Math.cos(a), s = Math.sin(a);
      let cp: Vec3;
      if (isX) cp = [p[0], radius * c, radius * s];
      else if (isZ) cp = [radius * c, radius * s, p[2]];
      else cp = [radius * c, p[1], radius * s];
      const d = evaluateSDF(sdfChild, cp);
      if (d < bestDist) { bestDist = d; bestP = cp; }
    }
    return attributePoint(enabledChildren[0], bestP);
  }

  // All other modifiers (shell, offset, round, halfSpace): pass through
  if (enabledChildren.length > 0) return attributePoint(enabledChildren[0], p);
  return null;
}
