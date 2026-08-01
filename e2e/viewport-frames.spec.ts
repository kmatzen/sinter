import { test, expect, type Page } from '@playwright/test';

/**
 * On-demand rendering: the viewport must go quiet, and must not stay quiet.
 *
 * The engine used to call `outlinePass.render()` on every animation frame
 * forever, so a static model with an idle camera marched the SDF at 60fps
 * indefinitely. Rendering only when something changed removes that, and
 * introduces the one failure mode that is worse than the cost it saves: a
 * missed invalidation leaves a stale viewport, which looks like corrupted
 * geometry rather than like a performance bug.
 *
 * So this suite is not really about performance. It is the enumeration of
 * invalidation sources, executed. `ThreeEngine.subscribe()` lists them; each
 * test here drives one and asserts a frame came out. The idle test is the only
 * one that checks the saving, and it is the least important of the six.
 */

const PRECONDITION_TIMEOUT = 90_000;

const node = (kind: string, params: Record<string, number>, children: unknown[] = []) => ({
  id: `${kind}-fixed`, kind, label: kind, params, children, enabled: true,
});

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
  await page.waitForFunction(() => typeof (window as any).__ENGINE_REF__ !== 'undefined', null, {
    timeout: PRECONDITION_TIMEOUT,
  });
}

/**
 * Put a model up, then start counting frames through the engine's own
 * post-frame hook — the same one the dimension labels use, so a frame that
 * this counter misses is a frame the labels would have missed too.
 */
async function armFrameCounter(page: Page) {
  await page.evaluate(
    (tree) => (window as any).__MODELER_STORE__.setTree(tree),
    node('box', { width: 40, height: 40, depth: 40 }),
  );
  await page.waitForFunction(
    () => !!(window as any).__MODELER_STORE__?.sdfDisplay && !(window as any).__MODELER_STORE__?.evaluating,
    null,
    { timeout: PRECONDITION_TIMEOUT },
  );
  await page.evaluate(() => {
    const w = window as any;
    w.__FRAMES__ = 0;
    w.__OFF_FRAMES__?.();
    w.__OFF_FRAMES__ = w.__ENGINE_REF__.onFrame(() => { w.__FRAMES__++; });
  });
}

const frames = (page: Page) => page.evaluate(() => (window as any).__FRAMES__ as number);

/** Let the engine settle: nothing pending, nothing in the damping tail. */
async function settle(page: Page) {
  // Comfortably past ThreeEngine.SETTLE_MS, which itself schedules one more
  // frame when it restores full resolution.
  await page.waitForTimeout(700);
}

/** Drive `trigger`, then require at least one frame to come out of it. */
async function expectFrameAfter(page: Page, label: string, trigger: () => Promise<void>) {
  await settle(page);
  const before = await frames(page);
  await trigger();
  await expect
    .poll(() => frames(page), { message: `no frame drawn after ${label}`, timeout: 5000 })
    .toBeGreaterThan(before);
}

test.describe('Viewport renders on demand', () => {
  test.slow();

  test('stops drawing when nothing changes', async ({ page }) => {
    await enterModeler(page);
    await armFrameCounter(page);
    await settle(page);

    const before = await frames(page);
    await page.waitForTimeout(1000);
    const after = await frames(page);

    // A second of wall-clock is ~60 frames of the old loop. Allowing a couple
    // covers a late store notification or the settle timer's restore frame
    // without letting a continuously-rendering engine through.
    expect(after - before).toBeLessThanOrEqual(2);
  });

  test('draws after the camera moves', async ({ page }) => {
    await enterModeler(page);
    await armFrameCounter(page);
    await expectFrameAfter(page, 'a camera move', () =>
      page.evaluate(() => {
        const eng = (window as any).__ENGINE_REF__;
        eng.camera.position.x += 25;
        eng.controls.update();
      }),
    );
  });

  test('draws after the model changes', async ({ page }) => {
    await enterModeler(page);
    await armFrameCounter(page);
    await expectFrameAfter(page, 'a tree edit', () =>
      page.evaluate(() => {
        (window as any).__MODELER_STORE__.setTree({
          id: 'sphere-fixed', kind: 'sphere', label: 'sphere',
          params: { radius: 25 }, children: [], enabled: true,
        });
      }),
    );
  });

  /**
   * Through the UI rather than the store, because the clip plane is the
   * viewport store's subscription and driving it by hand would test the
   * subscription against itself.
   */
  test('draws after a viewport setting changes', async ({ page }) => {
    await enterModeler(page);
    await armFrameCounter(page);
    await expectFrameAfter(page, 'toggling the clip plane', async () => {
      await page.locator('[title*="Clip"], [title*="clip"]').first().click();
    });
  });

  test('draws after the window resizes', async ({ page }) => {
    await enterModeler(page);
    await armFrameCounter(page);
    await expectFrameAfter(page, 'a resize', () => page.setViewportSize({ width: 900, height: 700 }));
  });

  /**
   * Selection changes the outline and the gizmo, and arrives on the modeler
   * store like a tree edit does — but through a different action, and it is
   * the one a user hits most often without touching the geometry.
   */
  test('draws after the selection changes', async ({ page }) => {
    await enterModeler(page);
    await armFrameCounter(page);
    await expectFrameAfter(page, 'a selection change', () =>
      page.evaluate(() => {
        const s = (window as any).__MODELER_STORE__;
        s.selectNode(s.tree.id);
      }),
    );
  });
});

/**
 * The scene is marched once per frame, not twice.
 *
 * `OutlinePass.render()` used to render the whole scene into a depth target
 * and then render it again to the screen, throwing the first pass's colour
 * away. The most expensive shader in the app — a sphere-trace loop plus a
 * six-evaluation normal — therefore ran twice per frame at full device-pixel
 * resolution.
 *
 * Asserted by counting draws of the SDF mesh rather than by timing. A wall
 * clock on a shared runner measures the runner; a draw count measures the
 * thing that was actually wrong, and fails deterministically if the second
 * pass comes back.
 */
test.describe('Viewport marches the SDF once per frame', () => {
  test.slow();

  test('draws the SDF mesh exactly once per rendered frame', async ({ page }) => {
    await enterModeler(page);
    await armFrameCounter(page);
    await settle(page);

    const draws = await page.evaluate(async () => {
      const eng = (window as any).__ENGINE_REF__;
      const mesh = eng.sdfMesh.mesh;
      if (!mesh) return { error: 'no sdf mesh' };
      let count = 0;
      const prev = mesh.onBeforeRender;
      mesh.onBeforeRender = function (...args: unknown[]) {
        count++;
        return (prev as any)?.apply(this, args);
      };
      const perFrame: number[] = [];
      for (let i = 0; i < 3; i++) {
        count = 0;
        eng.renderNow();
        perFrame.push(count);
      }
      mesh.onBeforeRender = prev;
      return { perFrame };
    });

    expect(draws.error).toBeUndefined();
    // The gizmo pass can add a draw when a gizmo is visible, so this is about
    // the SDF mesh specifically: one march, one frame.
    expect(draws.perFrame).toEqual([1, 1, 1]);
  });
});
