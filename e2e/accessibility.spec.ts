import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function dismissConsent(page: import('@playwright/test').Page) {
  const accept = page.getByRole('button', { name: /^Accept/ });
  if (await accept.isVisible({ timeout: 1_000 }).catch(() => false)) await accept.click();
}

async function enterModeler(page: import('@playwright/test').Page) {
  await page.goto('/');
  await dismissConsent(page);
  await page.getByRole('button', { name: /Start Modeling/i }).first().click();
  await dismissConsent(page);
  const continueButton = page.getByRole('button', { name: /Continue without account/i });
  if (await continueButton.isVisible({ timeout: 2_000 }).catch(() => false)) await continueButton.click();
  await expect(page.getByTestId('modeler-app')).toBeVisible();
}

async function expectNoSeriousViolations(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  const severe = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical');
  expect(severe, severe.map((violation) => `${violation.id}: ${violation.help}`).join('\n')).toEqual([]);
}

test('landing page has no serious automated accessibility violations', async ({ page }) => {
  await page.goto('/');
  await dismissConsent(page);
  await expectNoSeriousViolations(page);
});

test('representative keyboard modeling workflow is accessible', async ({ page }) => {
  await enterModeler(page);
  await page.getByRole('button', { name: 'Add Box' }).focus();
  await page.keyboard.press('Enter');
  const box = page.getByRole('treeitem', { name: /Box/ });
  await box.focus();
  await page.keyboard.press('Enter');
  await expect(box).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('spinbutton', { name: 'Width' }).fill('42');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /keyboard shortcuts and accessibility help/i }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeHidden();
  await expectNoSeriousViolations(page);
});
