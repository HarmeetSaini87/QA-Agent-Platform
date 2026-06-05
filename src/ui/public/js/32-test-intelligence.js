// Test Intelligence Dashboard
// Aggregates: /api/analytics, /api/flaky, /api/proposals, /api/visual-baselines
// No new backend endpoints required.
// ══════════════════════════════════════════════════════════════════════════════

let _tiData = null;
let _tiRefreshTimer = null;
let _tiCountdownTimer = null;
let _tiCountdownSec = 30;

// ── Entry point ──────────────────────────────────────────────────────────────

async function tiLoad() {
  if (!currentProjectId) {
    const loadEl = document.getElementById('ti-loading');
    if (loadEl) { loadEl.style.display = 'block'; loadEl.textContent = 'Select a project to view Test Intelligence.'; }
    return;
  }

  tiPopulateSuiteFilter();
  _tiShowLoading(true);

  const days = document.getElementById('ti-days')?.value || '30';
  const suiteId = document.getElementById('ti-suite-filter')?.value || '';

  try {
    const [analytics, flaky, proposals, baselines] = await Promise.all([
      fetch(`/api/analytics?projectId=${encodeURIComponent(currentProjectId)}&days=${days}`)
        .then(r => r.ok ? r.json() : null),
      fetch(`/api/flaky?projectId=${encodeURIComponent(currentProjectId)}&limit=200&sort=flakeScore${suiteId ? '&suiteId=' + encodeURIComponent(suiteId) : ''}`)
        .then(r => r.ok ? r.json() : { tests: [] }),
      fetch(`/api/proposals?projectId=${encodeURIComponent(currentProjectId)}`)
        .then(r => r.ok ? r.json() : []),
      fetch(`/api/visual-baselines?projectId=${encodeURIComponent(currentProjectId)}`)
        .then(r => r.ok ? r.json() : []),
    ]);

    _tiData = {
      analytics,
      flaky: flaky.tests || [],
      proposals: Array.isArray(proposals) ? proposals : [],
      baselines: Array.isArray(baselines) ? baselines : [],
      days: parseInt(days),
      suiteId,
    };
    tiRender(_tiData);

    const now = new Date();
    const el = document.getElementById('ti-last-updated');
    if (el) el.textContent = `Updated ${now.toLocaleTimeString()}`;
  } catch (e) {
    const loadEl = document.getElementById('ti-loading');
    if (loadEl) { loadEl.style.display = 'block'; loadEl.textContent = 'Failed to load dashboard data. Check console for details.'; }
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function tiRender(d) {
  _tiShowLoading(false);
  _tiShowContent();

  _tiRenderKpis(d);
  _tiRenderFlakyList(d.flaky);
  _tiRenderHealingList(d.proposals, d.days);
  _tiRenderVrtList(d.baselines);
  _tiRenderRecentRuns(d.analytics);
  _tiRenderActionRequired(d.flaky, d.proposals, d.baselines);
}

function _tiRenderKpis(d) {
  const flaky = d.flaky || [];
  const analytics = d.analytics || {};
  const proposals = d.proposals || [];
  const baselines = d.baselines || [];

  const quarantined = flaky.filter(t => t.isQuarantined).length;
  const flagged = flaky.filter(t => t.shouldQuarantine && !t.isQuarantined).length;
  const passRate = analytics.overallPassRate ?? 0;
  const totalEval = flaky.filter(t => t.evaluationState === 'evaluated').length;
  const flakyPenalty = totalEval > 0 ? Math.round((flagged / totalEval) * 20) : 0;
  const healthScore = Math.max(0, passRate - flakyPenalty);
  const healthColor = healthScore >= 90 ? '#4ec9b0' : healthScore >= 70 ? '#f6c543' : '#f48771';

  _tiSetKpi('ti-kpi-health-val', `${healthScore}%`, healthColor);
  _tiSetKpiSub('ti-kpi-health-sub', `${quarantined} quarantined · ${flagged} flagged`);

  const prColor = passRate >= 90 ? '#4ec9b0' : passRate >= 70 ? '#f6c543' : '#f48771';
  _tiSetKpi('ti-kpi-passrate-val', `${passRate}%`, prColor);
  _tiSetKpiSub('ti-kpi-passrate-sub', `${analytics.totalRuns ?? 0} runs · ${analytics.totalTests ?? 0} tests`);

  const flakyCount = flaky.filter(t => t.evaluationState === 'evaluated' && (t.flakeScore ?? 0) >= 0.30).length;
  const flakyColor = flakyCount === 0 ? '#4ec9b0' : flakyCount <= 3 ? '#f6c543' : '#f48771';
  _tiSetKpi('ti-kpi-flaky-val', String(flakyCount), flakyColor);
  _tiSetKpiSub('ti-kpi-flaky-sub', `${quarantined} in quarantine`);

  const cutoff = new Date(Date.now() - d.days * 86400000).toISOString();
  const recentHeals = proposals.filter(p => p.healedAt >= cutoff);
  const autoHeals = recentHeals.filter(p => p.status === 'auto-applied').length;
  const healsColor = recentHeals.length === 0 ? 'var(--text-primary)' : '#4ec9b0';
  _tiSetKpi('ti-kpi-heals-val', String(recentHeals.length), healsColor);
  _tiSetKpiSub('ti-kpi-heals-sub', `${autoHeals} auto-applied`);

  const total = baselines.length;
  const pending = baselines.filter(b => b.status === 'pending-review' || (b.actualImage && !b.approved)).length;
  const vrtColor = pending > 0 ? '#f6c543' : '#4ec9b0';
  _tiSetKpi('ti-kpi-vrt-val', String(total), vrtColor);
  _tiSetKpiSub('ti-kpi-vrt-sub', `${pending} pending review`);
}

function _tiSetKpi(id, value, color) {
  const el = document.getElementById(id);
  if (el) { el.textContent = value; el.style.color = color; }
}

function _tiSetKpiSub(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function _tiRenderFlakyList(tests) {
  const el = document.getElementById('ti-flaky-list');
  if (!el) return;

  const top = (tests || [])
    .filter(t => t.evaluationState === 'evaluated' && t.flakeScore !== undefined)
    .sort((a, b) => (b.flakeScore ?? 0) - (a.flakeScore ?? 0))
    .slice(0, 7);

  if (top.length === 0) {
    el.innerHTML = '<div class="ti-empty">No flaky tests detected. ✓</div>';
    return;
  }

  el.innerHTML = top.map(t => {
    const pct = Math.round((t.flakeScore ?? 0) * 100);
    const scColor = pct >= 50 ? '#f48771' : '#f6c543';
    const qBadge = t.isQuarantined ? '<span style="font-size:10px;color:#f48771" title="Quarantined">⛔</span>' : '';
    const cat = t.classification?.primary ?? '';
    const catStr = cat ? `<span style="font-size:10px;color:var(--neutral-500);text-transform:capitalize">${cat}</span>` : '';
    const sparkline = (t.recentRunsPreview || []).slice(-6).map(r =>
      `<span style="color:${r.status === 'pass' ? '#4ec9b0' : '#f48771'};font-size:9px;font-weight:700" title="${r.status}">${r.status === 'pass' ? '●' : '●'}</span>`
    ).join('');
    return `<div class="ti-flaky-row">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px" title="${escHtml(t.testName)}">${escHtml(t.testName)} ${qBadge}</div>
        <div style="display:flex;gap:6px;align-items:center;margin-top:2px">${catStr}<span style="letter-spacing:1px;font-size:10px">${sparkline}</span></div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div class="ti-score-pill" style="background:${scColor}22;color:${scColor}">${pct}%</div>
        <div style="font-size:9px;color:var(--neutral-500);margin-top:1px">flake score</div>
      </div>
    </div>`;
  }).join('');
}

function _tiRenderHealingList(proposals, days) {
  const el = document.getElementById('ti-healing-list');
  if (!el) return;

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const recent = (proposals || [])
    .filter(p => p.healedAt >= cutoff)
    .sort((a, b) => b.healedAt.localeCompare(a.healedAt))
    .slice(0, 7);

  if (recent.length === 0) {
    el.innerHTML = `<div class="ti-empty">No heals in last ${days} days.</div>`;
    return;
  }

  el.innerHTML = recent.map(p => {
    const conf = p.confidence ?? 0;
    const confColor = conf >= 80 ? '#4ec9b0' : conf >= 60 ? '#f6c543' : '#f48771';
    const statusBadge = p.status === 'auto-applied'
      ? '<span style="font-size:10px;color:#4ec9b0">auto</span>'
      : '<span style="font-size:10px;color:#f6c543">review</span>';
    const age = _tiRelTime(p.healedAt);
    return `<div class="ti-heal-row">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px" title="${escHtml(p.locatorName)}">${escHtml(p.locatorName)}</div>
        <div style="font-size:11px;color:var(--neutral-400);margin-top:2px">${escHtml(p.newSelectorType)} · ${age} ${statusBadge}</div>
      </div>
      <span style="font-size:12px;font-weight:700;color:${confColor}">${conf}%</span>
    </div>`;
  }).join('');
}

function _tiRenderVrtList(baselines) {
  const el = document.getElementById('ti-vrt-list');
  if (!el) return;

  if (!baselines || baselines.length === 0) {
    el.innerHTML = '<div class="ti-empty">No visual baselines configured.</div>';
    return;
  }

  const sorted = [...baselines].sort((a, b) => {
    const aPending = (a.status === 'pending-review' || (a.actualImage && !a.approved)) ? 0 : 1;
    const bPending = (b.status === 'pending-review' || (b.actualImage && !b.approved)) ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    return (a.pageKey || '').localeCompare(b.pageKey || '');
  }).slice(0, 8);

  el.innerHTML = sorted.map(b => {
    const isPending = b.status === 'pending-review' || (b.actualImage && !b.approved);
    const statusDot = isPending
      ? '<span style="color:#f6c543;font-size:13px">●</span>'
      : '<span style="color:#4ec9b0;font-size:13px">●</span>';
    const labelColor = isPending ? '#f6c543' : '#4ec9b0';
    const labelText = isPending ? 'Review needed' : 'Approved';
    const diffPct = b.diffPercent != null && b.diffPercent > 0
      ? `<span style="font-size:10px;color:#f48771;font-weight:600">${b.diffPercent.toFixed(1)}% diff</span>`
      : '';
    // Parse readable name from baseline ID: {projectId}___{testName}__{locator}
    const rawId = b.pageKey || b.id || '';
    const readable = _tiParseBaselineLabel(rawId);
    return `<div class="ti-vrt-row">
      <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">
        ${statusDot}
        <div style="min-width:0">
          <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;font-weight:600;font-size:12px" title="${escHtml(rawId)}">${escHtml(readable.test)}</div>
          <div style="font-size:10px;color:var(--neutral-400);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px">${escHtml(readable.locator)} ${diffPct}</div>
        </div>
      </div>
      <span style="font-size:11px;color:${labelColor};white-space:nowrap;flex-shrink:0">${labelText}</span>
    </div>`;
  }).join('');
}

function _tiRenderRecentRuns(analytics) {
  const el = document.getElementById('ti-trend-chart');
  const emptyEl = document.getElementById('ti-trend-empty');
  if (!el) return;

  const runs = (analytics?.recentRuns || []);
  // Build from passRateTrend + suiteComparison if recentRuns not available
  const trend = analytics?.passRateTrend || [];
  const visible = trend.slice(-7);

  if (visible.length === 0) {
    el.innerHTML = '';
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  el.innerHTML = visible.map(row => {
    const pct = row.passRate;
    const color = pct >= 90 ? '#4ec9b0' : pct >= 70 ? '#f6c543' : '#f48771';
    const label = row.day.slice(5);
    const passedFailed = row.total > 0 ? `${row.passed}✓ ${row.failed}✗ of ${row.total}` : '';
    return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-color)">
      <div style="font-size:11px;color:var(--neutral-500);width:38px;flex-shrink:0;font-weight:600">${label}</div>
      <div style="flex:1;background:var(--bg-1);border-radius:3px;height:14px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div>
      </div>
      <div style="font-size:11px;font-weight:700;color:${color};width:34px;text-align:right">${pct}%</div>
      <div style="font-size:10px;color:var(--neutral-400);width:90px;text-align:right">${passedFailed}</div>
    </div>`;
  }).join('');
}

function _tiRenderActionRequired(flaky, proposals, baselines) {
  const tbody = document.getElementById('ti-suite-tbody');
  const emptyEl = document.getElementById('ti-suite-empty');
  if (!tbody) return;

  const actions = [];

  // Flaky tests flagged but not quarantined
  (flaky || []).filter(t => t.shouldQuarantine && !t.isQuarantined).slice(0, 4).forEach(t => {
    actions.push({ type: 'flaky', icon: '⚠️', color: '#f6c543', label: escHtml(t.testName), detail: `Flake ${Math.round((t.flakeScore||0)*100)}% — recommend quarantine` });
  });

  // Heal proposals pending review
  (proposals || []).filter(p => p.status === 'pending-review').slice(0, 3).forEach(p => {
    actions.push({ type: 'heal', icon: '🔧', color: '#4ec9b0', label: escHtml(p.locatorName), detail: `Heal proposal ${p.confidence}% confidence — pending review` });
  });

  // VRT pending review
  (baselines || []).filter(b => b.status === 'pending-review' || (b.actualImage && !b.approved)).slice(0, 3).forEach(b => {
    const readable = _tiParseBaselineLabel(b.pageKey || b.id || '');
    const diffStr = b.diffPercent > 0 ? ` · ${b.diffPercent.toFixed(1)}% diff` : '';
    actions.push({ type: 'vrt', icon: '🖼', color: '#f6c543', label: escHtml(readable.test), detail: `Visual change${diffStr} — needs approval` });
  });

  if (actions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center;color:var(--neutral-500);padding:16px;font-size:12px">✓ No actions required</td></tr>`;
    if (emptyEl) emptyEl.style.display = 'none';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  tbody.innerHTML = actions.map(a => `<tr>
    <td style="max-width:200px">
      <div style="font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${a.label}">${a.icon} ${a.label}</div>
      <div style="font-size:11px;color:var(--neutral-400);margin-top:2px">${a.detail}</div>
    </td>
    <td style="text-align:right;white-space:nowrap">
      <span style="font-size:10px;font-weight:600;color:${a.color};background:${a.color}22;padding:2px 8px;border-radius:10px;text-transform:uppercase">${a.type}</span>
    </td>
  </tr>`).join('');
}

function _tiParseBaselineLabel(rawId) {
  // Format: {projectId}___{testName}__{locatorName}
  const triSplit = rawId.split('___');
  if (triSplit.length >= 2) {
    const rest = triSplit.slice(1).join('___');
    const lastDouble = rest.lastIndexOf('__');
    if (lastDouble > 0) {
      const locator = rest.slice(lastDouble + 2).replace(/_/g, ' ').trim();
      const test = rest.slice(0, lastDouble).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
      return { test: test.slice(0, 35) || rawId.slice(0, 35), locator: locator.slice(0, 30) || '' };
    }
    return { test: rest.replace(/_/g, ' ').slice(0, 35), locator: '' };
  }
  return { test: rawId.slice(0, 35), locator: '' };
}

// ── Suite Filter ──────────────────────────────────────────────────────────────

function tiPopulateSuiteFilter() {
  const sel = document.getElementById('ti-suite-filter');
  if (!sel || typeof allSuites === 'undefined') return;
  const prev = sel.value;
  const proj = allSuites.filter(s => s.projectId === currentProjectId);
  sel.innerHTML = '<option value="">All Suites</option>' +
    proj.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
  if (prev) sel.value = prev;
}

// ── Auto-refresh ──────────────────────────────────────────────────────────────

function tiToggleAutoRefresh() {
  const enabled = document.getElementById('ti-autorefresh')?.checked;
  if (enabled) {
    _tiStartRefreshCycle();
  } else {
    _tiStopRefreshCycle();
    const cntEl = document.getElementById('ti-refresh-countdown');
    if (cntEl) cntEl.textContent = '';
  }
}

function _tiStartRefreshCycle() {
  _tiStopRefreshCycle();
  _tiCountdownSec = 30;
  _tiCountdownTimer = setInterval(() => {
    _tiCountdownSec--;
    const cntEl = document.getElementById('ti-refresh-countdown');
    if (cntEl) cntEl.textContent = `Next refresh in ${_tiCountdownSec}s`;
    if (_tiCountdownSec <= 0) {
      _tiCountdownSec = 30;
      tiLoad();
    }
  }, 1000);
}

function _tiStopRefreshCycle() {
  if (_tiCountdownTimer) { clearInterval(_tiCountdownTimer); _tiCountdownTimer = null; }
  if (_tiRefreshTimer) { clearInterval(_tiRefreshTimer); _tiRefreshTimer = null; }
}

function tiOnTabActive() {
  tiLoad();
  const autoRefreshEl = document.getElementById('ti-autorefresh');
  if (autoRefreshEl?.checked) _tiStartRefreshCycle();
}

function tiOnTabInactive() {
  _tiStopRefreshCycle();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _tiRelTime(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  } catch { return '—'; }
}

function _tiShowLoading(show) {
  const el = document.getElementById('ti-loading');
  if (!el) return;
  if (show) {
    el.style.display = 'block';
    el.textContent = 'Loading…';
  } else {
    el.style.display = 'none';
  }
}

function _tiHideContent() {
  // sections remain visible but will show empty/placeholder state
}

function _tiShowContent() {
  const loadEl = document.getElementById('ti-loading');
  if (loadEl) loadEl.style.display = 'none';
}
