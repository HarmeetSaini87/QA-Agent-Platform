// API FLAKINESS ANALYTICS MODULE
// Redesigned 2026-05-29: matches Flaky Tests page layout pattern
// All colours use --afl-* CSS tokens (defined in styles_addon.css) — works in both dark & light themes
// ══════════════════════════════════════════════════════════════════════════════

var _flakinessColId    = null;
var _flakinessReport   = null;
var _flakinessFilter   = 'all';
var _flakinessTop10    = false;
var _flakinessAllCols  = [];
var _flakinessPage     = 0;
var _flakinessPageSize = 25;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function flakinessPageInit() {
  await _flakinessLoadCollections();
}

async function _flakinessLoadCollections() {
  if (!currentProjectId) return;
  try {
    const res  = await fetch(`/api/api-collections?projectId=${encodeURIComponent(currentProjectId)}`);
    const data = await res.json();
    _flakinessAllCols = data.collections || data || [];
    const sel = document.getElementById('flakiness-col-filter');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select a collection —</option>' +
      _flakinessAllCols.map(c =>
        `<option value="${_flEsc(c.id)}">${_flEsc(c.name)}</option>`
      ).join('');
  } catch (e) { /* ignore */ }
}

// ── Load / Recompute ───────────────────────────────────────────────────────────

async function flakinessLoad() {
  const sel = document.getElementById('flakiness-col-filter');
  _flakinessColId = sel ? sel.value : _flakinessColId;

  if (!_flakinessColId) {
    _flakinessShowState('empty');
    return;
  }

  _flakinessShowState('loading');
  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(_flakinessColId));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _flakinessReport = await res.json();
    _flakinessRender();
  } catch (e) {
    _flakinessShowState('empty');
    _flAlert('error', 'Load failed: ' + e.message);
  }
}

async function flakinessRecompute() {
  if (!_flakinessColId) { _flAlert('warn', 'Select a collection first.'); return; }
  const btn = document.getElementById('flakiness-recompute-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↺ Computing…'; }
  _flakinessShowState('loading');
  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(_flakinessColId) + '/recompute', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _flakinessReport = await res.json();
    _flakinessRender();
  } catch (e) {
    _flAlert('error', 'Recompute failed: ' + e.message);
    _flakinessShowState('table');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↺ Recompute'; }
  }
}

// ── Filter / Sort Controls ─────────────────────────────────────────────────────

