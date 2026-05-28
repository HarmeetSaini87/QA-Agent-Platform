# Phase H — UI Polish, Export, Graph Enhancements & Notification Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the 5 new Phase G pages (Plugins, Graph Editor, Collaboration, Copilot, Performance) with a global toast notification system, client-side CSV/JSON export, graph zoom controls, and missing CSS polish (advisory banner, consistent empty states).

**Architecture:** All changes are frontend-only (no backend routes, no TypeScript compilation, no server restart). Every JS edit goes into the numbered module files under `src/ui/public/js/`, then `npm run build:js` concatenates them into `modules.js`. CSS additions go into `styles_addon.css`. The `index.html` gets minor additions (toast container div, export/zoom buttons). Static files are served directly — browser hard-refresh (`Ctrl+F5`) is the only deploy step.

**Tech Stack:** Vanilla JS, CSS custom properties (var(--...)), `modules.js` build pipeline (`npm run build:js`), Blob API for client-side file downloads.

---

## File Map

| File | Change |
|---|---|
| `src/ui/public/styles_addon.css` | Add `.toast-*`, `.advisory-banner` CSS rules |
| `src/ui/public/index.html` | Add `#toast-container` div; export buttons on 4 panels; zoom controls on graph panel |
| `src/ui/public/js/02-shared-helpers.js` | Add `showToast()`, `downloadCSV()`, `downloadJSON()` |
| `src/ui/public/js/31-api-plugins.js` | Add `apiPluginsExport()` |
| `src/ui/public/js/32-api-graph-editor.js` | Add `_graphZoom` state + zoom functions; node/edge count badge |
| `src/ui/public/js/33-api-collaboration.js` | Add `collabExportRevisions()` |
| `src/ui/public/js/34-api-copilot.js` | Add `copilotExportHistory()` |
| `src/ui/public/js/35-api-performance.js` | Add `_perfSpans` state; add `perfExportSpans()` |
| `docs/API_TESTING_USER_GUIDE.md` | Section for Phase H features |
| `docs/API_TESTING_TEST_GUIDE.md` | TC-475–TC-490 |

---

### Task 1: CSS — Toast Styles + Advisory Banner

**Files:**
- Modify: `src/ui/public/styles_addon.css`

- [ ] **Step 1: Append CSS rules to `styles_addon.css`**

Open `src/ui/public/styles_addon.css`. Append these rules at the very end of the file:

```css
/* ── Toast notification system ─────────────────────────────────────────────── */
#toast-container {
  position: fixed; bottom: 24px; right: 24px; z-index: 9999;
  display: flex; flex-direction: column-reverse; gap: 8px; pointer-events: none;
}
.toast {
  padding: 10px 16px; border-radius: 8px; font-size: 13px; font-weight: 500;
  opacity: 1; transition: opacity .3s ease; max-width: 380px;
  pointer-events: auto; word-break: break-word;
}
.toast-hide { opacity: 0; }
.toast-success { background: var(--success-bg); color: #6ee7b7; border: 1px solid rgba(16,185,129,.3); }
.toast-error   { background: var(--danger-bg);  color: #fca5a5; border: 1px solid rgba(239,68,68,.3); }
.toast-info    { background: rgba(59,130,246,.12); color: #93c5fd; border: 1px solid rgba(59,130,246,.3); }

/* ── Advisory banner ───────────────────────────────────────────────────────── */
.advisory-banner {
  background: rgba(59,130,246,.08); border: 1px solid rgba(59,130,246,.2);
  border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #93c5fd;
}
```

- [ ] **Step 2: Verify in browser**

Open `http://localhost:3003`. Navigate to the Copilot page. Click "Get Guidance" with a collection selected. The advisory note rendered by `_copilotRenderGuidance()` uses `class="advisory-banner"` — it should now display as a blue-tinted banner instead of unstyled text. No build step needed (CSS is served directly).

- [ ] **Step 3: Commit**

```bash
git add src/ui/public/styles_addon.css
git commit -m "style: add toast notification CSS and advisory-banner rule"
```

---

### Task 2: Shared Helpers — `showToast`, `downloadCSV`, `downloadJSON`

**Files:**
- Modify: `src/ui/public/js/02-shared-helpers.js`

- [ ] **Step 1: Add helpers to the end of `02-shared-helpers.js`**

