
// ══════════════════════════════════════════════════════════════════════════════
// EXECUTION HISTORY MODULE
// ══════════════════════════════════════════════════════════════════════════════

let _histRuns = [];
let _histSortCol = 'startedAt';
let _histSortDir = -1; // -1 = desc, 1 = asc

async function histLoad() {
  if (!currentProjectId) {
    _histRuns = [];
    histRender();
    return;
  }
  try {
    const res = await fetch(`/api/runs?projectId=${encodeURIComponent(currentProjectId)}`);
    _histRuns = res.ok ? await res.json() : [];
  } catch { _histRuns = []; }
  _histPopulateEnvFilter();
  histRender();
}

function _histPopulateEnvFilter() {
  const sel = document.getElementById('hist-filter-env');
  if (!sel) return;
  const envs = [...new Set(_histRuns.map(r => r.environmentName).filter(Boolean))];
  sel.innerHTML = '<option value="">All Environments</option>' +
    envs.map(e => `<option value="${escHtml(e)}">${escHtml(e)}</option>`).join('');
}

function histRender() {
  const tbody = document.getElementById('hist-tbody');
  const emptyEl = document.getElementById('hist-empty');
  if (!tbody) return;

  if (!currentProjectId) {
    tbody.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = 'Select a project to view execution history.'; }
    return;
  }

  const dateVal = (document.getElementById('hist-filter-date')?.value || '').trim();
  const search = (document.getElementById('hist-filter-search')?.value || '').toLowerCase();
  const statusVal = (document.getElementById('hist-filter-status')?.value || '');
  const envVal = (document.getElementById('hist-filter-env')?.value || '');

  let runs = _histRuns.slice();

  if (dateVal) {
    runs = runs.filter(r => r.startedAt && r.startedAt.startsWith(dateVal));
  }
  if (statusVal) {
    runs = runs.filter(r => r.status === statusVal);
  }
  if (envVal) {
    runs = runs.filter(r => (r.environmentName || '') === envVal);
  }
  if (search) {
    runs = runs.filter(r =>
      (r.runId || '').toLowerCase().includes(search) ||
      (r.suiteName || '').toLowerCase().includes(search) ||
      (r.executedBy || '').toLowerCase().includes(search)
    );
  }

  // Sort
  runs.sort((a, b) => {
    const va = a[_histSortCol] ?? '';
    const vb = b[_histSortCol] ?? '';
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * _histSortDir;
    return String(va).localeCompare(String(vb)) * _histSortDir;
  });

  if (!runs.length) {
    tbody.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = 'No execution records match the current filters.'; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  tbody.innerHTML = runs.map(r => {
    const statusBadge = _histStatusBadge(r.status);
    const start = r.startedAt ? _histFmtDate(r.startedAt) : '—';
    const end = r.finishedAt ? _histFmtDate(r.finishedAt) : '—';
    const dur = (r.startedAt && r.finishedAt) ? _histDuration(r.startedAt, r.finishedAt) : '—';
    const shortId = (r.runId || '').slice(0, 8);
    const suite = escHtml(r.suiteName || r.planId || '—');
    const env = escHtml(r.environmentName || '—');
    const by = escHtml(r.executedBy || '—');
    const isDone = r.status === 'done' || r.status === 'failed';
    const reportBtn = isDone
      ? `<button class="btn btn-secondary btn-xs" onclick="histOpenReport('${escHtml(r.runId)}')">&#128196; View Report</button>`
      : `<span style="color:#858585;font-size:11px">In Progress</span>`;
    // Self-healing badge — only shown when at least 1 T2 heal occurred during this run
    const healBadge = (r.healCount && r.healCount > 0)
      ? `<span title="${r.healCount} step(s) auto-healed by T2 Alternatives Fallback" style="margin-left:5px;background:#7c3aed;color:#fff;border-radius:3px;padding:1px 5px;font-size:10px;cursor:default">🩹 Healed ${r.healCount}</span>`
      : '';
    // Derive browsers from test events (populated by parser) or from run record field
    const browserSet = new Set((r.tests || []).map(t => t.browser).filter(Boolean));
    if (r.browsers && Array.isArray(r.browsers)) r.browsers.forEach(b => browserSet.add(b));
    function _brBadge(b) {
      if (b === 'firefox') return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;background:#E66000;color:#fff">● Firefox</span>`;
      if (b === 'webkit') return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;background:#006CFF;color:#fff">● Safari</span>`;
      return `<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;background:#4285F4;color:#fff">● Chrome</span>`;
    }
    const browserLabel = browserSet.size > 0
      ? [...browserSet].map(b => _brBadge(b)).join(' ')
      : _brBadge('chromium');
    const compareCb = isDone
      ? `<input type="checkbox" class="hist-compare-chk" value="${escHtml(r.runId)}" onchange="histCompareSelChanged()" style="width:14px;height:14px;cursor:pointer" />`
      : `<span style="width:14px;display:inline-block"></span>`;
    return `<tr>
      <td style="text-align:center">${compareCb}</td>
      <td><code style="font-size:11px">${escHtml(shortId)}</code></td>
      <td>${suite}${healBadge}</td>
      <td>${statusBadge}</td>
      <td style="text-align:center">${r.total || 0}</td>
      <td style="text-align:center;color:#4ec9b0">${r.passed || 0}</td>
      <td style="text-align:center;color:${r.failed ? '#f48771' : 'inherit'}">${r.failed || 0}</td>
      <td style="font-size:12px">${start}</td>
      <td style="font-size:12px">${end}</td>
      <td style="font-size:12px">${dur}</td>
      <td>${env}</td>
      <td>${by}</td>
      <td>${browserLabel}</td>
      <td>${reportBtn}</td>
    </tr>`;
  }).join('');
}

