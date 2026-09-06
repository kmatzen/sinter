import { test, expect } from '@playwright/test';

// Helper: dismiss cookie consent banner if visible
async function dismissCookieConsent(page: any) {
  const accept = page.locator('button:has-text("Accept")');
  if (await accept.isVisible({ timeout: 1000 }).catch(() => false)) {
    await accept.click();
  }
}

// Helper: ensure we're in the modeler
// The app shows a landing page first; click "Start Modeling" to enter,
// then "Continue without account" on the login page.
async function enterModeler(page: any) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await dismissCookieConsent(page);

  const modeler = page.locator('[data-testid="modeler-app"]');
  if (await modeler.isVisible({ timeout: 2000 }).catch(() => false)) return;

  // Click through landing page
  const startBtn = page.locator('button:has-text("Start Modeling")').first();
  if (await startBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await startBtn.click();
    await dismissCookieConsent(page);
  }

  // Click "Continue without account" on the login page
  const continueBtn = page.locator('button:has-text("Continue without account")');
  if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await continueBtn.click();
  }

  await expect(modeler).toBeVisible({ timeout: 15000 });
}

// Helper: click a shape in the parts palette Shapes tab
async function addShape(page: any, name: string) {
  await page.locator('button[role="tab"]:has-text("Shapes")').click({ force: true });
  await page.locator(`[title="Add ${name}"]`).click({ force: true });
}

// Helper: click an operation in the parts palette Ops tab
async function addOp(page: any, name: string) {
  await page.locator('button[role="tab"]:has-text("Ops")').click({ force: true });
  await page.locator(`[title="Add ${name}"]`).click({ force: true });
}

// Helper: load a tree into the modeler via JS
async function loadTree(page: any, tree: any) {
  await page.evaluate((t: any) => {
    const store = (window as any).__MODELER_STORE__;
    if (store) { store.setTree(t); }
  }, tree);
}

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await dismissCookieConsent(page);
  });

  test('shows hero text', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Describe it', { timeout: 15000 });
  });

  test('shows features section', async ({ page }) => {
    await expect(page.locator('text=Design, iterate, and export')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('h3:has-text("AI-Powered Modeling")')).toBeVisible();
    await expect(page.locator('h3:has-text("Real-Time Preview")')).toBeVisible();
    await expect(page.locator('h3:has-text("Smooth Booleans")')).toBeVisible();
  });

  test('shows how it works section', async ({ page }) => {
    await expect(page.locator('text=Bring your own keys')).toBeVisible({ timeout: 15000 });
  });

  test('shows footer with copyright and TOS', async ({ page }) => {
    await expect(page.locator('text=Terms of Service')).toBeVisible();
    await expect(page.locator('footer')).toContainText('Sinter');
  });

  test('TOS modal opens and closes', async ({ page }) => {
    await page.locator('footer a:has-text("Terms of Service")').click();
    await expect(page.locator('text=Acceptance of Terms')).toBeVisible({ timeout: 5000 });
    await page.locator('.fixed .text-lg').click();
    await expect(page.locator('text=Acceptance of Terms')).not.toBeVisible();
  });

  test('permanent legal URLs use the canonical copy', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
    await expect(page.getByText(/GitHub’s.*permission is broader/)).toBeVisible();

    await page.goto('/terms', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
    await expect(page.getByText(/source is available under the non-commercial license/)).toBeVisible();
  });

  test('Start Modeling enters the modeler', async ({ page }) => {
    const btn = page.locator('button:has-text("Start Modeling")').first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click();
    await dismissCookieConsent(page);
    const continueBtn = page.locator('button:has-text("Continue without account")');
    if (await continueBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await continueBtn.click();
    }
    await expect(page.locator('[data-testid="modeler-app"]')).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Modeler: Adding primitives', () => {
  test.beforeEach(async ({ page }) => {
    await enterModeler(page);
  });

  test('shows empty state initially', async ({ page }) => {
    await expect(page.locator('text=No model yet')).toBeVisible();
  });

  test('can add a box', async ({ page }) => {
    await addShape(page, 'Box');
    await expect(page.locator(`text=50\u00d730\u00d750`)).toBeVisible();
  });

  test('can add a sphere', async ({ page }) => {
    await addShape(page, 'Sphere');
    await expect(page.locator('text=r=20')).toBeVisible();
  });

  test('can add a cylinder', async ({ page }) => {
    await addShape(page, 'Cylinder');
    await expect(page.locator('text=r=15')).toBeVisible();
  });

  test('can add a torus', async ({ page }) => {
    await addShape(page, 'Torus');
    await expect(page.locator('text=R=20')).toBeVisible();
  });

  test('can add a cone', async ({ page }) => {
    await addShape(page, 'Cone');
    await expect(page.locator('text=r=15')).toBeVisible();
  });

  test('can add a capsule', async ({ page }) => {
    await addShape(page, 'Capsule');
    await expect(page.locator('text=r=10')).toBeVisible();
  });

  test('can add an ellipsoid', async ({ page }) => {
    await addShape(page, 'Ellipsoid');
    await expect(page.locator(`text=30\u00d720\u00d740`)).toBeVisible();
  });

  test('adding two primitives creates a union', async ({ page }) => {
    await addShape(page, 'Box');
    await addShape(page, 'Sphere');
    await expect(page.locator('text=sharp')).toBeVisible();
  });
});

