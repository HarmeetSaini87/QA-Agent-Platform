// showToast is defined in 02-shared-helpers.js — signature: showToast(type, msg, ms)

// Flaky Test Detection
// ══════════════════════════════════════════════════════════════════════════════

let _flakyAllTests = [];
let _flakyFilter = 'all';
let _flakyTop10 = false;
let _flakyPage = 0;
let _flakyPageSize = 25;
let _flakyTotal = 0;

function flakyToggleTop10() {
  _flakyTop10 = !_flakyTop10;
  const btn = document.getElementById('flaky-top10-btn');
  if (btn) btn.classList.toggle('active', _flakyTop10);
  flakyRender();
}

function flakySetFilter(f) {
  _flakyFilter = f;
  document.querySelectorAll('.flaky-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f));
  flakyRender();
}

async function flakyLoad(resetPage = true) {
  if (!currentProjectId) {
    const loadEl = document.getElementById('flaky-loading');
    if (loadEl) { loadEl.style.display = ''; loadEl.textContent = 'Select a project to analyse flaky tests.'; }
    ['flaky-summary-bar', 'flaky-table-wrap', 'flaky-empty', 'flaky-filter-tabs', 'flaky-budget-banner', 'flaky-pagination']
      .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    return;
  }

  // FIX: read suiteId BEFORE repopulating the dropdown to preserve user selection
  const suiteSel = document.getElementById('flaky-suite-filter');
  const prevSuiteId = suiteSel?.value || '';
  if (suiteSel && typeof allSuites !== 'undefined') {
    const proj = allSuites.filter(s => s.projectId === currentProjectId);
    suiteSel.innerHTML = '<option value="">All Suites</option>' +
      proj.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
    if (prevSuiteId) suiteSel.value = prevSuiteId; // restore selection after repopulate
  }

  const suiteId = suiteSel?.value || '';
  const sort = document.getElementById('flaky-sort')?.value || 'flakeScore';
  if (resetPage) _flakyPage = 0;

  const loadEl = document.getElementById('flaky-loading');
  if (loadEl) { loadEl.style.display = ''; loadEl.textContent = 'Analysing runs…'; }
  ['flaky-summary-bar', 'flaky-table-wrap', 'flaky-empty', 'flaky-filter-tabs', 'flaky-budget-banner', 'flaky-pagination']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

  // Fetch all (up to 200) for client-side filter counts, then paginate client-side
  let url = `/api/flaky?projectId=${encodeURIComponent(currentProjectId)}&limit=200&sort=${encodeURIComponent(sort)}`;
  if (suiteId) url += `&suiteId=${encodeURIComponent(suiteId)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) { if (loadEl) loadEl.textContent = 'Failed to load flaky data.'; return; }
    const data = await res.json();
    _flakyAllTests = data.tests || [];
  } catch (e) {
    if (loadEl) loadEl.textContent = 'Error loading flaky data.';
    return;
  }

  if (loadEl) loadEl.style.display = 'none';

  if (_flakyAllTests.length === 0) {
    const empty = document.getElementById('flaky-empty');
    if (empty) empty.style.display = '';
    return;
  }

  const tabs = document.getElementById('flaky-filter-tabs');
  if (tabs) tabs.style.display = '';
  flakyRender();
}

function flakyRender() {
  let tests = [..._flakyAllTests];
  if (_flakyFilter === 'flagged') tests = tests.filter(t => t.evaluationState === 'evaluated' && t.shouldQuarantine && !t.isQuarantined);
  if (_flakyFilter === 'quarantined') tests = tests.filter(t => t.isQuarantined);
  if (_flakyFilter === 'insufficient') tests = tests.filter(t => t.evaluationState === 'insufficient_data');
  if (_flakyTop10) tests = tests.slice(0, 10);

  const total = _flakyAllTests.length;
  const quarantined = _flakyAllTests.filter(t => t.isQuarantined).length;
  const flagged = _flakyAllTests.filter(t => t.shouldQuarantine && !t.isQuarantined).length;

  const summaryBar = document.getElementById('flaky-summary-bar');
  if (summaryBar) {
    summaryBar.style.display = '';
    summaryBar.innerHTML = `
      <span style="color:var(--flaky-text);font-size:13px">
        ${total} tests &nbsp;·&nbsp;
        <span style="color:var(--flaky-danger)">${quarantined} quarantined</span> &nbsp;·&nbsp;
        <span style="color:var(--flaky-warn)">${flagged} flagged</span>
      </span>`;
  }

  const empty = document.getElementById('flaky-empty');
  const wrap = document.getElementById('flaky-table-wrap');
  if (tests.length === 0) {
    if (empty) empty.style.display = '';
    if (wrap) wrap.style.display = 'none';
    _flakyRenderPagination(0, 0);
    return;
  }
  if (empty) empty.style.display = 'none';
  if (wrap) wrap.style.display = '';

  // Pagination
  const filteredTotal = tests.length;
  const pageSize = _flakyTop10 ? filteredTotal : _flakyPageSize;
  const totalPages = _flakyTop10 ? 1 : Math.ceil(filteredTotal / pageSize);
  if (_flakyPage >= totalPages) _flakyPage = Math.max(0, totalPages - 1);
  const paged = _flakyTop10 ? tests : tests.slice(_flakyPage * pageSize, (_flakyPage + 1) * pageSize);

  const tbody = document.getElementById('flaky-tbody');
  if (tbody) tbody.innerHTML = paged.map(t => flakyRow(t)).join('');

  _flakyRenderPagination(filteredTotal, totalPages);
}

function _flakyRenderPagination(filteredTotal, totalPages) {
  let pg = document.getElementById('flaky-pagination');
  if (!pg) return;
  if (filteredTotal === 0 || _flakyTop10) { pg.style.display = 'none'; return; }

  const pageSize = _flakyPageSize;
  const start = _flakyPage * pageSize + 1;
  const end = Math.min((_flakyPage + 1) * pageSize, filteredTotal);

  pg.style.display = 'flex';
  pg.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--flaky-text)">
        ${start}–${end} of ${filteredTotal}
      </span>
      <div style="display:flex;align-items:center;gap:6px">
        <label style="font-size:12px;color:var(--flaky-text)">Rows:</label>
        <select class="fm-input" style="height:26px;font-size:12px;padding:0 4px;width:70px"
          onchange="_flakySetPageSize(parseInt(this.value))">
          ${[10,25,50,100].map(n =>
            `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n}</option>`
          ).join('')}
        </select>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-xs btn-outline" onclick="_flakyGoPage(0)" ${_flakyPage === 0 ? 'disabled' : ''} title="First">«</button>
        <button class="btn btn-xs btn-outline" onclick="_flakyGoPage(${_flakyPage - 1})" ${_flakyPage === 0 ? 'disabled' : ''} title="Previous">‹</button>
        <span style="font-size:12px;color:var(--flaky-text);padding:2px 8px;align-self:center">
          Page ${_flakyPage + 1} / ${totalPages}
        </span>
        <button class="btn btn-xs btn-outline" onclick="_flakyGoPage(${_flakyPage + 1})" ${_flakyPage >= totalPages - 1 ? 'disabled' : ''} title="Next">›</button>
        <button class="btn btn-xs btn-outline" onclick="_flakyGoPage(${totalPages - 1})" ${_flakyPage >= totalPages - 1 ? 'disabled' : ''} title="Last">»</button>
      </div>
    </div>`;
}

