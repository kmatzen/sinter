import { test, expect } from '@playwright/test';

/**
 * Grazing-angle coverage tests for the viewport sphere tracer.
 *
 * Issue #76: a non-uniform `scale` node multiplies the child distance field by
 * `min(sx, sy, sz)` — the correct 1-Lipschitz correction — so a scaled subtree
 * under-reports distance by up to `max(scale) / min(scale)`.  A fixed-budget
 * sphere tracer then needs that many times the usual step count, and rays that
 * run out of budget hit `discard`: valid geometry silently disappears for some
 * view directions and returns as you orbit back.
 *
 * `SdfMesh.ts` marches with enhanced sphere tracing (Keinert et al. 2014),
 * which over-relaxes the step and backs off on overshoot.  The analysis on #76
 * verified that algorithm by simulating both marchers against the TypeScript
 * evaluator — but a simulation cannot see the *compiled GLSL*, which is the
 * thing that actually ships.  These tests close that gap: they drive the real
 * app, orbit to near-edge-on views of the badly-conditioned axis, and assert
 * the shader keeps filling the surface.
 *
 * Two scenarios, because they measure different things:
 *
 * 1. `#76 project` — the exact tree from the issue (ratio 12.8).  This is the
 *    regression case, but a weak discriminator: measured on real hardware both
 *    the old and new marchers largely cope here (11.3% vs 11.9% worst-angle
 *    coverage), which is why the issue's own severity note was revised down to
 *    "real but modest".  It is kept so the reported project stays covered.
 *
 * 2. `high conditioning ratio` — ratio 120, which is where the marchers
 *    genuinely separate.  Measured worst-angle coverage: the old fixed-budget
 *    tracer renders *nothing at all* (0.00%) at some grazing angles, while the
 *    over-relaxed tracer holds 12.8%.  This is the assertion that actually
 *    fails if the marcher regresses.
 *
 * The size of the improvement is deliberately not asserted — only that the
 * surface is still there.  Coverage percentages vary with GPU and ANGLE
 * backend, so the floor sits far below every measured passing value and far
 * above a dropout.
 */

const node = (kind: string, params: Record<string, number>, children: unknown[] = []) => ({
  id: `${kind}-${Math.random().toString(36).slice(2)}`,
  kind,
  label: kind,
  params,
  children,
  enabled: true,
});

/** The project from issue #76: 3x linear pattern of a scale(0.20, 2.58, 1) union. */
const ISSUE_76_PROJECT = node('linearPattern', { axisX: 1, axisY: 0, axisZ: 0, count: 3, spacing: 20 }, [
  node('translate', { x: -1.9296184514936314, y: 0, z: 0 }, [
    node('scale', { x: 0.20127571037331896, y: 2.578296191303632, z: 1 }, [
      node('union', { smooth: 0 }, [
        node('box', { width: 100, height: 30, depth: 50 }),
        node('translate', { x: -5.224608338673388, y: 0, z: 0 }, [node('sphere', { radius: 20 })]),
      ]),
    ]),
  ]),
]);

/**
 * A union squeezed by `1/ratio` in X, with the box pre-widened by `ratio` so the
 * rendered solid stays ~100mm across.  That isolates field *conditioning* — the
 * #76 mechanism — from mere thinness: the geometry is ordinary-sized, but every
 * distance the field reports is `ratio` times short.
 */
const conditioningCase = (ratio: number) =>
  node('scale', { x: 1 / ratio, y: 1, z: 1 }, [
    node('union', { smooth: 0 }, [
      node('box', { width: 100 * ratio, height: 30, depth: 50 }),
      node('translate', { x: -5 * ratio, y: 0, z: 0 }, [node('sphere', { radius: 20 })]),
    ]),
  ]);

/**
 * Near-edge-on views of the badly-conditioned X axis, where a starved marcher
 * runs out of budget.  azim 0 looks straight down +X; low elevations keep the
 * ray traversing a long near-field span before it reaches the surface.
 */
const ANGLES = [
  { el: 0, az: 0 },
  { el: 5, az: 16 },
  { el: 20, az: 0 }, { el: 20, az: 16 }, { el: 20, az: 90 },
];

/**
 * Coverage floor as a percentage of the probe frame.  Every measured passing
 * angle sits at 6% or above (11-27% for the cases here); a starved marcher
 * collapses to 0.00%.  5% fails on a real dropout without tracking
 * GPU-to-GPU shading differences.
 */
const MIN_COVERAGE_PCT = 5;

/**
 * How long to wait for the engine and the first evaluated field.
 *
 * Deliberately far above what a workstation needs. The CI runner shares two
 * cores between two Playwright workers and renders through SwiftShader, and
 * `app.spec.ts` alone occupies ~7 minutes of that machine, so bringing up a
 * WebGL context here can stall for a long time behind it. This must also be
 * passed explicitly on each wait: the project sets `actionTimeout: 15000`,
 * which otherwise clamps these waits well below the value written here.
 */
const PRECONDITION_TIMEOUT = 90_000;

async function enterModeler(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const accept = page.locator('button:has-text("Accept")');
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) await accept.click();
  // Generous waits on the way in for the same reason as PRECONDITION_TIMEOUT: on a
  // loaded CI runner a missed button here turns into a confusing failure later.
  const startBtn = page.locator('button:has-text("Start Modeling")').first();
  if (await startBtn.isVisible({ timeout: 30_000 }).catch(() => false)) await startBtn.click();
  if (await accept.isVisible({ timeout: 1500 }).catch(() => false)) await accept.click();
  const continueBtn = page.locator('button:has-text("Continue without account")');
  if (await continueBtn.isVisible({ timeout: 30_000 }).catch(() => false)) await continueBtn.click();
  await expect(page.locator('[data-testid="modeler-app"]')).toBeVisible({ timeout: PRECONDITION_TIMEOUT });
}

