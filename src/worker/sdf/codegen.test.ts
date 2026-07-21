import { describe, it, expect } from 'vitest';
import { generateGLSL, generateSDFFunction } from './codegen';
import type { SDFNode } from './types';

describe('generateGLSL', () => {
  it('generates valid GLSL for a box', () => {
    const box: SDFNode = { kind: 'box', size: [10, 20, 30] };
    const glsl = generateGLSL(box);
    expect(glsl).toContain('precision highp float');
    expect(glsl).toContain('float sdf(vec3 p)');
    expect(glsl).toContain('gl_FragColor');
    expect(glsl).not.toContain('NaN');
    expect(glsl).not.toContain('Infinity');
  });

  it('generates valid GLSL for union with smooth', () => {
    const node: SDFNode = {
      kind: 'union',
      a: { kind: 'box', size: [10, 10, 10] },
      b: { kind: 'sphere', radius: 5 },
      k: 3,
    };
    const glsl = generateGLSL(node);
    expect(glsl).toContain('clamp');
    expect(glsl).toContain('mix');
  });

  it('generates valid GLSL for shell', () => {
    const node: SDFNode = {
      kind: 'shell',
      child: { kind: 'box', size: [10, 10, 10] },
      thickness: 2,
    };
    const glsl = generateGLSL(node);
    expect(glsl).toContain('abs');
  });

  it('handles transform with rotation', () => {
    const node: SDFNode = {
      kind: 'transform',
      child: { kind: 'box', size: [10, 10, 10] },
      tx: 5, ty: 0, tz: 0, rx: 45, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1,
    };
    const glsl = generateGLSL(node);
    // Rotation is now a precomputed 3x3 matrix (numeric values, no trig in shader)
    expect(glsl).toContain('0.707107');  // cos(45°) ≈ sin(45°) ≈ 0.707107
    expect(glsl).not.toContain('NaN');
  });

  it('sanitizes NaN/Infinity values', () => {
    const node: SDFNode = { kind: 'sphere', radius: NaN };
    const glsl = generateGLSL(node);
    expect(glsl).not.toContain('NaN');
    expect(glsl).toContain('0.0'); // NaN replaced with 0.0
  });

  it('handles mirror', () => {
    const node: SDFNode = {
      kind: 'mirror',
      child: { kind: 'sphere', radius: 5 },
      axes: [1, 0, 1],
    };
    const glsl = generateGLSL(node);
    expect(glsl).toContain('abs');
  });

  it('handles halfSpace', () => {
    const node: SDFNode = { kind: 'halfSpace', axis: 'y', position: 10, flip: false };
    const glsl = generateGLSL(node);
    expect(glsl).toContain('.y');
  });

  it('handles halfSpace with flip', () => {
    const node: SDFNode = { kind: 'halfSpace', axis: 'x', position: 5, flip: true };
    const glsl = generateGLSL(node);
    expect(glsl).not.toContain('NaN');
  });

  it('generates GLSL for every remaining primitive kind', () => {
    const kinds: SDFNode[] = [
      { kind: 'cylinder', radius: 5, height: 10 },
      { kind: 'torus', major: 10, minor: 3 },
      { kind: 'cone', radius: 5, height: 10 },
      { kind: 'capsule', radius: 2, height: 10 },
      { kind: 'ellipsoid', size: [10, 20, 30] },
      { kind: 'text', text: 'Hi', size: 10, depth: 4, font: 'sans' },
      { kind: '_far' },
    ];
    for (const node of kinds) {
      const glsl = generateGLSL(node);
      expect(glsl).toContain('float sdf(vec3 p)');
      expect(glsl).not.toContain('NaN');
      expect(glsl).not.toContain('Infinity');
    }
  });

  it('generates GLSL for subtract and intersect, sharp and smooth', () => {
    const a: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const b: SDFNode = { kind: 'sphere', radius: 5 };
    for (const k of [0, 3]) {
      const sub = generateGLSL({ kind: 'subtract', a, b, k });
      expect(sub).toContain(k > 0 ? 'mix' : 'max');
      const inter = generateGLSL({ kind: 'intersect', a, b, k });
      expect(inter).toContain(k > 0 ? 'mix' : 'max');
    }
  });

  it('generates GLSL for offset and round', () => {
    const child: SDFNode = { kind: 'box', size: [10, 10, 10] };
    expect(generateGLSL({ kind: 'offset', child, distance: 2 })).toContain('float sdf(vec3 p)');
    expect(generateGLSL({ kind: 'round', child, radius: 1 })).toContain('float sdf(vec3 p)');
  });

  it('generates GLSL for linearPattern using a helper function', () => {
    const node: SDFNode = { kind: 'linearPattern', child: { kind: 'sphere', radius: 2 }, axis: [1, 0, 0], count: 4, spacing: 10 };
    const glsl = generateGLSL(node);
    expect(glsl).toContain('sdf_helper_0');
    expect(glsl).not.toContain('NaN');
  });

  it('generates GLSL for linearPattern with a zero-length axis (falls back to Y)', () => {
    const node: SDFNode = { kind: 'linearPattern', child: { kind: 'sphere', radius: 2 }, axis: [0, 0, 0], count: 3, spacing: 10 };
    const glsl = generateGLSL(node);
    expect(glsl).toContain('sdf_helper_0');
  });

  it('generates GLSL for circularPattern around each axis', () => {
    const child: SDFNode = { kind: 'sphere', radius: 1 };
    const axisY = generateGLSL({ kind: 'circularPattern', child, axis: [0, 1, 0], count: 6 });
    expect(axisY).toContain('.xz');
    const axisX = generateGLSL({ kind: 'circularPattern', child, axis: [1, 0, 0], count: 6 });
    expect(axisX).toContain('.yz');
    const axisZ = generateGLSL({ kind: 'circularPattern', child, axis: [0, 0, 1], count: 6 });
    expect(axisZ).toContain('.xy');
  });

  it('emits a sdfWarn function when a descendant node is warned', () => {
    const node: SDFNode = {
      kind: 'union',
      a: { kind: 'box', size: [10, 10, 10] },
      b: { kind: 'sphere', radius: 5, warn: true },
      k: 0,
    };
    const result = generateSDFFunction(node);
    expect(result.hasWarn).toBe(true);
    expect(result.glsl).toContain('sdfWarn');
  });

  it('does not emit sdfWarn when the root itself is warned', () => {
    const node: SDFNode = { kind: 'box', size: [10, 10, 10], warn: true };
    const result = generateSDFFunction(node);
    expect(result.hasWarn).toBe(false);
    expect(result.glsl).not.toContain('sdfWarn');
  });

  it('does not emit sdfWarn when nothing is warned', () => {
    const node: SDFNode = { kind: 'box', size: [10, 10, 10] };
    const result = generateSDFFunction(node);
    expect(result.hasWarn).toBe(false);
  });

  it('filters a warned subtree through a modifier chain', () => {
    const node: SDFNode = {
      kind: 'shell',
      child: {
        kind: 'union',
        a: { kind: 'box', size: [10, 10, 10] },
        b: { kind: 'sphere', radius: 5, warn: true },
        k: 0,
      },
      thickness: 2,
    };
    const result = generateSDFFunction(node);
    expect(result.hasWarn).toBe(true);
    expect(result.glsl).toContain('sdfWarn');
  });

  it('reports a sensible paramCount', () => {
    const node: SDFNode = { kind: 'sphere', radius: 5 };
    const result = generateSDFFunction(node);
    expect(result.paramCount).toBeGreaterThanOrEqual(1);
    expect(result.paramValues).toContain(5);
  });
});
