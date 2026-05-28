// 29-worker-health.js — Worker pool health dashboard (Phase D Step 12)

function workerHealthInit(panel) {
  panel.innerHTML = '<div id="worker-health-alert"></div><div id="worker-health-content"><div class="worker-health-loading">Loading worker health...</div></div>';
  workerHealthLoad();
}

function workerHealthLoad() {
  fetch('/api/worker-pool/health')
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .then(function(report) { workerHealthRenderReport(report); })
    .catch(function(e) {
      var el = document.getElementById('worker-health-content');
      if (el) el.innerHTML = '<div style="color:#f87171;padding:12px;">Failed to load worker health: ' + escHtml(String(e)) + '</div>';
    });
}

function workerHealthRenderReport(report) {
  var el = document.getElementById('worker-health-content');
  if (!el) return;

  var healthClass = report.isHealthy ? 'healthy' : 'unhealthy';
  var healthLabel = report.isHealthy ? '✓ Healthy' : '✗ Unhealthy';

  var stuckHtml = '';
  if (report.stuckRuns && report.stuckRuns.length > 0) {
    stuckHtml = '<h4 style="margin:16px 0 8px;">Stuck Runs</h4>'
      + '<div>' + report.stuckRuns.map(function(r) {
        return '<div class="stuck-run-row">'
          + '<span class="stuck-run-badge">STUCK</span>'
          + '<span style="font-family:monospace;">' + escHtml(r.runId) + '</span>'
          + '<span style="color:var(--text-muted);">worker: ' + escHtml(r.workerId) + '</span>'
          + '<span style="color:var(--text-muted);">leased: ' + escHtml(r.leasedAt) + '</span>'
          + '<span style="color:#ef4444;">' + Math.round(r.stuckForMs / 1000) + 's</span>'
          + '</div>';
      }).join('') + '</div>';
  } else {
    stuckHtml = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;">No stuck runs detected.</div>';
  }

  el.innerHTML = '<div class="worker-health-card ' + healthClass + '">'
    + '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">'
    + '<span style="font-size:18px;font-weight:600;">' + healthLabel + '</span>'
    + '<span style="color:var(--text-muted);font-size:12px;">Generated: ' + escHtml(report.generatedAt) + '</span>'
    + '</div>'
    + '<div style="display:flex;gap:16px;flex-wrap:wrap;">'
    + _workerHealthMetric('Workers', report.workerCount)
    + _workerHealthMetric('Active Leases', report.activeLeaseCount)
    + _workerHealthMetric('Stuck Runs', report.stuckRuns ? report.stuckRuns.length : 0)
    + '</div>'
    + '</div>'
    + stuckHtml;
}

function _workerHealthMetric(label, value) {
  return '<div class="worker-health-metric">'
    + '<div style="font-size:22px;font-weight:700;">' + escHtml(String(value)) + '</div>'
    + '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;">' + escHtml(label) + '</div>'
    + '</div>';
}

if (typeof registerPageModule === 'function') {
  registerPageModule('worker-health', workerHealthInit);
}
