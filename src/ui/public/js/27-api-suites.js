// Module: API Suite Orchestration
// Page: api-suites

var _apiSuitesList = [];
var _apiSuitesCurrentSuiteId = null;

function apiSuitesInit() {
  if (typeof window._apiSuitesLoaded === 'undefined') {
    window._apiSuitesLoaded = true;
  }
  apiSuitesLoad();
}

async function apiSuitesLoad() {
  try {
    var res = await fetch('/api/api-suites');
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Failed to load suites.'); return; }
    _apiSuitesList = await res.json();
    apiSuitesRender();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error loading suites: ' + e.message);
  }
}

function apiSuitesRender() {
  var el = document.getElementById('api-suites-content');
  if (!el) return;
  if (_apiSuitesList.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);padding:20px;">No API suites yet. <button class="btn btn-sm" onclick="apiSuitesShowCreate()">+ New Suite</button></div>';
    return;
  }
  el.innerHTML = '<div style="margin-bottom:12px;"><button class="btn btn-sm" onclick="apiSuitesShowCreate()">+ New Suite</button></div>'
    + '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Collections</th><th>Environment</th><th>Actions</th></tr></thead><tbody>'
    + _apiSuitesList.map(function(s) {
      return '<tr>'
        + '<td><a href="#" onclick="apiSuitesShowDetail(\'' + escHtml(s.id) + '\');return false;">' + escHtml(s.name) + '</a></td>'
        + '<td>' + (s.collectionIds ? s.collectionIds.length : 0) + ' collections</td>'
        + '<td>' + escHtml(s.environmentId || '') + '</td>'
        + '<td>'
        + '<button class="tbl-btn" onclick="apiSuitesRunSuite(\'' + escHtml(s.id) + '\')">&#9654; Run</button> '
        + '<button class="tbl-btn" onclick="apiSuitesDelete(\'' + escHtml(s.id) + '\')">Delete</button>'
        + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table></div>';
}

async function apiSuitesShowDetail(suiteId) {
  _apiSuitesCurrentSuiteId = suiteId;
  var el = document.getElementById('api-suites-content');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Loading...</div>';
  try {
    var suiteRes = await fetch('/api/api-suites/' + encodeURIComponent(suiteId));
    var runsRes = await fetch('/api/api-suites/' + encodeURIComponent(suiteId) + '/runs');
    if (!suiteRes.ok) { modAlert('api-suites-alert', 'error', 'Suite not found'); return; }
    var suite = await suiteRes.json();
    var runs = runsRes.ok ? await runsRes.json() : [];
    el.innerHTML = apiSuitesDetailHtml(suite, runs);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesDetailHtml(suite, runs) {
  var html = '<div style="margin-bottom:12px;">'
    + '<button class="btn btn-sm" onclick="apiSuitesLoad()">&#8592; Back</button> '
    + '<button class="btn btn-sm" onclick="apiSuitesRunSuite(\'' + escHtml(suite.id) + '\')">&#9654; Run Suite</button>'
    + '</div>'
    + '<div style="font-size:16px;font-weight:600;margin-bottom:8px;">' + escHtml(suite.name) + '</div>'
    + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">'
    + 'Collections: ' + (suite.collectionIds || []).length
    + (suite.beforeAllCollectionId ? ' | beforeAll: ' + escHtml(suite.beforeAllCollectionId) : '')
    + (suite.afterAllCollectionId ? ' | afterAll: ' + escHtml(suite.afterAllCollectionId) : '')
    + '</div>';

  if (runs.length === 0) {
    html += '<div style="color:var(--text-muted);font-size:12px;">No runs yet.</div>';
    return html;
  }

  html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Recent Runs</div>'
    + runs.slice(0, 10).map(function(r) {
      var statusClass = r.status === 'passed' ? 'suite-run-passed' : 'suite-run-failed';
      return '<div style="border:1px solid #374151;border-radius:4px;padding:8px;margin-bottom:6px;cursor:pointer;" onclick="apiSuitesShowRun(\'' + escHtml(r.id) + '\')">'
        + '<span class="' + statusClass + '">' + escHtml(r.status.toUpperCase()) + '</span> '
        + '<span style="font-size:11px;color:var(--text-muted);">' + escHtml(r.startedAt.replace('T',' ').slice(0,19)) + '</span> '
        + '<span style="font-size:11px;">' + r.phaseResults.length + ' phases</span>'
        + '</div>';
    }).join('');

  return html;
}

async function apiSuitesShowRun(runId) {
  var el = document.getElementById('api-suites-content');
  if (!el) return;
  try {
    var res = await fetch('/api/api-suite-runs/' + encodeURIComponent(runId));
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Run not found'); return; }
    var run = await res.json();
    el.innerHTML = apiSuitesRunHtml(run);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesRunHtml(run) {
  var statusClass = run.status === 'passed' ? 'suite-run-passed' : 'suite-run-failed';
  var html = '<div style="margin-bottom:12px;">'
    + '<button class="btn btn-sm" onclick="apiSuitesShowDetail(\'' + escHtml(run.suiteId) + '\')">&#8592; Back</button>'
    + '</div>'
    + '<div style="font-size:16px;font-weight:600;margin-bottom:4px;">' + escHtml(run.suiteName) + ' &#8212; <span class="' + statusClass + '">' + escHtml(run.status.toUpperCase()) + '</span></div>'
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:12px;">'
    + escHtml(run.startedAt.replace('T',' ').slice(0,19)) + ' &middot; ' + Math.round(run.durationMs / 1000) + 's'
    + '</div>'
    + '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Lifecycle Timeline</div>'
    + (run.phaseResults || []).map(function(p) {
      var phaseStatus = p.status === 'passed' ? '&#9989;' : p.status === 'failed' ? '&#10060;' : '&#9888;&#65039;';
      var hookBadge = p.isLifecycleHook
        ? '<span style="font-size:10px;background:#1f2937;border:1px solid #374151;border-radius:3px;padding:1px 5px;margin-left:4px;color:#9ca3af;">'
          + escHtml(p.phase.replace(/_/g,' ').toUpperCase()) + '</span>'
        : '';
      return '<div class="suite-lifecycle-phase phase-' + escHtml(p.phase) + '">'
        + phaseStatus + ' '
        + '<a href="#" onclick="typeof apiRunsLoadByRunId===\'function\'&&apiRunsLoadByRunId(\'' + escHtml(p.runId) + '\');return false;">' + escHtml(p.collectionName) + '</a>'
        + hookBadge
        + ' <span style="font-size:10px;color:var(--text-muted);">' + p.durationMs + 'ms</span>'
        + '</div>';
    }).join('');

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
    modAlert('api-suites-alert', 'success', 'Suite run started &#8212; refresh Runs tab shortly.');
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

async function apiSuitesDelete(suiteId) {
  if (!confirm('Delete this suite?')) return;
  try {
    var res = await fetch('/api/api-suites/' + encodeURIComponent(suiteId), { method: 'DELETE' });
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Delete failed'); return; }
    apiSuitesLoad();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function apiSuitesShowCreate() {
  modAlert('api-suites-alert', 'info', 'Suite creation UI &#8212; enter suite config below, then submit.');
  var el = document.getElementById('api-suites-content');
  if (!el) return;
  el.innerHTML = '<div style="margin-bottom:12px;"><button class="btn btn-sm" onclick="apiSuitesLoad()">&#8592; Cancel</button></div>'
    + '<form onsubmit="apiSuitesCreate(event)">'
    + '<div class="form-group"><label>Suite Name</label><input name="name" class="form-control" required /></div>'
    + '<div class="form-group"><label>Collection IDs (comma-separated)</label><input name="collectionIds" class="form-control" required /></div>'
    + '<div class="form-group"><label>Environment ID</label><input name="environmentId" class="form-control" required /></div>'
    + '<div class="form-group"><label>On Failure</label><select name="onFailure" class="form-control"><option value="continue">continue</option><option value="stop">stop</option></select></div>'
    + '<div class="form-group"><label>Before All Collection ID (optional)</label><input name="beforeAllCollectionId" class="form-control" /></div>'
    + '<div class="form-group"><label>After All Collection ID (optional)</label><input name="afterAllCollectionId" class="form-control" /></div>'
    + '<button type="submit" class="btn btn-primary">Create Suite</button>'
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

// Page load hook — called by router when page becomes active
if (typeof registerPageModule === 'function') {
  registerPageModule('api-suites', apiSuitesInit);
}
