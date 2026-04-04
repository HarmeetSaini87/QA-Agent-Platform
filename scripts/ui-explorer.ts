/**
 * ui-explorer.ts
 * Automated UI exploration and DOM analysis of the entire application.
 * Navigates every page, clicks Add buttons, captures all form fields,
 * and generates structured documentation.
 */

import { chromium, Browser, Page, Locator } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'https://mediationqa20.billcall.net';
const USERNAME = 'Superadminuser';
const PASSWORD = 'Admin#1234';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'UI_Page_Analysis');

interface FieldInfo {
  pageName: string;
  section: string;
  fieldLabel: string;
  fieldType: string;
  domIdentifier: string;
  notes: string;
}

interface PageAnalysis {
  pageName: string;
  url: string;
  menuPath: string;
  elements: {
    buttons: ElementDetail[];
    inputs: ElementDetail[];
    dropdowns: ElementDetail[];
    radioButtons: ElementDetail[];
    checkboxes: ElementDetail[];
    tables: TableDetail[];
    links: ElementDetail[];
    tabs: ElementDetail[];
    fileUploads: ElementDetail[];
    textareas: ElementDetail[];
    toggles: ElementDetail[];
    datePickers: ElementDetail[];
  };
  formFields: FieldInfo[];
  domNotes: string[];
  iframes: number;
  shadowDomElements: number;
  hiddenFields: ElementDetail[];
  addButtonFound: boolean;
  screenshotPath: string;
  formScreenshotPath: string;
}

interface ElementDetail {
  tag: string;
  type?: string;
  name?: string;
  id?: string;
  classes?: string;
  placeholder?: string;
  text?: string;
  value?: string;
  selector: string;
  visible: boolean;
  label?: string;
  required?: boolean;
  options?: string[];   // for dropdowns
}

interface TableDetail {
  id: string;
  classes: string;
  headers: string[];
  rowCount: number;
  hasActions: boolean;
  selector: string;
}

// ── Helper: classify field type from DOM element ─────────────────────────────
function classifyFieldType(el: ElementDetail): string {
  if (el.tag === 'select') return 'Dropdown';
  if (el.tag === 'textarea') return 'Text Area';
  if (el.tag === 'input') {
    switch (el.type) {
      case 'text': return 'Text Field';
      case 'email': return 'Text Field';
      case 'password': return 'Text Field';
      case 'number': return 'Text Field';
      case 'tel': return 'Text Field';
      case 'search': return 'Text Field';
      case 'radio': return 'Radio Button';
      case 'checkbox': return 'Checkbox';
      case 'date': return 'Date Picker';
      case 'datetime-local': return 'Date Picker';
      case 'file': return 'File Upload';
      case 'hidden': return 'Hidden';
      default: return 'Text Field';
    }
  }
  return 'Unknown';
}

// ── Helper: build best selector string ───────────────────────────────────────
function buildSelector(el: { tag: string; id?: string; name?: string; type?: string; classes?: string; placeholder?: string }): string {
  if (el.id) return `#${el.id}`;
  if (el.name) return `${el.tag}[name="${el.name}"]`;
  if (el.placeholder) return `${el.tag}[placeholder="${el.placeholder}"]`;
  if (el.type && el.classes) return `${el.tag}.${el.classes.split(' ')[0]}[type="${el.type}"]`;
  return el.tag;
}

