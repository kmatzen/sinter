import { describe, expect, it } from 'vitest';
import { parseDxfProfile, parseSvgProfile, rescaleProfileImport } from './profileImport';

describe('SVG profile import', () => {
  it('imports an outline and hole at the viewBox-derived physical size', () => {
    const result = parseSvgProfile(`<svg width="2in" viewBox="0 0 200 100"><rect x="0" y="0" width="200" height="100"/><circle cx="100" cy="50" r="10"/></svg>`);
    expect(result.unit).toBe('in');
    expect(result.scaleToMm).toBeCloseTo(0.254);
    expect(result.dimensions[0]).toBeCloseTo(50.8);
    expect(result.dimensions[1]).toBeCloseTo(25.4);
    expect(result.profile.holes).toHaveLength(1);
  });

  it('flattens closed line and curve paths deterministically', () => {
    const svg = `<svg width="20mm"><path d="M 0 0 L 20 0 Q 20 10 10 10 C 5 10 0 5 0 0 Z"/></svg>`;
    const a = parseSvgProfile(svg, 1), b = parseSvgProfile(svg, 1);
    expect(a.profile).toEqual(b.profile);
    expect(a.profile.outer.length).toBeGreaterThan(6);
    expect(parseSvgProfile(svg, 0.1).profile.outer.length).toBeGreaterThan(a.profile.outer.length);
  });

  it('preserves circular SVG arcs and rejects unsupported elliptical arcs actionably', () => {
    const result = parseSvgProfile(`<svg width="10mm"><path d="M0 0 A5 5 0 0 0 10 0 A5 5 0 0 0 0 0 Z"/></svg>`);
    expect(result.profile.outer).toHaveLength(2);
    expect(result.profile.bulges?.[0]).toBeCloseTo(1);
    expect(result.profile.bulges?.[1]).toBeCloseTo(1);
    expect(result.dimensions[0]).toBeCloseTo(10);
    expect(result.dimensions[1]).toBeCloseTo(10);
    expect(() => parseSvgProfile(`<svg><path d="M0 0 A8 5 0 0 0 10 0 L0 0 Z"/></svg>`)).toThrow(/Elliptical.*unsupported/);
  });

  it('rejects open paths and transforms instead of silently changing geometry', () => {
    expect(() => parseSvgProfile(`<svg><path d="M0 0 L10 0 L10 10"/></svg>`)).toThrow(/open/);
    expect(() => parseSvgProfile(`<svg><rect transform="rotate(10)" width="10" height="10"/></svg>`)).toThrow(/transforms are not supported/);
    expect(() => parseSvgProfile(`<svg><path d="M0 0 L10 0 L0 10 Z M20 20 L30 20 L20 30 Z"/></svg>`)).toThrow(/Multiple SVG subpaths/);
    expect(() => parseSvgProfile(`<svg><rect width="10" height="10"/>`)).toThrow(/complete SVG/);
  });

  it('reports unsupported entities and supports deterministic unit overrides', () => {
    const result = parseSvgProfile(`<svg width="10mm"><rect width="10" height="5"/><text>x</text></svg>`);
    expect(result.warnings).toEqual([expect.stringContaining('text')]);
    const inches = rescaleProfileImport(result, 25.4, 'in');
    expect(inches.unit).toBe('in');
    expect(inches.dimensions).toEqual([254, 127]);
  });
});

describe('ASCII DXF profile import', () => {
  it('imports a closed lightweight polyline and circle using INSUNITS', () => {
    const dxf = `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n10\n40\n20\n0\n10\n40\n20\n20\n10\n0\n20\n20\n0\nCIRCLE\n10\n20\n20\n10\n40\n3\n0\nENDSEC\n0\nEOF`;
    const result = parseDxfProfile(dxf, 1);
    expect(result.unit).toBe('mm');
    expect(result.dimensions).toEqual([40, 20]);
    expect(result.profile.holes).toHaveLength(1);
    expect(result.profile.holeBulges?.[0].every((bulge) => Math.abs(bulge) > 0)).toBe(true);
  });

  it('supports bulge arcs and rejects open polylines', () => {
    const closed = `0\nLWPOLYLINE\n70\n1\n10\n0\n20\n0\n42\n1\n10\n10\n20\n0\n10\n10\n20\n10\n0\nEOF`;
    const profile = parseDxfProfile(closed, 1).profile;
    expect(profile.outer).toHaveLength(3);
    expect(profile.bulges).toContain(1);
    expect(rescaleProfileImport(parseDxfProfile(closed, 1), 25.4, 'in').profile.bulges).toEqual(profile.bulges);
    expect(() => parseDxfProfile(closed.replace('70\n1', '70\n0'), 1)).toThrow(/open/);
  });

  it('stitches line and arc entities into a closed loop', () => {
    const dxf = `0\nLINE\n10\n0\n20\n0\n11\n10\n21\n0\n0\nARC\n10\n5\n20\n0\n40\n5\n50\n0\n51\n180\n0\nEOF`;
    // The chord and semicircle form a closed D profile.
    const profile = parseDxfProfile(dxf, 1).profile;
    expect(profile.outer).toHaveLength(2);
    expect(profile.bulges?.some(Boolean)).toBe(true);
  });

  it('imports closed legacy polylines and reports unsupported-only files', () => {
    const polyline = `0\nPOLYLINE\n70\n1\n0\nVERTEX\n10\n0\n20\n0\n0\nVERTEX\n10\n10\n20\n0\n0\nVERTEX\n10\n0\n20\n10\n0\nSEQEND\n0\nEOF`;
    expect(parseDxfProfile(polyline).dimensions).toEqual([10, 10]);
    expect(() => parseDxfProfile(`0\nSPLINE\n10\n0\n20\n0\n0\nEOF`)).toThrow(/Unsupported DXF entity ignored: SPLINE/);
  });
});