function _flakyGoPage(p) {
  _flakyPage = p;
  flakyRender();
}

function _flakySetPageSize(n) {
  _flakyPageSize = n;
  _flakyPage = 0;
  flakyRender();
}

function flakyRow(t) {
  const isInsuff = t.evaluationState === 'insufficient_data';
  // OLD: const rowStyle = isInsuff ? 'opacity:0.5' : '';
  // opacity:0.5 on the <tr> made all child colors appear faded — CSS child opacity can't exceed parent.
  // Status label + muted color already signal insufficient state; row opacity is redundant.
  const rowStyle = '';
  const newBadge = t.quarantinedAt && (Date.now() - new Date(t.quarantinedAt).getTime() < 86400000)
    ? '<span class="flaky-badge-new">NEW</span>' : '';
  const autoBadge = t.isQuarantined
    ? `<span class="flaky-badge-q">${t.autoQuarantined ? '⛔ Auto' : '⛔ Manual'}</span>` : '';

  const statusLabel = t.isQuarantined ? 'Quarantined' : isInsuff ? 'Insufficient' : t.shouldQuarantine ? 'Flagged' : 'Active';
  const statusColor = t.isQuarantined ? 'var(--flaky-danger)' : isInsuff ? 'var(--flaky-muted)' : t.shouldQuarantine ? 'var(--flaky-warn)' : 'var(--flaky-pass)';

  let scoreCell = '—';
  if (!isInsuff && t.flakeScore !== undefined) {
    const sc = t.flakeScore;
    const thr = 0.30;
    const near = Math.abs(sc - thr) < 0.05;
    const color = sc >= thr ? 'var(--flaky-danger)' : near ? 'var(--flaky-warn)' : 'var(--flaky-pass)';
    const arrow = sc >= thr ? ' ↑' : '';
    const tooltip = sc >= thr ? `Above threshold (${thr})` : near ? `Near threshold (${thr})` : `Below threshold (${thr})`;
    scoreCell = `<span style="color:${color};font-weight:700" title="${tooltip}">${sc.toFixed(2)}${arrow}</span>`;
  }

  const confLabel = !isInsuff && t.confidence !== undefined
    ? (t.confidence >= 0.7 ? 'High' : t.confidence >= 0.4 ? 'Med' : 'Low') : '—';

  const sparkline = (t.recentRunsPreview || []).map(r =>
    `<span style="color:${r.status === 'pass' ? 'var(--flaky-pass)' : 'var(--flaky-danger)'};font-size:10px;font-weight:700">${r.status === 'pass' ? 'P' : 'F'}</span>`
  ).join('');

  const cat = t.classification?.primary ?? '—';
  const catColor = { network: 'var(--flaky-network)', timing: 'var(--flaky-warn)', locator: 'var(--flaky-locator)', assertion: 'var(--flaky-danger)', environment: 'var(--flaky-env)', unknown: 'var(--flaky-muted)' }[cat] || 'var(--flaky-muted)';
  const catCell = cat !== '—' ? `<span style="color:${catColor};font-size:11px">${cat}</span>` : '—';

  const lastRun = t.lastRunAt ? _flakyFmtDate(t.lastRunAt) : '—';
  const lastFail = t.lastFailureAt ? _flakyFmtDate(t.lastFailureAt) : '—';

  let actionBtns = '';
  if (t.isQuarantined) {
    actionBtns = `<button class="btn btn-xs btn-outline" onclick="flakyRestore('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')" title="Restore from quarantine">Restore</button>`;
  } else if (!isInsuff) {
    actionBtns = `<button class="btn btn-xs btn-outline" onclick="flakyQuarantine('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')" title="Manually quarantine">Quarantine</button>`;
  } else {
    // Insufficient data — allow manual quarantine override, clearly labelled
    actionBtns = `<button class="btn btn-xs btn-outline" style="opacity:0.75" onclick="flakyQuarantineInsuff('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')" title="Force quarantine — overrides insufficient data state">Force Quarantine</button>`;
  }

  const expandId = `flaky-expand-${escHtml(t.testId)}`;

  return `
    <tr style="${rowStyle};cursor:pointer" onclick="flakyToggleExpand('${escHtml(t.testId)}')">
      <td style="font-weight:600;max-width:280px;word-break:break-word">
        ${escHtml(t.testName)} ${newBadge} ${autoBadge}
      </td>
      <td style="color:${statusColor};font-size:12px;font-weight:600">${statusLabel}</td>
      <td style="text-align:center">${scoreCell}</td>
      <td style="text-align:center;font-size:12px;color:var(--neutral-400)">${confLabel}</td>
      <td style="letter-spacing:2px">${sparkline}</td>
      <td style="text-align:center">${catCell}</td>
      <td style="font-size:12px;color:var(--neutral-400)">${lastRun}</td>
      <td style="font-size:12px;color:var(--neutral-400)">${lastFail}</td>
      <td onclick="event.stopPropagation()">${actionBtns}</td>
    </tr>
    <tr id="${expandId}" style="display:none">
      <td colspan="9" style="background:var(--bg-2);padding:16px">
        ${flakyExpandedRow(t)}
      </td>
    </tr>`;
}

