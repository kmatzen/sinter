import { test, expect, devices } from '@playwright/test';

/**
 * Mobile coverage.
 *
 * The suite ran desktop-sized Chromium exclusively, so every mobile problem in
 * `docs/mobile-audit/README.md` passed CI: 18px number inputs, a blank first
 * run, a chat drawer with no way out. Emulating a real device — touch flags,
 * device pixel ratio, device viewport — is what makes those failures visible.
 *
 * The touch-target check below is the load-bearing one. Individual sizes get
 * adjusted over time and any single assertion about a single button rots; a
 * sweep over everything actually on screen does not, and it fails on the next
 * control someone adds at desktop density.
 */

const MIN_TAP = 44; // Apple HIG, in CSS px

test.use({ ...devices['iPhone 13'] });

async function enterModeler(page: any) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const accept = page.locator('button:has-text("Accept")');
  if (await accept.isVisible({ timeout: 2000 }).catch(() => false)) await accept.click();

  const modeler = page.locator('[data-testid="modeler-app"]');
  if (await modeler.isVisible({ timeout: 2000 }).catch(() => false)) return;

  const start = page.locator('button:has-text("Start Modeling")').first();
  if (await start.isVisible({ timeout: 8000 }).catch(() => false)) {
    await start.click();
    const accept2 = page.locator('button:has-text("Accept")');
    if (await accept2.isVisible({ timeout: 2000 }).catch(() => false)) await accept2.click();
  }

  const cont = page.locator('button:has-text("Continue without account")');
  if (await cont.isVisible({ timeout: 8000 }).catch(() => false)) await cont.click();

  await expect(modeler).toBeVisible({ timeout: 30000 });
}

/** The mobile slide-over / sheet is the last fixed overlay in the DOM. */
const overlay = (page: any) => page.locator('div.fixed.inset-0.z-50').last();

/**
 * Every interactive element currently on screen and smaller than `MIN_TAP` in
 * either axis. Elements the user cannot reach — inside a `display: none`
 * desktop panel, scrolled off, fully transparent — are not touch targets and
 * are excluded.
 */
async function undersizedTargets(page: any) {
  return page.evaluate((min: number) => {
    const sel = 'button, a, input, select, textarea, [role=button], [role=tab], [role=radio]';
    const out: { label: string; tag: string; w: number; h: number }[] = [];
    const vh = window.innerHeight, vw = window.innerWidth;

    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') continue;
      // A hidden ancestor hides its children without changing their own style.
      if (!(el as HTMLElement).offsetParent && cs.position !== 'fixed') continue;

      if (r.width < min || r.height < min) {
        out.push({
          label: (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim().slice(0, 40),
          tag: el.tagName.toLowerCase(),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return out;
  }, MIN_TAP);
}

const describeTargets = (t: { label: string; tag: string; w: number; h: number }[]) =>
  t.map(x => `${x.tag} "${x.label}" ${x.w}x${x.h}`).join('\n');

test('a first-time visitor is told what to do, not shown a blank screen', async ({ page }) => {
  await enterModeler(page);

  // The pre-existing empty-state copy lives inside the tree drawer, which is
  // closed on mobile — so the viewport has to say something on its own.
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add a shape' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Describe it instead' })).toBeVisible();

  // And it is a way in, not just a message.
  await page.getByRole('button', { name: 'Add a shape' }).click();
  await expect(overlay(page).locator('[title="Add Box"]')).toBeVisible();
});

test('the core path works with a finger: add a shape, edit a dimension', async ({ page }) => {
  await enterModeler(page);

  await page.locator('[aria-label="Node tree"]').click();
  await overlay(page).locator('[title="Add Box"]').click();

  // Selecting inside the tree must not yank the tree away — the drawer stays
  // put so the row actions and the palette are still reachable.
  await expect(overlay(page).locator('[title="Add Box"]')).toBeVisible();

  await page.locator('[aria-label="Close node tree"]').click();
  await page.locator('[aria-label="Properties"]').click();

  const width = overlay(page).getByLabel('Width', { exact: true });
  await expect(width).toBeVisible();
  // A numeric keypad rather than a full QWERTY keyboard.
  await expect(width).toHaveAttribute('inputmode', 'decimal');

  await width.fill('42');
  await width.press('Enter');
  await expect(width).toHaveValue('42');
});

test('the property sheet opens far enough to edit in, and closes without a swipe', async ({ page }) => {
  await enterModeler(page);
  await page.locator('[aria-label="Node tree"]').click();
  await overlay(page).locator('[title="Add Box"]').click();
  await page.locator('[aria-label="Close node tree"]').click();
  await page.locator('[aria-label="Properties"]').click();

  const sheet = overlay(page).locator('.absolute.bottom-0');
  const box = await sheet.boundingBox();
  const vh = page.viewportSize()!.height;
  // Opening at a third of the screen showed two and a half fields.
  expect(box!.height).toBeGreaterThan(vh * 0.45);

  await page.locator('[aria-label="Close properties"]').click();
  await expect(sheet).toBeHidden();
});

test('tablet portrait stays mobile and rotation does not resurrect a stale drawer', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await enterModeler(page);
  await expect(page.locator('[aria-label="Node tree"]')).toBeVisible();
  await page.locator('[aria-label="Node tree"]').click();
  await expect(page.getByRole('dialog', { name: 'Model tools' })).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('dialog', { name: 'Model tools' })).toBeHidden();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByRole('dialog', { name: 'Model tools' })).toBeHidden();
});

