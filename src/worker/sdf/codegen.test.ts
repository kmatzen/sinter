import { describe, it, expect } from 'vitest';
import { generateGLSL } from './codegen';
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
});
