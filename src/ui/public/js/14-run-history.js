
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
const _chromeIcon = '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364z" fill="#4285F4"/><path d="M12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z" fill="#DC4E41"/><circle cx="12" cy="12" r="4.364" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#4285F4"/></svg>';
     const _firefoxIcon = '<svg width="16" height="16" viewBox="0 0 512 512" style="vertical-align:-2px"><defs><radialGradient id="ffg" cx="210%" cy="-100%" r="290%"><stop offset=".1" stop-color="#ffe226"/><stop offset=".79" stop-color="#ff7139"/></radialGradient><radialGradient id="ffc" cx="49%" cy="40%" r="128%" gradientTransform="matrix(.82 0 0 1 .088 0)"><stop offset=".3" stop-color="#960e18"/><stop offset=".35" stop-color="#b11927" stop-opacity=".74"/><stop offset=".43" stop-color="#db293d" stop-opacity=".34"/><stop offset=".5" stop-color="#f5334b" stop-opacity=".09"/><stop offset=".53" stop-color="#ff3750" stop-opacity="0"/></radialGradient><radialGradient id="ffd" cx="48%" cy="-12%" r="140%"><stop offset=".13" stop-color="#fff44f"/><stop offset=".53" stop-color="#ff980e"/></radialGradient><radialGradient id="ffe" cx="22.76%" cy="110.11%" r="100%"><stop offset=".35" stop-color="#3a8ee6"/><stop offset=".67" stop-color="#9059ff"/><stop offset="1" stop-color="#c139e6"/></radialGradient><radialGradient id="fff2" cx="52%" cy="33%" r="59%" gradientTransform="scale(.9 1)"><stop offset=".21" stop-color="#9059ff" stop-opacity="0"/><stop offset=".97" stop-color="#6e008b" stop-opacity=".6"/></radialGradient><radialGradient id="ffb" cx="87.4%" cy="-12.9%" r="128%" gradientTransform="matrix(.8 0 0 1 .178 .129)"><stop offset=".13" stop-color="#ffbd4f"/><stop offset=".28" stop-color="#ff980e"/><stop offset=".47" stop-color="#ff3750"/><stop offset=".78" stop-color="#eb0878"/><stop offset=".86" stop-color="#e50080"/></radialGradient><radialGradient id="ffh" cx="84%" cy="-41%" r="180%"><stop offset=".11" stop-color="#fff44f"/><stop offset=".46" stop-color="#ff980e"/><stop offset=".72" stop-color="#ff3647"/><stop offset=".9" stop-color="#e31587"/></radialGradient><radialGradient id="ffi" cx="16.1%" cy="-18.6%" r="348.8%" gradientTransform="scale(1 .47) rotate(84 .279 -.297)"><stop offset="0" stop-color="#fff44f"/><stop offset=".3" stop-color="#ff980e"/><stop offset=".57" stop-color="#ff3647"/><stop offset=".74" stop-color="#e31587"/></radialGradient><radialGradient id="ffj" cx="18.9%" cy="-42.5%" r="238.4%"><stop offset=".14" stop-color="#fff44f"/><stop offset=".48" stop-color="#ff980e"/><stop offset=".66" stop-color="#ff3647"/><stop offset=".9" stop-color="#e31587"/></radialGradient><radialGradient id="ffk" cx="159.3%" cy="-44.72%" r="313.1%"><stop offset=".09" stop-color="#fff44f"/><stop offset=".63" stop-color="#ff980e"/></radialGradient><linearGradient id="ffa" x1="87.25%" y1="15.5%" x2="9.4%" y2="93.1%"><stop offset=".05" stop-color="#fff44f"/><stop offset=".37" stop-color="#ff980e"/><stop offset=".53" stop-color="#ff3647"/><stop offset=".7" stop-color="#e31587"/></linearGradient><linearGradient id="ffl" x1="80%" y1="14%" x2="18%" y2="84%"><stop offset=".17" stop-color="#fff44f" stop-opacity=".8"/><stop offset=".6" stop-color="#fff44f" stop-opacity="0"/></linearGradient></defs><path d="M478.711 166.353c-10.445-25.124-31.6-52.248-48.212-60.821 13.52 26.505 21.345 53.093 24.335 72.936 0 .039.015.136.047.4C427.706 111.135 381.627 83.823 344 24.355c-1.9-3.007-3.805-6.022-5.661-9.2a73.716 73.716 0 01-2.646-4.972A43.7 43.7 0 01332.1.677a.626.626 0 00-.546-.644.818.818 0 00-.451 0c-.034.012-.084.051-.12.065-.053.021-.12.069-.176.1.027-.036.083-.117.1-.136-60.37 35.356-80.85 100.761-82.732 133.484a120.249 120.249 0 00-66.142 25.488 71.355 71.355 0 00-6.225-4.7 111.338 111.338 0 01-.674-58.732c-24.688 11.241-43.89 29.01-57.85 44.7h-.111c-9.527-12.067-8.855-51.873-8.312-60.184-.114-.515-7.107 3.63-8.023 4.255a175.073 175.073 0 00-23.486 20.12 210.478 210.478 0 00-22.442 26.913c0 .012-.007.026-.011.038 0-.013.007-.026.011-.038a202.838 202.838 0 00-32.247 72.805c-.115.521-.212 1.061-.324 1.586-.452 2.116-2.08 12.7-2.365 15-.022.177-.032.347-.053.524a229.066 229.066 0 00-3.9 33.157c0 .41-.025.816-.025 1.227C16 388.418 123.6 496 256.324 496c118.865 0 217.56-86.288 236.882-199.63.407-3.076.733-6.168 1.092-9.271 4.777-41.21-.53-84.525-15.587-120.746z" fill="url(#ffa)"/><path d="M478.711 166.353c-10.445-25.124-31.6-52.248-48.212-60.821 13.52 26.505 21.345 53.093 24.335 72.936 0-.058.011.048.036.226.012.085.027.174.04.259 22.675 61.47 10.322 123.978-7.479 162.175-27.539 59.1-94.215 119.67-198.576 116.716C136.1 454.651 36.766 370.988 18.223 261.41c-3.379-17.28 0-26.054 1.7-40.084-2.071 10.816-2.86 13.94-3.9 33.157 0 .41-.025.816-.025 1.227C16 388.418 123.6 496 256.324 496c118.865 0 217.56-86.288 236.882-199.63.407-3.076.733-6.168 1.092-9.271 4.777-41.21-.53-84.525-15.587-120.746z" fill="url(#ffb)"/><path d="M361.922 194.6c.524.368 1 .734 1.493 1.1a130.706 130.706 0 00-22.31-29.112C266.4 91.892 321.516 4.626 330.811.194c.027-.036.083-.117.1-.136-60.37 35.356-80.85 100.761-82.732 133.484 2.8-.194 5.592-.429 8.442-.429 45.051 0 84.289 24.77 105.301 61.487z" fill="url(#ffd)"/><path d="M256.772 209.514c-.393 5.978-21.514 26.593-28.9 26.593-68.339 0-79.432 41.335-79.432 41.335 3.027 34.81 27.261 63.475 56.611 78.643 1.339.692 2.694 1.317 4.05 1.935a132.768 132.768 0 007.059 2.886 106.743 106.743 0 0031.271 6.031c119.78 5.618 142.986-143.194 56.545-186.408 22.137-3.85 45.115 5.053 57.947 14.067-21.012-36.714-60.25-61.484-105.3-61.484-2.85 0-5.641.235-8.442.429a120.249 120.249 0 00-66.142 25.488c3.664 3.1 7.8 7.244 16.514 15.828 16.302 16.067 58.13 32.705 58.219 34.657z" fill="url(#ffe)"/><path d="M170.829 151.036a244.042 244.042 0 014.981 3.3 111.338 111.338 0 01-.674-58.732c-24.688 11.241-43.89 29.01-57.85 44.7 1.155-.033 36.014-.66 53.543 10.732z" fill="url(#ffg)"/></svg>';
     const _safariIcon = '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm-.004.953h.006c.063 0 .113.05.113.113v1.842c0 .063-.05.113-.113.113h-.006a.112.112 0 0 1-.113-.113V1.066c0-.063.05-.113.113-.113z" fill="#006CFF"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" fill="#5AC8FA" opacity=".3"/><path d="M12 3.4l-1.76 6.84L12 12l1.76-1.76z" fill="#FF3B30"/><path d="M12 20.6l1.76-6.84L12 12l-1.76 1.76z" fill="#fff"/><circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-width=".6" opacity=".5"/><circle cx="12" cy="12" r="1.8" fill="#fff"/><circle cx="12" cy="12" r="1" fill="#007AFF"/></svg>';
    function _brBadge(b) {
      if (b === 'firefox') return `<span title="Firefox" style="display:inline-flex;align-items:center">${_firefoxIcon}</span>`;
      if (b === 'webkit') return `<span title="Safari" style="display:inline-flex;align-items:center">${_safariIcon}</span>`;
      return `<span title="Chrome" style="display:inline-flex;align-items:center">${_chromeIcon}</span>`;
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

