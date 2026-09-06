import { expect, test } from '@playwright/test';

async function enterModeler(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const accept = page.getByRole('button', { name: /^Accept/ });
  if (await accept.isVisible({ timeout: 1_000 }).catch(() => false)) await accept.click();
  await page.getByRole('button', { name: /Start Modeling/i }).first().click();
  if (await accept.isVisible({ timeout: 1_000 }).catch(() => false)) await accept.click();
  const withoutAccount = page.getByRole('button', { name: /Continue without account/i });
  if (await withoutAccount.isVisible({ timeout: 2_000 }).catch(() => false)) await withoutAccount.click();
  await expect(page.getByTestId('modeler-app')).toBeVisible();
  // Headless Firefox on GitHub's software-only runner may expose no WebGL2.
  // The DOM editor and CPU export path must remain usable through that
  // deliberate fallback; real rendering parity is covered on GPU-capable
  // browsers and by the CPU↔GLSL numeric parity suite.
}

async function discardIfAsked(page: import('@playwright/test').Page) {
  const discard = page.getByRole('button', { name: 'Discard' });
  if (await discard.isVisible({ timeout: 1_000 }).catch(() => false)) await discard.click();
}

test('boot, edit, undo, save interception, import, and export', async ({ page }) => {
  await enterModeler(page);

  await page.getByRole('button', { name: 'Add Box' }).click();
  // Formula-capable numeric properties intentionally use text inputs so values
  // such as `wall * 2` remain editable across engines.
  const width = page.getByRole('textbox', { name: 'Width' });
  await width.fill('42');
  await width.press('Enter');
  await expect(width).toHaveValue('42');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(width).toHaveValue('50');

  // The editor must consume browser Save even while a text field has focus.
  await page.getByRole('textbox', { name: 'Project name' }).focus();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('alert')).toContainText('Sign in to save to cloud');
  await page.getByRole('button', { name: 'Dismiss save error' }).click();

  await page.getByRole('button', { name: 'New project' }).click();
  await discardIfAsked(page);
  await page.getByRole('button', { name: 'Import STL' }).click();
  await page.getByLabel('STL file').setInputFiles({
    name: 'triangle.stl', mimeType: 'model/stl',
    buffer: Buffer.from('solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 10 0\nendloop\nendfacet\nendsolid t'),
  });
  await expect(page.getByRole('treeitem', { name: /Imported Mesh/ })).toBeVisible();

  await page.getByRole('button', { name: 'New project' }).click();
  await discardIfAsked(page);
  await page.getByRole('button', { name: 'Add Box' }).click();
  await page.getByRole('combobox', { name: 'Export resolution' }).selectOption('128');
  const exportButton = page.getByRole('button', { name: 'Export STL' });
  await expect(exportButton).toBeEnabled({ timeout: 30_000 });
  await exportButton.click();
  await expect(page.getByRole('dialog', { name: 'Export Ready' })).toBeVisible({ timeout: 60_000 });
});
