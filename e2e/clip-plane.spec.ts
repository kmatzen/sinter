import { test, expect } from '@playwright/test';

/**
 * The section plane must show the same solid that cutting the model would.
 *
 * The clip plane is a viewport affordance, not a modelling operation, so there
 * is an independent way to state what it should draw: intersecting the tree
 * with a half-space of real geometry produces exactly the solid the plane is
 * meant to reveal. Rendering both and comparing silhouettes turns "does the
 * section view look right" into a measurement that needs no reference image,
 * and so survives GPU and driver differences that sank golden images in #52 —
 * both sides are rendered by the same marcher on the same machine, and only
 * their agreement is asserted.
 *
 * The regression this pins down: with the plane enabled, orbiting to view the
 * *kept* side edge-on or from behind made the model thin out and then vanish
 * entirely, returning as you orbited back. Measured on the project from the
 * report, looking up at the kept half from 60 degrees below the plane, the
 * viewport drew 0.00% of the frame where the cut solid covers 24.97% of it.
 *
 * Two separate faults produced that. The marcher tested each sample against
 * the plane and, on the cut-away side, jumped to it by dividing by the ray's
 * component along the clip axis — unguarded, so grazing views (that component
 * approaching zero) produced infinities, and a camera on the plane produced
 * NaN. The NaN comparison fell through to a fallback that advanced by the hit
 * threshold, roughly half a pixel, with no test for leaving the bounding box,
 * so those rays burned all 1024 iterations creeping and then discarded.
 * Replacing that with a closed-form crossing then exposed the second fault:
 * ending the march at the crossing discards the pending correction step of the
 * over-relaxed sphere tracer, which routinely overshoots a surface before
 * backing onto it. A surface just short of the plane — the usual case, since
 * the plane gets placed against the feature being inspected — was lost.
 */

const node = (kind: string, params: Record<string, number>, children: unknown[] = []) => ({
  id: `${kind}-${Math.random().toString(36).slice(2)}`,
  kind,
  label: kind,
  params,
  children,
  enabled: true,
});

/**
 * The reported project: a ring of pocketed blocks, patterned twice. Chosen over
 * a synthetic shape because its field comes from nested patterns, where the
 * distances the marcher gets back are far from exact and the over-relaxed step
 * is doing real work.
 */
const PROJECT = () => node('linearPattern', { axisX: 1, axisY: 0, axisZ: 0, count: 3, spacing: 20 }, [
  node('circularPattern', { axisX: 0, axisY: 1, axisZ: 0, count: 6 }, [
    node('translate', { x: -97.11877792894524, y: 0, z: 0 }, [
      node('subtract', { smooth: 10 }, [
        node('box', { width: 50, height: 30, depth: 50 }),
        node('sphere', { radius: 20 }),
      ]),
    ]),
  ]),
]);

/**
 * The same cut, as geometry: keep one side of y = 0 by intersecting with a slab
 * that reaches well past the model on every other axis. This is the ground
 * truth — ordinary CSG the marcher has no special path for.
 */
const CUT_AS_GEOMETRY = (keepBelow: boolean) => node('intersect', { smooth: 0 }, [
  PROJECT(),
  node('translate', { x: 0, y: keepBelow ? -500 : 500, z: 0 }, [
    node('box', { width: 4000, height: 1000, depth: 4000 }),
  ]),
]);

/**
 * Elevations relative to the clip plane, in degrees. Negative looks up at the
 * kept half from below, which is where the dropout was total; the small
 * magnitudes graze the plane, which is where the divide degenerates.
 */
const ELEVATIONS = [-60, -40, -20, -6, -2, 0, 2, 6, 20, 40, 60];

