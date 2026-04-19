/* app.js — QA Agent Platform frontend  (P9: WebSocket live progress) */
'use strict';

// ── Global session-expiry interceptor ─────────────────────────────────────────
// Wraps window.fetch so any 401 SESSION_EXPIRED response from the API
// automatically redirects to /login with a reason message.
// All existing fetch() calls benefit without any changes to individual modules.
(function _patchFetch() {
  const _orig = window.fetch.bind(window);
  window.fetch = async function(...args) {
    const res = await _orig(...args);
    if (res.status === 401) {
      try {
        const clone = res.clone();
        const body  = await clone.json().catch(() => ({}));
        if (body.code === 'SESSION_EXPIRED') {
          window.location.href = '/login?reason=expired';
          // Return a never-resolving promise so callers don't continue processing
          return new Promise(() => {});
        }
      } catch {}
    }
    return res;
  };
})();

// ── State ─────────────────────────────────────────────────────────────────────
let currentPlan  = null;
let currentRunId = null;
let ws           = null;
let wsReady      = false;
let pollFallback = null;   // used only when WS is unavailable

// ── WebSocket connection ──────────────────────────────────────────────────────
// WS is optional — all core features use HTTP polling.
// If the proxy doesn't support WS upgrades (e.g. IIS without WS module),
// we give up after 4 rapid failures and stop spamming the console.

let _wsFailCount    = 0;
let _wsGaveUp       = false;
const WS_MAX_FAILS  = 4;

function connectWS() {
  if (_wsGaveUp) return;

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener('open', () => {
    wsReady      = true;
    _wsFailCount = 0;  // reset on successful connect
    setWsIndicator('connected');
    ws._pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25000);
  });

  ws.addEventListener('message', (e) => {
    try { handleWsMessage(JSON.parse(e.data)); } catch { /* skip */ }
  });

  ws.addEventListener('close', () => {
    wsReady = false;
    clearInterval(ws._pingTimer);

    _wsFailCount++;
    if (_wsFailCount >= WS_MAX_FAILS) {
      _wsGaveUp = true;
      setWsIndicator('http-only');
      return;  // stop reconnecting — HTTP polling handles everything
    }

    setWsIndicator('disconnected');
    setTimeout(connectWS, 3000);
  });

  ws.addEventListener('error', () => ws.close());
}

function setWsIndicator(state) {
  const dot  = document.getElementById('health-dot');
  const text = document.getElementById('health-text');
  if (state === 'connected') {
    dot.classList.add('ok');
    fetch('/api/health').then(r => r.json()).then(d => {
      text.textContent = d.jiraConfigured ? 'Jira connected' : 'UI running';
    }).catch(() => { text.textContent = 'UI running'; });
  } else if (state === 'http-only') {
    dot.classList.add('ok');
    text.textContent = 'UI running';
    // WS unavailable (proxy limitation) — HTTP polling handles all features
  } else {
    dot.classList.remove('ok');
    text.textContent = 'Reconnecting…';
  }
}

function handleWsMessage(msg) {
  // Route debug messages to the debugger module
  if (msg.type === 'debug:step' || msg.type === 'debug:done') {
    if (typeof debugHandleWsMsg === 'function') debugHandleWsMsg(msg);
    return;
  }

  if (!currentRunId || msg.runId !== currentRunId) return;

  switch (msg.type) {
    case 'run:output': appendLogLine(msg.line, msg.level); break;
    case 'run:test':   appendTestRow(msg);                  break;
    case 'run:stats':  updateStats(msg);                    break;
    case 'run:done':   handleRunDone(msg);                  break;
  }
}

// Subscribe / unsubscribe a channel (runId or sessionId) on the WS
function wsSubscribe(id) {
  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', runId: id }));
  }
}

function wsUnsubscribe(id) {
  if (wsReady && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'unsubscribe', runId: id }));
  }
}