test.describe('Modeler: Node operations', () => {
  test.beforeEach(async ({ page }) => {
    await enterModeler(page);
  });

  test('selecting a node shows property panel', async ({ page }) => {
    await addShape(page, 'Box');
    await page.locator(`text=50\u00d730\u00d750`).click();
    await expect(page.getByText('Width', { exact: true })).toBeVisible();
    await expect(page.getByText('Height', { exact: true })).toBeVisible();
    await expect(page.getByText('Depth', { exact: true })).toBeVisible();
  });

  test('can modify parameters via input', async ({ page }) => {
    await addShape(page, 'Sphere');
    await page.locator('text=r=20').click();
    const input = page.locator('.w-72 input[aria-label="Radius"]').first();
    await input.click({ clickCount: 3 });
    await input.fill('42');
    await input.press('Enter');
    await expect(page.locator('text=r=42')).toBeVisible();
  });

  test('delete key removes selected node', async ({ page }) => {
    await addShape(page, 'Box');
    await page.locator(`text=50\u00d730\u00d750`).click();
    await page.keyboard.press('Delete');
    await expect(page.locator('text=No model yet')).toBeVisible();
  });

  test('undo/redo with keyboard', async ({ page }) => {
    await addShape(page, 'Box');
    await expect(page.locator(`text=50\u00d730\u00d750`)).toBeVisible();

    await page.keyboard.press('Meta+z');
    await expect(page.locator('text=No model yet')).toBeVisible();

    await page.keyboard.press('Meta+Shift+z');
    await expect(page.locator(`text=50\u00d730\u00d750`)).toBeVisible();
  });

  test('Cmd+S saves through the app even while an input has focus', async ({ page }) => {
    await addShape(page, 'Box');
    await page.locator('input[aria-label="Project name"]').focus();

    await page.keyboard.press('Meta+s');

    // Signed out is intentional here: reaching the app save path produces its
    // normal actionable error. The old JSON-download path produced no toast,
    // and the early input guard handed the shortcut to the browser instead.
    await expect(page.getByText('Sign in to save to cloud')).toBeVisible();
  });

  test('wrap selected in modifier', async ({ page }) => {
    await addShape(page, 'Box');
    await page.locator(`text=50\u00d730\u00d750`).click();
    await addOp(page, 'Shell');
    // Verify shell appears in tree (node label text)
    await expect(page.locator('text=Shell').first()).toBeVisible();
  });

  test('boolean kind switcher works', async ({ page }) => {
    await addShape(page, 'Box');
    await addShape(page, 'Sphere');
    // Click the union node summary
    await page.locator('.font-mono:has-text("sharp")').click();
    // Kind switcher is now segmented buttons, click Subtract
    await page.locator('button[role="radio"]:has-text("Subtract")').click();
    await expect(page.locator('text=Subtract').first()).toBeVisible();
  });

  test('placeholder slots shown for incomplete boolean', async ({ page }) => {
    await addShape(page, 'Box');
    await page.locator(`text=50\u00d730\u00d750`).click();
    await addOp(page, 'Subtract');
    await expect(page.locator('text=needs shape')).toBeVisible();
  });
});