function flakyExpandedRow(t) {
  if (t.evaluationState === 'insufficient_data') {
    return `<div style="color:var(--flaky-muted);font-size:13px">Insufficient data — need ≥5 runs to compute flake score.</div>`;
  }

  const thr = 0.30;
  const eligible = t.shouldQuarantine ? '✔ Eligible for auto-quarantine' : `Below threshold (${thr})`;

  const history = (t.recentRunsPreview || []).map(r =>
    `<span style="color:${r.status === 'pass' ? 'var(--flaky-pass)' : 'var(--flaky-danger)'};font-weight:700">${r.status === 'pass' ? 'P' : 'F'}</span>`
  ).join(' ');

  const sig = t.signals || {};
  const sigLines = [];
  if (sig.timeout) sigLines.push('· Timeout detected');
  if (sig.slowTest) sigLines.push(`· Avg failure duration: ${((sig.durationMs || 0) / 1000).toFixed(1)}s (baseline p95: ${((sig.baselineP95 || 0) / 1000).toFixed(1)}s)`);
  if (sig.networkError) sigLines.push('· Network error detected (ECONNRESET / fetch failed)');
  if (sig.locatorError) sigLines.push('· Locator instability detected');
  if (sig.assertionError) sigLines.push('· Assertion failure pattern');
  if (sig.recentFailSpike) sigLines.push('· ⚠ Consistent recent failures (all recent runs failed)');
  if (sig.rawErrors?.length) sigLines.push(`· Last error: <code style="font-size:11px">${escHtml(sig.rawErrors[sig.rawErrors.length - 1].slice(0, 120))}</code>`);

  const dominant = t.dominantCategory
    ? `Dominant cause: <strong>${t.dominantCategory}</strong> (${t.dominantCategoryCount}/${t.dominantCategoryTotal} recent failures)`
    : '';

  let qBlock = '';
  if (t.isQuarantined) {
    const qDate = t.quarantinedAt ? _flakyFmtDate(t.quarantinedAt) : '—';
    const promoteElig = t.shouldAutoPromote ? '✔ Eligible for auto-promote' : 'Not yet eligible for auto-promote';
    qBlock = `
      <div style="margin-top:12px;padding:10px;border:1px solid #f4877155;border-radius:6px">
        <div style="font-size:12px;font-weight:600;color:#f48771;margin-bottom:6px">⛔ Quarantine Status: Active</div>
        <div style="font-size:12px;color:var(--neutral-400)">Quarantined: ${qDate} (${t.autoQuarantined ? 'auto' : 'manual'})</div>
        <div style="font-size:12px;color:var(--neutral-400)">Reason: ${escHtml(t.quarantineReason || '—')}</div>
        <div style="font-size:12px;color:var(--neutral-400)">${promoteElig}</div>
        <button class="btn btn-sm btn-outline" style="margin-top:8px" onclick="flakyRestore('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')">Restore Manually</button>
      </div>`;
  }

  return `
    <div style="display:grid;gap:12px">
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--neutral-500);margin-bottom:4px">Decision</div>
        <div style="font-size:13px">Flake Score: <strong>${(t.flakeScore || 0).toFixed(2)}</strong> &nbsp; Threshold: ${thr} &nbsp; ${eligible}</div>
        <div style="font-size:12px;color:var(--neutral-400)">Confidence: ${t.confidence >= 0.7 ? 'High' : t.confidence >= 0.4 ? 'Med' : 'Low'} &nbsp;·&nbsp; Last run: ${t.lastRunAt ? _flakyFmtDate(t.lastRunAt) : '—'} &nbsp;·&nbsp; Last failure: ${t.lastFailureAt ? _flakyFmtDate(t.lastFailureAt) : '—'}</div>
      </div>
      ${sigLines.length ? `<div><div style="font-size:11px;text-transform:uppercase;color:var(--neutral-500);margin-bottom:4px">Signals</div><div style="font-size:12px;color:var(--neutral-300);line-height:1.8">${sigLines.join('<br>')}</div></div>` : ''}
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--neutral-500);margin-bottom:4px">History (last 10)</div>
        <div style="letter-spacing:4px;font-size:13px">${history || '—'}</div>
      </div>
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--neutral-500);margin-bottom:4px">Classification</div>
        <div style="font-size:13px">Primary: <strong>${t.classification?.primary || '—'}</strong> (${((t.classification?.primaryConfidence || 0) * 100).toFixed(0)}%)
          ${t.classification?.secondary ? `&nbsp;·&nbsp; Secondary: ${t.classification.secondary}` : ''}
        </div>
        ${dominant ? `<div style="font-size:12px;color:var(--neutral-400)">${dominant}</div>` : ''}
        ${t.actionHint ? `<div style="font-size:12px;color:#dcdcaa;margin-top:4px">💡 ${escHtml(t.actionHint)}</div>` : ''}
      </div>
      ${qBlock}
    </div>`;
}

