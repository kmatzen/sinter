import { test, expect, type Page } from '@playwright/test';

/**
 * Fitting a primitive to an imported mesh, end to end (#87 layer 2).
 *
 * The unit tests cover the fitter against analytic shapes. What they cannot
 * show is the path: a file through the picker, a bake in the worker, a fit,
 * a residual back on screen, and a tree the modeller can actually evaluate.
 */

const PRECONDITION_TIMEOUT = 90_000;

/** A closed sphere-ish solid as a binary STL: an octahedron subdivided twice. */
function sphereSTL(radius: number, subdiv: number): Buffer {
  const norm = (p: number[]) => { const l = Math.hypot(p[0], p[1], p[2]); return [p[0] / l, p[1] / l, p[2] / l]; };
  const mid = (a: number[], b: number[]) => norm([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  const o = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  let tris = [[0,2,4],[2,1,4],[1,3,4],[3,0,4],[2,0,5],[1,2,5],[3,1,5],[0,3,5]].map((f) => f.map((i) => o[i]));
  for (let s = 0; s < subdiv; s++) {
    const next: number[][][] = [];
    for (const [a, b, c] of tris) {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
    }
    tris = next;
  }
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.writeUInt32LE(tris.length, 80);
  let off = 84;
  for (const t of tris) {
    off += 12;
    for (const v of t) {
      buf.writeFloatLE(v[0] * radius, off);
      buf.writeFloatLE(v[1] * radius, off + 4);
      buf.writeFloatLE(v[2] * radius, off + 8);
      off += 12;
    }
    off += 2;
  }
  return buf;
}

function rotatedBoxSTL(size: [number, number, number], degrees: [number, number, number]): Buffer {
  const rotate = (point: number[]) => {
    let [x, y, z] = point;
    for (const [axis, angle] of degrees.map((value, axis) => [axis, value * Math.PI / 180] as const)) {
      const c = Math.cos(angle), s = Math.sin(angle);
      if (axis === 0) [y, z] = [y * c - z * s, y * s + z * c];
      else if (axis === 1) [x, z] = [x * c + z * s, -x * s + z * c];
      else [x, y] = [x * c - y * s, x * s + y * c];
    }
    return [x + 3, y - 2, z + 4];
  };
  const vertices = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]
    .map((point) => rotate(point.map((value, axis) => value * size[axis] / 2)));
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
  const buffer = Buffer.alloc(84 + faces.length * 50);
  buffer.writeUInt32LE(faces.length, 80);
  let offset = 84;
  for (const face of faces) {
    offset += 12;
    for (const index of face) {
      for (let axis = 0; axis < 3; axis++) buffer.writeFloatLE(vertices[index][axis], offset + axis * 4);
      offset += 12;
    }
    offset += 2;
  }
  return buffer;
}

function tubeSTL(outer: number, inner: number, height: number, segments = 32): Buffer {
  const triangles: number[][][] = [], point = (radius: number, index: number, y: number) => [radius * Math.cos(index * 2 * Math.PI / segments), y, radius * Math.sin(index * 2 * Math.PI / segments)];
  for (let index = 0; index < segments; index++) {
    const next = (index + 1) % segments;
    const ob = point(outer,index,-height/2), onb = point(outer,next,-height/2), ot = point(outer,index,height/2), ont = point(outer,next,height/2);
    const ib = point(inner,index,-height/2), inb = point(inner,next,-height/2), it = point(inner,index,height/2), int = point(inner,next,height/2);
    triangles.push([ot,onb,ob],[ot,ont,onb], [it,ont,ot],[it,int,ont], [ib,onb,inb],[ib,ob,onb], [it,inb,int],[it,ib,inb]);
  }
  const buffer = Buffer.alloc(84 + triangles.length * 50); buffer.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const triangle of triangles) { offset += 12; for (const vertex of triangle) { for (let axis = 0; axis < 3; axis++) buffer.writeFloatLE(vertex[axis], offset + axis * 4); offset += 12; } offset += 2; }
  return buffer;
}

async function enterModeler(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const accept = page.locator('button:has-text("Accept")');
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) await accept.click();
  const startBtn = page.locator('button:has-text("Start Modeling")').first();
  if (await startBtn.isVisible({ timeout: 30_000 }).catch(() => false)) await startBtn.click();
  if (await accept.isVisible({ timeout: 1500 }).catch(() => false)) await accept.click();
  const continueBtn = page.locator('button:has-text("Continue without account")');
  if (await continueBtn.isVisible({ timeout: 30_000 }).catch(() => false)) await continueBtn.click();
  await expect(page.locator('[data-testid="modeler-app"]')).toBeVisible({ timeout: PRECONDITION_TIMEOUT });
}

async function importAndSelect(page: Page, buffer: Buffer) {
  await page.getByRole('button', { name: 'Import mesh' }).click();
  await page.locator('input[type="file"]').setInputFiles({ name: 'part.stl', mimeType: 'model/stl', buffer });
  await page.getByRole('button', { name: 'Import approximately' }).click();
  await page.waitForFunction(
    () => (window as any).__MODELER_STORE__?.tree?.kind === 'mesh',
    null,
    { timeout: PRECONDITION_TIMEOUT },
  );
  await page.evaluate(() => {
    const s = (window as any).__MODELER_STORE__;
    s.selectNode(s.tree.id);
  });
}

