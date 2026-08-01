import { describe, it, expect } from 'vitest';
import { PRESET_CATEGORIES, type Preset } from './presets';
import { toSDFNode } from '../../worker/sdf/convert';
import { computeBounds } from '../../worker/sdf/bounds';
import { evaluateSDF } from '../../worker/sdf/evaluate';
import type { SDFNode } from '../../worker/sdf/types';

const ALL: Preset[] = PRESET_CATEGORIES.flatMap((c) => c.items);

/**
 * How far inside a face material is allowed to start before the advertised
 * envelope counts as oversold. Half a millimetre is under the layer height of
 * any FDM print, and an order of magnitude below the 4-6 mm by which every
 * rounded preset in the previous library overstated itself.
 */
const FACE_TOLERANCE = 0.5;

/** Samples per axis when probing a face plane for material. */
const PROBE_STEPS = 128;

function compile(preset: Preset): SDFNode {
  const node = toSDFNode(preset.build());
  if (!node) throw new Error(`${preset.name} compiled to nothing`);
  return node;
}

/**
 * Is there any material on the plane `axis = coord`, within the given box?
 *
 * Sampling rather than solving: the field is only queried, never inverted, so
 * this works for every node kind without bounds.ts and evaluate.ts having to
 * agree on anything beyond the sign of the distance.
 */
function planeHasMaterial(node: SDFNode, axis: 0 | 1 | 2, coord: number, min: number[], max: number[]): boolean {
  const [u, v] = ([[1, 2], [0, 2], [0, 1]] as const)[axis];
  const p: [number, number, number] = [0, 0, 0];
  p[axis] = coord;
  for (let i = 0; i <= PROBE_STEPS; i++) {
    p[u] = min[u] + ((max[u] - min[u]) * i) / PROBE_STEPS;
    for (let j = 0; j <= PROBE_STEPS; j++) {
      p[v] = min[v] + ((max[v] - min[v]) * j) / PROBE_STEPS;
      if (evaluateSDF(node, p) <= 0) return true;
    }
  }
  return false;
}

describe('preset library', () => {
  it('has presets to check', () => {
    expect(ALL.length).toBeGreaterThan(0);
  });

  it('gives every preset a unique name', () => {
    expect(new Set(ALL.map((p) => p.name)).size).toBe(ALL.length);
  });

  /**
   * The rule that would have caught the old library on its own. Descriptions
   * drifted from geometry because they restated it by hand; now the size comes
   * from `size`, which is checked against the model below, and a description
   * that tries to restate a dimension fails here.
   */
  it.each(ALL.map((p) => [p.name, p] as const))('%s does not restate its size in prose', (_name, preset) => {
    expect(preset.desc).not.toMatch(/\d+\s*(?:x|×)\s*\d+\s*(?:x|×)\s*\d+/i);
  });

  it.each(ALL.map((p) => [p.name, p] as const))('%s builds a tree that compiles', (_name, preset) => {
    expect(compile(preset)).toBeTruthy();
  });

  /**
   * Upper half of the envelope claim.
   *
   * `computeBounds` is the sound outer bound proved in bounds.ts — the model is
   * guaranteed to lie inside it — so requiring the advertised size to equal it
   * makes the advertised size a guarantee too. This is the direction that was
   * broken: `round` offsets outward, so `round(2)` over a 74 mm box is 78 mm,
   * and every rounded preset advertised the box it started from.
   */
  it.each(ALL.map((p) => [p.name, p] as const))('%s never escapes its advertised envelope', (_name, preset) => {
    const b = computeBounds(compile(preset));
    const actual = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    for (const a of [0, 1, 2]) {
      expect(actual[a]).toBeCloseTo(preset.size[a], 3);
    }
  });

  /**
   * Lower half of the envelope claim.
   *
   * Without this, the upper half is trivially satisfiable by advertising a
   * larger box than the part. Every face has to have material within
   * FACE_TOLERANCE of it, which is what makes `size` the part's size rather
   * than merely a box containing it. It is also what catches a boolean that
   * quietly shortens a part — cutting an enclosure's lid off reduces its real
   * height while `computeBounds` keeps reporting the uncut solid.
   */
  it.each(ALL.map((p) => [p.name, p] as const))('%s reaches every face of its envelope', (_name, preset) => {
    const node = compile(preset);
    const b = computeBounds(node);
    for (const axis of [0, 1, 2] as const) {
      expect(
        planeHasMaterial(node, axis, b.min[axis] + FACE_TOLERANCE, b.min, b.max),
        `no material within ${FACE_TOLERANCE}mm of the min face on axis ${axis}`,
      ).toBe(true);
      expect(
        planeHasMaterial(node, axis, b.max[axis] - FACE_TOLERANCE, b.min, b.max),
        `no material within ${FACE_TOLERANCE}mm of the max face on axis ${axis}`,
      ).toBe(true);
    }
  });

  /**
   * A preset that is hollow where it claims to be open has to actually be
   * open, or it prints as a sealed void with no way to get the contents in.
   * `shell` produces exactly that, which is why the enclosures here are a
   * subtracted cavity that runs out through the top instead.
   */
  it.each(
    ALL.filter((p) => /open top|tray/i.test(p.desc)).map((p) => [p.name, p] as const),
  )('%s is open at the top', (_name, preset) => {
    const node = compile(preset);
    const b = computeBounds(node);
    // Straight down the middle, above the rim: nothing may be in the way.
    const centre: [number, number, number] = [
      (b.min[0] + b.max[0]) / 2,
      b.max[1] - 0.01,
      (b.min[2] + b.max[2]) / 2,
    ];
    expect(evaluateSDF(node, centre)).toBeGreaterThan(0);
  });
});

describe('Arduino Uno R3 Case', () => {
  const preset = ALL.find((p) => p.name === 'Arduino Uno R3 Case')!;

  /**
   * The published Uno R3 hole pattern is asymmetric. The previous preset used
   * a mirrored (+-31, +-24) rectangle, which no Uno will drop onto — this is
   * the assertion that rules that construction out rather than just correcting
   * the numbers once.
   */
  it('places four holes that no mirror plane can generate', () => {
    const node = compile(preset);
    // Board corner coordinates, published: 68.6 x 53.4 mm outline.
    const holes: [number, number][] = [
      [13.97 - 34.3, 2.54 - 26.7],
      [15.24 - 34.3, 50.8 - 26.7],
      [66.04 - 34.3, 7.62 - 26.7],
      [66.04 - 34.3, 35.56 - 26.7],
    ];

    // Asymmetry is the property, so state it: no two holes share |x| or |z|
    // with a partner in a way a mirror could produce.
    const xs = holes.map((h) => h[0]);
    const zs = holes.map((h) => h[1]);
    expect(new Set(xs.map((x) => Math.abs(x).toFixed(2))).size).toBeGreaterThan(1);
    expect(new Set(zs.map((z) => Math.abs(z).toFixed(2))).size).toBeGreaterThan(2);

    // Each hole is empty at standoff height, and there is post material beside it.
    for (const [x, z] of holes) {
      expect(evaluateSDF(node, [x, -6.5, z])).toBeGreaterThan(0);
      expect(evaluateSDF(node, [x + 2.4, -6.5, z])).toBeLessThanOrEqual(0);
    }
  });

  it('leaves room for the board between its walls', () => {
    const node = compile(preset);
    // Just inside each board corner, at board height: must be open space.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        expect(evaluateSDF(node, [sx * 34.3, 0, sz * 26.7])).toBeGreaterThan(0);
      }
    }
  });
});