function flakyToggleExpand(testId) {
  const el = document.getElementById(`flaky-expand-${testId}`);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function _flakyFmtDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString();
  } catch { return '—'; }
}

async function flakyQuarantine(suiteId, testId, testName) {
  if (!confirm('This will exclude the test from suite pass/fail. Continue?')) return;
  const res = await fetch('/api/flaky/quarantine', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suiteId, testId, testName, reason: 'manual' })
  });
  if (res.ok) { showToast('info', 'Test quarantined.'); flakyLoad(); }
  else showToast('error', 'Quarantine failed.');
}

async function flakyQuarantineInsuff(suiteId, testId, testName) {
  if (!confirm(`Force quarantine "${testName}"?\n\nThis test has insufficient run history to score automatically. Quarantining manually will exclude it from suite pass/fail immediately.\n\nContinue?`)) return;
  const res = await fetch('/api/flaky/quarantine', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suiteId, testId, testName, reason: 'manual-insufficient' })
  });
  if (res.ok) { showToast('info', 'Test force-quarantined.'); flakyLoad(); }
  else showToast('error', 'Quarantine failed.');
}

async function flakyRestore(suiteId, testId, testName) {
  if (!confirm(`Restore "${testName}" from quarantine? It will affect pipeline results again.`)) return;
  const res = await fetch('/api/flaky/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suiteId, testId })
  });
  if (res.ok) { showToast('info', 'Test restored from quarantine.'); flakyLoad(); }
  else showToast('error', 'Restore failed.');
}