/**
 * How far the section view may disagree with the cut solid, as a fraction of
 * the ground-truth coverage, with an absolute floor for the near-edge-on views
 * where coverage is small.
 *
 * The two renders are not pixel-identical by construction: the section view
 * paints the cross-section in its own colour and shades the rest from a
 * different first-hit distance, so silhouette edges land differently. Measured
 * Hardware rendering agrees within a fraction of a point. SwiftShader expands
 * the ordinary-CSG reference silhouette by roughly four points at grazing
 * angles, consistently on both clip directions; that is a renderer-dependent
 * difference between the two distance fields rather than missing geometry.
 * The original bug still shows up as a 6.5 to 25 point gap, so the absolute
 * floor remains below the smallest observed regression while accommodating
 * the software renderer used in CI.
 */
const REL_TOLERANCE = 0.12;
const ABS_TOLERANCE_PCT = 4.5;

/** Guards against a blank render passing the comparison vacuously. */
const MIN_TRUTH_COVERAGE_PCT = 3;

/**
 * How long to wait for the engine and the first evaluated field. Deliberately
 * far above what a workstation needs: CI shares two cores between Playwright
 * workers and renders through SwiftShader. Must be passed on each wait, since
 * the project's `actionTimeout` would otherwise clamp it.
 */
const PRECONDITION_TIMEOUT = 90_000;

async function enterModeler(page: import('@playwright/test').Page) {
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

/**
 * Clearing the tree first matters: `sdfDisplay` holds the *previous* field
 * until the worker publishes the new one, so waiting for it to be truthy would
 * return immediately and measure the tree we just replaced.
 */
async function setTree(page: import('@playwright/test').Page, tree: unknown) {
  await page.evaluate(() => (window as any).__MODELER_STORE__.setTree(null));
  await page.evaluate((t) => (window as any).__MODELER_STORE__.setTree(t), tree);
  await page.waitForFunction(() => !!(window as any).__MODELER_STORE__?.sdfDisplay, {
    timeout: PRECONDITION_TIMEOUT,
  });
}

/** Framing taken once, from the uncut model, so both renders share a camera. */
async function framing(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const d = (window as any).__MODELER_STORE__.sdfDisplay;
    const [ax, ay, az] = d.bbMin as number[];
    const [bx, by, bz] = d.bbMax as number[];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    return {
      cx: (ax + bx) / 2, cy: (ay + by) / 2, cz: (az + bz) / 2,
      dist: (Math.sqrt(dx * dx + dy * dy + dz * dz) / 2) * 1.6,
    };
  });
}

/** Percentage of the frame the marcher shaded, at each elevation. */
async function coverage(
  page: import('@playwright/test').Page,
  view: { cx: number; cy: number; cz: number; dist: number },
  els: number[],
) {
  return page.evaluate(async ({ view, els }) => {
    const eng = (window as any).__ENGINE_REF__;

    // Sized for CI rather than for looks. Coverage is a ratio, so a small frame
    // measures the same quantity, and 16,384 pixels still puts 0.1% at 16 of
    // them — finer than the tolerance needs.
    const SIZE = 128;
    const savedPos = eng.camera.position.clone();
    const savedTarget = eng.controls.target.clone();
    const savedAspect = eng.camera.aspect;
    const savedW = eng.renderer.domElement.width;
    const savedH = eng.renderer.domElement.height;

    eng.gizmo.setVisible(false);
    eng.renderer.setSize(SIZE, SIZE);
    eng.outlinePass.resize(SIZE, SIZE);
    eng.camera.aspect = 1;
    eng.camera.updateProjectionMatrix();

    const probe = document.createElement('canvas');
    probe.width = SIZE;
    probe.height = SIZE;
    const ctx = probe.getContext('2d', { willReadFrequently: true })!;

    const out: number[] = [];
    for (const el of els) {
      const er = (el * Math.PI) / 180, ar = (25 * Math.PI) / 180;
      eng.camera.position.set(
        view.cx + view.dist * Math.cos(er) * Math.cos(ar),
        view.cy + view.dist * Math.sin(er),
        view.cz + view.dist * Math.cos(er) * Math.sin(ar),
      );
      eng.camera.lookAt(view.cx, view.cy, view.cz);
      eng.camera.updateMatrixWorld();
      eng.sdfMesh.update();
      eng.outlinePass.render();

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(eng.renderer.domElement, 0, 0, SIZE, SIZE);
      const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

      // The viewport clears transparent, so alpha is the silhouette mask.
      // Unlike a luminance cut it does not drop faces that shade nearly black,
      // which the undersides here do.
      let lit = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 10) lit++;
      out.push((100 * lit) / (SIZE * SIZE));
    }

    eng.camera.position.copy(savedPos);
    eng.controls.target.copy(savedTarget);
    eng.camera.aspect = savedAspect;
    eng.camera.updateProjectionMatrix();
    eng.renderer.setSize(savedW, savedH);
    eng.outlinePass.resize(savedW, savedH);
    eng.controls.update();
    eng.gizmo.setVisible(true);
    return out;
  }, { view, els });
}