function flakinessSetFilter(f) {
  _flakinessFilter = f;
  _flakinessPage   = 0;
  document.querySelectorAll('.flaky-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f));
  _flakinessRenderTable();
}

function flakinessToggleTop10() {
  _flakinessTop10 = !_flakinessTop10;
  _flakinessPage  = 0;
  const btn = document.getElementById('flakiness-top10-btn');
  if (btn) btn.classList.toggle('active', _flakinessTop10);
  _flakinessRenderTable();
}

function flakinessApplyFilters() {
  _flakinessPage = 0;
  _flakinessRenderTable();
}

function _flakinessSetPageSize(n) {
  _flakinessPageSize = n;
  _flakinessPage     = 0;
  _flakinessRenderTable();
}

function _flakinessPageGo(dir) {
  _flakinessPage += dir;
  _flakinessRenderTable();
}

// ── Render ────────────────────────────────────────────────────────────────────

function _flakinessRender() {
  if (!_flakinessReport) return;
  _flakinessShowState('table');
  const tabs = document.getElementById('flakiness-filter-tabs');
  if (tabs) tabs.style.display = '';
  _flakinessRenderSummaryBar();
  _flakinessRenderTable();
}

function _flakinessRenderSummaryBar() {
  const r   = _flakinessReport;
  const bar = document.getElementById('flakiness-summary-bar');
  if (!bar || !r) return;

  const records   = r.stepRecords || [];
  const total     = records.length;
  const critical  = records.filter(s => _flakinessStatus(s) === 'critical').length;
  const unstable  = records.filter(s => _flakinessStatus(s) === 'unstable').length;
  const stable    = records.filter(s => _flakinessStatus(s) === 'stable').length;
  const stability = Math.round((r.stabilityScore || 0) * 100);
  const stabColor = stability >= 90 ? 'var(--afl-pass)' : stability >= 70 ? 'var(--afl-warn)' : 'var(--afl-danger)';

  bar.style.display = '';
  bar.innerHTML =
    `<span style="color:var(--afl-text);font-size:13px">` +
    `${total} request${total !== 1 ? 's' : ''} &nbsp;·&nbsp; ` +
    `<span style="color:var(--afl-danger)">${critical} critical</span> &nbsp;·&nbsp; ` +
    `<span style="color:var(--afl-warn)">${unstable} unstable</span> &nbsp;·&nbsp; ` +
    `<span style="color:var(--afl-pass)">${stable} stable</span>` +
    `</span>` +
    `<span style="margin-left:16px;font-size:12px;color:var(--afl-subtext)">` +
    `Stability <strong style="color:${stabColor}">${stability}%</strong> &nbsp;·&nbsp; ` +
    `${r.runsAnalyzed} run${r.runsAnalyzed !== 1 ? 's' : ''} analysed &nbsp;·&nbsp; ` +
    `Computed ${new Date(r.computedAt).toLocaleString()}` +
    `</span>`;
}

function _flakinessRenderTable() {
  const r = _flakinessReport;
  if (!r) return;

  let records = [...(r.stepRecords || [])];

  if (_flakinessFilter === 'critical')      records = records.filter(s => _flakinessStatus(s) === 'critical');
  if (_flakinessFilter === 'unstable')      records = records.filter(s => _flakinessStatus(s) === 'unstable');
  if (_flakinessFilter === 'stable')        records = records.filter(s => _flakinessStatus(s) === 'stable');
  if (_flakinessFilter === 'insufficient')  records = records.filter(s => s.totalRuns < 3);

  const sort = document.getElementById('flakiness-sort')?.value || 'score';
  if (sort === 'score')    records.sort((a, b) => b.flakinessScore - a.flakinessScore);
  if (sort === 'failrate') records.sort((a, b) => b.failRate - a.failRate);
  if (sort === 'runs')     records.sort((a, b) => b.totalRuns - a.totalRuns);
  if (sort === 'name')     records.sort((a, b) => (a.stepName || '').localeCompare(b.stepName || ''));

  if (_flakinessTop10) records = records.slice(0, 10);

  const total      = records.length;
  const totalPages = _flakinessTop10 ? 1 : Math.max(1, Math.ceil(total / _flakinessPageSize));
  if (_flakinessPage >= totalPages) _flakinessPage = totalPages - 1;
  if (_flakinessPage < 0)          _flakinessPage = 0;

  const start   = _flakinessTop10 ? 0 : _flakinessPage * _flakinessPageSize;
  const end     = _flakinessTop10 ? records.length : Math.min(start + _flakinessPageSize, total);
  const visible = records.slice(start, end);

  const tbody = document.getElementById('flakiness-step-tbody');
  if (!tbody) return;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--afl-muted);font-size:13px;">No requests match this filter.</td></tr>`;
    _flakinessRenderPagination(0, 0, 0);
    return;
  }
  tbody.innerHTML = visible.map(s => _flakinessRow(s)).join('');
  _flakinessRenderPagination(totalPages, total, start, end);
}

