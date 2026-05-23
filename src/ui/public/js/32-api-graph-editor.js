// ══════════════════════════════════════════════════════════════════════════════
// GRAPH EDITOR MODULE — SVG DAG visualizer with drag, dep edit, layout save
// ══════════════════════════════════════════════════════════════════════════════

let _graphColId = '';
let _graphSteps = [];
let _graphDepMap = {}; // stepId → string[] (dependsOn)
let _graphPositions = {}; // stepId → {x, y}
let _graphSelected = []; // max 2 stepIds
let _graphDragging = null; // {stepId, startX, startY, origX, origY}
let _graphZoom = 1.0;
const _ZOOM_MIN = 0.3, _ZOOM_MAX = 3.0, _ZOOM_STEP = 0.2;

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
  _graphZoom = 1.0;
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
  const countEl = document.getElementById('graph-node-count');
  if (countEl) {
    const edgeCount = Object.values(_graphDepMap).reduce((s, deps) => s + deps.length, 0);
    countEl.textContent = _graphSteps.length + ' nodes · ' + edgeCount + ' edges';
  }
  if (!_graphSteps.length) {
    canvas.innerHTML = '<div style="color:var(--text-muted)">No steps in this collection.</div>';
    return;
  }

  const xs = Object.values(_graphPositions).map(p => p.x + _GN_W);
  const ys = Object.values(_graphPositions).map(p => p.y + _GN_H);
  const svgW = Math.max(...xs) + _GN_PAD;
  const svgH = Math.max(...ys) + _GN_PAD;

  const zoomLbl = document.getElementById('graph-zoom-label');
  if (zoomLbl) zoomLbl.textContent = Math.round(_graphZoom * 100) + '%';
  let svg = `<svg id="graph-svg" width="${svgW}" height="${svgH}" style="cursor:default;user-select:none;display:block;transform:scale(${_graphZoom});transform-origin:top left"
    onmouseup="_graphDragEnd(event)" onmousemove="_graphDragMove(event)" onmouseleave="_graphDragEnd(event)">
    <defs>
      <marker id="arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
        <path d="M0,0 L0,6 L8,3 z" fill="#9ca3af"/>
      </marker>
    </defs>`;

  _graphSteps.forEach(s => {
    (_graphDepMap[s.stepId] || []).forEach(depId => {
      const fr = _graphPositions[depId], to = _graphPositions[s.stepId];
      if (!fr || !to) return;
      svg += `<line x1="${fr.x + _GN_W}" y1="${fr.y + _GN_H / 2}" x2="${to.x - 2}" y2="${to.y + _GN_H / 2}"
        stroke="#9ca3af" stroke-width="1.5" marker-end="url(#arr)"/>`;
    });
  });

  _graphSteps.forEach(s => {
    const p = _graphPositions[s.stepId];
    if (!p) return;
    const isSel = _graphSelected.includes(s.stepId);
    const label = (s.name || s.stepId || '').substring(0, 22);
    svg += `<g onmousedown="_graphDragStart(event,'${escHtml(s.stepId)}')" onclick="_graphNodeClick(event,'${escHtml(s.stepId)}')" style="cursor:pointer">
      <rect x="${p.x}" y="${p.y}" width="${_GN_W}" height="${_GN_H}" rx="6"
        fill="var(--bg)" stroke="${isSel ? '#3b82f6' : '#d1d5db'}" stroke-width="${isSel ? 2 : 1}"
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
  const pos = _graphPositions[stepId];
  if (!pos) return;
  const rect = svg.getBoundingClientRect();
  _graphDragging = { stepId, startX: event.clientX - rect.left, startY: event.clientY - rect.top,
    origX: pos.x, origY: pos.y };
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
  modAlert('graph-editor-msg', res.ok ? 'success' : 'error', res.ok ? 'Layout saved.' : 'Failed to save layout.');
}

async function graphEditorValidate() {
  if (!_graphColId || !_graphSteps.length) { modAlert('graph-editor-msg', 'error', 'Select a collection first.'); return; }
  const res = await fetch('/api/graph-editor/' + encodeURIComponent(_graphColId) + '/validate-dag', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: _graphSteps.map(s => s.stepId), dependsOn: _graphDepMap })
  });
  if (!res.ok) { modAlert('graph-editor-msg', 'error', 'Validation request failed.'); return; }
  const result = await res.json();
  if (result.valid) {
    const order = (result.topologicalOrder || []).join(' → ');
    modAlert('graph-editor-msg', 'success', '✓ DAG is valid.' + (order ? ' Order: ' + order : ''));
  } else {
    const msgs = (result.violations || []).map(v => `${v.type}${v.fromStepId ? ': ' + v.fromStepId + '→' + v.toStepId : ''}`).join('; ');
    modAlert('graph-editor-msg', 'error', '⚠️ Violations: ' + msgs);
  }
}

async function graphEditorAddDep() {
  if (_graphSelected.length !== 2) { modAlert('graph-editor-msg', 'error', 'Select exactly 2 nodes first.'); return; }
  const [fromId, toId] = _graphSelected;
  const currentDependsOn = {};
  _graphSteps.forEach(s => { currentDependsOn[s.stepId] = _graphDepMap[s.stepId] || []; });
  const res = await fetch('/api/graph-editor/' + encodeURIComponent(_graphColId) + '/dependency', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: _graphSteps.map(s => s.stepId), currentDependsOn, fromStepId: fromId, toStepId: toId, operation: 'add' })
  });
  if (!res.ok) { modAlert('graph-editor-msg', 'error', 'Failed to add dependency.'); return; }
  const result = await res.json();
  if (!result.success) {
    const msgs = (result.violations || []).map(v => v.message || v.type).join('; ');
    modAlert('graph-editor-msg', 'error', 'Cannot add dependency: ' + (msgs || result.error || 'unknown'));
    return;
  }
  if (result.updatedDependsOn) _graphDepMap = result.updatedDependsOn;
  _graphSelected = [];
  _graphRender();
  modAlert('graph-editor-msg', 'success', 'Dependency added.');
}

async function graphEditorRemoveDep() {
  if (_graphSelected.length !== 2) { modAlert('graph-editor-msg', 'error', 'Select exactly 2 nodes first.'); return; }
  const [fromId, toId] = _graphSelected;
  const currentDependsOn = {};
  _graphSteps.forEach(s => { currentDependsOn[s.stepId] = _graphDepMap[s.stepId] || []; });
  const res = await fetch('/api/graph-editor/' + encodeURIComponent(_graphColId) + '/dependency', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nodeIds: _graphSteps.map(s => s.stepId), currentDependsOn, fromStepId: fromId, toStepId: toId, operation: 'remove' })
  });
  if (!res.ok) { modAlert('graph-editor-msg', 'error', 'Failed to remove dependency.'); return; }
  const result = await res.json();
  if (result.updatedDependsOn) _graphDepMap = result.updatedDependsOn;
  _graphSelected = [];
  _graphRender();
  modAlert('graph-editor-msg', 'success', 'Dependency removed.');
}

function graphEditorZoomIn()    { _graphZoom = Math.min(_ZOOM_MAX, +(_graphZoom + _ZOOM_STEP).toFixed(1)); _graphRender(); }
function graphEditorZoomOut()   { _graphZoom = Math.max(_ZOOM_MIN, +(_graphZoom - _ZOOM_STEP).toFixed(1)); _graphRender(); }
function graphEditorZoomReset() { _graphZoom = 1.0; _graphRender(); }
