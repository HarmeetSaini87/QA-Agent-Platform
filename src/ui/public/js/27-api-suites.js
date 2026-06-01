// Module: API Suite Orchestration
// Page: api-suites

var _apiSuitesList = [];
var _apiSuitesPage = 0;
var _apiSuitesPageSize = 10;
var _apiSuitesAllCollections = [];
var _apiSuitesAllEnvs = [];
var _suiteFormCollections = []; // [{id, name, envId}] — ordered main collections
var _suiteFormEnvId = '';       // currently selected suite environment in form
var _suiteFormEditingId = null; // null = create, string = edit

function apiSuitesInit() {
  apiSuitesLoad();
}

// ── Meta helpers (collections + envs for dropdowns) ──────────────────────────

async function _apiSuitesLoadMeta() {
  if (!currentProjectId) return;
  try {
    var colRes = await fetch('/api/api-collections?projectId=' + encodeURIComponent(currentProjectId));
    var envRes = await fetch('/api/api-envs?projectId=' + encodeURIComponent(currentProjectId));
    _apiSuitesAllCollections = colRes.ok ? await colRes.json() : [];
    _apiSuitesAllEnvs = envRes.ok ? await envRes.json() : [];
  } catch (e) {
    _apiSuitesAllCollections = [];
    _apiSuitesAllEnvs = [];
  }
}

function _apiSuiteEnvName(envId) {
  if (!envId) return '—';
  var e = _apiSuitesAllEnvs.find(function (x) { return x.id === envId; });
  return e ? e.name : envId;
}

