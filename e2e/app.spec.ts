import { test, expect } from '@playwright/test';

// Helper: dismiss cookie consent banner if visible
async function dismissCookieConsent(page: any) {
  const accept = page.locator('button:has-text("Accept")');
  if (await accept.isVisible({ timeout: 1000 }).catch(() => false)) {
    await accept.click();
  }
}

// Helper: ensure we're in the modeler (handles both fresh and returning user)
async function enterModeler(page: any) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  // Clear the returning-user flag so landing page shows
  await page.evaluate(() => localStorage.removeItem('sinter_launched'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await dismissCookieConsent(page);
  const btn = page.locator('button', { hasText: 'Launch App' }).first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  await expect(page.locator('[data-testid="modeler-app"]')).toBeVisible({ timeout: 15000 });
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

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.removeItem('sinter_launched'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await dismissCookieConsent(page);
  });

  test('shows hero text', async ({ page }) => {
    await expect(page.locator('h1')).toContainText('Describe it', { timeout: 15000 });
    await expect(page.locator('button:has-text("Launch App")').first()).toBeVisible();
  });

  test('shows features section', async ({ page }) => {
    await expect(page.locator('text=Design, iterate, and export')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('h3:has-text("AI-Powered Modeling")')).toBeVisible();
    await expect(page.locator('h3:has-text("Real-Time Preview")')).toBeVisible();
    await expect(page.locator('h3:has-text("Smooth Booleans")')).toBeVisible();
  });

  test('shows pricing section', async ({ page }) => {
    await expect(page.locator('text=Pay for what you use')).toBeVisible({ timeout: 15000 });
  });

  test('shows footer with copyright and TOS', async ({ page }) => {
    await expect(page.locator('text=Terms of Service')).toBeVisible();
    await expect(page.locator('footer')).toContainText('Sinter');
  });

  test('TOS modal opens and closes', async ({ page }) => {
    await page.locator('button:has-text("Terms of Service")').click();
    await expect(page.locator('text=Acceptance of Terms')).toBeVisible({ timeout: 5000 });
    await page.locator('.fixed .text-lg').click();
    await expect(page.locator('text=Acceptance of Terms')).not.toBeVisible();
  });

  test('Launch App enters the modeler', async ({ page }) => {
    const btn = page.locator('button', { hasText: 'Launch App' }).first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click();
    await expect(page.locator('[data-testid="modeler-app"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=No model yet')).toBeVisible();
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
    await expect(page.locator('text=Width')).toBeVisible();
    await expect(page.locator('text=Height')).toBeVisible();
    await expect(page.locator('text=Depth')).toBeVisible();
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
    await expect(page.locator('text=drop here')).toBeVisible();
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

