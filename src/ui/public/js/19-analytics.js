// ══════════════════════════════════════════════════════════════════════════════
// Analytics Dashboard
// ══════════════════════════════════════════════════════════════════════════════

let _analyticsData = null;

async function analyticsLoad() {
  if (!currentProjectId) {
    document.getElementById('analytics-loading').style.display = '';
    document.getElementById('analytics-loading').textContent = 'Select a project to view analytics.';
    _analyticsClear();
    return;
  }
  document.getElementById('analytics-loading').style.display = 'none';
  const days = document.getElementById('analytics-days')?.value || '30';
  try {
    const res = await fetch(`/api/analytics?projectId=${encodeURIComponent(currentProjectId)}&days=${days}`);
    if (!res.ok) throw new Error(await res.text());
    _analyticsData = await res.json();
    _analyticsRender(_analyticsData);
  } catch (e) {
    document.getElementById('analytics-loading').style.display = '';
    document.getElementById('analytics-loading').textContent = 'Failed to load analytics.';
  }
}

function _analyticsClear() {
  ['kpi-runs', 'kpi-tests', 'kpi-pass-rate', 'kpi-passed', 'kpi-failed'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'kpi-pass-rate' ? '—%' : '—';
  });
  const prchart = document.getElementById('analytics-passrate-chart');
  if (prchart) prchart.innerHTML = '';
  ['analytics-fail-tbody', 'analytics-flaky-tbody', 'analytics-suite-tbody'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

function _analyticsRender(d) {
  // KPIs
  document.getElementById('kpi-runs').textContent = d.totalRuns;
  document.getElementById('kpi-tests').textContent = d.totalTests;
  document.getElementById('kpi-pass-rate').textContent = d.overallPassRate + '%';
  document.getElementById('kpi-passed').textContent = d.totalPassed;
  document.getElementById('kpi-failed').textContent = d.totalFailed;

  // Pass rate trend chart (inline bar chart)
  const chartEl = document.getElementById('analytics-passrate-chart');
  const emptyEl = document.getElementById('analytics-passrate-empty');
  if (!d.passRateTrend || d.passRateTrend.length === 0) {
    chartEl.innerHTML = '';
    emptyEl.style.display = '';
  } else {
    emptyEl.style.display = 'none';
    chartEl.innerHTML = d.passRateTrend.map(row => {
      const pct = row.passRate;
      const color = pct >= 90 ? '#4ec9b0' : pct >= 70 ? '#f6c543' : '#f48771';
      return `<div class="an-chart-row">
        <div class="an-chart-day">${row.day.slice(5)}</div>
        <div class="an-chart-bar-wrap"><div class="an-chart-bar" style="width:${pct}%;background:${color}"></div></div>
        <div class="an-chart-pct" style="color:${color}">${pct}%</div>
        <div style="color:var(--neutral-400);font-size:11px;min-width:100px">✓${row.passed} ✗${row.failed} of ${row.total}</div>
      </div>`;
    }).join('');
  }

  // Top failures
  const failTbody = document.getElementById('analytics-fail-tbody');
  const failEmpty = document.getElementById('analytics-fail-empty');
  if (!d.topFailures || d.topFailures.length === 0) {
    failTbody.innerHTML = '';
    failEmpty.style.display = '';
  } else {
    failEmpty.style.display = 'none';
    failTbody.innerHTML = d.topFailures.map(t => `<tr>
      <td style="max-width:260px;word-break:break-word;font-size:12px">${escHtml(t.name)}</td>
      <td style="text-align:center;color:#f48771;font-weight:700">${t.failures}</td>
      <td style="text-align:center;font-size:12px">${t.failRate}%</td>
    </tr>`).join('');
  }

  // Flaky tests
  const flakyTbody = document.getElementById('analytics-flaky-tbody');
  const flakyEmpty = document.getElementById('analytics-flaky-empty');
  if (!d.flaky || d.flaky.length === 0) {
    flakyTbody.innerHTML = '';
    flakyEmpty.style.display = '';
  } else {
    flakyEmpty.style.display = 'none';
    flakyTbody.innerHTML = d.flaky.map(t => `<tr>
      <td style="max-width:260px;word-break:break-word;font-size:12px">${escHtml(t.name)}</td>
      <td style="text-align:center;color:#f48771;font-weight:700">${t.failures}</td>
      <td style="text-align:center;font-size:12px">${t.failRate}%</td>
    </tr>`).join('');
  }

  // Suite comparison
  const suiteTbody = document.getElementById('analytics-suite-tbody');
  const suiteEmpty = document.getElementById('analytics-suite-empty');
  if (!d.suiteComparison || d.suiteComparison.length === 0) {
    suiteTbody.innerHTML = '';
    suiteEmpty.style.display = '';
  } else {
    suiteEmpty.style.display = 'none';
    suiteTbody.innerHTML = d.suiteComparison.map(s => {
      const passRate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
      const color = passRate >= 90 ? '#4ec9b0' : passRate >= 70 ? '#f6c543' : '#f48771';
      const avgMs = s.runs > 0 ? Math.round(s.totalMs / s.runs) : 0;
      const avgDur = avgMs < 1000 ? `${avgMs}ms` : avgMs < 60000 ? `${(avgMs / 1000).toFixed(1)}s` : `${Math.floor(avgMs / 60000)}m ${Math.round((avgMs % 60000) / 1000)}s`;
      return `<tr>
        <td style="font-weight:600;max-width:200px;word-break:break-word">${escHtml(s.suiteName)}</td>
        <td style="text-align:center">${s.runs}</td>
        <td style="text-align:center;color:#4ec9b0">${s.passed}</td>
        <td style="text-align:center;color:${s.failed ? '#f48771' : 'inherit'}">${s.failed}</td>
        <td style="text-align:center;font-weight:700;color:${color}">${passRate}%</td>
        <td style="text-align:center;font-size:12px;color:var(--neutral-500)">${avgDur}</td>
      </tr>`;
    }).join('');
  }
}

