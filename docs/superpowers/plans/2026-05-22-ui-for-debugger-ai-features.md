# UI for Debugger Engine & AI Features — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the debugger engine (timeline, variable trace, node/workflow replay) and AI features (negative test generator, assertion suggester, example plugins) in the browser UI so users can access them without calling API endpoints directly.

**Architecture:** All new UI is additive — new tabs in existing modals, new buttons in existing panels. No new pages or top-level nav items. Backend routes already exist and are tested; this plan is frontend-only. JS changes go in `src/ui/public/js/`, HTML changes in `src/ui/public/index.html`, then `npm run build:js` regenerates `modules.js`.

**Tech Stack:** Vanilla JS, HTML, CSS custom properties (existing platform conventions). No frameworks. `fetch()` for all API calls. Patterns match `25-api-runs.js` and `24-api-collections.js`.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/ui/public/index.html` | Modify | Add Timeline + Variable Trace tabs to run detail modal; add Suggest Assertions tab to step detail; add Plugins nav item |
| `src/ui/public/js/25-api-runs.js` | Modify | Timeline tab loader, variable trace tab loader, suggest-assertions per-step tab, negative test generator button |
| `src/ui/public/js/24-api-collections.js` | Modify | "Generate Negative Tests" button + advisory result panel |
| `src/ui/public/js/31-api-plugins.js` | Create | Plugin ecosystem page: list plugins, register, enable/disable, browse examples |
| `src/ui/public/js/00-header.js` | Modify | Register `31-api-plugins.js` in build order (already auto-included via `npm run build:js`) |

---

## Task 1 — Timeline Tab in Run Detail Modal

**Files:**
- Modify: `src/ui/public/index.html` lines ~3062–3107 (run detail modal tabs)
- Modify: `src/ui/public/js/25-api-runs.js`

Add a **Timeline** tab to the run detail modal. On activation, calls `GET /api/api-runs/:runId/timeline` and renders a vertical event list with timestamps and duration bars.

- [ ] **Step 1: Add Timeline tab button and panel to `index.html`**

Find the existing tab row (line ~3062):
```html
<button class="api-run-tab-btn sub-tab" data-tab="har" onclick="apiRunsTabSwitch('har')">HAR / Network</button>
<button class="api-run-tab-btn sub-tab" data-tab="ai-insights" onclick="apiRunsTabSwitch('ai-insights')">AI Insights</button>
```

Add after `har` tab button and before `ai-insights`:
```html
<button class="api-run-tab-btn sub-tab" data-tab="timeline" onclick="apiRunsTabSwitch('timeline')">&#x23F1; Timeline</button>
<button class="api-run-tab-btn sub-tab" data-tab="var-trace" onclick="apiRunsTabSwitch('var-trace')">&#x1F4CA; Var Trace</button>
```

Add corresponding panels after the `har` panel (`data-tab="har"`):
```html
<div class="api-run-tab-panel" data-tab="timeline" style="display:none;padding:12px" id="run-timeline-panel"></div>
<div class="api-run-tab-panel" data-tab="var-trace" style="display:none;padding:12px" id="run-var-trace-panel"></div>
```

- [ ] **Step 2: Add lazy-load flags and loader calls to `apiRunsTabSwitch()` in `25-api-runs.js`**

Find `apiRunsTabSwitch(tab)` (~line 321). After the existing `ai-insights` block, add:
```js
  if (tab === 'timeline' && _apiRunsCurrentRunId) {
    const panel = document.getElementById('run-timeline-panel');
    if (panel && !panel.dataset.loaded) { panel.dataset.loaded = '1'; _apiRunsLoadTimeline(_apiRunsCurrentRunId, panel); }
  }
  if (tab === 'var-trace' && _apiRunsCurrentRunId) {
    const panel = document.getElementById('run-var-trace-panel');
    if (panel && !panel.dataset.loaded) { panel.dataset.loaded = '1'; _apiRunsLoadVarTrace(_apiRunsCurrentRunId, panel); }
  }