function _histStatusBadge(status) {
  const map = {
    queued: '<span class="hist-badge hist-badge-queued">&#9203; Queued</span>',
    running: '<span class="hist-badge hist-badge-running">&#9679; In Progress</span>',
    done: '<span class="hist-badge hist-badge-done">&#10003; Completed</span>',
    failed: '<span class="hist-badge hist-badge-failed">&#10007; Failed</span>',
  };
  return map[status] || `<span class="hist-badge">${escHtml(status)}</span>`;
}

function _histFmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

function _histDuration(startIso, endIso) {
  try {
    const ms = new Date(endIso) - new Date(startIso);
    if (ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), rs = s % 60;
    return `${m}m ${rs}s`;
  } catch { return '—'; }
}

async function histViewDetail(runId) {
  const overlay = document.getElementById('hist-detail-overlay');
  const body = document.getElementById('hist-detail-body');
  const title = document.getElementById('hist-detail-title');
  if (!overlay || !body) return;

  body.innerHTML = '<div style="padding:24px;text-align:center;color:#858585">Loading…</div>';
  overlay.style.display = '';

  try {
    const res = await fetch(`/api/run/${encodeURIComponent(runId)}`);
    if (!res.ok) throw new Error('Run not found');
    const r = await res.json();

    const shortId = (r.runId || '').slice(0, 8);
    if (title) title.textContent = `Execution Report — ${shortId}`;

    const dur = (r.startedAt && r.finishedAt) ? _histDuration(r.startedAt, r.finishedAt) : '—';
    const passRate = r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
    const statusBadge = _histStatusBadge(r.status);

    // Test results table
    const tests = Array.isArray(r.tests) ? r.tests : [];
    const testRows = tests.map((t, i) => {
      const st = t.status === 'pass'
        ? '<span style="color:#4ec9b0;font-weight:600">&#10003; Passed</span>'
        : t.status === 'fail'
          ? '<span style="color:#f48771;font-weight:600">&#10007; Failed</span>'
          : `<span style="color:#858585">${escHtml(t.status)}</span>`;
      const dur2 = t.durationMs >= 1000
        ? `${(t.durationMs / 1000).toFixed(1)}s`
        : `${t.durationMs}ms`;
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escHtml(t.name || '—')}</td>
        <td style="text-align:center">${_brBadge(t.browser || 'chromium')}</td>
        <td>${st}</td>
        <td>${dur2}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="hist-report">
        <h3 style="margin:0 0 16px;font-size:14px;color:#9cdcfe;text-transform:uppercase;letter-spacing:1px">Execution Summary</h3>
        <div class="hist-summary-grid">
          <div class="hist-summary-item"><span class="hist-lbl">Execution ID</span><span class="hist-val"><code>${escHtml(r.runId || '—')}</code></span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Project</span><span class="hist-val">${escHtml(r.projectName || '—')}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Test Suite</span><span class="hist-val">${escHtml(r.suiteName || r.planId || '—')}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Environment</span><span class="hist-val">${escHtml(r.environmentName || '—')}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Executed By</span><span class="hist-val">${escHtml(r.executedBy || '—')}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Status</span><span class="hist-val">${statusBadge}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Start Time</span><span class="hist-val">${r.startedAt ? _histFmtDate(r.startedAt) : '—'}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">End Time</span><span class="hist-val">${r.finishedAt ? _histFmtDate(r.finishedAt) : '—'}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Duration</span><span class="hist-val">${dur}</span></div>
        </div>

        <h3 style="margin:24px 0 12px;font-size:14px;color:#9cdcfe;text-transform:uppercase;letter-spacing:1px">Test Execution Summary</h3>
        <div class="hist-metrics-row">
          <div class="hist-metric"><div class="hist-metric-val">${r.total || 0}</div><div class="hist-metric-lbl">Total</div></div>
          <div class="hist-metric hist-metric-pass"><div class="hist-metric-val">${r.passed || 0}</div><div class="hist-metric-lbl">Passed</div></div>
          <div class="hist-metric hist-metric-fail"><div class="hist-metric-val">${r.failed || 0}</div><div class="hist-metric-lbl">Failed</div></div>
          <div class="hist-metric"><div class="hist-metric-val">${passRate}%</div><div class="hist-metric-lbl">Pass Rate</div></div>
        </div>

        ${tests.length ? `
        <h3 style="margin:24px 0 12px;font-size:14px;color:#9cdcfe;text-transform:uppercase;letter-spacing:1px">Test Case Results</h3>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr><th>#</th><th>Test Case</th><th>Browser</th><th>Status</th><th>Duration</th></tr></thead>
            <tbody>${testRows}</tbody>
          </table>
        </div>` : '<p style="color:#858585;margin-top:16px">No individual test results recorded.</p>'}
      </div>`;
  } catch (err) {
    body.innerHTML = `<div style="padding:24px;color:#f48771">Failed to load report: ${escHtml(err.message)}</div>`;
  }
}

function histDetailClose() {
  const overlay = document.getElementById('hist-detail-overlay');
  if (overlay) overlay.style.display = 'none';
}

function histOpenReport(runId) {
  window.open(`/execution-report?runId=${encodeURIComponent(runId)}`, '_blank');
}

// ── Run Comparison ─────────────────────────────────────────────────────────────

function histCompareSelChanged() {
  const checked = [...document.querySelectorAll('.hist-compare-chk:checked')];
  const bar = document.getElementById('hist-compare-bar');
  const countEl = document.getElementById('hist-compare-count');
  const btn = document.getElementById('hist-compare-btn');
  if (!bar) return;
  bar.style.display = checked.length > 0 ? 'flex' : 'none';
  countEl.textContent = `${checked.length} run${checked.length !== 1 ? 's' : ''} selected`;
  btn.disabled = checked.length !== 2;
}

function histClearCompare() {
  document.querySelectorAll('.hist-compare-chk').forEach(c => c.checked = false);
  histCompareSelChanged();
}

async function histCompare() {
  const ids = [...document.querySelectorAll('.hist-compare-chk:checked')].map(c => c.value);
  if (ids.length !== 2) return;
  // Fetch full run records
  const [r1, r2] = await Promise.all(ids.map(id =>
    fetch(`/api/run/${encodeURIComponent(id)}`).then(r => r.json())
  ));
  _histRenderComparison(r1, r2);
}

function _histRenderComparison(r1, r2) {
  const overlay = document.getElementById('run-compare-overlay');
  const body = document.getElementById('run-compare-body');
  if (!overlay || !body) return;

  const fmtDate = s => s ? new Date(s).toLocaleString() : '—';
  const fmtDur = (a, b) => {
    if (!a || !b) return '—';
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };
  const fmtMs = ms => !ms ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  // Build test name → result maps
  const map1 = new Map((r1.tests || []).map(t => [t.name, t]));
  const map2 = new Map((r2.tests || []).map(t => [t.name, t]));
  const allNames = new Set([...map1.keys(), ...map2.keys()]);

  const newlyFailed = [], newlyPassed = [], durationChanged = [], stable = [], onlyInA = [], onlyInB = [];

  for (const name of allNames) {
    const t1 = map1.get(name);
    const t2 = map2.get(name);
    if (!t1) { onlyInB.push({ name, t: t2 }); continue; }
    if (!t2) { onlyInA.push({ name, t: t1 }); continue; }
    if (t1.status === 'pass' && t2.status === 'fail') newlyFailed.push({ name, t1, t2 });
    else if (t1.status === 'fail' && t2.status === 'pass') newlyPassed.push({ name, t1, t2 });
    else {
      const durDiff = Math.abs((t2.durationMs || 0) - (t1.durationMs || 0));
      const durPct = t1.durationMs > 0 ? (durDiff / t1.durationMs) * 100 : 0;
      if (durPct >= 50 && durDiff > 1000) durationChanged.push({ name, t1, t2, durDiff, durPct });
      else stable.push({ name, t1, t2 });
    }
  }

  // ── Section builder ──────────────────────────────────────────────────────
  const tblStyle = 'width:100%;border-collapse:collapse;font-size:12.5px;min-width:560px';
  const thStyle = 'padding:9px 14px;text-align:left;background:#0f1318;color:#9ca3af;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #2d3748';
  const tdStyle = 'padding:9px 14px;border-bottom:1px solid #1e2a38;vertical-align:top';

  const section = (title, icon, accentColor, rows, colDefs) => {
    if (!rows.length) return '';
    const ths = colDefs.map(c => `<th style="${thStyle}">${c}</th>`).join('');
    return `
      <div style="margin-bottom:24px;border-radius:10px;overflow:hidden;border:1px solid #2d3748">
        <div style="padding:12px 16px;background:#0f1318;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2d3748">
          <span style="font-size:16px">${icon}</span>
          <span style="font-size:13px;font-weight:700;color:${accentColor}">${title}</span>
          <span style="margin-left:auto;background:${accentColor}22;color:${accentColor};border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700">${rows.length}</span>
        </div>
        <div style="overflow-x:auto">
          <table style="${tblStyle}">
            <thead><tr>${ths}</tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>
      </div>`;
  };

  const statusChip = (status) => status === 'pass'
    ? `<span style="background:#052e16;color:#4ec9b0;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">✓ Pass</span>`
    : `<span style="background:#450a0a;color:#f48771;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">✗ Fail</span>`;

  const failRows = newlyFailed.map(({ name, t1, t2 }) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip('pass')}</td>
    <td style="${tdStyle};text-align:center">${statusChip('fail')}</td>
    <td style="${tdStyle};color:#f87171;font-size:11px;max-width:240px;word-break:break-word">${escHtml((t2.errorMessage || 'No error captured').slice(0, 140))}</td>
  </tr>`);

  const passRows = newlyPassed.map(({ name, t1, t2 }) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip('fail')}</td>
    <td style="${tdStyle};text-align:center">${statusChip('pass')}</td>
    <td style="${tdStyle};color:#86efac;font-size:11px">Fixed ✓</td>
  </tr>`);

  const durRows = durationChanged.map(({ name, t1, t2, durPct }) => {
    const slower = t2.durationMs > t1.durationMs;
    const arrow = slower ? '▲' : '▼';
    const color = slower ? '#f48771' : '#4ec9b0';
    return `<tr style="background:#1a1f26">
      <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
      <td style="${tdStyle};text-align:center;color:#9ca3af">${fmtMs(t1.durationMs)}</td>
      <td style="${tdStyle};text-align:center;color:#9ca3af">${fmtMs(t2.durationMs)}</td>
      <td style="${tdStyle};text-align:center;font-weight:700;color:${color}">${arrow} ${Math.round(durPct)}%</td>
    </tr>`;
  });

  const stableRows = stable.map(({ name, t1, t2 }) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#6b7280">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip(t1.status)}</td>
    <td style="${tdStyle};text-align:center">${statusChip(t2.status)}</td>
    <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">${fmtMs(t1.durationMs)} → ${fmtMs(t2.durationMs)}</td>
  </tr>`);

  const passRate = r => r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
  const prColor = r => passRate(r) >= 90 ? '#4ec9b0' : passRate(r) >= 70 ? '#f6c543' : '#f48771';

  body.innerHTML = `
    <!-- Run header cards -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      ${[r1, r2].map((r, i) => {
    const accent = i === 0 ? '#3b82f6' : '#8b5cf6';
    const pr = passRate(r);
    return `
        <div style="background:#0f1318;border-radius:10px;border:2px solid ${accent};padding:20px;position:relative;overflow:hidden">
          <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${accent}"></div>
          <div style="font-size:10px;font-weight:800;letter-spacing:1.5px;color:${accent};margin-bottom:10px;text-transform:uppercase">Run ${i + 1}</div>
          <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:6px">&#128203; ${escHtml(r.suiteName || '—')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:12px">
            <div style="font-size:11.5px;color:#6b7280">&#128197; ${fmtDate(r.startedAt)}</div>
            <div style="font-size:11.5px;color:#6b7280">&#9201; ${fmtDur(r.startedAt, r.finishedAt)}</div>
            <div style="font-size:11.5px;color:#6b7280">&#127758; ${escHtml(r.environmentName || '—')}</div>
            <div style="font-size:11.5px;color:#6b7280">&#128100; ${escHtml(r.executedBy || '—')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:14px">
            <span style="color:#4ec9b0;font-size:18px;font-weight:800">✓ ${r.passed || 0}</span>
            <span style="color:#f48771;font-size:18px;font-weight:800">✗ ${r.failed || 0}</span>
            <span style="color:#6b7280;font-size:13px">/ ${r.total || 0} tests</span>
            <span style="margin-left:auto;font-size:20px;font-weight:800;color:${prColor(r)}">${pr}%</span>
          </div>
        </div>`;
  }).join('')}
    </div>

    <!-- Summary KPI chips -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px;padding:16px;background:#0f1318;border-radius:10px;border:1px solid #2d3748">
      <div style="display:flex;align-items:center;gap:8px;background:#450a0a;border:1px solid #7f1d1d;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">🔴</span>
        <div><div style="font-size:18px;font-weight:800;color:#f48771">${newlyFailed.length}</div><div style="font-size:10px;color:#fca5a5;text-transform:uppercase;letter-spacing:.5px">Newly Failed</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#052e16;border:1px solid #14532d;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">🟢</span>
        <div><div style="font-size:18px;font-weight:800;color:#4ec9b0">${newlyPassed.length}</div><div style="font-size:10px;color:#86efac;text-transform:uppercase;letter-spacing:.5px">Fixed</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#422006;border:1px solid #713f12;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">🟡</span>
        <div><div style="font-size:18px;font-weight:800;color:#f6c543">${durationChanged.length}</div><div style="font-size:10px;color:#fde68a;text-transform:uppercase;letter-spacing:.5px">Duration Changed</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#1a1f26;border:1px solid #374151;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">⚪</span>
        <div><div style="font-size:18px;font-weight:800;color:#9ca3af">${stable.length}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Stable</div></div>
      </div>
      ${onlyInA.length ? `<div style="display:flex;align-items:center;gap:8px;background:#1e1b4b;border:1px solid #3730a3;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">📋</span>
        <div><div style="font-size:18px;font-weight:800;color:#a5b4fc">${onlyInA.length}</div><div style="font-size:10px;color:#c7d2fe;text-transform:uppercase;letter-spacing:.5px">Only in Run 1</div></div>
      </div>` : ''}
      ${onlyInB.length ? `<div style="display:flex;align-items:center;gap:8px;background:#1e1b4b;border:1px solid #3730a3;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">📋</span>
        <div><div style="font-size:18px;font-weight:800;color:#a5b4fc">${onlyInB.length}</div><div style="font-size:10px;color:#c7d2fe;text-transform:uppercase;letter-spacing:.5px">Only in Run 2</div></div>
      </div>` : ''}
    </div>

    ${section('Newly Failed — Regressions', '🔴', '#f48771', failRows, ['Test Name', 'Run 1', 'Run 2', 'Error Message'])}
    ${section('Newly Passed — Fixed', '🟢', '#4ec9b0', passRows, ['Test Name', 'Run 1', 'Run 2', 'Note'])}
    ${section('Duration Changed  (≥50% shift)', '🟡', '#f6c543', durRows, ['Test Name', 'Run 1 Duration', 'Run 2 Duration', 'Change'])}
    ${section('Stable — Same result in both runs', '⚪', '#6b7280', stableRows, ['Test Name', 'Run 1', 'Run 2', 'Duration Trend'])}
    ${onlyInA.length ? section('Only in Run 1 — not executed in Run 2', '📋', '#a5b4fc',
    onlyInA.map(({ name, t }) => `<tr style="background:#1a1f26">
          <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
          <td style="${tdStyle};text-align:center">${statusChip(t.status)}</td>
          <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">Not run</td>
          <td style="${tdStyle};text-align:center;color:#6b7280;font-size:11px">${fmtMs(t.durationMs)}</td>
        </tr>`),
    ['Test Name', 'Run 1 Result', 'Run 2 Result', 'Run 1 Duration']) : ''}
    ${onlyInB.length ? section('Only in Run 2 — not executed in Run 1', '📋', '#a5b4fc',
      onlyInB.map(({ name, t }) => `<tr style="background:#1a1f26">
          <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
          <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">Not run</td>
          <td style="${tdStyle};text-align:center">${statusChip(t.status)}</td>
          <td style="${tdStyle};text-align:center;color:#6b7280;font-size:11px">${fmtMs(t.durationMs)}</td>
        </tr>`),
      ['Test Name', 'Run 1 Result', 'Run 2 Result', 'Run 2 Duration']) : ''}
    ${(r1.tests || []).length === 0 || (r2.tests || []).length === 0 ? `
      <div style="margin-top:8px;padding:16px 20px;background:#1c1917;border:1px solid #713f12;border-radius:10px;color:#fde68a;font-size:13px">
        ⚠️ <strong>One or both runs have no test results.</strong> This usually means the run failed before Playwright could execute any tests (e.g. spec generation error, environment unreachable, or run was aborted).
        Check the run duration — a very short run (under 10s) with 0 tests typically indicates a startup failure.
      </div>` : ''}
  `;

  overlay.style.display = 'block';
  overlay.querySelector('div').scrollTop = 0;
}

function histCompareClose() {
  document.getElementById('run-compare-overlay').style.display = 'none';
}

function histSort(col) {
  if (_histSortCol === col) {
    _histSortDir *= -1;
  } else {
    _histSortCol = col;
    _histSortDir = col === 'startedAt' ? -1 : 1;
  }
  // Update sort icons
  document.querySelectorAll('.sort-icon').forEach(el => el.textContent = '');
  const icon = document.getElementById(`si-${col}`);
  if (icon) icon.textContent = _histSortDir === 1 ? ' ▲' : ' ▼';
  histRender();
}