function _apiSuiteColName(colId) {
  if (!colId) return '—';
  var c = _apiSuitesAllCollections.find(function (x) { return x.id === colId; });
  return c ? c.name : colId;
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function apiSuitesLoad() {
  var tbody = document.getElementById('api-suites-tbody');
  if (!tbody) return;

  if (!currentProjectId) {
    _apiSuitesList = [];
    _apiSuitesHideDetail();
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px;">Select a project from the top bar to view API suites.</td></tr>';
    return;
  }

  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:16px;">Loading…</td></tr>';
  try {
    await _apiSuitesLoadMeta();
    var res = await fetch('/api/api-suites?projectId=' + encodeURIComponent(currentProjectId));
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Failed to load suites.'); return; }
    _apiSuitesList = await res.json();
    _apiSuitesPage = 0;
    _apiSuitesHideDetail();
    apiSuitesRender();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error loading suites: ' + e.message);
  }
}

// ── Show / hide detail area ───────────────────────────────────────────────────

function _apiSuitesHideDetail() {
  var detail = document.getElementById('api-suites-detail');
  var listArea = document.getElementById('api-suites-list-area');
  if (detail) detail.style.display = 'none';
  if (listArea) listArea.style.display = '';
}

function _apiSuitesShowDetailPanel() {
  var detail = document.getElementById('api-suites-detail');
  var listArea = document.getElementById('api-suites-list-area');
  if (detail) detail.style.display = '';
  if (listArea) listArea.style.display = 'none';
}

// ── Render list ───────────────────────────────────────────────────────────────

function apiSuitesRender() {
  var tbody = document.getElementById('api-suites-tbody');
  if (!tbody) return;

  var nameFilter = (document.getElementById('api-suites-filter-name') ? document.getElementById('api-suites-filter-name').value : '').toLowerCase();
  var statusFilter = document.getElementById('api-suites-filter-status') ? document.getElementById('api-suites-filter-status').value : '';

  var filtered = _apiSuitesList.filter(function (s) {
    if (nameFilter && !s.name.toLowerCase().includes(nameFilter)) return false;
    if (statusFilter === 'active' && s.archived) return false;
    if (statusFilter === 'archived' && !s.archived) return false;
    return true;
  });

  var total = filtered.length;
  var totalPages = Math.max(1, Math.ceil(total / _apiSuitesPageSize));
  if (_apiSuitesPage >= totalPages) _apiSuitesPage = totalPages - 1;
  var paged = filtered.slice(_apiSuitesPage * _apiSuitesPageSize, (_apiSuitesPage + 1) * _apiSuitesPageSize);

  if (total === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:20px;">'
      + (_apiSuitesList.length === 0
        ? 'No API suites yet. Click <strong>+ New Suite</strong> to create one.'
        : 'No suites match the current filter.')
      + '</td></tr>';
    _apiSuitesRenderPagination(0, 1);
    return;
  }

  tbody.innerHTML = paged.map(function (s, i) {
    var idx = _apiSuitesPage * _apiSuitesPageSize + i + 1;
    var colCount = s.collectionIds ? s.collectionIds.length : 0;

    var hooks = [];
    if (s.beforeAllCollectionId) hooks.push('Before All');
    if (s.beforeEachCollectionId) hooks.push('Before Each');
    if (s.afterEachCollectionId) hooks.push('After Each');
    if (s.afterAllCollectionId) hooks.push('After All');
    var lifecycle = hooks.length
      ? '<span style="font-size:11px;color:var(--brand)">' + hooks.join(' · ') + '</span>'
      : '<span style="color:var(--text-muted);font-size:12px">—</span>';

    var envName = _apiSuiteEnvName(s.environmentId);
    var envBadge = s.environmentId
      ? '<span style="font-size:11px;color:var(--neutral-700)">' + escHtml(envName) + '</span>'
      : '<span style="color:var(--text-muted);font-size:12px">—</span>';

    var onFail = s.onFailure === 'stop'
      ? '<span style="font-size:11px;padding:2px 7px;border-radius:4px;background:rgba(220,38,38,.1);color:#dc2626">Stop</span>'
      : '<span style="font-size:11px;padding:2px 7px;border-radius:4px;background:rgba(107,114,128,.1);color:var(--text-muted)">Continue</span>';

    var statusBadge = s.archived
      ? '<span class="badge badge-grey" style="font-size:10px">Archived</span>'
      : '<span class="badge badge-green" style="font-size:10px">Active</span>';

    return '<tr>'
      + '<td style="text-align:center;color:var(--text-muted);font-size:12px">' + idx + '</td>'
      + '<td>'
        + '<a href="#" onclick="apiSuitesShowDetail(\'' + escHtml(s.id) + '\');return false;" style="font-weight:600;font-size:13px">' + escHtml(s.name) + '</a>'
        + (s.description ? '<div style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px" title="' + escHtml(s.description) + '">' + escHtml(s.description) + '</div>' : '')
      + '</td>'
      + '<td>' + envBadge + '</td>'
      + '<td style="text-align:center;font-size:12px;font-weight:600">' + colCount + '</td>'
      + '<td>' + lifecycle + '</td>'
      + '<td>' + onFail + '</td>'
      + '<td>' + statusBadge + '</td>'
      + '<td style="white-space:nowrap">'
        + '<button class="tbl-btn run-btn" onclick="apiSuitesRunSuite(\'' + escHtml(s.id) + '\')" title="Run suite">&#9654; Run</button> '
        + '<button class="tbl-btn" onclick="apiSuitesShowEdit(\'' + escHtml(s.id) + '\')" title="Edit suite">&#9998; Edit</button> '
        + '<button class="tbl-btn del" onclick="apiSuitesDelete(\'' + escHtml(s.id) + '\')" title="Delete">&#128465;</button>'
      + '</td>'
      + '</tr>';
  }).join('');

  _apiSuitesRenderPagination(total, totalPages);
}

function _apiSuitesRenderPagination(total, totalPages) {
  var pg = document.getElementById('api-suites-pagination');
  if (!pg) return;
  if (total <= _apiSuitesPageSize) { pg.style.display = 'none'; return; }
  var start = _apiSuitesPage * _apiSuitesPageSize + 1;
  var end = Math.min((_apiSuitesPage + 1) * _apiSuitesPageSize, total);
  pg.style.display = 'flex';
  pg.innerHTML = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">'
    + '<span style="font-size:12px;color:var(--text-muted)">' + start + '–' + end + ' of ' + total + '</span>'
    + '<div style="display:flex;align-items:center;gap:6px">'
    + '<label style="font-size:12px;color:var(--text-muted)">Rows:</label>'
    + '<select class="fm-input" style="height:26px;font-size:12px;padding:0 4px;width:70px" onchange="_apiSuitesSetPageSize(parseInt(this.value))">'
    + [10, 25, 50].map(function (n) { return '<option value="' + n + '"' + (n === _apiSuitesPageSize ? ' selected' : '') + '>' + n + '</option>'; }).join('')
    + '</select></div>'
    + '<div style="display:flex;gap:4px">'
    + '<button class="btn btn-xs btn-outline" onclick="_apiSuitesGoPage(0)" ' + (_apiSuitesPage === 0 ? 'disabled' : '') + ' title="First">«</button>'
    + '<button class="btn btn-xs btn-outline" onclick="_apiSuitesGoPage(' + (_apiSuitesPage - 1) + ')" ' + (_apiSuitesPage === 0 ? 'disabled' : '') + ' title="Previous">‹</button>'
    + '<span style="font-size:12px;padding:2px 8px;align-self:center;color:var(--text-muted)">Page ' + (_apiSuitesPage + 1) + ' / ' + totalPages + '</span>'
    + '<button class="btn btn-xs btn-outline" onclick="_apiSuitesGoPage(' + (_apiSuitesPage + 1) + ')" ' + (_apiSuitesPage >= totalPages - 1 ? 'disabled' : '') + ' title="Next">›</button>'
    + '<button class="btn btn-xs btn-outline" onclick="_apiSuitesGoPage(' + (totalPages - 1) + ')" ' + (_apiSuitesPage >= totalPages - 1 ? 'disabled' : '') + ' title="Last">»</button>'
    + '</div></div>';
}

function _apiSuitesGoPage(p) { _apiSuitesPage = p; apiSuitesRender(); }
function _apiSuitesSetPageSize(n) { _apiSuitesPageSize = n; _apiSuitesPage = 0; apiSuitesRender(); }

// ── Create form ───────────────────────────────────────────────────────────────

function apiSuitesShowCreate() {
  _suiteFormEditingId = null;
  _suiteFormCollections = [];
  _suiteFormEnvId = '';
  _apiSuitesShowDetailPanel();
  _suiteFormRender(null);
}

// ── Edit form ─────────────────────────────────────────────────────────────────

async function apiSuitesShowEdit(suiteId) {
  _suiteFormEditingId = suiteId;
  var detail = document.getElementById('api-suites-detail');
  if (!detail) return;
  _apiSuitesShowDetailPanel();
  detail.innerHTML = '<div style="color:var(--text-muted);padding:20px;font-size:13px;">Loading suite…</div>';
  try {
    var res = await fetch('/api/api-suites/' + encodeURIComponent(suiteId));
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Suite not found'); return; }
    var suite = await res.json();
    _suiteFormEnvId = suite.environmentId || '';
    _suiteFormCollections = (suite.collectionIds || []).map(function (id) {
      var col = _apiSuitesAllCollections.find(function (c) { return c.id === id; });
      return { id: id, name: col ? col.name : id, envId: col ? (col.environmentId || '') : '' };
    });
    _suiteFormRender(suite);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

// ── Form renderer ─────────────────────────────────────────────────────────────

function _suiteFormRender(suite) {
  var isEdit = suite !== null;
  var detail = document.getElementById('api-suites-detail');
  if (!detail) return;

  var envOptions = '<option value="">— Select environment —</option>'
    + _apiSuitesAllEnvs.map(function (e) {
      var typeTag = e.envType ? ' (' + e.envType + ')' : '';
      return '<option value="' + escHtml(e.id) + '"' + (e.id === _suiteFormEnvId ? ' selected' : '') + '>'
        + escHtml(e.name + typeTag) + '</option>';
    }).join('');

  detail.innerHTML =
    // ── Header ────────────────────────────────────────────────────────────────
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding-bottom:14px;border-bottom:1px solid var(--neutral-200)">'
    + '<button class="btn btn-secondary btn-sm" onclick="apiSuitesLoad()">&#8592; Back</button>'
    + '<div>'
      + '<div style="font-size:16px;font-weight:700">' + (isEdit ? 'Edit Suite' : 'New API Suite') + '</div>'
      + (isEdit ? '<div style="font-size:12px;color:var(--text-muted);margin-top:1px">' + escHtml(suite.name) + '</div>' : '')
    + '</div>'
    + '</div>'

    // ── Row 1: Basic info + Environment ───────────────────────────────────────
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:860px">'

    // Left: basic info
    + '<div>'
      + '<div class="form-group" style="margin-bottom:14px">'
        + '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Suite Name <span style="color:var(--flaky-danger)">*</span></label>'
        + '<input id="sf-name" class="form-control" placeholder="e.g. Smoke Regression Suite" value="' + (suite ? escHtml(suite.name) : '') + '" />'
      + '</div>'
      + '<div class="form-group" style="margin-bottom:14px">'
        + '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Description <span style="color:var(--text-muted);font-weight:400">(optional)</span></label>'
        + '<textarea id="sf-description" class="form-control" rows="2" placeholder="What does this suite validate?">' + (suite && suite.description ? escHtml(suite.description) : '') + '</textarea>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">'
        + '<div class="form-group">'
          + '<label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">On Failure</label>'
          + '<select id="sf-onFailure" class="form-control">'
            + '<option value="continue"' + ((!suite || suite.onFailure === 'continue') ? ' selected' : '') + '>Continue</option>'
            + '<option value="stop"' + (suite && suite.onFailure === 'stop' ? ' selected' : '') + '>Stop on fail</option>'
          + '</select>'
        + '</div>'
        + (isEdit
          ? '<div class="form-group"><label style="font-size:12px;font-weight:600;display:block;margin-bottom:4px">Status</label>'
            + '<select id="sf-archived" class="form-control">'
              + '<option value="false"' + (!suite.archived ? ' selected' : '') + '>Active</option>'
              + '<option value="true"' + (suite.archived ? ' selected' : '') + '>Archived</option>'
            + '</select></div>'
          : '<div></div>')
      + '</div>'
    + '</div>'

    // Right: environment (the critical one — must select first)
    + '<div>'
      + '<div style="padding:16px;border:1px solid var(--neutral-300);border-radius:8px;background:var(--neutral-100)">'
        + '<div style="font-size:12px;font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px">'
          + '<span style="font-size:14px">🌐</span> Execution Environment <span style="color:var(--flaky-danger)">*</span>'
        + '</div>'
        + '<select id="sf-env" class="form-control" onchange="_suiteFormOnEnvChange(this.value)">'
          + envOptions
        + '</select>'
        + '<div style="font-size:11px;color:var(--text-muted);margin-top:8px;line-height:1.5">'
          + '⚡ All collections in this suite will run against this environment. '
          + 'Collections that have a different default environment are flagged with a warning badge — they will still run correctly using this suite environment.'
        + '</div>'
      + '</div>'
    + '</div>'

    + '</div>' // end grid row 1

    // ── Main Collections ──────────────────────────────────────────────────────
    + '<div style="margin-top:24px;max-width:860px">'
      + '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px">'
        + '<div style="font-size:13px;font-weight:700">Main Collections <span style="color:var(--flaky-danger)">*</span></div>'
        + '<div style="font-size:12px;color:var(--text-muted)">Executed sequentially in this order</div>'
      + '</div>'
      + '<div id="suite-form-col-list"></div>'
      + '<div style="display:flex;gap:8px;margin-top:10px;align-items:center">'
        + '<select id="sf-col-add-sel" class="form-control" style="flex:1;max-width:340px;font-size:13px">'
          + '<option value="">— Select collection to add —</option>'
          + _suiteFormColOptions()
        + '</select>'
        + '<button class="btn btn-secondary btn-sm" onclick="_suiteFormAddCollection()">+ Add</button>'
      + '</div>'
    + '</div>'

    // ── Lifecycle Hooks (collapsed by default) ────────────────────────────────
    + '<div style="margin-top:28px;max-width:860px">'
      + '<div style="border:1px solid var(--neutral-300);border-radius:8px;overflow:hidden">'
        + '<div onclick="_suiteFormToggleHooks()" style="display:flex;align-items:center;gap:8px;padding:10px 14px;cursor:pointer;user-select:none;background:var(--neutral-100)">'
          + '<span id="sf-hooks-arrow" style="font-size:13px;transition:transform .2s;transform:rotate(90deg)">▶</span>'
          + '<div style="font-size:13px;font-weight:700">Advanced: Lifecycle Hooks</div>'
          + '<div style="font-size:12px;color:var(--text-muted);margin-left:4px">Optional — Before All / After All run even when collections fail</div>'
          + (suite && (suite.beforeAllCollectionId || suite.beforeEachCollectionId || suite.afterEachCollectionId || suite.afterAllCollectionId)
            ? '<span style="margin-left:auto;font-size:11px;padding:2px 7px;border-radius:4px;background:rgba(37,99,235,.1);color:#2563eb">Configured</span>'
            : '')
        + '</div>'
        + '<div id="sf-hooks-body" style="display:block;padding:16px 16px 12px">'
          + '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">'
            + _suiteFormHookField('sf-beforeAll',  '⬆ Before All',  suite ? suite.beforeAllCollectionId  : '')
            + _suiteFormHookField('sf-afterAll',   '⬇ After All',   suite ? suite.afterAllCollectionId   : '')
            + _suiteFormHookField('sf-beforeEach', '↑ Before Each', suite ? suite.beforeEachCollectionId : '')
            + _suiteFormHookField('sf-afterEach',  '↓ After Each',  suite ? suite.afterEachCollectionId  : '')
          + '</div>'
        + '</div>'
      + '</div>'
    + '</div>'

    // ── Submit ────────────────────────────────────────────────────────────────
    + '<div style="display:flex;gap:8px;margin-top:28px;padding-top:16px;border-top:1px solid var(--neutral-200);max-width:860px">'
      + '<button class="btn btn-primary" onclick="apiSuitesSave()">' + (isEdit ? '&#10003; Save Changes' : '&#43; Create Suite') + '</button>'
      + '<button class="btn btn-secondary" onclick="apiSuitesLoad()">Cancel</button>'
    + '</div>'
    + '<div id="suite-form-alert" style="margin-top:12px;max-width:860px"></div>';

  _suiteFormRenderCollectionList();
}

// ── Form: collection list helpers ─────────────────────────────────────────────

function _suiteFormColOptions() {
  var addedIds = _suiteFormCollections.map(function (c) { return c.id; });
  return _apiSuitesAllCollections.filter(function (c) {
    return !addedIds.includes(c.id);
  }).map(function (c) {
    var envLabel = c.environmentId ? ' (' + escHtml(_apiSuiteEnvName(c.environmentId)) + ')' : ' (No env)';
    return '<option value="' + escHtml(c.id) + '">' + escHtml(c.name) + envLabel + '</option>';
  }).join('');
}

var _suiteHookTooltips = {
  'sf-beforeAll':  'Runs ONCE before any main collection starts. Use for: creating test users, seeding DB, generating auth tokens.',
  'sf-beforeEach': 'Runs before EVERY main collection. Use for: resetting session state, clearing cart, refreshing tokens per collection.',
  'sf-afterEach':  'Runs after EVERY main collection. Use for: per-collection cleanup, logging results, resetting modified data.',
  'sf-afterAll':   'Runs ONCE after ALL main collections finish — GUARANTEED even if collections fail. Use for: deleting test data, revoking tokens, environment teardown.'
};

function _suiteFormHookField(id, label, selectedId) {
  // Show all collections EXCEPT those already in the main list (no point running twice)
  var mainIds = _suiteFormCollections.map(function (c) { return c.id; });
  var opts = '<option value="">— None —</option>'
    + _apiSuitesAllCollections.filter(function (c) {
      return !mainIds.includes(c.id);
    }).map(function (c) {
      var envLabel = c.environmentId ? ' (' + escHtml(_apiSuiteEnvName(c.environmentId)) + ')' : ' (No env)';
      return '<option value="' + escHtml(c.id) + '"' + (c.id === selectedId ? ' selected' : '') + '>'
        + escHtml(c.name) + envLabel + '</option>';
    }).join('');
  var tooltip = _suiteHookTooltips[id] || '';
  return '<div class="form-group" style="margin-bottom:4px">'
    + '<label style="font-size:12px;font-weight:600;display:flex;align-items:center;gap:5px;margin-bottom:4px">'
      + label
      + (tooltip
        ? '<span title="' + escHtml(tooltip) + '" style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:var(--neutral-300);color:var(--neutral-700);font-size:10px;font-weight:700;cursor:help;flex-shrink:0">?</span>'
        : '')
    + '</label>'
    + '<select id="' + id + '" class="form-control" style="font-size:13px;width:100%;max-width:100%;text-overflow:ellipsis">' + opts + '</select>'
    + '</div>';
}

function _suiteFormToggleHooks() {
  var body = document.getElementById('sf-hooks-body');
  var arrow = document.getElementById('sf-hooks-arrow');
  if (!body) return;
  var open = body.style.display !== 'none';
  body.style.display = open ? 'none' : '';
  if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
}

function _suiteFormOnEnvChange(envId) {
  _suiteFormEnvId = envId;
  _suiteFormRenderCollectionList();
}

function _suiteFormRefreshHookDropdowns() {
  // Re-render hook dropdowns: all collections EXCEPT those in the main list
  var mainIds = _suiteFormCollections.map(function (c) { return c.id; });
  var available = _apiSuitesAllCollections.filter(function (c) { return !mainIds.includes(c.id); });
  ['sf-beforeAll', 'sf-beforeEach', 'sf-afterEach', 'sf-afterAll'].forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">— None —</option>'
      + available.map(function (c) {
        var envLabel = c.environmentId ? ' (' + escHtml(_apiSuiteEnvName(c.environmentId)) + ')' : ' (No env)';
        return '<option value="' + escHtml(c.id) + '"' + (c.id === prev ? ' selected' : '') + '>'
          + escHtml(c.name) + envLabel + '</option>';
      }).join('');
    // keep previous selection only if it's still available (not moved into main list)
    var stillValid = available.find(function (c) { return c.id === prev; });
    sel.value = stillValid ? prev : '';
  });
}

function _suiteFormRenderCollectionList() {
  var container = document.getElementById('suite-form-col-list');
  if (!container) return;

  if (_suiteFormCollections.length === 0) {
    container.innerHTML = '<div style="padding:16px;border:2px dashed var(--neutral-300);border-radius:8px;text-align:center;color:var(--text-muted);font-size:12px">No collections added yet. Select a collection from the dropdown below and click <strong>+ Add</strong>.</div>';
    _suiteFormRefreshAddDropdown();
    _suiteFormRefreshHookDropdowns();
    return;
  }

  container.innerHTML = '<div style="border:1px solid var(--neutral-300);border-radius:8px;overflow:hidden">'
    + '<table class="data-table" style="margin:0">'
    + '<thead><tr>'
      + '<th style="width:40px;text-align:center">#</th>'
      + '<th>Collection</th>'
      + '<th style="width:180px">Environment</th>'
      + '<th style="width:90px;text-align:center">Order</th>'
      + '<th style="width:44px"></th>'
    + '</tr></thead>'
    + '<tbody>'
    + _suiteFormCollections.map(function (col, idx) {
      var envBadge = '';
      if (_suiteFormEnvId && col.envId && col.envId !== _suiteFormEnvId) {
        // Collection has a different default env — warn, suite env overrides
        var colEnvName = _apiSuiteEnvName(col.envId);
        envBadge = '<span title="Collection default env is \'' + escHtml(colEnvName) + '\'. Suite environment will override during execution." '
          + 'style="font-size:11px;padding:2px 7px;border-radius:4px;background:rgba(180,83,9,.12);color:#b45309;cursor:help">⚠ ' + escHtml(colEnvName) + '</span>';
      } else if (_suiteFormEnvId && col.envId && col.envId === _suiteFormEnvId) {
        // Collection default env matches suite env
        envBadge = '<span style="font-size:11px;padding:2px 7px;border-radius:4px;background:rgba(22,163,74,.1);color:#16a34a">✓ Match</span>';
      } else if (_suiteFormEnvId && !col.envId) {
        // Collection has no default env — will use suite env, no conflict
        envBadge = '<span style="font-size:11px;padding:2px 7px;border-radius:4px;background:rgba(37,99,235,.08);color:#2563eb">→ Uses suite env</span>';
      } else {
        // No suite env selected yet
        envBadge = '<span style="font-size:11px;color:var(--text-muted)">—</span>';
      }
      return '<tr>'
        + '<td style="text-align:center;font-size:12px;color:var(--text-muted);font-weight:600">' + (idx + 1) + '</td>'
        + '<td style="font-weight:600;font-size:13px">' + escHtml(col.name) + '</td>'
        + '<td>' + envBadge + '</td>'
        + '<td style="text-align:center">'
          + '<button class="tbl-btn" onclick="_suiteFormMoveCol(' + idx + ',-1)" ' + (idx === 0 ? 'disabled' : '') + ' title="Move up">↑</button> '
          + '<button class="tbl-btn" onclick="_suiteFormMoveCol(' + idx + ',1)" ' + (idx === _suiteFormCollections.length - 1 ? 'disabled' : '') + ' title="Move down">↓</button>'
        + '</td>'
        + '<td><button class="tbl-btn del" onclick="_suiteFormRemoveCol(' + idx + ')" title="Remove">✕</button></td>'
        + '</tr>';
    }).join('')
    + '</tbody></table></div>';

  _suiteFormRefreshAddDropdown();
  _suiteFormRefreshHookDropdowns();
}

function _suiteFormRefreshAddDropdown() {
  var addSel = document.getElementById('sf-col-add-sel');
  if (!addSel) return;
  var prev = addSel.value;
  addSel.innerHTML = '<option value="">— Select collection to add —</option>' + _suiteFormColOptions();
  var stillAvailable = !_suiteFormCollections.find(function (c) { return c.id === prev; });
  if (prev && stillAvailable) addSel.value = prev;
}

function _suiteFormAddCollection() {
  var sel = document.getElementById('sf-col-add-sel');
  if (!sel || !sel.value) return;
  var colId = sel.value;
  if (_suiteFormCollections.find(function (c) { return c.id === colId; })) return;
  var col = _apiSuitesAllCollections.find(function (c) { return c.id === colId; });
  if (!col) return;
  _suiteFormCollections.push({ id: col.id, name: col.name, envId: col.environmentId || '' });
  sel.value = '';
  _suiteFormRenderCollectionList();
}

function _suiteFormRemoveCol(idx) {
  _suiteFormCollections.splice(idx, 1);
  _suiteFormRenderCollectionList();
}

function _suiteFormMoveCol(idx, dir) {
  var ni = idx + dir;
  if (ni < 0 || ni >= _suiteFormCollections.length) return;
  var tmp = _suiteFormCollections[idx];
  _suiteFormCollections[idx] = _suiteFormCollections[ni];
  _suiteFormCollections[ni] = tmp;
  _suiteFormRenderCollectionList();
}

// ── Save (create or update) ───────────────────────────────────────────────────

async function apiSuitesSave() {
  var name = (document.getElementById('sf-name') ? document.getElementById('sf-name').value : '').trim();
  var envId = document.getElementById('sf-env') ? document.getElementById('sf-env').value : '';
  var onFailure = document.getElementById('sf-onFailure') ? document.getElementById('sf-onFailure').value : 'continue';
  var description = (document.getElementById('sf-description') ? document.getElementById('sf-description').value : '').trim();

  if (!name) { modAlert('suite-form-alert', 'error', 'Suite name is required.'); return; }
  if (!envId) { modAlert('suite-form-alert', 'error', 'Execution environment is required.'); return; }
  if (_suiteFormCollections.length === 0) { modAlert('suite-form-alert', 'error', 'At least one main collection is required.'); return; }

  var beforeAll = document.getElementById('sf-beforeAll') ? document.getElementById('sf-beforeAll').value : '';
  var beforeEach = document.getElementById('sf-beforeEach') ? document.getElementById('sf-beforeEach').value : '';
  var afterEach = document.getElementById('sf-afterEach') ? document.getElementById('sf-afterEach').value : '';
  var afterAll = document.getElementById('sf-afterAll') ? document.getElementById('sf-afterAll').value : '';

  var body = {
    name: name,
    environmentId: envId,
    onFailure: onFailure,
    collectionIds: _suiteFormCollections.map(function (c) { return c.id; }),
    projectId: currentProjectId || undefined,
  };
  if (description) body.description = description;
  if (beforeAll) body.beforeAllCollectionId = beforeAll;
  if (beforeEach) body.beforeEachCollectionId = beforeEach;
  if (afterEach) body.afterEachCollectionId = afterEach;
  if (afterAll) body.afterAllCollectionId = afterAll;

  var archivedEl = document.getElementById('sf-archived');
  if (_suiteFormEditingId && archivedEl) body.archived = archivedEl.value === 'true';

  try {
    var url = _suiteFormEditingId
      ? '/api/api-suites/' + encodeURIComponent(_suiteFormEditingId)
      : '/api/api-suites';
    var method = _suiteFormEditingId ? 'PUT' : 'POST';
    var res = await fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      var err = await res.json();
      modAlert('suite-form-alert', 'error', (err.error && err.error.message) || 'Save failed');
      return;
    }
    modAlert('api-suites-alert', 'success', _suiteFormEditingId ? 'Suite updated.' : 'Suite created.');
    apiSuitesLoad();
  } catch (e) {
    modAlert('suite-form-alert', 'error', 'Error: ' + e.message);
  }
}