```

Also reset the flags when a new run is opened — find where `_apiRunsCurrentRunId` is set in `apiRunsViewDetail()` (~line 72) and add after it:
```js
  const tlPanel = document.getElementById('run-timeline-panel');
  if (tlPanel) { tlPanel.dataset.loaded = ''; tlPanel.innerHTML = ''; }
  const vtPanel = document.getElementById('run-var-trace-panel');
  if (vtPanel) { vtPanel.dataset.loaded = ''; vtPanel.innerHTML = ''; }
```

- [ ] **Step 3: Implement `_apiRunsLoadTimeline()` in `25-api-runs.js`**

Add after the `apiRunsTabSwitch` function:
```js
async function _apiRunsLoadTimeline(runId, panel) {
  panel.innerHTML = '<div style="color:var(--text-muted)">Loading timeline…</div>';
  try {
    const res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/timeline');
    if (!res.ok) { panel.innerHTML = '<div style="color:#ef4444">Timeline not available for this run.</div>'; return; }
    const data = await res.json();
    const tl = data.timeline;
    const events = tl.events || [];
    if (!events.length) { panel.innerHTML = '<div style="color:var(--text-muted)">No timeline events recorded.</div>'; return; }

    const maxDur = Math.max(...events.map(e => e.durationMs || 0), 1);
    const colorMap = { 'node-started': '#3b82f6', 'node-completed': '#22c55e', 'node-failed': '#ef4444',
      'node-skipped': '#9ca3af', 'node-retrying': '#f59e0b', 'assertion-failed': '#ef4444',
      'variable-extracted': '#a78bfa', 'failure-propagated': '#ef4444' };

    const rows = events.map(e => {
      const col = colorMap[e.eventType] || '#9ca3af';
      const pct = e.durationMs ? Math.max(4, Math.round((e.durationMs / maxDur) * 100)) : 0;
      const bar = e.durationMs ? `<div style="height:6px;width:${pct}%;background:${col};border-radius:3px;margin-top:3px"></div>` : '';
      const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
      const detail = e.detail ? ` <span style="color:var(--text-muted);font-size:11px">— ${escHtml(e.detail)}</span>` : '';
      const dur = e.durationMs != null ? ` <span style="color:var(--text-muted);font-size:11px">${e.durationMs}ms</span>` : '';
      return `<div style="padding:4px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:10px;color:var(--text-muted);min-width:70px">${ts}</span>
          <span style="font-size:11px;font-weight:600;color:${col}">${escHtml(e.eventType)}</span>
          <span style="font-size:12px">${escHtml(e.nodeName || '')}</span>${detail}${dur}
        </div>${bar}
      </div>`;
    }).join('');

    const src = data.source === 'synthesized-from-snapshot'
      ? `<div style="color:#f59e0b;font-size:11px;margin-bottom:8px">⚠ ${escHtml(data.advisoryNote)}</div>` : '';
    panel.innerHTML = `${src}<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">${events.length} events · ${tl.totalDurationMs ?? 0}ms total</div>${rows}`;
  } catch (e) {
    panel.innerHTML = '<div style="color:#ef4444">Failed to load timeline: ' + escHtml(e.message) + '</div>';
  }
}
```

- [ ] **Step 4: Implement `_apiRunsLoadVarTrace()` in `25-api-runs.js`**

Add after `_apiRunsLoadTimeline`:
```js
async function _apiRunsLoadVarTrace(runId, panel) {
  panel.innerHTML = '<div style="color:var(--text-muted)">Loading variable trace…</div>';
  try {
    const res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/variable-trace');
    if (!res.ok) { panel.innerHTML = '<div style="color:#ef4444">Variable trace not available (no snapshot for this run).</div>'; return; }
    const data = await res.json();
    const mutations = data.mutations || [];
    if (!mutations.length) { panel.innerHTML = '<div style="color:var(--text-muted)">No variable mutations recorded.</div>'; return; }

    const mutRows = mutations.map(m => {
      const extracted = Object.entries(m.extracted || {});
      if (!extracted.length) return '';
      const kvRows = extracted.map(([k, v]) =>
        `<tr><td style="font-family:monospace;font-size:11px;color:#a78bfa">${escHtml(k)}</td><td style="font-family:monospace;font-size:11px">${escHtml(v)}</td></tr>`
      ).join('');
      return `<div style="margin-bottom:10px">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px">${escHtml(m.nodeName)}</div>
        <table class="data-table"><thead><tr><th>Variable</th><th>New Value</th></tr></thead><tbody>${kvRows}</tbody></table>
      </div>`;
    }).filter(Boolean).join('');

    const finalKeys = Object.entries(data.finalState || {});
    const finalRows = finalKeys.length
      ? finalKeys.map(([k, v]) => `<tr><td style="font-family:monospace;font-size:11px">${escHtml(k)}</td><td style="font-family:monospace;font-size:11px">${escHtml(v)}</td></tr>`).join('')
      : '<tr><td colspan="2" style="color:var(--text-muted)">No variables in final state</td></tr>';

    panel.innerHTML = `
      <div style="margin-bottom:16px">
        <strong style="font-size:13px">Mutations by node</strong>
        <div style="margin-top:8px">${mutRows || '<div style="color:var(--text-muted)">No variable mutations found.</div>'}</div>
      </div>
      <div>
        <strong style="font-size:13px">Final variable state</strong>
        <table class="data-table" style="margin-top:8px"><thead><tr><th>Variable</th><th>Value</th></tr></thead><tbody>${finalRows}</tbody></table>
      </div>`;
  } catch (e) {
    panel.innerHTML = '<div style="color:#ef4444">Failed to load variable trace: ' + escHtml(e.message) + '</div>';
  }
}
```

- [ ] **Step 5: Build and verify**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
npm run build:js
```
Expected: no errors. Open run detail modal, click Timeline and Var Trace tabs — should show loading then content (or "not available" if no timeline artifact).

