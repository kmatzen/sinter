import { MAX_PROFILE_VERTICES, parseProfile, signedArea, type PolygonProfile, type Vec2 } from './profile';

export type ProfileUnit = 'mm' | 'cm' | 'in' | 'px' | 'unitless';
export interface ProfileImportResult {
  profile: PolygonProfile;
  unit: ProfileUnit;
  scaleToMm: number;
  dimensions: Vec2;
  warnings: string[];
}

const UNIT_MM: Record<ProfileUnit, number> = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96, unitless: 1 };
export const profileUnitScaleToMm = (unit: ProfileUnit): number => UNIT_MM[unit];
const pointEqual = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

function normalizeLoop(loop: Vec2[], ccw: boolean): Vec2[] {
  const out = pointEqual(loop[0], loop[loop.length - 1]) ? loop.slice(0, -1) : loop.slice();
  return (signedArea(out) > 0) === ccw ? out : out.reverse();
}

function contains(point: Vec2, loop: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function assembleProfile(loops: Vec2[][]): PolygonProfile {
  if (!loops.length) throw new Error('No supported closed paths were found');
  const ranked = loops.map((loop) => normalizeLoop(loop, true)).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  const outer = ranked[0];
  const holes: Vec2[][] = [];
  for (const loop of ranked.slice(1)) {
    if (!contains(loop[0], outer)) throw new Error('Multiple disjoint outer paths are ambiguous; import one profile at a time');
    if (holes.some((hole) => contains(loop[0], hole))) throw new Error('Nested profile islands are not supported');
    holes.push(normalizeLoop(loop, false));
  }
  return parseProfile(JSON.stringify({ outer, holes }));
}

function finish(profile: PolygonProfile, unit: ProfileUnit, scaleToMm: number, warnings: string[]): ProfileImportResult {
  const scaled: PolygonProfile = {
    outer: profile.outer.map(([x, y]) => [x * scaleToMm, y * scaleToMm]),
    holes: profile.holes.map((loop) => loop.map(([x, y]) => [x * scaleToMm, y * scaleToMm])),
  };
  const checked = parseProfile(JSON.stringify(scaled));
  const xs = checked.outer.map((p) => p[0]), ys = checked.outer.map((p) => p[1]);
  return { profile: checked, unit, scaleToMm, dimensions: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)], warnings };
}

function flattenQuadratic(a: Vec2, b: Vec2, c: Vec2, tolerance: number): Vec2[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]);
  const steps = Math.max(2, Math.min(64, Math.ceil(length / Math.max(tolerance, 0.01))));
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]] as Vec2;
  });
}

function flattenCubic(a: Vec2, b: Vec2, c: Vec2, d: Vec2, tolerance: number): Vec2[] {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]) + Math.hypot(d[0] - c[0], d[1] - c[1]);
  const steps = Math.max(3, Math.min(64, Math.ceil(length / Math.max(tolerance, 0.01))));
  return Array.from({ length: steps }, (_, i) => {
    const t = (i + 1) / steps, u = 1 - t;
    return [u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0], u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1]] as Vec2;
  });
}

