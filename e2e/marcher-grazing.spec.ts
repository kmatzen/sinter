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
  { el: 0, az: 0 }, { el: 0, az: 2 }, { el: 0, az: 8 },
  { el: 5, az: 0 }, { el: 5, az: 16 },
  { el: 10, az: 8 }, { el: 10, az: 16 },
  { el: 20, az: 0 }, { el: 20, az: 16 }, { el: 20, az: 90 },
  { el: 45, az: 16 },
];

/**
 * Coverage floor as a percentage of the probe frame.  Every measured passing
 * angle sits at 6% or above (11-27% for the cases here); a starved marcher
 * collapses to 0.00%.  5% fails on a real dropout without tracking
 * GPU-to-GPU shading differences.
 */
const MIN_COVERAGE_PCT = 5;

async function enterModeler(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const accept = page.locator('button:has-text("Accept")');
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) await accept.click();
  const startBtn = page.locator('button:has-text("Start Modeling")').first();
  if (await startBtn.isVisible({ timeout: 8000 }).catch(() => false)) await startBtn.click();
  if (await accept.isVisible({ timeout: 1500 }).catch(() => false)) await accept.click();
  const continueBtn = page.locator('button:has-text("Continue without account")');
  if (await continueBtn.isVisible({ timeout: 8000 }).catch(() => false)) await continueBtn.click();
  await expect(page.locator('[data-testid="modeler-app"]')).toBeVisible({ timeout: 20000 });
}

/**
 * Render `tree` from each of `ANGLES` through the production SdfMesh shader and
 * return the percentage of the frame covered by lit (non-background) pixels.
 */
async function coverageByAngle(page: import('@playwright/test').Page, tree: unknown) {
  await page.evaluate((t) => (window as any).__MODELER_STORE__.setTree(t), tree);
  await page.waitForFunction(
    () => !!(window as any).__MODELER_STORE__?.sdfDisplay && !!(window as any).__ENGINE_REF__,
    { timeout: 20000 },
  );

  return page.evaluate(async (angles) => {
    const eng = (window as any).__ENGINE_REF__;
    const disp = (window as any).__MODELER_STORE__.sdfDisplay;
    const [minX, minY, minZ] = disp.bbMin as number[];
    const [maxX, maxY, maxZ] = disp.bbMax as number[];
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    const dist = (Math.sqrt(dx * dx + dy * dy + dz * dz) / 2) * 2.2;

    const SIZE = 320;
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
  // Each test enters the modeler, meshes a project, then renders 11 framed
  // views.  The ratio-120 case measures ~27s on an idle machine and ~60s
  // sharing the box with the rest of the suite, well over the 30s default.
  test.describe.configure({ timeout: 180_000 });

  test('renders the issue #76 project at every grazing angle', async ({ page }) => {
    const shaderErrors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /shader|glsl|webgl|program/i.test(m.text())) {
        shaderErrors.push(m.text().slice(0, 500));
      }
    });

    await enterModeler(page);
    const measurements = await coverageByAngle(page, ISSUE_76_PROJECT);

    expect(shaderErrors, `shader failed to compile: ${shaderErrors.join(' | ')}`).toEqual([]);
    expectNoDropout(measurements, 'issue #76 project');
  });

  test('renders a ratio-120 conditioned field at every grazing angle', async ({ page }) => {
    await enterModeler(page);
    const measurements = await coverageByAngle(page, conditioningCase(120));

    // The discriminating case: a fixed-budget 256-step tracer measures 0.00%
    // here at some of these angles.
    expectNoDropout(measurements, 'ratio-120 conditioned field');
  });
});
