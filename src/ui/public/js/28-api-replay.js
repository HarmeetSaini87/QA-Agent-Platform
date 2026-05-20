// Module: Observability & Replay Engine UI
// Page: api-replay

var _apiReplayCurrentRunId = null;

function apiReplayInit() {
  apiReplayRenderLanding();
}

function apiReplayRenderLanding() {
  var el = document.getElementById('api-replay-content');
  if (!el) return;
  el.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px;">'
    + '<div style="font-size:16px;font-weight:600;margin-bottom:12px;color:#e5e7eb;">🔍 Execution Replay &amp; Observability</div>'
    + '<p>Enter a Run ID to inspect its replay events, timeline, and observability summary.</p>'
    + '<div style="display:flex;gap:8px;margin-top:12px;">'
    + '<input id="api-replay-run-input" class="form-control" style="max-width:320px;" placeholder="Run ID (e.g. abc123)" />'
    + '<button class="btn btn-sm" onclick="apiReplayLoad()">Load</button>'
    + '</div>'
    + '<div style="margin-top:16px;font-size:11px;color:#4b5563;">Tip: copy the Run ID from the API Runs tab.</div>'
    + '</div>';
}

async function apiReplayLoad(runId) {
  runId = runId || (document.getElementById('api-replay-run-input') || {}).value || '';
  runId = runId.trim();
  if (!runId) { modAlert('api-replay-alert', 'error', 'Enter a Run ID.'); return; }
  _apiReplayCurrentRunId = runId;

  var el = document.getElementById('api-replay-content');
  if (el) el.innerHTML = '<div style="color:var(--text-muted);padding:16px;">Loading observability data...</div>';

  try {
    var res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/observability');
    if (!res.ok) {
      var err = await res.json();
      modAlert('api-replay-alert', 'error', (err.error && err.error.message) || 'Run not found.');
      apiReplayRenderLanding();
      return;
    }
    var summary = await res.json();
    apiReplayRenderSummary(summary);
  } catch (e) {
    modAlert('api-replay-alert', 'error', 'Error: ' + e.message);
  }
}

function apiReplayRenderSummary(summary) {
  var el = document.getElementById('api-replay-content');
  if (!el) return;

  var statusColor = summary.status === 'passed' ? '#4ade80' : '#f87171';
  var replay = summary.replay || {};
  var stats = replay.stats || {};

  el.innerHTML = '<div style="margin-bottom:12px;">'
    + '<button class="btn btn-sm" onclick="apiReplayRenderLanding()">&#8592; Back</button>'
    + '</div>'
    + '<div style="font-size:15px;font-weight:600;margin-bottom:4px;">'
    + 'Run: <span style="font-family:monospace;font-size:13px;">' + escHtml(summary.runId) + '</span>'
    + ' <span style="color:' + statusColor + ';margin-left:8px;">' + escHtml(summary.status.toUpperCase()) + '</span>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:16px;">'
    + escHtml(summary.startedAt.replace('T',' ').slice(0,19))
    + ' &middot; ' + summary.stepCount + ' steps'
    + (summary.hasSnapshot ? ' &middot; <span style="color:#a78bfa;">snapshot</span>' : '')
    + (summary.hasTimeline ? ' &middot; <span style="color:#60a5fa;">timeline</span>' : '')
    + '</div>'

    // Stats cards
    + '<div style="margin-bottom:16px;">'
    + _obsStatCard(stats.requestsSent || 0, 'Requests')
    + _obsStatCard(stats.assertionsPassed || 0, 'Assertions Passed')
    + _obsStatCard(stats.assertionsFailed || 0, 'Assertions Failed')
    + _obsStatCard(stats.retriesTriggered || 0, 'Retries')
    + _obsStatCard(stats.teardownEvents || 0, 'Teardowns')
    + _obsStatCard(stats.failuresPropagated || 0, 'Failures')
    + '</div>'

    // Tab bar
    + '<div style="display:flex;gap:8px;margin-bottom:12px;border-bottom:1px solid #374151;padding-bottom:8px;">'
    + '<button class="tbl-btn" onclick="apiReplayShowTab(\'events\')">Replay Events (' + (replay.eventCount || 0) + ')</button>'
    + '<button class="tbl-btn" onclick="apiReplayShowTab(\'timeline\')">Timeline</button>'
    + (summary.snapshotSummary ? '<button class="tbl-btn" onclick="apiReplayShowTab(\'snapshot\')">Snapshot</button>' : '')
    + '</div>'
    + '<div id="api-replay-tab-content"></div>';

  apiReplayShowTab('events');
}

function _obsStatCard(value, label) {
  return '<div class="obs-stat-card"><span class="obs-stat-value">' + value + '</span><span class="obs-stat-label">' + escHtml(label) + '</span></div>';
}

