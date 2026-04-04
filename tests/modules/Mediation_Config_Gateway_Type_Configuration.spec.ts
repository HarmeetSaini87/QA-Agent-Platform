/**
 * Auto-generated spec from plan: plan-a79608b7
 * Source: builder — TC_001
 * Generated: 2026-03-29T18:39:06.667Z
 */

import { test, expect } from '../../src/framework/fixtures';
import { logger } from '../../src/utils/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://mediationqa20.billcall.net";

test.describe("Mediation Config - Gateway Type Configuration", () => {

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const safeName = testInfo.title.replace(/[\W]+/g, '_').slice(0, 60);
      await page.screenshot({ path: `results/screenshots/FAILED-${safeName}-${Date.now()}.png`, fullPage: true }).catch(() => {});
      logger.info('[afterEach] FAILED — URL: ' + page.url());
      // Dismiss any open confirmation dialog so next test starts clean
      await page.locator('.modal:visible .close, .modal:visible button:has-text("Close"), .modal:visible button:has-text("Cancel"), .swal2-cancel').first().click({ force: true }).catch(() => {});
    }
  });

  // [TC_001] BEGIN
  test("[TC_001] Add and delete a Gateway Type Configuration record", async ({ page, loginPage }) => {
    test.setTimeout(120000);
    const testData = {"Username":"superadminuser","Password":"Admin#1234","Record Name":"Test","Gateway Type":"Test"};
    let stepStart: number;

    // UI Reference matched: Mediation Configuration > Gateway Type Configuration
    // ── Step 1: LOGIN ──
    stepStart = Date.now();
    logger.info('Step 1: LOGIN');
    // Custom step: LOGIN
    logger.info('Custom step: LOGIN');

    // ── Step 2: NAVIGATE : Mediation Configuration > Gateway Type Configuration ──
    stepStart = Date.now();
    logger.info('Step 2: NAVIGATE : Mediation Configuration > Gateway Type Configuration');
    // Navigate via menu: Mediation Configuration > Gateway Type Configuration
    await page.click('a:has-text("Mediation Configuration"), [title*="Mediation Configuration" i]');
    await page.waitForTimeout(500);
    await page.click('a:has-text("Gateway Type Configuration"), [title*="Gateway Type Configuration" i]');
    await page.waitForTimeout(500);
    await page.waitForSelector('#GateWayTypeGrid tbody', { state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Step 3: OPEN FORM ──
    stepStart = Date.now();
    logger.info('Step 3: OPEN FORM');
    // Custom step: OPEN FORM
    logger.info('Custom step: OPEN FORM');

    // ── Step 4: FILL ──
    stepStart = Date.now();
    logger.info('Step 4: FILL');
    await page.waitForSelector("#GateWayType", { state: 'visible', timeout: 10000 });
    await page.fill("#GateWayType", "Test");

    // ── Step 5: SAVE ──
    stepStart = Date.now();
    logger.info('Step 5: SAVE');
    // Custom step: SAVE
    logger.info('Custom step: SAVE');

    // ── Step 6: BACK ──
    stepStart = Date.now();
    logger.info('Step 6: BACK');
    // Custom step: BACK
    logger.info('Custom step: BACK');

    // ── Step 7: SEARCH ──
    stepStart = Date.now();
    logger.info('Step 7: SEARCH');
    // Custom step: SEARCH
    logger.info('Custom step: SEARCH');

    // ── Step 8: DELETE ──
    stepStart = Date.now();
    logger.info('Step 8: DELETE');
    // Custom step: DELETE
    logger.info('Custom step: DELETE');

    // ── Step 9: CONFIRM DELETE ──
    stepStart = Date.now();
    logger.info('Step 9: CONFIRM DELETE');
    // Custom step: CONFIRM DELETE
    logger.info('Custom step: CONFIRM DELETE');

    // ── Step 10: VERIFY DELETED ──
    stepStart = Date.now();
    logger.info('Step 10: VERIFY DELETED');
    const recCheck = testData['Record Name'] || testData['Gateway Name'] || "Test";
    const rowCnt = await page.locator(`tr:has-text("${recCheck}")`).count();
    expect(rowCnt, 'Record should not be visible').toBe(0);

    // ── Step 11: LOGOUT ──
    stepStart = Date.now();
    logger.info('Step 11: LOGOUT');
    const logoutSels2 = ["i[class='fa fa fa-power-off fs14']", 'i.fa-power-off', '[title*="logout" i]', 'a:has-text("Logout")'];
    for (const ls of logoutSels2) {
      if (await page.locator(ls).count() > 0) { await page.click(ls); break; }
    }
    await page.waitForLoadState('networkidle');

    // ── Step 12: SCREENSHOT ──
    stepStart = Date.now();
    logger.info('Step 12: SCREENSHOT');
    await page.screenshot({ path: 'results/screenshots/TC_001-step12-' + Date.now() + '.png', fullPage: true });

  });
  // [TC_001] END

});