Open `src/ui/public/js/02-shared-helpers.js`. The file currently ends at line 42 with a blank line after `adminSubTab`. Append:

```js
// ── Toast notifications ────────────────────────────────────────────────────────

function showToast(type, msg, ms) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-hide');
    setTimeout(() => t.remove(), 300);
  }, ms || 3500);
}

// ── Client-side export ─────────────────────────────────────────────────────────

function downloadCSV(filename, headers, rows) {
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
}
```

- [ ] **Step 2: Build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build:js
```

Expected: `Built modules.js: NNNNN lines, NNN.N KB`

- [ ] **Step 3: Smoke-test in browser console**

Open `http://localhost:3003`. Open DevTools console (F12). Run:

```js
showToast('success', 'Toast works!');
showToast('error', 'Error toast test');
showToast('info', 'Info toast test');
```

Expected: Three toasts appear bottom-right and auto-dismiss after ~3.5 seconds. (They will fail silently because `#toast-container` doesn't exist yet — that's fine, we add it in Task 3. Verify no JS errors are thrown.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/public/js/02-shared-helpers.js src/ui/public/modules.js
git commit -m "feat: add showToast, downloadCSV, downloadJSON to shared-helpers"
```

---

### Task 3: index.html — Toast Container + Export Buttons + Graph Zoom Controls

**Files:**
- Modify: `src/ui/public/index.html`

This task makes all HTML additions in one file so the build is consistent.

- [ ] **Step 1: Add `#toast-container` div**

Find line 13 in `index.html`: `<body>`. The line immediately after is the header/nav wrapper. Insert the toast container as the **first child of `<body>`** (line 14):

Find this exact text:
```html
<body>
```

Replace with:
```html
<body>
<div id="toast-container"></div>
```

- [ ] **Step 2: Add Export button to Plugin Ecosystem panel**

Find this block in `panel-api-plugins` (around line 1295):
```html
                <input id="api-plugins-search" type="text" placeholder="Search plugins…" oninput="apiPluginsFilter()" style="width:200px">
                <button class="btn btn-secondary btn-sm" onclick="apiPluginsLoad()">&#x21BA; Refresh</button>
```

Replace with:
```html
                <input id="api-plugins-search" type="text" placeholder="Search plugins…" oninput="apiPluginsFilter()" style="width:200px">
                <button class="btn btn-secondary btn-sm" onclick="apiPluginsLoad()">&#x21BA; Refresh</button>
                <button class="btn btn-secondary btn-sm" onclick="apiPluginsExport()">&#x2B07; Export CSV</button>
```

- [ ] **Step 3: Add Zoom controls + node count to Graph Editor panel**

Find this block in `panel-api-graph` (around line 1322):
```html
                <button class="btn btn-secondary btn-sm" onclick="graphEditorValidate()">&#x2713; Validate DAG</button>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorSaveLayout()">&#x1F4BE; Save Layout</button>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorAddDep()">+ Add Dep</button>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorRemoveDep()">&#x2212; Remove Dep</button>
```

Replace with:
```html
                <button class="btn btn-secondary btn-sm" onclick="graphEditorValidate()">&#x2713; Validate DAG</button>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorSaveLayout()">&#x1F4BE; Save Layout</button>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorAddDep()">+ Add Dep</button>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorRemoveDep()">&#x2212; Remove Dep</button>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorZoomOut()">&#x2212;</button>
                <span id="graph-zoom-label" style="font-size:12px;min-width:38px;text-align:center;color:var(--text-muted)">100%</span>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorZoomIn()">+</button>
                <button class="btn btn-secondary btn-sm" onclick="graphEditorZoomReset()">&#x229E; Fit</button>
```

Find the node count hint line immediately after that block:
```html
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Click a node to select it (max 2). Drag to reposition. Use Add/Remove Dep with 2 selected nodes (first selected = dependency source).</div>
```

Replace with:
```html
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <div style="font-size:12px;color:var(--text-muted)">Click a node to select it (max 2). Drag to reposition. Use Add/Remove Dep with 2 selected nodes.</div>
              <span id="graph-node-count" style="font-size:12px;color:var(--text-muted)"></span>
            </div>
```

- [ ] **Step 4: Add Export button to Collaboration Revisions toolbar**

Find in `collab-panel-revisions` (around line 1354):
```html
                <button class="btn btn-primary btn-sm" onclick="collabCreateRevisionModal()">+ Save Revision</button>
```

Replace with:
```html
                <button class="btn btn-primary btn-sm" onclick="collabCreateRevisionModal()">+ Save Revision</button>
                <button class="btn btn-secondary btn-sm" onclick="collabExportRevisions()">&#x2B07; Export CSV</button>
```

- [ ] **Step 5: Add Export button to Copilot History toolbar**

Find in `copilot-panel-history` (around line 1439):
```html
                <input id="copilot-history-search" type="text" placeholder="Filter by query type…" oninput="copilotFilterHistory()" style="flex:1;max-width:300px">
```

Replace with:
```html
                <input id="copilot-history-search" type="text" placeholder="Filter by query type…" oninput="copilotFilterHistory()" style="flex:1;max-width:300px">
                <button class="btn btn-secondary btn-sm" onclick="copilotExportHistory()">&#x2B07; Export CSV</button>
```

- [ ] **Step 6: Add Export button to Performance Dashboard**

Find in `panel-perf-dashboard` (around line 1461):
```html
            <h3 style="font-size:14px;margin:0 0 8px">Recent Profiling Spans</h3>
```

Replace with:
```html
            <h3 style="font-size:14px;margin:0 0 8px;display:flex;align-items:center;gap:12px">
              Recent Profiling Spans
              <button class="btn btn-secondary btn-sm" onclick="perfExportSpans()">&#x2B07; Export CSV</button>
            </h3>
```

- [ ] **Step 7: Verify HTML is well-formed**

```bash
grep -c "panel-api-plugins\|panel-api-graph\|panel-api-collab\|panel-api-copilot\|panel-perf-dashboard" "e:/AI Agent/qa-agent-platform-dev/src/ui/public/index.html"
```

Expected output: `10` (2 occurrences each — opening div and closing comment).

- [ ] **Step 8: Commit**

```bash
git add src/ui/public/index.html
git commit -m "feat: add toast container, export buttons, graph zoom controls to index.html"
```

---

### Task 4: JS Modules — Export Functions + Graph Zoom + Toast Integration

**Files:**
- Modify: `src/ui/public/js/31-api-plugins.js`
- Modify: `src/ui/public/js/32-api-graph-editor.js`
- Modify: `src/ui/public/js/33-api-collaboration.js`
- Modify: `src/ui/public/js/34-api-copilot.js`
- Modify: `src/ui/public/js/35-api-performance.js`

#### 31-api-plugins.js — `apiPluginsExport`

- [ ] **Step 1: Add export function to `31-api-plugins.js`**

Append at the end of `src/ui/public/js/31-api-plugins.js`:

```js
function apiPluginsExport() {
  if (!_apiPluginsList.length) { showToast('error', 'No plugins to export.'); return; }
  downloadCSV('plugins.csv',
    ['Name', 'Plugin ID', 'Version', 'Capabilities', 'Status'],
    _apiPluginsList.map(p => [
      p.name || p.id, p.id, p.version || '',
      (p.capabilities || []).join('; '), p.status
    ])
  );
  showToast('success', 'Plugins exported to plugins.csv');
}
```

#### 32-api-graph-editor.js — Zoom controls + node/edge count

- [ ] **Step 2: Add zoom state variables to `32-api-graph-editor.js`**

Find the existing state variables block at the top of the file:

```js
let _graphColId = '';
let _graphSteps = [];
let _graphDepMap = {}; // stepId → string[] (dependsOn)
let _graphPositions = {}; // stepId → {x, y}
let _graphSelected = []; // max 2 stepIds
let _graphDragging = null; // {stepId, startX, startY, origX, origY}
```

Replace with:

```js
let _graphColId = '';
let _graphSteps = [];
let _graphDepMap = {}; // stepId → string[] (dependsOn)
let _graphPositions = {}; // stepId → {x, y}
let _graphSelected = []; // max 2 stepIds
let _graphDragging = null; // {stepId, startX, startY, origX, origY}
let _graphZoom = 1.0;
const _ZOOM_MIN = 0.3, _ZOOM_MAX = 3.0, _ZOOM_STEP = 0.2;
```

- [ ] **Step 3: Reset zoom on collection load in `graphEditorSelectCollection`**

Find in `graphEditorSelectCollection`:
```js
  _graphColId = colId;
  _graphSelected = [];
  _graphDragging = null;
```

Replace with:
```js
  _graphColId = colId;
  _graphSelected = [];
  _graphDragging = null;
  _graphZoom = 1.0;
```

- [ ] **Step 4: Update node/edge count badge in `_graphRender`**

Find in `_graphRender`, the first lines after `function _graphRender() {`:
```js
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  if (!_graphSteps.length) {
    canvas.innerHTML = '<div style="color:var(--text-muted)">No steps in this collection.</div>';
    return;
  }
```

Replace with:
```js
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  const countEl = document.getElementById('graph-node-count');
  if (countEl) {
    const edgeCount = Object.values(_graphDepMap).reduce((s, deps) => s + deps.length, 0);
    countEl.textContent = _graphSteps.length + ' nodes · ' + edgeCount + ' edges';
  }
  if (!_graphSteps.length) {
    canvas.innerHTML = '<div style="color:var(--text-muted)">No steps in this collection.</div>';
    return;
  }
```

- [ ] **Step 5: Apply zoom transform to SVG in `_graphRender`**

Find in `_graphRender`, the SVG string start:
```js
  let svg = `<svg id="graph-svg" width="${svgW}" height="${svgH}" style="cursor:default;user-select:none;display:block"
```

Replace with:
```js
  const zoomLbl = document.getElementById('graph-zoom-label');
  if (zoomLbl) zoomLbl.textContent = Math.round(_graphZoom * 100) + '%';
  let svg = `<svg id="graph-svg" width="${svgW}" height="${svgH}" style="cursor:default;user-select:none;display:block;transform:scale(${_graphZoom});transform-origin:top left"
```

- [ ] **Step 6: Append zoom functions to `32-api-graph-editor.js`**

Append at the end of the file:

```js
function graphEditorZoomIn()    { _graphZoom = Math.min(_ZOOM_MAX, +(_graphZoom + _ZOOM_STEP).toFixed(1)); _graphRender(); }
function graphEditorZoomOut()   { _graphZoom = Math.max(_ZOOM_MIN, +(_graphZoom - _ZOOM_STEP).toFixed(1)); _graphRender(); }
function graphEditorZoomReset() { _graphZoom = 1.0; _graphRender(); }
```

#### 33-api-collaboration.js — `collabExportRevisions`

- [ ] **Step 7: Append export function to `33-api-collaboration.js`**

Append at the end of the file:

```js
function collabExportRevisions() {
  if (!_collabRevisions.length) { showToast('error', 'No revisions to export.'); return; }
  downloadCSV('revisions.csv',
    ['Revision #', 'Status', 'Author', 'Description', 'Created At'],
    _collabRevisions.map(r => [
      r.revisionNumber, r.status, r.authorId || '',
      r.description || '',
      r.createdAt ? new Date(r.createdAt).toLocaleString() : ''
    ])
  );
  showToast('success', 'Revisions exported to revisions.csv');
}
```

#### 34-api-copilot.js — `copilotExportHistory`

- [ ] **Step 8: Append export function to `34-api-copilot.js`**

Append at the end of the file:

```js
function copilotExportHistory() {
  if (!_copilotHistory.length) { showToast('error', 'No history to export.'); return; }
  downloadCSV('copilot-history.csv',
    ['Query Type', 'Items', 'Generated At'],
    _copilotHistory.map(h => [
      h.queryType,
      (h.items || []).length,
      h.generatedAt ? new Date(h.generatedAt).toLocaleString() : ''
    ])
  );
  showToast('success', 'Copilot history exported to copilot-history.csv');
}
```

#### 35-api-performance.js — `_perfSpans` state + `perfExportSpans`

- [ ] **Step 9: Add `_perfSpans` module-level variable to `35-api-performance.js`**

Find the first line of the file:
```js
// ══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE DASHBOARD MODULE — profiling, cache stats, safeguards
// ══════════════════════════════════════════════════════════════════════════════
```

Add the state variable immediately after the header comment block:

Find:
```js
async function perfLoad() {
```

Replace with:
```js
let _perfSpans = [];

async function perfLoad() {
```

- [ ] **Step 10: Capture spans in `_perfLoadProfile`**

Find in `_perfLoadProfile`:
```js
  const spans = snapshot.recentSpans || [];
  if (!spans.length) { el.innerHTML = '<div style="color:var(--text-muted)">No profiling spans recorded yet.</div>'; return; }
```

Replace with:
```js
  const spans = snapshot.recentSpans || [];
  _perfSpans = spans;
  if (!spans.length) { el.innerHTML = '<div style="color:var(--text-muted)">No profiling spans recorded yet.</div>'; return; }
```

- [ ] **Step 11: Append export function to `35-api-performance.js`**

Append at the end of the file:

```js
function perfExportSpans() {
  if (!_perfSpans.length) { showToast('error', 'No spans to export. Load the dashboard first.'); return; }
  downloadCSV('perf-spans.csv',
    ['Phase', 'Label', 'Duration (ms)', 'Start'],
    _perfSpans.map(sp => [
      sp.phase || '', sp.label || '',
      sp.durationMs !== undefined ? sp.durationMs : '',
      sp.startMs ? new Date(sp.startMs).toLocaleString() : ''
    ])
  );
  showToast('success', 'Performance spans exported to perf-spans.csv');
}
```

#### Build + smoke test

- [ ] **Step 12: Build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev"
npm run build:js
```

Expected: `Built modules.js: NNNNN lines, NNN.N KB` (no errors)

- [ ] **Step 13: Browser smoke test — toast system**

Hard-refresh (`Ctrl+F5`) on `http://localhost:3003`. Open DevTools console and run:

```js
showToast('success', 'Phase H toast works!');
showToast('error', 'Error toast test');
showToast('info', 'Info toast test');
```

Expected: Three toasts appear bottom-right, stacked, auto-dismiss after ~3.5s.

- [ ] **Step 14: Browser smoke test — graph zoom**

Navigate to Graph Editor tab. Select a collection that has steps. Verify:
- Node count appears top-right of the graph panel (e.g. "3 nodes · 2 edges")
- Zoom label shows "100%"
- Click "+" button → label changes to "120%", graph SVG scales up
- Click "−" → back to "100%"
- Click "⊡ Fit" → resets to "100%"

- [ ] **Step 15: Browser smoke test — export**

Navigate to Plugin Ecosystem. Click "↓ Export CSV". Browser should prompt to download `plugins.csv`. Open the file — it should have headers `Name,Plugin ID,Version,Capabilities,Status` followed by data rows.

Navigate to Collaboration → select collection → load revisions. Click "↓ Export CSV". Download `revisions.csv`.

Navigate to Performance Dashboard. Click Refresh to load data. Click "↓ Export CSV" next to "Recent Profiling Spans". Download `perf-spans.csv`.

- [ ] **Step 16: Commit**

```bash
git add src/ui/public/js/31-api-plugins.js \
        src/ui/public/js/32-api-graph-editor.js \
        src/ui/public/js/33-api-collaboration.js \
        src/ui/public/js/34-api-copilot.js \
        src/ui/public/js/35-api-performance.js \
        src/ui/public/modules.js
git commit -m "feat: add export functions and graph zoom to Phase G modules"
```

---

### Task 5: Docs Update

**Files:**
- Modify: `docs/API_TESTING_USER_GUIDE.md`
- Modify: `docs/API_TESTING_TEST_GUIDE.md`

- [ ] **Step 1: Add Phase H sections to User Guide**

Open `docs/API_TESTING_USER_GUIDE.md`. Find the footer/version line (currently `v2.2`). Before the footer, append:

```markdown
## 36. Toast Notifications

A global toast system provides non-blocking feedback for async operations. Toasts appear bottom-right and auto-dismiss after 3.5 seconds. Types:
- **Success** (green) — operation completed
- **Error** (red) — operation failed  
- **Info** (blue) — informational

## 37. CSV Export

All major tables support one-click CSV download:

| Page | Export Button | Downloaded File |
|---|---|---|
| Plugin Ecosystem | ↓ Export CSV (top toolbar) | `plugins.csv` |
| Collaboration → Revisions | ↓ Export CSV (revisions toolbar) | `revisions.csv` |
| Copilot → History | ↓ Export CSV (history toolbar) | `copilot-history.csv` |
| Performance → Profiling Spans | ↓ Export CSV (spans header) | `perf-spans.csv` |

Export is client-side — no server round-trip. Exported data reflects the currently loaded/filtered rows.

## 38. Graph Editor — Zoom Controls

The Graph Editor toolbar now includes zoom controls:
- **−** — zoom out (min 30%)
- **+** — zoom in (max 300%)
- **⊡ Fit** — reset to 100%
- Zoom level label shows current percentage
- Node/edge count badge displays top-right of the graph canvas
- Zoom resets to 100% when a new collection is loaded
```

Update the version line from `v2.2` to `v2.3`.

- [ ] **Step 2: Add Phase H test cases to Test Guide**

Open `docs/API_TESTING_TEST_GUIDE.md`. Find the footer line (currently `v2.3 | 474 test cases`). Before it, append:

```markdown
## Module 47: Toast Notification System

| TC | Title | Steps | Expected |
|---|---|---|---|
| TC-475 | Success toast displays | Call `showToast('success','msg')` via console | Green toast appears bottom-right |
| TC-476 | Error toast displays | Call `showToast('error','msg')` via console | Red toast appears bottom-right |
| TC-477 | Info toast displays | Call `showToast('info','msg')` via console | Blue toast appears bottom-right |
| TC-478 | Toast auto-dismisses | Display any toast; wait 4 seconds | Toast fades and is removed from DOM |
| TC-479 | Multiple toasts stack | Call `showToast` 3 times rapidly | Three stacked toasts, each dismissing independently |

## Module 48: CSV Export

| TC | Title | Steps | Expected |
|---|---|---|---|
| TC-480 | Plugins export — data present | Load Plugin Ecosystem with plugins; click Export CSV | `plugins.csv` downloads with correct headers and rows |
| TC-481 | Plugins export — empty state | Click Export CSV with no plugins loaded | Error toast: "No plugins to export." |
| TC-482 | Revisions export | Load Collaboration with revisions; click Export CSV | `revisions.csv` downloads |
| TC-483 | Revisions export — empty | Click Export CSV with no revisions loaded | Error toast: "No revisions to export." |
| TC-484 | Copilot history export | Load Copilot history; click Export CSV | `copilot-history.csv` downloads |
| TC-485 | Perf spans export | Load Performance Dashboard; click Export CSV | `perf-spans.csv` downloads |
| TC-486 | Perf spans export — before load | Click Export CSV before Refresh | Error toast: "No spans to export. Load the dashboard first." |

## Module 49: Graph Editor Zoom

| TC | Title | Steps | Expected |
|---|---|---|---|
| TC-487 | Zoom in | Click "+" button | Zoom label increments by 20%; SVG scales |
| TC-488 | Zoom out | Click "−" button | Zoom label decrements by 20%; SVG scales |
| TC-489 | Zoom reset | Zoom to 140%; click ⊡ Fit | Zoom resets to 100% |
| TC-490 | Zoom resets on collection change | Zoom to 200%; select new collection | Zoom resets to 100% automatically |
| TC-491 | Node count badge | Load collection with 3 steps, 2 deps | Badge shows "3 nodes · 2 edges" |
```

Update the footer from `v2.3 | 474 test cases` to `v2.4 | 491 test cases`.

- [ ] **Step 3: Commit**

```bash
git add docs/API_TESTING_USER_GUIDE.md docs/API_TESTING_TEST_GUIDE.md
git commit -m "docs: add Phase H user guide sections and test cases TC-475-491"
```

---

## Self-Review

**Spec coverage:**
- ✅ Toast notification layer — Task 1 (CSS) + Task 2 (JS) + Task 3 (HTML container)
- ✅ Export — Task 3 (buttons) + Task 4 (JS functions) for all 5 pages (plugins, graph has no table, collab revisions, copilot history, performance spans)
- ✅ Graph enhancements — Task 3 (HTML buttons + count badge) + Task 4 (zoom state + functions)
- ✅ UI Polish — advisory-banner CSS (Task 1), consistent empty-state toasts on export
- ✅ Docs — Task 5

**Note on graph page export:** The Graph Editor displays an SVG canvas (not a data table), so there's no CSV export for it. The other 4 pages all have exports.

**Placeholder scan:** No TBDs, no "add appropriate" phrases, all code blocks are complete.

**Type consistency:** `showToast`, `downloadCSV`, `downloadJSON` defined in Task 2 and called in Task 4 — names match exactly. `_perfSpans` declared in Step 9, populated in Step 10, consumed in Step 11 — consistent. `_graphZoom`, `_ZOOM_MIN`, `_ZOOM_MAX`, `_ZOOM_STEP` declared in Step 2, used in Steps 5–6 — consistent.