// Flakiness Config (Suite Settings)
// ══════════════════════════════════════════════════════════════════════════════

const FLAKY_PRESETS = { smoke: 20, regression: 30, e2e: 40 };

async function flakyConfigLoad(suiteId, projectId) {
  if (!suiteId || !projectId) return;
  try {
    const res = await fetch(`/api/flaky/config?projectId=${encodeURIComponent(projectId)}&suiteId=${encodeURIComponent(suiteId)}`);
    if (!res.ok) return;
    const { effective, projectDefaults } = await res.json();
    const g = id => document.getElementById(id);
    if (g('flaky-cfg-threshold')) g('flaky-cfg-threshold').value = Math.round((effective.threshold || 0.30) * 100);
    if (g('flaky-cfg-minruns')) g('flaky-cfg-minruns').value = effective.minRuns || 5;
    if (g('flaky-cfg-budget')) g('flaky-cfg-budget').value = effective.quarantineBudget ?? 5;
    if (g('flaky-cfg-passrate')) g('flaky-cfg-passrate').value = Math.round((effective.autoPromoteMinPassRate || 0.95) * 100);
    const projThr = g('flaky-cfg-proj-threshold');
    if (projThr) projThr.textContent = `(Project default: ${Math.round((projectDefaults?.threshold || 0.30) * 100)}%)`;
  } catch (e) { console.warn('flakyConfigLoad error', e); }
}