---

## Task 2 — Suggest Assertions Tab per Step

**Files:**
- Modify: `src/ui/public/js/25-api-runs.js` (step detail tab section, ~line 236–266)

Add a **Suggest** tab to each step's sub-tab row. On click, calls `POST /api/ai-intelligence/steps/:stepId/suggest-assertions` with `{ runId }`. Renders suggestions as an advisory table.

- [ ] **Step 1: Add "Suggest" tab button to step detail renderer**

Find the step sub-tab buttons in `_apiRunsStepDetailHtml()` (~line 236):
```js
<button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','jira');_apiRunsLoadJiraPanel('${step.stepId}')" data-steptab="jira">Jira &amp; Heal</button>
```

Add after the jira button:
```js
<button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','suggest');_apiRunsLoadSuggestPanel('${step.stepId}','${detailId}')" data-steptab="suggest">&#x1F4A1; Suggest</button>
```

- [ ] **Step 2: Add Suggest panel to step detail renderer**

After the jira panel (`data-steppanel="jira"`), add:
```js
<div data-steppanel="suggest" style="display:none;padding:10px">
  <div id="suggest-panel-${step.stepId}"><span style="color:var(--text-muted);font-size:12px">Click "Suggest" to generate assertion suggestions for this step.</span></div>
</div>
```

- [ ] **Step 3: Implement `_apiRunsLoadSuggestPanel()` in `25-api-runs.js`**