test.describe('viewport section plane', () => {
  // Three meshed trees and 44 framed renders. Seconds on a workstation, but
  // minutes on a two-core CI runner under software rendering.
  test.describe.configure({ timeout: 240_000 });

  // The project pins `actionTimeout: 15000`, which silently clamps the
  // `waitForFunction` calls above no matter what timeout they pass.
  test.use({ actionTimeout: 0 });

  test('shows the same solid as cutting the model, from every angle', async ({ page }) => {
    const shaderErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /shader|glsl|webgl|program/i.test(m.text())) {
        shaderErrors.push(m.text().slice(0, 500));
      }
    });

    await enterModeler(page);
    await page.waitForFunction(() => typeof (window as any).__ENGINE_REF__ !== 'undefined', {
      timeout: PRECONDITION_TIMEOUT,
    });

    await setTree(page, PROJECT());
    const view = await framing(page);

    // Driven through the UI, because the section plane is the user-facing
    // affordance and its default — the y plane at 0, keeping the lower half —
    // is the state the report describes.
    await page.locator('button[aria-label="Clipping plane"]').click();
    await expect(page.locator('input[aria-label="Clip plane position"]')).toBeVisible();
    const keepBelow = await coverage(page, view, ELEVATIONS);

    // The mirrored setting, which is what exercises the opposite sign: the
    // crossing that bounded the far end of the ray now truncates its start,
    // and the cross-section is seen from the other side.
    await page.locator('button[aria-label="Clip negative Y"]').click();
    const keepAbove = await coverage(page, view, ELEVATIONS);

    await page.locator('button[aria-label="Clipping plane"]').click();
    await setTree(page, CUT_AS_GEOMETRY(true));
    const truthBelow = await coverage(page, view, ELEVATIONS);

    await setTree(page, CUT_AS_GEOMETRY(false));
    const truthAbove = await coverage(page, view, ELEVATIONS);

    for (const [what, sectioned, truth] of [
      ['keeping the lower half', keepBelow, truthBelow],
      ['keeping the upper half', keepAbove, truthAbove],
    ] as const) {
      const report = ELEVATIONS.map(
        (el, i) => `  elev ${String(el).padStart(3)}: section ${sectioned[i].toFixed(2)}% vs cut solid ${truth[i].toFixed(2)}%`,
      ).join('\n');

      for (let i = 0; i < ELEVATIONS.length; i++) {
        expect(
          truth[i],
          `the cut solid barely rendered at elev ${ELEVATIONS[i]} (${what}), so there is ` +
            `nothing to compare against:\n${report}`,
        ).toBeGreaterThan(MIN_TRUTH_COVERAGE_PCT);

        const allowed = Math.max(ABS_TOLERANCE_PCT, truth[i] * REL_TOLERANCE);
        expect(
          Math.abs(sectioned[i] - truth[i]),
          `the section plane and the equivalent cut solid disagree at elev ${ELEVATIONS[i]} ` +
            `(${what}), beyond the ${allowed.toFixed(2)} point tolerance. Geometry on the kept ` +
            `side of the plane is being dropped by the marcher:\n${report}`,
        ).toBeLessThanOrEqual(allowed);
      }
    }

    expect(shaderErrors, `shader failed to compile: ${shaderErrors.join(' | ')}`).toEqual([]);
  });
});