function parsePath(data: string, tolerance: number): Vec2[] {
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, command = '', current: Vec2 = [0, 0], start: Vec2 = [0, 0];
  const loop: Vec2[] = [];
  const number = () => { const value = Number(tokens[i++]); if (!Number.isFinite(value)) throw new Error('Malformed SVG path coordinates'); return value; };
  const point = (relative: boolean): Vec2 => { const p: Vec2 = [number(), number()]; return relative ? [current[0] + p[0], current[1] + p[1]] : p; };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
    if (!command) throw new Error('SVG path must begin with M');
    const relative = command === command.toLowerCase(), op = command.toUpperCase();
    if (op === 'M') { if (loop.length) throw new Error('Multiple SVG subpaths must be split into separate path elements'); current = point(relative); start = current; loop.push(current); command = relative ? 'l' : 'L'; }
    else if (op === 'L') { current = point(relative); loop.push(current); }
    else if (op === 'H') { const x = number(); current = [relative ? current[0] + x : x, current[1]]; loop.push(current); }
    else if (op === 'V') { const y = number(); current = [current[0], relative ? current[1] + y : y]; loop.push(current); }
    else if (op === 'Q') { const control = point(relative), end = point(relative); loop.push(...flattenQuadratic(current, control, end, tolerance)); current = end; }
    else if (op === 'C') { const b = point(relative), c = point(relative), end = point(relative); loop.push(...flattenCubic(current, b, c, end, tolerance)); current = end; }
    else if (op === 'Z') {
      if (!pointEqual(current, start)) loop.push(start);
      if (i < tokens.length) throw new Error('Multiple SVG subpaths must be split into separate path elements');
      command = '';
      break;
    }
    else throw new Error(`Unsupported SVG path command ${command}`);
    if (loop.length > MAX_PROFILE_VERTICES + 1) throw new Error(`Flattened path exceeds ${MAX_PROFILE_VERTICES} vertices`);
  }
  if (!pointEqual(loop[0], loop[loop.length - 1])) throw new Error('SVG path is open; close it with Z');
  return loop;
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
}
function points(value: string): Vec2[] {
  const numbers = value.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)?.map(Number) || [];
  if (numbers.length < 6 || numbers.length % 2) throw new Error('Malformed SVG point list');
  return Array.from({ length: numbers.length / 2 }, (_, i) => [numbers[i * 2], numbers[i * 2 + 1]] as Vec2);
}
function ellipse(cx: number, cy: number, rx: number, ry: number, tolerance: number): Vec2[] {
  const steps = Math.max(12, Math.min(128, Math.ceil(2 * Math.PI * Math.max(rx, ry) / Math.max(tolerance, 0.01))));
  return Array.from({ length: steps }, (_, i) => [cx + rx * Math.cos(2 * Math.PI * i / steps), cy + ry * Math.sin(2 * Math.PI * i / steps)] as Vec2);
}
function lengthUnit(value?: string): { value?: number; unit: ProfileUnit } {
  if (!value) return { unit: 'px' };
  const match = value.trim().match(/^([-+\d.eE]+)\s*(mm|cm|in|px)?$/i);
  if (!match) return { unit: 'px' };
  return { value: Number(match[1]), unit: (match[2]?.toLowerCase() || 'px') as ProfileUnit };
}