Add near the end of the module (after `_apiRunsLoadVarTrace`):
```js
async function _apiRunsLoadSuggestPanel(stepId, detailId) {
  const panel = document.getElementById('suggest-panel-' + stepId);
  if (!panel || panel.dataset.loaded) return;
  panel.dataset.loaded = '1';
  const runId = _apiRunsCurrentRunId;
  if (!runId) { panel.innerHTML = '<div style="color:#ef4444">No active run.</div>'; return; }
  panel.innerHTML = '<div style="color:var(--text-muted)">Generating suggestions…</div>';
  try {
    const res = await fetch('/api/ai-intelligence/steps/' + encodeURIComponent(stepId) + '/suggest-assertions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    if (!res.ok) { panel.innerHTML = '<div style="color:#ef4444">No suggestions available for this step.</div>'; return; }
    const data = await res.json();
    const suggestions = data.suggestions || [];
    if (!suggestions.length) { panel.innerHTML = '<div style="color:var(--text-muted)">No suggestions generated.</div>'; return; }

    const rows = suggestions.map(s => `
      <tr>
        <td style="font-size:11px">${escHtml(s.type || '')}</td>
        <td style="font-family:monospace;font-size:11px">${escHtml(s.field || '—')}</td>
        <td style="font-family:monospace;font-size:11px">${escHtml(s.operator || '—')}</td>
        <td style="font-family:monospace;font-size:11px">${escHtml(JSON.stringify(s.expectedValue ?? '—'))}</td>
        <td style="font-size:11px;color:var(--text-muted)">${escHtml(s.rationale || '')}</td>
      </tr>`).join('');

    panel.innerHTML = `
      <div style="color:#f59e0b;font-size:11px;margin-bottom:8px">&#x26A0; Advisory only — review before adding to collection.</div>
      <table class="data-table">
        <thead><tr><th>Type</th><th>Field</th><th>Operator</th><th>Expected</th><th>Rationale</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    panel.innerHTML = '<div style="color:#ef4444">Failed: ' + escHtml(e.message) + '</div>';
  }
}
```

- [ ] **Step 4: Build and verify**

```bash
npm run build:js
```
Open a completed run → expand a step → click "Suggest" tab. Should show assertion suggestion table.

---

## Task 3 — Generate Negative Tests button in Collection List

**Files:**
- Modify: `src/ui/public/js/24-api-collections.js`
- Modify: `src/ui/public/index.html` (add negative tests result modal)

Add a **Negative Tests** button to each collection row. On click, calls `POST /api/ai-intelligence/collections/:id/generate-negative-tests` and shows the result in a modal.

- [ ] **Step 1: Add modal HTML to `index.html`**

Find the end of the collections section (search for `id="panel-api-collections"`). Add a new modal before the closing `</div>` of that panel, or add alongside other modals (search for `id="modal-api-run-detail"`). Add:
```html
<!-- Negative Test Generator Modal -->
<div id="modal-negative-tests" class="modal" style="display:none">
  <div class="modal-overlay" onclick="closeModal('modal-negative-tests')"></div>
  <div class="modal-box" style="max-width:860px;width:95vw">
    <div class="modal-header">
      <h3>&#x1F9EA; Generated Negative Tests</h3>
      <button class="modal-close" onclick="closeModal('modal-negative-tests')">&times;</button>
    </div>
    <div class="modal-body">
      <div id="negative-tests-alert"></div>
      <div style="color:#f59e0b;font-size:12px;margin-bottom:10px">&#x26A0; Advisory only. These are suggestions — review before using. The platform never auto-runs generated tests.</div>
      <div id="negative-tests-content"><span style="color:var(--text-muted)">Loading…</span></div>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add "Neg Tests" button to collection list rows in `24-api-collections.js`**

Find `_apiColRenderList()` and the button row (~line 42):
```js
<button class="tbl-btn del" onclick="apiColDelete('${col.id}','${escHtml(col.name)}')">Delete</button>
```

Add before the delete button:
```js
<button class="tbl-btn" onclick="apiColNegTests('${col.id}','${escHtml(col.name)}')" title="Generate negative test suggestions">&#x1F9EA; Neg Tests</button>
```

- [ ] **Step 3: Implement `apiColNegTests()` in `24-api-collections.js`**