// ── Main exploration ─────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const screenshotDir = path.join(OUTPUT_DIR, 'screenshots');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false, slowMo: 300 });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  const allFields: FieldInfo[] = [];
  const allPages: PageAnalysis[] = [];

  try {
    // ── Step 1: Login (SSO/OIDC flow) ─────────────────────────────────────
    console.log('Logging in...');
    await page.goto(BASE_URL);
    // Wait for the SSO login form to appear
    await page.waitForSelector('input[name="Username"]', { state: 'visible', timeout: 15000 });
    console.log('SSO login page loaded:', page.url());

    // Use exact username as provided
    await page.fill('input[name="Username"]', USERNAME);
    // Use pressSequentially for password to avoid issues with special characters like #
    const pwField = page.locator('input[name="Password"]');
    await pwField.click();
    await pwField.pressSequentially(PASSWORD, { delay: 50 });

    // Screenshot before clicking login
    await page.screenshot({ path: path.join(screenshotDir, 'login-before-submit.png') });

    await page.click('button[type="submit"]');
    console.log('Clicked submit, waiting for redirect...');

    // Wait for SSO redirect back to the app
    try {
      await page.waitForFunction(
        '!location.href.includes("ssoqa") && !location.pathname.includes("/Account/Login")',
        { timeout: 30000 }
      );
    } catch {
      // Screenshot on failure
      await page.screenshot({ path: path.join(screenshotDir, 'login-failed.png') });
      console.log('Login redirect timeout. Current URL:', page.url());
      // Check for error messages
      const errorMsg = await page.locator('.validation-summary-errors, .text-danger, .alert-danger, .error').first().textContent().catch(() => '');
      if (errorMsg) console.log('Error message:', errorMsg.trim());
      throw new Error('Login failed — SSO did not redirect back to the app');
    }
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    console.log('Logged in. URL:', page.url());

    // Close any modal that may have appeared (e.g. help modal)
    try {
      const modal = page.locator('.modal.in .close, .modal.fade.in .close, .modal .btn-close, #helpModal .close').first();
      if (await modal.count() > 0 && await modal.isVisible()) {
        await modal.click();
        await page.waitForTimeout(500);
        console.log('Closed startup modal');
      }
    } catch { /* no modal */ }
    // Also try pressing Escape to dismiss any overlay
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // ── Step 2: Discover all menu items ────────────────────────────────────
    console.log('\n=== Discovering menu structure ===');

    // Take screenshot of main navigation
    await page.screenshot({ path: path.join(screenshotDir, 'main-navigation.png'), fullPage: true });

    // The app uses a sidebar with icon links. Click each sidebar icon to expand,
    // then find child links. Use JavaScript to discover ALL links regardless of visibility.
    const menuStructure = await discoverMenuViaDOM(page);
    console.log(`Found ${menuStructure.length} menu items`);

    for (const menu of menuStructure) {
      console.log(`  ${menu.level === 0 ? '📁' : '  📄'} ${menu.text} → ${menu.href || '(click to expand)'}`);
    }

    // ── Step 3: Visit each page and analyze ────────────────────────────────
    console.log('\n=== Exploring each page ===');

    for (let mi = 0; mi < menuStructure.length; mi++) {
      const menu = menuStructure[mi];
      if (!menu.isLeaf) continue; // Skip parent menus, only visit actual pages

      const pageName = sanitizeName(menu.text);
      console.log(`\n--- [${mi + 1}/${menuStructure.length}] ${menu.text} ---`);

      try {
        // Navigate to the page
        await navigateToPage(page, menu);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);

        const pageUrl = page.url();
        console.log('  URL:', pageUrl);

        // Screenshot the list page
        const listScreenshot = path.join(screenshotDir, `${pageName}_list.png`);
        await page.screenshot({ path: listScreenshot, fullPage: true });

        // Analyze the page DOM
        const analysis = await analyzePage(page, menu.text, menu.fullPath);
        analysis.url = pageUrl;
        analysis.screenshotPath = listScreenshot;

        // Try clicking Add/Create/New/+ button to open form
        const formOpened = await tryOpenAddForm(page);
        analysis.addButtonFound = formOpened;

        if (formOpened) {
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(2000);

          // Screenshot the form
          const formScreenshot = path.join(screenshotDir, `${pageName}_form.png`);
          await page.screenshot({ path: formScreenshot, fullPage: true });
          analysis.formScreenshotPath = formScreenshot;

          // Analyze the form fields (this is the most important part)
          const formAnalysis = await analyzeForm(page, menu.text);
          analysis.formFields = formAnalysis;

          // Add to global field inventory
          allFields.push(...formAnalysis);

          console.log(`  Form fields found: ${formAnalysis.length}`);

          // Check for dynamic elements — try interacting with dropdowns to see if they load more content
          await checkDynamicContent(page, formAnalysis, menu.text);

          // Go back to list page
          await goBackToList(page);
        } else {
          // Still capture any visible fields on the list page
          const listFields = await analyzeForm(page, menu.text);
          analysis.formFields = listFields;
          allFields.push(...listFields);
          console.log(`  No Add button found. List page fields: ${listFields.length}`);
        }

        allPages.push(analysis);

      } catch (err) {
        console.error(`  ERROR on page "${menu.text}":`, (err as Error).message);
        // Try to recover by going back to main page
        await page.goto(BASE_URL, { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
      }
    }

    // ── Step 4: Generate documentation ─────────────────────────────────────
    console.log('\n=== Generating documentation ===');

    // Generate per-page markdown files
    for (const pa of allPages) {
      const mdContent = generatePageMarkdown(pa);
      const fileName = sanitizeName(pa.pageName) + '_UI_Reference.md';
      fs.writeFileSync(path.join(OUTPUT_DIR, fileName), mdContent);
      console.log('  Wrote:', fileName);
    }

    // Generate Excel inventory
    generateExcelCSV(allFields);
    console.log('  Wrote: UI_Field_Inventory.csv');

    // Generate summary index
    generateIndexFile(allPages);
    console.log('  Wrote: _INDEX.md');

    console.log(`\n✅ Done! Explored ${allPages.length} pages, found ${allFields.length} total fields.`);
    console.log(`Output: ${OUTPUT_DIR}`);

  } catch (err) {
    console.error('Fatal error:', err);
    await page.screenshot({ path: path.join(screenshotDir, 'error-fatal.png'), fullPage: true });
  } finally {
    await browser.close();
  }
}

// ── Discover Menu via clicking parent items and finding child links ──────────
async function discoverMenuViaDOM(page: Page): Promise<MenuItem[]> {
  const items: MenuItem[] = [];

  // Known parent menu names from the sidebar
  const parentMenus = [
    'Mediation Configuration',
    'Rule Configuration',
    'Transaction Management',
    'System Configuration',
    'Reports',
  ];

  for (const parentName of parentMenus) {
    try {
      await dismissModals(page);

      // Click parent menu using JS click to bypass viewport/overlay issues
      await page.evaluate((menuText: string) => {
        const links = document.querySelectorAll('a');
        for (const a of links) {
          const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
          if (text === menuText) {
            (a as HTMLElement).click();
            return;
          }
        }
      }, parentName);

      await page.waitForTimeout(1500);
      await dismissModals(page);

      // Screenshot to see what expanded
      const safeName = parentName.replace(/\s+/g, '_');
      const ssDir = path.join(OUTPUT_DIR, 'screenshots');
      await page.screenshot({ path: path.join(ssDir, `menu-${safeName}.png`), fullPage: true });

      // Find child links — look for links whose text does NOT match any parent menu
      // and that have an href with a hash route (not javascript:void(0))
      const childLinks = await page.evaluate((parents: string[]) => {
        const links = document.querySelectorAll('a');
        const results: any[] = [];
        const seen = new Set<string>();

        for (const a of links) {
          const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
          const href = a.getAttribute('href');
          const rect = a.getBoundingClientRect();

          // Skip parent menus, empty, too short/long, no href, javascript:void
          if (!text || text.length < 3 || text.length > 60) continue;
          if (!href || href === '#' || href === 'javascript:void(0)') continue;
          if (parents.includes(text)) continue;
          if (seen.has(text)) continue;

          // Must be visible and in the sidebar/submenu area (x < 300)
          if (rect.width === 0 || rect.height === 0) continue;
          if (a.offsetParent === null) continue;
          if (rect.x > 300) continue;

          // Must have a hash route pattern (like #m213p212#...)
          if (!href.includes('#m')) continue;

          seen.add(text);
          results.push({ text, href, x: Math.round(rect.x), y: Math.round(rect.y) });
        }
        return results;
      }, parentMenus);

      for (const child of childLinks) {
        if (items.some(i => i.text === child.text)) continue;

        items.push({
          text: child.text,
          href: child.href,
          level: 1,
          fullPath: `${parentName} > ${child.text}`,
          isLeaf: true,
          parentText: parentName,
          clickPath: [],
        });
      }

      console.log(`  ${parentName}: found ${childLinks.length} sub-pages`);
      for (const c of childLinks) {
        console.log(`    - ${c.text}`);
      }
    } catch (err) {
      console.log(`  Error expanding "${parentName}":`, (err as Error).message.slice(0, 80));
    }
  }

  return items;
}

