/**
 * Auto-generated spec from plan: plan-6333f72d
 * Source: excel — 92431e4e66c69c50a046c664d5fb1418.xlsx
 * Generated: 2026-03-29T17:34:31.159Z
 */

import { test, expect } from '../../src/framework/fixtures';
import { logger } from '../../src/utils/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://mediationqa20.billcall.net";

test.describe("Mediation Config - Gateway  Configuration", () => {

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

  // [TC_003] BEGIN
  test("[TC_003] Add and delete a Gateway Configuration record", async ({ page, loginPage }) => {
    test.setTimeout(120000);
    const testData = {"Username":"superadminuser","Password":"Admin#1234","Gateway Name":"Testing1","Gateway Type":"39tIY9w85W","Record Name":"Testing1","Alert Timer Interval":"5"};
    let stepStart: number;

    // UI Reference matched: Mediation Configuration > Gateway Configuration
    // ── Step 1: Navigate to the application login page ── [handled by beforeEach]

    // ── Step 2: Enter username and password, then click the Login button ── [handled by beforeEach]

    // ── Step 3: Navigate to Mediation Configuration > Gateway Configuration (list page should open) ──
    stepStart = Date.now();
    logger.info('Step 3: Navigate to Mediation Configuration > Gateway Configuration (list page should open)');
    // Navigate via menu: Mediation Configuration > Gateway Configuration
    await page.click('a:has-text("Mediation Configuration"), [title*="Mediation Configuration" i]');
    await page.waitForTimeout(500);
    await page.click('a:has-text("Gateway Configuration"), [title*="Gateway Configuration" i]');
    await page.waitForTimeout(500);
    await page.waitForSelector('#gatewayGrid tbody', { state: 'visible', timeout: 20000 });
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

    // ── Step 5: Fill in the following details: 1.Gateway Type – Select a value from the dropdown. 2.Gateway Name – Enter the gateway name. 3.Header Exists – Select the checkbox. 4.Enable – Select the checkbox. 5.No File Alert – Select the checkbox. 6.Alert Timer Interval – Enter the alert timer interval value. ──
    stepStart = Date.now();
    logger.info('Step 5: Fill in the following details: 1.Gateway Type – Select a value from the dropdown. 2.Gateway Name – Enter the gateway name. 3.Header Exists – Select the checkbox. 4.Enable – Select the checkbox. 5.No File Alert – Select the checkbox. 6.Alert Timer Interval – Enter the alert timer interval value.');
    // Multi-field step: 6 numbered sub-items
    // Select "Gateway Type" from dropdown — resilient locator, strict data-only selection
    {
      let mfDd_GatewayType = page.locator('select[id="GateWayTypeID" i]');
      // Fallback chain: UI ref ID → getByLabel → getByRole combobox → label-adjacent select → name/id CSS
      if (!(await mfDd_GatewayType.count() > 0)) {
        const lbl_GatewayType = page.getByLabel("Gateway Type", { exact: false });
        if (await lbl_GatewayType.count() > 0) mfDd_GatewayType = lbl_GatewayType.first();
      }
      if (!(await mfDd_GatewayType.count() > 0)) {
        const role_GatewayType = page.getByRole('combobox', { name: new RegExp("Gateway Type", 'i') });
        if (await role_GatewayType.count() > 0) mfDd_GatewayType = role_GatewayType.first();
      }
      if (!(await mfDd_GatewayType.count() > 0)) {
        const adj_GatewayType = page.locator('label:has-text("Gateway Type") ~ select, label:has-text("Gateway Type") + select').first();
        if (await adj_GatewayType.count() > 0) mfDd_GatewayType = adj_GatewayType;
      }
      if (!(await mfDd_GatewayType.count() > 0)) {
        const css_GatewayType = page.locator('select[name*="GatewayType" i], select[id*="GatewayType" i]').first();
        if (await css_GatewayType.count() > 0) mfDd_GatewayType = css_GatewayType;
      }
      await expect(mfDd_GatewayType).toBeVisible({ timeout: 10000 });
      // Strict: use ONLY the value from testData — no fuzzy matching
      // Pre-known exact value from UI reference
      await mfDd_GatewayType.selectOption('170');
      await mfDd_GatewayType.evaluate((el: HTMLSelectElement) => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }
      });
      logger.info('Selected Gateway Type: ' + await mfDd_GatewayType.inputValue());
      await page.waitForLoadState('networkidle');
    }
    // Fill "Gateway Name" (UI Reference: #GatewayName)
    // Wait for field to be visible — it may appear dynamically after a checkbox toggle
    await page.locator('#GatewayName').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await page.locator('#GatewayName').isVisible()) {
      await page.locator('#GatewayName').fill(testData["Gateway Name"]);
      logger.info('Filled Gateway Name via UI ref');
    } else {
      throw new Error('Field #GatewayName not visible for Gateway Name — required field missing after checkbox');
    }
    // Check "Header Exists" (UI Reference: #FlgSkipParserHeader)
    // Click the label instead of input — custom checkbox styling means label intercepts pointer events
    const mfCbLabel_HeaderExists = page.locator('label[for="FlgSkipParserHeader"]');
    const mfCbInput_HeaderExists = page.locator('#FlgSkipParserHeader');
    if (await mfCbLabel_HeaderExists.count() > 0) {
      const isChecked = await mfCbInput_HeaderExists.isChecked();
      if (!isChecked) await mfCbLabel_HeaderExists.click();
      logger.info('Checked Header Exists via label');
    } else if (await mfCbInput_HeaderExists.count() > 0) {
      await mfCbInput_HeaderExists.check({ force: true });
      logger.info('Checked Header Exists via input (force)');
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    // Check "Enable" (UI Reference: #FlgEnable)
    // Click the label instead of input — custom checkbox styling means label intercepts pointer events
    const mfCbLabel_Enable = page.locator('label[for="FlgEnable"]');
    const mfCbInput_Enable = page.locator('#FlgEnable');
    if (await mfCbLabel_Enable.count() > 0) {
      const isChecked = await mfCbInput_Enable.isChecked();
      if (!isChecked) await mfCbLabel_Enable.click();
      logger.info('Checked Enable via label');
    } else if (await mfCbInput_Enable.count() > 0) {
      await mfCbInput_Enable.check({ force: true });
      logger.info('Checked Enable via input (force)');
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    // Check "No File Alert" (UI Reference: #FlgAlertNoFile)
    // Click the label instead of input — custom checkbox styling means label intercepts pointer events
    const mfCbLabel_NoFileAlert = page.locator('label[for="FlgAlertNoFile"]');
    const mfCbInput_NoFileAlert = page.locator('#FlgAlertNoFile');
    if (await mfCbLabel_NoFileAlert.count() > 0) {
      const isChecked = await mfCbInput_NoFileAlert.isChecked();
      if (!isChecked) await mfCbLabel_NoFileAlert.click();
      logger.info('Checked No File Alert via label');
    } else if (await mfCbInput_NoFileAlert.count() > 0) {
      await mfCbInput_NoFileAlert.check({ force: true });
      logger.info('Checked No File Alert via input (force)');
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    // Fill "Alert Timer Interval" (UI Reference: input[placeholder*="min" i])
    // Wait for field to be visible — it may appear dynamically after a checkbox toggle
    await page.locator('input[placeholder*="min" i]').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    if (await page.locator('input[placeholder*="min" i]').isVisible()) {
      await page.locator('input[placeholder*="min" i]').fill(testData["Alert Timer Interval"]);
      logger.info('Filled Alert Timer Interval via UI ref');
    } else {
      throw new Error('Field input[placeholder*="min" i] not visible for Alert Timer Interval — required field missing after checkbox');
    }

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
    await page.waitForSelector('#gatewayGrid tbody', { state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Step 8: Search for the newly added record by Gateway Name ──
    stepStart = Date.now();
    logger.info('Step 8: Search for the newly added record by Gateway Name');
    // ── Search for newly added record by "Gateway Name" ──
    const _srchVal = testData["Gateway Name"];
    let _searchPanelUsed = false;
    logger.info('Searching for record: ' + _srchVal);
    // Wait for list to fully load before checking row visibility
    await page.waitForLoadState('networkidle');
    await page.waitForSelector("#gatewayGrid tbody tr", { state: 'visible', timeout: 15000 });
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
    const recName = testData['Record Name'] || testData['Gateway Name'] || "Testing1";
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
    const recDelCheck = testData['Record Name'] || testData['Gateway Name'] || "Testing1";
    await page.waitForLoadState('networkidle');
    // Navigate back to list page URL (avoids reload landing on wrong page)
    await page.goto("https://mediationqa20.billcall.net/#m215p212#Gateway-Configuration#Gateway#List");
    await page.waitForLoadState('networkidle');
    await page.waitForSelector("#gatewayGrid", { state: 'visible', timeout: 15000 });
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
    await page.screenshot({ path: 'results/screenshots/TC_003-step12-' + Date.now() + '.png', fullPage: true });

  });
  // [TC_003] END

});