export function parseSvgProfile(svg: string, tolerance = 0.25): ProfileImportResult {
  if (svg.length > 2_000_000) throw new Error('SVG exceeds the 2 MB profile import limit');
  if (!/<svg\b/i.test(svg) || !/<\/svg\s*>/i.test(svg)) throw new Error('File is not a complete SVG document');
  const warnings: string[] = [];
  const unsupported = [...svg.matchAll(/<([a-z][\w:-]*)\b/gi)].map((m) => m[1].toLowerCase()).filter((name) => !['svg', 'g', 'path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'title', 'desc'].includes(name));
  if (unsupported.length) warnings.push(`Unsupported SVG entities ignored: ${[...new Set(unsupported)].join(', ')}`);
  if (/\btransform\s*=/i.test(svg)) throw new Error('SVG transforms are not supported; flatten transforms before import');
  const loops: Vec2[][] = [];
  for (const match of svg.matchAll(/<(path|polygon|polyline|rect|circle|ellipse)\b[^>]*>/gi)) {
    const kind = match[1].toLowerCase(), tag = match[0];
    if (kind === 'path') loops.push(parsePath(attribute(tag, 'd') || '', tolerance));
    else if (kind === 'polygon') loops.push(points(attribute(tag, 'points') || ''));
    else if (kind === 'polyline') { const loop = points(attribute(tag, 'points') || ''); if (!pointEqual(loop[0], loop[loop.length - 1])) throw new Error('SVG polyline is open'); loops.push(loop); }
    else if (kind === 'rect') {
      if (attribute(tag, 'rx') || attribute(tag, 'ry')) warnings.push('Rounded SVG rectangle corners are imported square');
      const x = Number(attribute(tag, 'x') || 0), y = Number(attribute(tag, 'y') || 0), w = Number(attribute(tag, 'width')), h = Number(attribute(tag, 'height'));
      loops.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
    } else {
      const cx = Number(attribute(tag, 'cx') || 0), cy = Number(attribute(tag, 'cy') || 0);
      const rx = Number(attribute(tag, kind === 'circle' ? 'r' : 'rx')), ry = Number(attribute(tag, kind === 'circle' ? 'r' : 'ry'));
      loops.push(ellipse(cx, cy, rx, ry, tolerance));
    }
  }
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
  const width = lengthUnit(attribute(root, 'width'));
  const viewBox = attribute(root, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  let scale = UNIT_MM[width.unit];
  if (width.value && viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0) scale = width.value * UNIT_MM[width.unit] / viewBox[2];
  if (!loops.length) throw new Error(warnings.length ? warnings.join('; ') : 'No supported closed paths were found');
  return finish(assembleProfile(loops), width.unit, scale, warnings);
}

const DXF_UNITS: Record<number, { unit: ProfileUnit; scale: number }> = { 0: { unit: 'unitless', scale: 1 }, 1: { unit: 'in', scale: 25.4 }, 4: { unit: 'mm', scale: 1 }, 5: { unit: 'cm', scale: 10 } };
function arcPoints(cx: number, cy: number, radius: number, start: number, sweep: number, tolerance: number): Vec2[] {
  const steps = Math.max(2, Math.min(128, Math.ceil(Math.abs(sweep) * radius / Math.max(tolerance, 0.01))));
  return Array.from({ length: steps + 1 }, (_, i) => [cx + radius * Math.cos(start + sweep * i / steps), cy + radius * Math.sin(start + sweep * i / steps)] as Vec2);
}
function bulgeSegment(a: Vec2, b: Vec2, bulge: number, tolerance: number): Vec2[] {
  if (Math.abs(bulge) < 1e-12) return [a, b];
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]), sweep = 4 * Math.atan(bulge);
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const offset = chord / (2 * Math.tan(sweep / 2)), nx = -(b[1] - a[1]) / chord, ny = (b[0] - a[0]) / chord;
  const cx = mx + nx * offset, cy = my + ny * offset, radius = Math.hypot(a[0] - cx, a[1] - cy);
  return arcPoints(cx, cy, radius, Math.atan2(a[1] - cy, a[0] - cx), sweep, tolerance);
}
function stitchSegments(segments: Vec2[][]): Vec2[][] {
  const pending = segments.map((segment) => segment.slice());
  const loops: Vec2[][] = [];
  while (pending.length) {
    const chain = pending.shift()!;
    while (!pointEqual(chain[0], chain[chain.length - 1])) {
      const index = pending.findIndex((segment) => pointEqual(segment[0], chain[chain.length - 1]) || pointEqual(segment[segment.length - 1], chain[chain.length - 1]));
      if (index < 0) throw new Error('DXF line/arc chain is open');
      let next = pending.splice(index, 1)[0];
      if (!pointEqual(next[0], chain[chain.length - 1])) next = next.reverse();
      chain.push(...next.slice(1));
      if (chain.length > MAX_PROFILE_VERTICES + 1) throw new Error(`Flattened DXF path exceeds ${MAX_PROFILE_VERTICES} vertices`);
    }
    loops.push(chain);
  }
  return loops;
}
export function parseDxfProfile(dxf: string, tolerance = 0.25): ProfileImportResult {
  if (dxf.length > 2_000_000) throw new Error('DXF exceeds the 2 MB profile import limit');
  const rows = dxf.replace(/\r/g, '').split('\n');
  if (rows.length < 4) throw new Error('File is not an ASCII DXF document');
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < rows.length; i += 2) pairs.push([Number(rows[i].trim()), rows[i + 1].trim()]);
  const warnings: string[] = [], loops: Vec2[][] = [], segments: Vec2[][] = [];
  let insUnits = 0;
  for (let i = 0; i < pairs.length; i++) if (pairs[i][1] === '$INSUNITS' && pairs[i + 1]?.[0] === 70) insUnits = Number(pairs[i + 1][1]);
  for (let i = 0; i < pairs.length;) {
    if (pairs[i][0] !== 0) { i++; continue; }
    const type = pairs[i][1].toUpperCase(); let j = i + 1;
    while (j < pairs.length && pairs[j][0] !== 0) j++;
    const entity = pairs.slice(i + 1, j), values = (code: number) => entity.filter((p) => p[0] === code).map((p) => Number(p[1]));
    if (type === 'LWPOLYLINE') {
      const flags = values(70)[0] || 0, vertices: Array<{ p: Vec2; bulge: number }> = [];
      for (let k = 0; k < entity.length; k++) if (entity[k][0] === 10) {
        let y: number | undefined, bulge = 0;
        for (let q = k + 1; q < entity.length && entity[q][0] !== 10; q++) { if (entity[q][0] === 20) y = Number(entity[q][1]); if (entity[q][0] === 42) bulge = Number(entity[q][1]); }
        if (y === undefined) throw new Error('Malformed DXF LWPOLYLINE');
        vertices.push({ p: [Number(entity[k][1]), y], bulge });
      }
      if (!(flags & 1)) throw new Error('DXF LWPOLYLINE is open');
      if (vertices.length < 3) throw new Error('Malformed DXF LWPOLYLINE');
      const loop: Vec2[] = [];
      vertices.forEach((vertex, k) => { const part = bulgeSegment(vertex.p, vertices[(k + 1) % vertices.length].p, vertex.bulge, tolerance); loop.push(...part.slice(k ? 1 : 0)); });
      loops.push(loop);
    } else if (type === 'POLYLINE') {
      const flags = values(70)[0] || 0, vertices: Vec2[] = []; let end = j;
      while (end < pairs.length && !(pairs[end][0] === 0 && pairs[end][1].toUpperCase() === 'SEQEND')) {
        if (pairs[end][0] === 0 && pairs[end][1].toUpperCase() === 'VERTEX') {
          let q = end + 1, x: number | undefined, y: number | undefined;
          while (q < pairs.length && pairs[q][0] !== 0) { if (pairs[q][0] === 10) x = Number(pairs[q][1]); if (pairs[q][0] === 20) y = Number(pairs[q][1]); q++; }
          if (x !== undefined && y !== undefined) vertices.push([x, y]);
          end = q;
        } else end++;
      }
      if (!(flags & 1)) throw new Error('DXF POLYLINE is open');
      if (vertices.length < 3) throw new Error('Malformed DXF POLYLINE');
      loops.push(vertices); i = end + 1; continue;
    } else if (type === 'CIRCLE') {
      loops.push(ellipse(values(10)[0], values(20)[0], values(40)[0], values(40)[0], tolerance));
    } else if (type === 'LINE') {
      segments.push([[values(10)[0], values(20)[0]], [values(11)[0], values(21)[0]]]);
    } else if (type === 'ARC') {
      let start = values(50)[0] * Math.PI / 180, end = values(51)[0] * Math.PI / 180;
      while (end <= start) end += 2 * Math.PI;
      segments.push(arcPoints(values(10)[0], values(20)[0], values(40)[0], start, end - start, tolerance));
    } else if (!['SECTION', 'ENDSEC', 'EOF', 'HEADER', 'TABLES', 'TABLE', 'ENDTAB', 'BLOCKS', 'BLOCK', 'ENDBLK', 'ENTITIES', 'OBJECTS'].includes(type)) {
      warnings.push(`Unsupported DXF entity ignored: ${type}`);
    }
    i = j;
  }
  loops.push(...stitchSegments(segments));
  const units = DXF_UNITS[insUnits] || { unit: 'unitless' as const, scale: 1 };
  if (!DXF_UNITS[insUnits]) warnings.push(`Unknown DXF INSUNITS ${insUnits}; treating coordinates as millimetres`);
  const uniqueWarnings = [...new Set(warnings)];
  if (!loops.length) throw new Error(uniqueWarnings.length ? uniqueWarnings.join('; ') : 'No supported closed paths were found');
  return finish(assembleProfile(loops), units.unit, units.scale, uniqueWarnings);
}

export function rescaleProfileImport(result: ProfileImportResult, scaleToMm: number, unit = result.unit): ProfileImportResult {
  if (!Number.isFinite(scaleToMm) || scaleToMm <= 0) throw new Error('Scale must be a positive finite number');
  return finish({ outer: result.profile.outer.map(([x, y]) => [x / result.scaleToMm, y / result.scaleToMm]), holes: result.profile.holes.map((loop) => loop.map(([x, y]) => [x / result.scaleToMm, y / result.scaleToMm])) }, unit, scaleToMm, result.warnings);
}