// ── Discover Menu Structure ──────────────────────────────────────────────────
interface MenuItem {
  text: string;
  href: string | null;
  level: number;
  fullPath: string;
  isLeaf: boolean;
  parentText: string;
  clickPath: string[];  // sequence of selectors to click to reach this page
}

async function discoverMenuStructure(page: Page): Promise<MenuItem[]> {
  const items: MenuItem[] = [];

  // Strategy: find all sidebar/nav links and categorize them
  // First, discover the nav structure
  const navInfo = await page.evaluate(() => {
    const results: any[] = [];

    // Look for sidebar nav, top nav, accordion menus
    const navSelectors = [
      // Sidebar patterns
      'nav a', '.sidebar a', '#sidebar a', '.side-menu a', '.nav-sidebar a',
      '.menu a', '#menu a', '.left-menu a', '.main-menu a',
      // Accordion/tree menus
      '.panel-group a', '.accordion a', '.treeview a',
      // List-based menus
      'ul.nav a', 'ul.menu a', '.nav-pills a', '.nav-tabs a',
      // Generic nav links
      '[class*="nav"] a', '[class*="menu"] a', '[class*="sidebar"] a',
      // Specific patterns
      'a[href*="#"]', '.nav li a',
    ];

    const seen = new Set<string>();

    for (const sel of navSelectors) {
      const links = document.querySelectorAll(sel);
      for (const link of links) {
        const a = link as HTMLAnchorElement;
        const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
        const href = a.getAttribute('href');
        const rect = a.getBoundingClientRect();

        // Skip empty, tiny, or duplicate links
        if (!text || text.length < 2 || text.length > 100) continue;
        if (rect.width === 0 && rect.height === 0) continue;

        const key = text + '|' + (href || '');
        if (seen.has(key)) continue;
        seen.add(key);

        // Determine nesting level from parent structure
        let level = 0;
        let p: Element | null = a;
        while (p) {
          if (p.tagName === 'UL' || p.tagName === 'OL') level++;
          p = p.parentElement;
        }

        const parentLi = a.closest('li');
        const hasChildren = parentLi ? parentLi.querySelector('ul, .sub-menu, .children') !== null : false;
        const parentMenu = a.closest('ul')?.closest('li');
        const parentText = parentMenu ? (parentMenu.querySelector(':scope > a')?.textContent || '').trim() : '';

        results.push({
          text,
          href,
          level: Math.max(0, level - 1),
          isLeaf: !hasChildren,
          parentText,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          visible: a.offsetParent !== null,
          classes: a.className,
          id: a.id,
          outerHTML: a.outerHTML.slice(0, 200),
        });
      }
    }

    return results;
  });

  // Filter to only visible navigation items in the sidebar (x < 300 typically)
  const sidebarItems = navInfo.filter((n: any) => n.visible && n.x < 350);
  const mainAreaItems = navInfo.filter((n: any) => n.visible && n.x >= 350);

  console.log(`  Raw nav items: ${navInfo.length} (sidebar: ${sidebarItems.length}, main: ${mainAreaItems.length})`);

  // First try sidebar items, fallback to all visible items
  const navItems = sidebarItems.length > 0 ? sidebarItems : navInfo.filter((n: any) => n.visible);

  for (const ni of navItems) {
    // Skip common non-page links
    const skipTexts = ['logout', 'sign out', 'log out', 'profile', 'change password', 'home', 'dashboard'];
    if (skipTexts.some(s => ni.text.toLowerCase().includes(s))) continue;

    items.push({
      text: ni.text,
      href: ni.href,
      level: ni.level,
      fullPath: ni.parentText ? `${ni.parentText} > ${ni.text}` : ni.text,
      isLeaf: ni.isLeaf,
      parentText: ni.parentText,
      clickPath: [], // Will be populated during navigation
    });
  }

  // If few leaf items, expand parent menus one by one and collect children
  if (items.filter(i => i.isLeaf).length < 3) {
    console.log('  Expanding parent menus to find sub-pages...');
    const parentItems = items.filter(i => !i.isLeaf);
    const expandedItems: MenuItem[] = [];

    for (const parent of parentItems) {
      try {
        // Dismiss any modal that might be blocking
        await page.evaluate(() => {
          document.querySelectorAll('.modal.in, .modal.fade.in, .modal.show').forEach(m => {
            (m as HTMLElement).style.display = 'none';
            m.classList.remove('in', 'show');
          });
          document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
          document.body.classList.remove('modal-open');
          document.body.style.overflow = '';
        });
        await page.waitForTimeout(300);

        // Click parent menu to expand — use force to bypass any remaining overlays
        const parentLink = page.locator(`a:has-text("${parent.text}")`).first();
        if (await parentLink.count() > 0 && await parentLink.isVisible()) {
          await parentLink.click({ force: true });
          await page.waitForTimeout(1000);

          // Find newly visible child links
          const children = await page.$$eval('a', (links) => {
            return links
              .filter(a => a.offsetParent !== null && a.getBoundingClientRect().x < 350)
              .map(a => ({
                text: (a.textContent || '').trim().replace(/\s+/g, ' '),
                href: a.getAttribute('href'),
                x: Math.round(a.getBoundingClientRect().x),
                y: Math.round(a.getBoundingClientRect().y),
              }))
              .filter(a => a.text.length > 2 && a.text.length < 80);
          });

          for (const child of children) {
            // Skip the parent itself and common non-page items
            if (child.text === parent.text) continue;
            const skipTexts = ['logout', 'sign out', 'home', 'dashboard', 'superadmin', 'profile', 'change password'];
            if (skipTexts.some(s => child.text.toLowerCase().includes(s))) continue;
            // Skip if already in parent list
            if (parentItems.some(p => p.text === child.text)) continue;
            // Skip duplicates
            if (expandedItems.some(e => e.text === child.text)) continue;

            expandedItems.push({
              text: child.text,
              href: child.href,
              level: 1,
              fullPath: `${parent.text} > ${child.text}`,
              isLeaf: true,
              parentText: parent.text,
              clickPath: [],
            });
            console.log(`    Found: ${parent.text} > ${child.text}`);
          }
        }
      } catch (err) {
        console.log(`    Error expanding ${parent.text}:`, (err as Error).message.slice(0, 80));
      }
    }

    return expandedItems;
  }

  return items;
}

