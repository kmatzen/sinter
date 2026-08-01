import { test, expect, type Page } from '@playwright/test';

/**
 * Golden-image tests for the viewport (#84).
 *
 * The existing suites all check *values*. `sdf-parity` diffs the emitted GLSL's
 * distance field against the TypeScript evaluator, `properties`/`invariants`
 * check algebraic laws, `dualContour` checks meshing. None of them can see a
 * regression in something that never becomes a distance: the normal estimate,
 * the lighting, the `hasWarn` highlight, the outline pass. Those only exist as
 * pixels, so a pixel is what tests them.
 *
 * ## Why this is not brittle
 *
 * #52's objection to golden images was that they vary across GPUs and driver
 * versions. That is true of *whatever GPU happens to be present*, so this suite
 * does not use one. The `golden` project in playwright.config.ts pins rendering
 * to SwiftShader — Chromium's software rasteriser, shipped inside the pinned
 * Playwright browser build — on every machine, so a developer's Mac and the CI
 * runner execute the same rasteriser rather than two different vendors'
 * drivers. What remains is arithmetic differences between CPU architectures,
 * which the per-pixel threshold below absorbs.
 *
 * ## What the reference images mean
 *
 * They are a change detector, not a proof: they say the viewport renders what
 * it rendered when the image was accepted. That is precisely the guarantee the
 * shader work in #89 needs — items 4-6 there rewrite normals, step size and the
 * hit threshold, and "did the image change?" is otherwise a human judgement
 * made once per change.
 *
 * When a change is *meant* to alter the image, regenerate with
 * `npx playwright test --project=golden --update-snapshots` and review the diff
 * as part of the change. Accepting a new image without looking at it defeats
 * the entire suite.
 */

const node = (kind: string, params: Record<string, number>, children: unknown[] = []) => ({
  id: `${kind}-${Object.keys(params).join('-')}-${children.length}`,
  kind,
  label: kind,
  params,
  children,
  enabled: true,
});

/**
 * Scenes, each chosen for a shading path rather than for looking interesting.
 *
 * `camera` is a fixed elevation/azimuth in degrees. Distance is derived from
 * the evaluated bounding box so a scene can be resized without re-framing it.
 */
const SCENES: { name: string; tree: unknown; camera: { el: number; az: number }; why: string }[] = [
  {
    name: 'sphere',
    why: 'Smooth curvature everywhere: the purest test of calcNormal and the diffuse/specular terms.',
    tree: node('sphere', { radius: 30 }),
    camera: { el: 20, az: 35 },
  },
  {
    name: 'box-minus-sphere',
    why: 'A max()-based boolean puts a hard crease through the normal estimate, where central differences are least well behaved.',
    tree: node('subtract', { smooth: 0 }, [
      node('box', { width: 60, height: 60, depth: 60 }),
      node('translate', { x: 20, y: 20, z: 20 }, [node('sphere', { radius: 28 })]),
    ]),
    camera: { el: 25, az: 40 },
  },
  {
    name: 'smooth-union',
    why: 'The smooth-min blend region is a shallow gradient the marcher crosses slowly — sensitive to step size and hit threshold together.',
    tree: node('union', { smooth: 12 }, [
      node('box', { width: 50, height: 20, depth: 50 }),
      node('translate', { x: 0, y: 22, z: 0 }, [node('sphere', { radius: 20 })]),
    ]),
    camera: { el: 18, az: 30 },
  },
  {
    name: 'linear-pattern',
    why: 'Repeated geometry with silhouette edges between copies: what the outline pass and any bbox early-out change first.',
    tree: node('linearPattern', { axisX: 1, axisY: 0, axisZ: 0, count: 5, spacing: 18 }, [
      node('translate', { x: -36, y: 0, z: 0 }, [node('cylinder', { radius: 6, height: 40 })]),
    ]),
    camera: { el: 22, az: 25 },
  },
  {
    name: 'thin-shell',
    why: 'A thin wall is where an over-relaxed march overshoots and a hit threshold keyed to the wrong quantity punches holes.',
    tree: node('shell', { thickness: 2 }, [node('box', { width: 60, height: 40, depth: 60 })]),
    camera: { el: 30, az: 45 },
  },
];

/** See marcher-grazing.spec.ts: SwiftShader on a shared runner is slow to start. */
const PRECONDITION_TIMEOUT = 90_000;

/**
 * Render size. Small on purpose — software rendering a sphere tracer is the
 * expensive part of this suite, and a change to normals or lighting shows up in
 * every pixel rather than in a few, so resolution buys nothing here.
 */
