/**
 * Seed script: generates demo visual baseline data for PPT screenshots.
 * Run: node scripts/seed-visual-baselines.js
 */

const fs   = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const PROJECT_ID = '3a39c8a2-06ea-4a83-9aca-e3a316ea940a'; // BSS Mediation
const BASELINES_DIR = path.resolve('data', 'visual-baselines');
const INDEX_FILE    = path.join(BASELINES_DIR, 'index.json');
const projectSlug   = PROJECT_ID; // hyphens are kept by the slugifier
const PROJECT_DIR   = path.join(BASELINES_DIR, projectSlug);

fs.mkdirSync(PROJECT_DIR, { recursive: true });

// ── helpers ──────────────────────────────────────────────────────────────────

function slug(s) { return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60); }
function makeId(testName, locatorName) {
  return `${slug(PROJECT_ID)}__${slug(testName)}__${slug(locatorName)}`;
}

/** Create a W×H PNG, call draw(img, W, H) to paint pixels, return Buffer */
function makePng(W, H, draw) {
  const img = new PNG({ width: W, height: H });
  img.data = Buffer.alloc(W * H * 4, 0);
  draw(img, W, H);
  return PNG.sync.write(img);
}

/** Fill a rectangle on a PNG image */
function fillRect(img, x, y, w, h, r, g, b, a = 255) {
  for (let row = y; row < y + h; row++) {
    for (let col = x; col < x + w; col++) {
      const idx = (row * img.width + col) * 4;
      img.data[idx]     = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = a;
    }
  }
}

/** Fill entire image with a solid color */
function fillBg(img, r, g, b) { fillRect(img, 0, 0, img.width, img.height, r, g, b); }

/** Draw a simple 1px border */
function border(img, x, y, w, h, r, g, b) {
  fillRect(img, x,       y,       w, 1, r, g, b);
  fillRect(img, x,       y + h-1, w, 1, r, g, b);
  fillRect(img, x,       y,       1, h, r, g, b);
  fillRect(img, x + w-1, y,       1, h, r, g, b);
}

// ── image factories ───────────────────────────────────────────────────────────

/** Login Page — Username Field */
function loginBaseline(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 245, 247, 250);
    // card
    fillRect(img, 20, 10, W - 40, H - 20, 255, 255, 255);
    border(img, 20, 10, W - 40, H - 20, 220, 220, 220);
    // label row
    fillRect(img, 36, 22, 80, 8, 90, 90, 100);
    // input field (blue outline = focused)
    fillRect(img, 36, 36, W - 72, 24, 255, 255, 255);
    border(img, 36, 36, W - 72, 24, 60, 130, 246);
    // placeholder text lines
    fillRect(img, 42, 46, 100, 6, 190, 190, 200);
    // validation tick
    fillRect(img, W - 52, 40, 12, 12, 52, 199, 89);
  });
}

/** Login Page — Username Field with tiny tweak (actual) */
function loginActual(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 245, 247, 250);
    fillRect(img, 20, 10, W - 40, H - 20, 255, 255, 255);
    border(img, 20, 10, W - 40, H - 20, 220, 220, 220);
    fillRect(img, 36, 22, 80, 8, 90, 90, 100);
    // input with slightly different border color
    fillRect(img, 36, 36, W - 72, 24, 255, 255, 255);
    border(img, 36, 36, W - 72, 24, 100, 160, 255);
    fillRect(img, 42, 46, 100, 6, 190, 190, 200);
    fillRect(img, W - 52, 40, 12, 12, 52, 199, 89);
  });
}

/** Dashboard — Navigation Header baseline */
function navHeaderBaseline(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 30, 30, 46);
    // brand strip
    fillRect(img, 0, 0, W, H, 24, 24, 37);
    // logo block
    fillRect(img, 14, H/2 - 8, 32, 16, 99, 102, 241);
    // nav items
    const items = [60, 100, 140, 180, 220];
    items.forEach(x => fillRect(img, x, H/2 - 5, 32, 10, 148, 163, 184));
    // active item highlight
    fillRect(img, 60, H - 3, 32, 3, 99, 102, 241);
    // avatar circle
    fillRect(img, W - 36, H/2 - 10, 20, 20, 99, 102, 241);
    fillRect(img, W - 34, H/2 - 8, 16, 16, 60, 60, 80);
  });
}

/** Dashboard — KPI Cards baseline */
function kpiCardsBaseline(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 245, 247, 250);
    const cards = [
      { x: 10, color: [99, 102, 241],  label: [120, 140, 180] },
      { x: 90, color: [52, 199, 89],   label: [120, 140, 180] },
      { x: 170, color: [251, 191, 36], label: [120, 140, 180] },
    ];
    cards.forEach(c => {
      fillRect(img, c.x, 10, 70, H - 20, 255, 255, 255);
      border(img, c.x, 10, 70, H - 20, 220, 220, 220);
      fillRect(img, c.x + 8, 18, 24, 24, ...c.color);
      fillRect(img, c.x + 8, 50, 54, 10, 40, 40, 60);
      fillRect(img, c.x + 8, 66, 40, 7, ...c.label);
    });
  });
}

