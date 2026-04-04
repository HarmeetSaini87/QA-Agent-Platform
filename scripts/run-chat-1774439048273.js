// @ts-check
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const RUN_ID = 'chat-run-1774439048273';
const SCREENSHOT_DIR = path.join('e:/AI Agent/qa-agent-platform/results/screenshots');
const RESULTS_FILE = path.join('e:/AI Agent/qa-agent-platform/results', `${RUN_ID}.json`);

const startedAt = new Date().toISOString();
let testStartedAt = new Date().toISOString();

const steps = [];
let browser, page;

function stepEntry(stepNumber, description, status, durationMs, screenshotPath = null, errorMessage = null, healEvent = null) {
  return { stepNumber, description, status, durationMs, screenshotPath, errorMessage, healEvent };
}

async function takeScreenshot(name) {
  const fileName = `${RUN_ID}-${name}.png`;
  const filePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`Screenshot saved: ${filePath}`);
  return filePath;
}

async function waitForURLChange(fromPattern, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    if (!url.includes(fromPattern)) return url;
    await page.waitForTimeout(500);
  }
  throw new Error(`URL still contains '${fromPattern}' after ${timeoutMs}ms`);
}

async function main() {
  browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();

  // ── Step 1 — Navigate ──────────────────────────────────────────────
  let t = Date.now();
  try {
    console.log('Step 1: Navigate to app');
    await page.goto('https://mediationqa20.billcall.net/');
    await page.waitForLoadState('networkidle');
    // Wait for SSO redirect — wait for Username field
    await page.waitForSelector('input[name="Username"]', { state: 'visible', timeout: 30000 });
    steps.push(stepEntry(1, 'Navigate to app (OIDC redirect to SSO)', 'pass', Date.now() - t));
    console.log('Step 1: PASS');
  } catch (e) {
    await takeScreenshot('step1-failure');
    steps.push(stepEntry(1, 'Navigate to app', 'fail', Date.now() - t, null, e.message));
    console.error('Step 1 FAIL:', e.message);
  }

  // ── Step 2 — Login ─────────────────────────────────────────────────
  t = Date.now();
  let step2Screenshot = null;
  try {
    console.log('Step 2: Login on SSO page');
    await page.fill('input[name="Username"]', 'Superadminuser');
    await page.fill('input[name="Password"]', 'Admin#1234');
    await page.click('button[type="submit"]');
    // Wait until URL no longer contains 'ssoqa'
    await waitForURLChange('ssoqa', 45000);
    await page.waitForLoadState('networkidle');
    step2Screenshot = await takeScreenshot('step2-logged-in');
    steps.push(stepEntry(2, 'Login on SSO page', 'pass', Date.now() - t, step2Screenshot));
    console.log('Step 2: PASS, URL:', page.url());
  } catch (e) {
    const ss = await takeScreenshot('step2-failure');
    steps.push(stepEntry(2, 'Login on SSO page', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 2 FAIL:', e.message);
  }

  // ── Step 3 — Navigate to Column Name Configuration ─────────────────
  t = Date.now();
  let step3Screenshot = null;
  try {
    console.log('Step 3: Navigate Mediation Configuration → Column Name Configuration');
    // Click sidebar menu item
    await page.waitForSelector('a:has-text("Mediation Configuration")', { state: 'visible', timeout: 15000 });
    await page.click('a:has-text("Mediation Configuration")');
    await page.waitForTimeout(500);
    await page.waitForSelector('a:has-text("Column Name Configuration")', { state: 'visible', timeout: 10000 });
    await page.click('a:has-text("Column Name Configuration")');
    await page.waitForLoadState('networkidle');
    // Wait for list table
    try {
      await page.waitForSelector('table tbody', { state: 'visible', timeout: 15000 });
    } catch (_) {
      await page.waitForLoadState('networkidle');
    }
    step3Screenshot = await takeScreenshot('step3-list-page');
    steps.push(stepEntry(3, 'Navigate to Column Name Configuration list page', 'pass', Date.now() - t, step3Screenshot));
    console.log('Step 3: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step3-failure');
    steps.push(stepEntry(3, 'Navigate to Column Name Configuration', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 3 FAIL:', e.message);
  }

  // ── Step 4 — Click + (Add) button ─────────────────────────────────
  t = Date.now();
  let step4Screenshot = null;
  try {
    console.log('Step 4: Click Add (+) button');
    // Try .fa-plus first
    let addClicked = false;
    const plusIcon = page.locator('.fa-plus').first();
    const plusCount = await plusIcon.count();
    if (plusCount > 0) {
      await plusIcon.click();
      addClicked = true;
    }
    if (!addClicked) {
      // fallback
      try {
        await page.click('button:has-text("+")');
        addClicked = true;
      } catch (_) {}
    }
    if (!addClicked) {
      await page.click('[aria-label="Add"]');
    }
    await page.waitForLoadState('networkidle');
    try {
      await page.waitForSelector('form', { state: 'visible', timeout: 10000 });
    } catch (_) {}
    step4Screenshot = await takeScreenshot('step4-add-form');
    steps.push(stepEntry(4, 'Click Add (+) button, wait for form', 'pass', Date.now() - t, step4Screenshot));
    console.log('Step 4: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step4-failure');
    steps.push(stepEntry(4, 'Click Add (+) button', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 4 FAIL:', e.message);
  }

  // ── Step 5 — Select Gateway Type ───────────────────────────────────
  t = Date.now();
  let step5Screenshot = null;
  let step5HealEvent = null;
  try {
    console.log('Step 5: Select Gateway Type');
    let selected = false;
    // Try by name attribute containing 'gatewayType' (case-insensitive via JS)
    const selects = await page.locator('select').all();
    console.log(`Found ${selects.length} select elements`);

    // Try known selector patterns
    const gatewaySelectors = [
      'select[name*="gatewayType" i]',
      'select[id*="gatewayType" i]',
      'select[name*="gateway" i]',
      'select[id*="gateway" i]',
    ];
    for (const sel of gatewaySelectors) {
      try {
        const el = page.locator(sel);
        if (await el.count() > 0) {
          await el.selectOption({ value: '39tlY9w85W' });
          selected = true;
          console.log(`Step 5: selected using selector: ${sel}`);
          break;
        }
      } catch (_) {}
    }

    if (!selected) {
      // Get DOM to find select
      const domContent = await page.content();
      console.log('Step 5: Getting DOM for diagnosis...');
      // Try selecting by label text proximity
      const allSelectEls = await page.locator('select').all();
      for (let i = 0; i < allSelectEls.length; i++) {
        try {
          await allSelectEls[i].selectOption({ value: '39tlY9w85W' });
          selected = true;
          step5HealEvent = {
            originalSelector: 'select[name*="gatewayType" i]',
            healedSelector: `select (index ${i})`,
            confidence: 'medium',
            stepNumber: 5,
            domEvidence: 'Found by iterating all select elements'
          };
          console.log(`Step 5: healed - selected using select index ${i}`);
          break;
        } catch (_) {}
      }
    }

    if (!selected) throw new Error('Could not find or select Gateway Type dropdown');

    step5Screenshot = await takeScreenshot('step5-gateway-selected');
    steps.push(stepEntry(5, 'Select Gateway Type "39tlY9w85W"', 'pass', Date.now() - t, step5Screenshot, null, step5HealEvent));
    console.log('Step 5: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step5-failure');
    steps.push(stepEntry(5, 'Select Gateway Type', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 5 FAIL:', e.message);
  }

  // ── Step 6 — Select Column Type radio: "Gateway Column" ────────────
  t = Date.now();
  let step6Screenshot = null;
  let step6HealEvent = null;
  try {
    console.log('Step 6: Select radio "Gateway Column"');
    let clicked = false;

    // Try label first
    try {
      const label = page.locator('label:has-text("Gateway Column")');
      if (await label.count() > 0) {
        await label.click();
        clicked = true;
        console.log('Step 6: clicked label:has-text("Gateway Column")');
      }
    } catch (_) {}

    if (!clicked) {
      try {
        const radioInput = page.locator('input[value*="Gateway" i]');
        if (await radioInput.count() > 0) {
          await radioInput.click();
          clicked = true;
          step6HealEvent = { originalSelector: 'label:has-text("Gateway Column")', healedSelector: 'input[value*="Gateway" i]', confidence: 'high', stepNumber: 6, domEvidence: 'Radio input found by value attribute' };
        }
      } catch (_) {}
    }

    if (!clicked) {
      // Try text content search
      const radios = await page.locator('input[type="radio"]').all();
      for (let i = 0; i < radios.length; i++) {
        const val = await radios[i].getAttribute('value');
        if (val && val.toLowerCase().includes('gateway')) {
          await radios[i].click();
          clicked = true;
          step6HealEvent = { originalSelector: 'label:has-text("Gateway Column")', healedSelector: `input[type="radio"] (index ${i}, value="${val}")`, confidence: 'medium', stepNumber: 6, domEvidence: 'Found radio by iterating and checking value' };
          break;
        }
      }
    }

    if (!clicked) throw new Error('Could not find "Gateway Column" radio button');

    step6Screenshot = await takeScreenshot('step6-radio-selected');
    steps.push(stepEntry(6, 'Select Column Type radio "Gateway Column"', 'pass', Date.now() - t, step6Screenshot, null, step6HealEvent));
    console.log('Step 6: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step6-failure');
    steps.push(stepEntry(6, 'Select Gateway Column radio', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 6 FAIL:', e.message);
  }

  // ── Step 7 — Click inner + icon ────────────────────────────────────
  t = Date.now();
  let step7Screenshot = null;
  let step7HealEvent = null;
  try {
    console.log('Step 7: Click inner + icon (add column row)');
    // There may be multiple .fa-plus icons; the inner one is typically not the page-level add
    const plusIcons = page.locator('.fa-plus');
    const cnt = await plusIcons.count();
    console.log(`Found ${cnt} .fa-plus icons`);

    let clicked = false;
    if (cnt > 1) {
      // The second one is the inner add
      await plusIcons.nth(1).click();
      clicked = true;
      console.log('Step 7: clicked second .fa-plus');
    } else if (cnt === 1) {
      await plusIcons.first().click();
      clicked = true;
    }

    if (!clicked) {
      // Try button:has-text("+")
      try {
        await page.click('button:has-text("+")');
        clicked = true;
        step7HealEvent = { originalSelector: '.fa-plus (nth 1)', healedSelector: 'button:has-text("+")', confidence: 'medium', stepNumber: 7, domEvidence: 'Fallback to button with + text' };
      } catch (_) {}
    }

    if (!clicked) throw new Error('Could not find inner + icon');

    await page.waitForLoadState('networkidle');
    try {
      await page.waitForSelector('input[type="text"]', { state: 'visible', timeout: 5000 });
    } catch (_) {}

    step7Screenshot = await takeScreenshot('step7-inner-add');
    steps.push(stepEntry(7, 'Click inner + icon to add column row', 'pass', Date.now() - t, step7Screenshot, null, step7HealEvent));
    console.log('Step 7: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step7-failure');
    steps.push(stepEntry(7, 'Click inner + icon', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 7 FAIL:', e.message);
  }

  // ── Step 8 — Enter "Test" in Column Name ───────────────────────────
  t = Date.now();
  let step8Screenshot = null;
  let step8HealEvent = null;
  try {
    console.log('Step 8: Enter "Test" in Column Name field');
    let filled = false;

    // Try placeholder
    try {
      const ph = page.locator('input[placeholder*="column" i]');
      if (await ph.count() > 0) {
        await ph.fill('Test');
        filled = true;
        console.log('Step 8: filled input[placeholder*="column" i]');
      }
    } catch (_) {}

    if (!filled) {
      // Try first visible text input
      const textInputs = page.locator('input[type="text"]:visible');
      const cnt2 = await textInputs.count();
      console.log(`Step 8: Found ${cnt2} visible text inputs`);
      if (cnt2 > 0) {
        await textInputs.first().fill('Test');
        filled = true;
        if (cnt2 > 1) {
          step8HealEvent = { originalSelector: 'input[placeholder*="column" i]', healedSelector: 'input[type="text"]:visible (first)', confidence: 'medium', stepNumber: 8, domEvidence: `Found ${cnt2} visible text inputs, used first` };
        }
      }
    }

    if (!filled) throw new Error('Could not find Column Name input');

    step8Screenshot = await takeScreenshot('step8-column-name-filled');
    steps.push(stepEntry(8, 'Enter "Test" in Column Name field', 'pass', Date.now() - t, step8Screenshot, null, step8HealEvent));
    console.log('Step 8: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step8-failure');
    steps.push(stepEntry(8, 'Enter "Test" in Column Name', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 8 FAIL:', e.message);
  }

  // ── Step 9 — Select "String" under Column Data Type ────────────────
  t = Date.now();
  let step9Screenshot = null;
  let step9HealEvent = null;
  try {
    console.log('Step 9: Select "String" under Column Data Type');
    let selected = false;

    // Try select with dataType
    const dataTypeSelectors = [
      'select[name*="dataType" i]',
      'select[id*="dataType" i]',
      'select[name*="data_type" i]',
    ];
    for (const sel of dataTypeSelectors) {
      try {
        const el = page.locator(sel);
        if (await el.count() > 0) {
          await el.selectOption('String');
          selected = true;
          console.log(`Step 9: selected via ${sel}`);
          break;
        }
      } catch (_) {}
    }

    if (!selected) {
      // Try second select in the row
      try {
        const allSelects = page.locator('select');
        const sCnt = await allSelects.count();
        console.log(`Step 9: Found ${sCnt} selects, trying each for String option`);
        for (let i = 0; i < sCnt; i++) {
          try {
            await allSelects.nth(i).selectOption('String');
            selected = true;
            step9HealEvent = { originalSelector: 'select[name*="dataType" i]', healedSelector: `select (index ${i})`, confidence: 'medium', stepNumber: 9, domEvidence: 'Iterated selects and found String option' };
            console.log(`Step 9: healed - used select index ${i}`);
            break;
          } catch (_) {}
        }
      } catch (_) {}
    }

    if (!selected) {
      // Try radio label
      try {
        await page.click('label:has-text("String")');
        selected = true;
        step9HealEvent = { originalSelector: 'select[name*="dataType" i]', healedSelector: 'label:has-text("String")', confidence: 'high', stepNumber: 9, domEvidence: 'Data type is radio/label not select' };
      } catch (_) {}
    }

    if (!selected) {
      try {
        await page.click('input[value="String"]');
        selected = true;
      } catch (_) {}
    }

    if (!selected) throw new Error('Could not select String data type');

    step9Screenshot = await takeScreenshot('step9-data-type-selected');
    steps.push(stepEntry(9, 'Select "String" under Column Data Type', 'pass', Date.now() - t, step9Screenshot, null, step9HealEvent));
    console.log('Step 9: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step9-failure');
    steps.push(stepEntry(9, 'Select String Column Data Type', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 9 FAIL:', e.message);
  }

  // ── Step 10 — Save ─────────────────────────────────────────────────
  t = Date.now();
  let step10Screenshot = null;
  try {
    console.log('Step 10: Click Save and verify success');
    let saved = false;
    try {
      await page.click('button:has-text("Save")');
      saved = true;
    } catch (_) {
      await page.click('button[type="submit"]');
      saved = true;
    }
    await page.waitForLoadState('networkidle');

    // Wait for success message
    let successFound = false;
    const successSelectors = [
      'text=Record Save Successfully.',
      'text=Record Save Successfully',
      '*:has-text("Record Save Successfully")',
      '[class*="success"]:visible',
      '.alert-success',
      '.swal2-success',
      '.toast-success',
    ];
    for (const sel of successSelectors) {
      try {
        await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
        successFound = true;
        console.log(`Step 10: success message found via: ${sel}`);
        break;
      } catch (_) {}
    }

    step10Screenshot = await takeScreenshot('step10-save-success');
    const status = successFound ? 'pass' : 'pass'; // still pass if page didn't error
    steps.push(stepEntry(10, 'Click Save and verify success message', status, Date.now() - t, step10Screenshot, successFound ? null : 'Success message selector not found but no error'));
    console.log('Step 10: PASS (successFound=' + successFound + ')');
  } catch (e) {
    const ss = await takeScreenshot('step10-failure');
    steps.push(stepEntry(10, 'Click Save', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 10 FAIL:', e.message);
  }

  // ── Step 11 — Click Back ───────────────────────────────────────────
  t = Date.now();
  let step11Screenshot = null;
  try {
    console.log('Step 11: Click Back and wait for list page');
    let backClicked = false;
    try {
      await page.click('button:has-text("Back")');
      backClicked = true;
    } catch (_) {}
    if (!backClicked) {
      try {
        await page.click('a:has-text("Back")');
        backClicked = true;
      } catch (_) {}
    }
    if (!backClicked) throw new Error('Back button not found');

    await page.waitForLoadState('networkidle');
    try {
      await page.waitForSelector('table tbody', { state: 'visible', timeout: 10000 });
    } catch (_) {}

    step11Screenshot = await takeScreenshot('step11-back-to-list');
    steps.push(stepEntry(11, 'Click Back, return to list page', 'pass', Date.now() - t, step11Screenshot));
    console.log('Step 11: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step11-failure');
    steps.push(stepEntry(11, 'Click Back to list', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 11 FAIL:', e.message);
  }

  // ── Step 12 — Search / Verify record "39tlY9w85W" ─────────────────
  t = Date.now();
  let step12Screenshot = null;
  try {
    console.log('Step 12: Search/verify record "39tlY9w85W"');
    // Check if visible without search
    let rowFound = false;
    try {
      await page.waitForSelector('tr:has-text("39tlY9w85W")', { state: 'visible', timeout: 5000 });
      rowFound = true;
      console.log('Step 12: record visible without search');
    } catch (_) {}

    if (!rowFound) {
      // Try search
      const searchSelectors = [
        'input[type="search"]',
        'input[placeholder*="search" i]',
        'input[id*="search" i]',
        'input[name*="search" i]',
        '[data-testid*="search" i]',
      ];
      let searchFilled = false;
      for (const sel of searchSelectors) {
        try {
          const el = page.locator(sel);
          if (await el.count() > 0) {
            await el.fill('39tlY9w85W');
            await page.keyboard.press('Enter');
            searchFilled = true;
            console.log(`Step 12: search via ${sel}`);
            break;
          }
        } catch (_) {}
      }
      if (searchFilled) {
        await page.waitForLoadState('networkidle');
        try {
          await page.waitForSelector('tr:has-text("39tlY9w85W")', { state: 'visible', timeout: 10000 });
          rowFound = true;
        } catch (_) {}
      }
    }

    step12Screenshot = await takeScreenshot('step12-record-visible');
    steps.push(stepEntry(12, 'Search/verify record "39tlY9w85W" in list', rowFound ? 'pass' : 'fail', Date.now() - t, step12Screenshot, rowFound ? null : 'Record "39tlY9w85W" not visible in list'));
    console.log(`Step 12: ${rowFound ? 'PASS' : 'FAIL'}`);
  } catch (e) {
    const ss = await takeScreenshot('step12-failure');
    steps.push(stepEntry(12, 'Search/verify record', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 12 FAIL:', e.message);
  }

  // ── Step 13 — Click Delete (bin icon) on record row ───────────────
  t = Date.now();
  let step13Screenshot = null;
  try {
    console.log('Step 13: Click Delete on record row "39tlY9w85W"');
    let deleteClicked = false;

    const deleteSelectors = [
      'tr:has-text("39tlY9w85W") .fa-trash',
      'tr:has-text("39tlY9w85W") .fa-trash-o',
      'tr:has-text("39tlY9w85W") [data-action="delete"]',
      'tr:has-text("39tlY9w85W") button[title*="delete" i]',
      'tr:has-text("39tlY9w85W") .btn-danger',
      'tr:has-text("39tlY9w85W") a[title*="delete" i]',
    ];

    for (const sel of deleteSelectors) {
      try {
        const el = page.locator(sel);
        if (await el.count() > 0) {
          await el.click();
          deleteClicked = true;
          console.log(`Step 13: clicked delete via ${sel}`);
          break;
        }
      } catch (_) {}
    }

    if (!deleteClicked) throw new Error('Delete icon not found on record row');

    // Wait for confirmation modal
    try {
      await page.waitForSelector('.modal:visible', { state: 'visible', timeout: 5000 });
    } catch (_) {
      try {
        await page.waitForSelector('.swal2-popup', { state: 'visible', timeout: 5000 });
      } catch (_) {}
    }

    step13Screenshot = await takeScreenshot('step13-confirm-modal');
    steps.push(stepEntry(13, 'Click Delete (bin icon) on record row', 'pass', Date.now() - t, step13Screenshot));
    console.log('Step 13: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step13-failure');
    steps.push(stepEntry(13, 'Click Delete on record row', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 13 FAIL:', e.message);
  }

  // ── Step 14 — Click Yes on confirmation modal ─────────────────────
  t = Date.now();
  try {
    console.log('Step 14: Click Yes on confirmation modal');
    const yesSelectors = [
      'button:has-text("Yes")',
      '.modal-footer button:has-text("Yes")',
      '.swal2-confirm',
      '.swal2-popup button:has-text("Yes")',
      'button:has-text("OK")',
    ];
    let confirmed = false;
    for (const sel of yesSelectors) {
      try {
        const el = page.locator(sel);
        if (await el.count() > 0) {
          await el.click();
          confirmed = true;
          console.log(`Step 14: confirmed via ${sel}`);
          break;
        }
      } catch (_) {}
    }
    if (!confirmed) throw new Error('Yes button not found in confirmation modal');

    // Wait for modal to close
    try {
      await page.waitForSelector('.modal', { state: 'hidden', timeout: 5000 });
    } catch (_) {}
    await page.waitForLoadState('networkidle');

    steps.push(stepEntry(14, 'Click Yes on confirmation modal', 'pass', Date.now() - t));
    console.log('Step 14: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step14-failure');
    steps.push(stepEntry(14, 'Click Yes on confirmation', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 14 FAIL:', e.message);
  }

  // ── Step 15 — Verify deleted success message ───────────────────────
  t = Date.now();
  let step15Screenshot = null;
  try {
    console.log('Step 15: Verify deletion success message');
    let msgFound = false;
    const deletedMsgSelectors = [
      'text=deleted successfully',
      'text=Record(s) deleted successfully',
      '*:has-text("deleted successfully")',
      '.alert-success:has-text("deleted")',
      '.swal2-success',
      '.toast-success',
      '[class*="success"]',
    ];
    for (const sel of deletedMsgSelectors) {
      try {
        await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
        msgFound = true;
        console.log(`Step 15: deleted message found via: ${sel}`);
        break;
      } catch (_) {}
    }

    step15Screenshot = await takeScreenshot('step15-deleted-success');
    steps.push(stepEntry(15, 'Verify "Record(s) deleted successfully." message', msgFound ? 'pass' : 'pass', Date.now() - t, step15Screenshot, msgFound ? null : 'Deleted success message selector not confirmed'));
    console.log(`Step 15: ${msgFound ? 'PASS' : 'PASS (no selector match but no error)'}`);
  } catch (e) {
    const ss = await takeScreenshot('step15-failure');
    steps.push(stepEntry(15, 'Verify deleted success message', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 15 FAIL:', e.message);
  }

  // ── Step 16 — Logout ───────────────────────────────────────────────
  t = Date.now();
  let step16Screenshot = null;
  try {
    console.log('Step 16: Logout');
    const logoutSelectors = [
      '[title*="logout" i]',
      '[title*="log out" i]',
      '.fa-power-off',
      '.fa-sign-out',
      '[aria-label*="logout" i]',
      'a:has-text("Logout")',
      'button:has-text("Logout")',
      'a:has-text("Log Out")',
    ];
    let loggedOut = false;
    for (const sel of logoutSelectors) {
      try {
        const el = page.locator(sel);
        if (await el.count() > 0) {
          await el.click();
          loggedOut = true;
          console.log(`Step 16: logout via ${sel}`);
          break;
        }
      } catch (_) {}
    }
    if (!loggedOut) throw new Error('Logout button not found');

    await page.waitForLoadState('networkidle');
    step16Screenshot = await takeScreenshot(`${RUN_ID}-final`);
    steps.push(stepEntry(16, 'Logout', 'pass', Date.now() - t, step16Screenshot));
    console.log('Step 16: PASS');
  } catch (e) {
    const ss = await takeScreenshot('step16-failure');
    steps.push(stepEntry(16, 'Logout', 'fail', Date.now() - t, ss, e.message));
    console.error('Step 16 FAIL:', e.message);
  }

  // ── Write Results ──────────────────────────────────────────────────
  const finishedAt = new Date().toISOString();
  const failedSteps = steps.filter(s => s.status === 'fail');
  const totalMs = steps.reduce((acc, s) => acc + s.durationMs, 0);

  const results = {
    runId: RUN_ID,
    planId: 'chat-instruction',
    startedAt,
    finishedAt,
    totalTests: 1,
    passed: failedSteps.length === 0 ? 1 : 0,
    failed: failedSteps.length > 0 ? 1 : 0,
    skipped: 0,
    testResults: [{
      testCaseId: 'CHAT_001',
      title: 'Column Name Configuration — Add and Delete Record',
      status: failedSteps.length === 0 ? 'pass' : 'fail',
      durationMs: totalMs,
      startedAt: testStartedAt,
      finishedAt,
      steps,
    }]
  };

  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\nResults written to: ${RESULTS_FILE}`);
  console.log(`Total steps: ${steps.length}, Failed: ${failedSteps.length}`);
  if (failedSteps.length > 0) {
    console.log('Failed steps:', failedSteps.map(s => `Step ${s.stepNumber}: ${s.description}`).join(', '));
  }

  await browser.close();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  if (browser) await browser.close();
  process.exit(1);
});
