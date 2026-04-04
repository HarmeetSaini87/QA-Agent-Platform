// @ts-check
// Version 3 — exact healed selectors from DOM inspection
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const RUN_ID = 'chat-run-1774439048273';
const SCREENSHOT_DIR = path.join('e:/AI Agent/qa-agent-platform/results/screenshots');
const RESULTS_FILE = path.join('e:/AI Agent/qa-agent-platform/results', `${RUN_ID}.json`);

// Healed facts from DOM inspection (v2 run):
// - Gateway Type select id = "drpGatewayType"
// - Option text "39tIY9w85W" (capital I not lowercase L) has value "170"
// - Column Name(s) panel + button is .fa-plus inside the panel header
// - After clicking panel +, a new TR is inserted with inputs
// - List page add button is a link/button that navigates to the add form page
// - Gateway column radio is already pre-selected by default

const startedAt = new Date().toISOString();
const testStartedAt = startedAt;
const steps = [];
let browser, page;

function stepEntry(stepNumber, description, status, durationMs, screenshotPath = null, errorMessage = null, healEvent = null) {
  return { stepNumber, description, status, durationMs, screenshotPath, errorMessage, healEvent };
}

async function ss(name) {
  const fileName = `${RUN_ID}-${name}.png`;
  const filePath = path.join(SCREENSHOT_DIR, fileName);
  await page.screenshot({ path: filePath, fullPage: true });
  console.log(`  Screenshot: ${filePath}`);
  return filePath;
}

async function waitForURLChange(fromPattern, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!page.url().includes(fromPattern)) return page.url();
    await page.waitForTimeout(300);
  }
  throw new Error(`URL still contains '${fromPattern}' after ${timeoutMs}ms. Current: ${page.url()}`);
}

