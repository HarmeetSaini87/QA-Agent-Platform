/**
 * ui-auth.ts — shared login helper for UI (browser) tests
 */
import { Page, BrowserContext } from '@playwright/test';

export const BASE_URL = 'http://localhost:3003';
export const ADMIN_USER = 'admin';
export const ADMIN_PASS = 'Admin@123';

/** Navigate to login page and sign in as admin */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login.html`);
  await page.fill('#username', ADMIN_USER);
  await page.fill('#password', ADMIN_PASS);
  await page.click('button[type="submit"]');
  // OLD: /index\.html|dashboard/ — server redirects to root '/' after login on this instance
  await page.waitForURL(url => !url.toString().includes('login'), { timeout: 15000 });
}

/** Click a sidebar nav item and wait for its panel to become visible */
export async function navigateTo(page: Page, tab: string): Promise<void> {
  await page.click(`.nav-item[data-tab="${tab}"]`);
  await page.waitForSelector(`#panel-${tab}`, { state: 'visible', timeout: 10000 });
}

/** Select the first project from the global project dropdown */
export async function selectFirstProject(page: Page): Promise<void> {
  const sel = page.locator('#global-project-select');
  if (await sel.isVisible({ timeout: 5000 }).catch(() => false)) {
    const options = await sel.locator('option').count();
    if (options > 1) await sel.selectOption({ index: 1 });
    // wait for the UI to react to project selection
    await page.waitForTimeout(800);
  }
}

/** Navigate to an API Testing tab (tabs under panel-api-*) */
export async function navigateToApiTab(page: Page, tab: string): Promise<void> {
  await page.click(`.nav-item[data-tab="${tab}"]`);
  await page.waitForSelector(`#panel-${tab}`, { state: 'visible', timeout: 10000 });
}
