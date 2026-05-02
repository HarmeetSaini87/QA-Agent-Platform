// ══════════════════════════════════════════════════════════════════════════════
// Toast notification helper
// ══════════════════════════════════════════════════════════════════════════════
function showToast(msg, level) {
  const d = document.createElement('div');
  const bg = level === 'error' ? '#f48771' : level === 'warn' ? '#dcdcaa' : '#4ec9b0';
  d.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 18px;border-radius:6px;font-size:13px;font-weight:600;color:#1e1e1e;background:${bg};box-shadow:0 2px 8px rgba(0,0,0,0.3)`;
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 4000);
}

// Flaky Test Detection
// ══════════════════════════════════════════════════════════════════════════════

let _flakyAllTests = [];
let _flakyFilter = 'all';
let _flakyTop10 = false;

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

async function flakyLoad() {
  if (!currentProjectId) {
    const loadEl = document.getElementById('flaky-loading');
    if (loadEl) { loadEl.style.display = ''; loadEl.textContent = 'Select a project to analyse flaky tests.'; }
    ['flaky-summary-bar', 'flaky-table-wrap', 'flaky-empty', 'flaky-filter-tabs', 'flaky-budget-banner']
      .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    return;
  }

  const suiteSel = document.getElementById('flaky-suite-filter');
  if (suiteSel && typeof allSuites !== 'undefined') {
    const proj = allSuites.filter(s => s.projectId === currentProjectId);
    suiteSel.innerHTML = '<option value="">All Suites</option>' +
      proj.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
  }

  const suiteId = document.getElementById('flaky-suite-filter')?.value || '';
  const sort = document.getElementById('flaky-sort')?.value || 'flakeScore';
  const loadEl = document.getElementById('flaky-loading');
  if (loadEl) { loadEl.style.display = ''; loadEl.textContent = 'Analysing runs…'; }
  ['flaky-summary-bar', 'flaky-table-wrap', 'flaky-empty', 'flaky-filter-tabs', 'flaky-budget-banner']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

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
      <span style="color:var(--neutral-300);font-size:13px">
        ${total} tests &nbsp;·&nbsp;
        <span style="color:#f48771">${quarantined} quarantined</span> &nbsp;·&nbsp;
        <span style="color:#dcdcaa">${flagged} flagged</span>
      </span>`;
  }

  const empty = document.getElementById('flaky-empty');
  const wrap = document.getElementById('flaky-table-wrap');
  if (tests.length === 0) {
    if (empty) empty.style.display = '';
    if (wrap) wrap.style.display = 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  if (wrap) wrap.style.display = '';

  const tbody = document.getElementById('flaky-tbody');
  if (tbody) tbody.innerHTML = tests.map(t => flakyRow(t)).join('');
}

function flakyRow(t) {
  const isInsuff = t.evaluationState === 'insufficient_data';
  const rowStyle = isInsuff ? 'opacity:0.5' : '';
  const newBadge = t.quarantinedAt && (Date.now() - new Date(t.quarantinedAt).getTime() < 86400000)
    ? '<span class="flaky-badge-new">NEW</span>' : '';
  const autoBadge = t.isQuarantined
    ? `<span class="flaky-badge-q">${t.autoQuarantined ? '⛔ Auto' : '⛔ Manual'}</span>` : '';

  const statusLabel = t.isQuarantined ? 'Quarantined' : isInsuff ? 'Insufficient' : t.shouldQuarantine ? 'Flagged' : 'Active';
  const statusColor = t.isQuarantined ? '#f48771' : isInsuff ? '#858585' : t.shouldQuarantine ? '#dcdcaa' : '#4ec9b0';

  let scoreCell = '—';
  if (!isInsuff && t.flakeScore !== undefined) {
    const sc = t.flakeScore;
    const thr = 0.30;
    const near = Math.abs(sc - thr) < 0.05;
    const color = sc >= thr ? '#f48771' : near ? '#dcdcaa' : '#4ec9b0';
    const arrow = sc >= thr ? ' ↑' : '';
    const tooltip = sc >= thr ? `Above threshold (${thr})` : near ? `Near threshold (${thr})` : `Below threshold (${thr})`;
    scoreCell = `<span style="color:${color};font-weight:700" title="${tooltip}">${sc.toFixed(2)}${arrow}</span>`;
  }

  const confLabel = !isInsuff && t.confidence !== undefined
    ? (t.confidence >= 0.7 ? 'High' : t.confidence >= 0.4 ? 'Med' : 'Low') : '—';

  const sparkline = (t.recentRunsPreview || []).map(r =>
    `<span style="color:${r.status === 'pass' ? '#4ec9b0' : '#f48771'};font-size:10px;font-weight:700">${r.status === 'pass' ? 'P' : 'F'}</span>`
  ).join('');

  const cat = t.classification?.primary ?? '—';
  const catColor = { network: '#569cd6', timing: '#dcdcaa', locator: '#9cdcfe', assertion: '#f48771', environment: '#ce9178', unknown: '#858585' }[cat] || '#858585';
  const catCell = cat !== '—' ? `<span style="color:${catColor};font-size:11px">${cat}</span>` : '—';

  const lastRun = t.lastRunAt ? _flakyFmtDate(t.lastRunAt) : '—';
  const lastFail = t.lastFailureAt ? _flakyFmtDate(t.lastFailureAt) : '—';

  let actionBtns = '';
  if (!isInsuff) {
    if (t.isQuarantined) {
      actionBtns = `<button class="btn btn-xs btn-outline" onclick="flakyRestore('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')" title="Restore from quarantine">Restore</button>`;
    } else {
      actionBtns = `<button class="btn btn-xs btn-outline" onclick="flakyQuarantine('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')" title="Manually quarantine">Quarantine</button>`;
    }
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
    return `<div style="color:#858585;font-size:13px">Insufficient data — need ≥5 runs to compute flake score.</div>`;
  }

  const thr = 0.30;
  const eligible = t.shouldQuarantine ? '✔ Eligible for auto-quarantine' : `Below threshold (${thr})`;

  const history = (t.recentRunsPreview || []).map(r =>
    `<span style="color:${r.status === 'pass' ? '#4ec9b0' : '#f48771'};font-weight:700">${r.status === 'pass' ? 'P' : 'F'}</span>`
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
  if (res.ok) { showToast('Test quarantined.', 'info'); flakyLoad(); }
  else showToast('Quarantine failed.', 'error');
}

async function flakyRestore(suiteId, testId, testName) {
  if (!confirm(`Restore "${testName}" from quarantine? It will affect pipeline results again.`)) return;
  const res = await fetch('/api/flaky/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suiteId, testId })
  });
  if (res.ok) { showToast('Test restored from quarantine.', 'info'); flakyLoad(); }
  else showToast('Restore failed.', 'error');
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
  if (!suiteId || !projectId) { showToast('No suite selected.', 'warn'); return; }

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
      showToast('Flakiness config saved.', 'info');
    } else {
      const e = await res.json();
      showToast('Save failed: ' + ((e.errors || []).join(', ') || 'unknown error'), 'error');
    }
  } catch { showToast('Save failed.', 'error'); }
}

async function flakyConfigReset() {
  const suiteId = window._editingSuiteId || editingSuiteId;
  const projectId = currentProjectId;

  // Scenario 1: New suite — no suiteId yet, just reset fields to Custom defaults
  if (!suiteId) {
    const presetEl = document.getElementById('flaky-preset');
    if (presetEl) presetEl.value = '';
    flakyApplyPreset();
    showToast('Reset to default values.', 'info');
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
    showToast('Reset to project defaults.', 'info');
  } catch { showToast('Reset failed.', 'error'); }
}