test.describe('Modeler: Viewport controls', () => {
  test.beforeEach(async ({ page }) => {
    await enterModeler(page);
  });

  test('gizmo mode buttons have tooltips', async ({ page }) => {
    await expect(page.locator('[title="Move (W)"]')).toBeVisible();
    await expect(page.locator('[title="Rotate (E)"]')).toBeVisible();
    await expect(page.locator('[title="Scale (R)"]')).toBeVisible();
  });

  test('snap button toggles', async ({ page }) => {
    const snap = page.locator('[title="Snap to grid"]');
    await expect(snap).toBeVisible();
    await snap.click();
    await expect(page.locator('[title="Snap size: 5mm"]')).toBeVisible();
    await expect(page.locator('[title="Snap size: 10mm"]')).toBeVisible();
  });

  test('dimensions toggle exists', async ({ page }) => {
    await expect(page.locator('[title="Dimensions"]')).toBeVisible();
  });

  test('screenshot button exists', async ({ page }) => {
    await expect(page.locator('[title="Screenshot"]')).toBeVisible();
  });

  test('clip plane controls appear when toggled', async ({ page }) => {
    await page.locator('[title="Clipping plane"]').click();
    await expect(page.locator('input[type="range"]')).toBeVisible();
  });

  test('keyboard shortcut overlay toggles with ?', async ({ page }) => {
    await page.keyboard.press('?');
    await expect(page.locator('text=Keyboard Shortcuts')).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.locator('text=Keyboard Shortcuts')).not.toBeVisible();
  });
});

test.describe('Modeler: Chat drawer', () => {
  test.beforeEach(async ({ page }) => {
    await enterModeler(page);
  });

  test('opens and shows placeholder', async ({ page }) => {
    await page.locator('[title="AI Chat"]').click();
    await expect(page.locator('text=AI Assistant')).toBeVisible();
    await expect(page.locator('text=Describe what you want to model')).toBeVisible();
  });
});

test.describe('Modeler: Export', () => {
  test.beforeEach(async ({ page }) => {
    await enterModeler(page);
  });

  test('export buttons disabled without model', async ({ page }) => {
    const stl = page.locator('[title="Export STL"]');
    await expect(stl).toBeDisabled();
  });

  test('export buttons enabled with model', async ({ page }) => {
    await addShape(page, 'Box');
    await page.waitForTimeout(500);
    const stl = page.locator('[title="Export STL"]');
    await expect(stl).toBeEnabled();
  });
});

