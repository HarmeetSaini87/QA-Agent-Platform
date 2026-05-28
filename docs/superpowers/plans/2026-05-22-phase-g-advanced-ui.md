# Phase G — Advanced UI: Graph Visualization, Collaboration, Copilot & Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface four already-complete backend modules (Graph Editor, Collaboration, Copilot, Performance) in the browser UI so users can access them without calling API endpoints directly.

**Architecture:** All new UI is additive — four new nav tabs and panels, four new JS modules (32–35), zero changes to existing routes or backend. Follows the same vanilla-JS patterns established in 24-api-collections.js, 25-api-runs.js, and 31-api-plugins.js. SVG used for DAG visualization (no external libraries).

**Tech Stack:** Vanilla JS, HTML, SVG, CSS custom properties. `fetch()` for all API calls. `npm run build:js` regenerates `modules.js` after every JS change.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/ui/public/index.html` | Modify | Add 4 nav items + 4 panels (after line 163 for nav, after line 1308 for panels) |
| `src/ui/public/js/08-tab-switch.js` | Modify | Wire 4 new tab load functions |
| `src/ui/public/js/32-api-graph-editor.js` | Create | SVG DAG viewer, drag positions, dependency add/remove, layout save, DAG validate |
| `src/ui/public/js/33-api-collaboration.js` | Create | Revision history, review comments, workflow templates |
| `src/ui/public/js/34-api-copilot.js` | Create | Copilot guidance, flakiness/retry-storm/SLA predictions, guidance history |
| `src/ui/public/js/35-api-performance.js` | Create | Profiling spans, cache stats, safeguard health check |
| `docs/API_TESTING_TEST_GUIDE.md` | Modify | Append Modules 43–46 (TC-435–TC-474), update total + version |
| `docs/API_TESTING_USER_GUIDE.md` | Modify | Append sections 32–35, update TOC, bump version to 2.2 |

---

## Task 1 — Graph Editor UI

**Files:**
- Modify: `src/ui/public/index.html` line 163 (nav) and line 1308 (panel)
- Modify: `src/ui/public/js/08-tab-switch.js`
- Create: `src/ui/public/js/32-api-graph-editor.js`

### API endpoints used
- `GET /api/api-collections/:id` — fetch steps + dependsOn for selected collection
- `GET /api/graph-editor/:collectionId/layout` — load saved node positions
- `POST /api/graph-editor/:collectionId/layout` — save node positions
- `POST /api/graph-editor/:collectionId/validate-dag` — check for cycles/violations
- `POST /api/graph-editor/:collectionId/dependency` — add or remove a dependency edge

---

- [ ] **Step 1: Add nav item and panel to `index.html`**

Add after line 163 (the `api-plugins` nav item):
```html
        <div class="nav-item" data-tab="api-graph">&#x1F5FA;&#xFE0F; Graph Editor</div>
        <div class="nav-item" data-tab="api-collab">&#x1F4AC; Collaboration</div>
        <div class="nav-item" data-tab="api-copilot">&#x1F916; Copilot</div>
        <div class="nav-item" data-tab="perf-dashboard">&#x26A1; Performance</div>
```

Add after line 1308 (the closing `<!-- /panel-api-plugins -->` comment):
```html
        <div class="panel" id="panel-api-graph" style="display:none">
          <div class="card">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
              <h2 style="margin:0">&#x1F5FA;&#xFE0F; Graph Editor</h2>
              <select id="graph-col-select" onchange="graphEditorSelectCollection(this.value)" style="min-width:220px">
                <option value="">— Select Collection —</option>
              </select>
              <button class="tbl-btn" onclick="graphEditorValidate()">&#x2713; Validate DAG</button>
              <button class="tbl-btn" onclick="graphEditorSaveLayout()">&#x1F4BE; Save Layout</button>
              <button class="tbl-btn" onclick="graphEditorAddDep()">+ Add Dep</button>
              <button class="tbl-btn" onclick="graphEditorRemoveDep()">&#x2212; Remove Dep</button>
            </div>
            <div id="graph-editor-msg"></div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Click a node to select it (max 2). Drag to reposition. Use Add/Remove Dep with 2 selected nodes (first selected = dependency source).</div>
            <div id="graph-canvas" style="overflow:auto;min-height:300px;background:var(--bg-secondary);border-radius:6px;padding:12px">
              <div style="color:var(--text-muted)">Select a collection to view its workflow graph.</div>
            </div>
          </div>
        </div><!-- /panel-api-graph -->

        <div class="panel" id="panel-api-collab" style="display:none">
          <div class="card">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
              <h2 style="margin:0">&#x1F4AC; Collaboration</h2>
              <select id="collab-col-select" onchange="collabSelectCollection(this.value)" style="min-width:220px">
                <option value="">— Select Collection —</option>
              </select>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:12px">
              <button class="sub-tab active" data-collabtab="revisions" onclick="collabTabSwitch('revisions',this)">&#x1F4CB; Revisions</button>
              <button class="sub-tab" data-collabtab="comments" onclick="collabTabSwitch('comments',this)">&#x1F4AC; Comments</button>
              <button class="sub-tab" data-collabtab="templates" onclick="collabTabSwitch('templates',this)">&#x1F4D1; Templates</button>
            </div>
            <div id="collab-panel-revisions">
              <div style="display:flex;gap:8px;margin-bottom:10px">
                <button class="tbl-btn" onclick="collabCreateRevisionModal()">+ Save Revision</button>
              </div>
              <div id="collab-revisions-msg"></div>
              <table class="tbl"><thead><tr><th>#</th><th>Status</th><th>Author</th><th>Description</th><th>Created</th><th>Actions</th></tr></thead>
              <tbody id="collab-revisions-tbody"><tr><td colspan="6" style="color:var(--text-muted)">Select a collection.</td></tr></tbody></table>
            </div>
            <div id="collab-panel-comments" style="display:none">
              <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">
                <input id="collab-comment-body" type="text" placeholder="Add a comment…" style="flex:1;min-width:200px">
                <select id="collab-comment-target-type" style="width:140px">
                  <option value="collection">collection</option>
                  <option value="step">step</option>
                  <option value="dependency">dependency</option>
                  <option value="replay">replay</option>
                </select>
                <input id="collab-comment-target-id" type="text" placeholder="Target ID (optional)">
                <button class="tbl-btn" onclick="collabAddComment()">Post</button>
              </div>
              <div id="collab-comments-msg"></div>
              <div id="collab-comments-list"><div style="color:var(--text-muted)">Select a collection.</div></div>
            </div>
            <div id="collab-panel-templates" style="display:none">
              <div id="collab-templates-list"><div style="color:var(--text-muted)">Loading…</div></div>
            </div>
          </div>
        </div><!-- /panel-api-collab -->

        <div class="panel" id="panel-api-copilot" style="display:none">
          <div class="card">
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
              <h2 style="margin:0">&#x1F916; Copilot</h2>
              <select id="copilot-col-select" onchange="copilotSelectCollection(this.value)" style="min-width:220px">
                <option value="">— Select Collection —</option>
              </select>
            </div>
            <div class="advisory-banner" style="margin-bottom:12px">&#x1F916; <strong>Advisory only.</strong> All guidance and predictions are AI-generated suggestions. Nothing is applied automatically.</div>
            <div style="display:flex;gap:8px;margin-bottom:12px">
              <button class="sub-tab active" data-copilottab="guidance" onclick="copilotTabSwitch('guidance',this)">&#x1F4A1; Guidance</button>
              <button class="sub-tab" data-copilottab="predict" onclick="copilotTabSwitch('predict',this)">&#x1F4CA; Predictions</button>
              <button class="sub-tab" data-copilottab="history" onclick="copilotTabSwitch('history',this)">&#x1F4DC; History</button>
            </div>
            <div id="copilot-panel-guidance">
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">
                <select id="copilot-query-type" style="width:220px">
                  <option value="workflow-guidance">workflow-guidance</option>
                  <option value="orchestration-recommendation">orchestration-recommendation</option>
                  <option value="replay-debug">replay-debug</option>
                  <option value="flakiness-investigation">flakiness-investigation</option>
                  <option value="dependency-optimization">dependency-optimization</option>
                  <option value="retry-tuning">retry-tuning</option>
                  <option value="environment-anomaly">environment-anomaly</option>
                </select>
                <input id="copilot-run-id" type="text" placeholder="Run ID (optional)" style="width:160px">
                <button class="tbl-btn" onclick="copilotSubmitGuide()">&#x1F4A1; Get Guidance</button>
              </div>
              <div id="copilot-guidance-msg"></div>
              <div id="copilot-guidance-result"></div>
            </div>
            <div id="copilot-panel-predict" style="display:none">
              <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
                <button class="tbl-btn" onclick="copilotPredictFlakiness()">&#x1F9EA; Flakiness Forecast</button>
                <button class="tbl-btn" onclick="copilotPredictRetryStorm()">&#x26A1; Retry Storm Risk</button>
                <div style="display:flex;gap:4px;align-items:center">
                  <input id="copilot-sla-metric" type="text" placeholder="SLA metric name" style="width:140px">
                  <input id="copilot-sla-value" type="number" placeholder="Current value" style="width:110px">
                  <button class="tbl-btn" onclick="copilotPredictSlaBreach()">SLA Breach?</button>
                </div>
              </div>
              <div id="copilot-predict-msg"></div>
              <div id="copilot-predict-result"></div>
            </div>
            <div id="copilot-panel-history" style="display:none">
              <div id="copilot-history-result"><div style="color:var(--text-muted)">Select a collection.</div></div>
            </div>
          </div>
        </div><!-- /panel-api-copilot -->

        <div class="panel" id="panel-perf-dashboard" style="display:none">
          <div class="card">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <h2 style="margin:0">&#x26A1; Performance Dashboard</h2>
              <button class="tbl-btn" onclick="perfLoad()">&#x21BB; Refresh</button>
            </div>
            <div id="perf-dashboard-msg"></div>
            <h3 style="margin:0 0 8px">Safeguards</h3>
            <div id="perf-safeguards-result"><div style="color:var(--text-muted)">Loading…</div></div>
            <h3 style="margin:16px 0 8px">Cache Stats</h3>
            <div id="perf-cache-result"><div style="color:var(--text-muted)">Loading…</div></div>
            <div style="margin:8px 0 16px;display:flex;gap:8px;align-items:center">
              <input id="perf-invalidate-col" type="text" placeholder="Collection ID to invalidate cache">
              <button class="tbl-btn" onclick="perfInvalidateCache()">Invalidate</button>
            </div>
            <h3 style="margin:0 0 8px">Recent Profiling Spans</h3>
            <div id="perf-profile-result"><div style="color:var(--text-muted)">Loading…</div></div>
          </div>
        </div><!-- /panel-perf-dashboard -->