test.describe('Fit a primitive to an imported mesh', () => {
  test.slow();

  test('recovers a sphere and replaces the mesh with it', async ({ page }) => {
    await enterModeler(page);
    await importAndSelect(page, sphereSTL(14, 2));

    await page.locator('button:has-text("Find best primitive")').click();
    await expect(page.locator('text=/Sphere — worst/')).toBeVisible({ timeout: PRECONDITION_TIMEOUT });

    await page.locator('button:has-text("Replace with")').click();

    // The mesh is gone and an editable sphere is in its place.
    await expect
      .poll(() => page.evaluate(() => {
        const kinds: string[] = [];
        const walk = (n: any) => { if (!n) return; kinds.push(n.kind); (n.children ?? []).forEach(walk); };
        walk((window as any).__MODELER_STORE__.tree);
        return kinds;
      }), { timeout: 20000 })
      .toContain('sphere');

    const kinds = await page.evaluate(() => {
      const out: string[] = [];
      const walk = (n: any) => { if (!n) return; out.push(n.kind); (n.children ?? []).forEach(walk); };
      walk((window as any).__MODELER_STORE__.tree);
      return out;
    });
    expect(kinds).not.toContain('mesh');

    // And it still evaluates — a tree that cannot be drawn is not a fit.
    await page.waitForFunction(
      () => !!(window as any).__MODELER_STORE__?.sdfDisplay && !(window as any).__MODELER_STORE__?.evaluating,
      null,
      { timeout: PRECONDITION_TIMEOUT },
    );
    expect(await page.evaluate(() => (window as any).__MODELER_STORE__.error)).toBeFalsy();
  });

  test('recovers a non-cardinal rotated box as a transformed box', async ({ page }) => {
    await enterModeler(page);
    await importAndSelect(page, rotatedBoxSTL([28, 17, 9], [27, -19, 13]));
    await page.getByRole('button', { name: 'Find best primitive' }).click();
    await expect(page.getByText(/Box \(fitted orientation\) — worst/)).toBeVisible({ timeout: PRECONDITION_TIMEOUT });
    await expect(page.getByText('Detected 6 fit-eligible surface regions.')).toBeVisible();
    await expect(page.getByText('Classified 6 analytic surface hypotheses.')).toBeVisible();
    await page.getByRole('button', { name: /Replace with Box/ }).click();
    await expect.poll(() => page.evaluate(() => {
      const root = (window as any).__MODELER_STORE__.tree;
      return [root?.kind, root?.children?.[0]?.kind];
    }), { timeout: 20_000 }).toEqual(['translate', 'rotate']);
  });

  test('recovers a tube as an evidence-validated subtract tree', async ({ page }) => {
    await enterModeler(page);
    await importAndSelect(page, tubeSTL(8, 3, 10));
    await page.getByRole('button', { name: 'Find best primitive' }).click();
    const replace = page.getByRole('button', { name: 'Replace with recovered CSG' });
    await expect(replace).toBeVisible({ timeout: PRECONDITION_TIMEOUT });
    await replace.click();
    await expect.poll(() => page.evaluate(() => (window as any).__MODELER_STORE__.tree?.kind), { timeout: 20_000 }).toBe('subtract');
    await page.waitForFunction(() => !(window as any).__MODELER_STORE__?.evaluating, null, { timeout: PRECONDITION_TIMEOUT });
    expect(await page.evaluate(() => (window as any).__MODELER_STORE__.error)).toBeFalsy();
  });

  /**
   * The fallback the issue asks about: a shape that is not one primitive must
   * say so, in millimetres, and leave the mesh alone.
   */
  test('refuses a shape no primitive matches, and keeps the mesh', async ({ page }) => {
    await enterModeler(page);
    // Two spheres far apart: nothing in the palette is that shape.
    const a = sphereSTL(8, 2);
    const shift = (buf: Buffer, dx: number) => {
      const out = Buffer.from(buf);
      const count = out.readUInt32LE(80);
      for (let t = 0; t < count; t++) {
        const base = 84 + t * 50 + 12;
        for (let v = 0; v < 3; v++) out.writeFloatLE(out.readFloatLE(base + v * 12) + dx, base + v * 12);
      }
      return out;
    };
    const left = shift(a, -20), right = shift(a, 20);
    const merged = Buffer.concat([left, right.subarray(84)]);
    merged.writeUInt32LE(left.readUInt32LE(80) * 2, 80);

    await importAndSelect(page, merged);
    await page.locator('button:has-text("Find best primitive")').click();

    await expect(page.locator('text=/No single primitive matches/')).toBeVisible({ timeout: PRECONDITION_TIMEOUT });
    await expect(page.locator('button:has-text("Replace with")')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).__MODELER_STORE__.tree.kind)).toBe('mesh');
  });
});
