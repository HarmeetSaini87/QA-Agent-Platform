// 29-worker-health.js — Execution Health dashboard: real-time view of all active + recent runs.
// Polls /api/execution-health every 5s while tab visible.

let _execHealthTimer = null;
let _execHealthAllRecent = [];
let _execHealthPage = 0;          // 0-indexed, matches scripts/collections convention
let _execHealthPageSize = 25;

function workerHealthInit(panel) {
  execHealthRefresh();
  _execHealthStartPolling();
}

function _execHealthStartPolling() {
  _execHealthStopPolling();
  _execHealthTimer = setInterval(execHealthRefresh, 5000);
}

function _execHealthStopPolling() {
  if (_execHealthTimer) { clearInterval(_execHealthTimer); _execHealthTimer = null; }
}

async function execHealthRefresh() {
  try {
    var res = await fetch('/api/execution-health');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    _execHealthAllRecent = data.recent || [];
    _execHealthRender(data.active || [], _execHealthAllRecent);
  } catch (e) { /* silent — keep last render */ }
}

function execHealthApplyFilter() {
  _execHealthPage = 0;
  _execHealthRenderRecent(_execHealthAllRecent);
}

function execHealthResetFilter() {
  var n = document.getElementById('exec-health-filter-name');
  var t = document.getElementById('exec-health-filter-type');
  var s = document.getElementById('exec-health-filter-status');
  if (n) n.value = '';
  if (t) t.value = '';
  if (s) s.value = '';
  _execHealthPageSize = 25;
  _execHealthPage = 0;
  _execHealthRenderRecent(_execHealthAllRecent);
}

function _execHealthSetPageSize(n) {
  _execHealthPageSize = n;
  _execHealthPage = 0;
  _execHealthRenderRecent(_execHealthAllRecent);
}

function _execHealthPageGo(delta) {
  _execHealthPage += delta;
  _execHealthRenderRecent(_execHealthAllRecent);
}

function _execHealthRender(active, recent) {
  _execHealthRenderStats(active, recent);
  _execHealthRenderActive(active);
  _execHealthRenderRecent(recent);
}

function _execHealthRenderStats(active, recent) {
  var el = document.getElementById('exec-health-stats');
  if (!el) return;
  var completed = recent.filter(function(r) { return r.status !== 'running'; });
  var passed = completed.filter(function(r) { return r.status === 'passed'; }).length;
  var failed = completed.filter(function(r) { return r.status === 'failed' || r.status === 'error'; }).length;
  var passRate = completed.length > 0 ? Math.round((passed / completed.length) * 100) : 0;
  el.innerHTML = [
    _execStatCard(active.length, 'Active', '#3b82f6'),
    _execStatCard(passed, 'Passed', '#10b981'),
    _execStatCard(failed, 'Failed', '#ef4444'),
    _execStatCard(completed.length > 0 ? passRate + '%' : '—', 'Pass Rate', passRate >= 80 ? '#10b981' : passRate >= 60 ? '#f59e0b' : '#ef4444'),
  ].join('');
}

function _execStatCard(value, label, color) {
  return '<div style="background:var(--card-bg,#1e1e2e);border:1px solid var(--border,#2d2d3f);border-radius:8px;padding:14px 20px;min-width:110px;text-align:center;">'
    + '<div style="font-size:24px;font-weight:700;color:' + color + '">' + escHtml(String(value)) + '</div>'
    + '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:4px;">' + escHtml(label) + '</div>'
    + '</div>';
}

