// API FLAKINESS ANALYTICS MODULE
// Collection-level flakiness report: hotspots, clusters, step breakdown
// ══════════════════════════════════════════════════════════════════════════════

var _flakinessColId   = null;
var _flakinessReport  = null;

async function flakinessLoad(collectionId) {
  _flakinessColId = collectionId || _flakinessColId;
  if (!_flakinessColId) {
    document.getElementById('flakiness-empty').style.display = '';
    document.getElementById('flakiness-content').style.display = 'none';
    return;
  }
  document.getElementById('flakiness-empty').style.display = 'none';
  document.getElementById('flakiness-content').style.display = '';
  document.getElementById('flakiness-loading').style.display = '';

  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(_flakinessColId));
    _flakinessReport = await res.json();
    _flakinessRender();
  } catch (e) {
    document.getElementById('flakiness-loading').style.display = 'none';
    modAlert('flakiness-alert', 'error', 'Load failed: ' + e.message);
  }
}

async function flakinessRecompute() {
  if (!_flakinessColId) return;
  document.getElementById('flakiness-loading').style.display = '';
  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(_flakinessColId) + '/recompute', { method: 'POST' });
    _flakinessReport = await res.json();
    _flakinessRender();
  } catch (e) {
    modAlert('flakiness-alert', 'error', 'Recompute failed: ' + e.message);
  } finally {
    document.getElementById('flakiness-loading').style.display = 'none';
  }
}

function _flakinessRender() {
  document.getElementById('flakiness-loading').style.display = 'none';
  if (!_flakinessReport) return;
  _flakinessRenderSummary();
  _flakinessRenderHotspots();
  _flakinessRenderClusters();
  _flakinessRenderStepTable();
}

function _flakinessRenderSummary() {
  const r = _flakinessReport;
  const el = document.getElementById('flakiness-summary');
  if (!el) return;
  const stability = Math.round(r.stabilityScore * 100);
  const stabColor = stability >= 90 ? '#22c55e' : stability >= 70 ? '#f59e0b' : '#ef4444';
  el.innerHTML = `
    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px;">
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:${stabColor}">${stability}%</div>
        <div style="font-size:11px;color:var(--text-muted)">Stability Score</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:var(--text-main)">${r.runsAnalyzed}</div>
        <div style="font-size:11px;color:var(--text-muted)">Runs Analyzed</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#facc15">${r.hotspots.length}</div>
        <div style="font-size:11px;color:var(--text-muted)">Flaky Steps</div>
      </div>
      <div style="text-align:center;">
        <div style="font-size:28px;font-weight:700;color:#a78bfa">${r.clusters.length}</div>
        <div style="font-size:11px;color:var(--text-muted)">Clusters</div>
      </div>
    </div>
    <div style="font-size:10px;color:var(--text-muted)">Computed: ${new Date(r.computedAt).toLocaleString()}</div>`;
}

function _flakinessRenderHotspots() {
  const el = document.getElementById('flakiness-hotspots');
  if (!el || !_flakinessReport) return;
  const hotspotIds = new Set(_flakinessReport.hotspots);
  const flaky = _flakinessReport.stepRecords.filter(r => hotspotIds.has(r.stepId))
    .sort((a, b) => b.flakinessScore - a.flakinessScore);
  if (flaky.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No flaky steps detected.</div>';
    return;
  }
  el.innerHTML = flaky.map(function(r) {
    var pct = Math.round(r.flakinessScore * 100);
    var barColor = pct >= 70 ? '#ef4444' : pct >= 40 ? '#f59e0b' : '#facc15';
    return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #374151;">'
      + '<div style="flex:1;font-size:12px;">' + _flakinessEscHtml(r.stepName) + '</div>'
      + '<div style="width:100px;background:#1e2130;border-radius:4px;height:8px;">'
      + '<div style="width:' + pct + '%;background:' + barColor + ';border-radius:4px;height:100%;"></div></div>'
      + '<div style="width:36px;text-align:right;font-size:11px;color:' + barColor + ';">' + pct + '%</div>'
      + '<div style="width:60px;text-align:right;font-size:10px;color:var(--text-muted);">' + Math.round(r.failRate * 100) + '% fail</div>'
      + '</div>';
  }).join('');
}

function _flakinessRenderClusters() {
  const el = document.getElementById('flakiness-clusters');
  if (!el || !_flakinessReport) return;
  if (_flakinessReport.clusters.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No failure clusters detected.</div>';
    return;
  }
  el.innerHTML = _flakinessReport.clusters.map(function(c) {
    var dimLabel = { http_status: 'HTTP Status', assertion_type: 'Assertion', transport_error: 'Transport Error', dependency_chain: 'Dependency Chain', endpoint: 'Endpoint' }[c.dimension] || c.dimension;
    return '<div class="flakiness-cluster-card">'
      + '<h4>' + dimLabel + ': ' + _flakinessEscHtml(c.dimensionKey) + '</h4>'
      + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">' + c.stepIds.length + ' step(s) · ' + c.totalFailures + ' total failures · avg score ' + Math.round(c.avgFlakinessScore * 100) + '%</div>'
      + '<div style="font-size:11px;color:#9ca3af;">' + c.stepNames.map(function(n) { return _flakinessEscHtml(n); }).join(', ') + '</div>'
      + '</div>';
  }).join('');
}

function _flakinessRenderStepTable() {
  const el = document.getElementById('flakiness-step-tbody');
  if (!el || !_flakinessReport) return;
  const records = [..._flakinessReport.stepRecords].sort((a, b) => b.flakinessScore - a.flakinessScore);
  el.innerHTML = records.map(function(r) {
    var pct = Math.round(r.flakinessScore * 100);
    var color = r.isFlaky ? '#facc15' : '#22c55e';
    var flakyLabel = r.isFlaky ? '<span class="api-run-flaky-badge">⚡ flaky</span>' : '<span style="color:#22c55e;font-size:10px;">stable</span>';
    var sig = r.dominantSignature ? r.dominantSignature.category : '—';
    return '<tr>'
      + '<td style="font-size:12px;">' + _flakinessEscHtml(r.stepName) + ' ' + flakyLabel + '</td>'
      + '<td style="text-align:center;font-size:11px;">' + Math.round(r.failRate * 100) + '%</td>'
      + '<td><div style="display:flex;align-items:center;gap:4px;">'
      + '<div style="width:60px;background:#1e2130;border-radius:3px;height:6px;">'
      + '<div style="width:' + pct + '%;background:' + color + ';border-radius:3px;height:100%;"></div></div>'
      + '<span style="font-size:10px;color:' + color + ';">' + pct + '%</span></div></td>'
      + '<td style="font-size:11px;color:var(--text-muted);">' + _flakinessEscHtml(sig) + '</td>'
      + '<td style="text-align:center;font-size:11px;">' + r.totalRuns + '</td>'
      + '</tr>';
  }).join('');
}

function _flakinessEscHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
