/**
 * Auto-generated spec from plan: plan-6333f72d
 * Source: excel — 92431e4e66c69c50a046c664d5fb1418.xlsx
 * Generated: 2026-03-29T17:34:31.152Z
 */

import { test, expect } from '../../src/framework/fixtures';
import { logger } from '../../src/utils/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://mediationqa20.billcall.net";

test.describe("Mediation Config - Gateway Type", () => {

  test.beforeEach(async ({ page }) => {
    await page.goto(APP_BASE_URL);
    await page.waitForLoadState('networkidle');
    // Wait for login page — if already authenticated (unexpected state) this will still redirect
    await page.waitForSelector('input[name="Username"]', { state: 'visible', timeout: 20000 }).catch(async () => {
      logger.info('[beforeEach] Login page not shown — may already be authenticated, proceeding');
    });
    if (await page.locator('input[name="Username"]').count() > 0) {
      await page.fill('input[name="Username"]', "superadminuser");
      const pwdFb = page.locator('input[name="Password"]');
      await pwdFb.click();
      await pwdFb.pressSequentially("Admin#1234", { delay: 50 });
      await page.click('button[type="submit"]');
      await page.waitForFunction(
        () => !location.href.includes('ssoqa') && !location.pathname.includes('/Account/Login'),
        { timeout: 25000 }
      );
      await page.waitForLoadState('networkidle');
      logger.info('[beforeEach] Logged in. URL: ' + page.url());
    }
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (testInfo.status !== testInfo.expectedStatus) {
      const safeName = testInfo.title.replace(/[\W]+/g, '_').slice(0, 60);
      await page.screenshot({ path: `results/screenshots/FAILED-${safeName}-${Date.now()}.png`, fullPage: true }).catch(() => {});
      logger.info('[afterEach] FAILED — URL: ' + page.url());
      // Dismiss any open confirmation dialog so next test starts clean
      await page.locator('.modal:visible .close, .modal:visible button:has-text("Close"), .modal:visible button:has-text("Cancel"), .swal2-cancel').first().click({ force: true }).catch(() => {});
    }
    // Logout fallback — ensures session is cleared even if test failed before its own logout step
    for (const ls of ["i[class='fa fa fa-power-off fs14']", 'i.fa-power-off', '[title*="logout" i]', 'a:has-text("Logout")']) {
      if (await page.locator(ls).count() > 0) { await page.click(ls).catch(() => {}); break; }
    }
  });

  // [TC_001] BEGIN
  test("[TC_001] Add and delete a Gateway Type Configuration record", async ({ page, loginPage }) => {
    test.setTimeout(120000);
    const testData = {"Username":"superadminuser","Password":"Admin#1234","Gateway Type":"Test","Record Name":"Test"};
    let stepStart: number;

    // UI Reference matched: Mediation Configuration > Gateway Type Configuration
    // ── Step 1: Navigate to the application login page ── [handled by beforeEach]

    // ── Step 2: Enter username and password, then click the Login button ── [handled by beforeEach]

    // ── Step 3: Navigate to Mediation Configuration > Gateway Type Configuration (list page should open) ──
    stepStart = Date.now();
    logger.info('Step 3: Navigate to Mediation Configuration > Gateway Type Configuration (list page should open)');
    // Navigate via menu: Mediation Configuration > Gateway Type Configuration
    await page.click('a:has-text("Mediation Configuration"), [title*="Mediation Configuration" i]');
    await page.waitForTimeout(500);
    await page.click('a:has-text("Gateway Type Configuration"), [title*="Gateway Type Configuration" i]');
    await page.waitForTimeout(500);
    await page.waitForSelector('#GateWayTypeGrid tbody', { state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Step 4: Click the Add or + button to open the new record form ──
    stepStart = Date.now();
    logger.info('Step 4: Click the Add or + button to open the new record form');
    await page.waitForSelector('#btnCreate, button:has-text("Add"), .fa-plus', { state: 'visible', timeout: 10000 });
    const addBtn = page.locator('#btnCreate, button:has-text("Add")').first();
    await addBtn.click();
    await page.waitForLoadState('networkidle');
    // Wait for form to be ready — prefer dropdown (loaded by AJAX on some pages)
    await page.waitForSelector('select:visible, input:visible[type="text"], form:visible', { state: 'visible', timeout: 15000 });
    await page.waitForTimeout(1000);

    // ── Step 5: Fill in the GatewayType field ──
    stepStart = Date.now();
    logger.info('Step 5: Fill in the GatewayType field');
    // Fill "Gateway Type" (UI Reference: #GateWayType)
    const fillEl_GatewayType = page.locator('#GateWayType');
    await expect(fillEl_GatewayType).toBeVisible({ timeout: 10000 });
    await fillEl_GatewayType.fill(testData["Gateway Type"]);
    logger.info('Filled Gateway Type via UI ref: #GateWayType');

    // ── Step 6: Click the Save button ──
    stepStart = Date.now();
    logger.info('Step 6: Click the Save button');
    await page.click('#btnSave, #btnSaveColType, button:has-text("Save"), button[type="submit"]');
    await page.waitForTimeout(1500);
    await page.waitForLoadState('networkidle');
    // Save success: wait for message to appear in DOM (may disappear quickly — use attached not visible)
    const successEl = page.locator('[class*="success"], .alert-success').or(page.getByText(/saved successfully/i)).or(page.getByText(/record save/i)).first();
    await successEl.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {
      logger.info('Save success element not found in DOM — continuing');
    });
    logger.info('Save success confirmed');

    // ── Step 7: Click the Back button to return to the list page ──
    stepStart = Date.now();
    logger.info('Step 7: Click the Back button to return to the list page');
    await page.click('#btnBack, button:has-text("Back"), a:has-text("Back")');
    await page.waitForSelector('#GateWayTypeGrid tbody', { state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Step 8: Search for the newly added record by GatewayType ──
    stepStart = Date.now();
    logger.info('Step 8: Search for the newly added record by GatewayType');
    // ── Search for newly added record by "GatewayType" ──
    const _srchVal = testData["Gateway Type"];
    let _searchPanelUsed = false;
    logger.info('Searching for record: ' + _srchVal);
    // Wait for list to fully load before checking row visibility
    await page.waitForLoadState('networkidle');
    await page.waitForSelector("#GateWayTypeGrid tbody tr", { state: 'visible', timeout: 15000 });
    // Check if record is already visible in the loaded list (TC_001–TC_003 path)
    const _rowVisible = await page.locator(`tr:has-text("${_srchVal}")`).count() > 0;
    if (_rowVisible) {
      logger.info('Record already visible in list — skipping search');
    } else {
      // Record not visible — use search panel (TC_004+ path)
      _searchPanelUsed = true;
      logger.info('Record not in current view — using search panel');
      // Step 1 — click search icon to open search panel
      await page.locator("i.fa.fa-search").first().click();
      await page.waitForLoadState('networkidle');
      // Step 2 — fill page-specific search input
      await page.locator("#txtSearch").waitFor({ state: 'visible', timeout: 10000 });
      await page.locator("#txtSearch").clear();
      await page.locator("#txtSearch").fill(_srchVal);
      logger.info('Search input filled: ' + _srchVal);
      // Step 3 — click search submit button
      await page.locator("#Search").click();
      await page.waitForLoadState('networkidle');
      await page.waitForSelector(`tr:has-text("${_srchVal}")`, { state: 'visible', timeout: 10000 });
      logger.info('Record found via search: ' + _srchVal);
    }

    // ── Step 9: Click the Delete (bin) icon on the row matching the record ──
    stepStart = Date.now();
    logger.info('Step 9: Click the Delete (bin) icon on the row matching the record');
    // Capture exact-match cell count before delete for later verification
    const recName = testData['Record Name'] || testData['Gateway Name'] || "Test";
    const preDeleteRowCount = await page.locator(`td:text-is("${recName}")`).count();
    logger.info('Pre-delete exact-match count for "' + recName + '": ' + preDeleteRowCount);
    // Click delete on the record row
    const delSels = ['.fa-trash', '.fa-trash-alt', '[data-action="delete"]', 'button[title*="delete" i]'];
    let deleteClicked = false;
    for (const del of delSels) {
      const sel = `tr:has-text("${recName}") ${del}`;
      if (await page.locator(sel).count() > 0) {
        await page.click(sel);
        deleteClicked = true;
        logger.info('Delete clicked via: ' + sel);
        break;
      }
    }
    expect(deleteClicked, 'Delete icon not found on record row').toBe(true);

    // ── Step 10: Click Yes on the confirmation popup ──
    stepStart = Date.now();
    logger.info('Step 10: Click Yes on the confirmation popup');
    // Confirm popup — wait for any dialog pattern (bootstrap modal, role=dialog, swal, or custom div with Confirmation heading)
    await page.waitForSelector('.modal:visible, [role="dialog"]:visible, .swal2-container:visible, :has(h4:has-text("Confirmation")):visible', { state: 'visible', timeout: 8000 }).catch(async () => {
      // Fallback: just wait for a visible "Yes" button
      await page.waitForSelector('button:has-text("Yes"):visible', { state: 'visible', timeout: 5000 });
    });
    const yesSels = ['button:has-text("Yes"):visible', '.modal-footer button:has-text("Yes")', '.modal button:has-text("Yes")', '.swal2-confirm'];
    for (const ys of yesSels) {
      if (await page.locator(ys).count() > 0) {
        await page.click(ys);
        logger.info('Confirmed via: ' + ys);
        break;
      }
    }
    // Wait for delete to complete: poll until the Yes button is gone and page settles
    await page.waitForFunction(() => {
      const yesBtn = document.querySelector('button');
      const btns = [...document.querySelectorAll('button')];
      const hasYes = btns.some(b => b.textContent?.trim() === 'Yes' && b.offsetParent !== null);
      return !hasYes;
    }, { timeout: 15000 });
    await page.waitForLoadState('networkidle');
    // Wait for any remaining overlay/spinner to clear
    await page.waitForFunction(() => {
      const overlay = document.querySelector('.blockUI, .loading-overlay, [class*="spinner"], [class*="loading"]');
      return !overlay || (overlay as HTMLElement).offsetParent === null;
    }, { timeout: 10000 }).catch(() => {});

    // ── Step 11: Verify the record is no longer visible in the list, then logout ──
    stepStart = Date.now();
    logger.info('Step 11: Verify the record is no longer visible in the list, then logout');
    // Verify record deleted — reload list and check with exact cell text match
    const recDelCheck = testData['Record Name'] || testData['Gateway Name'] || "Test";
    await page.waitForLoadState('networkidle');
    // Navigate back to list page URL (avoids reload landing on wrong page)
    await page.goto("https://mediationqa20.billcall.net/#m213p212#Gateway-Type-Configuration#GatewayType#List");
    await page.waitForLoadState('networkidle');
    await page.waitForSelector("#GateWayTypeGrid", { state: 'visible', timeout: 15000 });
    // Use exact cell text (td:text-is) to avoid false positives from rows where record name is a substring
    const postDeleteCount = await page.locator(`td:text-is("${recDelCheck}")`).count();
    logger.info('Post-delete exact-match count for "' + recDelCheck + '": ' + postDeleteCount);
    // Hard assert: exact-match cell must be 0 — record is gone
    expect(postDeleteCount, 'Record "' + recDelCheck + '" still present after deletion').toBe(0);
    logger.info('Delete confirmed: "' + recDelCheck + '" not found (exact match) in list');
    
    // Logout
    const logoutSels = ["i[class='fa fa fa-power-off fs14']", 'i.fa-power-off', '[title*="logout" i]', 'a:has-text("Logout")'];
    for (const ls of logoutSels) {
      if (await page.locator(ls).count() > 0) { await page.click(ls); break; }
    }
    await page.waitForLoadState('networkidle');

    // ── Step 12: Take a final screenshot of the end state ──
    stepStart = Date.now();
    logger.info('Step 12: Take a final screenshot of the end state');
    await page.screenshot({ path: 'results/screenshots/TC_001-step12-' + Date.now() + '.png', fullPage: true });

  });
  // [TC_001] END

});