test.describe('Modeler: Worker concurrency', () => {
  test.beforeEach(async ({ page }) => {
    await enterModeler(page);
  });

  // The property #51 is actually about: an export must not block viewport
  // evaluation. The worker runs each message to completion with no yield
  // point, so with a single shared worker every evaluation queued behind a
  // 256³ export and the viewport froze for its duration.
  //
  // The unit tests cannot show this — their fake worker never blocks. This
  // one exercises real workers doing real work, and fails against a
  // single-worker bridge.
  test('viewport keeps evaluating while an export runs', async ({ page }) => {
    // Unlike the rest of the suite this waits on a real 256-cubed export, so it
    // runs 25-27s on a fast machine against the 30s default. CI is slower —
    // on the run that first exposed the bug below, the 30s test budget expired
    // before the inner 15s wait had even started. Triple it rather than leave
    // a genuine pass hostage to the runner's speed.
    test.slow();

    await addShape(page, 'Box');

    // Wait for the first evaluation to settle so we have a baseline.
    await page.waitForFunction(() => {
      const s = (window as any).__MODELER_STORE__;
      return s?.sdfDisplay && !s.evaluating;
    }, null, { timeout: 15000 });

    const baseline = await page.evaluate(() =>
      JSON.stringify((window as any).__MODELER_STORE__.sdfDisplay.paramValues));

    // Kick off an export and wait until it is genuinely in flight.
    await page.locator('[title="Export STL"]').click();
    const progress = page.locator('[data-testid="export-progress"]');
    await expect(progress).toBeVisible({ timeout: 15000 });

    // Mutate the model while the export is running. This changes paramValues,
    // so a completed evaluation is observable without a structural edit.
    //
    // It has to be a parameter this shape actually has: the node here is a Box,
    // whose params are width/height/depth (NODE_DEFAULTS.box).  Setting an
    // unrelated key leaves the emitted uniforms byte-identical — convert.ts
    // reads only width/height/depth for a box — so the wait below could never
    // observe a change, whatever the workers were doing.
    await page.evaluate(() => {
      const store = (window as any).__MODELER_STORE__;
      store.updateNodeParams(store.tree.id, { width: 7 });
    });

    // The evaluation must complete...
    await page.waitForFunction((prev) => {
      const s = (window as any).__MODELER_STORE__;
      return s?.sdfDisplay && !s.evaluating
        && JSON.stringify(s.sdfDisplay.paramValues) !== prev;
    }, baseline, { timeout: 15000 });

    // ...while the export is still running. This ordering is the whole point:
    // on a single worker the evaluation could not land until the export
    // finished and the progress bar had already gone.
    await expect(progress).toBeVisible();
  });

  // The other half of #51. A cooperative cancel flag could not stop this work:
  // the worker never reads its message queue mid-job, so the flag would not be
  // seen until the export it was meant to abort had already finished.
  //
  // The load-bearing assertion is the absence of a completed export, not the
  // elapsed time — export duration varies by an order of magnitude across
  // machines, and on a fast one a full export finishes inside any threshold
  // loose enough to be safe on a slow one. Verified by mutation: no-oping
  // cancelExport() leaves the Download preview on screen and fails this test.
  test('cancelling an export stops it, and the next export still runs', async ({ page }) => {
    test.slow();

    await addShape(page, 'Box');
    await page.waitForFunction(() => {
      const s = (window as any).__MODELER_STORE__;
      return s?.sdfDisplay && !s.evaluating;
    }, null, { timeout: 15000 });

    const progress = page.locator('[data-testid="export-progress"]');
    const cancel = page.locator('[title="Cancel export"]');

    await page.locator('[title="Export STL"]').click();
    await expect(progress).toBeVisible({ timeout: 15000 });
    await expect(cancel).toBeVisible();

    await cancel.click();

    // The rejection clears the progress UI.
    await expect(progress).toBeHidden({ timeout: 10000 });

    // A cancel is not a failure, and it must not yield a model: no preview
    // dialog, no download offered. This is what a no-op cancel fails.
    await expect(page.locator('text=Download')).toHaveCount(0);

    // The export worker was terminated. If it were not respawned — or if the
    // respawned one's `ready` handshake were not awaited before posting — this
    // second export would never start.
    await expect(page.locator('[title="Export STL"]')).toBeEnabled({ timeout: 15000 });
    await page.locator('[title="Export STL"]').click();
    await expect(progress).toBeVisible({ timeout: 15000 });

    await cancel.click();
    await expect(progress).toBeHidden({ timeout: 10000 });
  });
});