Add after `_apiColRenderList`:
```js
async function apiColNegTests(colId, colName) {
  const content = document.getElementById('negative-tests-content');
  if (!content) return;
  content.innerHTML = '<div style="color:var(--text-muted)">Generating negative tests for <strong>' + escHtml(colName) + '</strong>…</div>';
  openModal('modal-negative-tests');
  try {
    const res = await fetch('/api/ai-intelligence/collections/' + encodeURIComponent(colId) + '/generate-negative-tests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!res.ok) {
      content.innerHTML = '<div style="color:#ef4444">Failed to generate tests: ' + res.status + '</div>';
      return;
    }
    const suite = await res.json();
    const cases = suite.cases || [];
    if (!cases.length) {
      content.innerHTML = '<div style="color:var(--text-muted)">No negative test cases could be generated (collection may have no request bodies or auth headers).</div>';
      return;
    }

    const strategyColors = { 'missing-field': '#ef4444', 'wrong-type': '#f59e0b',
      'boundary-violation': '#3b82f6', 'auth-stripped': '#a78bfa', 'wrong-method': '#9ca3af' };

    const rows = cases.map(c => {
      const col = strategyColors[c.strategy] || '#9ca3af';
      const expected = (c.expectedStatusCodes || []).join(', ');
      return `<tr>
        <td style="font-size:11px"><span style="color:${col};font-weight:600">${escHtml(c.strategy)}</span></td>
        <td style="font-size:11px">${escHtml(c.stepName)}</td>
        <td style="font-size:12px">${escHtml(c.title)}</td>
        <td style="font-size:11px;color:var(--text-muted)">${escHtml(expected)}</td>
      </tr>`;
    }).join('');

    content.innerHTML = `
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
        ${cases.length} test cases generated for <strong>${escHtml(colName)}</strong>
      </div>
      <table class="data-table">
        <thead><tr><th>Strategy</th><th>Step</th><th>Title</th><th>Expected Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    content.innerHTML = '<div style="color:#ef4444">Error: ' + escHtml(e.message) + '</div>';
  }
}
```

- [ ] **Step 4: Build and verify**

```bash
npm run build:js
```
Open API Collections → click "Neg Tests" on a collection that has steps with bodies. Modal should open and show the generated test cases table.

---

## Task 4 — Plugin Ecosystem Page

**Files:**
- Create: `src/ui/public/js/31-api-plugins.js`
- Modify: `src/ui/public/index.html` (nav item + panel)

New top-level nav tab: **Plugins**. Shows list of registered plugins with enable/disable, and a section to browse + register example plugins.

- [ ] **Step 1: Add nav item and panel to `index.html`**

Find the nav items block (around line 162):
```html
<div class="nav-item" data-tab="governance">&#x1F3DB;&#xFE0F; Governance</div>
```

Add after:
```html
<div class="nav-item" data-tab="api-plugins">&#x1F9E9; Plugins</div>
```

Add the panel alongside the other panels (find the governance panel for reference):
```html
<!-- API Plugins Panel -->
<div id="panel-api-plugins" class="panel" style="display:none">
  <div class="panel-header">
    <h2>&#x1F9E9; Plugin Ecosystem</h2>
    <button class="btn btn-primary" onclick="apiPluginsLoad()">&#x21BA; Refresh</button>
  </div>
  <div id="api-plugins-alert"></div>

  <!-- Registered Plugins -->
  <div style="margin-bottom:24px">
    <h3 style="font-size:14px;margin-bottom:8px">Registered Plugins</h3>
    <table class="data-table">
      <thead><tr><th>Plugin ID</th><th>Name</th><th>Version</th><th>Capabilities</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody id="api-plugins-tbody"><tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Loading…</td></tr></tbody>
    </table>
  </div>

  <!-- Example Plugins -->
  <div>
    <h3 style="font-size:14px;margin-bottom:4px">Example Plugins</h3>
    <div style="color:var(--text-muted);font-size:12px;margin-bottom:8px">Advisory only — register these to explore the plugin system. Never auto-registered.</div>
    <div id="api-plugins-examples"><span style="color:var(--text-muted)">Loading examples…</span></div>
  </div>
</div>
```

- [ ] **Step 2: Wire panel to tab switch in `13-bootstrap.js`**

Find where other api-* panels are registered in the tab switch (search for `'api-runs'` in `13-bootstrap.js` or the panel show/hide logic). The existing `tabSwitch` function in `08-tab-switch.js` handles panels by `id="panel-{tab}"` convention automatically — no change needed if the panel id follows `panel-api-plugins` pattern.

Verify by checking `08-tab-switch.js` for the panel lookup pattern. If panels are activated by a `load` function, add to the tab switch:
```js
// In the tab switch map (wherever api-runs calls apiRunsLoad, etc.)
'api-plugins': () => apiPluginsLoad(),
```

- [ ] **Step 3: Create `src/ui/public/js/31-api-plugins.js`**

```js
// API PLUGINS MODULE
// ══════════════════════════════════════════════════════════════════════════════

let _apiPluginsList = [];

async function apiPluginsLoad() {
  try {
    const res = await fetch('/api/plugins');
    if (!res.ok) throw new Error('Failed to load plugins: ' + res.status);
    const data = await res.json();
    _apiPluginsList = data.plugins || [];
    _apiPluginsRenderList();
    await _apiPluginsLoadExamples();
  } catch (e) {
    modAlert('api-plugins-alert', 'error', e.message);
  }
}