// ── Tab navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item =>
  item.addEventListener('click', () => switchTab(item.dataset.tab))
);

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab}`));
  document.getElementById('topbar-title').textContent = {
    scripts: 'Test Script Builder', suites: 'Test Suite',
    execution: 'Execution',
    locators: 'Locator Repository', functions: 'Common Functions',
    commondata: 'Common Data', history: 'Execution History',
    flaky: 'Flaky Test Detection', analytics: 'Analytics Dashboard',
    projects: 'Projects', admin: 'Admin Panel',
  }[tab] ?? tab;
  if (tab === 'history')   histLoad();
  if (tab === 'flaky')     flakyLoad();
  if (tab === 'analytics') analyticsLoad();
  if (tab === 'execution') execLoad();
  hideRunPanel();
}

// ── Alerts ────────────────────────────────────────────────────────────────────
function showAlert(id, type, html) {
  const icons = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' };
  const el = document.getElementById(id);
  if (el) el.innerHTML = `<div class="alert ${type}"><span class="alert-icon">${icons[type]}</span><div>${html}</div></div>`;
}
function clearAlert(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────
['excel-dropzone'].forEach(id => {
  const zone = document.getElementById(id);
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files?.[0]; if (!file) return;
    const dt = new DataTransfer(); dt.items.add(file);
    document.getElementById('excel-file').files = dt.files;
    handleExcelFile({ files: dt.files });
  });
});

function handleExcelFile(input) {
  const f = input.files?.[0]; if (!f) return;
  document.getElementById('excel-file-name').textContent = `📎 ${f.name}`;
  document.getElementById('excel-run-btn').disabled = false;
  clearAlert('excel-alert');
}
// ── Excel upload ──────────────────────────────────────────────────────────────
async function uploadAndRunExcel() {
  const file = document.getElementById('excel-file').files?.[0];
  if (!file) { showAlert('excel-alert', 'error', 'Please select a file first'); return; }
  clearAlert('excel-alert');
  showAlert('excel-alert', 'info', '<span class="spinner dark"></span>&nbsp; Parsing test cases…');
  document.getElementById('excel-run-btn').disabled = true;
  const fd = new FormData(); fd.append('file', file);
  try {
    const res = await fetch('/api/plan/excel', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    clearAlert('excel-alert');
    currentPlan = data;
    showPlanPreview('excel-result', data, 'excel');
    showRunPanel(data, `Excel: ${file.name}`);
  } catch (err) {
    showAlert('excel-alert', 'error', err.message);
    document.getElementById('excel-run-btn').disabled = false;
  }
}


// ── Plan preview ──────────────────────────────────────────────────────────────
function showPlanPreview(containerId, data, sourceType) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const sourceLabel = { excel: 'Excel', jira: 'Jira', 'prd-upload': 'PRD Upload' }[data.source] ?? data.source;
  const skeletonNote = data.isAISkeleton
    ? `<div class="alert warning"><span class="alert-icon">🤖</span><div>This is an <strong>AI skeleton plan</strong>. Your AI IDE generates detailed steps during execution.</div></div>` : '';
  const warnings = (data.warnings ?? []).map(w => `<div class="alert warning"><span class="alert-icon">⚠️</span><div>${w}</div></div>`).join('');
  const rows = (data.testCases ?? []).map(tc => `
    <tr>
      <td><strong>${tc.id}</strong></td>
      <td>${tc.title}</td>
      <td><span class="source-badge ${sourceType}">${tc.module}</span></td>
      <td><span class="priority ${tc.priority}">${tc.priority}</span></td>
      <td>${tc.steps}</td>
    </tr>`).join('');
  container.style.display = 'block';
  container.innerHTML = `
    <div class="card">
      <div class="card-title">Plan Generated <span class="badge">${data.testCases.length} TEST CASE${data.testCases.length !== 1 ? 'S' : ''}</span></div>
      ${skeletonNote}${warnings}
      <div style="font-size:12px;color:var(--neutral-400);margin-bottom:10px">
        Plan ID: <code>${data.planId}</code> &nbsp;·&nbsp; Source: <strong>${sourceLabel}</strong> — ${data.sourceRef}
      </div>
      <div class="tc-table-wrap">
        <table class="tc-table">
          <thead><tr><th>TC ID</th><th>Title</th><th>Module</th><th>Priority</th><th>Steps</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Run panel ─────────────────────────────────────────────────────────────────