async function expandCollapsedMenus(page: Page): Promise<void> {
  // Click on all parent menu items to expand submenus
  const expandSelectors = [
    '.has-sub > a', '.has-children > a', '.has-submenu > a',
    '.treeview > a', 'li.parent > a', '[data-toggle="collapse"]',
    '.nav > li > a', '.sidebar > ul > li > a',
    'a[data-toggle="dropdown"]', '.dropdown-toggle',
  ];

  for (const sel of expandSelectors) {
    const els = page.locator(sel);
    const count = await els.count();
    for (let i = 0; i < count; i++) {
      try {
        const el = els.nth(i);
        if (await el.isVisible()) {
          await el.click();
          await page.waitForTimeout(500);
        }
      } catch { /* ignore click errors */ }
    }
  }
  await page.waitForTimeout(1000);
}

// ── Navigate to a specific page ──────────────────────────────────────────────
async function navigateToPage(page: Page, menu: MenuItem): Promise<void> {
  await dismissModals(page);

  // Click parent menu first to expand submenu
  if (menu.parentText) {
    await page.evaluate((menuText: string) => {
      const links = document.querySelectorAll('a');
      for (const a of links) {
        if ((a.textContent || '').trim().replace(/\s+/g, ' ') === menuText) {
          (a as HTMLElement).click();
          return;
        }
      }
    }, menu.parentText);
    await page.waitForTimeout(1000);
  }

  await dismissModals(page);

  // Click the child menu item via JS
  await page.evaluate((menuText: string) => {
    const links = document.querySelectorAll('a');
    for (const a of links) {
      if ((a.textContent || '').trim().replace(/\s+/g, ' ') === menuText) {
        (a as HTMLElement).click();
        return;
      }
    }
  }, menu.text);

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);
  await dismissModals(page);
}

async function dismissModals(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('.modal.in, .modal.fade.in, .modal.show').forEach(m => {
      (m as HTMLElement).style.display = 'none';
      m.classList.remove('in', 'show');
    });
    document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
  });
  await page.waitForTimeout(200);
}