function _apiPluginsRenderList() {
  const tbody = document.getElementById('api-plugins-tbody');
  if (!tbody) return;
  if (!_apiPluginsList.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No plugins registered yet. Register an example below to get started.</td></tr>';
    return;
  }
  tbody.innerHTML = _apiPluginsList.map(p => {
    const caps = (p.manifest?.capabilities || []).join(', ');
    const statusColor = p.status === 'enabled' ? '#22c55e' : p.status === 'disabled' ? '#ef4444' : '#9ca3af';
    const toggleBtn = p.status === 'enabled'
      ? `<button class="tbl-btn" onclick="apiPluginDisable('${escHtml(p.manifest?.pluginId || '')}')">Disable</button>`
      : `<button class="tbl-btn" onclick="apiPluginEnable('${escHtml(p.manifest?.pluginId || '')}')">Enable</button>`;
    return `<tr>
      <td style="font-family:monospace;font-size:11px">${escHtml(p.manifest?.pluginId || '—')}</td>
      <td>${escHtml(p.manifest?.name || '—')}</td>
      <td style="font-size:11px">${escHtml(p.manifest?.version || '—')}</td>
      <td style="font-size:11px">${escHtml(caps)}</td>
      <td><span style="color:${statusColor};font-weight:600;font-size:12px">${escHtml(p.status || '—')}</span></td>
      <td>${toggleBtn}</td>
    </tr>`;
  }).join('');
}

async function apiPluginEnable(pluginId) {
  try {
    const res = await fetch('/api/plugins/' + encodeURIComponent(pluginId) + '/enable', { method: 'POST' });
    if (!res.ok) throw new Error('Enable failed: ' + res.status);
    await apiPluginsLoad();
  } catch (e) {
    modAlert('api-plugins-alert', 'error', e.message);
  }
}

async function apiPluginDisable(pluginId) {
  try {
    const res = await fetch('/api/plugins/' + encodeURIComponent(pluginId) + '/disable', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Disabled via UI' }),
    });
    if (!res.ok) throw new Error('Disable failed: ' + res.status);
    await apiPluginsLoad();
  } catch (e) {
    modAlert('api-plugins-alert', 'error', e.message);
  }
}