function _execHealthRenderActive(active) {
  var tbody = document.getElementById('exec-health-active-tbody');
  if (!tbody) return;
  var dot = document.getElementById('exec-health-live-dot');
  var lbl = document.getElementById('exec-health-live-label');
  if (dot && lbl) {
    dot.style.background = active.length > 0 ? '#10b981' : '#6b7280';
    lbl.textContent = active.length > 0 ? active.length + ' running' : 'Idle';
  }
  if (!active.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px;">No active runs</td></tr>';
    return;
  }
  var now = Date.now();
  var TD = 'padding:8px 12px;border-bottom:1px solid var(--border,#2d2d3f);vertical-align:middle;';
  tbody.innerHTML = active.map(function(r) {
    var elapsed = _execHealthElapsed(r.startedAt, now);
    var progress = r.total > 0 ? Math.round(((r.passed + r.failed) / r.total) * 100) : 0;
    var passRate = (r.passed + r.failed) > 0 ? Math.round((r.passed / (r.passed + r.failed)) * 100) : null;
    return '<tr onmouseover="this.style.background=\'var(--row-hover,rgba(255,255,255,.03))\'" onmouseout="this.style.background=\'\'">'
      + '<td style="' + TD + 'font-family:monospace;font-size:11px;color:var(--text-muted);white-space:nowrap;">' + escHtml(r.runId.slice(0, 8)) + '…</td>'
      + '<td style="' + TD + '">' + _execTypeBadge(r.type) + '</td>'
      + '<td style="' + TD + 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</td>'
      + '<td style="' + TD + '">' + _execStatusBadge('running') + '</td>'
      + '<td style="' + TD + 'min-width:140px;">' + _execProgressBar(progress, r.passed, r.failed, r.total) + '</td>'
      + '<td style="' + TD + '">' + (passRate !== null ? _execPassRateBadge(passRate) : '<span style="color:var(--text-muted);font-size:12px;">—</span>') + '</td>'
      + '<td style="' + TD + 'font-size:12px;white-space:nowrap;">' + escHtml(elapsed) + '</td>'
      + '</tr>';
  }).join('');
}