/**
 * Render `tree` from each of `ANGLES` through the production SdfMesh shader and
 * return the percentage of the frame covered by lit (non-background) pixels.
 */
async function coverageByAngle(page: import('@playwright/test').Page, tree: unknown) {
  // The engine only exists once a WebGL context is up. On a CI runner sharing two
  // cores between workers, under software rendering, that takes far longer than
  // any default — so wait on it separately and generously, and report which
  // precondition is missing rather than a bare timeout.
  await page.waitForFunction(() => typeof (window as any).__ENGINE_REF__ !== 'undefined', {
    timeout: PRECONDITION_TIMEOUT,
  });

  await page.evaluate((t) => (window as any).__MODELER_STORE__.setTree(t), tree);

  // Then the worker has to evaluate the tree and publish a display field.
  await page.waitForFunction(() => !!(window as any).__MODELER_STORE__?.sdfDisplay, {
    timeout: PRECONDITION_TIMEOUT,
  });

  return page.evaluate(async (angles) => {
    const eng = (window as any).__ENGINE_REF__;
    const disp = (window as any).__MODELER_STORE__.sdfDisplay;
    const [minX, minY, minZ] = disp.bbMin as number[];
    const [maxX, maxY, maxZ] = disp.bbMax as number[];
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const dist = (Math.sqrt(dx * dx + dy * dy + dz * dz) / 2) * 2.2;

    // Sized for CI, not for looks. Measured under SwiftShader, one render at this
    // worst angle costs 65ms against 346ms at 256px, and coverage is unchanged in
    // kind (26% vs 22%) because it is a ratio. 9,216 pixels still puts 1% at 92
    // pixels, far finer than the 5% floor needs.
    const SIZE = 96;
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

    const out: Array<{ el: number; az: number; pct: number }> = [];
    for (const { el, az } of angles) {
      const er = (el * Math.PI) / 180, ar = (az * Math.PI) / 180;
      eng.camera.position.set(
        cx + dist * Math.cos(er) * Math.cos(ar),
        cy + dist * Math.sin(er),
        cz + dist * Math.cos(er) * Math.sin(ar),
      );
      eng.camera.lookAt(cx, cy, cz);
      eng.camera.updateMatrixWorld();
      eng.sdfMesh.update();
      eng.outlinePass.render();

      ctx.clearRect(0, 0, SIZE, SIZE);
      ctx.drawImage(eng.renderer.domElement, 0, 0, SIZE, SIZE);
      const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

      // The viewport clears to a flat dark colour (~luminance 26); shaded faces
      // of the model read far brighter, so a luminance cut separates them.
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2] > 60) lit++;
      }
      out.push({ el, az, pct: (100 * lit) / (SIZE * SIZE) });
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
  }, ANGLES);
}

function expectNoDropout(
  measurements: Array<{ el: number; az: number; pct: number }>,
  what: string,
) {
  expect(measurements.length).toBe(ANGLES.length);
  for (const m of measurements) {
    expect(
      m.pct,
      `${what} — elev ${m.el} azim ${m.az}: only ${m.pct.toFixed(2)}% of the frame filled. ` +
        `The marcher is discarding fragments on a badly-conditioned scaled field (#76).`,
    ).toBeGreaterThan(MIN_COVERAGE_PCT);
  }
}

test.describe('viewport sphere tracer, grazing angles (#76)', () => {
  // Each test enters the modeler, meshes a project, then renders 7 framed views.
  // Comfortably seconds on a workstation, but minutes-scale on a two-core CI
  // runner under software rendering, so the 30s default is far too tight.
  test.describe.configure({ timeout: 240_000 });

  // The project pins `actionTimeout: 15000`, which silently clamps the
  // `waitForFunction` calls above no matter what timeout they pass. Lift it here
  // so the explicit PRECONDITION_TIMEOUT is what actually applies.
  test.use({ actionTimeout: 0 });

  // Both scenarios share one modeler session on purpose. Entering the modeler is
  // the expensive part on CI — app boot plus WebGL context creation under
  // SwiftShader — and doing it twice added enough load to the two-core runner to
  // push an unrelated spec past its own timeout. Loading a second tree into the
  // running editor costs a worker evaluation instead of a second boot.
  test('fills scaled thin geometry at grazing angles', async ({ page }) => {
    const shaderErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /shader|glsl|webgl|program/i.test(m.text())) {
        shaderErrors.push(m.text().slice(0, 500));
      }
    });

    await enterModeler(page);

    // The project as reported. A weak discriminator — both the old and new
    // marchers largely cope at ratio 12.8 — but it keeps the reported case
    // covered.
    expectNoDropout(await coverageByAngle(page, ISSUE_76_PROJECT), 'issue #76 project');

    // The discriminating case: a fixed-budget 256-step tracer measures 0.00%
    // here at elev 20 / azim 90.
    expectNoDropout(await coverageByAngle(page, conditioningCase(120)), 'ratio-120 conditioned field');

    expect(shaderErrors, `shader failed to compile: ${shaderErrors.join(' | ')}`).toEqual([]);
  });
});