/** Reports — Export Button baseline */
function exportBtnBaseline(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 245, 247, 250);
    // button
    fillRect(img, 10, 10, W - 20, H - 20, 99, 102, 241);
    // icon block
    fillRect(img, 24, H/2 - 6, 14, 12, 255, 255, 255);
    // label
    fillRect(img, 44, H/2 - 4, 60, 8, 255, 255, 255);
  });
}

/** Reports — Export Button actual (button is now red — regression!) */
function exportBtnActual(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 245, 247, 250);
    // button color changed to red
    fillRect(img, 10, 10, W - 20, H - 20, 220, 53, 69);
    fillRect(img, 24, H/2 - 6, 14, 12, 255, 255, 255);
    fillRect(img, 44, H/2 - 4, 60, 8, 255, 255, 255);
  });
}

/** Diff image: red pixels where export button changed */
function exportBtnDiff(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 245, 247, 250);
    // diff area: the button area is highlighted red
    fillRect(img, 10, 10, W - 20, H - 20, 255, 90, 90, 180);
    // unchanged icon/label pixels in grey
    fillRect(img, 24, H/2 - 6, 14, 12, 180, 180, 180);
    fillRect(img, 44, H/2 - 4, 60, 8, 180, 180, 180);
  });
}

/** Checkout Flow — Summary Table baseline */
function summaryTableBaseline(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 255, 255, 255);
    border(img, 0, 0, W, H, 220, 220, 220);
    // header row
    fillRect(img, 0, 0, W, 20, 241, 245, 249);
    fillRect(img, 10, 7, 60, 7, 60, 60, 80);
    fillRect(img, W - 80, 7, 50, 7, 60, 60, 80);
    // rows
    const rows = [20, 38, 56, 74];
    rows.forEach((y, i) => {
      if (i % 2 === 1) fillRect(img, 0, y, W, 18, 248, 249, 252);
      fillRect(img, 10, y + 5, 80, 7, 100, 100, 120);
      fillRect(img, W - 80, y + 5, 50, 7, 100, 100, 120);
    });
    // total row
    fillRect(img, 0, 92, W, 20, 235, 245, 255);
    fillRect(img, 10, 99, 40, 8, 40, 40, 60);
    fillRect(img, W - 80, 99, 50, 8, 99, 102, 241);
  });
}

/** Checkout Flow — Summary Table actual (row heights shifted slightly) */
function summaryTableActual(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 255, 255, 255);
    border(img, 0, 0, W, H, 220, 220, 220);
    fillRect(img, 0, 0, W, 22, 241, 245, 249); // header taller by 2px
    fillRect(img, 10, 8, 60, 7, 60, 60, 80);
    fillRect(img, W - 80, 8, 50, 7, 60, 60, 80);
    const rows = [22, 40, 58, 76]; // shifted
    rows.forEach((y, i) => {
      if (i % 2 === 1) fillRect(img, 0, y, W, 18, 248, 249, 252);
      fillRect(img, 10, y + 5, 80, 7, 100, 100, 120);
      fillRect(img, W - 80, y + 5, 50, 7, 100, 100, 120);
    });
    fillRect(img, 0, 94, W, 20, 235, 245, 255);
    fillRect(img, 10, 101, 40, 8, 40, 40, 60);
    fillRect(img, W - 80, 101, 50, 8, 99, 102, 241);
  });
}

/** Diff for table (yellow scatter across header/row boundary) */
function summaryTableDiff(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 255, 255, 255);
    // header boundary changed — highlight in red
    fillRect(img, 0, 18, W, 4, 255, 60, 60, 160);
    // row shift diffs (rows 1–4)
    [38, 56, 74, 92].forEach(y => {
      fillRect(img, 0, y, W, 2, 255, 60, 60, 130);
    });
  });
}

/** Sidebar Navigation baseline */
function sidebarBaseline(W, H) {
  return makePng(W, H, (img) => {
    fillBg(img, 24, 24, 37);
    // logo area
    fillRect(img, 12, 12, W - 24, 30, 30, 30, 46);
    fillRect(img, 18, 20, 16, 16, 99, 102, 241);
    fillRect(img, 40, 24, 50, 8, 148, 163, 184);
    // nav items
    const items = [56, 80, 104, 128, 152, 176, 200];
    items.forEach((y, i) => {
      const active = i === 0;
      if (active) fillRect(img, 0, y, W, 22, 40, 40, 60);
      if (active) fillRect(img, 0, y, 3, 22, 99, 102, 241);
      fillRect(img, 14, y + 7, 14, 8, active ? 99 : 80, active ? 102 : 80, active ? 241 : 100);
      fillRect(img, 34, y + 8, W - 48, 6, active ? 200 : 100, active ? 200 : 100, active ? 255 : 120);
    });
  });
}