function showRunPanel(data, title) {
  document.getElementById('run-panel-title').textContent = title;
  document.getElementById('run-output-card').style.display = 'none';
  document.getElementById('run-done-actions').style.display = 'none';
  document.getElementById('run-panel').style.display = 'block';
  document.getElementById('run-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function hideRunPanel() {
  document.getElementById('run-panel').style.display = 'none';
}

// ── Trigger run ───────────────────────────────────────────────────────────────
async function triggerRun() {
  if (!currentPlan) return;
  const btn = document.getElementById('btn-run-tests');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>&nbsp; Starting…';

  try {
    const headed = document.getElementById('chk-headed')?.checked ?? true;
    const res  = await fetch('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planPath: currentPlan.planPath, planId: currentPlan.planId, headed }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    currentRunId = data.runId;
    resetRunOutput(data.runId);

    // Subscribe via WebSocket (preferred)
    if (wsReady) {
      ws.send(JSON.stringify({ type: 'subscribe', runId: data.runId }));
    } else {
      // Polling fallback if WS not available
      startPollingFallback(data.runId);
    }
  } catch (err) {
    alert('Failed to start run: ' + err.message);
    btn.disabled = false;
    btn.innerHTML = runBtnHtml();
  }
}

function runBtnHtml() {
  return '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Tests';
}

// ── Output panel ──────────────────────────────────────────────────────────────
function resetRunOutput(runId) {
  document.getElementById('run-output-card').style.display = 'block';
  document.getElementById('run-done-actions').style.display = 'none';
  document.getElementById('run-id-label').textContent = `Run ID: ${runId}`;
  document.getElementById('run-status-badge').className = 'status running';
  document.getElementById('run-status-badge').textContent = 'Running…';
  document.getElementById('rt-total').textContent = '—';
  document.getElementById('rt-pass').textContent  = '0';
  document.getElementById('rt-fail').textContent  = '0';
  document.getElementById('run-log').innerHTML = '';
  document.getElementById('progress-bar-fill').style.width = '0%';
  document.getElementById('progress-label').textContent = '';
  document.getElementById('test-rows').innerHTML = '';
}

// ── Live log ──────────────────────────────────────────────────────────────────
function appendLogLine(line, level) {
  const logBox = document.getElementById('run-log');
  const div    = document.createElement('div');
  div.className = { pass: 'log-pass', fail: 'log-fail', warn: 'log-warn', info: 'log-info' }[level] ?? '';
  div.textContent = line;
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

// ── Live test result rows ─────────────────────────────────────────────────────
function appendTestRow(msg) {
  const tbody = document.getElementById('test-rows');
  // Check if row already exists (update in place)
  let row = document.getElementById(`tr-${CSS.escape(msg.name)}`);
  if (!row) {
    row = document.createElement('tr');
    row.id = `tr-${CSS.escape(msg.name)}`;
    tbody.appendChild(row);
  }
  const dur = msg.durationMs != null ? formatDuration(msg.durationMs) : '…';
  const icon = msg.status === 'pass' ? '✔' : msg.status === 'fail' ? '✗' : '⟳';
  const cls  = msg.status === 'pass' ? 'log-pass' : msg.status === 'fail' ? 'log-fail' : '';
  row.innerHTML = `
    <td style="width:28px;font-size:14px" class="${cls}">${icon}</td>
    <td style="font-size:12.5px">${escapeHtml(msg.name)}</td>
    <td style="width:70px;text-align:right;font-size:12px;color:var(--neutral-400)">${dur}</td>`;
  row.className = msg.status === 'pass' ? 'tr-pass' : msg.status === 'fail' ? 'tr-fail' : '';
}

// ── Stats + progress bar ──────────────────────────────────────────────────────
function updateStats(msg) {
  document.getElementById('rt-total').textContent = msg.total || '—';
  document.getElementById('rt-pass').textContent  = msg.passed;
  document.getElementById('rt-fail').textContent  = msg.failed;

  if (msg.total > 0) {
    const pct = Math.round((msg.completed / msg.total) * 100);
    document.getElementById('progress-bar-fill').style.width = pct + '%';
    document.getElementById('progress-label').textContent = `${msg.completed} / ${msg.total}`;
  }
}

// ── Run done ──────────────────────────────────────────────────────────────────
function handleRunDone(msg) {
  if (pollFallback) { clearInterval(pollFallback); pollFallback = null; }

  const badge = document.getElementById('run-status-badge');
  badge.className = `status ${msg.failed > 0 ? 'failed' : 'done'}`;
  badge.textContent = msg.failed > 0 ? 'Failed' : 'Completed';

  document.getElementById('rt-total').textContent = msg.total;
  document.getElementById('rt-pass').textContent  = msg.passed;
  document.getElementById('rt-fail').textContent  = msg.failed;

  // Fill progress bar to 100%
  document.getElementById('progress-bar-fill').style.width = '100%';
  document.getElementById('progress-label').textContent = `${msg.total} / ${msg.total}`;

  document.getElementById('run-done-actions').style.display = 'flex';
  document.getElementById('btn-view-report').href = `/api/report/${msg.runId ?? currentRunId}`;

  const btn = document.getElementById('btn-run-tests');
  btn.disabled = false;
  btn.innerHTML = runBtnHtml();

}

// ── Polling fallback (when WS unavailable) ────────────────────────────────────
let _lastOutputLen = 0;
function startPollingFallback(runId) {
  _lastOutputLen = 0;
  if (pollFallback) clearInterval(pollFallback);
  pollFallback = setInterval(() => pollOnce(runId), 1500);
  pollOnce(runId);
}

async function pollOnce(runId) {
  try {
    const r = await fetch(`/api/run/${runId}`);
    const d = await r.json();
    if (!r.ok) return;
    updateStats({ passed: d.passed, failed: d.failed, total: d.total, completed: d.passed + d.failed });
    const newLines = d.output.slice(_lastOutputLen);
    _lastOutputLen = d.output.length;
    for (const line of newLines) appendLogLine(line, classifyLineFront(line));
    if (d.status !== 'running') { handleRunDone(d); }
  } catch { /* silent */ }
}

function classifyLineFront(line) {
  if (/✓|✔/.test(line)) return 'pass';
  if (/✗|✘|×|Error/.test(line)) return 'fail';
  if (/warn/i.test(line)) return 'warn';
  return 'info';
}


function copyAiInstruction() {
  if (!currentPlan) return;
  const text = `Run the test plan at: ${currentPlan.planPath}\nPlan ID: ${currentPlan.planId}\nSource: ${currentPlan.source} (${currentPlan.sourceRef})\nTest cases: ${currentPlan.testCases?.length ?? 0}`;
  navigator.clipboard.writeText(text).then(() => showToast('AI instruction copied!'));
}


// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function showToast(msg) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:10px 20px;border-radius:99px;font-size:13px;font-weight:600;z-index:9999;opacity:0;transition:opacity .2s';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  setTimeout(() => { t.style.opacity = '0'; }, 2000);
}
function downloadTemplate() { window.location.href = '/requirements/TC_Template.xlsx'; }

// ══════════════════════════════════════════════════════════════════════════════
// TC BUILDER  (v2 — inline field map per step)
// ══════════════════════════════════════════════════════════════════════════════

// ── Builder state ─────────────────────────────────────────────────────────────
let bKeywords      = {};
let bEditingPlanId = null;
let bSavedTCs      = [];

// Keywords with NO extra inputs
const NO_DETAIL_KWS  = new Set(['LOGIN','OPEN FORM','ADD ROW','SAVE','BACK','SEARCH','DELETE','CONFIRM DELETE','VERIFY DELETED','LOGOUT','SCREENSHOT']);
// Keywords that expand into field-mode (label + selector + type + value)
const FIELD_MODE_KWS = new Set(['FILL','SELECT','CHECK','UNCHECK','CLICK RADIO']);

// ── Init ─────────────────────────────────────────────────────────────────────
async function builderInit() {
  try { const r = await fetch('/api/keywords'); bKeywords = await r.json(); } catch { bKeywords = {}; }
  await builderLoadTCList();
}

async function builderLoadTCList() {
  try { const r = await fetch('/api/tc/list'); bSavedTCs = await r.json(); } catch { bSavedTCs = []; }
  builderRenderTCList();
}

function builderRenderTCList() {
  const listEl  = document.getElementById('tc-list-items');
  const emptyEl = document.getElementById('tc-list-empty');
  if (!bSavedTCs.length) { emptyEl.style.display = ''; listEl.innerHTML = ''; return; }
  emptyEl.style.display = 'none';
  listEl.innerHTML = bSavedTCs.map(plan =>
    (plan.testCases ?? []).map(tc => `
      <div class="tc-item-card" onclick="builderEditTC('${plan.planId}')">
        <span class="tc-item-id">${escapeHtml(tc.id)}</span>
        <span class="tc-item-title">${escapeHtml(tc.title)}</span>
        <span class="tc-item-module">${escapeHtml(tc.module)}</span>
        <div class="tc-item-actions" onclick="event.stopPropagation()">
          <button class="btn btn-outline btn-sm" onclick="builderEditTC('${plan.planId}')">Edit</button>
          <button class="step-btn del" onclick="builderDeleteTC('${plan.planId}','${tc.id}')">🗑</button>
        </div>
      </div>`).join('')
  ).join('');
}

// ── New / Edit ────────────────────────────────────────────────────────────────
function builderNewTC() {
  bEditingPlanId = null;
  builderResetForm();
  document.getElementById('builder-form-wrap').style.display = '';
  document.getElementById('builder-form-wrap').scrollIntoView({ behavior: 'smooth' });
  builderUpdatePreview();
}

async function builderEditTC(planId) {
  try {
    const res = await fetch(`/api/tc/${planId}`);
    if (!res.ok) throw new Error('Not found');
    const plan = await res.json();
    const tc   = plan.testCases?.[0];
    if (!tc) return;

    bEditingPlanId = planId;
    builderResetForm();

    document.getElementById('b-tc-id').value         = tc.id               ?? '';
    document.getElementById('b-priority').value      = tc.priority          ?? 'medium';
    document.getElementById('b-module').value        = tc.module            ?? '';
    document.getElementById('b-title').value         = tc.title             ?? '';
    document.getElementById('b-preconditions').value = tc.preconditions     ?? '';
    document.getElementById('b-expected').value      = tc.expectedResult    ?? '';
    document.getElementById('b-tags').value          = (tc.tags ?? []).join(',');
    document.getElementById('b-app-url').value       = plan.appBaseURL      ?? '';
    document.getElementById('b-username').value      = tc.testData?.Username       ?? '';
    document.getElementById('b-password').value      = tc.testData?.Password       ?? '';
    document.getElementById('b-record-name').value   = tc.testData?.['Record Name'] ?? '';

    // Rebuild steps from saved plan — steps carry inline field data
    document.getElementById('steps-container').innerHTML = '';
    document.getElementById('steps-empty').style.display = 'none';
    for (const s of (tc.steps ?? [])) {
      // Parse modifier + keyword from description
      const desc = s.description ?? '';
      const modM = desc.match(/^\[(\w+)\]\s*/);
      const mod  = modM ? `[${modM[1]}]` : '';
      const rest = mod ? desc.slice(modM[0].length) : desc;
      const ci   = rest.indexOf(': ');
      const kw   = (ci >= 0 ? rest.slice(0, ci) : rest).trim();
      const det  = ci >= 0 ? rest.slice(ci + 2).trim() : '';
      builderAddStep(mod, kw, {
        label:     s.fieldLabel   ?? det,
        selector:  s.selector     ?? '',
        fieldType: s.fieldType    ?? 'TEXT',
        value:     tc.testData?.[s.fieldLabel ?? det] ?? '',
        detail:    det,
      });
    }

    document.getElementById('builder-form-wrap').style.display = '';
    document.getElementById('builder-form-wrap').scrollIntoView({ behavior: 'smooth' });
    builderUpdatePreview();
  } catch (err) { showToast('Could not load TC: ' + err.message); }
}

async function builderDeleteTC(planId, tcId) {
  if (!confirm(`Delete ${tcId}?`)) return;
  await fetch(`/api/tc/${planId}`, { method: 'DELETE' });
  await builderLoadTCList();
  if (bEditingPlanId === planId) builderCancelEdit();
}

function builderCancelEdit() {
  document.getElementById('builder-form-wrap').style.display = 'none';
  bEditingPlanId = null;
}

function builderResetForm() {
  ['b-tc-id','b-module','b-title','b-preconditions','b-expected',
   'b-tags','b-app-url','b-username','b-password','b-record-name'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('b-priority').value = 'medium';
  document.getElementById('steps-container').innerHTML = '';
  document.getElementById('steps-empty').style.display = '';
  clearAlert('builder-alert');
}

// ── Steps ─────────────────────────────────────────────────────────────────────
// opts: { label, selector, fieldType, value, detail } for field-mode steps
function builderAddStep(modifier = '', keyword = 'NAVIGATE', opts = {}) {
  const container = document.getElementById('steps-container');
  document.getElementById('steps-empty').style.display = 'none';

  const row = document.createElement('div');
  row.className = 'step-row';

  // ── num badge ──
  const num = document.createElement('span');
  num.className = 'step-num';
  num.textContent = container.children.length + 1;

  // ── modifier select ──
  const modSel = document.createElement('select');
  modSel.className = 'step-modifier';
  [['','—'],['[SKIP]','SKIP'],['[OPTIONAL]','OPT']].forEach(([v,l]) => {
    const o = new Option(l, v); if (v === modifier) o.selected = true;
    modSel.appendChild(o);
  });

  // ── keyword select ──
  const kwSel = document.createElement('select');
  kwSel.className = 'step-keyword';
  for (const [grp, kws] of Object.entries(bKeywords)) {
    const og = document.createElement('optgroup'); og.label = grp;
    kws.forEach(kw => { const o = new Option(kw,kw); if(kw===keyword) o.selected=true; og.appendChild(o); });
    kwSel.appendChild(og);
  }
  if (!Object.keys(bKeywords).length) {
    const o = new Option(keyword, keyword); o.selected = true; kwSel.appendChild(o);
  }

  // ── content area (swapped by keyword) ──
  const content = document.createElement('div');
  content.className = 'step-content';

  // ── controls ──
  const controls = document.createElement('div');
  controls.className = 'step-controls';
  controls.innerHTML = `
    <button class="step-btn" onclick="builderMoveStep(this,-1)" title="Up">↑</button>
    <button class="step-btn" onclick="builderMoveStep(this,1)"  title="Down">↓</button>
    <button class="step-btn del" onclick="builderRemoveStep(this)" title="Remove">✕</button>`;

  row.appendChild(num);
  row.appendChild(modSel);
  row.appendChild(kwSel);
  row.appendChild(content);
  row.appendChild(controls);
  container.appendChild(row);

  // Set initial content based on keyword
  builderRenderStepContent(row, keyword, opts);

  // On keyword change → re-render content, preserve values
  kwSel.addEventListener('change', () => {
    builderRenderStepContent(row, kwSel.value, {});
    builderUpdatePreview();
    if (typeof injectLocatorPickerBtn === 'function') injectLocatorPickerBtn(row);
  });
  modSel.addEventListener('change', () => builderUpdatePreview());

  builderRenumberSteps();
  builderUpdatePreview();

  // Inject locator picker button if modules.js is loaded
  if (typeof injectLocatorPickerBtn === 'function') injectLocatorPickerBtn(row);
}

function builderRenderStepContent(row, kw, opts = {}) {
  const content = row.querySelector('.step-content');

  if (NO_DETAIL_KWS.has(kw)) {
    content.innerHTML = `<span class="step-no-detail">—</span>`;

  } else if (FIELD_MODE_KWS.has(kw)) {
    // Inline: UI Label | DOM Selector | Type | Value
    content.innerHTML = `
      <div class="step-field-grid">
        <input class="fm-input step-label"    placeholder="UI Label (e.g. Gateway Type)"
               value="${escapeHtml(opts.label ?? opts.detail ?? '')}" oninput="builderUpdatePreview()" />
        <input class="fm-input step-selector" placeholder="DOM Selector (e.g. #GateWayType)"
               value="${escapeHtml(opts.selector ?? '')}" />
        <select class="fm-select step-fieldtype">
          ${['TEXT','SELECT','CHECK','RADIO','FILE'].map(t =>
            `<option value="${t}" ${(opts.fieldType ?? 'TEXT') === t ? 'selected':''}>${t}</option>`
          ).join('')}
        </select>
        <input class="fm-input step-value" placeholder="value or {{random.alphanumeric(8)}}"
               value="${escapeHtml(opts.value ?? '')}" list="rand-tokens" />
      </div>`;

  } else {
    // Action mode: single detail input
    const ph = kw === 'NAVIGATE' ? 'Menu > SubMenu > Page  (e.g. Mediation Configuration > Gateway Type Configuration)'
             : kw === 'VERIFY'   ? 'assertion text or selector'
             : 'detail…';
    content.innerHTML = `
      <input class="step-detail" placeholder="${ph}"
             value="${escapeHtml(opts.detail ?? opts.label ?? '')}" oninput="builderUpdatePreview()" />`;
  }
}

function builderRemoveStep(btn) {
  btn.closest('.step-row').remove();
  const c = document.getElementById('steps-container');
  if (!c.children.length) document.getElementById('steps-empty').style.display = '';
  builderRenumberSteps(); builderUpdatePreview();
}

function builderMoveStep(btn, dir) {
  const row = btn.closest('.step-row');
  const c   = row.parentNode;
  if (dir === -1 && row.previousElementSibling) c.insertBefore(row, row.previousElementSibling);
  else if (dir === 1 && row.nextElementSibling)  c.insertBefore(row.nextElementSibling, row);
  builderRenumberSteps(); builderUpdatePreview();
}

function builderRenumberSteps() {
  document.querySelectorAll('#steps-container .step-row').forEach((r, i) => {
    const b = r.querySelector('.step-num'); if (b) b.textContent = i + 1;
  });
}

// ── Preview ───────────────────────────────────────────────────────────────────
function builderUpdatePreview() {
  const id    = document.getElementById('b-tc-id')?.value  ?? '';
  const title = document.getElementById('b-title')?.value  ?? '';
  const list  = document.getElementById('step-preview-list');
  if (!list) return;

  const rows = [...document.querySelectorAll('#steps-container .step-row')];
  if (!rows.length) { list.innerHTML = `<span class="builder-hint">Steps will appear here.</span>`; return; }

  list.innerHTML = [
    (id || title) ? `<div style="font-size:12px;font-weight:700;color:var(--neutral-700);margin-bottom:8px">${escapeHtml(id)} — ${escapeHtml(title)}</div>` : '',
    ...rows.map((row, i) => {
      const mod   = row.querySelector('.step-modifier')?.value ?? '';
      const kw    = row.querySelector('.step-keyword')?.value  ?? '';
      const label = row.querySelector('.step-label')?.value    ?? '';
      const det   = row.querySelector('.step-detail')?.value   ?? '';
      const val   = row.querySelector('.step-value')?.value    ?? '';
      const disp  = FIELD_MODE_KWS.has(kw) ? (label ? `: ${label}` + (val ? ` = "${val}"` : '') : '') : (det ? `: ${det}` : '');
      return `
        <div class="step-preview-item">
          <span class="step-preview-num">${i+1}</span>
          <span>
            ${mod ? `<span class="step-preview-kw modifier">${escapeHtml(mod)} </span>` : ''}
            <span class="step-preview-kw">${escapeHtml(kw)}</span>
            <span class="step-preview-detail">${escapeHtml(disp)}</span>
          </span>
        </div>`;
    }),
  ].join('');
}

// ── Collect → payload ─────────────────────────────────────────────────────────
function builderCollectForm() {
  const steps    = [];
  const testData = {};

  document.querySelectorAll('#steps-container .step-row').forEach(row => {
    const mod      = row.querySelector('.step-modifier')?.value ?? '';
    const kw       = row.querySelector('.step-keyword')?.value  ?? '';
    const label    = row.querySelector('.step-label')?.value    ?? '';
    const selector = row.querySelector('.step-selector')?.value ?? '';
    const ftype    = row.querySelector('.step-fieldtype')?.value ?? 'TEXT';
    const value    = row.querySelector('.step-value')?.value    ?? '';
    const detail   = row.querySelector('.step-detail')?.value   ?? '';

    if (FIELD_MODE_KWS.has(kw) && label) testData[label] = value;

    steps.push({ modifier: mod, keyword: kw, label, selector, fieldType: ftype, value, detail });
  });

  return {
    tc: {
      id:             document.getElementById('b-tc-id').value.trim(),
      module:         document.getElementById('b-module').value.trim(),
      title:          document.getElementById('b-title').value.trim(),
      priority:       document.getElementById('b-priority').value,
      preconditions:  document.getElementById('b-preconditions').value.trim(),
      expectedResult: document.getElementById('b-expected').value.trim(),
      tags:           document.getElementById('b-tags').value.trim(),
      appURL:         document.getElementById('b-app-url').value.trim(),
      username:       document.getElementById('b-username').value.trim(),
      password:       document.getElementById('b-password').value.trim(),
      recordName:     document.getElementById('b-record-name').value.trim(),
      steps,
      testData,
    },
    fieldMap: [],   // field map is now embedded per step; kept empty for compat
  };
}

// ── Validate ──────────────────────────────────────────────────────────────────
function builderValidate({ tc }) {
  if (!tc.id)     return 'TC ID is required';
  if (!tc.module) return 'Module is required';
  if (!tc.title)  return 'Title is required';
  if (!tc.appURL) return 'App URL is required';
  if (!document.querySelectorAll('#steps-container .step-row').length) return 'At least one step is required';
  return null;
}

// ── Save ──────────────────────────────────────────────────────────────────────
async function builderSaveTC() {
  const payload = builderCollectForm();
  const err = builderValidate(payload);
  if (err) { showAlert('builder-alert', 'error', err); return null; }

  clearAlert('builder-alert');
  showAlert('builder-alert', 'info', '<span class="spinner dark"></span>&nbsp; Saving…');
  try {
    const res  = await fetch('/api/tc/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    bEditingPlanId = data.planId;
    await builderLoadTCList();
    showAlert('builder-alert', 'success', `✅ Saved — <code>${data.planId}</code>`);
    return data;
  } catch (err) { showAlert('builder-alert', 'error', err.message); return null; }
}

async function builderSaveAndRun() {
  const saved = await builderSaveTC();
  if (!saved) return;
  clearAlert('builder-alert');
  currentPlan = saved;
  showRunPanel(saved, `Builder: ${saved.testCases?.[0]?.id ?? ''}`);
  await triggerRun();
}

// ── Module change: auto-load saved field map into step selectors ──────────────
let _modDebounce = null;
function onModuleChange(val) {
  builderUpdatePreview();
  clearTimeout(_modDebounce);
  _modDebounce = setTimeout(async () => {
    if (!val.trim()) return;
    const safe = val.trim().replace(/[^a-zA-Z0-9\-]/g, '_');
    try {
      const res = await fetch(`/api/fieldmap/${encodeURIComponent(safe)}`);
      const fm  = await res.json();
      if (Array.isArray(fm) && fm.length) showToast(`Found ${fm.length} saved field map entries for this module`);
    } catch { /* ignore */ }
  }, 700);
}

// ── Tab hook ──────────────────────────────────────────────────────────────────
const _origSwitchTab = switchTab;
let _builderInited = false;
switchTab = function(tab) {
  _origSwitchTab(tab);
  if (tab === 'builder' && !_builderInited) { _builderInited = true; builderInit(); }
};

// ── Init ──────────────────────────────────────────────────────────────────────

// Environment badge — fetch /api/env and show DEV/PROD label in topbar
(async function _initEnvBadge() {
  try {
    const res  = await fetch('/api/env');
    if (!res.ok) return;
    const data = await res.json();
    const badge = document.getElementById('env-badge');
    if (!badge) return;
    const label = (data.label || 'PROD').toUpperCase();
    badge.textContent = label;
    badge.className   = `env-badge ${label === 'DEV' ? 'env-dev' : 'env-prod'}`;
    badge.style.display = '';
  } catch { /* silently ignore — badge stays hidden */ }
})();

connectWS();

// P1-09: Check license status on app load (admin session only)
(async function _licBannerInit() {
  try {
    const me = await fetch('/api/auth/me');
    if (!me.ok) return;
    const { role } = await me.json();
    if (role === 'admin') licenseCheckBanner();
  } catch { /* silently ignore */ }
})();

// P3-08: Apply white-label branding from /api/branding (Enterprise .lic only)
(async function _applyBranding() {
  try {
    const res = await fetch('/api/branding');
    if (!res.ok) return;
    const { appName, logoUrl, primaryColor } = await res.json();
    if (appName && appName !== 'QA Agent Platform') {
      document.title = appName;
      const nameEl = document.getElementById('nav-app-name');
      if (nameEl) nameEl.textContent = appName;
    }
    if (logoUrl) {
      const logoEl = document.createElement('img');
      logoEl.src   = logoUrl;
      logoEl.style.cssText = 'height:28px;margin-right:8px;vertical-align:middle';
      const nameEl = document.getElementById('nav-app-name');
      if (nameEl) nameEl.prepend(logoEl);
    }
    if (primaryColor && /^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
      document.documentElement.style.setProperty('--primary', primaryColor);
    }
  } catch { /* silently ignore */ }
})();