// ── Analyze a page's DOM ─────────────────────────────────────────────────────
async function analyzePage(page: Page, pageName: string, menuPath: string): Promise<PageAnalysis> {
  const analysis: PageAnalysis = {
    pageName,
    url: page.url(),
    menuPath,
    elements: {
      buttons: [],
      inputs: [],
      dropdowns: [],
      radioButtons: [],
      checkboxes: [],
      tables: [],
      links: [],
      tabs: [],
      fileUploads: [],
      textareas: [],
      toggles: [],
      datePickers: [],
    },
    formFields: [],
    domNotes: [],
    iframes: 0,
    shadowDomElements: 0,
    hiddenFields: [],
    addButtonFound: false,
    screenshotPath: '',
    formScreenshotPath: '',
  };

  // Run comprehensive DOM analysis
  const domData = await page.evaluate(() => {
    const data: any = {
      buttons: [] as any[],
      inputs: [] as any[],
      selects: [] as any[],
      textareas: [] as any[],
      tables: [] as any[],
      links: [] as any[],
      tabs: [] as any[],
      iframeCount: document.querySelectorAll('iframe').length,
      shadowDomCount: 0,
      hiddenInputs: [] as any[],
    };

    // Count shadow DOM elements
    const allEls = document.querySelectorAll('*');
    for (const el of allEls) {
      if (el.shadowRoot) data.shadowDomCount++;
    }

    // Buttons
    const buttons = document.querySelectorAll('button, input[type="button"], input[type="submit"], a.btn, [role="button"]');
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      data.buttons.push({
        tag: btn.tagName.toLowerCase(),
        type: (btn as HTMLInputElement).type || '',
        id: btn.id,
        classes: btn.className,
        text: (btn.textContent || '').trim().slice(0, 100),
        visible: btn.offsetParent !== null || (rect.width > 0 && rect.height > 0),
        x: Math.round(rect.x), y: Math.round(rect.y),
      });
    }

    // Inputs
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      const rect = inp.getBoundingClientRect();
      const lbl = inp.id ? document.querySelector(`label[for="${inp.id}"]`) : null;
      const parentLabel = inp.closest('label');
      const labelText = (lbl?.textContent || parentLabel?.textContent || '').trim();

      if (inp.type === 'hidden') {
        data.hiddenInputs.push({
          tag: 'input', type: 'hidden', name: inp.name, id: inp.id, value: inp.value,
        });
        continue;
      }

      data.inputs.push({
        tag: 'input',
        type: inp.type || 'text',
        name: inp.name,
        id: inp.id,
        classes: inp.className,
        placeholder: inp.placeholder,
        required: inp.required,
        visible: inp.offsetParent !== null,
        label: labelText,
        value: inp.value,
        x: Math.round(rect.x), y: Math.round(rect.y),
      });
    }

    // Selects (dropdowns)
    const selects = document.querySelectorAll('select');
    for (const sel of selects) {
      const rect = sel.getBoundingClientRect();
      const lbl = sel.id ? document.querySelector(`label[for="${sel.id}"]`) : null;
      const options = Array.from(sel.options).map(o => ({
        value: o.value,
        text: o.textContent?.trim() || '',
        selected: o.selected,
      }));

      data.selects.push({
        tag: 'select',
        name: sel.name,
        id: sel.id,
        classes: sel.className,
        required: sel.required,
        visible: sel.offsetParent !== null,
        label: (lbl?.textContent || '').trim(),
        optionCount: options.length,
        options: options.slice(0, 50), // Limit to first 50 options
        x: Math.round(rect.x), y: Math.round(rect.y),
      });
    }

    // Textareas
    const textareas = document.querySelectorAll('textarea');
    for (const ta of textareas) {
      const rect = ta.getBoundingClientRect();
      const lbl = ta.id ? document.querySelector(`label[for="${ta.id}"]`) : null;
      data.textareas.push({
        tag: 'textarea',
        name: ta.name,
        id: ta.id,
        classes: ta.className,
        placeholder: ta.placeholder,
        required: ta.required,
        visible: ta.offsetParent !== null,
        label: (lbl?.textContent || '').trim(),
        x: Math.round(rect.x), y: Math.round(rect.y),
      });
    }

    // Tables
    const tables = document.querySelectorAll('table');
    for (const tbl of tables) {
      const headers = Array.from(tbl.querySelectorAll('th')).map(th => (th.textContent || '').trim());
      const rows = tbl.querySelectorAll('tbody tr');
      const hasActions = tbl.querySelector('.fa-edit, .fa-trash, .fa-pencil, .btn-delete, [data-action], .fa-times') !== null;

      data.tables.push({
        id: tbl.id,
        classes: tbl.className,
        headers,
        rowCount: rows.length,
        hasActions,
        visible: tbl.offsetParent !== null,
      });
    }

    // Links (non-nav, in main content area)
    const mainContent = document.querySelector('.content, .main-content, #content, main, .page-content') || document.body;
    const links = mainContent.querySelectorAll('a:not(.nav a):not(.sidebar a):not(.menu a)');
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (rect.x < 300) continue; // Skip sidebar links
      data.links.push({
        tag: 'a',
        text: (link.textContent || '').trim().slice(0, 100),
        href: link.getAttribute('href'),
        visible: link.offsetParent !== null,
        x: Math.round(rect.x), y: Math.round(rect.y),
      });
    }

    // Tabs
    const tabSels = document.querySelectorAll('[role="tab"], .nav-tabs a, .tab-pane, [data-toggle="tab"]');
    for (const tab of tabSels) {
      data.tabs.push({
        tag: tab.tagName.toLowerCase(),
        text: (tab.textContent || '').trim(),
        id: tab.id,
        classes: tab.className,
        visible: tab.offsetParent !== null,
      });
    }

    return data;
  });

  // Map DOM data to analysis structure
  analysis.elements.buttons = domData.buttons.map((b: any) => ({
    ...b, selector: buildSelector(b),
  }));
  analysis.elements.inputs = domData.inputs.filter((i: any) => i.type !== 'radio' && i.type !== 'checkbox' && i.type !== 'file' && i.type !== 'date').map((i: any) => ({
    ...i, selector: buildSelector(i),
  }));
  analysis.elements.dropdowns = domData.selects.map((s: any) => ({
    ...s, selector: buildSelector(s),
  }));
  analysis.elements.radioButtons = domData.inputs.filter((i: any) => i.type === 'radio').map((i: any) => ({
    ...i, selector: buildSelector(i),
  }));
  analysis.elements.checkboxes = domData.inputs.filter((i: any) => i.type === 'checkbox').map((i: any) => ({
    ...i, selector: buildSelector(i),
  }));
  analysis.elements.fileUploads = domData.inputs.filter((i: any) => i.type === 'file').map((i: any) => ({
    ...i, selector: buildSelector(i),
  }));
  analysis.elements.datePickers = domData.inputs.filter((i: any) => i.type === 'date' || i.type === 'datetime-local').map((i: any) => ({
    ...i, selector: buildSelector(i),
  }));
  analysis.elements.textareas = domData.textareas.map((t: any) => ({
    ...t, selector: buildSelector(t),
  }));
  analysis.elements.tables = domData.tables.map((t: any) => ({
    ...t, selector: t.id ? `#${t.id}` : `table.${(t.classes || 'table').split(' ')[0]}`,
  }));
  analysis.elements.links = domData.links.map((l: any) => ({
    ...l, selector: l.href ? `a[href="${l.href}"]` : `a:has-text("${l.text}")`,
  }));
  analysis.elements.tabs = domData.tabs;
  analysis.iframes = domData.iframeCount;
  analysis.shadowDomElements = domData.shadowDomCount;
  analysis.hiddenFields = domData.hiddenInputs;

  // DOM notes
  if (domData.iframeCount > 0) analysis.domNotes.push(`Contains ${domData.iframeCount} iframe(s)`);
  if (domData.shadowDomCount > 0) analysis.domNotes.push(`Contains ${domData.shadowDomCount} Shadow DOM element(s)`);
  if (domData.hiddenInputs.length > 0) analysis.domNotes.push(`Contains ${domData.hiddenInputs.length} hidden input(s): ${domData.hiddenInputs.map((h: any) => h.name || h.id).join(', ')}`);

  return analysis;
}

