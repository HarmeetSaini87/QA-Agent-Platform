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
const _execChromeIcon = '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364z" fill="#4285F4"/><path d="M12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z" fill="#DC4E41"/><circle cx="12" cy="12" r="4.364" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#4285F4"/></svg>';
     const _execFirefoxIcon = '<svg width="16" height="16" viewBox="0 0 512 512" style="vertical-align:-2px"><defs><radialGradient id="e1g" cx="210%" cy="-100%" r="290%"><stop offset=".1" stop-color="#ffe226"/><stop offset=".79" stop-color="#ff7139"/></radialGradient><radialGradient id="e1c" cx="49%" cy="40%" r="128%" gradientTransform="matrix(.82 0 0 1 .088 0)"><stop offset=".3" stop-color="#960e18"/><stop offset=".35" stop-color="#b11927" stop-opacity=".74"/><stop offset=".43" stop-color="#db293d" stop-opacity=".34"/><stop offset=".5" stop-color="#f5334b" stop-opacity=".09"/><stop offset=".53" stop-color="#ff3750" stop-opacity="0"/></radialGradient><radialGradient id="e1d" cx="48%" cy="-12%" r="140%"><stop offset=".13" stop-color="#fff44f"/><stop offset=".53" stop-color="#ff980e"/></radialGradient><radialGradient id="e1e" cx="22.76%" cy="110.11%" r="100%"><stop offset=".35" stop-color="#3a8ee6"/><stop offset=".67" stop-color="#9059ff"/><stop offset="1" stop-color="#c139e6"/></radialGradient><radialGradient id="e1f" cx="52%" cy="33%" r="59%" gradientTransform="scale(.9 1)"><stop offset=".21" stop-color="#9059ff" stop-opacity="0"/><stop offset=".97" stop-color="#6e008b" stop-opacity=".6"/></radialGradient><radialGradient id="e1b" cx="87.4%" cy="-12.9%" r="128%" gradientTransform="matrix(.8 0 0 1 .178 .129)"><stop offset=".13" stop-color="#ffbd4f"/><stop offset=".28" stop-color="#ff980e"/><stop offset=".47" stop-color="#ff3750"/><stop offset=".78" stop-color="#eb0878"/><stop offset=".86" stop-color="#e50080"/></radialGradient><radialGradient id="e1h" cx="84%" cy="-41%" r="180%"><stop offset=".11" stop-color="#fff44f"/><stop offset=".46" stop-color="#ff980e"/><stop offset=".72" stop-color="#ff3647"/><stop offset=".9" stop-color="#e31587"/></radialGradient><radialGradient id="e1i" cx="16.1%" cy="-18.6%" r="348.8%" gradientTransform="scale(1 .47) rotate(84 .279 -.297)"><stop offset="0" stop-color="#fff44f"/><stop offset=".3" stop-color="#ff980e"/><stop offset=".57" stop-color="#ff3647"/><stop offset=".74" stop-color="#e31587"/></radialGradient><radialGradient id="e1j" cx="18.9%" cy="-42.5%" r="238.4%"><stop offset=".14" stop-color="#fff44f"/><stop offset=".48" stop-color="#ff980e"/><stop offset=".66" stop-color="#ff3647"/><stop offset=".9" stop-color="#e31587"/></radialGradient><radialGradient id="e1k" cx="159.3%" cy="-44.72%" r="313.1%"><stop offset=".09" stop-color="#fff44f"/><stop offset=".63" stop-color="#ff980e"/></radialGradient><linearGradient id="e1a" x1="87.25%" y1="15.5%" x2="9.4%" y2="93.1%"><stop offset=".05" stop-color="#fff44f"/><stop offset=".37" stop-color="#ff980e"/><stop offset=".53" stop-color="#ff3647"/><stop offset=".7" stop-color="#e31587"/></linearGradient><linearGradient id="e1l" x1="80%" y1="14%" x2="18%" y2="84%"><stop offset=".17" stop-color="#fff44f" stop-opacity=".8"/><stop offset=".6" stop-color="#fff44f" stop-opacity="0"/></linearGradient></defs><path d="M478.711 166.353c-10.445-25.124-31.6-52.248-48.212-60.821 13.52 26.505 21.345 53.093 24.335 72.936 0 .039.015.136.047.4C427.706 111.135 381.627 83.823 344 24.355c-1.9-3.007-3.805-6.022-5.661-9.2a73.716 73.716 0 01-2.646-4.972A43.7 43.7 0 01332.1.677a.626.626 0 00-.546-.644.818.818 0 00-.451 0c-.034.012-.084.051-.12.065-.053.021-.12.069-.176.1.027-.036.083-.117.1-.136-60.37 35.356-80.85 100.761-82.732 133.484a120.249 120.249 0 00-66.142 25.488 71.355 71.355 0 00-6.225-4.7 111.338 111.338 0 01-.674-58.732c-24.688 11.241-43.89 29.01-57.85 44.7h-.111c-9.527-12.067-8.855-51.873-8.312-60.184-.114-.515-7.107 3.63-8.023 4.255a175.073 175.073 0 00-23.486 20.12 210.478 210.478 0 00-22.442 26.913c0 .012-.007.026-.011.038 0-.013.007-.026.011-.038a202.838 202.838 0 00-32.247 72.805c-.115.521-.212 1.061-.324 1.586-.452 2.116-2.08 12.7-2.365 15-.022.177-.032.347-.053.524a229.066 229.066 0 00-3.9 33.157c0 .41-.025.816-.025 1.227C16 388.418 123.6 496 256.324 496c118.865 0 217.56-86.288 236.882-199.63.407-3.076.733-6.168 1.092-9.271 4.777-41.21-.53-84.525-15.587-120.746z" fill="url(#e1a)"/><path d="M478.711 166.353c-10.445-25.124-31.6-52.248-48.212-60.821 13.52 26.505 21.345 53.093 24.335 72.936 0-.058.011.048.036.226.012.085.027.174.04.259 22.675 61.47 10.322 123.978-7.479 162.175-27.539 59.1-94.215 119.67-198.576 116.716C136.1 454.651 36.766 370.988 18.223 261.41c-3.379-17.28 0-26.054 1.7-40.084-2.071 10.816-2.86 13.94-3.9 33.157 0 .41-.025.816-.025 1.227C16 388.418 123.6 496 256.324 496c118.865 0 217.56-86.288 236.882-199.63.407-3.076.733-6.168 1.092-9.271 4.777-41.21-.53-84.525-15.587-120.746z" fill="url(#e1b)"/><path d="M361.922 194.6c.524.368 1 .734 1.493 1.1a130.706 130.706 0 00-22.31-29.112C266.4 91.892 321.516 4.626 330.811.194c.027-.036.083-.117.1-.136-60.37 35.356-80.85 100.761-82.732 133.484 2.8-.194 5.592-.429 8.442-.429 45.051 0 84.289 24.77 105.301 61.487z" fill="url(#e1d)"/><path d="M256.772 209.514c-.393 5.978-21.514 26.593-28.9 26.593-68.339 0-79.432 41.335-79.432 41.335 3.027 34.81 27.261 63.475 56.611 78.643 1.339.692 2.694 1.317 4.05 1.935a132.768 132.768 0 007.059 2.886 106.743 106.743 0 0031.271 6.031c119.78 5.618 142.986-143.194 56.545-186.408 22.137-3.85 45.115 5.053 57.947 14.067-21.012-36.714-60.25-61.484-105.3-61.484-2.85 0-5.641.235-8.442.429a120.249 120.249 0 00-66.142 25.488c3.664 3.1 7.8 7.244 16.514 15.828 16.302 16.067 58.13 32.705 58.219 34.657z" fill="url(#e1e)"/><path d="M170.829 151.036a244.042 244.042 0 014.981 3.3 111.338 111.338 0 01-.674-58.732c-24.688 11.241-43.89 29.01-57.85 44.7 1.155-.033 36.014-.66 53.543 10.732z" fill="url(#e1g)"/></svg>';
     const _execSafariIcon = '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm-.004.953h.006c.063 0 .113.05.113.113v1.842c0 .063-.05.113-.113.113h-.006a.112.112 0 0 1-.113-.113V1.066c0-.063.05-.113.113-.113z" fill="#006CFF"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" fill="#5AC8FA" opacity=".3"/><path d="M12 3.4l-1.76 6.84L12 12l1.76-1.76z" fill="#FF3B30"/><path d="M12 20.6l1.76-6.84L12 12l-1.76 1.76z" fill="#fff"/><circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-width=".6" opacity=".5"/><circle cx="12" cy="12" r="1.8" fill="#fff"/><circle cx="12" cy="12" r="1" fill="#007AFF"/></svg>';
    function _execBrBadge(b) {
      if (b === 'firefox') return `<span title="Firefox" style="display:inline-flex;align-items:center">${_execFirefoxIcon}</span>`;
      if (b === 'webkit') return `<span title="Safari" style="display:inline-flex;align-items:center">${_execSafariIcon}</span>`;
      return `<span title="Chrome" style="display:inline-flex;align-items:center">${_execChromeIcon}</span>`;
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