async function apiReplayShowTab(tab) {
  var el = document.getElementById('api-replay-tab-content');
  if (!el) return;

  if (tab === 'events') {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Loading replay events...</div>';
    try {
      var res = await fetch('/api/api-runs/' + encodeURIComponent(_apiReplayCurrentRunId) + '/replay-events');
      if (!res.ok) { el.innerHTML = '<div style="color:#f87171;">Failed to load replay events.</div>'; return; }
      var session = await res.json();
      el.innerHTML = apiReplayEventsHtml(session.events || []);
    } catch (e) {
      el.innerHTML = '<div style="color:#f87171;">Error: ' + escHtml(e.message) + '</div>';
    }

  } else if (tab === 'timeline') {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:11px;">Loading timeline...</div>';
    try {
      var res2 = await fetch('/api/api-runs/' + encodeURIComponent(_apiReplayCurrentRunId) + '/timeline');
      if (!res2.ok) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No timeline recorded for this run.</div>'; return; }
      var timeline = await res2.json();
      el.innerHTML = apiReplayTimelineHtml(timeline.events || []);
    } catch (e2) {
      el.innerHTML = '<div style="color:#f87171;">Error: ' + escHtml(e2.message) + '</div>';
    }

  } else if (tab === 'snapshot') {
    var res3 = await fetch('/api/api-runs/' + encodeURIComponent(_apiReplayCurrentRunId) + '/observability');
    var obs = res3.ok ? await res3.json() : null;
    var snap = obs && obs.snapshotSummary;
    if (!snap) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">No snapshot available.</div>'; return; }
    el.innerHTML = '<div style="font-size:12px;padding:8px;">'
      + '<div><b>Captured:</b> ' + escHtml(snap.capturedAt.replace('T',' ').slice(0,19)) + '</div>'
      + '<div><b>Completed nodes:</b> ' + snap.completedNodeIds + '</div>'
      + '<div><b>Failed nodes:</b> ' + snap.failedNodeIds + '</div>'
      + '<div><b>Skipped nodes:</b> ' + snap.skippedNodeIds + '</div>'
      + '</div>';
  }
}

function apiReplayEventsHtml(events) {
  if (!events.length) return '<div style="color:var(--text-muted);font-size:12px;padding:8px;">No replay events.</div>';
  return '<div style="max-height:480px;overflow-y:auto;">'
    + events.map(function(e) {
      var kindClass = 'kind-' + e.kind;
      var detail = '';
      if (e.request) detail = e.request.method + ' ' + escHtml(e.request.url);
      else if (e.response) detail = 'HTTP ' + e.response.status + ' (' + e.response.durationMs + 'ms)';
      else if (e.assertion) detail = (e.assertion.passed ? '✓ ' : '✗ ') + escHtml(e.assertion.type) + (e.assertion.message ? ': ' + escHtml(e.assertion.message) : '');
      else if (e.variable) detail = e.variable.key + ' = ' + escHtml(e.variable.maskedValue);
      else if (e.failure) detail = escHtml(e.failure.reason);
      else if (e.skipReason) detail = escHtml(e.skipReason);
      return '<div class="replay-event-row">'
        + '<span style="color:#4b5563;min-width:32px;">' + e.seq + '</span>'
        + '<span class="replay-event-kind ' + kindClass + '">' + escHtml(e.kind.replace(/-/g,' ')) + '</span>'
        + '<span style="color:#9ca3af;min-width:120px;">' + escHtml(e.stepName) + '</span>'
        + '<span>' + detail + '</span>'
        + (e.durationMs != null ? '<span style="color:#4b5563;margin-left:auto;">' + e.durationMs + 'ms</span>' : '')
        + '</div>';
    }).join('')
    + '</div>';
}

function apiReplayTimelineHtml(events) {
  if (!events.length) return '<div style="color:var(--text-muted);font-size:12px;padding:8px;">No timeline events.</div>';
  return '<div style="max-height:480px;overflow-y:auto;">'
    + events.map(function(e) {
      var typeClass = 'evt-' + e.eventType;
      return '<div class="timeline-event-row">'
        + '<span class="timeline-event-type ' + typeClass + '">' + escHtml(e.eventType) + '</span>'
        + '<span style="color:#9ca3af;">' + escHtml(e.nodeName) + '</span>'
        + (e.durationMs != null ? '<span style="color:#4b5563;margin-left:auto;">' + e.durationMs + 'ms</span>' : '')
        + (e.detail ? '<span style="color:#6b7280;">' + escHtml(e.detail) + '</span>' : '')
        + '</div>';
    }).join('')
    + '</div>';
}

// Page load hook
if (typeof registerPageModule === 'function') {
  registerPageModule('api-replay', apiReplayInit);
}