// ── Analyze form fields ──────────────────────────────────────────────────────
async function analyzeForm(page: Page, pageName: string): Promise<FieldInfo[]> {
  const fields: FieldInfo[] = [];

  const formData = await page.evaluate(() => {
    const results: any[] = [];
    const formContainer = document.querySelector('form, .modal, .panel-body, .card-body, .form-horizontal, .form-group')?.closest('form, .modal, .panel, .card, div') || document.body;

    // Find all form groups / labeled field containers
    const groups = formContainer.querySelectorAll('.form-group, .field-group, .input-group, .col-md-6, .col-sm-6, .col-md-12, .col-lg-6');

    for (const group of groups) {
      const label = group.querySelector('label');
      const input = group.querySelector('input:not([type="hidden"]), select, textarea');

      if (!input) continue;

      const inp = input as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const rect = inp.getBoundingClientRect();

      let fieldType = 'Text Field';
      let options: string[] = [];

      if (inp.tagName === 'SELECT') {
        fieldType = 'Dropdown';
        options = Array.from((inp as HTMLSelectElement).options).map(o => o.textContent?.trim() || '').filter(t => t && !t.includes('Select') && !t.includes('--'));
      } else if (inp.tagName === 'TEXTAREA') {
        fieldType = 'Text Area';
      } else if (inp.tagName === 'INPUT') {
        const type = (inp as HTMLInputElement).type;
        if (type === 'radio') fieldType = 'Radio Button';
        else if (type === 'checkbox') fieldType = 'Checkbox';
        else if (type === 'date' || type === 'datetime-local') fieldType = 'Date Picker';
        else if (type === 'file') fieldType = 'File Upload';
        else fieldType = 'Text Field';
      }

      results.push({
        label: (label?.textContent || '').trim(),
        fieldType,
        tag: inp.tagName.toLowerCase(),
        type: (inp as HTMLInputElement).type || '',
        name: inp.name,
        id: inp.id,
        classes: inp.className,
        placeholder: (inp as HTMLInputElement).placeholder || '',
        required: (inp as HTMLInputElement).required || false,
        visible: inp.offsetParent !== null,
        options,
        x: Math.round(rect.x), y: Math.round(rect.y),
      });
    }

    // Also catch standalone inputs not inside form-groups
    const standaloneInputs = formContainer.querySelectorAll('input:not([type="hidden"]):not(.form-group input), select:not(.form-group select), textarea:not(.form-group textarea)');
    for (const inp of standaloneInputs) {
      const el = inp as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const rect = el.getBoundingClientRect();
      if (!el.offsetParent) continue; // skip hidden

      // Check if already captured
      const already = results.some(r => r.id === el.id && r.name === el.name);
      if (already) continue;

      let fieldType = 'Text Field';
      let options: string[] = [];

      if (el.tagName === 'SELECT') {
        fieldType = 'Dropdown';
        options = Array.from((el as HTMLSelectElement).options).map(o => o.textContent?.trim() || '').filter(t => t && !t.includes('Select') && !t.includes('--'));
      } else if (el.tagName === 'TEXTAREA') {
        fieldType = 'Text Area';
      } else if (el.tagName === 'INPUT') {
        const type = (el as HTMLInputElement).type;
        if (type === 'radio') fieldType = 'Radio Button';
        else if (type === 'checkbox') fieldType = 'Checkbox';
        else if (type === 'date' || type === 'datetime-local') fieldType = 'Date Picker';
        else if (type === 'file') fieldType = 'File Upload';
        else fieldType = 'Text Field';
      }

      const lbl = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;

      results.push({
        label: (lbl?.textContent || el.name || el.id || el.placeholder || '').trim(),
        fieldType,
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type || '',
        name: el.name,
        id: el.id,
        classes: el.className,
        placeholder: (el as HTMLInputElement).placeholder || '',
        required: (el as HTMLInputElement).required || false,
        visible: true,
        options,
        x: Math.round(rect.x), y: Math.round(rect.y),
      });
    }

    return results;
  });

  for (const fd of formData) {
    if (!fd.visible) continue;

    const selector = fd.id ? `#${fd.id}` : (fd.name ? `${fd.tag}[name="${fd.name}"]` : `${fd.tag}[placeholder="${fd.placeholder}"]`);
    const notes: string[] = [];
    if (fd.required) notes.push('Required');
    if (fd.options && fd.options.length > 0) notes.push(`Options: ${fd.options.slice(0, 10).join(', ')}${fd.options.length > 10 ? '...' : ''}`);
    if (fd.placeholder) notes.push(`Placeholder: "${fd.placeholder}"`);

    fields.push({
      pageName,
      section: 'Create Form',
      fieldLabel: fd.label || fd.name || fd.id || fd.placeholder || 'Unknown',
      fieldType: fd.fieldType,
      domIdentifier: selector,
      notes: notes.join(' | '),
    });
  }

  return fields;
}

