// ══════════════════════════════════════════════════════════════════════════════
// Scheduled Runs
// ══════════════════════════════════════════════════════════════════════════════

const CRON_PRESETS = {
  '0 9 * * *': 'Daily at 9am',
  '0 0 * * *': 'Nightly at midnight',
  '0 9 * * 1-5': 'Weekdays at 9am',
  '0 */4 * * *': 'Every 4 hours',
  '0 * * * *': 'Every hour',
};

function schedPresetLabel(expr) {
  return CRON_PRESETS[expr] || expr;
}

function schedPresetChange() {
  const preset = document.getElementById('sched-preset')?.value;
  const wrap = document.getElementById('sched-custom-wrap');
  if (wrap) wrap.style.display = preset === 'custom' ? '' : 'none';
}

function schedFormHide() {
  const f = document.getElementById('sched-form');
  if (f) f.style.display = 'none';
  const editId = document.getElementById('sched-edit-id');
  if (editId) editId.value = '';
}

function schedAddShow() {
  const f = document.getElementById('sched-form');
  if (!f) return;
  document.getElementById('sched-edit-id').value = '';
  document.getElementById('sched-label').value = '';
  document.getElementById('sched-preset').value = '0 9 * * *';
  document.getElementById('sched-custom-wrap').style.display = 'none';
  f.style.display = '';
}