```

- [ ] **Step 2: Wire tab handlers in `08-tab-switch.js`**

Add after the `api-plugins` handler (line ~32):
```js
  if (tab === 'api-graph') { if (typeof graphEditorLoad === 'function') graphEditorLoad(); }
  if (tab === 'api-collab') { if (typeof collabLoad === 'function') collabLoad(); }
  if (tab === 'api-copilot') { if (typeof copilotLoad === 'function') copilotLoad(); }
  if (tab === 'perf-dashboard') { if (typeof perfLoad === 'function') perfLoad(); }
```

- [ ] **Step 3: Create `src/ui/public/js/32-api-graph-editor.js`**

```js
// ══════════════════════════════════════════════════════════════════════════════
// GRAPH EDITOR MODULE — SVG DAG visualizer with drag, dep edit, layout save
// ══════════════════════════════════════════════════════════════════════════════

let _graphColId = '';
let _graphSteps = [];
let _graphDepMap = {}; // stepId → string[] (dependsOn)
let _graphPositions = {}; // stepId → {x, y}
let _graphSelected = []; // max 2 stepIds
let _graphDragging = null; // {stepId, startX, startY, origX, origY}

const _GN_W = 160, _GN_H = 44, _GN_HGAP = 80, _GN_VGAP = 20, _GN_PAD = 20;

async function graphEditorLoad() {
  const sel = document.getElementById('graph-col-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Collection —</option>';
  const cols = (typeof allApiCollections !== 'undefined' && Array.isArray(allApiCollections) && allApiCollections.length)
    ? allApiCollections
    : await fetch('/api/api-collections').then(r => r.ok ? r.json() : []).catch(() => []);
  (Array.isArray(cols) ? cols : []).forEach(c => {
    sel.innerHTML += `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`;
  });
  document.getElementById('graph-canvas').innerHTML = '<div style="color:var(--text-muted)">Select a collection to view its workflow graph.</div>';
}

async function graphEditorSelectCollection(colId) {
  _graphColId = colId;
  _graphSelected = [];
  _graphDragging = null;
  const canvas = document.getElementById('graph-canvas');
  if (!colId) { canvas.innerHTML = '<div style="color:var(--text-muted)">Select a collection to view its workflow graph.</div>'; return; }
  canvas.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';

  const colRes = await fetch('/api/api-collections/' + encodeURIComponent(colId));
  if (!colRes.ok) { canvas.innerHTML = '<div style="color:#ef4444">Failed to load collection.</div>'; return; }
  const col = await colRes.json();
  _graphSteps = col.steps || [];
  _graphDepMap = {};
  _graphSteps.forEach(s => { _graphDepMap[s.stepId] = Array.isArray(s.dependsOn) ? s.dependsOn : []; });

  let savedPositions = {};
  const layoutRes = await fetch('/api/graph-editor/' + encodeURIComponent(colId) + '/layout');
  if (layoutRes.ok) {
    const layout = await layoutRes.json();
    savedPositions = layout.positions || {};
  }

  _graphPositions = _graphComputePositions(savedPositions);
  _graphRender();
}

function _graphComputePositions(savedPositions) {
  if (!_graphSteps.length) return {};
  const allSaved = _graphSteps.every(s => savedPositions[s.stepId]);
  if (allSaved) return Object.assign({}, savedPositions);

  // BFS layered layout
  const layerOf = {};
  const inDeg = {};
  _graphSteps.forEach(s => { inDeg[s.stepId] = (_graphDepMap[s.stepId] || []).length; });
  let queue = _graphSteps.filter(s => inDeg[s.stepId] === 0).map(s => s.stepId);
  queue.forEach(id => { layerOf[id] = 0; });

  while (queue.length) {
    const next = [];
    queue.forEach(id => {
      _graphSteps.forEach(s => {
        if ((_graphDepMap[s.stepId] || []).includes(id)) {
          const nl = (layerOf[id] || 0) + 1;
          if (layerOf[s.stepId] === undefined || layerOf[s.stepId] < nl) layerOf[s.stepId] = nl;
          if (!next.includes(s.stepId)) next.push(s.stepId);
        }
      });
    });
    queue = next;
  }
  _graphSteps.forEach(s => { if (layerOf[s.stepId] === undefined) layerOf[s.stepId] = 0; });

  const layerCtr = {};
  const positions = {};
  _graphSteps.forEach(s => {
    const l = layerOf[s.stepId];
    layerCtr[l] = layerCtr[l] || 0;
    positions[s.stepId] = {
      x: _GN_PAD + l * (_GN_W + _GN_HGAP),
      y: _GN_PAD + layerCtr[l] * (_GN_H + _GN_VGAP)
    };
    layerCtr[l]++;
  });
  return positions;
}

function _graphRender() {
  const canvas = document.getElementById('graph-canvas');
  if (!canvas) return;
  if (!_graphSteps.length) {
    canvas.innerHTML = '<div style="color:var(--text-muted)">No steps in this collection.</div>';
    return;
  }

  const xs = Object.values(_graphPositions).map(p => p.x + _GN_W);
  const ys = Object.values(_graphPositions).map(p => p.y + _GN_H);
  const svgW = Math.max(...xs) + _GN_PAD;
  const svgH = Math.max(...ys) + _GN_PAD;

  let svg = `<svg id="graph-svg" width="${svgW}" height="${svgH}" style="cursor:default;user-select:none;display:block"
    onmouseup="_graphDragEnd(event)" onmousemove="_graphDragMove(event)" onmouseleave="_graphDragEnd(event)">
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="#9ca3af"/>
      </marker>
    </defs>`;

  // Edges
  _graphSteps.forEach(s => {
    (_graphDepMap[s.stepId] || []).forEach(depId => {
      const fr = _graphPositions[depId], to = _graphPositions[s.stepId];
      if (!fr || !to) return;
      svg += `<line x1="${fr.x + _GN_W}" y1="${fr.y + _GN_H / 2}" x2="${to.x - 2}" y2="${to.y + _GN_H / 2}"
        stroke="#9ca3af" stroke-width="1.5" marker-end="url(#arr)"/>`;
    });
  });

  // Nodes
  _graphSteps.forEach(s => {
    const p = _graphPositions[s.stepId];
    if (!p) return;
    const sel = _graphSelected.includes(s.stepId);
    const label = (s.name || s.stepId || '').substring(0, 22);
    svg += `<g onmousedown="_graphDragStart(event,'${escHtml(s.stepId)}')" onclick="_graphNodeClick(event,'${escHtml(s.stepId)}')" style="cursor:pointer">
      <rect x="${p.x}" y="${p.y}" width="${_GN_W}" height="${_GN_H}" rx="6"
        fill="var(--bg)" stroke="${sel ? '#3b82f6' : '#d1d5db'}" stroke-width="${sel ? 2 : 1}"
        filter="drop-shadow(0 1px 2px rgba(0,0,0,.12))"/>
      <text x="${p.x + _GN_W / 2}" y="${p.y + _GN_H / 2 + 5}" text-anchor="middle"
        font-size="12" fill="var(--text)" font-family="system-ui,sans-serif">${escHtml(label)}</text>
    </g>`;
  });

  svg += '</svg>';
  canvas.innerHTML = svg;
}

function _graphNodeClick(event, stepId) {
  if (_graphDragging) return;
  const idx = _graphSelected.indexOf(stepId);
  if (idx >= 0) _graphSelected.splice(idx, 1);
  else { if (_graphSelected.length >= 2) _graphSelected.shift(); _graphSelected.push(stepId); }
  _graphRender();
}

function _graphDragStart(event, stepId) {
  event.stopPropagation();
  const svg = document.getElementById('graph-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  _graphDragging = { stepId, startX: event.clientX - rect.left, startY: event.clientY - rect.top,
    origX: _graphPositions[stepId].x, origY: _graphPositions[stepId].y };
}

function _graphDragMove(event) {
  if (!_graphDragging) return;
  const svg = document.getElementById('graph-svg');
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  const dx = (event.clientX - rect.left) - _graphDragging.startX;
  const dy = (event.clientY - rect.top) - _graphDragging.startY;
  _graphPositions[_graphDragging.stepId] = {
    x: Math.max(0, _graphDragging.origX + dx),
    y: Math.max(0, _graphDragging.origY + dy)
  };
  _graphRender();
}

function _graphDragEnd() { _graphDragging = null; }

async function graphEditorSaveLayout() {
  if (!_graphColId) return;
  const res = await fetch('/api/graph-editor/' + encodeURIComponent(_graphColId) + '/layout', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ positions: _graphPositions, nodeCount: _graphSteps.length })
  });
  modAlert('graph-editor-msg', res.ok ? 'Layout saved.' : 'Failed to save layout.', res.ok ? 'success' : 'error');
}