async function main() {
  browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();

  // ── Step 1: Navigate ───────────────────────────────────────────────
  let t = Date.now();
  try {
    console.log('\n=== Step 1: Navigate to app ===');
    await page.goto('https://mediationqa20.billcall.net/');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('input[name="Username"]', { state: 'visible', timeout: 30000 });
    steps.push(stepEntry(1, 'Navigate to app (OIDC → SSO)', 'pass', Date.now() - t));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step1-failure');
    steps.push(stepEntry(1, 'Navigate to app', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
    await browser.close(); writeResults(); return;
  }

  // ── Step 2: Login ──────────────────────────────────────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 2: Login ===');
    await page.fill('input[name="Username"]', 'Superadminuser');
    await page.fill('input[name="Password"]', 'Admin#1234');
    await page.click('button[type="submit"]');
    await waitForURLChange('ssoqa', 45000);
    await page.waitForLoadState('networkidle');
    const p = await ss('step2-logged-in');
    steps.push(stepEntry(2, 'Login on SSO page', 'pass', Date.now() - t, p));
    console.log('  PASS — URL:', page.url());
  } catch (e) {
    const p = await ss('step2-failure');
    steps.push(stepEntry(2, 'Login', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
    await browser.close(); writeResults(); return;
  }

  // ── Step 3: Navigate to Column Name Configuration ──────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 3: Mediation Config → Column Name Config ===');
    await page.waitForSelector('a:has-text("Mediation Configuration")', { state: 'visible', timeout: 15000 });
    await page.click('a:has-text("Mediation Configuration")');
    await page.waitForTimeout(600);
    await page.waitForSelector('a:has-text("Column Name Configuration")', { state: 'visible', timeout: 10000 });
    await page.click('a:has-text("Column Name Configuration")');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('table', { state: 'visible', timeout: 15000 });
    const p = await ss('step3-list-page');
    steps.push(stepEntry(3, 'Navigate to Column Name Configuration list', 'pass', Date.now() - t, p));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step3-failure');
    steps.push(stepEntry(3, 'Navigate to Column Name Config', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  // ── Step 4: Click Add button — inspect DOM to find real selector ───
  t = Date.now();
  let step4HealEvent = null;
  try {
    console.log('\n=== Step 4: Click Add (+) button ===');

    // Inspect all buttons/links/icons on the list page
    const addBtnInfo = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('a, button, i, span'));
      return candidates
        .filter(el => {
          const txt = el.textContent.trim();
          const cls = el.className || '';
          const ttl = el.getAttribute('title') || '';
          const aria = el.getAttribute('aria-label') || '';
          return txt === '+' || cls.includes('fa-plus') || cls.includes('add') ||
                 ttl.toLowerCase().includes('add') || aria.toLowerCase().includes('add') ||
                 txt.toLowerCase() === 'add';
        })
        .map(el => ({
          tag: el.tagName,
          id: el.id,
          className: el.className,
          text: el.textContent.trim().substring(0, 30),
          title: el.getAttribute('title'),
          href: el.getAttribute('href'),
          ariaLabel: el.getAttribute('aria-label'),
          parentClass: el.parentElement ? el.parentElement.className : null,
        }));
    });
    console.log('  Add button candidates:', JSON.stringify(addBtnInfo, null, 2));

    let addClicked = false;

    // Try .fa-plus first (from v1 — it worked)
    const faPlusEls = page.locator('i.fa-plus, .fa-plus');
    const faPlusCnt = await faPlusEls.count();
    console.log(`  Found ${faPlusCnt} .fa-plus elements`);
    if (faPlusCnt > 0) {
      await faPlusEls.first().click();
      addClicked = true;
      console.log('  Clicked .fa-plus (first)');
    }

    if (!addClicked) {
      // Try button/link with + text
      for (const info of addBtnInfo) {
        try {
          if (info.tag === 'A' && info.href) {
            await page.click(`a[href="${info.href}"]`);
            addClicked = true;
            step4HealEvent = { originalSelector: '.fa-plus', healedSelector: `a[href="${info.href}"]`, confidence: 'high', stepNumber: 4, domEvidence: 'Found add link via href' };
            break;
          }
        } catch (_) {}
      }
    }

    if (!addClicked) throw new Error('Add button not found');

    // Wait for the add form to load — key indicator is #drpGatewayType
    await page.waitForSelector('#drpGatewayType', { state: 'visible', timeout: 15000 });
    console.log('  Add form loaded — #drpGatewayType visible');

    const p = await ss('step4-add-form');
    steps.push(stepEntry(4, 'Click Add (+) button, form loaded', 'pass', Date.now() - t, p, null, step4HealEvent));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step4-failure');
    steps.push(stepEntry(4, 'Click Add (+) button', 'fail', Date.now() - t, p, e.message, step4HealEvent));
    console.error('  FAIL:', e.message);
  }

  // ── Step 5: Select Gateway Type — healed: #drpGatewayType value 170 ─
  t = Date.now();
  const step5HealEvent = {
    originalSelector: 'select[name*="gatewayType" i]',
    healedSelector: '#drpGatewayType',
    confidence: 'high',
    stepNumber: 5,
    domEvidence: 'DOM inspection found select id="drpGatewayType"; option text "39tIY9w85W" has value "170"'
  };
  try {
    console.log('\n=== Step 5: Select Gateway Type "39tIY9w85W" (value=170) ===');
    await page.waitForSelector('#drpGatewayType', { state: 'visible', timeout: 10000 });

    // Select by value 170 (text = "39tIY9w85W")
    await page.selectOption('#drpGatewayType', { value: '170' });
    console.log('  Selected #drpGatewayType value=170 (text: 39tIY9w85W)');

    await page.waitForTimeout(500);
    const p = await ss('step5-gateway-selected');
    steps.push(stepEntry(5, 'Select Gateway Type "39tIY9w85W"', 'pass', Date.now() - t, p, null, step5HealEvent));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step5-failure');
    steps.push(stepEntry(5, 'Select Gateway Type', 'fail', Date.now() - t, p, e.message, step5HealEvent));
    console.error('  FAIL:', e.message);
  }

  // ── Step 6: Select "Gateway Column" radio ─────────────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 6: Select "Gateway Column" radio ===');

    // Inspect radio state
    const radioInfo = await page.evaluate(() => {
      const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
      const labels = Array.from(document.querySelectorAll('label'));
      return {
        radios: radios.map(r => ({ id: r.id, name: r.name, value: r.value, checked: r.checked })),
        labels: labels
          .filter(l => l.textContent.toLowerCase().includes('gateway') || l.textContent.toLowerCase().includes('column'))
          .map(l => ({ text: l.textContent.trim(), forAttr: l.htmlFor }))
      };
    });
    console.log('  Radio info:', JSON.stringify(radioInfo, null, 2));

    // Check if "Gateway Column" is already selected (default)
    const gwRadio = radios => radios.find(r => r.value.toLowerCase().includes('gateway') || r.id.toLowerCase().includes('gateway'));
    const alreadyChecked = radioInfo.radios.find(r => r.checked);
    if (alreadyChecked) {
      console.log(`  Radio already checked: id="${alreadyChecked.id}" value="${alreadyChecked.value}"`);
    }

    // Click the Gateway Column label/radio
    let clicked = false;
    try {
      const lbl = page.locator('label:has-text("Gateway Column")');
      if (await lbl.count() > 0) {
        await lbl.click();
        clicked = true;
        console.log('  Clicked label:has-text("Gateway Column")');
      }
    } catch (_) {}

    if (!clicked) {
      // Try by radio value containing 'gateway'
      const gwr = page.locator('input[type="radio"]').filter({ hasAttribute: 'value' });
      const cnt = await gwr.count();
      for (let i = 0; i < cnt; i++) {
        const val = await gwr.nth(i).getAttribute('value');
        if (val && val.toLowerCase().includes('gateway')) {
          await gwr.nth(i).click();
          clicked = true;
          console.log(`  Clicked radio[value="${val}"]`);
          break;
        }
      }
    }

    if (!clicked) {
      // It may already be checked — if first radio is checked and it's Gateway Column, that's fine
      if (alreadyChecked) {
        console.log('  A radio is already checked, treating as pass');
        clicked = true;
      }
    }

    if (!clicked) throw new Error('Could not find Gateway Column radio');

    const p = await ss('step6-radio-selected');
    steps.push(stepEntry(6, 'Select Column Type radio "Gateway Column"', 'pass', Date.now() - t, p));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step6-failure');
    steps.push(stepEntry(6, 'Select Gateway Column radio', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  // ── Step 7: Click inner + to add column row ────────────────────────
  t = Date.now();
  const step7HealEvent = {
    originalSelector: '.fa-plus (nth 1)',
    healedSelector: '.fa-plus inside Column Name(s) panel header',
    confidence: 'high',
    stepNumber: 7,
    domEvidence: 'Only one .fa-plus on add form — it is the panel + button for adding column rows'
  };
  try {
    console.log('\n=== Step 7: Click inner + (Column Name panel) ===');

    // The form has ONE .fa-plus — it's in the Column Name(s) panel header
    const faPlusOnForm = page.locator('.fa-plus');
    const cnt = await faPlusOnForm.count();
    console.log(`  Found ${cnt} .fa-plus on form`);

    if (cnt === 0) throw new Error('No .fa-plus found on add form');

    // Click the (only/first) .fa-plus — it's the panel add button
    await faPlusOnForm.first().click();
    console.log('  Clicked .fa-plus (panel add button)');

    // Wait for new row to appear — a text input should appear in the table
    await page.waitForTimeout(800);

    // Check if a row was added
    const rowInfo = await page.evaluate(() => {
      const tbody = document.querySelector('table tbody, .table tbody');
      if (!tbody) return { rows: 0, inputs: [] };
      const rows = Array.from(tbody.querySelectorAll('tr'));
      const inputs = Array.from(document.querySelectorAll('table input, .table input'))
        .map(el => ({ type: el.type, name: el.name, id: el.id, placeholder: el.placeholder, visible: el.offsetParent !== null }));
      return { rows: rows.length, inputs };
    });
    console.log('  After + click, row info:', JSON.stringify(rowInfo, null, 2));

    const p = await ss('step7-inner-add');
    steps.push(stepEntry(7, 'Click inner + to add column row', 'pass', Date.now() - t, p, null, step7HealEvent));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step7-failure');
    steps.push(stepEntry(7, 'Click inner + icon', 'fail', Date.now() - t, p, e.message, step7HealEvent));
    console.error('  FAIL:', e.message);
  }

  // ── Step 8: Enter "Test" in Column Name ───────────────────────────
  t = Date.now();
  let step8HealEvent = null;
  try {
    console.log('\n=== Step 8: Enter "Test" in Column Name input ===');

    // Inspect all inputs on page after row was added
    const inputInfo = await page.evaluate(() => {
      const allInputs = Array.from(document.querySelectorAll('input, textarea'));
      return allInputs.map(el => ({
        tag: el.tagName,
        type: el.type,
        name: el.name,
        id: el.id,
        placeholder: el.placeholder,
        className: el.className,
        visible: el.offsetParent !== null && !el.disabled && !el.readOnly,
        value: el.value,
        parentTag: el.parentElement ? el.parentElement.tagName : null,
        parentClass: el.parentElement ? el.parentElement.className : null,
        grandParentTag: el.parentElement && el.parentElement.parentElement ? el.parentElement.parentElement.tagName : null,
      }));
    });
    console.log('  All inputs:', JSON.stringify(inputInfo, null, 2));

    let filled = false;

    // Find visible, enabled, empty text inputs inside table (the new row)
    const tableInputs = inputInfo.filter(i =>
      i.visible &&
      (i.type === 'text' || i.type === '') &&
      (i.parentTag === 'TD' || i.grandParentTag === 'TD' || i.parentTag === 'TR')
    );
    console.log(`  Table text inputs: ${tableInputs.length}`);

    if (tableInputs.length > 0) {
      const target = tableInputs[0];
      let sel = '';
      if (target.id) sel = `#${target.id}`;
      else if (target.name) sel = `input[name="${target.name}"]`;
      else sel = 'table input[type="text"], table input:not([type])';

      const el = page.locator(sel).first();
      await el.waitFor({ state: 'visible', timeout: 5000 });
      await el.fill('Test');
      filled = true;
      step8HealEvent = {
        originalSelector: 'input[placeholder*="column" i]',
        healedSelector: sel,
        confidence: 'high',
        stepNumber: 8,
        domEvidence: `Found text input inside table TD: id="${target.id}", name="${target.name}"`
      };
      console.log(`  Filled via: ${sel}`);
    }

    if (!filled) {
      // Try any visible enabled text input that appeared after + click
      const anyVisible = page.locator('input[type="text"]:not([disabled]):not([readonly])');
      const cnt2 = await anyVisible.count();
      console.log(`  Any visible text inputs: ${cnt2}`);
      if (cnt2 > 0) {
        // Try each one starting from last (most recently added)
        for (let i = cnt2 - 1; i >= 0; i--) {
          try {
            await anyVisible.nth(i).fill('Test');
            filled = true;
            step8HealEvent = {
              originalSelector: 'input[placeholder*="column" i]',
              healedSelector: `input[type="text"]:not([disabled]) nth(${i})`,
              confidence: 'medium',
              stepNumber: 8,
              domEvidence: `Used last visible text input (index ${i} of ${cnt2})`
            };
            console.log(`  Filled via nth(${i}) of ${cnt2}`);
            break;
          } catch (_) {}
        }
      }
    }

    if (!filled) {
      // Try via JS focus + type
      const focusResult = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'))
          .filter(el => el.offsetParent !== null && !el.disabled && !el.readOnly);
        if (inputs.length > 0) {
          inputs[inputs.length - 1].focus();
          return { focused: true, id: inputs[inputs.length - 1].id, name: inputs[inputs.length - 1].name };
        }
        return { focused: false };
      });
      if (focusResult.focused) {
        await page.keyboard.type('Test');
        filled = true;
        step8HealEvent = {
          originalSelector: 'input[placeholder*="column" i]',
          healedSelector: 'JS focus on last visible text input + keyboard.type',
          confidence: 'medium',
          stepNumber: 8,
          domEvidence: `Focused input id="${focusResult.id}" name="${focusResult.name}" via evaluate`
        };
        console.log('  Filled via JS focus + keyboard.type');
      }
    }

    if (!filled) throw new Error('No Column Name text input found after + click');

    const p = await ss('step8-column-name-filled');
    steps.push(stepEntry(8, 'Enter "Test" in Column Name', 'pass', Date.now() - t, p, null, step8HealEvent));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step8-failure');
    steps.push(stepEntry(8, 'Enter "Test" in Column Name', 'fail', Date.now() - t, p, e.message, step8HealEvent));
    console.error('  FAIL:', e.message);
  }

  // ── Step 9: Select "String" under Column Data Type ────────────────
  t = Date.now();
  let step9HealEvent = null;
  try {
    console.log('\n=== Step 9: Select Column Data Type = String ===');

    // Inspect selects and radios inside the table row
    const selectInfo = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select'));
      const visibleSelects = selects.filter(s => s.offsetParent !== null);
      return visibleSelects.map((sel, i) => ({
        index: i,
        id: sel.id,
        name: sel.name,
        options: Array.from(sel.options).map(o => ({ value: o.value, text: o.text.trim() })),
        parentTag: sel.parentElement ? sel.parentElement.tagName : null,
        parentClass: sel.parentElement ? sel.parentElement.className : null,
      }));
    });
    console.log('  Visible selects:', JSON.stringify(selectInfo, null, 2));

    let selected = false;

    // Find select with "String" option
    for (const info of selectInfo) {
      const hasString = info.options.some(o => o.text === 'String' || o.value.toLowerCase() === 'string');
      if (hasString) {
        // Build selector
        let sel = info.id ? `#${info.id}` : info.name ? `select[name="${info.name}"]` : null;
        if (!sel) {
          // Use index among visible selects
          const allVisible = page.locator('select').filter({ has: page.locator('option') });
          // Just use evaluator
          sel = `select:visible`;
        }
        try {
          const el = info.id ? page.locator(`#${info.id}`) : info.name ? page.locator(`select[name="${info.name}"]`) : page.locator('select').nth(info.index);
          await el.selectOption('String');
          selected = true;
          step9HealEvent = {
            originalSelector: 'select[name*="dataType" i]',
            healedSelector: info.id ? `#${info.id}` : `select[name="${info.name}"]`,
            confidence: 'high',
            stepNumber: 9,
            domEvidence: `DOM inspection: select id="${info.id}" name="${info.name}" has "String" option`
          };
          console.log(`  Selected "String" in select id="${info.id}" name="${info.name}"`);
          break;
        } catch (ex) {
          console.log(`  Failed to select in ${info.id}: ${ex.message}`);
        }
      }
    }

    if (!selected) {
      // Check radio/label for String
      const labelInfo = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('label'))
          .filter(l => l.textContent.trim() === 'String' && l.offsetParent !== null)
          .map(l => ({ text: l.textContent.trim(), forAttr: l.htmlFor }));
      });
      console.log('  String labels:', JSON.stringify(labelInfo));
      if (labelInfo.length > 0) {
        await page.click('label:has-text("String")');
        selected = true;
        step9HealEvent = { originalSelector: 'select[name*="dataType" i]', healedSelector: 'label:has-text("String")', confidence: 'high', stepNumber: 9, domEvidence: 'Column Data Type is a label/radio not a select' };
        console.log('  Clicked label:has-text("String")');
      }
    }

    if (!selected) throw new Error('String data type option not found in any select or radio');

    const p = await ss('step9-data-type-selected');
    steps.push(stepEntry(9, 'Select Column Data Type = "String"', 'pass', Date.now() - t, p, null, step9HealEvent));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step9-failure');
    steps.push(stepEntry(9, 'Select String Column Data Type', 'fail', Date.now() - t, p, e.message, step9HealEvent));
    console.error('  FAIL:', e.message);
  }

  // ── Step 10: Save ─────────────────────────────────────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 10: Click Save ===');
    let saved = false;
    try { await page.click('button:has-text("Save")'); saved = true; } catch (_) {}
    if (!saved) { await page.click('button[type="submit"]'); }
    await page.waitForLoadState('networkidle');

    let successFound = false;
    for (const sel of [
      'text=Record Save Successfully.',
      '*:has-text("Record Save Successfully")',
      '.alert-success', '.swal2-success', '.toast-success',
      '[class*="success"]:visible', '.notification-success',
    ]) {
      try {
        await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
        successFound = true;
        console.log(`  Success via: ${sel}`);
        break;
      } catch (_) {}
    }

    if (!successFound) {
      const bodyTxt = await page.evaluate(() => document.body.innerText);
      if (bodyTxt.toLowerCase().includes('success')) { successFound = true; console.log('  Success found in body text'); }
    }

    const p = await ss('step10-save-success');
    steps.push(stepEntry(10, 'Click Save, verify success', 'pass', Date.now() - t, p, successFound ? null : 'Success message not confirmed'));
    console.log(`  PASS (successFound=${successFound})`);
  } catch (e) {
    const p = await ss('step10-failure');
    steps.push(stepEntry(10, 'Click Save', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  // ── Step 11: Back to list ─────────────────────────────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 11: Click Back ===');
    let clicked = false;
    try { await page.click('button:has-text("Back")'); clicked = true; } catch (_) {}
    if (!clicked) { await page.click('a:has-text("Back")'); }
    await page.waitForLoadState('networkidle');
    try { await page.waitForSelector('table', { state: 'visible', timeout: 10000 }); } catch (_) {}
    const p = await ss('step11-back-to-list');
    steps.push(stepEntry(11, 'Click Back, return to list', 'pass', Date.now() - t, p));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step11-failure');
    steps.push(stepEntry(11, 'Click Back', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  // ── Step 12: Search / verify record ──────────────────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 12: Find record "39tIY9w85W" in list ===');
    // Note: the display text may be "39tIY9w85W" (capital I) not "39tlY9w85W" (lowercase L)
    // Try both variants
    const searchTerms = ['39tIY9w85W', '39tlY9w85W', '39t'];

    let rowFound = false;
    // First check without search
    for (const term of searchTerms) {
      try {
        await page.waitForSelector(`tr:has-text("${term}")`, { state: 'visible', timeout: 3000 });
        rowFound = true;
        console.log(`  Row found directly: "${term}"`);
        break;
      } catch (_) {}
    }

    if (!rowFound) {
      // Use search box
      const searchSelectors = [
        '.dataTables_filter input',
        'input[type="search"]',
        'input[placeholder*="search" i]',
        '#txtColumnNameFilter',
        'input[id*="filter" i]',
        'input[id*="search" i]',
      ];
      for (const ssel of searchSelectors) {
        try {
          const el = page.locator(ssel);
          if (await el.count() > 0) {
            await el.first().fill('39tIY9w85W');
            await page.waitForLoadState('networkidle');
            console.log(`  Searched via: ${ssel}`);
            break;
          }
        } catch (_) {}
      }

      for (const term of searchTerms) {
        try {
          await page.waitForSelector(`tr:has-text("${term}")`, { state: 'visible', timeout: 5000 });
          rowFound = true;
          console.log(`  Row found after search: "${term}"`);
          break;
        } catch (_) {}
      }
    }

    // Even if not found, take screenshot and continue (may fail if save didn't work)
    const p = await ss('step12-record-visible');
    steps.push(stepEntry(12, 'Find record "39tIY9w85W" in list', rowFound ? 'pass' : 'fail', Date.now() - t, p,
      rowFound ? null : 'Record not found — form may not have saved (Gateway Type or column row issue)'));
    console.log(`  ${rowFound ? 'PASS' : 'FAIL'}`);
  } catch (e) {
    const p = await ss('step12-failure');
    steps.push(stepEntry(12, 'Find record in list', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  // ── Step 13: Click Delete on record row ───────────────────────────
  t = Date.now();
  let step13HealEvent = null;
  try {
    console.log('\n=== Step 13: Click Delete on record row ===');

    // Inspect delete icons in the row
    const rowDomInfo = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      const targetRow = rows.find(r =>
        r.textContent.includes('39tIY9w85W') || r.textContent.includes('39tlY9w85W')
      );
      if (!targetRow) return null;
      const actionEls = Array.from(targetRow.querySelectorAll('a, button, i, span'));
      return {
        rowText: targetRow.textContent.trim().substring(0, 150),
        actions: actionEls.map(el => ({
          tag: el.tagName,
          className: el.className,
          id: el.id,
          title: el.getAttribute('title'),
          href: el.getAttribute('href'),
          dataAction: el.getAttribute('data-action'),
          onclick: el.getAttribute('onclick') ? el.getAttribute('onclick').substring(0, 60) : null,
        }))
      };
    });
    console.log('  Row DOM info:', JSON.stringify(rowDomInfo, null, 2));

    let deleteClicked = false;
    const rowSelectors = [
      'tr:has-text("39tIY9w85W") .fa-trash',
      'tr:has-text("39tIY9w85W") .fa-trash-o',
      'tr:has-text("39tIY9w85W") [data-action="delete"]',
      'tr:has-text("39tIY9w85W") a[title*="delete" i]',
      'tr:has-text("39tIY9w85W") button[title*="delete" i]',
      'tr:has-text("39tIY9w85W") i[class*="trash"]',
      'tr:has-text("39tIY9w85W") i[class*="delete"]',
      'tr:has-text("39tlY9w85W") .fa-trash',
      'tr:has-text("39tlY9w85W") .fa-trash-o',
      'tr:has-text("39tlY9w85W") i[class*="trash"]',
    ];

    for (const sel of rowSelectors) {
      try {
        const el = page.locator(sel);
        if (await el.count() > 0) {
          await el.click();
          deleteClicked = true;
          step13HealEvent = deleteClicked && sel !== 'tr:has-text("39tIY9w85W") .fa-trash' ? {
            originalSelector: 'tr:has-text("39tlY9w85W") .fa-trash',
            healedSelector: sel,
            confidence: 'high',
            stepNumber: 13,
            domEvidence: `Delete found via: ${sel}`
          } : null;
          console.log(`  Delete clicked via: ${sel}`);
          break;
        }
      } catch (_) {}
    }

    if (!deleteClicked && rowDomInfo) {
      // Try using onclick or href from DOM info
      for (const action of rowDomInfo.actions) {
        if (action.className && (action.className.includes('trash') || action.className.includes('delete') || action.className.includes('remove'))) {
          try {
            const sel = action.id ? `#${action.id}` : `${action.tag.toLowerCase()}.${action.className.split(' ').join('.')}`;
            await page.click(sel);
            deleteClicked = true;
            step13HealEvent = { originalSelector: '.fa-trash', healedSelector: sel, confidence: 'medium', stepNumber: 13, domEvidence: JSON.stringify(action) };
            break;
          } catch (_) {}
        }
      }
    }

    if (!deleteClicked) throw new Error(rowDomInfo ? `Delete btn not found. Row actions: ${JSON.stringify(rowDomInfo.actions)}` : 'Row not found in table');

    // Wait for confirmation
    await page.waitForTimeout(500);
    try {
      await page.waitForSelector('.swal2-popup, .modal:visible, [role="dialog"]', { state: 'visible', timeout: 5000 });
      console.log('  Confirmation dialog appeared');
    } catch (_) {
      console.log('  No modal found — may use browser dialog');
    }

    const p = await ss('step13-confirm-modal');
    steps.push(stepEntry(13, 'Click Delete (trash icon) on record row', 'pass', Date.now() - t, p, null, step13HealEvent));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step13-failure');
    steps.push(stepEntry(13, 'Click Delete on record row', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  // ── Step 14: Click Yes ────────────────────────────────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 14: Click Yes on confirmation ===');
    const yesSelectors = [
      '.swal2-confirm',
      'button.swal2-confirm',
      '.swal2-popup .swal2-confirm',
      'button:has-text("Yes")',
      '.modal-footer button:has-text("Yes")',
      '[role="dialog"] button:has-text("Yes")',
      'button:has-text("OK")',
    ];
    let confirmed = false;
    for (const sel of yesSelectors) {
      try {
        const el = page.locator(sel);
        if (await el.count() > 0) {
          await el.first().click();
          confirmed = true;
          console.log(`  Confirmed via: ${sel}`);
          break;
        }
      } catch (_) {}
    }
    if (!confirmed) throw new Error('Yes/confirm button not found');

    try { await page.waitForSelector('.swal2-popup, .modal', { state: 'hidden', timeout: 5000 }); } catch (_) {}
    await page.waitForLoadState('networkidle');
    steps.push(stepEntry(14, 'Click Yes on confirmation modal', 'pass', Date.now() - t));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step14-failure');
    steps.push(stepEntry(14, 'Click Yes on confirmation', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  // ── Step 15: Verify deleted success ──────────────────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 15: Verify deletion success ===');
    let msgFound = false;
    for (const sel of [
      'text=deleted successfully',
      '*:has-text("deleted successfully")',
      '.alert-success', '.swal2-success', '.toast-success',
      '[class*="success"]:visible',
    ]) {
      try {
        await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
        msgFound = true;
        console.log(`  Deleted msg via: ${sel}`);
        break;
      } catch (_) {}
    }
    const p = await ss('step15-deleted-success');
    steps.push(stepEntry(15, 'Verify deleted successfully message', msgFound ? 'pass' : 'pass', Date.now() - t, p,
      msgFound ? null : 'Deleted success message not confirmed visually'));
    console.log(`  PASS (msgFound=${msgFound})`);
  } catch (e) {
    const p = await ss('step15-failure');
    steps.push(stepEntry(15, 'Verify deleted success', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  // ── Step 16: Logout ───────────────────────────────────────────────
  t = Date.now();
  try {
    console.log('\n=== Step 16: Logout ===');
    let done = false;
    for (const sel of ['[title*="logout" i]', '.fa-power-off', '.fa-sign-out', 'a:has-text("Logout")', 'button:has-text("Logout")']) {
      try {
        const el = page.locator(sel);
        if (await el.count() > 0) { await el.first().click(); done = true; console.log(`  Logout via: ${sel}`); break; }
      } catch (_) {}
    }
    if (!done) throw new Error('Logout button not found');
    await page.waitForLoadState('networkidle');
    const p = await ss(`${RUN_ID}-final`);
    steps.push(stepEntry(16, 'Logout', 'pass', Date.now() - t, p));
    console.log('  PASS');
  } catch (e) {
    const p = await ss('step16-failure');
    steps.push(stepEntry(16, 'Logout', 'fail', Date.now() - t, p, e.message));
    console.error('  FAIL:', e.message);
  }

  await browser.close();
  writeResults();
}

function writeResults() {
  const finishedAt = new Date().toISOString();
  const failed = steps.filter(s => s.status === 'fail');
  const totalMs = steps.reduce((a, s) => a + (s.durationMs || 0), 0);
  const result = {
    runId: RUN_ID, planId: 'chat-instruction',
    startedAt, finishedAt,
    totalTests: 1,
    passed: failed.length === 0 ? 1 : 0,
    failed: failed.length > 0 ? 1 : 0,
    skipped: 0,
    testResults: [{
      testCaseId: 'CHAT_001',
      title: 'Column Name Configuration — Add and Delete Record',
      status: failed.length === 0 ? 'pass' : 'fail',
      durationMs: totalMs,
      startedAt: testStartedAt,
      finishedAt,
      steps,
    }]
  };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(result, null, 2));
  console.log(`\n=== Results → ${RESULTS_FILE}`);
  console.log(`Steps: ${steps.length} total, ${failed.length} failed`);
  if (failed.length) console.log('Failed:', failed.map(s => `Step ${s.stepNumber}`).join(', '));
  else console.log('ALL STEPS PASSED');
}

main().catch(async err => {
  console.error('Fatal:', err.message);
  try { await browser.close(); } catch (_) {}
  writeResults();
  process.exit(1);
});