// ── Suite detail view ─────────────────────────────────────────────────────────

async function apiSuitesShowDetail(suiteId) {
  var detail = document.getElementById('api-suites-detail');
  if (!detail) return;
  _apiSuitesShowDetailPanel();
  detail.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:20px;">Loading…</div>';
  try {
    var suiteRes = await fetch('/api/api-suites/' + encodeURIComponent(suiteId));
    var runsRes = await fetch('/api/api-suites/' + encodeURIComponent(suiteId) + '/runs');
    if (!suiteRes.ok) { modAlert('api-suites-alert', 'error', 'Suite not found'); return; }
    var suite = await suiteRes.json();
    var runs = runsRes.ok ? await runsRes.json() : [];
    detail.innerHTML = _apiSuitesDetailHtml(suite, runs);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function _apiSuitesDetailHtml(suite, runs) {
  var envName = _apiSuiteEnvName(suite.environmentId);
  var hooks = [];
  if (suite.beforeAllCollectionId) hooks.push({ label: 'Before All', id: suite.beforeAllCollectionId });
  if (suite.beforeEachCollectionId) hooks.push({ label: 'Before Each', id: suite.beforeEachCollectionId });
  if (suite.afterEachCollectionId) hooks.push({ label: 'After Each', id: suite.afterEachCollectionId });
  if (suite.afterAllCollectionId) hooks.push({ label: 'After All', id: suite.afterAllCollectionId });

  var html =
    // Header
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--neutral-200)">'
    + '<button class="btn btn-secondary btn-sm" onclick="apiSuitesLoad()">&#8592; Back</button>'
    + '<button class="btn btn-primary btn-sm" onclick="apiSuitesRunSuite(\'' + escHtml(suite.id) + '\')">&#9654; Run Suite</button>'
    + '<button class="btn btn-secondary btn-sm" onclick="apiSuitesShowEdit(\'' + escHtml(suite.id) + '\')">&#9998; Edit</button>'
    + '</div>'

    // Title + meta
    + '<div style="font-size:17px;font-weight:700;margin-bottom:6px">' + escHtml(suite.name) + '</div>'
    + (suite.description ? '<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px">' + escHtml(suite.description) + '</div>' : '')
    + '<div style="display:flex;flex-wrap:wrap;gap:16px;font-size:12px;color:var(--text-muted);margin-bottom:20px">'
      + '<span>🌐 Environment: <strong style="color:var(--neutral-700)">' + escHtml(envName) + '</strong></span>'
      + '<span>📦 Collections: <strong>' + (suite.collectionIds || []).length + '</strong></span>'
      + '<span>⚡ On Failure: <strong>' + escHtml(suite.onFailure || 'continue') + '</strong></span>'
      + (suite.archived ? '<span><span class="badge badge-grey" style="font-size:10px">Archived</span></span>' : '<span><span class="badge badge-green" style="font-size:10px">Active</span></span>')
    + '</div>'

    // Collections + hooks side by side
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">'

    // Main collections
    + '<div>'
      + '<div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Main Collections</div>'
      + '<div style="border:1px solid var(--neutral-300);border-radius:6px;overflow:hidden">'
      + (suite.collectionIds && suite.collectionIds.length
        ? suite.collectionIds.map(function (id, i) {
            return '<div style="padding:8px 12px;font-size:13px;border-bottom:1px solid var(--neutral-200);display:flex;align-items:center;gap:8px">'
              + '<span style="font-size:11px;color:var(--text-muted);min-width:18px">' + (i + 1) + '</span>'
              + '<span style="font-weight:500">' + escHtml(_apiSuiteColName(id)) + '</span>'
              + '</div>';
          }).join('')
        : '<div style="padding:12px;font-size:12px;color:var(--text-muted)">No collections</div>')
      + '</div>'
    + '</div>'

    // Lifecycle hooks
    + '<div>'
      + '<div style="font-size:12px;font-weight:700;margin-bottom:8px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Lifecycle Hooks</div>'
      + '<div style="border:1px solid var(--neutral-300);border-radius:6px;overflow:hidden">'
      + (hooks.length
        ? hooks.map(function (h) {
            return '<div style="padding:8px 12px;font-size:13px;border-bottom:1px solid var(--neutral-200);display:flex;align-items:center;gap:8px">'
              + '<span style="font-size:11px;color:var(--brand);font-weight:600;min-width:72px">' + escHtml(h.label) + '</span>'
              + '<span style="color:var(--text-muted)">' + escHtml(_apiSuiteColName(h.id)) + '</span>'
              + '</div>';
          }).join('')
        : '<div style="padding:12px;font-size:12px;color:var(--text-muted)">No lifecycle hooks configured</div>')
      + '</div>'
    + '</div>'

    + '</div>' // end grid

    // Runs
    + '<div style="font-weight:700;font-size:13px;margin-bottom:8px">Recent Runs <span style="font-size:12px;color:var(--text-muted);font-weight:400">(' + runs.length + ' total)</span></div>';

  if (runs.length === 0) {
    html += '<div style="color:var(--text-muted);font-size:13px;padding:16px 0;">No runs yet. Click <strong>Run Suite</strong> to execute.</div>';
    return html;
  }

  html += '<table class="data-table"><thead><tr>'
    + '<th style="width:90px">Run ID</th><th style="width:90px">Status</th>'
    + '<th style="width:70px">Phases</th><th style="width:80px">Duration</th>'
    + '<th>Started</th><th style="width:70px">Actions</th>'
    + '</tr></thead><tbody>'
    + runs.slice(0, 20).map(function (r) {
      var statusBadge = r.status === 'passed'
        ? '<span class="badge badge-green">PASSED</span>'
        : '<span class="badge badge-red">FAILED</span>';
      return '<tr>'
        + '<td style="font-size:11px;font-family:monospace;color:var(--text-muted)">' + escHtml(r.id.slice(0, 8)) + '…</td>'
        + '<td>' + statusBadge + '</td>'
        + '<td style="text-align:center;font-size:12px">' + (r.phaseResults ? r.phaseResults.length : '—') + '</td>'
        + '<td style="font-size:12px">' + (r.durationMs ? Math.round(r.durationMs / 1000) + 's' : '—') + '</td>'
        + '<td style="font-size:12px">' + escHtml((r.startedAt || '').replace('T', ' ').slice(0, 19)) + '</td>'
        + '<td><button class="tbl-btn" onclick="apiSuitesShowRun(\'' + escHtml(r.id) + '\')">View</button></td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';

  return html;
}

// ── Run detail view ───────────────────────────────────────────────────────────

async function apiSuitesShowRun(runId) {
  var detail = document.getElementById('api-suites-detail');
  if (!detail) return;
  detail.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:20px;">Loading run…</div>';
  try {
    var res = await fetch('/api/api-suite-runs/' + encodeURIComponent(runId));
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Run not found'); return; }
    var run = await res.json();
    detail.innerHTML = _apiSuitesRunHtml(run);
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}

function _apiSuitesRunHtml(run) {
  var statusBadge = run.status === 'passed'
    ? '<span class="badge badge-green">PASSED</span>'
    : '<span class="badge badge-red">FAILED</span>';

  var passed = (run.phaseResults || []).filter(function (p) { return p.status === 'passed'; }).length;
  var total = (run.phaseResults || []).length;
  var passRate = total ? Math.round((passed / total) * 100) : 0;

  return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;padding-bottom:14px;border-bottom:1px solid var(--neutral-200)">'
    + '<button class="btn btn-secondary btn-sm" onclick="apiSuitesShowDetail(\'' + escHtml(run.suiteId) + '\')">&#8592; Back to Suite</button>'
    + '</div>'

    + '<div style="font-size:17px;font-weight:700;margin-bottom:4px">' + escHtml(run.suiteName) + ' &nbsp;' + statusBadge + '</div>'
    + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:16px;display:flex;gap:16px">'
      + '<span>Started: ' + escHtml((run.startedAt || '').replace('T', ' ').slice(0, 19)) + '</span>'
      + '<span>Duration: ' + (run.durationMs ? Math.round(run.durationMs / 1000) + 's' : '—') + '</span>'
      + '<span>Phases: ' + passed + ' / ' + total + ' passed (' + passRate + '%)</span>'
    + '</div>'

    + '<div style="font-weight:700;font-size:13px;margin-bottom:8px">Lifecycle Timeline</div>'
    + '<table class="data-table"><thead><tr>'
      + '<th>Phase</th><th>Collection</th><th style="width:90px">Status</th><th style="width:90px">Duration</th>'
    + '</tr></thead><tbody>'
    + (run.phaseResults || []).map(function (p) {
      var phaseStatus = p.status === 'passed'
        ? '<span class="badge badge-green">passed</span>'
        : p.status === 'failed'
          ? '<span class="badge badge-red">failed</span>'
          : '<span class="badge badge-grey">' + escHtml(p.status) + '</span>';
      var hookBadge = p.isLifecycleHook
        ? ' <span style="font-size:10px;padding:1px 5px;border-radius:3px;background:var(--neutral-200);color:var(--text-muted)">'
          + escHtml(p.phase.replace(/_/g, ' ').toUpperCase()) + '</span>'
        : '';
      return '<tr>'
        + '<td style="font-size:12px">' + escHtml(p.phase) + hookBadge + '</td>'
        + '<td><a href="#" onclick="typeof apiRunsLoadByRunId===\'function\'&&apiRunsLoadByRunId(\'' + escHtml(p.runId) + '\');return false;" style="font-size:13px">' + escHtml(p.collectionName) + '</a></td>'
        + '<td>' + phaseStatus + '</td>'
        + '<td style="font-size:12px;color:var(--text-muted)">' + (p.durationMs ? p.durationMs + 'ms' : '—') + '</td>'
        + '</tr>';
    }).join('')
    + '</tbody></table>';
}

// ── Run suite ─────────────────────────────────────────────────────────────────

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

// ── Delete suite ──────────────────────────────────────────────────────────────

async function apiSuitesDelete(suiteId) {
  if (!confirm('Delete this suite? This cannot be undone.')) return;
  try {
    var res = await fetch('/api/api-suites/' + encodeURIComponent(suiteId), { method: 'DELETE' });
    if (!res.ok) { modAlert('api-suites-alert', 'error', 'Delete failed'); return; }
    modAlert('api-suites-alert', 'success', 'Suite deleted.');
    apiSuitesLoad();
  } catch (e) {
    modAlert('api-suites-alert', 'error', 'Error: ' + e.message);
  }
}