// ── Try to open an Add/Create form ───────────────────────────────────────────
async function tryOpenAddForm(page: Page): Promise<boolean> {
  const addButtonSelectors = [
    'button:has-text("Add"):visible',
    'button:has-text("Create"):visible',
    'button:has-text("New"):visible',
    'a:has-text("Add"):visible',
    'a:has-text("Create"):visible',
    '#btnAdd:visible',
    '#btnCreate:visible',
    '#btnNew:visible',
    '.btn-add:visible',
    'button:has(.fa-plus):visible',
    'a:has(.fa-plus):visible',
    '.fa-plus:visible',
  ];

  for (const sel of addButtonSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        const box = await el.boundingBox();
        if (box && box.x > 100) { // Skip sidebar icons
          await el.click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(1500);

          // Check if a form appeared
          const formVisible = await page.locator('form:visible, .modal:visible, input:visible[type="text"]').count() > 0;
          if (formVisible) return true;
        }
      }
    } catch { /* continue to next selector */ }
  }

  return false;
}

// ── Check for dynamic content (dropdowns that load more fields) ──────────────
async function checkDynamicContent(page: Page, fields: FieldInfo[], pageName: string): Promise<void> {
  // Find dropdowns that might trigger dynamic content loading
  const dropdownFields = fields.filter(f => f.fieldType === 'Dropdown');

  for (const dd of dropdownFields) {
    try {
      const sel = page.locator(dd.domIdentifier).first();
      if (await sel.count() > 0 && await sel.isVisible()) {
        // Select the first non-empty option to see if it triggers dynamic content
        const options = await sel.locator('option').all();
        for (const opt of options) {
          const val = await opt.getAttribute('value');
          const txt = ((await opt.textContent()) || '').trim();
          if (val && val !== '' && val !== '0' && !txt.includes('Select') && !txt.includes('--')) {
            // Select this option
            await sel.selectOption(val);
            // Fire change events
            await sel.dispatchEvent('change');
            await sel.evaluate((el: HTMLSelectElement) => {
              el.dispatchEvent(new Event('change', { bubbles: true }));
              if (typeof (window as any).$ !== 'undefined') {
                (window as any).$(el).trigger('change');
              }
            });
            await page.waitForLoadState('networkidle');
            await page.waitForTimeout(2000);

            // Check if new fields appeared
            const newFieldCount = await page.locator('input:visible:not([type="hidden"]), select:visible, textarea:visible').count();
            console.log(`  After selecting "${txt}" in ${dd.fieldLabel}: ${newFieldCount} visible fields`);

            // Reset the dropdown
            await sel.selectOption('');
            await page.waitForTimeout(500);
            break; // Only test the first valid option
          }
        }
      }
    } catch (err) {
      // Ignore errors during dynamic content check
    }
  }
}

// ── Go back to list page ─────────────────────────────────────────────────────
async function goBackToList(page: Page): Promise<void> {
  const backSelectors = [
    'button:has-text("Back"):visible',
    'a:has-text("Back"):visible',
    'button:has-text("Cancel"):visible',
    '.btn-back:visible',
    '#btnBack:visible',
    'a:has(.fa-arrow-left):visible',
    '.fa-arrow-left:visible',
  ];

  for (const sel of backSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible()) {
        const box = await el.boundingBox();
        if (box && box.x > 100) {
          await el.click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(1000);
          return;
        }
      }
    } catch { /* continue */ }
  }

  // Fallback: press browser back
  await page.goBack();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
}

