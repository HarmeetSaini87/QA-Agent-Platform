/**
 * Column Name Configuration — CRUD automation
 * Run ID: chat-run-1774440839228
 *
 * All selectors verified from live DOM inspection — 25-Mar-2026
 *
 * Key form selectors:
 *   #GateWayTypeID           — Gateway Type dropdown (value 170 = "39tIY9w85W")
 *   #radiogateway            — Gateway Column radio (default checked)
 *   #AddRow_1                — inner + button (href=javascript:cloneRow())
 *   input[name="ColumnType"] — Column Name text field (in each row)
 *   select[name="FieldTypeID"] — Column Data Type dropdown (in each row)
 *   #btnSaveColType          — Save button
 *   #btnBack                 — Back button
 *   #FileColumns tbody#sortable3 — column grid tbody
 */

const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

const RUN_ID   = 'chat-run-1774440839228';
const BASE_URL = 'https://mediationqa20.billcall.net/';
const USERNAME = 'Superadminuser';
const PASSWORD = 'Admin#1234';
const SS_DIR   = path.resolve('results/screenshots');
const START_AT = new Date().toISOString();

fs.mkdirSync(SS_DIR,    { recursive: true });
fs.mkdirSync('results', { recursive: true });

const steps = [];

async function ss(page, label) {
  const p = path.join(SS_DIR, `${RUN_ID}-${label}.png`);
  await page.screenshot({ path: p, fullPage: true });
  console.log(`  📸 ${p}`);
  return p;
}