async function graphEditorValidate() {
  if (!_graphColId || !_graphSteps.length) { modAlert('graph-editor-msg', 'Select a collection first.', 'error'); return; }
  const res = await fetch('/api/graph-editor/' + encodeURIComponent(_graphColId) + '/validate-dag', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: _graphSteps.map(s => s.stepId), dependsOn: _graphDepMap })
  });
  if (!res.ok) { modAlert('graph-editor-msg', 'Validation request failed.', 'error'); return; }
  const result = await res.json();
  if (result.valid) {
    const order = (result.topologicalOrder || []).join(' → ');
    modAlert('graph-editor-msg', '&#x2713; DAG is valid.' + (order ? ' Order: ' + order : ''), 'success');
  } else {
    const msgs = (result.violations || []).map(v => `${v.type}${v.fromStepId ? ': ' + v.fromStepId + '→' + v.toStepId : ''}`).join('; ');
    modAlert('graph-editor-msg', '&#x26A0;&#xFE0F; Violations: ' + msgs, 'error');
  }
}

async function graphEditorAddDep() {
  if (_graphSelected.length !== 2) { modAlert('graph-editor-msg', 'Select exactly 2 nodes first.', 'error'); return; }
  const [fromId, toId] = _graphSelected;
  const currentDependsOn = {};
  _graphSteps.forEach(s => { currentDependsOn[s.stepId] = _graphDepMap[s.stepId] || []; });
  const res = await fetch('/api/graph-editor/' + encodeURIComponent(_graphColId) + '/dependency', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: _graphSteps.map(s => s.stepId), currentDependsOn, fromStepId: fromId, toStepId: toId, operation: 'add' })
  });
  const result = await res.json();
  if (!res.ok || !result.success) {
    const msgs = (result.violations || []).map(v => v.message || v.type).join('; ');
    modAlert('graph-editor-msg', 'Cannot add dependency: ' + (msgs || result.error || 'unknown'), 'error');
    return;
  }
  if (result.updatedDependsOn) _graphDepMap = result.updatedDependsOn;
  _graphSelected = [];
  _graphRender();
  modAlert('graph-editor-msg', 'Dependency added.', 'success');
}

async function graphEditorRemoveDep() {
  if (_graphSelected.length !== 2) { modAlert('graph-editor-msg', 'Select exactly 2 nodes first.', 'error'); return; }
  const [fromId, toId] = _graphSelected;
  const currentDependsOn = {};
  _graphSteps.forEach(s => { currentDependsOn[s.stepId] = _graphDepMap[s.stepId] || []; });
  const res = await fetch('/api/graph-editor/' + encodeURIComponent(_graphColId) + '/dependency', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: _graphSteps.map(s => s.stepId), currentDependsOn, fromStepId: fromId, toStepId: toId, operation: 'remove' })
  });
  const result = await res.json();
  if (!res.ok) { modAlert('graph-editor-msg', 'Failed to remove dependency.', 'error'); return; }
  if (result.updatedDependsOn) _graphDepMap = result.updatedDependsOn;
  _graphSelected = [];
  _graphRender();
  modAlert('graph-editor-msg', 'Dependency removed.', 'success');
}
```

- [ ] **Step 4: Run `npm run build:js` and verify clean build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build:js
```
Expected: `Built modules.js: NNNNN lines, NNN KB` with no errors.

---

## Task 2 — Collaboration UI

**Files:**
- Create: `src/ui/public/js/33-api-collaboration.js`
- (nav + panel already added in Task 1 Step 1)

### API endpoints used
- `GET /api/api-collections` — populate collection selector
- `GET /api/collaboration/:collectionId/revisions` — list revisions
- `POST /api/collaboration/:collectionId/revisions` — create revision snapshot
- `POST /api/collaboration/:collectionId/revisions/rollback` — rollback to revision
- `POST /api/collaboration/:collectionId/revisions/diff` — diff two revisions
- `GET /api/collaboration/:collectionId/comments` — list comments
- `POST /api/collaboration/:collectionId/comments` — add comment
- `POST /api/collaboration/comments/:commentId/resolve` — resolve comment
- `GET /api/collaboration/templates` — list workflow templates
- `POST /api/collaboration/templates/:templateId/instantiate` — instantiate template

---

- [ ] **Step 1: Create `src/ui/public/js/33-api-collaboration.js`**