// ── Generate page-level markdown ─────────────────────────────────────────────
function generatePageMarkdown(pa: PageAnalysis): string {
  let md = `# ${pa.pageName} — UI Reference\n\n`;
  md += `**URL:** ${pa.url}\n`;
  md += `**Menu Path:** ${pa.menuPath}\n`;
  md += `**Add Button Available:** ${pa.addButtonFound ? 'Yes' : 'No'}\n\n`;

  if (pa.domNotes.length > 0) {
    md += `## DOM Notes\n`;
    for (const note of pa.domNotes) md += `- ${note}\n`;
    md += `\n`;
  }

  // Buttons
  if (pa.elements.buttons.length > 0) {
    md += `## Buttons (${pa.elements.buttons.length})\n\n`;
    md += `| Text | Type | ID | Selector | Visible |\n`;
    md += `|------|------|----|----------|---------|\n`;
    for (const b of pa.elements.buttons) {
      md += `| ${(b.text || '').slice(0, 40)} | ${b.type || ''} | ${b.id || ''} | \`${b.selector}\` | ${b.visible} |\n`;
    }
    md += `\n`;
  }

  // Input Fields
  if (pa.elements.inputs.length > 0) {
    md += `## Input Fields (${pa.elements.inputs.length})\n\n`;
    md += `| Label | Type | Name | ID | Placeholder | Selector | Required |\n`;
    md += `|-------|------|------|----|-------------|----------|----------|\n`;
    for (const i of pa.elements.inputs) {
      md += `| ${i.label || ''} | ${i.type || 'text'} | ${i.name || ''} | ${i.id || ''} | ${i.placeholder || ''} | \`${i.selector}\` | ${i.required || false} |\n`;
    }
    md += `\n`;
  }

  // Dropdowns
  if (pa.elements.dropdowns.length > 0) {
    md += `## Dropdowns (${pa.elements.dropdowns.length})\n\n`;
    for (const d of pa.elements.dropdowns) {
      md += `### ${d.label || d.name || d.id || 'Dropdown'}\n`;
      md += `- **Selector:** \`${d.selector}\`\n`;
      md += `- **Name:** ${d.name || 'N/A'}\n`;
      md += `- **ID:** ${d.id || 'N/A'}\n`;
      md += `- **Option Count:** ${(d as any).optionCount || 0}\n`;
      if ((d as any).options && (d as any).options.length > 0) {
        md += `- **Options (first 20):**\n`;
        for (const opt of (d as any).options.slice(0, 20)) {
          md += `  - \`${opt.value}\` — ${opt.text}\n`;
        }
      }
      md += `\n`;
    }
  }

  // Radio Buttons
  if (pa.elements.radioButtons.length > 0) {
    md += `## Radio Buttons (${pa.elements.radioButtons.length})\n\n`;
    md += `| Label | Name | ID | Value | Selector |\n`;
    md += `|-------|------|----|-------|----------|\n`;
    for (const r of pa.elements.radioButtons) {
      md += `| ${r.label || ''} | ${r.name || ''} | ${r.id || ''} | ${r.value || ''} | \`${r.selector}\` |\n`;
    }
    md += `\n`;
  }

  // Checkboxes
  if (pa.elements.checkboxes.length > 0) {
    md += `## Checkboxes (${pa.elements.checkboxes.length})\n\n`;
    md += `| Label | Name | ID | Selector |\n`;
    md += `|-------|------|----|----------|\n`;
    for (const c of pa.elements.checkboxes) {
      md += `| ${c.label || ''} | ${c.name || ''} | ${c.id || ''} | \`${c.selector}\` |\n`;
    }
    md += `\n`;
  }

  // Tables
  if (pa.elements.tables.length > 0) {
    md += `## Tables (${pa.elements.tables.length})\n\n`;
    for (const t of pa.elements.tables) {
      md += `### ${t.id || 'Table'}\n`;
      md += `- **Selector:** \`${t.selector}\`\n`;
      md += `- **Rows:** ${t.rowCount}\n`;
      md += `- **Has Action Buttons:** ${t.hasActions}\n`;
      md += `- **Headers:** ${t.headers.join(' | ')}\n\n`;
    }
  }

  // File Uploads
  if (pa.elements.fileUploads.length > 0) {
    md += `## File Uploads (${pa.elements.fileUploads.length})\n\n`;
    for (const f of pa.elements.fileUploads) {
      md += `- **Selector:** \`${f.selector}\` (name: ${f.name || 'N/A'}, id: ${f.id || 'N/A'})\n`;
    }
    md += `\n`;
  }

  // Textareas
  if (pa.elements.textareas.length > 0) {
    md += `## Text Areas (${pa.elements.textareas.length})\n\n`;
    for (const t of pa.elements.textareas) {
      md += `- **Label:** ${t.label || 'N/A'} — **Selector:** \`${t.selector}\` (name: ${t.name || 'N/A'})\n`;
    }
    md += `\n`;
  }

  // Tabs
  if (pa.elements.tabs.length > 0) {
    md += `## Tabs (${pa.elements.tabs.length})\n\n`;
    for (const t of pa.elements.tabs) {
      md += `- ${t.text || 'Tab'} (id: ${t.id || 'N/A'})\n`;
    }
    md += `\n`;
  }

  // Hidden Fields
  if (pa.hiddenFields.length > 0) {
    md += `## Hidden Fields (${pa.hiddenFields.length})\n\n`;
    md += `| Name | ID | Value |\n`;
    md += `|------|----|-------|\n`;
    for (const h of pa.hiddenFields) {
      md += `| ${h.name || ''} | ${h.id || ''} | ${(h.value || '').slice(0, 50)} |\n`;
    }
    md += `\n`;
  }

  // Form Fields Summary
  if (pa.formFields.length > 0) {
    md += `## Form Fields Summary (${pa.formFields.length})\n\n`;
    md += `| Field Label | Field Type | DOM Identifier | Notes |\n`;
    md += `|-------------|-----------|----------------|-------|\n`;
    for (const f of pa.formFields) {
      md += `| ${f.fieldLabel} | ${f.fieldType} | \`${f.domIdentifier}\` | ${f.notes} |\n`;
    }
    md += `\n`;
  }

  return md;
}

// ── Generate CSV (Excel-compatible) inventory ────────────────────────────────
function generateExcelCSV(fields: FieldInfo[]): void {
  const headers = ['Page Name', 'Section', 'Field Label', 'Field Type', 'DOM Identifier', 'Notes'];
  let csv = headers.join('\t') + '\n';

  for (const f of fields) {
    const row = [
      f.pageName,
      f.section,
      f.fieldLabel,
      f.fieldType,
      f.domIdentifier,
      f.notes.replace(/\t/g, ' '),
    ];
    csv += row.join('\t') + '\n';
  }

  fs.writeFileSync(path.join(OUTPUT_DIR, 'UI_Field_Inventory.csv'), csv);
}

// ── Generate index file ──────────────────────────────────────────────────────
function generateIndexFile(pages: PageAnalysis[]): void {
  let md = `# UI Page Analysis — Index\n\n`;
  md += `**Generated:** ${new Date().toISOString()}\n`;
  md += `**Application:** ${BASE_URL}\n`;
  md += `**Total Pages Explored:** ${pages.length}\n`;
  md += `**Total Fields Found:** ${pages.reduce((sum, p) => sum + p.formFields.length, 0)}\n\n`;

  md += `## Pages\n\n`;
  md += `| # | Page Name | Menu Path | URL | Fields | Add Form | Tables |\n`;
  md += `|---|-----------|-----------|-----|--------|----------|--------|\n`;

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const fileName = sanitizeName(p.pageName) + '_UI_Reference.md';
    md += `| ${i + 1} | [${p.pageName}](${fileName}) | ${p.menuPath} | ${p.url} | ${p.formFields.length} | ${p.addButtonFound ? 'Yes' : 'No'} | ${p.elements.tables.length} |\n`;
  }

  md += `\n## Field Inventory\n\nSee [UI_Field_Inventory.csv](UI_Field_Inventory.csv) for the complete field inventory.\n`;

  fs.writeFileSync(path.join(OUTPUT_DIR, '_INDEX.md'), md);
}

// ── Utility ──────────────────────────────────────────────────────────────────
function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// ── Run ──────────────────────────────────────────────────────────────────────
main().catch(console.error);