function _flakinessRenderPagination(totalPages, total, start, end) {
  const table = document.querySelector('#flakiness-step-tbody')?.closest('table');
  if (!table) return;
  let tfoot = table.querySelector('tfoot');
  if (!tfoot) { tfoot = document.createElement('tfoot'); table.appendChild(tfoot); }
  if (total === 0) { tfoot.innerHTML = ''; return; }

  const dispStart = total === 0 ? 0 : start + 1;
  const rppOpts = [10, 25, 50, 100, 200, 500].map(n =>
    `<option value="${n}"${_flakinessPageSize === n ? ' selected' : ''}>${n}</option>`
  ).join('');

  tfoot.innerHTML = `<tr><td colspan="8" style="padding:6px 4px;">
    <div class="lt-pagination">
      <label style="font-size:12px;color:var(--neutral-500)">Rows per page:
        <select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto"
          onchange="_flakinessSetPageSize(+this.value)">${rppOpts}</select>
      </label>
      ${totalPages <= 1
        ? `<span style="font-size:12px;color:var(--neutral-500)">${dispStart}–${end} of ${total}</span>`
        : `<button class="tbl-btn" onclick="_flakinessPageGo(-1)" ${_flakinessPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
           <span style="font-size:12px;color:var(--neutral-500)">Page ${_flakinessPage + 1} / ${totalPages} &nbsp;(${dispStart}–${end} of ${total})</span>
           <button class="tbl-btn" onclick="_flakinessPageGo(1)" ${_flakinessPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`}
    </div>
  </td></tr>`;
}

function _flakinessRow(s) {
  const pct      = Math.round((s.flakinessScore || 0) * 100);
  const failPct  = Math.round((s.failRate || 0) * 100);
  const status   = _flakinessStatus(s);
  const isInsuff = s.totalRuns < 3;

  const barColor = status === 'critical' ? 'var(--afl-danger)' : status === 'unstable' ? 'var(--afl-warn)' : 'var(--afl-pass)';
  const scoreBar =
    `<div style="display:flex;align-items:center;gap:6px;">` +
    `<div style="width:70px;background:var(--afl-bar-track);border-radius:3px;height:6px;flex-shrink:0;">` +
    `<div style="width:${pct}%;background:${barColor};border-radius:3px;height:100%;"></div></div>` +
    `<span style="font-size:11px;color:${barColor};font-weight:600;">${pct}%</span>` +
    `</div>`;

  const sig         = _flakinessSignatureLabel(s.dominantSignature);
  const action      = isInsuff ? '—' : _flakinessGetSuggestedAction(s);
  const actionShort = action.length > 40 ? action.slice(0, 38) + '…' : action;

  return `<tr style="${isInsuff ? 'opacity:0.6;' : ''}cursor:pointer" onclick="flakinessOpenDrawer(${JSON.stringify(s.stepId)})">` +
    `<td style="font-size:12px;font-weight:500;color:var(--afl-text);">${_flEsc(s.stepName || s.stepId)}</td>` +
    `<td>${_flakinessStatusBadge(status, isInsuff)}</td>` +
    `<td>${isInsuff ? `<span style="color:var(--afl-muted);font-size:11px;">Insufficient data</span>` : scoreBar}</td>` +
    `<td style="text-align:center;font-size:12px;color:var(--afl-text);">${isInsuff ? '—' : failPct + '%'}</td>` +
    `<td style="font-size:11px;color:var(--afl-subtext);">${sig}</td>` +
    `<td style="font-size:11px;color:var(--afl-text);" title="${_flEsc(action)}">${isInsuff ? '—' : _flEsc(actionShort)}</td>` +
    `<td style="text-align:center;font-size:12px;color:var(--afl-text);">${s.totalRuns}</td>` +
    `<td><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();flakinessOpenDrawer('${_flEsc(s.stepId)}')">Details</button></td>` +
    `</tr>`;
}

// ── Drawer ────────────────────────────────────────────────────────────────────

function flakinessOpenDrawer(stepId) {
  if (!_flakinessReport) return;
  const s = (_flakinessReport.stepRecords || []).find(r => r.stepId === stepId);
  if (!s) return;

  const drawer  = document.getElementById('flakiness-drawer');
  const overlay = document.getElementById('flakiness-drawer-overlay');
  const title   = document.getElementById('flakiness-drawer-title');
  const body    = document.getElementById('flakiness-drawer-body');
  if (!drawer || !body) return;

  title.textContent = s.stepName || s.stepId;

  const pct      = Math.round((s.flakinessScore || 0) * 100);
  const failPct  = Math.round((s.failRate || 0) * 100);
  const altPct   = Math.round((s.alternationIndex || 0) * 100);
  const status   = _flakinessStatus(s);
  const isInsuff = s.totalRuns < 3;
  const barColor = status === 'critical' ? 'var(--afl-danger)' : status === 'unstable' ? 'var(--afl-warn)' : 'var(--afl-pass)';
  const action   = _flakinessGetSuggestedAction(s);
  const hint     = _flakinessGetActionHint(s);
  const sig      = s.dominantSignature;

  body.innerHTML =
    // Score header
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">` +
    `${_flakinessStatusBadge(status, isInsuff)}` +
    `<span style="font-size:22px;font-weight:700;color:${barColor}">${pct}%</span>` +
    `<span style="font-size:12px;color:var(--afl-subtext);">flakiness score</span>` +
    `</div>` +

    // Stats grid
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">` +
    _drawerStat('Total Runs',  s.totalRuns,                       'var(--afl-brand)') +
    _drawerStat('Passed',      s.passedRuns,                      'var(--afl-pass)') +
    _drawerStat('Failed',      s.failedRuns,                      'var(--afl-danger)') +
    _drawerStat('Fail Rate',   failPct + '%',                     'var(--afl-danger)') +
    _drawerStat('Alternation', altPct + '%',                      'var(--afl-warn)', 'How often pass/fail alternates') +
    _drawerStat('Retries',     s.retryStats?.retryCount || 0,     'var(--afl-info)') +
    `</div>` +

    // Retry recovery
    (s.retryStats?.retryCount > 0 ? `
    <div style="background:var(--afl-section-bg);border:1px solid var(--afl-border);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--afl-text);">
      <span style="color:var(--afl-subtext);">Retry recovery: </span>
      ${s.retryStats.recoveredAfterRetry
        ? `<span style="color:var(--afl-pass);font-weight:600;">✓ Recovered after retry</span> — retrying helps`
        : `<span style="color:var(--afl-danger);font-weight:600;">✗ Did not recover</span> — retrying did not fix it`}
    </div>` : '') +

    // Failure type
    `<div style="margin-bottom:16px;">` +
    `<div style="font-size:11px;font-weight:600;color:var(--afl-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Failure Type</div>` +
    `<div style="font-size:13px;color:var(--afl-text);font-weight:500;">${_flakinessSignatureLabel(sig)}</div>` +
    (sig?.httpStatus    ? `<div style="font-size:11px;color:var(--afl-subtext);margin-top:2px;">HTTP ${sig.httpStatus}</div>` : '') +
    (sig?.transportError ? `<div style="font-size:11px;color:var(--afl-subtext);margin-top:2px;">${_flEsc(sig.transportError)}</div>` : '') +
    (sig?.assertionField ? `<div style="font-size:11px;color:var(--afl-subtext);margin-top:2px;">Field: ${_flEsc(sig.assertionField)}</div>` : '') +
    `</div>` +

    // Suggested action
    `<div style="background:var(--afl-section-bg);border:1px solid var(--afl-border);border-left:3px solid var(--afl-warn);border-radius:6px;padding:14px;margin-bottom:16px;">` +
    `<div style="font-size:11px;font-weight:600;color:var(--afl-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">💡 Suggested Action</div>` +
    `<div style="font-size:13px;color:var(--afl-warn);font-weight:600;margin-bottom:6px;">${_flEsc(action)}</div>` +
    `<div style="font-size:12px;color:var(--afl-subtext);line-height:1.6;">${_flEsc(hint)}</div>` +
    `</div>` +

    // Timestamps
    `<div style="font-size:11px;color:var(--afl-subtext);">` +
    (s.lastFailedAt ? `<div style="margin-bottom:3px;">Last failed: <span style="color:var(--afl-danger)">${new Date(s.lastFailedAt).toLocaleString()}</span></div>` : '') +
    (s.lastPassedAt ? `<div>Last passed: <span style="color:var(--afl-pass)">${new Date(s.lastPassedAt).toLocaleString()}</span></div>` : '') +
    `</div>` +

    // Link to Suggest Tests
    (!isInsuff ? `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--afl-border);">
      <div style="font-size:11px;color:var(--afl-muted);margin-bottom:8px;">Want to prevent this in future runs?</div>
      <button class="btn btn-sm btn-outline" onclick="flakinessCloseDrawer();showTab('api-collections')">
        → Open API Collections → Suggest Tests
      </button>
    </div>` : '');

  drawer.style.display  = '';
  overlay.style.display = '';
}

function flakinessCloseDrawer() {
  const drawer  = document.getElementById('flakiness-drawer');
  const overlay = document.getElementById('flakiness-drawer-overlay');
  if (drawer)  drawer.style.display  = 'none';
  if (overlay) overlay.style.display = 'none';
}

function _drawerStat(label, value, color, title) {
  return `<div style="background:var(--afl-card-bg);border:1px solid var(--afl-border);border-radius:6px;padding:10px 12px;${title ? 'cursor:help' : ''}" ${title ? `title="${_flEsc(title)}"` : ''}>` +
    `<div style="font-size:18px;font-weight:700;color:${color}">${value}</div>` +
    `<div style="font-size:11px;color:var(--afl-subtext);margin-top:2px;">${label}</div>` +
    `</div>`;
}

// ── Deterministic Action Engine ───────────────────────────────────────────────

function _flakinessGetSuggestedAction(s) {
  const sig      = s.dominantSignature;
  const failPct  = (s.failRate || 0) * 100;
  const flakePct = (s.flakinessScore || 0) * 100;
  const cat      = sig?.category;
  const code     = sig?.httpStatus;

  if (cat === 'http_status' || cat === 'timeout') {
    if (code === 504 || code === 408 || cat === 'timeout') return 'Increase timeout on this request';
    if (code === 401) return 'Check auth token — may be expired';
    if (code === 403) return 'Review role/permissions for this environment';
    if (code === 404) return 'Verify endpoint URL in this environment';
    if (code === 405) return 'Verify HTTP method is correct';
    if (code === 429) return 'Add retry with backoff — rate limit hit';
    if (code === 500) return 'Add retry with backoff — server error';
    if (code === 502 || code === 503) return 'Downstream instability — add retry with backoff';
  }
  if (cat === 'network') {
    if (sig?.transportError === 'ECONNREFUSED') return 'Check environment URL — service unreachable';
    if (sig?.transportError === 'ETIMEDOUT')    return 'Increase timeout — connection timed out';
    return 'Check network connectivity to target environment';
  }
  if (cat === 'auth')                   return 'Review Token Lifecycle — add Token Lifecycle tests';
  if (cat === 'dependency_propagation') return 'Fix the upstream request that this one depends on';
  if (cat === 'assertion') {
    if (sig?.assertionField?.startsWith('body'))   return 'Review baseline — response body may have changed';
    if (sig?.assertionField?.startsWith('header')) return 'Check response headers — add Content-Type tests';
    if (sig?.assertionField?.startsWith('status')) return 'Expected status mismatch — review Contract tests';
    return 'Review assertion rules — add Contract tests';
  }

  if (failPct > 70 && flakePct < 30)  return 'Consistent failure — request is broken, not flaky';
  if (failPct < 20 && flakePct > 60)  return 'Intermittent — add 1–2 retries with delay';
  if (s.alternationIndex > 0.7)        return 'High alternation — add Idempotency tests';
  if (s.retryStats?.retryCount > 5)    return 'Too many retries — check Boundary/Edge conditions';

  return 'Review recent run history for recurring pattern';
}

function _flakinessGetActionHint(s) {
  const sig     = s.dominantSignature;
  const cat     = sig?.category;
  const code    = sig?.httpStatus;
  const failPct = (s.failRate || 0) * 100;

  if (cat === 'timeout' || code === 408 || code === 504)
    return 'Go to API Collections → edit this request → Settings tab → increase Timeout value. Also consider adding 1 retry.';
  if (code === 401 || code === 403 || cat === 'auth')
    return 'Check the environment credentials in API Environments. Use "Suggest Tests → Token Lifecycle" to add token expiry test cases.';
  if (code === 429)
    return 'Add a retry with 2–5 second delay. Use "Suggest Tests → Boundary" to add rate limit test cases.';
  if (cat === 'network')
    return 'Verify the base URL in your API Environment matches the running service. Check if the service is up in this environment.';
  if (cat === 'dependency_propagation')
    return 'Look at the request that runs before this one in the collection. That request is failing and causing this one to be skipped or fail too.';
  if (cat === 'assertion')
    return 'Open API Collections → edit this request → Rules tab → review your assertions. Use "Suggest Tests → Contract" to add schema checks.';
  if (failPct > 70)
    return 'This request fails consistently — it is likely broken, not flaky. Fix the underlying issue before adding retries.';
  if (s.alternationIndex > 0.7)
    return 'The request alternates between pass and fail. Use "Suggest Tests → Idempotency" to verify the API behaves consistently on repeated calls.';

  return 'Open API Collections → run the collection a few more times → then Recompute to get a clearer picture.';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _flakinessStatus(s) {
  if (s.totalRuns < 3) return 'insufficient';
  const pct = (s.flakinessScore || 0) * 100;
  if (pct >= 61) return 'critical';
  if (pct >= 31) return 'unstable';
  return 'stable';
}

function _flakinessStatusBadge(status, isInsuff) {
  if (isInsuff || status === 'insufficient')
    return '<span style="font-size:10px;color:var(--afl-insuff-text);background:var(--afl-insuff-bg);border-radius:4px;padding:2px 8px;">Insufficient</span>';
  if (status === 'critical')
    return '<span style="font-size:10px;color:var(--afl-critical-text);background:var(--afl-critical-bg);border-radius:4px;padding:2px 8px;font-weight:600;">⚡ Critical</span>';
  if (status === 'unstable')
    return '<span style="font-size:10px;color:var(--afl-unstable-text);background:var(--afl-unstable-bg);border-radius:4px;padding:2px 8px;font-weight:600;">⚠ Unstable</span>';
  return '<span style="font-size:10px;color:var(--afl-stable-text);background:var(--afl-stable-bg);border-radius:4px;padding:2px 8px;">✓ Stable</span>';
}

function _flakinessSignatureLabel(sig) {
  if (!sig) return '—';
  const labels = {
    assertion:             '📋 Assertion failed',
    http_status:           '🌐 HTTP ' + (sig.httpStatus || 'error'),
    timeout:               '⏱ Timeout',
    network:               '🔌 Network error',
    auth:                  '🔑 Auth failure',
    dependency_propagation:'🔗 Dependency failure',
    unknown:               '❓ Unknown'
  };
  return labels[sig.category] || _flEsc(sig.category);
}

function _flakinessShowState(state) {
  const ids = {
    empty:   'flakiness-empty',
    loading: 'flakiness-loading',
    table:   'flakiness-table-wrap'
  };
  Object.values(ids).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(ids[state]);
  if (target) target.style.display = '';

  const showMeta = state === 'table';
  const tabs = document.getElementById('flakiness-filter-tabs');
  const bar  = document.getElementById('flakiness-summary-bar');
  if (tabs) tabs.style.display = showMeta ? '' : 'none';
  if (bar)  bar.style.display  = showMeta ? '' : 'none';
}

function _flAlert(type, msg) {
  const el = document.getElementById('flakiness-alert');
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}" style="margin-bottom:10px;">${_flEsc(msg)}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function _flEsc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