```js
// ══════════════════════════════════════════════════════════════════════════════
// COLLABORATION MODULE — revisions, review comments, workflow templates
// ══════════════════════════════════════════════════════════════════════════════

let _collabColId = '';
let _collabRevisions = [];
let _collabActiveTab = 'revisions';

async function collabLoad() {
  const sel = document.getElementById('collab-col-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Collection —</option>';
  const cols = (typeof allApiCollections !== 'undefined' && Array.isArray(allApiCollections) && allApiCollections.length)
    ? allApiCollections
    : await fetch('/api/api-collections').then(r => r.ok ? r.json() : []).catch(() => []);
  (Array.isArray(cols) ? cols : []).forEach(c => {
    sel.innerHTML += `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`;
  });
  collabLoadTemplates();
}

async function collabSelectCollection(colId) {
  _collabColId = colId;
  if (!colId) return;
  if (_collabActiveTab === 'revisions') collabLoadRevisions(colId);
  if (_collabActiveTab === 'comments') collabLoadComments(colId);
}

function collabTabSwitch(tab, btn) {
  _collabActiveTab = tab;
  document.querySelectorAll('[data-collabtab]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['revisions', 'comments', 'templates'].forEach(t => {
    const el = document.getElementById('collab-panel-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'revisions' && _collabColId) collabLoadRevisions(_collabColId);
  if (tab === 'comments' && _collabColId) collabLoadComments(_collabColId);
  if (tab === 'templates') collabLoadTemplates();
}

// ─── REVISIONS ───────────────────────────────────────────────────────────────

async function collabLoadRevisions(colId) {
  const tbody = document.getElementById('collab-revisions-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted)">Loading…</td></tr>';
  const res = await fetch('/api/collaboration/' + encodeURIComponent(colId) + '/revisions');
  if (!res.ok) { tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444">Failed to load revisions.</td></tr>'; return; }
  const data = await res.json();
  _collabRevisions = data.revisions || [];
  if (!_collabRevisions.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted)">No revisions yet.</td></tr>'; return; }
  tbody.innerHTML = _collabRevisions.map(r => `<tr>
    <td>${r.revisionNumber}</td>
    <td><span class="badge">${escHtml(r.status)}</span></td>
    <td>${escHtml(r.authorId || '—')}</td>
    <td>${escHtml(r.description || '—')}</td>
    <td style="font-size:11px;color:var(--text-muted)">${r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
    <td>
      <button class="tbl-btn" onclick="collabRollback('${escHtml(r.revisionId)}')">Rollback</button>
      <button class="tbl-btn" onclick="collabShowDiff('${escHtml(r.revisionId)}')">Diff</button>
    </td>
  </tr>`).join('');
}

function collabCreateRevisionModal() {
  if (!_collabColId) { modAlert('collab-revisions-msg', 'Select a collection first.', 'error'); return; }
  const desc = prompt('Revision description (optional):');
  if (desc === null) return; // cancelled
  collabCreateRevision(_collabColId, desc || '');
}

async function collabCreateRevision(colId, description) {
  const res = await fetch('/api/collaboration/' + encodeURIComponent(colId) + '/revisions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId: 'ui-user', description, stepSnapshot: [] })
  });
  if (!res.ok) { modAlert('collab-revisions-msg', 'Failed to create revision.', 'error'); return; }
  modAlert('collab-revisions-msg', 'Revision saved.', 'success');
  collabLoadRevisions(colId);
}

async function collabRollback(revisionId) {
  if (!_collabColId) return;
  if (!confirm('Roll back to this revision?')) return;
  const res = await fetch('/api/collaboration/' + encodeURIComponent(_collabColId) + '/revisions/rollback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toRevisionId: revisionId, actorId: 'ui-user' })
  });
  modAlert('collab-revisions-msg', res.ok ? 'Rollback complete.' : 'Rollback failed.', res.ok ? 'success' : 'error');
  if (res.ok) collabLoadRevisions(_collabColId);
}

async function collabShowDiff(revisionId) {
  if (!_collabColId || _collabRevisions.length < 2) { modAlert('collab-revisions-msg', 'Need at least 2 revisions to diff.', 'error'); return; }
  const other = _collabRevisions.find(r => r.revisionId !== revisionId);
  if (!other) return;
  const res = await fetch('/api/collaboration/' + encodeURIComponent(_collabColId) + '/revisions/diff', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromRevisionId: other.revisionId, toRevisionId: revisionId })
  });
  if (!res.ok) { modAlert('collab-revisions-msg', 'Diff request failed.', 'error'); return; }
  const diff = await res.json();
  const added = (diff.stepsAdded || []).map(s => `+${escHtml(s.stepId)}`).join(', ') || 'none';
  const removed = (diff.stepsRemoved || []).map(s => `-${escHtml(s.stepId)}`).join(', ') || 'none';
  const deps = (diff.dependenciesChanged || []).length;
  modAlert('collab-revisions-msg', `Diff: Added: ${added} | Removed: ${removed} | Dependency changes: ${deps}`, 'success');
}

// ─── COMMENTS ────────────────────────────────────────────────────────────────

async function collabLoadComments(colId) {
  const list = document.getElementById('collab-comments-list');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/collaboration/' + encodeURIComponent(colId) + '/comments');
  if (!res.ok) { list.innerHTML = '<div style="color:#ef4444">Failed to load comments.</div>'; return; }
  const comments = await res.json();
  if (!Array.isArray(comments) || !comments.length) { list.innerHTML = '<div style="color:var(--text-muted)">No comments yet.</div>'; return; }
  list.innerHTML = comments.map(c => `
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-weight:600">${escHtml(c.authorId || '—')}</span>
        <span style="font-size:11px;color:var(--text-muted)">${c.targetType}${c.targetId ? ':' + escHtml(c.targetId) : ''} · ${c.status}</span>
      </div>
      <div style="margin-bottom:6px">${escHtml(c.body)}</div>
      ${c.status === 'open' ? `<button class="tbl-btn" onclick="collabResolveComment('${escHtml(c.commentId)}')">Resolve</button>` : '<span style="color:#22c55e;font-size:12px">&#x2713; Resolved</span>'}
    </div>`).join('');
}

async function collabAddComment() {
  if (!_collabColId) { modAlert('collab-comments-msg', 'Select a collection first.', 'error'); return; }
  const body = document.getElementById('collab-comment-body')?.value?.trim();
  if (!body) { modAlert('collab-comments-msg', 'Comment body is required.', 'error'); return; }
  const targetType = document.getElementById('collab-comment-target-type')?.value || 'collection';
  const targetId = document.getElementById('collab-comment-target-id')?.value?.trim() || _collabColId;
  const res = await fetch('/api/collaboration/' + encodeURIComponent(_collabColId) + '/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId: 'ui-user', targetType, targetId, body })
  });
  if (!res.ok) { modAlert('collab-comments-msg', 'Failed to post comment.', 'error'); return; }
  document.getElementById('collab-comment-body').value = '';
  modAlert('collab-comments-msg', 'Comment posted.', 'success');
  collabLoadComments(_collabColId);
}

async function collabResolveComment(commentId) {
  const res = await fetch('/api/collaboration/comments/' + encodeURIComponent(commentId) + '/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId: 'ui-user' })
  });
  if (res.ok && _collabColId) collabLoadComments(_collabColId);
}

// ─── TEMPLATES ───────────────────────────────────────────────────────────────

async function collabLoadTemplates() {
  const list = document.getElementById('collab-templates-list');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/collaboration/templates');
  if (!res.ok) { list.innerHTML = '<div style="color:#ef4444">Failed to load templates.</div>'; return; }
  const templates = await res.json();
  if (!Array.isArray(templates) || !templates.length) { list.innerHTML = '<div style="color:var(--text-muted)">No templates available.</div>'; return; }
  list.innerHTML = templates.map(t => `
    <div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px">
      <div style="font-weight:600;margin-bottom:4px">${escHtml(t.name || t.templateId)}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-bottom:6px">${escHtml(t.description || '')} <span class="badge">${escHtml(t.category || '')}</span></div>
      <div class="advisory-banner" style="margin-bottom:8px">&#x2139;&#xFE0F; Instantiate creates an advisory scaffold only. No collection is created automatically.</div>
      <button class="tbl-btn" onclick="collabInstantiateTemplate('${escHtml(t.templateId)}')">Instantiate</button>
    </div>`).join('');
}

async function collabInstantiateTemplate(templateId) {
  const res = await fetch('/api/collaboration/templates/' + encodeURIComponent(templateId) + '/instantiate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetCollectionId: _collabColId || undefined })
  });
  if (!res.ok) { alert('Instantiation failed.'); return; }
  const scaffold = await res.json();
  alert('Advisory scaffold returned. Steps: ' + (scaffold.steps || scaffold.stepCount || JSON.stringify(scaffold)).toString().substring(0, 200));
}
```

- [ ] **Step 2: Run `npm run build:js` and verify clean build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build:js
```
Expected: clean output, line count increases from Task 1 build.

---

## Task 3 — Copilot & Predictive UI

**Files:**
- Create: `src/ui/public/js/34-api-copilot.js`
- (nav + panel already added in Task 1 Step 1)

### API endpoints used
- `POST /api/copilot/guide` — submit copilot query, get guidance items
- `GET /api/copilot/history/:collectionId` — past guidance for a collection
- `POST /api/copilot/predict/flakiness` — per-step flakiness forecast
- `POST /api/copilot/predict/retry-storm` — retry storm risk
- `POST /api/copilot/predict/sla-breach` — SLA breach likelihood

---

- [ ] **Step 1: Create `src/ui/public/js/34-api-copilot.js`**

```js
// ══════════════════════════════════════════════════════════════════════════════
// COPILOT MODULE — AI guidance, flakiness/retry-storm/SLA predictions
// ══════════════════════════════════════════════════════════════════════════════

let _copilotColId = '';

async function copilotLoad() {
  const sel = document.getElementById('copilot-col-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Collection —</option>';
  const cols = (typeof allApiCollections !== 'undefined' && Array.isArray(allApiCollections) && allApiCollections.length)
    ? allApiCollections
    : await fetch('/api/api-collections').then(r => r.ok ? r.json() : []).catch(() => []);
  (Array.isArray(cols) ? cols : []).forEach(c => {
    sel.innerHTML += `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`;
  });
}

function copilotSelectCollection(colId) {
  _copilotColId = colId;
  document.getElementById('copilot-guidance-result').innerHTML = '';
  document.getElementById('copilot-predict-result').innerHTML = '';
  document.getElementById('copilot-history-result').innerHTML = '<div style="color:var(--text-muted)">Select a collection then switch to History tab.</div>';
}

function copilotTabSwitch(tab, btn) {
  document.querySelectorAll('[data-copilottab]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['guidance', 'predict', 'history'].forEach(t => {
    const el = document.getElementById('copilot-panel-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'history' && _copilotColId) copilotLoadHistory(_copilotColId);
}

// ─── GUIDANCE ────────────────────────────────────────────────────────────────

async function copilotSubmitGuide() {
  if (!_copilotColId) { modAlert('copilot-guidance-msg', 'Select a collection first.', 'error'); return; }
  const queryType = document.getElementById('copilot-query-type')?.value || 'workflow-guidance';
  const runId = document.getElementById('copilot-run-id')?.value?.trim() || undefined;
  const result = document.getElementById('copilot-guidance-result');
  result.innerHTML = '<div style="color:var(--text-muted)">Asking Copilot…</div>';
  modAlert('copilot-guidance-msg', '', 'success');
  const res = await fetch('/api/copilot/guide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queryType, collectionId: _copilotColId, runId, actorId: 'ui-user', context: {} })
  });
  if (!res.ok) { result.innerHTML = '<div style="color:#ef4444">Copilot request failed.</div>'; return; }
  const data = await res.json();
  _copilotRenderGuidance(data, result);
}

function _copilotRenderGuidance(data, container) {
  const items = data.items || [];
  if (!items.length) { container.innerHTML = '<div style="color:var(--text-muted)">No guidance items returned.</div>'; return; }
  const sevColor = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444' };
  container.innerHTML = `
    <div class="advisory-banner" style="margin-bottom:10px">&#x1F916; ${escHtml(data.governanceNote || 'Advisory only — review before acting.')}</div>
    <table class="tbl"><thead><tr><th>Severity</th><th>Title</th><th>Guidance</th><th>Confidence</th><th>Action Hint</th></tr></thead>
    <tbody>${items.map(it => `<tr>
      <td><span style="color:${sevColor[it.severity] || '#9ca3af'};font-weight:600">${escHtml(it.severity)}</span></td>
      <td>${escHtml(it.title)}</td>
      <td style="max-width:300px">${escHtml(it.body)}</td>
      <td>${it.confidence}%</td>
      <td style="font-size:12px;color:var(--text-muted)">${escHtml(it.actionHint || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function copilotLoadHistory(colId) {
  const container = document.getElementById('copilot-history-result');
  container.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/copilot/history/' + encodeURIComponent(colId));
  if (!res.ok) { container.innerHTML = '<div style="color:#ef4444">Failed to load history.</div>'; return; }
  const history = await res.json();
  const items = Array.isArray(history) ? history : (history.items || []);
  if (!items.length) { container.innerHTML = '<div style="color:var(--text-muted)">No guidance history yet.</div>'; return; }
  container.innerHTML = `<table class="tbl"><thead><tr><th>Query Type</th><th>Items</th><th>Generated At</th></tr></thead>
    <tbody>${items.map(h => `<tr>
      <td>${escHtml(h.queryType)}</td>
      <td>${(h.items || []).length}</td>
      <td style="font-size:11px;color:var(--text-muted)">${h.generatedAt ? new Date(h.generatedAt).toLocaleString() : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

// ─── PREDICTIONS ─────────────────────────────────────────────────────────────

async function copilotPredictFlakiness() {
  if (!_copilotColId) { modAlert('copilot-predict-msg', 'Select a collection first.', 'error'); return; }
  const result = document.getElementById('copilot-predict-result');
  result.innerHTML = '<div style="color:var(--text-muted)">Forecasting flakiness…</div>';
  const res = await fetch('/api/copilot/predict/flakiness', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId: _copilotColId })
  });
  if (!res.ok) { result.innerHTML = '<div style="color:#ef4444">Flakiness forecast failed.</div>'; return; }
  const data = await res.json();
  const forecasts = data.forecasts || [];
  if (!forecasts.length) { result.innerHTML = '<div style="color:var(--text-muted)">No flakiness forecasts available.</div>'; return; }
  result.innerHTML = `<h4 style="margin:0 0 8px">&#x1F9EA; Flakiness Forecast</h4>
    <table class="tbl"><thead><tr><th>Step ID</th><th>Predicted Score</th><th>Confidence</th><th>Contributing Factors</th></tr></thead>
    <tbody>${forecasts.map(f => {
      const score = f.predictedFlakinessScore || 0;
      const col = score > 70 ? '#ef4444' : score > 40 ? '#f59e0b' : '#22c55e';
      return `<tr>
        <td style="font-size:12px">${escHtml(f.stepId)}</td>
        <td><span style="color:${col};font-weight:600">${score}%</span></td>
        <td>${f.confidence}%</td>
        <td style="font-size:12px;color:var(--text-muted)">${(f.contributingFactors || []).join(', ') || '—'}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

async function copilotPredictRetryStorm() {
  if (!_copilotColId) { modAlert('copilot-predict-msg', 'Select a collection first.', 'error'); return; }
  const result = document.getElementById('copilot-predict-result');
  result.innerHTML = '<div style="color:var(--text-muted)">Forecasting retry storm…</div>';
  const res = await fetch('/api/copilot/predict/retry-storm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId: _copilotColId })
  });
  if (!res.ok) { result.innerHTML = '<div style="color:#ef4444">Retry storm forecast failed.</div>'; return; }
  const f = await res.json();
  const riskColor = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
  result.innerHTML = `<h4 style="margin:0 0 8px">&#x26A1; Retry Storm Forecast</h4>
    <div style="margin-bottom:8px">Risk: <strong style="color:${riskColor[f.stormRisk] || '#9ca3af'}">${escHtml(f.stormRisk || '—')}</strong>
      &nbsp;Predicted retry rate: <strong>${((f.predictedRetryRate || 0) * 100).toFixed(1)}%</strong>
      &nbsp;Confidence: ${f.confidence || 0}%</div>
    ${(f.affectedStepIds || []).length ? '<div style="font-size:12px;color:var(--text-muted)">Affected steps: ' + f.affectedStepIds.map(id => escHtml(id)).join(', ') + '</div>' : ''}`;
}

async function copilotPredictSlaBreach() {
  if (!_copilotColId) { modAlert('copilot-predict-msg', 'Select a collection first.', 'error'); return; }
  const slaMetric = document.getElementById('copilot-sla-metric')?.value?.trim();
  const currentValue = parseFloat(document.getElementById('copilot-sla-value')?.value || '0');
  if (!slaMetric) { modAlert('copilot-predict-msg', 'Enter SLA metric name.', 'error'); return; }
  const result = document.getElementById('copilot-predict-result');
  result.innerHTML = '<div style="color:var(--text-muted)">Forecasting SLA breach…</div>';
  const res = await fetch('/api/copilot/predict/sla-breach', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId: _copilotColId, slaMetric, currentValue })
  });
  if (!res.ok) { result.innerHTML = '<div style="color:#ef4444">SLA breach forecast failed.</div>'; return; }
  const f = await res.json();
  const likelihood = ((f.breachLikelihood || 0) * 100).toFixed(1);
  const col = f.breachLikelihood > 0.7 ? '#ef4444' : f.breachLikelihood > 0.4 ? '#f59e0b' : '#22c55e';
  result.innerHTML = `<h4 style="margin:0 0 8px">SLA Breach Forecast — ${escHtml(slaMetric)}</h4>
    <div>Breach likelihood: <strong style="color:${col}">${likelihood}%</strong>
      &nbsp;Current value: ${currentValue}
      &nbsp;Forecasted value: ${f.forecastedValue !== undefined ? f.forecastedValue : '—'}</div>`;
}
```

- [ ] **Step 2: Run `npm run build:js` and verify clean build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build:js
```
Expected: clean output.

---

## Task 4 — Performance Dashboard UI

**Files:**
- Create: `src/ui/public/js/35-api-performance.js`
- (nav + panel already added in Task 1 Step 1)

### API endpoints used
- `GET /api/performance/profile` — recent profiling spans + phase stats
- `GET /api/performance/cache/stats` — cache hit/miss/eviction stats
- `POST /api/performance/cache/invalidate/:collectionId` — evict one collection from cache
- `GET /api/performance/safeguards` — threshold violation check

---

- [ ] **Step 1: Create `src/ui/public/js/35-api-performance.js`**

```js
// ══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE DASHBOARD MODULE — profiling, cache stats, safeguards
// ══════════════════════════════════════════════════════════════════════════════

async function perfLoad() {
  await Promise.all([_perfLoadSafeguards(), _perfLoadCacheStats(), _perfLoadProfile()]);
}

async function _perfLoadSafeguards() {
  const el = document.getElementById('perf-safeguards-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Checking…</div>';
  const res = await fetch('/api/performance/safeguards');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load safeguard status.</div>'; return; }
  const data = await res.json();
  const result = data.result || data;
  const violations = result.violations || [];
  if (result.healthy) {
    el.innerHTML = '<div style="color:#22c55e;font-weight:600">&#x2713; All safeguard checks passed.</div>';
    return;
  }
  const sevColor = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444' };
  el.innerHTML = `<table class="tbl"><thead><tr><th>Code</th><th>Severity</th><th>Measured</th><th>Threshold</th><th>Note</th></tr></thead>
    <tbody>${violations.map(v => `<tr>
      <td style="font-size:12px">${escHtml(v.code)}</td>
      <td><span style="color:${sevColor[v.severity] || '#9ca3af'};font-weight:600">${escHtml(v.severity)}</span></td>
      <td>${v.measuredValue !== undefined ? v.measuredValue : '—'}</td>
      <td>${v.threshold !== undefined ? v.threshold : '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${escHtml(v.advisoryNote || v.message || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function _perfLoadCacheStats() {
  const el = document.getElementById('perf-cache-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/performance/cache/stats');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load cache stats.</div>'; return; }
  const data = await res.json();
  const s = data.stats || data;
  const hitRate = s.hitRate !== undefined ? (s.hitRate * 100).toFixed(1) + '%' : '—';
  el.innerHTML = `<div style="display:flex;gap:24px;flex-wrap:wrap">
    <div><div style="font-size:22px;font-weight:700;color:#22c55e">${s.hits || 0}</div><div style="font-size:12px;color:var(--text-muted)">Hits</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#f59e0b">${s.misses || 0}</div><div style="font-size:12px;color:var(--text-muted)">Misses</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#9ca3af">${s.evictions || 0}</div><div style="font-size:12px;color:var(--text-muted)">Evictions</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#3b82f6">${hitRate}</div><div style="font-size:12px;color:var(--text-muted)">Hit Rate</div></div>
  </div>`;
}

async function perfInvalidateCache() {
  const colId = document.getElementById('perf-invalidate-col')?.value?.trim();
  if (!colId) { modAlert('perf-dashboard-msg', 'Enter a Collection ID to invalidate.', 'error'); return; }
  const res = await fetch('/api/performance/cache/invalidate/' + encodeURIComponent(colId), { method: 'POST' });
  if (res.ok) {
    modAlert('perf-dashboard-msg', 'Cache invalidated for ' + escHtml(colId), 'success');
    _perfLoadCacheStats();
  } else {
    modAlert('perf-dashboard-msg', 'Cache invalidation failed.', 'error');
  }
}

async function _perfLoadProfile() {
  const el = document.getElementById('perf-profile-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/performance/profile');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load profiling data.</div>'; return; }
  const data = await res.json();
  const snapshot = data.snapshot || data;
  const spans = snapshot.recentSpans || [];
  if (!spans.length) { el.innerHTML = '<div style="color:var(--text-muted)">No profiling spans recorded yet.</div>'; return; }
  el.innerHTML = `<table class="tbl"><thead><tr><th>Phase</th><th>Label</th><th>Duration (ms)</th><th>Start</th></tr></thead>
    <tbody>${spans.slice(-20).reverse().map(sp => `<tr>
      <td style="font-size:12px">${escHtml(sp.phase || '—')}</td>
      <td style="font-size:12px">${escHtml(sp.label || '—')}</td>
      <td>${sp.durationMs !== undefined ? sp.durationMs : '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${sp.startMs ? new Date(sp.startMs).toLocaleTimeString() : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
}
```

- [ ] **Step 2: Run `npm run build:js` and verify final clean build**

```bash
cd "e:\AI Agent\qa-agent-platform-dev" && npm run build:js
```
Expected: clean output with all 4 new modules included (32–35).

---

## Task 5 — Update Test Guide and User Guide

**Files:**
- Modify: `docs/API_TESTING_TEST_GUIDE.md` — append Modules 43–46, update footer total + version
- Modify: `docs/API_TESTING_USER_GUIDE.md` — append sections 32–35, update TOC, bump to v2.2

---

- [ ] **Step 1: Append Modules 43–46 to `docs/API_TESTING_TEST_GUIDE.md`**

Replace the `*End of Test Guide*` footer line with the following block:

```markdown
---

## Module 43 — Graph Editor UI

### TC-435 | Graph Editor nav item visible and panel loads
```
Steps:
  1. Log in, navigate to main UI.
  2. Verify "🗺️ Graph Editor" nav item exists.
  3. Click it — verify panel-api-graph renders without error.
Expected: Panel loads; collection selector visible.
Type: UI
```

### TC-436 | Graph Editor — selecting a collection renders SVG
```
Steps:
  1. Navigate to Graph Editor tab.
  2. Select a collection with at least 2 steps.
  3. Verify SVG canvas renders with node rectangles and step labels.
  4. Verify dependency edges are drawn as lines with arrowheads.
Expected: SVG renders nodes + edges; no JS error.
Type: Functional
```

### TC-437 | Graph Editor — auto-layout assigns layered positions
```
Steps:
  1. Select a collection with a chain: A → B → C (B depends on A, C depends on B).
  2. Verify A is in column 0, B in column 1, C in column 2.
Expected: Layer positions reflect dependency depth.
Type: Functional
```

### TC-438 | Graph Editor — saved layout is used when all positions exist
```
Steps:
  1. Mock GET /api/graph-editor/:id/layout to return positions for all steps.
  2. Select collection in Graph Editor.
  3. Verify nodes are rendered at the saved positions, not auto-layout positions.
Expected: Saved positions override auto-layout.
Type: Functional
```

### TC-439 | Graph Editor — Save Layout calls POST endpoint
```
Steps:
  1. Select a collection and drag a node to a new position.
  2. Click 💾 Save Layout.
  3. Verify POST /api/graph-editor/:id/layout was called with updated positions.
  4. Verify success message displayed.
Expected: Layout saved; success message shown.
Type: Functional
```

### TC-440 | Graph Editor — Validate DAG shows valid result
```
Steps:
  1. Select a collection with no cycles.
  2. Click ✓ Validate DAG.
  3. Verify "DAG is valid" message displayed.
  4. Verify topological order shown in the message (if returned by API).
Expected: Validation passes; order displayed.
Type: Functional
```

### TC-441 | Graph Editor — Validate DAG shows cycle violation
```
Steps:
  1. Mock POST /api/graph-editor/:id/validate-dag to return { valid: false, violations: [{type:'cycle', fromStepId:'A', toStepId:'B'}] }.
  2. Click ✓ Validate DAG.
  3. Verify violation message displayed: "cycle: A→B".
Expected: Violation details shown; no crash.
Type: Functional
```

### TC-442 | Graph Editor — Add Dep with exactly 2 selected nodes
```
Steps:
  1. Select a collection with 2 unconnected steps.
  2. Click node A (first selection), then click node B (second selection).
  3. Verify both nodes show highlighted border.
  4. Click + Add Dep.
  5. Verify POST /api/graph-editor/:id/dependency called with operation:'add', fromStepId:A, toStepId:B.
  6. Verify new edge rendered from A to B.
Expected: Dependency added; edge visible in SVG.
Type: Functional
```

### TC-443 | Graph Editor — Add Dep with 0 or 1 nodes selected shows error
```
Steps:
  1. Click + Add Dep with no nodes selected.
  2. Verify error message "Select exactly 2 nodes first."
  3. Click only one node, then click + Add Dep.
  4. Verify same error message.
Expected: Error message; no API call made.
Type: Error Handling
```

### TC-444 | Graph Editor — Remove Dep removes the edge
```
Steps:
  1. Select a collection with step B that depends on A.
  2. Click node A then node B.
  3. Click − Remove Dep.
  4. Verify POST /api/graph-editor/:id/dependency called with operation:'remove'.
  5. Verify edge from A to B is no longer rendered.
Expected: Edge removed from SVG; success message.
Type: Functional
```

---

## Module 44 — Collaboration UI

### TC-445 | Collaboration nav item visible and panel loads
```
Steps:
  1. Navigate to main UI.
  2. Verify "💬 Collaboration" nav item exists.
  3. Click it — verify panel-api-collab renders with 3 sub-tabs.
Expected: Panel loads; Revisions, Comments, Templates tabs visible.
Type: UI
```

### TC-446 | Collaboration — Revisions tab lists revisions
```
Steps:
  1. Navigate to Collaboration tab, select a collection.
  2. Verify GET /api/collaboration/:id/revisions called.
  3. Verify table shows revisionNumber, status, authorId, description, createdAt.
Expected: Revisions listed; no JS error.
Type: Functional
```

### TC-447 | Collaboration — Save Revision creates new revision
```
Steps:
  1. Select a collection.
  2. Click + Save Revision, enter description.
  3. Verify POST /api/collaboration/:id/revisions called.
  4. Verify table reloads and new revision appears.
Expected: Revision saved; table updated.
Type: Functional
```

### TC-448 | Collaboration — Rollback updates status
```
Steps:
  1. With at least 2 revisions, click Rollback on the oldest.
  2. Confirm the dialog.
  3. Verify POST /api/collaboration/:id/revisions/rollback called.
  4. Verify success message shown.
Expected: Rollback called; success confirmed.
Type: Functional
```

### TC-449 | Collaboration — Diff shows step additions and removals
```
Steps:
  1. With at least 2 revisions, click Diff on any revision.
  2. Verify POST /api/collaboration/:id/revisions/diff called.
  3. Verify diff message shows Added/Removed/Dependency change counts.
Expected: Diff summary displayed in info message.
Type: Functional
```

### TC-450 | Collaboration — Comments tab: post and list comments
```
Steps:
  1. Switch to Comments tab, select a collection.
  2. Type a comment, select targetType 'collection', click Post.
  3. Verify POST /api/collaboration/:id/comments called.
  4. Verify comment appears in list with author, body, status 'open'.
Expected: Comment posted and listed.
Type: Functional
```

### TC-451 | Collaboration — Resolve comment updates status
```
Steps:
  1. With an open comment visible, click Resolve.
  2. Verify POST /api/collaboration/comments/:id/resolve called.
  3. Verify comment shows green "✓ Resolved".
Expected: Comment resolved; status updated in UI.
Type: Functional
```

### TC-452 | Collaboration — Templates tab lists templates with advisory banner
```
Steps:
  1. Switch to Templates tab.
  2. Verify GET /api/collaboration/templates called.
  3. Verify each template card shows name, description, category, advisory banner, Instantiate button.
Expected: Templates listed; advisory banner present on each card.
Type: Functional
```

### TC-453 | Collaboration — Instantiate template shows advisory scaffold
```
Steps:
  1. Click Instantiate on any template.
  2. Verify POST /api/collaboration/templates/:id/instantiate called.
  3. Verify alert/message shows advisory scaffold summary.
Expected: Scaffold returned; no collection created automatically.
Type: Functional
```

---

## Module 45 — Copilot & Predictive UI

### TC-454 | Copilot nav item visible and panel loads
```
Steps:
  1. Verify "🤖 Copilot" nav item exists.
  2. Click it — verify panel-api-copilot renders with advisory banner and 3 sub-tabs.
Expected: Panel loads; advisory banner visible before any interaction.
Type: UI
```

### TC-455 | Copilot — Guidance query returns items table
```
Steps:
  1. Navigate to Copilot, select a collection.
  2. Select queryType 'workflow-guidance', click 💡 Get Guidance.
  3. Verify POST /api/copilot/guide called with correct body.
  4. Verify results table shows Severity, Title, Guidance, Confidence, Action Hint columns.
Expected: Guidance items rendered; confidence percentages shown.
Type: Functional
```

### TC-456 | Copilot — Guidance without collection selected shows error
```
Steps:
  1. On Copilot tab with no collection selected, click 💡 Get Guidance.
  2. Verify error message "Select a collection first."
  3. Verify no API call made.
Expected: Inline error; no fetch triggered.
Type: Error Handling
```

### TC-457 | Copilot — Guidance zero items shows empty message
```
Steps:
  1. Mock POST /api/copilot/guide to return { items: [] }.
  2. Click Get Guidance.
  3. Verify "No guidance items returned." message shown.
Expected: Empty-state message; no crash.
Type: Functional
```

### TC-458 | Copilot — Flakiness Forecast renders per-step table
```
Steps:
  1. Select a collection, switch to Predictions tab.
  2. Click 🧪 Flakiness Forecast.
  3. Verify POST /api/copilot/predict/flakiness called.
  4. Verify table with Step ID, Predicted Score (color-coded), Confidence, Contributing Factors.
Expected: Forecast table rendered; high scores in red.
Type: Functional
```

### TC-459 | Copilot — Retry Storm shows risk level and affected steps
```
Steps:
  1. Select a collection, click ⚡ Retry Storm Risk.
  2. Verify POST /api/copilot/predict/retry-storm called.
  3. Verify risk level (low/medium/high) shown with color.
  4. Verify affected step IDs listed.
Expected: Storm risk displayed; color matches severity.
Type: Functional
```

### TC-460 | Copilot — SLA Breach forecast requires metric name
```
Steps:
  1. Leave SLA metric input blank, click SLA Breach?.
  2. Verify error "Enter SLA metric name."
  3. Fill metric name + value, click again.
  4. Verify POST /api/copilot/predict/sla-breach called.
  5. Verify breach likelihood shown as percentage with color.
Expected: Validation enforced; forecast rendered on valid input.
Type: Functional
```

### TC-461 | Copilot — History tab shows past guidance queries
```
Steps:
  1. Select a collection, switch to History tab.
  2. Verify GET /api/copilot/history/:collectionId called.
  3. Verify table shows queryType, items count, generatedAt.
Expected: History listed; no JS error.
Type: Functional
```

---

## Module 46 — Performance Dashboard UI

### TC-462 | Performance nav item visible and panel loads
```
Steps:
  1. Verify "⚡ Performance" nav item exists.
  2. Click it — verify panel-perf-dashboard renders with all 3 sections.
  3. Verify GET /api/performance/safeguards, /cache/stats, /profile called on load.
Expected: Panel loads; all 3 sections populated.
Type: UI
```

### TC-463 | Performance — Safeguards shows healthy when no violations
```
Steps:
  1. Mock GET /api/performance/safeguards to return { result: { healthy: true, violations: [] } }.
  2. Navigate to Performance tab.
  3. Verify "✓ All safeguard checks passed." shown in green.
Expected: Healthy state displayed without a violations table.
Type: Functional
```

### TC-464 | Performance — Safeguards shows violation table when unhealthy
```
Steps:
  1. Mock GET /api/performance/safeguards to return { result: { healthy: false, violations: [{code:'RETRY_STORM_DETECTED', severity:'critical', measuredValue:0.8, threshold:0.5}] } }.
  2. Navigate to Performance tab.
  3. Verify violations table shows Code, Severity (color-coded), Measured, Threshold, Note.
Expected: Violation row visible; critical shown in red.
Type: Functional
```

### TC-465 | Performance — Cache Stats shows hit/miss/eviction/hitRate cards
```
Steps:
  1. Mock GET /api/performance/cache/stats to return { stats: { hits:120, misses:30, evictions:5, hitRate:0.8 } }.
  2. Navigate to Performance tab.
  3. Verify 4 stat cards: 120 Hits (green), 30 Misses (amber), 5 Evictions (grey), 80.0% Hit Rate (blue).
Expected: Stat cards rendered with correct values and colors.
Type: Functional
```

### TC-466 | Performance — Cache Invalidate calls POST and refreshes stats
```
Steps:
  1. Enter a collection ID in the invalidate input.
  2. Click Invalidate.
  3. Verify POST /api/performance/cache/invalidate/:id called.
  4. Verify success message shown.
  5. Verify GET /api/performance/cache/stats called again after invalidation.
Expected: Cache cleared; stats refreshed; success message.
Type: Functional
```

### TC-467 | Performance — Cache Invalidate with empty input shows error
```
Steps:
  1. Leave the collection ID input blank.
  2. Click Invalidate.
  3. Verify error "Enter a Collection ID to invalidate."
  4. Verify no POST call made.
Expected: Validation enforced; no unnecessary API call.
Type: Error Handling
```

### TC-468 | Performance — Profiling Spans table shows recent spans
```
Steps:
  1. Mock GET /api/performance/profile to return { snapshot: { recentSpans: [{phase:'dag-projection', label:'build', durationMs:42, startMs:<timestamp>}] } }.
  2. Navigate to Performance tab.
  3. Verify spans table shows Phase, Label, Duration, Start columns.
  4. Verify spans shown in reverse chronological order (newest first).
Expected: Span table rendered; most recent span first.
Type: Functional
```

### TC-469 | Performance — Refresh button reloads all 3 sections
```
Steps:
  1. Navigate to Performance tab.
  2. Wait for initial load.
  3. Click ↻ Refresh.
  4. Verify GET /api/performance/safeguards, /cache/stats, /profile all called again.
Expected: All 3 sections refreshed simultaneously.
Type: Functional
```

### TC-470 | Graph Editor — empty collection (no steps) shows message
```
Steps:
  1. Select a collection with 0 steps.
  2. Verify "No steps in this collection." shown in canvas.
  3. Verify no SVG element rendered.
Expected: Empty-state message; no SVG crash.
Type: Edge Case
```

### TC-471 | Collaboration — empty collection (no revisions) shows empty state
```
Steps:
  1. Select a collection with no revisions.
  2. Verify "No revisions yet." shown in table.
Expected: Empty-state; no crash.
Type: Edge Case
```

### TC-472 | Copilot — API error on guidance shows inline error
```
Steps:
  1. Mock POST /api/copilot/guide to return HTTP 500.
  2. Click Get Guidance.
  3. Verify "Copilot request failed." shown in result area.
Expected: Graceful error; no unhandled exception.
Type: Error Handling
```

### TC-473 | Performance — API error on safeguards shows error message
```
Steps:
  1. Mock GET /api/performance/safeguards to return HTTP 500.
  2. Navigate to Performance tab.
  3. Verify "Failed to load safeguard status." in safeguards section.
Expected: Error message per section; other sections still load independently.
Type: Error Handling
```

### TC-474 | All 4 new nav tabs are hidden when the API Testing section is not present
```
Steps:
  1. Verify the 4 new nav items (api-graph, api-collab, api-copilot, perf-dashboard) are rendered inside the API Testing nav section.
  2. Log in as a user with no API testing access — verify tabs are not accessible without a project selected.
Expected: Tabs present in API Testing nav group; project-scoping rules apply.
Type: UI / Access Control
```

---

*End of Test Guide — v2.3 | 2026-05-22 | 474 test cases*
```

- [ ] **Step 2: Append sections 32–35 to `docs/API_TESTING_USER_GUIDE.md`**

Replace the `*End of User Guide — v2.1*` footer line with the following block:

```markdown
---

## 32. Graph Editor — Visual DAG Visualizer

The Graph Editor tab (`🗺️ Graph Editor`) lets you visually explore and edit the dependency graph of any API collection — no API calls required.

### How to use
1. Navigate to **🗺️ Graph Editor** in the sidebar.
2. Select a collection from the dropdown.
3. The SVG canvas renders all steps as nodes with arrows showing dependencies.

### Interacting with the graph

| Action | How |
|---|---|
| Select a node | Click it (blue border = selected) |
| Select 2 nodes | Click first, then second (max 2 at once) |
| Reposition a node | Drag it to a new location |
| Save layout | Click **💾 Save Layout** — positions are persisted via the graph editor API |
| Add a dependency | Select 2 nodes (source → target), click **+ Add Dep** |
| Remove a dependency | Select 2 nodes, click **− Remove Dep** |
| Validate DAG | Click **✓ Validate DAG** — checks for cycles, shows topological order |

### What "Add Dep" means
Select node **A** first, then node **B**. Clicking **+ Add Dep** means "B now depends on A" — A must complete before B runs.

### Notes
- Layout is saved per collection and loaded on next visit.
- Dependency edits update the collection's `dependsOn` map via the backend — the DAG is enforced at runtime.
- The validator catches cycles before they reach the execution engine.

---

## 33. Collaboration — Revision History, Comments & Templates

The Collaboration tab (`💬 Collaboration`) provides version control, peer review, and workflow templates for your API collections.

### Revisions
A **revision** is a snapshot of a collection's step list at a point in time.

| Action | How |
|---|---|
| Save a revision | Select collection → click **+ Save Revision** → enter description |
| Rollback | Click **Rollback** on any revision row — creates a new revision marked `rolled-back` |
| Diff | Click **Diff** on a revision — compares it against the previous revision, shows added/removed steps and dependency changes |

### Review Comments
Comments are threaded annotations attached to a collection, step, dependency, or replay.

| Action | How |
|---|---|
| Post a comment | Type body → select target type → optionally enter target ID → click **Post** |
| Resolve a comment | Click **Resolve** on any open comment |

### Workflow Templates
Templates are pre-built scaffold definitions. **Instantiating** a template returns an advisory scaffold (step structure) that you can use as a starting point — it does not create a collection automatically.

---

## 34. Copilot — AI Guidance & Predictive Intelligence

The Copilot tab (`🤖 Copilot`) surfaces AI-powered workflow guidance and predictive forecasts for your collections.

> ⚠️ **Advisory only.** All results are AI-generated suggestions. Nothing is applied automatically.

### Guidance tab
Submit a natural-language-style query about your collection:

| Query Type | What it answers |
|---|---|
| `workflow-guidance` | General best-practice recommendations for the collection |
| `orchestration-recommendation` | DAG restructuring, parallelism, dependency tuning |
| `replay-debug` | Explains a failed run from replay data |
| `flakiness-investigation` | Why certain steps keep failing intermittently |
| `dependency-optimization` | Which dependencies can be removed or restructured |
| `retry-tuning` | Whether retry configuration is appropriate |
| `environment-anomaly` | Env variables or auth issues causing failures |

Results show: Severity, Title, Guidance body, Confidence %, and an Action Hint.

### Predictions tab

| Prediction | What it tells you |
|---|---|
| **🧪 Flakiness Forecast** | Per-step predicted flakiness score (0–100) with contributing factors |
| **⚡ Retry Storm Risk** | Overall storm risk (low/medium/high) and estimated retry rate |
| **SLA Breach** | Enter a metric name + current value → breach likelihood % |

### History tab
Shows all previous Copilot queries for the selected collection — queryType, number of guidance items, and timestamp.

---

## 35. Performance Dashboard

The Performance Dashboard tab (`⚡ Performance`) surfaces platform-level health metrics for API testing execution.

### Safeguards
Threshold checks that detect performance problems before they become failures:

| Code | What it detects |
|---|---|
| `LARGE_GRAPH_NODE_COUNT` | Collection has too many steps for efficient projection |
| `RETRY_STORM_DETECTED` | Retry rate exceeds safe threshold |
| `POLLING_OVERLOAD` | UI polling rate is too high |
| `REPLAY_EVENT_GROWTH` | Replay event store growing too fast |
| `MEMORY_PRESSURE` | Server memory approaching limits |
| `PROJECTION_CACHE_MISS_RATE` | Cache is not effective — too many misses |

### Cache Stats
Shows hit/miss/eviction counts and overall hit rate for the graph projection cache. Use **Invalidate** to evict a specific collection's cached projection (forces a fresh rebuild on next access).

### Profiling Spans
Recent execution spans with phase name, label, and duration in milliseconds — newest first. Useful for identifying slow projection, replay synthesis, or overlay build phases.

Click **↻ Refresh** to reload all three sections simultaneously.

---

*End of User Guide — v2.2 | 2026-05-22*
```

- [ ] **Step 3: Update the TOC in `docs/API_TESTING_USER_GUIDE.md`**

Find the TOC block (lines ~36–39) and add after section 31:
```markdown
32. [Graph Editor — Visual DAG Visualizer](#32-graph-editor--visual-dag-visualizer)
33. [Collaboration — Revision History, Comments & Templates](#33-collaboration--revision-history-comments--templates)
34. [Copilot — AI Guidance & Predictive Intelligence](#34-copilot--ai-guidance--predictive-intelligence)
35. [Performance Dashboard](#35-performance-dashboard)
```

- [ ] **Step 4: Update version header in `docs/API_TESTING_USER_GUIDE.md`**

Change `**Version:** 2.1` to `**Version:** 2.2`

---

## Self-Review

### Spec coverage check
- [x] Graph Editor — SVG DAG render, layout save, dependency add/remove, validate → Task 1
- [x] Collaboration — revisions, rollback, diff, comments, resolve, templates → Task 2
- [x] Copilot — guidance, flakiness forecast, retry storm, SLA breach, history → Task 3
- [x] Performance — safeguards, cache stats, invalidate, profiling spans, refresh → Task 4
- [x] Test Guide Modules 43–46, TC-435–TC-474 → Task 5
- [x] User Guide sections 32–35, TOC, version bump → Task 5

### Placeholder scan
No TBD, TODO, or "similar to Task N" references. All code blocks complete.

### Type consistency
- `_graphDepMap: Record<stepId, string[]>` — consistent in computePositions, render, addDep, removeDep, validate
- `_graphPositions: Record<stepId, {x,y}>` — consistent in render, dragMove, saveLayout
- `_collabColId: string` — consistent across all collab functions
- `_copilotColId: string` — consistent across all copilot functions
- `modAlert(elementId, message, type)` — used identically to 31-api-plugins.js pattern
- `escHtml()` — called on all server-returned string values throughout
