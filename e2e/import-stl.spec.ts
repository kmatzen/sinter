import { test, expect, type Page } from '@playwright/test';

/**
 * STL import, end to end (#87).
 *
 * The unit tests cover the parser and the field; the parity suite covers the
 * two evaluators agreeing. What none of them can show is that a file picked in
 * the browser becomes geometry on screen — the path runs through the file
 * input, the store, the worker's bake, codegen's atlas, and the texture upload,
 * and a break anywhere in it leaves an empty viewport rather than an error.
 */

const PRECONDITION_TIMEOUT = 90_000;

/** A closed 30 x 20 x 16 mm box as a binary STL. */
function boxSTL(): Buffer {
  const hx = 15, hy = 10, hz = 8;
  const v: [number, number, number][] = [
    [-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
    [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz],
  ];
  const faces: [number, number, number][] = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2],
    [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ];
  const buf = Buffer.alloc(84 + faces.length * 50);
  buf.writeUInt32LE(faces.length, 80);
  let off = 84;
  for (const f of faces) {
    off += 12; // facet normal, left zero — the reader recomputes nothing from it
    for (const idx of f) {
      buf.writeFloatLE(v[idx][0], off);
      buf.writeFloatLE(v[idx][1], off + 4);
      buf.writeFloatLE(v[idx][2], off + 8);
      off += 12;
    }
    off += 2;
  }
  return buf;
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

async function importBox(page: Page) {
  await page.locator('[title="Import STL"]').first().click();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'part.stl', mimeType: 'model/stl', buffer: boxSTL(),
  });
  await page.getByRole('button', { name: 'Import approximately' }).click();
}

test.describe('STL import', () => {
  test.slow();

  test('turns a file into an evaluated node in the tree', async ({ page }) => {
    await enterModeler(page);
    await importBox(page);

    // The node lands in the tree...
    await expect(page.locator('text=Imported Mesh').first()).toBeVisible({ timeout: 20_000 });
    // ...carrying both the geometry and the file it came from.
    const stored = await page.evaluate(() => {
      const t = (window as any).__MODELER_STORE__.tree;
      return { kind: t?.kind, name: t?.data?.meshName, bytes: t?.data?.meshPositions?.length ?? 0 };
    });
    expect(stored.kind).toBe('mesh');
    expect(stored.name).toBe('part.stl');
    expect(stored.bytes).toBeGreaterThan(100);

    // And the worker evaluates it: an SDF field, with the box's bounds.
    await page.waitForFunction(
      () => !!(window as any).__MODELER_STORE__?.sdfDisplay && !(window as any).__MODELER_STORE__?.evaluating,
      null,
      { timeout: PRECONDITION_TIMEOUT },
    );

    const bounds = await page.evaluate(() => {
      const d = (window as any).__MODELER_STORE__.sdfDisplay;
      return { min: d.bbMin as number[], max: d.bbMax as number[] };
    });

    // Not an equality. The bake pads around the mesh, and `verifiedBounds`
    // widens further because the interval enclosure for a baked field is
    // sqrt(3)-Lipschitz rather than 1-Lipschitz — measured 41.7 x 34.8 x 27.7
    // for this 30 x 20 x 16 box. The claim is that the imported box is in
    // there and the field neither collapsed to nothing nor blew up to a
    // default scene box; both of those render as an empty viewport.
    for (const [axis, size] of [[0, 30], [1, 20], [2, 16]] as const) {
      const span = bounds.max[axis] - bounds.min[axis];
      expect(span).toBeGreaterThan(size);
      expect(span).toBeLessThan(size * 3);
    }
  });

  /**
   * The point of layer 1 in the issue: an imported mesh has to be usable as an
   * operand, not just viewable. If it only rendered, it would be a picture
   * rather than geometry.
   */
  test('imports into a boolean and keeps evaluating', async ({ page }) => {
    await enterModeler(page);

    // Start with a box so the import lands in a union alongside it.
    await page.locator('[aria-label="Add Box"]').first().click();
    await page.waitForFunction(
      () => !!(window as any).__MODELER_STORE__?.sdfDisplay,
      null,
      { timeout: PRECONDITION_TIMEOUT },
    );
    await importBox(page);

    await page.waitForFunction(
      () => {
        const s = (window as any).__MODELER_STORE__;
        if (!s?.sdfDisplay || s.evaluating) return false;
        const count = (n: any): number => 1 + (n.children ?? []).reduce((a: number, c: any) => a + count(c), 0);
        return s.tree && count(s.tree) >= 3;
      },
      null,
      { timeout: PRECONDITION_TIMEOUT },
    );

    expect(await page.evaluate(() => (window as any).__MODELER_STORE__.error)).toBeFalsy();
  });

  test('refuses a file that is not an STL, with a reason', async ({ page }) => {
    await enterModeler(page);
    await page.locator('[title="Import STL"]').first().click();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.stl', mimeType: 'model/stl', buffer: Buffer.from('this is not a mesh'),
    });

    await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 15_000 });
    // And the dialog stays open rather than dropping a broken node in the tree.
    await expect(page.locator('text=Import STL').first()).toBeVisible();
  });
});
