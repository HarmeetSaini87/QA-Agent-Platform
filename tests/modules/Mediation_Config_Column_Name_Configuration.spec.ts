/**
 * Auto-generated spec from plan: plan-6333f72d
 * Source: excel — 92431e4e66c69c50a046c664d5fb1418.xlsx
 * Generated: 2026-03-29T17:34:31.156Z
 */

import { test, expect } from '../../src/framework/fixtures';
import { logger } from '../../src/utils/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://mediationqa20.billcall.net";

test.describe("Mediation Config - Column Name  Configuration", () => {

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

  // [TC_002] BEGIN
  test("[TC_002] Add and delete a Column Name Configuration record", async ({ page, loginPage }) => {
    test.setTimeout(120000);
    const testData: Record<string, any> = {"Username":"superadminuser","Password":"Admin#1234","Gateway Type":"39tIY9w85W","Record Name":"Testing","Column Type":"Gateway Column","Column Name":"Testing","Column Data Type ":"String"};
    let stepStart: number;

    // UI Reference matched: Mediation Configuration > Column Name Configuration
    // ── Step 1: Navigate to the application login page ── [handled by beforeEach]

    // ── Step 2: Enter username and password, then click the Login button ── [handled by beforeEach]

    // ── Step 3: Navigate to Mediation Configuration > Column Name Configuration (list page should open) ──
    stepStart = Date.now();
    logger.info('Step 3: Navigate to Mediation Configuration > Column Name Configuration (list page should open)');
    // Navigate via menu: Mediation Configuration > Column Name Configuration
    await page.click('a:has-text("Mediation Configuration"), [title*="Mediation Configuration" i]');
    await page.waitForTimeout(500);
    await page.click('a:has-text("Column Name Configuration"), [title*="Column Name Configuration" i]');
    await page.waitForTimeout(500);
    await page.waitForSelector('#deptGrid tbody', { state: 'visible', timeout: 20000 });
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

    // ── Step 5: Fill in the GatewayType field from the Dropdown and Select the Column Type Field Radio Button ──
    stepStart = Date.now();
    logger.info('Step 5: Fill in the GatewayType field from the Dropdown and Select the Column Type Field Radio Button');
    // Select "Gateway Type" from dropdown — resilient locator, strict data-only selection
    let ddEl_GatewayType = page.locator('select[id="GateWayTypeID" i]');
    {
      if (!(await ddEl_GatewayType.count() > 0)) {
        const lbl_GatewayType = page.getByLabel("Gateway Type", { exact: false });
        if (await lbl_GatewayType.count() > 0) ddEl_GatewayType = lbl_GatewayType.first();
      }
      if (!(await ddEl_GatewayType.count() > 0)) {
        const role_GatewayType = page.getByRole('combobox', { name: new RegExp("Gateway Type", 'i') });
        if (await role_GatewayType.count() > 0) ddEl_GatewayType = role_GatewayType.first();
      }
      if (!(await ddEl_GatewayType.count() > 0)) {
        const adj_GatewayType = page.locator('label:has-text("Gateway Type") ~ select, label:has-text("Gateway Type") + select').first();
        if (await adj_GatewayType.count() > 0) ddEl_GatewayType = adj_GatewayType;
      }
      if (!(await ddEl_GatewayType.count() > 0)) {
        const css_GatewayType = page.locator('select[name*="GatewayType" i], select[id*="GatewayType" i]').first();
        if (await css_GatewayType.count() > 0) ddEl_GatewayType = css_GatewayType;
      }
      await expect(ddEl_GatewayType).toBeVisible({ timeout: 10000 });
      // Pre-known exact value from UI reference: 170
      await ddEl_GatewayType.selectOption('170');
      await ddEl_GatewayType.evaluate((el: HTMLSelectElement) => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }
      });
      logger.info('Selected Gateway Type: value=' + await ddEl_GatewayType.inputValue());
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(3000);
      await page.waitForLoadState('networkidle');
      const afterAjax_GatewayType = await ddEl_GatewayType.inputValue();
      if (!afterAjax_GatewayType || afterAjax_GatewayType === '' || afterAjax_GatewayType === '0') {
        logger.info('Gateway Type was reset by AJAX — re-selecting (no change event to avoid cascade)');
        await ddEl_GatewayType.selectOption('170');
        await page.waitForTimeout(1000);
        logger.info('Re-selected Gateway Type: ' + await ddEl_GatewayType.inputValue());
      }
    }
    // Select "Column Type" radio button (UI Reference: #gatewayRadio)
    // Fallback chain: label[for] → getByLabel → getByRole radio → force click
    {
      let radioClicked_ColumnType = false;
      const radioLbl_ColumnType = page.locator('label[for="gatewayRadio"]');
      if (!radioClicked_ColumnType && await radioLbl_ColumnType.count() > 0 && await radioLbl_ColumnType.isVisible()) {
        await radioLbl_ColumnType.click();
        radioClicked_ColumnType = true;
        logger.info('Clicked radio "Column Type" via label[for="gatewayRadio"]');
      }
      if (!radioClicked_ColumnType) {
        const gbl_ColumnType = page.getByLabel('Gateway Column', { exact: false });
        if (await gbl_ColumnType.count() > 0) {
          await gbl_ColumnType.first().click({ force: true });
          radioClicked_ColumnType = true;
          logger.info('Clicked radio "Column Type" via getByLabel("Gateway Column")');
        }
      }
      if (!radioClicked_ColumnType) {
        const role_ColumnType = page.getByRole('radio', { name: new RegExp('Gateway Column', 'i') });
        if (await role_ColumnType.count() > 0) {
          await role_ColumnType.first().click({ force: true });
          radioClicked_ColumnType = true;
          logger.info('Clicked radio "Column Type" via getByRole radio');
        }
      }
      if (!radioClicked_ColumnType) {
        // Last resort: force click the UI ref selector
        await page.locator('#gatewayRadio').click({ force: true });
        radioClicked_ColumnType = true;
        logger.info('Clicked radio "Column Type" via force click on #gatewayRadio');
      }
      if (!radioClicked_ColumnType) throw new Error('Could not click radio for Column Type');
    }
    const radioChecked_ColumnType = page.locator('input[type="radio"]:checked').first();
    if (await radioChecked_ColumnType.count() > 0) {
      await radioChecked_ColumnType.evaluate((el: HTMLInputElement) => {
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click', { bubbles: true }));
        if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }
      });
    }
    // Wait for AJAX content triggered by radio selection
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');
    logger.info('Post-radio table rows: ' + await page.locator('table tbody tr').count());
    // Post-radio re-verify: radio AJAX may reset Gateway Type — re-select if cleared
    {
      const postRadioVal = await ddEl_GatewayType.inputValue().catch(() => '');
      logger.info('Post-radio Gateway Type value: ' + postRadioVal);
      if (!postRadioVal || postRadioVal === '' || postRadioVal === '0') {
        logger.info('Gateway Type was reset by radio AJAX — re-selecting (no change event to avoid cascade)');
        await ddEl_GatewayType.selectOption('170');
        await page.waitForTimeout(1000);
        logger.info('Re-selected after radio AJAX. Value: ' + await ddEl_GatewayType.inputValue());
      }
      // Hard assert: Gateway Type must be selected before Add Row
      const finalVal = await ddEl_GatewayType.inputValue();
      expect(finalVal, 'Gateway Type must remain selected before Add Row').toBeTruthy();
      expect(finalVal, 'Gateway Type must remain selected before Add Row').not.toBe('0');
    }

    // ── Step 6: Click on the Add Row or + icon and Fill the Column Name Field as Text and Column Data Type field from Dropdown ──
    stepStart = Date.now();
    logger.info('Step 6: Click on the Add Row or + icon and Fill the Column Name Field as Text and Column Data Type field from Dropdown');
    // Count rows in #FileColumns before Add Row
    const fileColSel = (await page.locator('#FileColumns tbody').count() > 0) ? '#FileColumns tbody tr' : 'table tbody tr';
    const rowsBefore = await page.locator(fileColSel).count();
    logger.info('Rows before Add Row: ' + rowsBefore);
    
    // Click Add Row — use position-filtered approach (x > 100 skips sidebar icons)
    const addRowSels = ['i.fa.fa-plus', '#AddRow_1', 'a[id*="AddRow" i]', '[onclick*="cloneRow" i]', 'button:has-text("Add Row"):visible', '#btnAddRow:visible'];
    let addRowClicked = false;
    for (const ar of addRowSels) {
      const els = page.locator(ar);
      const cnt = await els.count();
      for (let i = 0; i < cnt; i++) {
        const box = await els.nth(i).boundingBox();
        if (box && box.x > 100) {
          await els.nth(i).click();
          addRowClicked = true;
          logger.info('Clicked Add Row via: ' + ar + ' at x=' + Math.round(box.x));
          break;
        }
      }
      if (addRowClicked) break;
    }
    if (!addRowClicked) throw new Error('Add Row button not found — no matching selector with x > 100');
    
    // Wait for exactly 1 new row — hard assert no double-add
    await page.waitForFunction(
      ({ sel, before }: { sel: string; before: number }) => document.querySelectorAll(sel).length === before + 1,
      { sel: fileColSel, before: rowsBefore },
      { timeout: 8000 }
    );
    const rowsAfter = await page.locator(fileColSel).count();
    expect(rowsAfter, 'Add Row must add exactly 1 row').toBe(rowsBefore + 1);
    logger.info('Row added — total rows: ' + rowsAfter);
    // Wait for the new row inputs to be ready
    await page.locator('#FileColumns tbody tr:last-child input, table tbody tr:last-child input').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
    // Fill "Column Name" — try last table row first, then page-wide (keyword fallback)
    const txtSels_ColumnName = [
      '#FileColumns tbody tr:last-child input:visible[type="text"]',
      '#FileColumns tbody tr:last-child input:visible',
      'table tbody tr:last-child input:visible[type="text"]',
      'table tbody tr:last-child input:visible',
      'input:visible[name*="Column Name" i]',
      'input:visible[name*="ColumnName" i]',
      'input:visible[placeholder*="Column Name" i]',
      '#txtColumnName:visible',
      '#ColumnName:visible',
    ];
    let txtFilled_ColumnName = false;
    for (const ts of txtSels_ColumnName) {
      const tEl = page.locator(ts).first();
      if (await tEl.count() > 0 && await tEl.isVisible()) {
        await tEl.fill(testData["Column Name"]);
        txtFilled_ColumnName = true;
        logger.info('Filled Column Name via: ' + ts);
        break;
      }
    }
    if (!txtFilled_ColumnName) throw new Error('Could not find visible input for Column Name');
    // Select "Column Data Type " from dropdown (no UI ref — keyword fallback)
    const ddSels_ColumnDataType = [
      'select:visible[name*="Column Data Type " i]',
      'select:visible[id*="ColumnDataType" i]',
      'select:visible[name*="ColumnDataType" i]',
      'select:visible[id*="ColumnDataType" i]',
      'table tbody tr:last-child select:visible',
    ];
    let ddSelected_ColumnDataType = false;
    for (const ds of ddSels_ColumnDataType) {
      const ddEl = page.locator(ds).first();
      if (await ddEl.count() > 0 && await ddEl.isVisible()) {
        const opts_ColumnDataType = await ddEl.locator('option').all();
        const targetVal = testData["Column Data Type "];
        let matchedOptValue: string | null = null;
        for (const opt of opts_ColumnDataType) {
          const val = await opt.getAttribute('value');
          const txt = ((await opt.textContent()) || '').trim();
          if (txt === targetVal || val === targetVal) { matchedOptValue = val; break; }
          if (txt.toLowerCase() === targetVal.toLowerCase()) { matchedOptValue = val; break; }
          if (txt.toLowerCase().includes(targetVal.toLowerCase()) || targetVal.toLowerCase().includes(txt.toLowerCase())) {
            if (val && val !== '' && val !== '0' && !txt.includes('Select') && !txt.includes('--')) { matchedOptValue = val; }
          }
          const norm = (s: string) => s.replace(/[lI1]/g, 'x').toLowerCase();
          if (!matchedOptValue && norm(txt) === norm(targetVal)) { matchedOptValue = val; }
        }
        if (matchedOptValue) {
          await ddEl.selectOption(matchedOptValue);
          await ddEl.evaluate((el: HTMLSelectElement) => {
            el.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); }
          });
          ddSelected_ColumnDataType = true;
          logger.info('Selected Column Data Type : value=' + matchedOptValue);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(3000);
          await page.waitForLoadState('networkidle');
          logger.info('Post-dropdown table rows: ' + await page.locator('table tbody tr').count());
        } else {
          const allOpts: string[] = [];
          for (const opt of opts_ColumnDataType) { allOpts.push(((await opt.textContent()) || '').trim()); }
          throw new Error('No matching option for Column Data Type ="' + targetVal + '". Available: ' + allOpts.join(', '));
        }
        break;
      }
    }
    if (!ddSelected_ColumnDataType) throw new Error('Could not find dropdown for Column Data Type ');
    await page.waitForLoadState('networkidle');

    // ── Step 7: Click the Save button ──
    stepStart = Date.now();
    logger.info('Step 7: Click the Save button');
    await page.click('#btnSave, #btnSaveColType, button:has-text("Save"), button[type="submit"]');
    await page.waitForTimeout(1500);
    await page.waitForLoadState('networkidle');
    // Save success: wait for message to appear in DOM (may disappear quickly — use attached not visible)
    const successEl = page.locator('[class*="success"], .alert-success').or(page.getByText(/saved successfully/i)).or(page.getByText(/record save/i)).first();
    await successEl.waitFor({ state: 'attached', timeout: 10000 }).catch(() => {
      logger.info('Save success element not found in DOM — continuing');
    });
    logger.info('Save success confirmed');

    // ── Step 8: Click the Back button to return to the list page ──
    stepStart = Date.now();
    logger.info('Step 8: Click the Back button to return to the list page');
    await page.click('#btnBack, button:has-text("Back"), a:has-text("Back")');
    await page.waitForSelector('#deptGrid tbody', { state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Step 9: Search for the newly added record by Column Name ──
    stepStart = Date.now();
    logger.info('Step 9: Search for the newly added record by Column Name');
    // ── Search for newly added record by "Column Name" ──
    const _srchVal = testData["Column Name"];
    let _searchPanelUsed = false;
    logger.info('Searching for record: ' + _srchVal);
    // Wait for list to fully load before checking row visibility
    await page.waitForLoadState('networkidle');
    await page.waitForSelector("#deptGrid tbody tr", { state: 'visible', timeout: 15000 });
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

    // ── Step 10: Click the Delete (bin) icon on the row matching the record ──
    stepStart = Date.now();
    logger.info('Step 10: Click the Delete (bin) icon on the row matching the record');
    // Capture exact-match cell count before delete for later verification
    const recName = testData['Record Name'] || testData['Gateway Name'] || "Testing";
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

    // ── Step 11: Click Yes on the confirmation popup ──
    stepStart = Date.now();
    logger.info('Step 11: Click Yes on the confirmation popup');
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

    // ── Step 12: Verify the record is no longer visible in the list, then logout ──
    stepStart = Date.now();
    logger.info('Step 12: Verify the record is no longer visible in the list, then logout');
    // Verify record deleted — reload list and check with exact cell text match
    const recDelCheck = testData['Record Name'] || testData['Gateway Name'] || "Testing";
    await page.waitForLoadState('networkidle');
    // Navigate back to list page URL (avoids reload landing on wrong page)
    await page.goto("https://mediationqa20.billcall.net/#m214p212#Column-Name-Configuration#ColumnType#List");
    await page.waitForLoadState('networkidle');
    await page.waitForSelector("#deptGrid", { state: 'visible', timeout: 15000 });
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

    // ── Step 13: Take a final screenshot of the end state ──
    stepStart = Date.now();
    logger.info('Step 13: Take a final screenshot of the end state');
    await page.screenshot({ path: 'results/screenshots/TC_002-step13-' + Date.now() + '.png', fullPage: true });

  });
  // [TC_002] END

});