test('short landscape phones dock properties beside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 750, height: 342 });
  await enterModeler(page);
  await page.locator('[aria-label="Node tree"]').click();
  await overlay(page).locator('[title="Add Box"]').click();
  await page.locator('[aria-label="Close node tree"]').click();
  await page.locator('[aria-label="Properties"]').click();

  const box = await overlay(page).locator('.mobile-properties-sheet').boundingBox();
  expect(box!.height).toBeGreaterThan(330);
  expect(box!.width).toBeLessThan(360);
  expect(box!.x).toBeGreaterThan(390);
});

test('the chat drawer carries its own way out', async ({ page }) => {
  await enterModeler(page);

  await page.locator('[aria-label="Toggle AI Chat"]').click();
  const drawer = page.getByPlaceholder('Describe your model...');
  await expect(drawer).toBeVisible();

  // It covers the whole screen on a phone, including the toggle that opened it.
  await page.locator('[aria-label="Close AI Chat"]').click();
  await expect(drawer).toBeHidden();
});

test('a node can be reparented without a drag gesture', async ({ page }) => {
  await enterModeler(page);

  await page.locator('[aria-label="Node tree"]').click();
  const panel = overlay(page);

  // A union with a box, then a second box at the root to move into it.
  await panel.locator('button[role="tab"]:has-text("Ops")').click();
  await panel.locator('[title="Add Union"]').click();
  await panel.locator('button[role="tab"]:has-text("Shapes")').click();
  await panel.locator('[title="Add Box"]').click();

  const rows = panel.locator('[data-testid="tree-nodes"]');
  await expect(rows.getByText('Union', { exact: true }).first()).toBeVisible();

  // Pick the box up and place it — two taps, no drag events involved, which is
  // the whole point: HTML5 drag-and-drop never fires from touch input.
  await panel.locator('[aria-label="Move node into another node"]').last().click();
  await expect(panel.getByText('Tap a node to move it there')).toBeVisible();
  await rows.getByText('Union', { exact: true }).first().click();
  await expect(panel.getByText('Tap a node to move it there')).toBeHidden();
});

test('nothing on screen is smaller than a fingertip', async ({ page }) => {
  await enterModeler(page);

  // Empty state
  expect(describeTargets(await undersizedTargets(page))).toBe('');

  // Tree drawer, with a model in it so rows and their actions are present
  await page.locator('[aria-label="Node tree"]').click();
  await overlay(page).locator('[title="Add Box"]').click();
  expect(describeTargets(await undersizedTargets(page))).toBe('');

  // Palette tabs
  await overlay(page).locator('button[role="tab"]:has-text("Ops")').click();
  expect(describeTargets(await undersizedTargets(page))).toBe('');

  // Property sheet over the viewport
  await page.locator('[aria-label="Close node tree"]').click();
  await page.locator('[aria-label="Properties"]').click();
  expect(describeTargets(await undersizedTargets(page))).toBe('');
  await page.locator('[aria-label="Close properties"]').click();

  // Overflow menu — where every desktop-only action lives on mobile
  await page.locator('[aria-label="More actions"]').click();
  expect(describeTargets(await undersizedTargets(page))).toBe('');
});

test('mobile overflow exposes resolution, copy, paste, and help', async ({ page }) => {
  await enterModeler(page);
  await page.locator('[aria-label="Node tree"]').click();
  await overlay(page).locator('[title="Add Box"]').click();
  await page.locator('[aria-label="Close node tree"]').click();

  await page.locator('[aria-label="More actions"]').click();
  await expect(page.getByRole('combobox', { name: 'Export resolution' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy selected node' })).toBeEnabled();
  await page.getByRole('button', { name: 'Copy selected node' }).click();
  await expect(page.getByRole('button', { name: 'Node copied!' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paste node' })).toBeEnabled();

  // Help is a direct viewport control rather than a keyboard-only secret.
  await page.locator('[aria-label="More actions"]').click();
  await page.getByRole('button', { name: /keyboard shortcuts and accessibility help/i }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
});

test('text entry does not zoom the page', async ({ page }) => {
  await enterModeler(page);
  await page.locator('[aria-label="Node tree"]').click();
  await overlay(page).locator('[title="Add Box"]').click();
  await page.locator('[aria-label="Close node tree"]').click();
  await page.locator('[aria-label="Properties"]').click();

  // iOS Safari zooms on focus for anything under 16px and never zooms back.
  const tooSmall = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('input, select, textarea'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) out.push(`${(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.tagName)}: ${size}px`);
    }
    return out;
  });
  expect(tooSmall).toEqual([]);
});
