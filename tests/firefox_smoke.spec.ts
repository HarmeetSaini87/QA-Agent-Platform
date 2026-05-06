import { test } from '@playwright/test';
test('firefox smoke', async ({ page }) => {
  await page.goto('about:blank');
  console.log('Firefox page loaded OK');
});