async function _apiPluginsLoadExamples() {
  const el = document.getElementById('api-plugins-examples');
  if (!el) return;
  try {
    const res = await fetch('/api/plugins/examples');
    if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load examples.</div>'; return; }
    const data = await res.json();
    const examples = data.examples || [];
    if (!examples.length) { el.innerHTML = '<div style="color:var(--text-muted)">No examples available.</div>'; return; }

    el.innerHTML = examples.map(ex => {
      const caps = (ex.manifest?.capabilities || []).join(', ');
      const isRegistered = _apiPluginsList.some(p => p.manifest?.pluginId === ex.pluginId);
      const registerBtn = isRegistered
        ? `<span style="color:#22c55e;font-size:12px">&#x2714; Already registered</span>`
        : `<button class="btn btn-sm" onclick="apiPluginRegisterExample(${JSON.stringify(ex.manifest)})">Register</button>`;
      return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div style="font-weight:600;font-size:13px">${escHtml(ex.manifest?.name || ex.pluginId)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
              ${escHtml(ex.manifest?.pluginId || '')} &nbsp;·&nbsp; ${escHtml(caps)} &nbsp;·&nbsp; v${escHtml(ex.manifest?.version || '1.0.0')}
            </div>
            <div style="font-size:12px;margin-top:6px">${escHtml(ex.manifest?.description || '')}</div>
          </div>
          <div style="margin-left:12px">${registerBtn}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div style="color:#ef4444">Error loading examples: ' + escHtml(e.message) + '</div>';
  }
}

async function apiPluginRegisterExample(manifest) {
  try {
    const res = await fetch('/api/plugins', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
    if (!res.ok) throw new Error('Register failed: ' + res.status);
    modAlert('api-plugins-alert', 'success', 'Plugin registered: ' + (manifest.name || manifest.pluginId));
    await apiPluginsLoad();
  } catch (e) {
    modAlert('api-plugins-alert', 'error', e.message);
  }
}
```

- [ ] **Step 4: Build and verify**

```bash
npm run build:js
```
Open the app → click Plugins nav item. Should show the registered plugins table (empty if none) and the two example plugins with Register buttons. Click Register on one → it should appear in the plugins table.

---

## Task 5 — Update Test Guide and User Guide

**Files:**
- Modify: `docs/API_TESTING_TEST_GUIDE.md`
- Modify: `docs/API_TESTING_USER_GUIDE.md`

- [ ] **Step 1: Add test cases to `API_TESTING_TEST_GUIDE.md`**

Add a new **Module 41 — Debugger Engine UI** section:

```markdown
## Module 41 — Debugger Engine UI (TC-417–TC-426)

| TC | Title | Steps | Expected |
|---|---|---|---|
| TC-417 | Timeline tab shows events for completed run | Open run detail → Timeline tab | Event list rendered, no JS errors |
| TC-418 | Timeline tab shows advisory note for synthesized timeline | Run with no stored artifact | Yellow advisory banner visible |
| TC-419 | Timeline tab shows "not available" for run with no snapshot | Non-existent runId | "not available" message, no crash |
| TC-420 | Var Trace tab shows mutation table | Open run detail → Var Trace tab | Table with node names and extracted variables |
| TC-421 | Var Trace final state table populated | Same run with extracted variables | Final State table shows all variable keys |
| TC-422 | Var Trace tab shows "not available" when no snapshot | Run with no snapshot | "not available" message |
| TC-423 | Suggest tab on step generates assertions | Expand step → Suggest tab | Advisory table with 1–4 assertion rows |
| TC-424 | Suggest tab shows "no suggestions" for step with no response body | Step with empty body | "No suggestions" message, no error |
| TC-425 | Neg Tests button generates test cases | Collections list → Neg Tests | Modal opens with strategy-coloured rows |
| TC-426 | Neg Tests modal shows advisory banner | Any collection | Yellow advisory note visible |
```

Add **Module 42 — Plugin Ecosystem UI** section:

```markdown
## Module 42 — Plugin Ecosystem UI (TC-427–TC-434)

| TC | Title | Steps | Expected |
|---|---|---|---|
| TC-427 | Plugins nav tab opens plugin list | Click Plugins in sidebar | Panel shows, table loads |
| TC-428 | Empty state shown when no plugins registered | Fresh instance | "No plugins registered yet" message |
| TC-429 | Register example plugin via UI | Click Register on example | Plugin appears in table with status |
| TC-430 | Enable/Disable button toggles plugin status | Click Disable → then Enable | Status badge updates, button text changes |
| TC-431 | Example plugins section shows both examples | Load plugins page | custom-bearer-auth and custom-json-assertion visible |
| TC-432 | Already-registered badge shown | Register a plugin, reload page | "Already registered" shown instead of Register button |
| TC-433 | Plugin description visible in examples | Load examples | Description text rendered for each example |
| TC-434 | Register fails gracefully on duplicate | Register same plugin twice | Error message shown, no crash |
```

Update Summary Table: add 2 new rows for TC-417–TC-426 (Module 41) and TC-427–TC-434 (Module 42). Update Total to TC-001–TC-434 (434 test cases).

- [ ] **Step 2: Add sections to `API_TESTING_USER_GUIDE.md`**

Update Table of Contents — add entries:
```
28. [Debugger Engine — Timeline & Variable Trace](#28-debugger-engine--timeline--variable-trace)
29. [AI Assertion Suggester](#29-ai-assertion-suggester)
30. [AI Negative Test Generator](#30-ai-negative-test-generator)
31. [Plugin Ecosystem](#31-plugin-ecosystem)
```

Append sections at the end of the guide (before Tips & Best Practices):

```markdown
## 28. Debugger Engine — Timeline & Variable Trace

**Where:** Run detail modal → Timeline tab / Var Trace tab

The Debugger Engine gives step-level visibility into what happened inside a run.

### Timeline Tab
- Opens `GET /api/api-runs/:runId/timeline`
- Shows every lifecycle event: `node-started`, `node-completed`, `node-failed`, `node-retrying`, `assertion-failed`, `variable-extracted`
- Each event shows: timestamp, event type (colour-coded), node name, detail message, duration bar
- If no stored timeline artifact exists, the platform synthesizes one from the ExecutionSnapshot — a yellow advisory banner indicates this

### Variable Trace Tab
- Opens `GET /api/api-runs/:runId/variable-trace`
- Shows a **Mutations by node** table: which variables were created or changed at each step
- Shows a **Final variable state** table: all variable values at the end of the run
- Requires an ExecutionSnapshot — runs from before Phase C deployment will show "not available"

> Both tabs are read-only. No execution state is modified.

---

## 29. AI Assertion Suggester

**Where:** Run detail → expand any step → Suggest tab

After a run completes, the Suggest tab generates advisory assertion recommendations for that step:

| Suggestion type | What it does |
|---|---|
| `status-code` | Asserts the actual status code observed |
| `body-field-exists` | Asserts top-level response body fields are present |
| `sla` | Asserts response time ≤ 2× the actual duration (rounded to 100ms) |
| `content-type` | Asserts the `Content-Type` header matches what was returned |

Suggestions are **advisory only** — review and add to your collection manually. The platform never auto-adds assertions.

---

## 30. AI Negative Test Generator

**Where:** API Collections list → Neg Tests button

Generates a suite of negative test cases for a collection based on its step request shapes:

| Strategy | Description |
|---|---|
| `missing-field` | Remove each body field — expect 400/422 |
| `wrong-type` | Send wrong type for typed fields — expect 400/422 |
| `boundary-violation` | 0, -1, empty string, 9999-char oversized values — expect 400/413/422 |
| `auth-stripped` | Remove auth headers — expect 401/403 |
| `wrong-method` | Send wrong HTTP verb — expect 405 |

Results are **advisory only** — no tests are run or added automatically. Use the modal table to identify gaps in your test coverage.

---

## 31. Plugin Ecosystem

**Where:** Plugins nav item (sidebar)

The plugin ecosystem lets you extend the platform with custom auth providers, assertion operators, and analytics enrichers.

### Registered Plugins table
- Lists all registered plugins with ID, name, version, capabilities, and status
- Enable/Disable buttons toggle plugin status in real time

### Example Plugins
Two built-in examples are available for exploration:

| Plugin | Type | What it adds |
|---|---|---|
| Custom Bearer Auth | `auth-provider` | Exchanges a custom header for a Bearer token via a configurable endpoint |
| Custom JSON Assertion | `custom-assertion` | Adds `jsonPathCount` operator: assert array length at a JSONPath |

Click **Register** to register an example plugin. Registered plugins appear in the table above.

> Example plugins are advisory only. They register manifests and hook entries — no actual HTTP requests are made by the auth plugin in this release.
```

- [ ] **Step 3: Update version and last-updated in user guide header**

Find:
```
**Last Updated:** 2026-05-22
**Version:** 2.0
```
Change to:
```
**Last Updated:** 2026-05-22
**Version:** 2.1
```

- [ ] **Step 4: Verify guide word count and formatting**

```bash
grep -c "^##" "e:/AI Agent/qa-agent-platform-dev/docs/API_TESTING_USER_GUIDE.md"
grep "TC-434\|434 test" "e:/AI Agent/qa-agent-platform-dev/docs/API_TESTING_TEST_GUIDE.md"
```
Expected: section count increases by 4; TC-434 appears in test guide.

---

## Execution Order

| Order | Task | Risk | Depends On |
|---|---|---|---|
| 1 | Task 1 — Timeline + Var Trace tabs | LOW | Nothing |
| 2 | Task 2 — Suggest Assertions tab | LOW | Nothing |
| 3 | Task 3 — Negative Tests button | LOW | Nothing |
| 4 | Task 4 — Plugins page | LOW-MEDIUM | Nothing |
| 5 | Task 5 — Test Guide + User Guide | ZERO | All above |

---

## Non-Negotiables

1. `npm run build:js` after every JS change — never edit `modules.js` directly
2. All new UI panels follow lazy-load pattern — fetch only when tab is activated
3. All AI features show advisory banner — never imply auto-execution
4. `escHtml()` on all server-returned strings — no XSS
5. No new top-level nav items except Plugins (Timeline/VarTrace/Suggest are sub-tabs in existing modals)
6. Port 3003 server restart only via Admin → Settings → Reset Server button after `npm run build`
7. Test Guide and User Guide must be updated as part of this plan (Task 5) — not optional
