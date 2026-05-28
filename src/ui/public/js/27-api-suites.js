// Module: API Suite Orchestration
// Page: api-suites

var _apiSuitesList = [];
var _apiSuitesCurrentSuiteId = null;

function apiSuitesInit() {
  apiSuitesLoad();
}

async function apiSuitesLoad() {
  var tbody = document.getElementById('api-suites-tbody');
  if (!tbody) return;

  if (!currentProjectId) {
    _apiSuitesList = [];
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">Select a project from the top bar to view API suites.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:16px;">Loading…</td></tr>';
  try {
    var url = '/api/api-suites?projectId=' + encodeURIComponent(currentProjectId);
    var res = await fetch(url);
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Failed to load suites.'); return; }
    _apiSuitesList = await res.json();
    _apiSuitesHideDetail();
    apiSuitesRender();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error loading suites: ' + e.message);
  }
}

function _apiSuitesHideDetail() {
  var detail = document.getElementById('api-suites-detail');
  var tbl = document.querySelector('#panel-api-suites .data-table');
  var filters = document.querySelector('#panel-api-suites [id="api-suites-filter-name"]')?.closest('div');
  if (detail) detail.style.display = 'none';
  if (tbl) tbl.style.display = '';
  if (filters) filters.style.display = '';
}

function _apiSuitesShowDetail() {
  var detail = document.getElementById('api-suites-detail');
  var tbl = document.querySelector('#panel-api-suites .data-table');
  var filters = document.querySelector('#panel-api-suites [id="api-suites-filter-name"]')?.closest('div');
  if (detail) detail.style.display = '';
  if (tbl) tbl.style.display = 'none';
  if (filters) filters.style.display = 'none';
}

function apiSuitesRender() {
  var tbody = document.getElementById('api-suites-tbody');
  if (!tbody) return;

  var nameFilter = (document.getElementById('api-suites-filter-name')?.value || '').toLowerCase();
  var statusFilter = document.getElementById('api-suites-filter-status')?.value || '';

  var filtered = _apiSuitesList.filter(function(s) {
    if (nameFilter && !escHtml(s.name).toLowerCase().includes(nameFilter)) return false;
    if (statusFilter === 'active' && s.archived) return false;
    if (statusFilter === 'archived' && !s.archived) return false;
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:20px;">'
      + (_apiSuitesList.length === 0 ? 'No API suites yet. Click <strong>+ New Suite</strong> to create one.' : 'No suites match the current filter.')
      + '</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(function(s) {
    var colCount = s.collectionIds ? s.collectionIds.length : 0;
    var hooks = [];
    if (s.beforeAllCollectionId) hooks.push('beforeAll');
    if (s.afterAllCollectionId) hooks.push('afterAll');
    var lifecycle = hooks.length ? hooks.join(', ') : '—';
    var statusBadge = s.archived
      ? '<span class="badge badge-grey">Archived</span>'
      : '<span class="badge badge-green">Active</span>';
    return '<tr>'
      + '<td><a href="#" onclick="apiSuitesShowDetail(\'' + s.id + '\');return false;" style="font-weight:500">' + escHtml(s.name) + '</a> ' + statusBadge + '</td>'
      + '<td>' + colCount + ' collection' + (colCount !== 1 ? 's' : '') + '</td>'
      + '<td>' + escHtml(s.environmentId || '—') + '</td>'
      + '<td style="font-size:12px;color:var(--text-muted)">' + escHtml(lifecycle) + '</td>'
      + '<td>'
      + '<button class="tbl-btn run-btn" onclick="apiSuitesRunSuite(\'' + s.id + '\')">&#9654; Run</button> '
      + '<button class="tbl-btn" onclick="apiSuitesShowDetail(\'' + s.id + '\')">Detail</button> '
      + '<button class="tbl-btn del" onclick="apiSuitesDelete(\'' + s.id + '\')">Delete</button>'
      + '</td>'
      + '</tr>';
  }).join('');
}

async function apiSuitesShowDetail(suiteId) {
  _apiSuitesCurrentSuiteId = suiteId;
  var detail = document.getElementById('api-suites-detail');
  if (!detail) return;
  _apiSuitesShowDetail();
  detail.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:12px;">Loading…</div>';
  try {
    var suiteRes = await fetch('/api/api-suites/' + encodeURIComponent(suiteId));
    var runsRes = await fetch('/api/api-suites/' + encodeURIComponent(suiteId) + '/runs');
    if (!suiteRes.ok) { modAlert('api-suites-alert', 'error', 'Suite not found'); return; }
    var suite = await suiteRes.json();
    var runs = runsRes.ok ? await runsRes.json() : [];
    detail.innerHTML = apiSuitesDetailHtml(suite, runs);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesDetailHtml(suite, runs) {
  var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">'
    + '<button class="btn btn-secondary btn-sm" onclick="apiSuitesLoad()">&#8592; Back to Suites</button>'
    + '<button class="btn btn-primary btn-sm" onclick="apiSuitesRunSuite(\'' + escHtml(suite.id) + '\')">&#9654; Run Suite</button>'
    + '</div>'
    + '<div style="font-size:17px;font-weight:600;margin-bottom:4px;">' + escHtml(suite.name) + '</div>'
    + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;display:flex;gap:16px;">'
    + '<span>Collections: <strong>' + (suite.collectionIds || []).length + '</strong></span>'
    + '<span>Environment: <strong>' + escHtml(suite.environmentId || '—') + '</strong></span>'
    + '<span>On Failure: <strong>' + escHtml(suite.onFailure || 'continue') + '</strong></span>'
    + (suite.beforeAllCollectionId ? '<span>beforeAll: <strong>' + escHtml(suite.beforeAllCollectionId) + '</strong></span>' : '')
    + (suite.afterAllCollectionId ? '<span>afterAll: <strong>' + escHtml(suite.afterAllCollectionId) + '</strong></span>' : '')
    + '</div>';

  html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Recent Runs <span style="font-size:12px;color:var(--text-muted);font-weight:400">(' + runs.length + ' total)</span></div>';

  if (runs.length === 0) {
    html += '<div style="color:var(--text-muted);font-size:12px;padding:12px 0;">No runs yet for this suite.</div>';
    return html;
  }

  html += '<table class="data-table"><thead><tr><th>Run ID</th><th>Status</th><th>Phases</th><th>Duration</th><th>Started</th><th>Actions</th></tr></thead><tbody>'
    + runs.slice(0, 20).map(function(r) {
      var statusCell = r.status === 'passed'
        ? '<span class="badge badge-green">PASSED</span>'
        : '<span class="badge badge-red">FAILED</span>';
      return '<tr>'
        + '<td style="font-size:11px;font-family:monospace">' + escHtml(r.id.slice(0, 8)) + '…</td>'
        + '<td>' + statusCell + '</td>'
        + '<td>' + (r.phaseResults ? r.phaseResults.length : '—') + '</td>'
        + '<td>' + (r.durationMs ? Math.round(r.durationMs / 1000) + 's' : '—') + '</td>'
        + '<td style="font-size:11px;">' + escHtml((r.startedAt || '').replace('T', ' ').slice(0, 19)) + '</td>'
        + '<td><button class="tbl-btn" onclick="apiSuitesShowRun(\'' + escHtml(r.id) + '\')">View</button></td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';

  return html;
}

async function apiSuitesShowRun(runId) {
  var detail = document.getElementById('api-suites-detail');
  if (!detail) return;
  detail.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:12px;">Loading run…</div>';
  try {
    var res = await fetch('/api/api-suite-runs/' + encodeURIComponent(runId));
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Run not found'); return; }
    var run = await res.json();
    detail.innerHTML = apiSuitesRunHtml(run);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesRunHtml(run) {
  var statusBadge = run.status === 'passed'
    ? '<span class="badge badge-green">PASSED</span>'
    : '<span class="badge badge-red">FAILED</span>';

  var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">'
    + '<button class="btn btn-secondary btn-sm" onclick="apiSuitesShowDetail(\'' + escHtml(run.suiteId) + '\')">&#8592; Back to Suite</button>'
    + '</div>'
    + '<div style="font-size:17px;font-weight:600;margin-bottom:4px;">' + escHtml(run.suiteName) + ' &nbsp;' + statusBadge + '</div>'
    + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;">'
    + escHtml((run.startedAt || '').replace('T', ' ').slice(0, 19))
    + ' &nbsp;&middot;&nbsp; ' + (run.durationMs ? Math.round(run.durationMs / 1000) + 's' : '—')
    + '</div>'
    + '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Lifecycle Timeline</div>'
    + '<table class="data-table"><thead><tr><th>Phase</th><th>Collection</th><th>Status</th><th>Duration</th></tr></thead><tbody>'
    + (run.phaseResults || []).map(function(p) {
      var phaseStatus = p.status === 'passed'
        ? '<span class="badge badge-green">passed</span>'
        : p.status === 'failed'
          ? '<span class="badge badge-red">failed</span>'
          : '<span class="badge badge-grey">' + escHtml(p.status) + '</span>';
      var hookBadge = p.isLifecycleHook
        ? '<span style="font-size:10px;background:#1f2937;border:1px solid #374151;border-radius:3px;padding:1px 5px;margin-left:4px;color:#9ca3af;">'
          + escHtml(p.phase.replace(/_/g, ' ').toUpperCase()) + '</span>'
        : '';
      return '<tr>'
        + '<td>' + escHtml(p.phase) + hookBadge + '</td>'
        + '<td><a href="#" onclick="typeof apiRunsLoadByRunId===\'function\'&&apiRunsLoadByRunId(\'' + escHtml(p.runId) + '\');return false;">' + escHtml(p.collectionName) + '</a></td>'
        + '<td>' + phaseStatus + '</td>'
        + '<td>' + (p.durationMs || '—') + (p.durationMs ? 'ms' : '') + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';

  return html;
}

async function apiSuitesRunSuite(suiteId) {
  try {
    var res = await fetch('/api/api-suites/' + encodeURIComponent(suiteId) + '/run', { method: 'POST' });
    if (!res.ok) {
      var err = await res.json();
      modAlert('api-suites-alert', 'error', (err.error && err.error.message) || 'Run failed');
      return;
    }
    modAlert('api-suites-alert', 'success', 'Suite run started — check Detail view for results shortly.');
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

async function apiSuitesDelete(suiteId) {
  if (!confirm('Delete this suite?')) return;
  try {
    var res = await fetch('/api/api-suites/' + encodeURIComponent(suiteId), { method: 'DELETE' });
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Delete failed'); return; }
    modAlert('api-suites-alert', 'success', 'Suite deleted.');
    apiSuitesLoad();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesShowCreate() {
  var detail = document.getElementById('api-suites-detail');
  if (!detail) return;
  _apiSuitesShowDetail();
  detail.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">'
    + '<button class="btn btn-secondary btn-sm" onclick="apiSuitesLoad()">&#8592; Cancel</button>'
    + '<div style="font-size:15px;font-weight:600;">New API Suite</div>'
    + '</div>'
    + '<form onsubmit="apiSuitesCreate(event)" style="max-width:520px">'
    + '<div class="form-group"><label>Suite Name <span style="color:#f87171">*</span></label><input name="name" class="form-control" placeholder="e.g. Smoke Suite" required /></div>'
    + '<div class="form-group"><label>Collection IDs <span style="color:#f87171">*</span> <span style="font-weight:400;color:var(--text-muted)">(comma-separated)</span></label><input name="collectionIds" class="form-control" placeholder="col-abc123, col-def456" required /></div>'
    + '<div class="form-group"><label>Environment ID <span style="color:#f87171">*</span></label><input name="environmentId" class="form-control" placeholder="env-abc123" required /></div>'
    + '<div class="form-group"><label>On Failure</label><select name="onFailure" class="form-control"><option value="continue">continue</option><option value="stop">stop</option></select></div>'
    + '<div class="form-group"><label>Before All Collection ID <span style="color:var(--text-muted);font-weight:400">(optional)</span></label><input name="beforeAllCollectionId" class="form-control" placeholder="Optional setup collection" /></div>'
    + '<div class="form-group"><label>After All Collection ID <span style="color:var(--text-muted);font-weight:400">(optional)</span></label><input name="afterAllCollectionId" class="form-control" placeholder="Optional teardown collection" /></div>'
    + '<div style="display:flex;gap:8px;margin-top:8px;">'
    + '<button type="submit" class="btn btn-primary">Create Suite</button>'
    + '<button type="button" class="btn btn-secondary" onclick="apiSuitesLoad()">Cancel</button>'
    + '</div>'
    + '</form>';
}

async function apiSuitesCreate(event) {
  event.preventDefault();
  var form = event.target;
  var body = {
    name: form.name.value.trim(),
    collectionIds: form.collectionIds.value.split(',').map(function(s) { return s.trim(); }).filter(Boolean),
    environmentId: form.environmentId.value.trim(),
    onFailure: form.onFailure.value,
    beforeAllCollectionId: form.beforeAllCollectionId.value.trim() || undefined,
    afterAllCollectionId: form.afterAllCollectionId.value.trim() || undefined,
    projectId: currentProjectId || undefined,
  };
  try {
    var res = await fetch('/api/api-suites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      var err = await res.json();
      modAlert('api-suites-alert', 'error', (err.error && err.error.message) || 'Create failed');
      return;
    }
    modAlert('api-suites-alert', 'success', 'Suite created.');
    apiSuitesLoad();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}
