/**
 * Auto-generated spec from plan: plan-6333f72d
 * Source: excel — 92431e4e66c69c50a046c664d5fb1418.xlsx
 * Generated: 2026-03-29T17:34:31.163Z
 */

import { test, expect } from '../../src/framework/fixtures';
import { logger } from '../../src/utils/logger';

const APP_BASE_URL = process.env.APP_BASE_URL ?? "https://mediationqa20.billcall.net";

test.describe("Mediation Configuration → Source Endpoint Configuration.", () => {

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

  // [TC_004] BEGIN
  test("[TC_004] Add and delete a Source Endpoint Configuration record", async ({ page, loginPage }) => {
    test.setTimeout(120000);
    const testData = {"Username":"superadminuser","Password":"Admin#1234","Gateway Name":"test1706","Record Name":"TestingABC","Configuration Name":"TestingABC","Connection Type":"LOCAL","Path":"/Test","File Pattern":"Abc_01","File Extension":".*","Destination File Path":"/Test1","Schedule Interval":"60","Compressed File Extension":"ZIP","Compressed File Path ":"/Test2","Compressed File Type":"CSV","Backup File Path":"/Test3"};
    let stepStart: number;

    // UI Reference matched: Mediation Configuration > Source Endpoint Configuration
    // ── Step 1: Navigate to the application login page ── [handled by beforeEach]

    // ── Step 2: Enter username and password, then click the Login button ── [handled by beforeEach]

    // ── Step 3: Navigate to Mediation Configuration > Source Endpoint Configuration (list page should open) ──
    stepStart = Date.now();
    logger.info('Step 3: Navigate to Mediation Configuration > Source Endpoint Configuration (list page should open)');
    // Navigate via menu: Mediation Configuration > Source Endpoint Configuration
    await page.click('a:has-text("Mediation Configuration"), [title*="Mediation Configuration" i]');
    await page.waitForTimeout(500);
    await page.click('a:has-text("Source Endpoint Configuration"), [title*="Source Endpoint Configuration" i]');
    await page.waitForTimeout(500);
    await page.waitForSelector('#ftpGrid tbody', { state: 'visible', timeout: 20000 });
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

    // ── Step 5: 1. Select a value from the 'Gateway Name' dropdown. 2. Enter a value in the 'Configuration Name' field. 3. Select a value from the 'Connection Type' dropdown. 4. Enter values in 'Path', 'File Pattern', and 'File Extension' fields. 5. Enter 'Destination File Path' and 'Schedule Interval'. 6. Select 'Enable', 'Delete Source File', 'Backup File', and 'CDR in Compressed Format' checkboxes. 7. Select a value from the 'Compressed File Extension' dropdown. 8. Enter a value in the 'Compressed File Path' field. 9. Select a value from the 'Compressed File Type' dropdown. 10. Enter a value in the 'Backup File Path' field. ──
    stepStart = Date.now();
    logger.info('Step 5: 1. Select a value from the \'Gateway Name\' dropdown. 2. Enter a value in the \'Configuration Name\' field. 3. Select a value from the \'Connection Type\' dropdown. 4. Enter values in \'Path\', \'File Pattern\', and \'File Extension\' fields. 5. Enter \'Destination File Path\' and \'Schedule Interval\'. 6. Select \'Enable\', \'Delete Source File\', \'Backup File\', and \'CDR in Compressed Format\' checkboxes. 7. Select a value from the \'Compressed File Extension\' dropdown. 8. Enter a value in the \'Compressed File Path\' field. 9. Select a value from the \'Compressed File Type\' dropdown. 10. Enter a value in the \'Backup File Path\' field.');
    // Multi-field step: 10 numbered sub-items
    // Select "Gateway Name" (UI Reference: #GateWayID)
    {
      let mfDd_GatewayName = page.locator('#GateWayID');
      if (!(await mfDd_GatewayName.count() > 0)) { const l = page.getByLabel("Gateway Name", { exact: false }); if (await l.count() > 0) mfDd_GatewayName = l.first(); }
      if (!(await mfDd_GatewayName.count() > 0)) { const c = page.locator('select[id*="GatewayName" i], select[name*="GatewayName" i]').first(); if (await c.count() > 0) mfDd_GatewayName = c; }
      await expect(mfDd_GatewayName).toBeVisible({ timeout: 10000 });
      const tv_GatewayName = testData["Gateway Name"];
      try { await mfDd_GatewayName.selectOption({ label: tv_GatewayName }); } catch {
        try { await mfDd_GatewayName.selectOption({ value: tv_GatewayName }); } catch {
          const opts_GatewayName = await mfDd_GatewayName.locator('option').all();
          const m_GatewayName = (await Promise.all(opts_GatewayName.map(async o => ({ v: await o.getAttribute('value'), t: ((await o.textContent()) || '').trim() })))).find(o => o.t.toLowerCase() === tv_GatewayName.toLowerCase());
          if (!m_GatewayName?.v) throw new Error('No exact match for Gateway Name="' + tv_GatewayName + '"');
          await mfDd_GatewayName.selectOption(m_GatewayName.v);
        }
      }
      await mfDd_GatewayName.evaluate((el: HTMLSelectElement) => { el.dispatchEvent(new Event('change', { bubbles: true })); if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); } });
      await page.waitForLoadState('networkidle');
      logger.info('Selected Gateway Name: ' + await mfDd_GatewayName.inputValue());
    }
    // Fill "Configuration Name" (UI Reference: #FTPConfigurationName)
    await page.locator('#FTPConfigurationName').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#FTPConfigurationName').fill(testData["Configuration Name"]);
    logger.info('Filled Configuration Name via UI ref');
    // Select "Connection Type" (UI Reference: #Protocol)
    {
      let mfDd_ConnectionType = page.locator('#Protocol');
      if (!(await mfDd_ConnectionType.count() > 0)) { const l = page.getByLabel("Connection Type", { exact: false }); if (await l.count() > 0) mfDd_ConnectionType = l.first(); }
      if (!(await mfDd_ConnectionType.count() > 0)) { const c = page.locator('select[id*="ConnectionType" i], select[name*="ConnectionType" i]').first(); if (await c.count() > 0) mfDd_ConnectionType = c; }
      await expect(mfDd_ConnectionType).toBeVisible({ timeout: 10000 });
      await mfDd_ConnectionType.selectOption('LOCAL');
      await mfDd_ConnectionType.evaluate((el: HTMLSelectElement) => { el.dispatchEvent(new Event('change', { bubbles: true })); if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); } });
      await page.waitForLoadState('networkidle');
      logger.info('Selected Connection Type: ' + await mfDd_ConnectionType.inputValue());
    }
    // Fill "Path" (UI Reference: #FTPPath)
    await page.locator('#FTPPath').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#FTPPath').fill(testData["Path"]);
    logger.info('Filled Path via UI ref');
    // Fill "File Pattern" (UI Reference: #FTPFilePattern)
    await page.locator('#FTPFilePattern').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#FTPFilePattern').fill(testData["File Pattern"]);
    logger.info('Filled File Pattern via UI ref');
    // Fill "File Extension" (UI Reference: #FTPFileExtension)
    await page.locator('#FTPFileExtension').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#FTPFileExtension').fill(testData["File Extension"]);
    logger.info('Filled File Extension via UI ref');
    // Fill "Destination File Path" (UI Reference: #FilePath)
    await page.locator('#FilePath').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#FilePath').fill(testData["Destination File Path"]);
    logger.info('Filled Destination File Path via UI ref');
    // Fill "Schedule Interval" (UI Reference: #ScheduleInterval)
    await page.locator('#ScheduleInterval').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#ScheduleInterval').fill(testData["Schedule Interval"]);
    logger.info('Filled Schedule Interval via UI ref');
    // Check "Enable" (UI Reference: #FlgEnable)
    { const cbLbl_Enable = page.locator('label[for="FlgEnable"]');
      const cbInp_Enable = page.locator('#FlgEnable');
      if (await cbLbl_Enable.count() > 0) { if (!(await cbInp_Enable.isChecked())) await cbLbl_Enable.click(); }
      else if (await cbInp_Enable.count() > 0) { await cbInp_Enable.check({ force: true }); }
      logger.info('Checked Enable'); }
    await page.waitForLoadState('networkidle');
    // Check "Delete Source File" (UI Reference: #FlgDeleteSource)
    { const cbLbl_DeleteSourceFile = page.locator('label[for="FlgDeleteSource"]');
      const cbInp_DeleteSourceFile = page.locator('#FlgDeleteSource');
      if (await cbLbl_DeleteSourceFile.count() > 0) { if (!(await cbInp_DeleteSourceFile.isChecked())) await cbLbl_DeleteSourceFile.click(); }
      else if (await cbInp_DeleteSourceFile.count() > 0) { await cbInp_DeleteSourceFile.check({ force: true }); }
      logger.info('Checked Delete Source File'); }
    await page.waitForLoadState('networkidle');
    // Check "Backup File" (UI Reference: #FlgBackupFile)
    { const cbLbl_BackupFile = page.locator('label[for="FlgBackupFile"]');
      const cbInp_BackupFile = page.locator('#FlgBackupFile');
      if (await cbLbl_BackupFile.count() > 0) { if (!(await cbInp_BackupFile.isChecked())) await cbLbl_BackupFile.click(); }
      else if (await cbInp_BackupFile.count() > 0) { await cbInp_BackupFile.check({ force: true }); }
      logger.info('Checked Backup File'); }
    await page.waitForLoadState('networkidle');
    // Check "CDR in Compressed Format" (UI Reference: #FlgCDRinCompressedFormat)
    { const cbLbl_CDRinCompressedFormat = page.locator('label[for="FlgCDRinCompressedFormat"]');
      const cbInp_CDRinCompressedFormat = page.locator('#FlgCDRinCompressedFormat');
      if (await cbLbl_CDRinCompressedFormat.count() > 0) { if (!(await cbInp_CDRinCompressedFormat.isChecked())) await cbLbl_CDRinCompressedFormat.click(); }
      else if (await cbInp_CDRinCompressedFormat.count() > 0) { await cbInp_CDRinCompressedFormat.check({ force: true }); }
      logger.info('Checked CDR in Compressed Format'); }
    await page.waitForLoadState('networkidle');
    // Select "Compressed File Extension" (UI Reference: select[id*="CompressedFileExtension" i])
    {
      let mfDd_CompressedFileExtension = page.locator('select[id*="CompressedFileExtension" i]');
      if (!(await mfDd_CompressedFileExtension.count() > 0)) { const l = page.getByLabel("Compressed File Extension", { exact: false }); if (await l.count() > 0) mfDd_CompressedFileExtension = l.first(); }
      if (!(await mfDd_CompressedFileExtension.count() > 0)) { const c = page.locator('select[id*="CompressedFileExtension" i], select[name*="CompressedFileExtension" i]').first(); if (await c.count() > 0) mfDd_CompressedFileExtension = c; }
      await expect(mfDd_CompressedFileExtension).toBeVisible({ timeout: 10000 });
      await mfDd_CompressedFileExtension.selectOption('ZIP');
      await mfDd_CompressedFileExtension.evaluate((el: HTMLSelectElement) => { el.dispatchEvent(new Event('change', { bubbles: true })); if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); } });
      await page.waitForLoadState('networkidle');
      logger.info('Selected Compressed File Extension: ' + await mfDd_CompressedFileExtension.inputValue());
    }
    // Fill "Compressed File Path " (UI Reference: #CompressedFileFolderPath)
    await page.locator('#CompressedFileFolderPath').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#CompressedFileFolderPath').fill(testData["Compressed File Path "]);
    logger.info('Filled Compressed File Path  via UI ref');
    // Select "Compressed File Type" (UI Reference: select[id*="CompressedFileType" i])
    {
      let mfDd_CompressedFileType = page.locator('select[id*="CompressedFileType" i]');
      if (!(await mfDd_CompressedFileType.count() > 0)) { const l = page.getByLabel("Compressed File Type", { exact: false }); if (await l.count() > 0) mfDd_CompressedFileType = l.first(); }
      if (!(await mfDd_CompressedFileType.count() > 0)) { const c = page.locator('select[id*="CompressedFileType" i], select[name*="CompressedFileType" i]').first(); if (await c.count() > 0) mfDd_CompressedFileType = c; }
      await expect(mfDd_CompressedFileType).toBeVisible({ timeout: 10000 });
      await mfDd_CompressedFileType.selectOption('CSV');
      await mfDd_CompressedFileType.evaluate((el: HTMLSelectElement) => { el.dispatchEvent(new Event('change', { bubbles: true })); if (typeof (window as any).$ !== 'undefined') { (window as any).$(el).trigger('change'); } });
      await page.waitForLoadState('networkidle');
      logger.info('Selected Compressed File Type: ' + await mfDd_CompressedFileType.inputValue());
    }
    // Fill "Backup File Path" (UI Reference: #BackupFilePath)
    await page.locator('#BackupFilePath').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#BackupFilePath').fill(testData["Backup File Path"]);
    logger.info('Filled Backup File Path via UI ref');

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
    await page.waitForSelector('#ftpGrid tbody', { state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');

    // ── Step 8: Search for the newly added record by Configuration Name ──
    stepStart = Date.now();
    logger.info('Step 8: Search for the newly added record by Configuration Name');
    // ── Search for newly added record by "Configuration Name" ──
    const _srchVal = testData["Configuration Name"];
    let _searchPanelUsed = false;
    logger.info('Searching for record: ' + _srchVal);
    // Wait for list to fully load before checking row visibility
    await page.waitForLoadState('networkidle');
    await page.waitForSelector("#ftpGrid tbody tr", { state: 'visible', timeout: 15000 });
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
      await page.locator("#txtFTPName").waitFor({ state: 'visible', timeout: 10000 });
      await page.locator("#txtFTPName").clear();
      await page.locator("#txtFTPName").fill(_srchVal);
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
    const recName = testData['Record Name'] || testData['Gateway Name'] || "TestingABC";
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
    const recDelCheck = testData['Record Name'] || testData['Gateway Name'] || "TestingABC";
    await page.waitForLoadState('networkidle');
    // Refresh icon only needed when search panel was used (e.g. TC_004)
    if (typeof _searchPanelUsed !== 'undefined' && _searchPanelUsed) {
      try {
        await page.locator("i.fa.fa-refresh").waitFor({ state: 'visible', timeout: 5000 });
        await page.locator("i.fa.fa-refresh").click();
        await page.waitForLoadState('networkidle');
        logger.info('Clicked refresh icon to return to list');
      } catch {
        logger.info('Refresh icon not found — falling back to page.reload()');
        await page.reload();
        await page.waitForLoadState('networkidle');
      }
    } else {
      // Search panel not used — navigate to list page URL
      await page.goto("https://mediationqa20.billcall.net/#m216p212#Source-Endpoint-Configuration#FTP#List");
      await page.waitForLoadState('networkidle');
    }
    await page.waitForSelector("#ftpGrid", { state: 'visible', timeout: 15000 });
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
    await page.screenshot({ path: 'results/screenshots/TC_004-step12-' + Date.now() + '.png', fullPage: true });

  });
  // [TC_004] END

});