async function schedLoad() {
  if (!currentSuiteId) return;
  const res = await fetch(`/api/schedules?suiteId=${currentSuiteId}`);
  if (!res.ok) return;
  const schedules = await res.json();
  const el = document.getElementById('sched-list');
  if (!el) return;

  if (schedules.length === 0) {
    el.innerHTML = '<div style="color:var(--neutral-400);font-size:13px;padding:8px 0">No schedules configured. Add one to run this suite automatically.</div>';
    return;
  }

  el.innerHTML = `
    <table class="sched-table">
      <thead><tr><th>Label</th><th>Frequency</th><th>Last Run</th><th>Enabled</th><th></th></tr></thead>
      <tbody>
        ${schedules.map(s => `
          <tr>
            <td style="font-weight:600">${escHtml(s.label)}</td>
            <td><code class="sched-cron">${escHtml(s.cronExpression)}</code><span class="sched-preset-lbl">${escHtml(schedPresetLabel(s.cronExpression))}</span></td>
            <td style="font-size:12px;color:var(--neutral-400)">${s.lastRunAt ? formatDate(s.lastRunAt) : '—'}</td>
            <td>
              <label class="sched-toggle">
                <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="schedToggle('${escHtml(s.id)}', this.checked)" />
                <span class="sched-toggle-track"></span>
              </label>
            </td>
            <td style="text-align:right">
              <button class="tbl-btn" onclick="schedDelete('${escHtml(s.id)}')">Delete</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function schedSave() {
  if (!currentSuiteId) return;
  const label = document.getElementById('sched-label')?.value.trim();
  const envId = document.getElementById('sched-env')?.value;
  const preset = document.getElementById('sched-preset')?.value;
  const cronVal = preset === 'custom' ? document.getElementById('sched-cron')?.value.trim() : preset;
  const editId = document.getElementById('sched-edit-id')?.value;

  if (!label) { alert('Please enter a label.'); return; }
  if (!envId) { alert('Please select an environment.'); return; }
  if (!cronVal) { alert('Please enter or select a cron expression.'); return; }

  const body = { suiteId: currentSuiteId, environmentId: envId, cronExpression: cronVal, label };

  const res = editId
    ? await fetch(`/api/schedules/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to save schedule'); return; }

  schedFormHide();
  await schedLoad();
}

async function schedToggle(id, enabled) {
  await fetch(`/api/schedules/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  await schedLoad();
}

async function schedDelete(id) {
  if (!confirm('Delete this schedule?')) return;
  await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
  await schedLoad();
}

// suite detail overlay functions removed — use Execution tab to run suites.

// ══════════════════════════════════════════════════════════════════════════════
// Execution Module
// ══════════════════════════════════════════════════════════════════════════════

let _execLastRunId = null;   // last runId launched from Execution tab
let _execPollTimer = null;
let _execPollStopped = false;

async function execLoad() {
  const noProj = document.getElementById('exec-no-project');
  const body = document.getElementById('exec-body');
  const suiteSel = document.getElementById('exec-suite-sel');
  if (!suiteSel) return;

  if (!currentProjectId) {
    if (noProj) noProj.style.display = '';
    if (body) body.style.display = 'none';
    return;
  }
  if (noProj) noProj.style.display = 'none';
  if (body) body.style.display = '';

  // Populate suite dropdown
  const suites = allSuites.filter(s => s.projectId === currentProjectId)
    .sort((a, b) => a.name.localeCompare(b.name));
  suiteSel.innerHTML = '<option value="">— Select Suite —</option>' +
    suites.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');

  // Reset env dropdown
  document.getElementById('exec-env-sel').innerHTML = '<option value="">— Select Environment —</option>';

  // Hide scripts, disable run, hide report
  document.getElementById('exec-scripts-wrap').style.display = 'none';
  document.getElementById('exec-run-btn').disabled = true;
  document.getElementById('exec-report-btn').style.display = 'none';
  document.getElementById('exec-progress-wrap').style.display = 'none';
  document.getElementById('exec-run-hint').textContent = 'Select a suite and environment to run';
}

// Cached flag: set once per suite change (O(N) scan with early exit via .some())
// Checkbox onchange reads this flag — O(1), no re-scan on every click.
let _execSuiteHasTestData = false;

// Returns true if execution is allowed, false if blocked.
// Trace toggle — cycles: 'on' → 'retain-on-failure' → 'off'
var _execTraceMode = 'on';

var _TRACE_STATES = {
  'on': {
    next: 'retain-on-failure',
    dot: '#16a34a',
    label: 'Always',
    hint: 'Trace recorded for every test (pass & fail)',
    borderColor: 'var(--neutral-300)',
    color: 'var(--neutral-700)',
  },
  'retain-on-failure': {
    next: 'off',
    dot: '#d97706',
    label: 'Failed Only',
    hint: 'Trace recorded for failed tests only — no retries required',
    borderColor: '#d97706',
    color: '#92400e',
  },
  'off': {
    next: 'on',
    dot: '#94a3b8',
    label: 'Off',
    hint: 'No traces recorded',
    borderColor: '#94a3b8',
    color: '#64748b',
  },
};

function _execTraceWarnCheck() {
  const warn = document.getElementById('exec-trace-retry-warning');
  if (!warn) return;
  warn.style.display = 'none'; // no warnings needed with new 3-state model
}

function _execToggleTrace() {
  const state = _TRACE_STATES[_execTraceMode] || _TRACE_STATES['on'];
  _execTraceMode = state.next;
  const next = _TRACE_STATES[_execTraceMode];
  const dot = document.getElementById('exec-trace-dot');
  const label = document.getElementById('exec-trace-label');
  const hint = document.getElementById('exec-trace-hint');
  const btn = document.getElementById('exec-trace-toggle');
  dot.style.background = next.dot;
  label.textContent = next.label;
  hint.textContent = next.hint;
  btn.style.borderColor = next.borderColor;
  btn.style.color = next.color;
}

function _execCheckBrowserConstraint() {
  const warningEl = document.getElementById('exec-browser-warning');
  const runBtn = document.getElementById('exec-run-btn');
  const hintEl = document.getElementById('exec-run-hint');

  if (!_execSuiteHasTestData) {
    // No testdata steps — no restriction, hide warning
    if (warningEl) warningEl.style.display = 'none';
    _execUpdateRunBtn();
    return true;
  }

  const selectedCount = ['chromium', 'firefox', 'webkit']
    .filter(b => document.getElementById(`exec-browser-${b}`)?.checked).length;

  if (selectedCount > 1) {
    if (warningEl) warningEl.style.display = '';
    if (runBtn) runBtn.disabled = true;
    if (hintEl) hintEl.textContent = '';
    return false;
  }

  // Single browser selected — allowed
  if (warningEl) warningEl.style.display = 'none';
  _execUpdateRunBtn();
  return true;
}

function execOnSuiteChange() {
  const suiteId = document.getElementById('exec-suite-sel')?.value;
  const envSel = document.getElementById('exec-env-sel');
  const scriptsWrap = document.getElementById('exec-scripts-wrap');
  const scriptList = document.getElementById('exec-script-list');
  const countEl = document.getElementById('exec-script-count');
  const runBtn = document.getElementById('exec-run-btn');
  const hintEl = document.getElementById('exec-run-hint');

  if (!suiteId) {
    envSel.innerHTML = '<option value="">— Select Environment —</option>';
    scriptsWrap.style.display = 'none';
    runBtn.disabled = true;
    hintEl.textContent = 'Select a suite and environment to run';
    _execSuiteHasTestData = false;
    const warnEl = document.getElementById('exec-browser-warning');
    if (warnEl) warnEl.style.display = 'none';
    return;
  }

  const suite = allSuites.find(s => s.id === suiteId);
  const project = allProjects.find(p => p.id === currentProjectId);
  const envs = project?.environments || [];

  // Populate environment dropdown
  envSel.innerHTML = '<option value="">— Select Environment —</option>' +
    envs.map(e => `<option value="${escHtml(e.id)}"${e.id === suite?.environmentId ? ' selected' : ''}>${escHtml(e.name)} — ${escHtml(e.url)}</option>`).join('');

  // Show scripts
  const scriptIds = suite?.scriptIds || [];
  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  const scripts = scriptIds.map(id => scriptMap[id]).filter(Boolean);

  if (countEl) countEl.textContent = `(${scripts.length})`;

  if (!scripts.length) {
    scriptList.innerHTML = '<div style="padding:12px 10px;color:var(--neutral-400);font-size:13px;text-align:center">No scripts in this suite.</div>';
  } else {
    scriptList.innerHTML = scripts.map((s, idx) => `
      <div style="display:grid;grid-template-columns:32px 90px 1fr 80px;align-items:center;border-bottom:1px solid var(--neutral-100)">
        <div style="padding:7px 8px;font-size:12px;color:var(--neutral-400)">${idx + 1}</div>
        <div style="padding:7px 8px;font-size:12px;color:var(--neutral-500)">${escHtml(_smTcId(s))}</div>
        <div style="padding:7px 8px;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.title)}">${escHtml(s.title)}</div>
        <div style="padding:7px 8px;font-size:12px;color:var(--neutral-400)">${s.steps.length} steps</div>
      </div>`).join('');
  }
  scriptsWrap.style.display = '';

  // Scan ALL steps in suite scripts for testdata valueMode — short-circuits on first match.
  // Result cached in _execSuiteHasTestData; checkbox onchange reads it at O(1).
  _execSuiteHasTestData = scripts.some(s =>
    (s.steps || []).some(step => step.valueMode === 'testdata')
  );

  // Apply browser constraint (may disable Run button and show warning)
  _execCheckBrowserConstraint();
  // Re-evaluate trace retry warning for newly selected suite
  _execTraceWarnCheck();
}

function _execUpdateRunBtn() {
  const suiteId = document.getElementById('exec-suite-sel')?.value;
  const envId = document.getElementById('exec-env-sel')?.value;
  const runBtn = document.getElementById('exec-run-btn');
  const hintEl = document.getElementById('exec-run-hint');
  const ready = !!(suiteId && envId);
  runBtn.disabled = !ready;
  hintEl.textContent = ready ? '' : (!suiteId ? 'Select a suite first' : 'Select an environment to run');
}

async function execRun() {
  const suiteId = document.getElementById('exec-suite-sel')?.value;
  const envId = document.getElementById('exec-env-sel')?.value;
  if (!suiteId || !envId) { alert('Select a suite and environment first.'); return; }

  // Guard: re-validate browser constraint before executing (defence-in-depth)
  if (!_execCheckBrowserConstraint()) return;

  // ── Fast Mode: detect login steps in selected scripts and warn ────────────
  const _fmSuite = allSuites.find(s => s.id === suiteId);
  if (_fmSuite?.fastMode && (_fmSuite.fastModeSteps || []).length > 0) {
    const _fmScriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
    const _LOGIN_LOCATOR_RE = /user|email|login|username|password|pass|pwd|credential/i;
    const _LOGIN_KW = new Set(['FILL', 'TYPE', 'CLICK', 'CLICK BUTTON', 'SUBMIT']);
    const _SUBMIT_KW = new Set(['CLICK', 'CLICK BUTTON', 'SUBMIT']);
    const _warnings = [];
    for (const sid of (_fmSuite.scriptIds || [])) {
      const sc = _fmScriptMap[sid];
      if (!sc) continue;
      const steps = (sc.steps || []).slice().sort((a, b) => a.order - b.order);
      // Detect pattern: FILL on username/password locator OR CLICK on submit-like locator near a fill
      let hasFillCred = false;
      let hasSubmit = false;
      for (const st of steps) {
        const kw = (st.keyword || '').toUpperCase().trim();
        const loc = (st.locator || st.locatorName || st.description || '').toLowerCase();
        if ((kw === 'FILL' || kw === 'TYPE') && _LOGIN_LOCATOR_RE.test(loc)) hasFillCred = true;
        if (_SUBMIT_KW.has(kw) && hasFillCred) hasSubmit = true;
      }
      if (hasFillCred && hasSubmit) {
        const tcId = sc.name || sc.id;
        _warnings.push(`• ${tcId}`);
      }
    }
    if (_warnings.length > 0) {
      const msg = [
        '⚠️ Fast Mode Warning — Login Steps Detected',
        '',
        'The following scripts contain login steps (fill credentials + submit):',
        ..._warnings,
        '',
        'Fast Mode already logs in once via beforeAll and reuses the auth state.',
        'Running login steps inside each test will re-authenticate and may break auth state reuse.',
        '',
        'Recommended: Remove login steps from these scripts when using Fast Mode.',
        '',
        'Click OK to run anyway, or Cancel to review the scripts first.',
      ].join('\n');
      if (!confirm(msg)) return;
    }
  }

  // Stop any previous poll
  _execPollStopped = true;
  clearTimeout(_execPollTimer);

  const runBtn = document.getElementById('exec-run-btn');
  const reportBtn = document.getElementById('exec-report-btn');
  const progressWrap = document.getElementById('exec-progress-wrap');
  const statusEl = document.getElementById('exec-run-status');
  const metaEl = document.getElementById('exec-run-meta');
  const progressBar = document.getElementById('exec-progress-bar');
  const resultsTable = document.getElementById('exec-results-table');
  const resultsBody = document.getElementById('exec-results-body');
  const summaryEl = document.getElementById('exec-summary');

  runBtn.disabled = true;
  runBtn.innerHTML = '⏳ Starting…';
  reportBtn.style.display = 'none';
  progressWrap.style.display = '';
  resultsTable.style.display = 'none';
  resultsBody.innerHTML = '';
  summaryEl.style.display = 'none';
  if (statusEl) statusEl.textContent = '⏳ Starting…';
  if (metaEl) metaEl.textContent = '';
  if (progressBar) progressBar.style.width = '0%';

  const execBrowsers = ['chromium', 'firefox', 'webkit']
    .filter(b => document.getElementById(`exec-browser-${b}`)?.checked);
  const res = await fetch(`/api/suites/${suiteId}/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environmentId: envId, browsers: execBrowsers.length ? execBrowsers : ['chromium'], traceMode: _execTraceMode }),
  });
  const data = await res.json();
  if (!res.ok) {
    runBtn.disabled = false;
    runBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Suite';
    if (statusEl) statusEl.textContent = '✗ Failed to start';
    return;
  }

  const { runId } = data;
  _execLastRunId = runId;
  _execPollStopped = false;

  // Render known tests as pending immediately
  const suite = allSuites.find(s => s.id === suiteId);
  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  const scripts = (suite?.scriptIds || []).map(id => scriptMap[id]).filter(Boolean);

  function _execRenderResultsTable(tests) {
    if (!tests?.length && !scripts.length) return;
    resultsTable.style.display = '';
    function _execBrBadge(b) {
      if (b === 'firefox') return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:700;background:#E66000;color:#fff">● Firefox</span>`;
      if (b === 'webkit') return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:700;background:#006CFF;color:#fff">● Safari</span>`;
      return `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:700;background:#4285F4;color:#fff">● Chrome</span>`;
    }
    const rows = tests?.length
      ? tests.map(t => {
        const colour = t.status === 'pass' ? '#4ec9b0' : '#f48771';
        const icon = t.status === 'pass' ? '✓' : '✗';
        const dur = t.durationMs != null ? `${(t.durationMs / 1000).toFixed(1)}s` : '';
        return `<div style="display:grid;grid-template-columns:1fr 100px 90px 80px;border-bottom:1px solid var(--neutral-100)">
            <div style="padding:7px 10px;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.name)}">${escHtml(t.name)}</div>
            <div style="padding:7px 10px;display:flex;align-items:center">${_execBrBadge(t.browser || 'chromium')}</div>
            <div style="padding:7px 10px;font-size:12px;font-weight:700;color:${colour}">${icon} ${t.status}</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">${dur}</div>
          </div>`;
      }).join('')
      : scripts.map(s => `
          <div style="display:grid;grid-template-columns:1fr 100px 90px 80px;border-bottom:1px solid var(--neutral-100);opacity:.5">
            <div style="padding:7px 10px;font-size:12.5px">${escHtml(s.title)}</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">—</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">pending</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">—</div>
          </div>`).join('');
    resultsBody.innerHTML = rows;
  }

  _execRenderResultsTable(null);

  async function execPoll() {
    if (_execPollStopped) return;
    try {
      const r = await fetch(`/api/run/${runId}`);
      if (!r.ok) { _execPollTimer = setTimeout(execPoll, 1500); return; }
      const rec = await r.json();

      const total = rec.total || scripts.length || 1;
      const done = (rec.passed || 0) + (rec.failed || 0);
      const pct = Math.min(100, Math.round((done / total) * 100));
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (metaEl) metaEl.textContent = rec.status === 'running' ? `${done} / ${total}` : '';

      if (rec.tests?.length) _execRenderResultsTable(rec.tests);

      if (rec.status === 'running' || rec.status === 'queued' || !rec.status) {
        if (statusEl) statusEl.textContent = rec.status === 'queued' ? '⏳ Queued…' : '⏳ Running…';
        // P4: poll for T4 heal proposal — spec pauses and writes pending-heal.json
        fetch(`/api/debug/heal-pending?runId=${encodeURIComponent(runId)}`)
          .then(r => r.ok ? r.json() : null)
          .then(proposal => {
            if (proposal) showT4ProposalCard(proposal, runId);
            else hideT4ProposalCard();
          }).catch(() => { });
        // P5-E: poll for prescan health results (written by spec beforeAll)
        fetch(`/api/prescan?runId=${encodeURIComponent(runId)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.locators?.length) renderPrescanHealth(data); })
          .catch(() => { });
        _execPollTimer = setTimeout(execPoll, 1500);
        return;
      }

      // Finished
      _execPollStopped = true;
      if (progressBar) progressBar.style.width = '100%';
      const p = rec.passed || 0, f = rec.failed || 0;
      const ok = f === 0 && rec.exitCode === 0;
      if (statusEl) statusEl.textContent = ok ? `✓ Passed — ${p} tests` : `✗ Done — ${p} passed, ${f} failed`;
      summaryEl.style.display = '';
      summaryEl.innerHTML = `<strong style="color:${ok ? 'var(--green-600,#16a34a)' : 'var(--red-600,#dc2626)'}">${p} passed</strong> · <strong style="color:${f ? 'var(--red-600,#dc2626)' : 'inherit'}">${f} failed</strong> · ${rec.total || 0} total`;

      if (rec.tests?.length) _execRenderResultsTable(rec.tests);

      runBtn.disabled = false;
      runBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Suite';
      reportBtn.style.display = '';

      // Refresh history badge
      if (typeof histLoad === 'function') histLoad();

    } catch { _execPollTimer = setTimeout(execPoll, 2000); }
  }

  execPoll();
}

function execViewReport() {
  if (_execLastRunId) window.open(`/execution-report?runId=${encodeURIComponent(_execLastRunId)}`, '_blank');
}

// ── P5-E: Pre-Scan Health Grid ────────────────────────────────────────────────
function renderPrescanHealth(data) {
  const wrap = document.getElementById('exec-prescan-wrap');
  const grid = document.getElementById('exec-prescan-grid');
  const pageEl = document.getElementById('exec-prescan-page');
  const sumEl = document.getElementById('exec-prescan-summary');
  if (!wrap || !grid) return;

  const locators = data.locators || [];
  const healthy = locators.filter(l => l.status === 'healthy').length;
  const degraded = locators.filter(l => l.status === 'degraded').length;
  const broken = locators.filter(l => l.status === 'broken').length;

  if (pageEl) pageEl.textContent = data.pageKey || '';
  if (sumEl) sumEl.innerHTML =
    `<span class="ps-chip ps-healthy">${healthy} healthy</span>` +
    (degraded ? `<span class="ps-chip ps-degraded">${degraded} degraded</span>` : '') +
    (broken ? `<span class="ps-chip ps-broken">${broken} broken</span>` : '');

  grid.innerHTML = locators.map(l => {
    const icon = l.status === 'healthy' ? '🟢' : l.status === 'degraded' ? '🟡' : '🔴';
    const score = l.score != null ? `${Math.round(l.score)}%` : '—';
    const barW = Math.max(0, Math.min(100, Math.round(l.score || 0)));
    const barC = l.status === 'healthy' ? '#4ec9b0' : l.status === 'degraded' ? '#eab308' : '#f48771';
    return `<div class="ps-row">
      <span class="ps-icon">${icon}</span>
      <span class="ps-name" title="${escHtml(l.selector || '')}">${escHtml(l.name)}</span>
      <div class="ps-bar-wrap"><div class="ps-bar" style="width:${barW}%;background:${barC}"></div></div>
      <span class="ps-score" style="color:${barC}">${score}</span>
    </div>`;
  }).join('');

  wrap.style.display = '';
}

// ── P5-F: Validate Locators (manual prescan trigger) ─────────────────────────
async function validateLocators() {
  if (!currentProjectId) { alert('Select a project first.'); return; }

  // Build env URL list from current project
  const proj = allProjects.find(p => p.id === currentProjectId);
  const envs = proj?.environments || [];
  const modal = document.getElementById('prescan-modal');
  if (!modal) return;

  // Populate env dropdown
  const sel = document.getElementById('prescan-env-sel');
  if (sel) {
    if (envs.length) {
      sel.innerHTML = envs.map(e => `<option value="${escHtml(e.url)}">${escHtml(e.name)} — ${escHtml(e.url)}</option>`).join('');
    } else {
      const fallbackUrl = proj?.appUrl || '';
      sel.innerHTML = `<option value="${escHtml(fallbackUrl)}">${escHtml(fallbackUrl || 'Project URL')}</option>`;
    }
  }

  document.getElementById('prescan-results').innerHTML = '';
  document.getElementById('prescan-results-wrap').style.display = 'none';
  modal.style.display = 'flex';
}

function prescanModalClose() {
  const modal = document.getElementById('prescan-modal');
  if (modal) modal.style.display = 'none';
}

async function prescanRun() {
  const sel = document.getElementById('prescan-env-sel');
  const url = sel?.value?.trim();
  if (!url) { alert('Select an environment URL.'); return; }

  const runBtn = document.getElementById('prescan-run-btn');
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Scanning…'; }

  try {
    const res = await fetch('/api/prescan-trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: currentProjectId, url }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Prescan failed'); return; }
    const { scanId } = await res.json();

    // Poll for results
    const poll = async () => {
      const r = await fetch(`/api/prescan?runId=${encodeURIComponent(scanId)}`).catch(() => null);
      if (!r?.ok) { setTimeout(poll, 1500); return; }
      const data = await r.json().catch(() => null);
      if (!data) { setTimeout(poll, 1500); return; }

      // Render in modal
      const wrap = document.getElementById('prescan-results-wrap');
      const grid = document.getElementById('prescan-results');
      if (!grid || !wrap) return;

      const locators = data.locators || [];
      grid.innerHTML = locators.length
        ? locators.map(l => {
          const icon = l.status === 'healthy' ? '🟢' : l.status === 'degraded' ? '🟡' : '🔴';
          const score = l.score != null ? `${Math.round(l.score)}%` : '—';
          const barW = Math.max(0, Math.min(100, Math.round(l.score || 0)));
          const barC = l.status === 'healthy' ? '#4ec9b0' : l.status === 'degraded' ? '#eab308' : '#f48771';
          return `<div class="ps-row">
              <span class="ps-icon">${icon}</span>
              <span class="ps-name" title="${escHtml(l.selector || '')}">${escHtml(l.name)}</span>
              <div class="ps-bar-wrap"><div class="ps-bar" style="width:${barW}%;background:${barC}"></div></div>
              <span class="ps-score" style="color:${barC}">${score}</span>
            </div>`;
        }).join('')
        : `<div style="color:var(--neutral-400);font-size:12px;padding:8px">No locators with healing profiles found for this page (${escHtml(data.pageKey || '')}). Record some interactions first.</div>`;
      wrap.style.display = '';
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Scan'; }
    };
    setTimeout(poll, 2000); // give Playwright a head start
  } catch { alert('Network error during prescan trigger'); if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Scan'; } }
}

// ── T4 Heal Proposal Card ─────────────────────────────────────────────────────
let _t4ActiveProposal = null;

function showT4ProposalCard(proposal, runId) {
  if (_t4ActiveProposal?.at === proposal.at) return; // already showing this one
  _t4ActiveProposal = { ...proposal, runId };

  const modal = document.getElementById('t4-heal-modal');
  if (!modal) return;

  // Populate fields
  const el = id => document.getElementById(id);
  if (el('t4-step-info')) el('t4-step-info').textContent = `Step ${proposal.stepOrder} — ${proposal.keyword}`;
  if (el('t4-tier-badge')) el('t4-tier-badge').textContent = proposal.isAssert ? 'ASSERT (forced T4)' : 'T3 score < 75';
  if (el('t4-old-sel')) el('t4-old-sel').textContent = proposal.oldSelector || '(unknown — locator not found)';
  if (el('t4-cand-sel')) el('t4-cand-sel').textContent = proposal.candidateSelector || '(no candidate found)';
  if (el('t4-cand-type')) el('t4-cand-type').textContent = proposal.candidateSelectorType || '';
  if (el('t4-score')) el('t4-score').textContent = proposal.candidateSelector ? `${Math.round(proposal.score)}%` : '—';

  const approveBtn = el('t4-approve-btn');
  if (approveBtn) approveBtn.disabled = !proposal.candidateSelector;

  // Pre-fill override input with candidate selector
  const overrideInput = el('t4-override-sel');
  if (overrideInput) overrideInput.value = proposal.candidateSelector || '';
  const overrideType = el('t4-override-type');
  if (overrideType) overrideType.value = proposal.candidateSelectorType || 'css';

  modal.style.display = 'flex';
}

function hideT4ProposalCard() {
  _t4ActiveProposal = null;
  const modal = document.getElementById('t4-heal-modal');
  if (modal) modal.style.display = 'none';
}

async function respondT4Heal(action) {
  if (!_t4ActiveProposal) return;
  const p = _t4ActiveProposal;

  // On approve, use override input if user edited it
  let selector = p.candidateSelector;
  let selectorType = p.candidateSelectorType || 'css';
  if (action === 'approve') {
    const overrideInput = document.getElementById('t4-override-sel');
    const overrideType = document.getElementById('t4-override-type');
    if (overrideInput?.value?.trim()) selector = overrideInput.value.trim();
    if (overrideType?.value?.trim()) selectorType = overrideType.value.trim();
    if (!selector) { alert('No candidate selector available — cannot approve. You can type one in the override field.'); return; }
  }

  try {
    const res = await fetch('/api/debug/heal-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: p.runId,
        action,
        selector: action === 'approve' ? selector : undefined,
        selectorType: action === 'approve' ? selectorType : undefined,
        locatorId: p.locatorId,
        stepOrder: p.stepOrder,
        keyword: p.keyword,
        oldSelector: p.oldSelector,
        oldSelectorType: p.candidateSelectorType,
        score: p.score,
        projectId: currentProjectId,
      }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to send response'); return; }
    hideT4ProposalCard();
  } catch { alert('Network error sending heal response'); }
}

