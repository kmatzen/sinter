import { describe, it, expect } from 'vitest';
import {
  outlineTexelRadius,
  OUTLINE_CSS_RADIUS,
  OUTLINE_MAX_TEXELS,
  GIZMO_CSS_RADIUS,
  GIZMO_MAX_TEXELS,
} from './OutlinePass';

/**
 * Issue #121: the outline kernel was measured in depth-texture texels, so a
 * fixed texel count spanned a different on-screen width at each device-pixel
 * ratio. `ThreeEngine` uses 1.5 idle and 1.0 while the camera moves, so the
 * outline thickened for the duration of a drag. `outlineTexelRadius` converts a
 * CSS-pixel radius to texels per frame so the on-screen width stays constant.
 */
describe('outlineTexelRadius', () => {
  // The two device-pixel ratios ThreeEngine actually renders at.
  const IDLE_DPR = 1.5;
  const INTERACTIVE_DPR = 1.0;

  it('holds a constant CSS width across the idle/interactive ratio switch', () => {
    for (const [css, max] of [
      [OUTLINE_CSS_RADIUS, OUTLINE_MAX_TEXELS],
      [GIZMO_CSS_RADIUS, GIZMO_MAX_TEXELS],
    ] as const) {
      const idleTexels = outlineTexelRadius(IDLE_DPR, css, max);
      const movingTexels = outlineTexelRadius(INTERACTIVE_DPR, css, max);
      // Texel count differs by ratio...
      expect(idleTexels).toBeGreaterThan(movingTexels);
      // ...but texels / ratio — the CSS-pixel width on screen — does not.
      expect(idleTexels / IDLE_DPR).toBeCloseTo(css, 10);
      expect(movingTexels / INTERACTIVE_DPR).toBeCloseTo(css, 10);
    }
  });

  it('reproduces the old 3-texel kernel at the idle ratio', () => {
    // The kernel was authored as `const float u_radius = 3.0` and looked right
    // at 1.5; the fix must not change that idle appearance.
    expect(outlineTexelRadius(IDLE_DPR, OUTLINE_CSS_RADIUS, OUTLINE_MAX_TEXELS)).toBeCloseTo(3.0, 10);
    // The old gizmo cull was `r > 2.5`.
    expect(outlineTexelRadius(IDLE_DPR, GIZMO_CSS_RADIUS, GIZMO_MAX_TEXELS)).toBeCloseTo(2.5, 10);
  });

  it('never exceeds the shader loop bound, even above the DPR ceiling', () => {
    // R is a compile-time constant in the shader; a texel radius past it would
    // silently request taps the loop never visits. The clamp guarantees it can't.
    expect(outlineTexelRadius(2, OUTLINE_CSS_RADIUS, OUTLINE_MAX_TEXELS)).toBe(OUTLINE_MAX_TEXELS);
    expect(outlineTexelRadius(4, OUTLINE_CSS_RADIUS, OUTLINE_MAX_TEXELS)).toBe(OUTLINE_MAX_TEXELS);
    expect(outlineTexelRadius(2, GIZMO_CSS_RADIUS, GIZMO_MAX_TEXELS)).toBe(GIZMO_MAX_TEXELS);
  });

  it('scales linearly with the pixel ratio below the clamp', () => {
    expect(outlineTexelRadius(1.0, OUTLINE_CSS_RADIUS, OUTLINE_MAX_TEXELS)).toBeCloseTo(2.0, 10);
    expect(outlineTexelRadius(1.25, OUTLINE_CSS_RADIUS, OUTLINE_MAX_TEXELS)).toBeCloseTo(2.5, 10);
  });
});