// ── write images ──────────────────────────────────────────────────────────────

const W1 = 400, H1 = 80;   // login field
const W2 = 400, H2 = 40;   // nav header
const W3 = 260, H3 = 100;  // KPI cards (3-up)
const W4 = 160, H4 = 60;   // export button
const W5 = 300, H5 = 120;  // summary table
const W6 = 200, H6 = 230;  // sidebar

const entries = [
  {
    test: 'TC-001 Login Page Validation',
    loc: 'username-input-field',
    W: W1, H: H1,
    baseline: loginBaseline(W1, H1),
    actual:   loginActual(W1, H1),
    diff:     null,
    status:   'approved',
    diffPct:  null,
    approvedAt: '2026-05-20T09:15:00.000Z',
    approvedBy: 'harmeet.saini',
    lastRunAt:  '2026-05-28T06:30:00.000Z',
  },
  {
    test: 'TC-008 Dashboard Navigation',
    loc: 'top-nav-header-bar',
    W: W2, H: H2,
    baseline: navHeaderBaseline(W2, H2),
    actual:   navHeaderBaseline(W2, H2),
    diff:     null,
    status:   'approved',
    diffPct:  null,
    approvedAt: '2026-05-21T11:00:00.000Z',
    approvedBy: 'harmeet.saini',
    lastRunAt:  '2026-05-28T06:35:00.000Z',
  },
  {
    test: 'TC-015 Dashboard KPI Overview',
    loc: 'kpi-cards-row',
    W: W3, H: H3,
    baseline: kpiCardsBaseline(W3, H3),
    actual:   kpiCardsBaseline(W3, H3),
    diff:     null,
    status:   'approved',
    diffPct:  null,
    approvedAt: '2026-05-21T11:05:00.000Z',
    approvedBy: 'harmeet.saini',
    lastRunAt:  '2026-05-28T06:40:00.000Z',
  },
  {
    test: 'TC-034 Reports Export Workflow',
    loc: 'export-to-csv-button',
    W: W4, H: H4,
    baseline: exportBtnBaseline(W4, H4),
    actual:   exportBtnActual(W4, H4),
    diff:     exportBtnDiff(W4, H4),
    status:   'pending-review',
    diffPct:  18.4,
    lastRunAt: '2026-05-28T07:00:00.000Z',
  },
  {
    test: 'TC-047 Checkout Summary Totals',
    loc: 'order-summary-table',
    W: W5, H: H5,
    baseline: summaryTableBaseline(W5, H5),
    actual:   summaryTableActual(W5, H5),
    diff:     summaryTableDiff(W5, H5),
    status:   'pending-review',
    diffPct:  3.2,
    lastRunAt: '2026-05-28T07:10:00.000Z',
  },
  {
    test: 'TC-052 Sidebar Navigation Links',
    loc: 'left-sidebar-nav-panel',
    W: W6, H: H6,
    baseline: sidebarBaseline(W6, H6),
    actual:   sidebarBaseline(W6, H6),
    diff:     null,
    status:   'approved',
    diffPct:  null,
    approvedAt: '2026-05-22T10:00:00.000Z',
    approvedBy: 'harmeet.saini',
    lastRunAt:  '2026-05-28T06:45:00.000Z',
  },
];

const index = [];

entries.forEach(e => {
  const id = makeId(e.test, e.loc);
  const baselinePath = path.join(PROJECT_DIR, `${id}.png`);
  const actualPath   = path.join(PROJECT_DIR, `${id}-actual.png`);
  const diffPath     = path.join(PROJECT_DIR, `${id}-diff.png`);

  fs.writeFileSync(baselinePath, e.baseline);
  fs.writeFileSync(actualPath,   e.actual);
  if (e.diff) fs.writeFileSync(diffPath, e.diff);

  console.log(`✓ ${e.test} → ${id}`);

  index.push({
    id,
    projectId:  PROJECT_ID,
    testName:   e.test,
    locatorName: e.loc,
    threshold:  0.1,
    status:     e.status,
    diffPct:    e.diffPct,
    lastRunAt:  e.lastRunAt,
    createdAt:  '2026-05-15T08:00:00.000Z',
    approvedAt: e.approvedAt || undefined,
    approvedBy: e.approvedBy || undefined,
    width:      e.W,
    height:     e.H,
  });
});

fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
console.log(`\n✅ index.json written with ${index.length} entries`);
console.log(`📁 ${PROJECT_DIR}`);
