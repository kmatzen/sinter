import { expect, test } from '@playwright/test';

async function enterModeler(page: import('@playwright/test').Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const accept = page.getByRole('button', { name: /^Accept/ });
  if (await accept.isVisible({ timeout: 1_000 }).catch(() => false)) await accept.click();

  const modeler = page.getByTestId('modeler-app');
  if (!await modeler.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await page.getByRole('button', { name: /Start Modeling/i }).first().click();
    if (await accept.isVisible({ timeout: 1_000 }).catch(() => false)) await accept.click();
    const withoutAccount = page.getByRole('button', { name: /Continue without account/i });
    if (await withoutAccount.isVisible({ timeout: 2_000 }).catch(() => false)) await withoutAccount.click();
  }

  await expect(modeler).toBeVisible({ timeout: 30_000 });
}

const tools = (page: import('@playwright/test').Page) =>
  page.getByRole('dialog', { name: 'Model tools' });

test('iPhone WebKit supports the core touch editing path', async ({ page }) => {
  await enterModeler(page);

  await page.getByLabel('Node tree').click();
  await tools(page).getByTitle('Add Box').click();
  await page.getByLabel('Close node tree').click();
  await page.getByLabel('Properties').click();

  const width = page.getByLabel('Width', { exact: true });
  await expect(width).toHaveAttribute('inputmode', 'decimal');
  await expect(width).toHaveCSS('font-size', '16px');
  await width.tap();
  await width.fill('42');
  await width.press('Enter');
  await expect(width).toHaveValue('42.00');
});

test('iPhone WebKit clears mobile overlays across orientation changes', async ({ page }) => {
  await enterModeler(page);

  await page.getByLabel('Node tree').tap();
  await expect(tools(page)).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(tools(page)).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tools(page)).toBeHidden();
});
