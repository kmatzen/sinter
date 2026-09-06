import { expect, test } from '@playwright/test';

async function enterModeler(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const accept = page.getByRole('button', { name: /^Accept/ });
  if (await accept.isVisible({ timeout: 2_000 }).catch(() => false)) await accept.click();
  if (await page.getByTestId('modeler-app').isVisible({ timeout: 2_000 }).catch(() => false)) return;
  const start = page.getByRole('button', { name: /start modeling/i }).first();
  if (await start.isVisible({ timeout: 8_000 }).catch(() => false)) await start.click();
  if (await accept.isVisible({ timeout: 2_000 }).catch(() => false)) await accept.click();
  const continueButton = page.getByRole('button', { name: /continue without account/i });
  if (await continueButton.isVisible({ timeout: 8_000 }).catch(() => false)) await continueButton.click();
  await expect(page.getByTestId('modeler-app')).toBeVisible({ timeout: 30_000 });
}

test('command palette is keyboard-accessible, searchable, and invokes an action', async ({ page }) => {
  await enterModeler(page);
  await page.keyboard.press('ControlOrMeta+K');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette.getByRole('textbox', { name: 'Search commands' }).fill('add sphere');
  await palette.getByRole('textbox', { name: 'Search commands' }).press('Enter');
  await expect(page.getByTestId('selection-breadcrumb').getByRole('button', { name: 'Sphere' })).toBeVisible();

  // The global command shortcut intentionally works while a text field owns focus.
  await page.getByRole('textbox', { name: 'Project name' }).focus();
  await page.keyboard.press('ControlOrMeta+K');
  await expect(palette).toBeVisible();
});

test('the same palette has a direct touch entry point', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await enterModeler(page);
  await page.getByRole('button', { name: /command palette/i }).click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await expect(page.getByRole('option', { name: /delete selected node.*select a node first/i })).toBeDisabled();
});
