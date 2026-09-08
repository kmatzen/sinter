import { MAX_PROFILE_VERTICES, parseProfile, profileLoopBoundsPoints, profileLoopSignedArea, type PolygonProfile, type Vec2 } from './profile';

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

function normalizeLoop(loop: Vec2[], ccw: boolean, bulges: number[] = []): { loop: Vec2[]; bulges: number[] } {
  const out = pointEqual(loop[0], loop[loop.length - 1]) ? loop.slice(0, -1) : loop.slice();
  const edgeBulges = bulges.slice(0, out.length);
  while (edgeBulges.length < out.length) edgeBulges.push(0);
  if ((profileLoopSignedArea(out, edgeBulges) > 0) === ccw) return { loop: out, bulges: edgeBulges };
  const reversed = out.slice().reverse();
  return { loop: reversed, bulges: reversed.map((_, i) => -edgeBulges[(out.length - 2 - i + out.length) % out.length]) };
}

function contains(point: Vec2, loop: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function assembleProfile(loops: Vec2[][], bulges: number[][] = []): PolygonProfile {
  if (!loops.length) throw new Error('No supported closed paths were found');
  const ranked = loops.map((loop, i) => normalizeLoop(loop, true, bulges[i])).sort((a, b) => Math.abs(profileLoopSignedArea(b.loop, b.bulges)) - Math.abs(profileLoopSignedArea(a.loop, a.bulges)));
  const outer = ranked[0], holes: Vec2[][] = [], holeBulges: number[][] = [];
  for (const candidate of ranked.slice(1)) {
    if (!contains(candidate.loop[0], outer.loop)) throw new Error('Multiple disjoint outer paths are ambiguous; import one profile at a time');
    if (holes.some((hole) => contains(candidate.loop[0], hole))) throw new Error('Nested profile islands are not supported');
    const normalized = normalizeLoop(candidate.loop, false, candidate.bulges);
    holes.push(normalized.loop); holeBulges.push(normalized.bulges);
  }
  const hasArcs = outer.bulges.some(Boolean) || holeBulges.some((values) => values.some(Boolean));
  return parseProfile(JSON.stringify({ outer: outer.loop, holes, ...(hasArcs ? { bulges: outer.bulges, holeBulges } : {}) }));
}

function finish(profile: PolygonProfile, unit: ProfileUnit, scaleToMm: number, warnings: string[]): ProfileImportResult {
  const scaled: PolygonProfile = {
    outer: profile.outer.map(([x, y]) => [x * scaleToMm, y * scaleToMm]),
    holes: profile.holes.map((loop) => loop.map(([x, y]) => [x * scaleToMm, y * scaleToMm])),
    ...(profile.bulges ? { bulges: [...profile.bulges] } : {}),
    ...(profile.holeBulges ? { holeBulges: profile.holeBulges.map((values) => [...values]) } : {}),
  };
  const checked = parseProfile(JSON.stringify(scaled));
  const outline = profileLoopBoundsPoints(checked.outer, checked.bulges);
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
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

function parsePath(data: string, tolerance: number): { loop: Vec2[]; bulges: number[] } {
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
  let i = 0, command = '', current: Vec2 = [0, 0], start: Vec2 = [0, 0];
  const loop: Vec2[] = [], bulges: number[] = [];
  const number = () => { const value = Number(tokens[i++]); if (!Number.isFinite(value)) throw new Error('Malformed SVG path coordinates'); return value; };
  const point = (relative: boolean): Vec2 => { const p: Vec2 = [number(), number()]; return relative ? [current[0] + p[0], current[1] + p[1]] : p; };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
    if (!command) throw new Error('SVG path must begin with M');
    const relative = command === command.toLowerCase(), op = command.toUpperCase();
    const appendLines = (next: Vec2[]) => { for (const target of next) { bulges.push(0); loop.push(target); current = target; } };
    if (op === 'M') { if (loop.length) throw new Error('Multiple SVG subpaths must be split into separate path elements'); current = point(relative); start = current; loop.push(current); command = relative ? 'l' : 'L'; }
    else if (op === 'L') appendLines([point(relative)]);
    else if (op === 'H') { const x = number(); appendLines([[relative ? current[0] + x : x, current[1]]]); }
    else if (op === 'V') { const y = number(); appendLines([[current[0], relative ? current[1] + y : y]]); }
    else if (op === 'Q') { const control = point(relative), end = point(relative); appendLines(flattenQuadratic(current, control, end, tolerance)); }
    else if (op === 'C') { const b = point(relative), c = point(relative), end = point(relative); appendLines(flattenCubic(current, b, c, end, tolerance)); }
    else if (op === 'A') {
      const rx = Math.abs(number()), ry = Math.abs(number()), rotation = number(), large = number(), sweep = number(), end = point(relative);
      if (rx <= 0 || ry <= 0) appendLines([end]);
      else {
        if (Math.abs(rx - ry) > 1e-9 * Math.max(rx, ry) || Math.abs(rotation % 180) > 1e-9) throw new Error('Elliptical or rotated SVG A arcs are unsupported; convert them to circular arcs or curves before import');
        if (![0, 1].includes(large) || ![0, 1].includes(sweep)) throw new Error('SVG arc flags must be 0 or 1');
        const chord = Math.hypot(end[0] - current[0], end[1] - current[1]);
        let angle = 2 * Math.asin(Math.min(1, chord / (2 * rx)));
        if (large) angle = 2 * Math.PI - angle;
        bulges.push(Math.tan((sweep ? -angle : angle) / 4)); loop.push(end); current = end;
      }
    }
    else if (op === 'Z') {
      if (!pointEqual(current, start)) appendLines([start]);
      if (i < tokens.length) throw new Error('Multiple SVG subpaths must be split into separate path elements');
      command = '';
      break;
    }
    else throw new Error(`Unsupported SVG path command ${command}`);
    if (loop.length > MAX_PROFILE_VERTICES + 1) throw new Error(`Flattened path exceeds ${MAX_PROFILE_VERTICES} vertices`);
  }
  if (!pointEqual(loop[0], loop[loop.length - 1])) throw new Error('SVG path is open; close it with Z');
  return { loop, bulges };
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
  const loops: Vec2[][] = [], loopBulges: number[][] = [];
  for (const match of svg.matchAll(/<(path|polygon|polyline|rect|circle|ellipse)\b[^>]*>/gi)) {
    const kind = match[1].toLowerCase(), tag = match[0];
    if (kind === 'path') { const parsed = parsePath(attribute(tag, 'd') || '', tolerance); loops.push(parsed.loop); loopBulges.push(parsed.bulges); }
    else if (kind === 'polygon') { const loop = points(attribute(tag, 'points') || ''); loops.push(loop); loopBulges.push(Array(loop.length).fill(0)); }
    else if (kind === 'polyline') { const loop = points(attribute(tag, 'points') || ''); if (!pointEqual(loop[0], loop[loop.length - 1])) throw new Error('SVG polyline is open'); loops.push(loop); loopBulges.push(Array(loop.length - 1).fill(0)); }
    else if (kind === 'rect') {
      if (attribute(tag, 'rx') || attribute(tag, 'ry')) warnings.push('Rounded SVG rectangle corners are imported square');
      const x = Number(attribute(tag, 'x') || 0), y = Number(attribute(tag, 'y') || 0), w = Number(attribute(tag, 'width')), h = Number(attribute(tag, 'height'));
      loops.push([[x, y], [x + w, y], [x + w, y + h], [x, y + h]]); loopBulges.push([0, 0, 0, 0]);
    } else {
      const cx = Number(attribute(tag, 'cx') || 0), cy = Number(attribute(tag, 'cy') || 0);
      const rx = Number(attribute(tag, kind === 'circle' ? 'r' : 'rx')), ry = Number(attribute(tag, kind === 'circle' ? 'r' : 'ry'));
      if (Math.abs(rx - ry) < 1e-9 * Math.max(rx, ry)) {
        const quarter = Math.tan(Math.PI / 8);
        loops.push([[cx + rx, cy], [cx, cy + ry], [cx - rx, cy], [cx, cy - ry]]); loopBulges.push([quarter, quarter, quarter, quarter]);
      } else { const loop = ellipse(cx, cy, rx, ry, tolerance); loops.push(loop); loopBulges.push(Array(loop.length).fill(0)); }
    }
  }
  const root = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
  const width = lengthUnit(attribute(root, 'width'));
  const viewBox = attribute(root, 'viewBox')?.trim().split(/[\s,]+/).map(Number);
  let scale = UNIT_MM[width.unit];
  if (width.value && viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0) scale = width.value * UNIT_MM[width.unit] / viewBox[2];
  if (!loops.length) throw new Error(warnings.length ? warnings.join('; ') : 'No supported closed paths were found');
  return finish(assembleProfile(loops, loopBulges), width.unit, scale, warnings);
}

const DXF_UNITS: Record<number, { unit: ProfileUnit; scale: number }> = { 0: { unit: 'unitless', scale: 1 }, 1: { unit: 'in', scale: 25.4 }, 4: { unit: 'mm', scale: 1 }, 5: { unit: 'cm', scale: 10 } };
function stitchSegments(segments: Array<{ points: [Vec2, Vec2]; bulge: number }>): Array<{ loop: Vec2[]; bulges: number[] }> {
  const pending = segments.map((segment) => ({ points: [...segment.points] as [Vec2, Vec2], bulge: segment.bulge }));
  const loops: Array<{ loop: Vec2[]; bulges: number[] }> = [];
  while (pending.length) {
    const first = pending.shift()!, chain = [...first.points], bulges = [first.bulge];
    while (!pointEqual(chain[0], chain[chain.length - 1])) {
      const index = pending.findIndex((segment) => pointEqual(segment.points[0], chain[chain.length - 1]) || pointEqual(segment.points[1], chain[chain.length - 1]));
      if (index < 0) throw new Error('DXF line/arc chain is open');
      let next = pending.splice(index, 1)[0];
      if (!pointEqual(next.points[0], chain[chain.length - 1])) next = { points: [next.points[1], next.points[0]], bulge: -next.bulge };
      chain.push(next.points[1]); bulges.push(next.bulge);
      if (chain.length > MAX_PROFILE_VERTICES + 1) throw new Error(`Flattened DXF path exceeds ${MAX_PROFILE_VERTICES} vertices`);
    }
    chain.pop();
    loops.push({ loop: chain, bulges });
  }
  return loops;
}
export function parseDxfProfile(dxf: string, _tolerance = 0.25): ProfileImportResult {
  if (dxf.length > 2_000_000) throw new Error('DXF exceeds the 2 MB profile import limit');
  const rows = dxf.replace(/\r/g, '').split('\n');
  if (rows.length < 4) throw new Error('File is not an ASCII DXF document');
  const pairs: Array<[number, string]> = [];
  for (let i = 0; i + 1 < rows.length; i += 2) pairs.push([Number(rows[i].trim()), rows[i + 1].trim()]);
  const warnings: string[] = [], loops: Vec2[][] = [], loopBulges: number[][] = [], segments: Array<{ points: [Vec2, Vec2]; bulge: number }> = [];
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
      loops.push(vertices.map((vertex) => vertex.p));
      loopBulges.push(vertices.map((vertex) => vertex.bulge));
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
      loops.push(vertices); loopBulges.push(Array(vertices.length).fill(0)); i = end + 1; continue;
    } else if (type === 'CIRCLE') {
      const cx = values(10)[0], cy = values(20)[0], radius = values(40)[0], quarter = Math.tan(Math.PI / 8);
      loops.push([[cx + radius, cy], [cx, cy + radius], [cx - radius, cy], [cx, cy - radius]]);
      loopBulges.push([quarter, quarter, quarter, quarter]);
    } else if (type === 'LINE') {
      segments.push({ points: [[values(10)[0], values(20)[0]], [values(11)[0], values(21)[0]]], bulge: 0 });
    } else if (type === 'ARC') {
      let start = values(50)[0] * Math.PI / 180, end = values(51)[0] * Math.PI / 180;
      while (end <= start) end += 2 * Math.PI;
      const cx = values(10)[0], cy = values(20)[0], radius = values(40)[0];
      segments.push({ points: [[cx + radius * Math.cos(start), cy + radius * Math.sin(start)], [cx + radius * Math.cos(end), cy + radius * Math.sin(end)]], bulge: Math.tan((end - start) / 4) });
    } else if (!['SECTION', 'ENDSEC', 'EOF', 'HEADER', 'TABLES', 'TABLE', 'ENDTAB', 'BLOCKS', 'BLOCK', 'ENDBLK', 'ENTITIES', 'OBJECTS'].includes(type)) {
      warnings.push(`Unsupported DXF entity ignored: ${type}`);
    }
    i = j;
  }
  for (const stitched of stitchSegments(segments)) { loops.push(stitched.loop); loopBulges.push(stitched.bulges); }
  const units = DXF_UNITS[insUnits] || { unit: 'unitless' as const, scale: 1 };
  if (!DXF_UNITS[insUnits]) warnings.push(`Unknown DXF INSUNITS ${insUnits}; treating coordinates as millimetres`);
  const uniqueWarnings = [...new Set(warnings)];
  if (!loops.length) throw new Error(uniqueWarnings.length ? uniqueWarnings.join('; ') : 'No supported closed paths were found');
  return finish(assembleProfile(loops, loopBulges), units.unit, units.scale, uniqueWarnings);
}

export function rescaleProfileImport(result: ProfileImportResult, scaleToMm: number, unit = result.unit): ProfileImportResult {
  if (!Number.isFinite(scaleToMm) || scaleToMm <= 0) throw new Error('Scale must be a positive finite number');
  return finish({ outer: result.profile.outer.map(([x, y]) => [x / result.scaleToMm, y / result.scaleToMm]), holes: result.profile.holes.map((loop) => loop.map(([x, y]) => [x / result.scaleToMm, y / result.scaleToMm])), bulges: result.profile.bulges, holeBulges: result.profile.holeBulges }, unit, scaleToMm, result.warnings);
}