function _execHealthRenderRecent(recent) {
  var tbody = document.getElementById('exec-health-recent-tbody');
  var tfoot = document.getElementById('exec-health-tfoot');
  var countEl = document.getElementById('exec-health-count-label');
  if (!tbody) return;

  // Apply filters
  var nameF   = (document.getElementById('exec-health-filter-name')?.value || '').toLowerCase();
  var typeF   = document.getElementById('exec-health-filter-type')?.value || '';
  var statusF = document.getElementById('exec-health-filter-status')?.value || '';

  var filtered = recent.filter(function(r) {
    if (nameF   && !(r.name || '').toLowerCase().includes(nameF)) return false;
    if (typeF   && r.type !== typeF)   return false;
    if (statusF && r.status !== statusF) return false;
    return true;
  });

  var total = filtered.length;
  var totalPages = Math.max(1, Math.ceil(total / _execHealthPageSize));
  if (_execHealthPage >= totalPages) _execHealthPage = totalPages - 1;
  if (_execHealthPage < 0) _execHealthPage = 0;

  var start = _execHealthPage * _execHealthPageSize;
  var end   = Math.min(start + _execHealthPageSize, total);
  var page  = filtered.slice(start, end);

  if (countEl) countEl.textContent = total > 0 ? '(' + total + ' result' + (total !== 1 ? 's' : '') + ')' : '';

  if (!page.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px;">'
      + (nameF || typeF || statusF ? 'No results match the current filters.' : 'No recent runs') + '</td></tr>';
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  var TD2 = 'padding:8px 12px;border-bottom:1px solid var(--border,#2d2d3f);vertical-align:middle;';
  tbody.innerHTML = page.map(function(r) {
    var passRate = r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
    var duration = r.completedAt ? _execHealthDuration(r.startedAt, r.completedAt) : '—';
    return '<tr onmouseover="this.style.background=\'var(--row-hover,rgba(255,255,255,.03))\'" onmouseout="this.style.background=\'\'">'
      + '<td style="' + TD2 + 'font-family:monospace;font-size:11px;color:var(--text-muted);white-space:nowrap;">' + escHtml(r.runId.slice(0, 8)) + '…</td>'
      + '<td style="' + TD2 + '">' + _execTypeBadge(r.type) + '</td>'
      + '<td style="' + TD2 + 'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</td>'
      + '<td style="' + TD2 + '">' + _execStatusBadge(r.status) + '</td>'
      + '<td style="' + TD2 + 'font-size:12px;color:#10b981;text-align:center;">' + r.passed + '</td>'
      + '<td style="' + TD2 + 'font-size:12px;color:#ef4444;text-align:center;">' + r.failed + '</td>'
      + '<td style="' + TD2 + 'font-size:12px;text-align:center;">' + r.total + '</td>'
      + '<td style="' + TD2 + '">' + _execPassRateBadge(passRate) + '</td>'
      + '<td style="' + TD2 + 'font-size:11px;white-space:nowrap;color:var(--text-muted);">' + escHtml(formatDate(r.startedAt)) + '</td>'
      + '<td style="' + TD2 + 'font-size:12px;white-space:nowrap;color:var(--text-muted);">' + escHtml(duration) + '</td>'
      + '</tr>';
  }).join('');

  // Pagination in tfoot — exact same pattern as scripts + api-collections pages
  if (tfoot) {
    var rppOpts = [10, 25, 50, 100].map(function(n) {
      return '<option value="' + n + '"' + (_execHealthPageSize === n ? ' selected' : '') + '>' + n + '</option>';
    }).join('');
    var pageInfo = '<span style="font-size:12px;color:var(--text-muted)">' + (start + 1) + '–' + end + ' of ' + total + '</span>';
    var navBtns = totalPages > 1
      ? '<button class="tbl-btn" onclick="_execHealthPageGo(-1)" ' + (_execHealthPage === 0 ? 'disabled' : '') + '>← Prev</button>'
        + '<span style="font-size:12px;color:var(--text-muted)">Page ' + (_execHealthPage + 1) + ' / ' + totalPages + ' &nbsp;(' + (start + 1) + '–' + end + ' of ' + total + ')</span>'
        + '<button class="tbl-btn" onclick="_execHealthPageGo(1)" ' + (_execHealthPage >= totalPages - 1 ? 'disabled' : '') + '>Next →</button>'
      : pageInfo;
    tfoot.innerHTML = '<tr><td colspan="10" style="padding:6px 4px"><div class="lt-pagination">'
      + '<label style="font-size:12px;color:var(--text-muted)">Rows per page: '
      + '<select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto" onchange="_execHealthSetPageSize(+this.value)">' + rppOpts + '</select>'
      + '</label>'
      + navBtns
      + '</div></td></tr>';
  }
}

function _execTypeBadge(type) {
  var map = { 'ui-test': ['#7c3aed', 'UI Test'], 'api-collection': ['#2563eb', 'API Collection'], 'api-suite': ['#0891b2', 'API Suite'] };
  var entry = map[type] || ['#6b7280', type];
  return '<span style="font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600;background:' + entry[0] + '22;color:' + entry[0] + '">' + escHtml(entry[1]) + '</span>';
}

function _execStatusBadge(status) {
  var map = { running: ['#3b82f6', '● Running'], passed: ['#10b981', '✓ Passed'], failed: ['#ef4444', '✗ Failed'], error: ['#f59e0b', '⚠ Error'] };
  var entry = map[status] || ['#6b7280', status];
  return '<span style="font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;background:' + entry[0] + '22;color:' + entry[0] + '">' + escHtml(entry[1]) + '</span>';
}

function _execPassRateBadge(rate) {
  var color = rate >= 80 ? '#10b981' : rate >= 60 ? '#f59e0b' : '#ef4444';
  return '<span style="font-size:11px;font-weight:600;color:' + color + '">' + rate + '%</span>';
}

function _execProgressBar(pct, passed, failed, total) {
  if (total === 0) return '<span style="font-size:11px;color:var(--text-muted);">—</span>';
  return '<div style="height:6px;background:var(--border,#2d2d3f);border-radius:3px;overflow:hidden;margin-bottom:3px;">'
    + '<div style="height:100%;width:' + pct + '%;background:#10b981;border-radius:3px;transition:width .3s;"></div></div>'
    + '<div style="font-size:10px;color:var(--text-muted);">' + (passed + failed) + ' / ' + total + '</div>';
}

function _execHealthElapsed(startedAt, nowMs) {
  var s = Math.floor((nowMs - new Date(startedAt).getTime()) / 1000);
  if (isNaN(s) || s < 0) return '—';
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function _execHealthDuration(startedAt, completedAt) {
  return _execHealthElapsed(startedAt, new Date(completedAt).getTime());
}

document.addEventListener('visibilitychange', function() {
  if (document.hidden) { _execHealthStopPolling(); }
  else {
    var panel = document.getElementById('panel-worker-health');
    if (panel && panel.classList.contains('active')) { execHealthRefresh(); _execHealthStartPolling(); }
  }
});