function flakyApplyPreset() {
  const preset = document.getElementById('flaky-preset').value;
  const t = document.getElementById('flaky-cfg-threshold');
  const m = document.getElementById('flaky-cfg-minruns');
  const b = document.getElementById('flaky-cfg-budget');
  const p = document.getElementById('flaky-cfg-passrate');

  if (preset === 'smoke') {
    if (t) t.value = 20; if (m) m.value = 3; if (b) b.value = 2; if (p) p.value = 98;
  } else if (preset === 'regression') {
    if (t) t.value = 30; if (m) m.value = 5; if (b) b.value = 5; if (p) p.value = 95;
  } else if (preset === 'e2e') {
    if (t) t.value = 40; if (m) m.value = 5; if (b) b.value = 5; if (p) p.value = 90;
  } else {
    // Custom — populate with project-standard defaults so fields are never blank
    if (t) t.value = 30; if (m) m.value = 5; if (b) b.value = 5; if (p) p.value = 95;
  }
}

async function flakyConfigSave() {
  const suiteId = window._editingSuiteId || editingSuiteId;
  const projectId = currentProjectId;
  if (!suiteId || !projectId) { showToast('info', 'No suite selected.'); return; }

  const threshold = parseFloat(document.getElementById('flaky-cfg-threshold')?.value || '');
  const minRuns = parseInt(document.getElementById('flaky-cfg-minruns')?.value || '');
  const budget = parseInt(document.getElementById('flaky-cfg-budget')?.value || '');
  const passRate = parseFloat(document.getElementById('flaky-cfg-passrate')?.value || '');

  const overrides = {};
  if (!isNaN(threshold)) overrides.threshold = threshold / 100;
  if (!isNaN(minRuns)) overrides.minRuns = minRuns;
  if (!isNaN(budget)) overrides.quarantineBudget = budget;
  if (!isNaN(passRate)) overrides.autoPromoteMinPassRate = passRate / 100;

  try {
    const res = await fetch('/api/flaky/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, suiteId, overrides })
    });
    if (res.ok) {
      showToast('info', 'Flakiness config saved.');
    } else {
      const e = await res.json();
      showToast('error', 'Save failed: ' + ((e.errors || []).join(', ') || 'unknown error'));
    }
  } catch { showToast('error', 'Save failed.'); }
}

async function flakyConfigReset() {
  const suiteId = window._editingSuiteId || editingSuiteId;
  const projectId = currentProjectId;

  // Scenario 1: New suite — no suiteId yet, just reset fields to Custom defaults
  if (!suiteId) {
    const presetEl = document.getElementById('flaky-preset');
    if (presetEl) presetEl.value = '';
    flakyApplyPreset();
    showToast('info', 'Reset to default values.');
    return;
  }

  if (!projectId) return;
  if (!confirm('Reset suite flakiness config to project defaults?')) return;

  try {
    await fetch('/api/flaky/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, suiteId, overrides: {} })
    });
    await flakyConfigLoad(suiteId, projectId);
    // Scenario 2: Reset preset dropdown to Custom — project defaults don't map to any named preset
    const presetEl = document.getElementById('flaky-preset');
    if (presetEl) presetEl.value = '';
    showToast('info', 'Reset to project defaults.');
  } catch { showToast('error', 'Reset failed.'); }
}