const SIZE = 192;

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
 * Set the tree, frame it from a fixed angle, render one frame, and return the
 * canvas as a PNG.
 *
 * Deliberately drives `sdfMesh.update()` and `outlinePass.render()` directly
 * rather than waiting on the animation loop: the frame under test is then a
 * single known render rather than whichever one the scheduler happened to
 * produce. That property has to survive #89's move to on-demand rendering,
 * which is part of what this suite is for.
 */
async function renderScene(page: Page, tree: unknown, camera: { el: number; az: number }): Promise<Buffer> {
  await page.evaluate((t) => (window as any).__MODELER_STORE__.setTree(t), tree);
  await page.waitForFunction(
    () => !!(window as any).__MODELER_STORE__?.sdfDisplay && !(window as any).__MODELER_STORE__?.evaluating,
    null,
    { timeout: PRECONDITION_TIMEOUT },
  );

  const dataUrl = await page.evaluate(
    async ({ cam, size }) => {
      const eng = (window as any).__ENGINE_REF__;
      const disp = (window as any).__MODELER_STORE__.sdfDisplay;
      const [minX, minY, minZ] = disp.bbMin as number[];
      const [maxX, maxY, maxZ] = disp.bbMax as number[];
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
      const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
      const dist = (Math.sqrt(dx * dx + dy * dy + dz * dz) / 2) * 2.2;

      // The gizmo follows the selection and the grid follows the camera; both
      // would put non-deterministic pixels in a reference image.
      eng.gizmo.setVisible(false);
      eng.renderer.setPixelRatio(1);
      eng.renderer.setSize(size, size);
      eng.outlinePass.resize(size, size);
      eng.camera.aspect = 1;
      eng.camera.updateProjectionMatrix();

      const er = (cam.el * Math.PI) / 180, ar = (cam.az * Math.PI) / 180;
      eng.camera.position.set(
        cx + dist * Math.cos(er) * Math.cos(ar),
        cy + dist * Math.sin(er),
        cz + dist * Math.cos(er) * Math.sin(ar),
      );
      eng.camera.lookAt(cx, cy, cz);
      eng.camera.updateMatrixWorld();
      eng.sdfMesh.update();
      eng.outlinePass.render();

      // Copied through a 2D canvas so the read is independent of whether the
      // WebGL context preserves its drawing buffer — #89 item 9 proposes
      // turning `preserveDrawingBuffer` off, and this suite must not be what
      // stops that.
      const probe = document.createElement('canvas');
      probe.width = size;
      probe.height = size;
      const ctx = probe.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(eng.renderer.domElement, 0, 0, size, size);
      return probe.toDataURL('image/png');
    },
    { cam: camera, size: SIZE },
  );

  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

test.describe('Viewport golden images', () => {
  // Software-rendering a sphere tracer five times over.
  test.slow();

  test('renders the reference scenes unchanged', async ({ page }) => {
    await enterModeler(page);

    for (const scene of SCENES) {
      const png = await renderScene(page, scene.tree, scene.camera);
      // Per-pixel `threshold` absorbs the last-bit arithmetic differences
      // between CPU architectures running the same rasteriser; the ratio cap
      // is what actually holds the line, and 1% of a 192x192 frame is 368
      // pixels — far below any real shading change, which moves the whole
      // silhouette or the whole surface.
      expect(png, scene.why).toMatchSnapshot(`${scene.name}.png`, {
        threshold: 0.08,
        maxDiffPixelRatio: 0.004,
      });
    }
  });

  /**
   * The highlight that marks a subtree the evaluator flagged. It is drawn by a
   * separate `sdfWarn` function compiled into the fragment shader, so it is
   * invisible to every value-level test — a regression here would ship.
   */
  test('renders the warn highlight unchanged', async ({ page }) => {
    await enterModeler(page);

    // A boolean missing its second operand is what sets `warn`. It has to be
    // nested rather than the root: codegen skips the highlight entirely when
    // the whole shape is incomplete, since there would be nothing to contrast
    // the highlight against.
    const incomplete = node('union', { smooth: 0 }, [
      node('sphere', { radius: 22 }),
      node('subtract', { smooth: 0 }, [
        node('translate', { x: 26, y: 0, z: 0 }, [node('box', { width: 30, height: 30, depth: 30 })]),
      ]),
    ]);
    const png = await renderScene(page, incomplete, { el: 20, az: 35 });
    expect(
      await page.evaluate(() => (window as any).__MODELER_STORE__?.sdfDisplay?.hasWarn),
      'the scene must actually be flagged, or this asserts on an ordinary render',
    ).toBe(true);
    expect(png).toMatchSnapshot('warn-highlight.png', {
      threshold: 0.08,
      maxDiffPixelRatio: 0.004,
    });
  });
});