function log(n, desc, status, ms, opts = {}) {
  const s = {
    stepNumber: n, description: desc, status, durationMs: ms,
    screenshotPath: opts.shot || null, errorMessage: opts.err || null,
    healEvent: opts.heal || null
  };
  steps.push(s);
  console.log(`  Step ${n}: ${status.toUpperCase()} — ${desc}${opts.err ? '\n    ERR: ' + opts.err : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 180 });
  const ctx     = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page    = await ctx.newPage();
  let overallStatus = 'pass';

  try {

    // ── STEP 1: Navigate to app ───────────────────────────────────────────────
    console.log('\n=== Step 1: Navigate to app ===');
    let t = Date.now();
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');
    log(1, 'Navigate to app (OIDC redirect to SSO)', 'pass', Date.now() - t);

    // ── STEP 2: Login ─────────────────────────────────────────────────────────
    console.log('\n=== Step 2: Login ===');
    t = Date.now();
    await page.waitForSelector('input[name="Username"]', { state: 'visible', timeout: 15000 });
    await page.fill('input[name="Username"]', USERNAME);
    await page.fill('input[name="Password"]', PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      '!location.href.includes("ssoqa") && !location.pathname.includes("/Account/Login")',
      { timeout: 25000 }
    );
    await page.waitForLoadState('networkidle');
    const shot2 = await ss(page, 'step2-logged-in');
    console.log(`  URL: ${page.url()}`);
    log(2, 'Login as Superadminuser', 'pass', Date.now() - t, { shot: shot2 });

    // ── STEP 3: Navigate to Column Name Configuration ─────────────────────────
    console.log('\n=== Step 3: Mediation Config → Column Name Configuration ===');
    t = Date.now();
    await page.click('a:has-text("Mediation Configuration")');
    await page.waitForTimeout(500);
    await page.click('a:has-text("Column Name Configuration")');
    await page.waitForSelector('table tbody', { state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');
    const shot3 = await ss(page, 'step3-list-page');
    log(3, 'Navigate to Column Name Configuration list', 'pass', Date.now() - t, { shot: shot3 });

    // ── STEP 4: Click Add button (#btnCreate) ─────────────────────────────────
    console.log('\n=== Step 4: Click Add (+) button ===');
    t = Date.now();
    await page.waitForSelector('#btnCreate', { state: 'visible', timeout: 10000 });
    await page.click('#btnCreate');
    await page.waitForLoadState('networkidle');
    // Wait for Gateway Type dropdown — verified selector: #GateWayTypeID
    await page.waitForSelector('#GateWayTypeID', { state: 'visible', timeout: 20000 });
    const shot4 = await ss(page, 'step4-add-form');
    log(4, 'Click Add — form opened with #GateWayTypeID', 'pass', Date.now() - t, { shot: shot4 });

    // ── STEP 5: Select Gateway Type "39tIY9w85W" (value=170) ─────────────────
    console.log('\n=== Step 5: Select Gateway Type = 39tIY9w85W ===');
    t = Date.now();
    await page.selectOption('#GateWayTypeID', { value: '170' });
    await page.waitForTimeout(400);
    const gwText = await page.$eval('#GateWayTypeID', el => el.options[el.selectedIndex].text);
    console.log(`  Selected: "${gwText}"`);
    const shot5 = await ss(page, 'step5-gateway-selected');
    log(5, `Gateway Type selected: "${gwText}"`, 'pass', Date.now() - t, { shot: shot5 });

    // ── STEP 6: Ensure "Gateway Column" radio is selected ─────────────────────
    console.log('\n=== Step 6: Gateway Column radio ===');
    t = Date.now();
    const radioChecked = await page.$eval('#radiogateway', el => el.checked);
    console.log(`  #radiogateway already checked: ${radioChecked}`);
    if (!radioChecked) {
      await page.click('label[for="radiogateway"]');
      await page.waitForTimeout(300);
    }
    const shot6 = await ss(page, 'step6-radio');
    log(6, 'Gateway Column radio confirmed selected', 'pass', Date.now() - t, { shot: shot6 });

    // ── STEP 7: Click inner + (calls cloneRow() to add a column row) ──────────
    console.log('\n=== Step 7: Click inner + (cloneRow) ===');
    t = Date.now();
    // #AddRow_1 has 0x0 visual size (absolute-positioned icon) — use JS click
    await page.evaluate(() => {
      const btn = document.getElementById('AddRow_1');
      if (btn) btn.click();
    });
    await page.waitForTimeout(800);
    // Verify a row was added to #sortable3
    const rowCount = await page.locator('#sortable3 tr').count();
    console.log(`  Rows in #sortable3 after cloneRow: ${rowCount}`);
    const shot7 = await ss(page, 'step7-inner-plus');
    if (rowCount === 0) {
      // Try calling cloneRow() directly
      await page.evaluate(() => { if (typeof cloneRow === 'function') cloneRow(); });
      await page.waitForTimeout(600);
      const rc2 = await page.locator('#sortable3 tr').count();
      console.log(`  Rows after direct cloneRow(): ${rc2}`);
    }
    const finalRowCount = await page.locator('#sortable3 tr').count();
    log(7, `Inner + clicked — ${finalRowCount} row(s) in column grid`,
        finalRowCount > 0 ? 'pass' : 'fail', Date.now() - t,
        { shot: shot7, err: finalRowCount > 0 ? null : 'No row added to #sortable3' });
    if (finalRowCount === 0) overallStatus = 'fail';

    // ── STEP 8: Fill Column Name = "Test" ─────────────────────────────────────
    console.log('\n=== Step 8: Fill Column Name = "Test" ===');
    t = Date.now();
    // In each row: input[name="ColumnType"] is the Column Name field
    await page.waitForSelector('#sortable3 input[name="ColumnType"]', { state: 'visible', timeout: 8000 });
    await page.fill('#sortable3 tr:last-child input[name="ColumnType"]', 'Test');
    const colVal = await page.$eval('#sortable3 tr:last-child input[name="ColumnType"]', el => el.value);
    console.log(`  Column Name value: "${colVal}" (app auto-uppercases input)`);
    const shot8 = await ss(page, 'step8-column-name');
    // App has oninput toUpperCase() — "Test" becomes "TEST" — both are valid
    const colOk = colVal.toUpperCase() === 'TEST';
    log(8, `Column Name filled: "${colVal}"`, colOk ? 'pass' : 'fail',
        Date.now() - t, { shot: shot8, err: colOk ? null : `Expected "TEST", got "${colVal}"` });

    // ── STEP 9: Select Column Data Type = "String" ────────────────────────────
    console.log('\n=== Step 9: Select Column Data Type = "String" ===');
    t = Date.now();
    // In each row: select[name="FieldTypeID"] is the Column Data Type dropdown
    await page.waitForSelector('#sortable3 select[name="FieldTypeID"]', { state: 'visible', timeout: 8000 });
    // Inspect available options
    const dtOpts = await page.$$eval('#sortable3 tr:last-child select[name="FieldTypeID"] option',
      opts => opts.map(o => ({ v: o.value, t: o.text }))
    );
    console.log('  DataType options:', JSON.stringify(dtOpts));
    const strOpt = dtOpts.find(o => o.t.toLowerCase() === 'string' || o.t.toLowerCase().includes('string'));
    if (strOpt) {
      await page.selectOption('#sortable3 tr:last-child select[name="FieldTypeID"]', { value: strOpt.v });
      console.log(`  Selected: value="${strOpt.v}" text="${strOpt.t}"`);
    } else {
      // Try by label
      await page.selectOption('#sortable3 tr:last-child select[name="FieldTypeID"]', { label: 'String' });
    }
    const dtVal = await page.$eval('#sortable3 tr:last-child select[name="FieldTypeID"]',
      el => el.options[el.selectedIndex]?.text
    );
    console.log(`  Selected data type: "${dtVal}"`);
    const shot9 = await ss(page, 'step9-data-type');
    const dtOk = dtVal?.toLowerCase().includes('string');
    log(9, `Column Data Type: "${dtVal}"`, dtOk ? 'pass' : 'fail',
        Date.now() - t, { shot: shot9, err: dtOk ? null : `Expected String, got "${dtVal}"` });
    if (!dtOk) overallStatus = 'fail';

    // ── STEP 10: Click Save (#btnSaveColType) and verify success ──────────────
    console.log('\n=== Step 10: Click Save ===');
    t = Date.now();
    await page.click('#btnSaveColType');
    await page.waitForTimeout(1500);
    // Check for success message
    const msgSels = [
      'text=Record saved successfully.',
      'text=Record Save Successfully.',
      '*:has-text("saved successfully")',
      '[class*="success"]:visible',
      '.alert-success:visible',
      '[role="alert"]:visible',
    ];
    let saveOk = false;
    let saveTxt = '';
    for (const s of msgSels) {
      const el = page.locator(s).first();
      const cnt = await el.count();
      if (cnt > 0) {
        saveTxt = ((await el.textContent()) ?? '').trim();
        if (saveTxt.length > 2) { saveOk = true; console.log(`  Save msg via "${s}": "${saveTxt}"`); break; }
      }
    }
    const shot10 = await ss(page, 'step10-save');
    log(10, saveOk ? `Save success: "${saveTxt}"` : 'Save — success message NOT found',
        saveOk ? 'pass' : 'fail', Date.now() - t,
        { shot: shot10, err: saveOk ? null : 'Success toast not visible after save' });
    if (!saveOk) overallStatus = 'fail';

    // ── STEP 11: Click Back (#btnBack) ────────────────────────────────────────
    console.log('\n=== Step 11: Click Back ===');
    t = Date.now();
    await page.click('#btnBack');
    await page.waitForSelector('table tbody', { state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle');
    const shot11 = await ss(page, 'step11-list-page');
    log(11, 'Back to list page', 'pass', Date.now() - t, { shot: shot11 });

    // ── STEP 12: Search/verify "39tIY9w85W" in list ───────────────────────────
    console.log('\n=== Step 12: Verify record "39tIY9w85W" in list ===');
    t = Date.now();
    // Gateway name appears in the list rows
    let rowVisible = await page.locator('tr:has-text("39tIY9w85W")').count() > 0;
    console.log(`  Visible without search: ${rowVisible}`);
    if (!rowVisible) {
      // Try search
      const searchSels = ['input[type="search"]', 'input[placeholder*="search" i]', '#txtSearch', 'input[name*="search" i]'];
      for (const ss2 of searchSels) {
        if (await page.locator(ss2).count() > 0) {
          await page.fill(ss2, '39tIY9w85W');
          const hasSBtn = await page.locator('button:has-text("Search")').count() > 0;
          if (hasSBtn) await page.click('button:has-text("Search")');
          else         await page.keyboard.press('Enter');
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(600);
          break;
        }
      }
      rowVisible = await page.locator('tr:has-text("39tIY9w85W")').count() > 0;
    }
    // Log first rows for diagnostics
    const rowTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table tbody tr')).slice(0, 5)
           .map(r => r.textContent?.trim().replace(/\s+/g, ' '))
    );
    console.log('  First rows:', rowTexts);
    const shot12 = await ss(page, 'step12-verify');
    log(12, rowVisible ? 'Record "39tIY9w85W" visible in list' : 'Record NOT found in list',
        rowVisible ? 'pass' : 'fail', Date.now() - t,
        { shot: shot12, err: rowVisible ? null : 'Record not visible after search' });
    if (!rowVisible) overallStatus = 'fail';

    // ── STEP 13: Click delete bin on record row ────────────────────────────────
    console.log('\n=== Step 13: Click Delete on record row ===');
    t = Date.now();
    let deleteClicked = false;
    const delSels = ['.fa-trash', '.fa-trash-alt', '[data-action="delete"]', 'button[title*="delete" i]'];
    for (const del of delSels) {
      const sel = `tr:has-text("39tIY9w85W") ${del}`;
      if (await page.locator(sel).count() > 0) {
        await page.click(sel);
        deleteClicked = true;
        console.log(`  Delete via: ${sel}`);
        break;
      }
    }
    if (!deleteClicked) {
      // Find row by index and click its trash icon
      const idx = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        return rows.findIndex(r => r.textContent?.includes('39tIY9w85W'));
      });
      if (idx >= 0) {
        const trash = page.locator('table tbody tr').nth(idx).locator('.fa-trash, .fa-trash-alt');
        if (await trash.count() > 0) {
          await trash.first().click();
          deleteClicked = true;
          console.log(`  Delete via row index ${idx}`);
        }
      }
    }
    await page.waitForTimeout(500);
    const shot13 = await ss(page, 'step13-delete');
    log(13, deleteClicked ? 'Clicked delete on record row' : 'Delete — row NOT found',
        deleteClicked ? 'pass' : 'fail', Date.now() - t,
        { shot: shot13, err: deleteClicked ? null : 'Could not click delete on "39tIY9w85W" row' });
    if (!deleteClicked) overallStatus = 'fail';

    // ── STEP 14: Confirm delete — click Yes ───────────────────────────────────
    console.log('\n=== Step 14: Click Yes on confirmation modal ===');
    t = Date.now();
    const modalSels = ['.modal:visible', '.modal-dialog:visible', '[role="dialog"]:visible', '.swal2-container:visible'];
    for (const ms of modalSels) {
      try { await page.waitForSelector(ms, { state: 'visible', timeout: 8000 }); console.log(`  Modal: ${ms}`); break; }
      catch { /* try next */ }
    }
    const yesSels = [
      '.modal-footer button:has-text("Yes")',
      '.modal button:has-text("Yes")',
      '[role="dialog"] button:has-text("Yes")',
      '.swal2-confirm',
      'button:has-text("Yes")',
    ];
    let yesClicked = false;
    for (const ys of yesSels) {
      if (await page.locator(ys).count() > 0) {
        await page.click(ys);
        yesClicked = true;
        console.log(`  Yes via: ${ys}`);
        break;
      }
    }
    if (yesClicked) {
      try { await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 }); } catch { /* ok */ }
      await page.waitForLoadState('networkidle');
    }
    const shot14 = await ss(page, 'step14-confirm');
    log(14, yesClicked ? 'Confirmation — Yes clicked' : 'Confirmation — Yes NOT found',
        yesClicked ? 'pass' : 'fail', Date.now() - t,
        { shot: shot14, err: yesClicked ? null : 'Yes button not found in modal' });
    if (!yesClicked) overallStatus = 'fail';

    // ── STEP 15: Verify "deleted successfully" message ────────────────────────
    console.log('\n=== Step 15: Verify deletion message ===');
    t = Date.now();
    await page.waitForTimeout(600);
    const delMsgSels = [
      'text=Record(s) deleted successfully.',
      '*:has-text("deleted successfully")',
      '[class*="success"]:visible',
      '.alert-success:visible',
      '[role="alert"]:visible',
    ];
    let delOk = false;
    let delTxt = '';
    for (const s of delMsgSels) {
      const cnt = await page.locator(s).count();
      if (cnt > 0) {
        delTxt = ((await page.locator(s).first().textContent()) ?? '').trim();
        if (delTxt.length > 2) { delOk = true; console.log(`  Del msg via "${s}": "${delTxt}"`); break; }
      }
    }
    const shot15 = await ss(page, 'step15-deleted');
    log(15, delOk ? `Deletion confirmed: "${delTxt}"` : 'Deletion message NOT found',
        delOk ? 'pass' : 'fail', Date.now() - t,
        { shot: shot15, err: delOk ? null : 'Deletion success message not visible' });
    if (!delOk) overallStatus = 'fail';

    // ── STEP 16: Logout ───────────────────────────────────────────────────────
    console.log('\n=== Step 16: Logout ===');
    t = Date.now();
    const logoutSels = ['[title*="logout" i]', '.fa-power-off', '.fa-sign-out', 'a:has-text("Logout")'];
    let loggedOut = false;
    for (const ls of logoutSels) {
      if (await page.locator(ls).count() > 0) {
        await page.click(ls);
        loggedOut = true;
        console.log(`  Logout via: ${ls}`);
        break;
      }
    }
    await page.waitForLoadState('networkidle');
    const shot16 = await ss(page, 'chat-run-1774440839228-final');
    log(16, loggedOut ? 'Logged out successfully' : 'Logout — button not found',
        loggedOut ? 'pass' : 'fail', Date.now() - t,
        { shot: shot16, err: loggedOut ? null : 'Logout button not found' });

  } catch (err) {
    console.error('\nUNHANDLED ERROR:', err.message);
    const shot = await ss(page, 'fatal-error').catch(() => null);
    steps.push({
      stepNumber: steps.length + 1, description: 'Fatal error', status: 'fail',
      durationMs: 0, screenshotPath: shot, errorMessage: err.message
    });
    overallStatus = 'fail';
  } finally {
    await browser.close();
  }

  // ── Write results ─────────────────────────────────────────────────────────
  const failedSteps = steps.filter(s => s.status === 'fail');
  const result = {
    runId:      RUN_ID,
    planId:     'chat-instruction',
    startedAt:  START_AT,
    finishedAt: new Date().toISOString(),
    totalTests: 1,
    passed:     failedSteps.length === 0 ? 1 : 0,
    failed:     failedSteps.length === 0 ? 0 : 1,
    skipped:    0,
    testResults: [{
      testCaseId:  'CHAT_001',
      title:       'Column Name Configuration — Add and Delete Record',
      status:      overallStatus,
      durationMs:  steps.reduce((s, r) => s + (r.durationMs || 0), 0),
      startedAt:   START_AT,
      finishedAt:  new Date().toISOString(),
      steps
    }]
  };
  const outPath = path.resolve('results', `${RUN_ID}.json`);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\n=== Results written to: ${outPath}`);
  console.log(`Overall: ${overallStatus.toUpperCase()} | Steps: ${steps.length} | Failed: ${failedSteps.length}`);
  if (failedSteps.length > 0) {
    console.log('Failed:');
    failedSteps.forEach(s => console.log(`  Step ${s.stepNumber}: ${s.description} — ${s.errorMessage}`));
  } else {
    console.log('All steps PASSED ✓');
  }
})();
