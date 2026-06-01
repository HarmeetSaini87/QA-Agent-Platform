// API COLLECTIONS MODULE
// ══════════════════════════════════════════════════════════════════════════════

let _apiCols = [];
let _editingApiColId = null;
let _apiColSteps = [];
let _apiColVars = [];
let _apiColEnvs = [];

async function apiColLoad() {
  if (!currentProjectId) { _apiCols = []; _apiColEnvs = []; _apiColRenderList(); return; }
  try {
    const [colRes, envRes, runsRes] = await Promise.all([
      fetch(`/api/api-collections?projectId=${encodeURIComponent(currentProjectId ?? '')}`),
      fetch(`/api/api-envs?projectId=${encodeURIComponent(currentProjectId ?? '')}`),
      fetch(`/api/api-runs?projectId=${encodeURIComponent(currentProjectId ?? '')}`),
    ]);
    _apiCols    = await colRes.json();
    _apiColEnvs = await envRes.json();
    // Populate last-run cache: group runs by collectionId, keep most recent per collection
    // (backend already returns sorted desc by startedAt, so first match = most recent)
    const runs = runsRes.ok ? await runsRes.json() : [];
    _apiColLastRuns = {};
    for (const r of runs) {
      if (r.collectionId && !_apiColLastRuns[r.collectionId]) {
        _apiColLastRuns[r.collectionId] = { status: r.status, startedAt: r.startedAt };
      }
    }
    _apiColRenderList();
  } catch (e) {
    modAlert('api-col-list-alert', 'error', 'Load failed: ' + e.message);
  }
}

function _apiColRenderList() {
  const tbody = document.getElementById('api-col-tbody');
  if (!tbody) return;

  // Reset select-all checkbox
  const checkAll = document.getElementById('api-col-check-all');
  if (checkAll) checkAll.checked = false;
  _apiColUpdateBulkBar();

  if (!_apiCols.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:24px">No collections yet — create one or import from Postman / OpenAPI.</td></tr>';
    _apiColRenderPagination(0, 0);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(_apiCols.length / _apiColPageSize));
  if (_apiColPage >= totalPages) _apiColPage = totalPages - 1;
  const pageStart = _apiColPage * _apiColPageSize;
  const pageCols  = _apiCols.slice(pageStart, pageStart + _apiColPageSize);

  const modeLabels = { sequential: '▶ Sequential', parallel: '⚡ Parallel', dag: '🔀 DAG', auto: '🔀 DAG (Auto)' };

  tbody.innerHTML = pageCols.map((col, pageIdx) => {
    const globalIdx = pageStart + pageIdx;
    const envName   = _apiColEnvs.find(e => e.id === col.environmentId)?.name ?? '—';
    const stepCount = (col.steps ?? []).length;
    const mode      = col.executionMode ?? 'sequential';
    const modeLabel = modeLabels[mode] ?? mode;
    const lastRun   = (_apiColLastRuns ?? {})[col.id];
    let runBadge    = '<span style="color:var(--text-muted);font-size:11px">—</span>';
    if (lastRun) {
      const cls  = lastRun.status === 'passed' ? 'col-run-pass' : lastRun.status === 'running' ? 'col-run-running' : 'col-run-fail';
      const icon = lastRun.status === 'passed' ? '✅' : lastRun.status === 'running' ? '⏳' : '❌';
      runBadge = `<span class="col-run-badge ${cls}">${icon} ${lastRun.status}</span>`;
    }
    const hasDeps   = (col.steps ?? []).some(s => (s.dependsOn ?? []).length > 0);
    const showGraph = mode === 'dag' || mode === 'parallel' || hasDeps;
    const id  = col.id;
    const nm  = escHtml(col.name);
    return `<tr>
      <td style="text-align:center;width:36px"><input type="checkbox" class="api-col-row-cb" data-id="${id}" onchange="_apiColUpdateBulkBar()"/></td>
      <td style="text-align:center;width:42px;color:var(--text-muted);font-size:12px">${globalIdx + 1}</td>
      <td style="font-weight:600">${nm}</td>
      <td style="color:var(--text-muted);font-size:12px">${escHtml(envName)}</td>
      <td style="text-align:center">${stepCount}</td>
      <td style="font-size:12px">${modeLabel}</td>
      <td>${runBadge}</td>
      <td class="tbl-actions">
        <button class="tbl-btn" onclick="_apiColRunOpen('${id}')">▶ Run</button>
        <button class="tbl-btn" onclick="apiColTryRequestOpen('${id}')">🧪 Try</button>
        <button class="tbl-btn" onclick="apiColGenTestsOpen('${id}','${nm}')">✨ Suggest Tests</button>
        ${showGraph ? `<button class="tbl-btn" onclick="apiColGraphOpenModal('${id}')">🔀 Graph</button>` : ''}
        <button class="tbl-btn" onclick="apiColAnalyticsOpen('${id}','${nm}')">📊 Analytics</button>
        <button class="tbl-btn" onclick="apiColPrescan('${id}')">🔍 Pre-scan</button>
        <button class="tbl-btn" onclick="apiColEdit('${id}')">✏️ Edit</button>
        <button class="tbl-btn del" onclick="apiColDelete('${id}','${nm}')">🗑</button>
      </td>
    </tr>`;
  }).join('');

  _apiColRenderPagination(totalPages, _apiCols.length);
}

// ── Bulk selection helpers ─────────────────────────────────────────────────────

function apiColCheckAll(checked) {
  document.querySelectorAll('.api-col-row-cb').forEach(cb => cb.checked = checked);
  _apiColUpdateBulkBar();
}

function _apiColUpdateBulkBar() {
  const checked = document.querySelectorAll('.api-col-row-cb:checked');
  const total   = document.querySelectorAll('.api-col-row-cb').length;
  const bar     = document.getElementById('api-col-bulk-bar');
  const cnt     = document.getElementById('api-col-bulk-count');
  const checkAll = document.getElementById('api-col-check-all');
  if (bar)  bar.style.display  = checked.length > 0 ? 'flex' : 'none';
  if (cnt)  cnt.textContent    = checked.length + ' collection' + (checked.length !== 1 ? 's' : '') + ' selected';
  if (checkAll) {
    checkAll.checked       = checked.length > 0 && checked.length === total;
    checkAll.indeterminate = checked.length > 0 && checked.length < total;
  }
}

function apiColBulkClear() {
  document.querySelectorAll('.api-col-row-cb').forEach(cb => cb.checked = false);
  _apiColUpdateBulkBar();
}

function _apiColRenderPagination(totalPages, total) {
  // Inject pagination row into tfoot (create if missing)
  let tfoot = document.querySelector('#api-col-list-view table tfoot');
  if (!tfoot) {
    tfoot = document.createElement('tfoot');
    document.querySelector('#api-col-list-view table')?.appendChild(tfoot);
  }
  if (total === 0) { tfoot.innerHTML = ''; return; }
  const start = _apiColPage * _apiColPageSize + 1;
  const end   = Math.min((_apiColPage + 1) * _apiColPageSize, total);
  const rppOpts = [10, 25, 50, 100, 200].map(n =>
    `<option value="${n}"${_apiColPageSize === n ? ' selected' : ''}>${n}</option>`
  ).join('');
  tfoot.innerHTML = `<tr><td colspan="8" style="padding:6px 4px">
    <div class="lt-pagination">
      <label style="font-size:12px;color:var(--text-muted)">Rows per page:
        <select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto" onchange="_apiColSetPageSize(+this.value)">${rppOpts}</select>
      </label>
      ${totalPages <= 1
        ? `<span style="font-size:12px;color:var(--text-muted)">${start}–${end} of ${total}</span>`
        : `<button class="tbl-btn" onclick="_apiColPageGo(-1)" ${_apiColPage === 0 ? 'disabled' : ''}>← Prev</button>
           <span style="font-size:12px;color:var(--text-muted)">Page ${_apiColPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${total})</span>
           <button class="tbl-btn" onclick="_apiColPageGo(1)" ${_apiColPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>`}
    </div>
  </td></tr>`;
}

async function apiColBulkDelete() {
  const checked = Array.from(document.querySelectorAll('.api-col-row-cb:checked'));
  if (!checked.length) return;
  const ids   = checked.map(cb => cb.dataset.id);
  const names = ids.map(id => _apiCols.find(c => c.id === id)?.name ?? id);
  if (!confirm(`Delete ${ids.length} collection${ids.length !== 1 ? 's' : ''}?\n\n${names.join('\n')}\n\nThis cannot be undone.`)) return;

  // Parallel delete — all requests fire simultaneously
  const results = await Promise.allSettled(
    ids.map(id => fetch(`/api/api-collections/${encodeURIComponent(id)}`, { method: 'DELETE' }))
  );
  const failed  = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)).length;
  const deleted = ids.length - failed;
  modAlert('api-col-list-alert', failed ? 'error' : 'success',
    `${deleted} deleted${failed ? ', ' + failed + ' failed' : ''}.`);
  await apiColLoad();
}

// cache for last run statuses — populated lazily
let _apiColLastRuns = {};

// Pagination state
let _apiColPage     = 0;
let _apiColPageSize = 10;

function apiColSearch()     { _apiColPage = 0; _apiColRenderList(); }
function apiColFilterMode() { _apiColPage = 0; _apiColRenderList(); }
function _apiColPageGo(delta)     { _apiColPage += delta; _apiColRenderList(); }
function _apiColSetPageSize(n)    { _apiColPageSize = n; _apiColPage = 0; _apiColRenderList(); }

function apiColOpenNew() {
  _editingApiColId = null;
  _apiColSteps = [];
  _apiColVars = [];
  document.getElementById('api-col-name').value = '';
  document.getElementById('api-col-env').innerHTML = _apiColEnvs.map(e => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('');
  document.getElementById('api-col-mode').value = 'auto';
  _apiColModeChanged('auto');
  document.getElementById('api-col-onfail').value = 'stop';
  _renderApiColSteps();
  _renderApiColVars();
  document.getElementById('api-col-modal-alert').textContent = '';
  openModal('modal-api-col');
}

function apiColEdit(id) {
  const col = _apiCols.find(c => c.id === id);
  if (!col) return;
  _editingApiColId = id;
  _apiColSteps = JSON.parse(JSON.stringify(col.steps ?? []));
  _apiColVars = JSON.parse(JSON.stringify(col.variables ?? []));
  document.getElementById('api-col-name').value = col.name;
  document.getElementById('api-col-env').innerHTML = _apiColEnvs.map(e => `<option value="${e.id}"${e.id === col.environmentId ? ' selected' : ''}>${escHtml(e.name)}</option>`).join('');
  document.getElementById('api-col-mode').value = col.executionMode ?? 'auto';
  _apiColModeChanged(col.executionMode ?? 'auto');
  document.getElementById('api-col-onfail').value = col.onFailure ?? 'stop';
  _renderApiColSteps();
  _renderApiColVars();
  document.getElementById('api-col-modal-alert').textContent = '';
  openModal('modal-api-col');
}

function _renderApiColSteps() {
  const container = document.getElementById('api-col-steps-list');
  if (!container) return;
  container.innerHTML = '';
  if (_apiColSteps.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);padding:8px">No requests yet — add below</div>';
    return;
  }
  _apiColSteps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'api-step-row';
    div.style.cssText = 'border:1px solid var(--border);border-radius:6px;margin-bottom:8px;padding:8px';
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="_apiColStepToggle(${i})">
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);min-width:48px">Request ${i + 1}</span>
        <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escHtml(step.name)}
          <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${escHtml(step.request?.method ?? 'GET')} ${escHtml(step.request?.url ?? '')}</span>
        </span>
        <button class="tbl-btn del" style="margin-left:auto" onclick="event.stopPropagation();_apiColStepRemove(${i})">✕</button>
      </div>
      <div id="api-step-body-${i}" style="display:none;padding-top:10px;border-top:1px solid var(--border);margin-top:8px">
        <!-- Name row -->
        <div style="margin-bottom:8px">
          <input class="fm-input" value="${escHtml(step.name)}" oninput="_apiColStepField(${i},'name',this.value)" placeholder="Request name"/>
        </div>
        <!-- Method + URL bar -->
        <div style="display:flex;gap:0;margin-bottom:10px;border:1px solid var(--border);border-radius:6px;overflow:hidden">
          <select class="fm-input" style="width:120px;border:none;border-right:1px solid var(--border);border-radius:0;font-weight:600;flex-shrink:0" onchange="_apiColStepReqField(${i},'method',this.value)">
            ${['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map(m => `<option${m === (step.request?.method ?? 'GET') ? ' selected' : ''}>${m}</option>`).join('')}
          </select>
          <input class="fm-input" style="border:none;border-radius:0;flex:1" value="${escHtml(step.request?.url ?? '')}" oninput="_apiColStepReqField(${i},'url',this.value)" placeholder="Enter request URL"/>
        </div>
        <!-- Postman-style tabs -->
        <div style="border-bottom:1px solid var(--border);margin-bottom:0;display:flex;gap:0" id="api-step-tabs-${i}">
          ${['Params','Headers','Body','Rules','Settings'].map((t,ti) => `
            <button onclick="_apiColStepTab(${i},'${t.toLowerCase()}')" id="api-step-tab-${i}-${t.toLowerCase()}"
              style="background:none;border:none;border-bottom:2px solid ${ti===0?'var(--accent)':'transparent'};color:${ti===0?'var(--accent)':'var(--text-muted)'};padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;outline:none">
              ${t}${t==='Headers'?' <span style="color:var(--accent);font-size:10px">(7)</span>':''}
            </button>`).join('')}
        </div>
        <!-- Tab: Params -->
        <div id="api-step-tab-params-${i}" style="padding-top:8px">
          <div style="display:grid;grid-template-columns:1fr 1fr 22px;gap:4px;font-size:11px;color:var(--text-muted);font-weight:600;padding:0 2px 4px">
            <span>Key</span><span>Value</span><span></span>
          </div>
          <div id="api-step-params-${i}"></div>
          <button class="btn btn-secondary btn-sm" style="margin-top:4px" onclick="_apiColParamAdd(${i})">+ Add Param</button>
        </div>
        <!-- Tab: Headers -->
        <div id="api-step-tab-headers-${i}" style="padding-top:8px;display:none">
          <div id="api-step-headers-${i}"></div>
        </div>
        <!-- Tab: Body -->
        <div id="api-step-tab-body-${i}" style="padding-top:8px;display:none">
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:8px">
            ${['none','json','form-data','x-www-form-urlencoded','raw','binary','graphql'].map(t => `
              <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
                <input type="radio" name="api-step-bodytype-${i}" value="${t}" ${(step.request?.bodyType ?? 'none')===t?'checked':''} onchange="_apiColStepBodyTypeChange(${i},this.value)"/> ${t}
              </label>`).join('')}
          </div>
          <div id="api-step-body-input-${i}">${_apiColBodyInput(i, step)}</div>
        </div>
        <!-- Tab: Rules (no-code) -->
        <div id="api-step-tab-scripts-${i}" style="padding-top:10px;display:none">

          <!-- Section 1: Pre-Request — Set Variables -->
          <div style="border:1px solid var(--border);border-radius:6px;margin-bottom:10px;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary,#1a1a1a);cursor:pointer" onclick="_apiColRuleToggle('pre-vars-${i}')">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--accent)">① Before Request</span>
                <span style="font-size:11px;color:var(--text-muted)">Runs before the HTTP call — set or override variables</span>
                <span title="Use this section to inject or override variables before this request fires. Examples:&#10;• Set authToken = {{envToken}} to inject a token from environment&#10;• Set userId = 42 to hardcode a test value&#10;• Set timestamp = {{$now}} to stamp the request time&#10;Variables set here are available as {{varName}} in this request's URL, Headers, and Body." style="cursor:help;color:var(--text-muted);font-size:13px">ⓘ</span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();_apiColPreVarAdd(${i})">+ Add Variable</button>
            </div>
            <div id="pre-vars-${i}" style="padding:8px 12px">
              <div style="display:grid;grid-template-columns:1fr 200px 1fr 22px;gap:4px;font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:4px">
                <span>Variable Name</span><span>How to set it</span><span>Value</span><span></span>
              </div>
              <div id="api-step-prevars-${i}"></div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px">💡 Variables set here are available as <code>{{varName}}</code> in this request's URL, Headers, and Body — and in all later requests too.</div>
            </div>
          </div>

          <!-- Section 2: Post-Response — Extract + Assert -->
          <div style="border:1px solid var(--border);border-radius:6px;margin-bottom:10px;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary,#1a1a1a);cursor:pointer" onclick="_apiColRuleToggle('post-rules-${i}')">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#4ade80">② After Response</span>
                <span style="font-size:11px;color:var(--text-muted)">Runs after the HTTP response — extract data &amp; validate</span>
                <span title="Use this section to:&#10;• Extract — pull values out of the response (e.g. save userId from JSON body) so later requests can use them as {{userId}}&#10;• Assert — validate the response meets your expectations (status code, headers, body fields). Assertions that fail mark the request as FAILED in the run report." style="cursor:help;color:var(--text-muted);font-size:13px">ⓘ</span>
              </div>
              <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
                <button class="btn btn-secondary btn-sm" onclick="_apiColExtractAdd(${i})">+ Extract</button>
                <button class="btn btn-secondary btn-sm" onclick="_apiColAssertAdd(${i})">+ Assert</button>
                <button class="btn btn-secondary btn-sm" style="color:#a78bfa;border-color:#a78bfa" onclick="_domainAssertOpen(${i})" title="Load pre-built assertion templates for your API domain (eCommerce, Fintech, Salesforce, etc.)">Load Domain Template</button>
              </div>
            </div>
            <div id="post-rules-${i}" style="padding:8px 12px">
              <!-- Extract sub-section -->
              <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px">Extract Variables</div>
              <div style="display:grid;grid-template-columns:1fr 130px 1fr 90px 22px;gap:4px;font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:4px">
                <span>Save As</span><span>From</span><span>Path / Header</span><span>Scope</span><span></span>
              </div>
              <div id="api-step-extract-${i}"></div>
              <!-- Assert sub-section -->
              <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin:10px 0 4px">Assertions</div>
              <div style="display:grid;grid-template-columns:150px 140px 1fr 90px 22px;gap:4px;font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:4px">
                <span>Check</span><span>Operator</span><span>Expected Value</span><span>Severity</span><span></span>
              </div>
              <div id="api-step-assert-${i}"></div>
            </div>
          </div>

          <!-- Section 3: Flow Control — No-Code Rule Builder -->
          <div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary,#1a1a1a);cursor:pointer" onclick="_apiColRuleToggle('flow-rules-${i}')">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#f59e0b">③ Flow Control</span>
                <span style="font-size:11px;color:var(--text-muted)">Control what happens after this request runs</span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();_apiColFlowAdd(${i})">+ Add Rule</button>
            </div>
            <div id="flow-rules-${i}" style="padding:8px 12px">
              <div id="api-step-flow-${i}"></div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px">💡 No code needed. Rules are evaluated in order — first match wins. Actions: <strong>Skip to next</strong> (continue), <strong>Stop</strong> the collection, <strong>Jump</strong> to a specific request, or <strong>Repeat</strong> this request up to N times. Uncheck "condition is met" to make a rule always apply.</div>
            </div>
          </div>
        </div>
        <!-- Tab: Settings -->
        <div id="api-step-tab-settings-${i}" style="padding-top:10px;display:none">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Timeout (ms)
                <span title="How long to wait for this request's HTTP response before marking it as failed. Default: 30000ms (30s). Increase for slow APIs (e.g. report generation). Decrease to fail fast on health checks." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <input class="fm-input" type="number" value="${step.execution?.timeoutMs ?? ''}" oninput="_apiColStepExecField(${i},'timeoutMs',+this.value)" placeholder="30000 (default)"/>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Run Condition
                <span title="JavaScript expression evaluated before this request runs. If false, request is SKIPPED (not failed). Variables from previous requests are available as plain values — e.g. write: capturedRole === 'admin'  or  bookingId !== ''  Tip: UC6 in the demo collection uses this to skip the update request when the user is not admin." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <input class="fm-input" value="${escHtml(step.execution?.condition ?? '')}" oninput="_apiColStepExecField(${i},'condition',this.value)" placeholder="e.g. capturedRole === 'admin'"/>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                On Failure
                <span title="What to do when this request fails its assertions:&#10;• continue — run the next request regardless (default when collection onFailure=continue)&#10;• abort — stop the entire collection run immediately&#10;• abort-group — stop requests in the same execution group, but other groups keep running&#10;• skip-dependents — skip all requests that depend on this request's extracted variables" style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <select class="fm-input" onchange="_apiColStepExecField(${i},'onFailure',this.value)">
                ${['continue','abort','abort-group','skip-dependents'].map(v => `<option value="${v}" ${(step.execution?.onFailure??'')===v?'selected':''}>${v}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Retry On
                <span title="Automatically retry this request when these conditions occur:&#10;• 5xx — server errors (500, 502, 503, 504)&#10;• 429 — rate limited (too many requests)&#10;• network — connection refused, timeout, DNS failure&#10;Set Max Retries and Delay below. Retries do NOT apply to POST/PUT/PATCH unless you also check Idempotent." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${['5xx','429','network'].map(v => `<label style="font-size:11px;display:flex;align-items:center;gap:3px"><input type="checkbox" ${(step.execution?.retryPolicy?.retryOn??[]).includes(v)?'checked':''} onchange="_apiColToggleRetryOn(${i},'${v}',this.checked)"/> ${v}</label>`).join('')}
              </div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px">
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Max Retries
                <span title="Number of additional attempts after the first failure. 0 = no retry. Max 3. Each retry waits Retry Delay ms before firing." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <input class="fm-input" type="number" min="0" max="3" value="${step.execution?.retryPolicy?.maxRetries ?? 0}" oninput="_apiColStepRetryField(${i},'maxRetries',+this.value)" placeholder="0"/>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Retry Delay (ms)
                <span title="Wait time between retry attempts.&#10;• fixed — always wait this many ms&#10;• exponential — doubles each attempt: delay, delay×2, delay×4&#10;Use exponential for rate-limited APIs (429) to back off gradually." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <input class="fm-input" type="number" value="${step.execution?.retryPolicy?.retryDelayMs ?? 500}" oninput="_apiColStepRetryField(${i},'retryDelayMs',+this.value)" placeholder="500"/>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Retry Strategy
                <span title="fixed: wait the same delay each time.&#10;exponential: double the delay each attempt (better for rate limits)." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <select class="fm-input" onchange="_apiColStepRetryField(${i},'strategy',this.value)">
                <option value="fixed" ${(step.execution?.retryPolicy?.strategy??'fixed')==='fixed'?'selected':''}>fixed</option>
                <option value="exponential" ${(step.execution?.retryPolicy?.strategy??'')==='exponential'?'selected':''}>exponential</option>
              </select>
            </div>
          </div>
          <div style="display:flex;gap:24px;padding-top:8px;border-top:1px solid var(--border)">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer" title="Teardown requests run AFTER all normal test requests complete — whether the collection passed or failed. Use for cleanup: deleting test data created during the run (e.g. DELETE /booking/{{bookingId}}). A teardown request failing does not affect the collection's overall pass/fail status. UC8 in the demo collection is an example teardown.">
              <input type="checkbox" ${step.execution?.teardown ? 'checked' : ''} onchange="_apiColStepExecField(${i},'teardown',this.checked)"/>
              Teardown request <span style="color:var(--text-muted);font-size:11px">— runs after all tests, used for cleanup (e.g. DELETE created data)</span>
            </label>
          </div>
          <div style="display:flex;gap:24px;padding-top:8px;margin-top:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer" title="Saves this request's response as the baseline snapshot. On future runs, the response is automatically compared against this saved baseline. Any changes (new fields, removed fields, value changes, status changes) are shown in the Diff tab of the run results. Use this to detect accidental API changes — like a contract test. Once set, run again without this checked to see the diff.">
              <input type="checkbox" ${step.captureBaseline ? 'checked' : ''} onchange="_apiColStepField(${i},'captureBaseline',this.checked)"/>
              Capture Baseline <span style="color:var(--text-muted);font-size:11px">— saves response snapshot; future runs diff against it to detect API changes</span>
            </label>
          </div>
        </div>
      </div>`;
    container.appendChild(div);
    _apiColParamsRender(i);
    _apiColStepHeadersRender(i);
    _apiColPreVarsRender(i);
    _apiColExtractRender(i);
    _apiColAssertRender(i);
    _apiColFlowRender(i);
  });
}

function _apiColStepToggle(i) {
  const body = document.getElementById('api-step-body-' + i);
  if (body) body.style.display = body.style.display === 'none' ? '' : 'none';
}
function _apiColStepTab(i, tab) {
  const panelKey = tab === 'rules' ? 'scripts' : tab;
  ['params','headers','body','scripts','settings'].forEach(t => {
    const panel = document.getElementById(`api-step-tab-${t}-${i}`);
    if (panel) panel.style.display = t === panelKey ? '' : 'none';
  });
  ['params','headers','body','rules','settings'].forEach(t => {
    const btn = document.getElementById(`api-step-tab-${i}-${t}`);
    if (btn) { btn.style.borderBottomColor = t === tab ? 'var(--accent)' : 'transparent'; btn.style.color = t === tab ? 'var(--accent)' : 'var(--text-muted)'; }
  });
}
function _apiColScriptTab(i, sub) {}
function _apiColRuleToggle(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

// ── Pre-request: Set Variables ──────────────────────────────────────────────


function _apiColPreVarAdd(i) {
  if (!_apiColSteps[i].preVars) _apiColSteps[i].preVars = [];
  _apiColSteps[i].preVars.push({ name: '', setTo: 'literal', value: '' });
  _apiColPreVarsRender(i);
}

function _apiColPreVarsRender(i) {
  const c = document.getElementById('api-step-prevars-' + i);
  if (!c) return;
  const vars = _apiColSteps[i].preVars ?? [];
  if (!vars.length) {
    c.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 0">No pre-request variables added yet — click + Add Variable.</div>';
    return;
  }
  c.innerHTML = vars.map((v, vi) => {
    // Value/source cell — changes based on setTo mode
    let valueCell;
    if (v.setTo === 'generate') {
      const _dynTokens = (typeof scriptKeywords !== 'undefined' && scriptKeywords.dynamicTokens) ? scriptKeywords.dynamicTokens : [];
      let _dynOpts = '<option value="">— choose token —</option>';
      let _curGrp = null;
      for (const t of _dynTokens) {
        const grp = t.group || '';
        if (grp && grp !== _curGrp) {
          if (_curGrp !== null) _dynOpts += '</optgroup>';
          _dynOpts += `<optgroup label="${escHtml(grp)}">`;
          _curGrp = grp;
        }
        _dynOpts += `<option value="${escHtml(t.token)}"${v.value === t.token ? ' selected' : ''}>${escHtml(t.label)}</option>`;
      }
      if (_curGrp !== null) _dynOpts += '</optgroup>';
      valueCell = `<select class="fm-input" style="font-size:12px" onchange="_apiColPreVarField(${i},${vi},'value',this.value)">${_dynOpts}</select>`;
    } else if (v.setTo === 'collectionVar') {
      valueCell = `<input class="fm-input" style="font-size:12px" placeholder="{{varName}} — name of the variable to copy" value="${escHtml(v.value)}" oninput="_apiColPreVarField(${i},${vi},'value',this.value)"/>`;
    } else if (v.setTo === 'envVar') {
      valueCell = `<input class="fm-input" style="font-size:12px" placeholder="{{ENV_VAR}} — environment variable name" value="${escHtml(v.value)}" oninput="_apiColPreVarField(${i},${vi},'value',this.value)"/>`;
    } else {
      // literal / fixed value
      valueCell = `<input class="fm-input" style="font-size:12px" placeholder="Enter a fixed value, e.g. true or 42" value="${escHtml(v.value)}" oninput="_apiColPreVarField(${i},${vi},'value',this.value)"/>`;
    }
    return `<div style="display:grid;grid-template-columns:1fr 200px 1fr 22px;gap:4px;margin-bottom:4px;align-items:center">
      <input class="fm-input" style="font-size:12px" placeholder="Variable name, e.g. authToken" value="${escHtml(v.name)}" oninput="_apiColPreVarField(${i},${vi},'name',this.value)"/>
      <select class="fm-input" style="font-size:12px" onchange="_apiColPreVarField(${i},${vi},'setTo',this.value)" title="How should this variable's value be set?">
        <option value="literal"       ${(v.setTo||'literal')==='literal'      ?'selected':''}>Fixed Value</option>
        <option value="collectionVar" ${v.setTo==='collectionVar'?'selected':''}>From another variable (Collection Variable)</option>
        <option value="envVar"        ${v.setTo==='envVar'       ?'selected':''}>From environment</option>
        <option value="generate"      ${v.setTo==='generate'     ?'selected':''}>Generate (random)</option>
      </select>
      ${valueCell}
      <button class="tbl-btn del" onclick="_apiColPreVarRemove(${i},${vi})" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function _apiColPreVarField(i, vi, f, val) {
  _apiColSteps[i].preVars[vi][f] = val;
  if (f === 'setTo') { _apiColSteps[i].preVars[vi].value = ''; _apiColPreVarsRender(i); }
}
function _apiColPreVarRemove(i, vi) { _apiColSteps[i].preVars.splice(vi, 1); _apiColPreVarsRender(i); }

// ── Post-response: Assertions ───────────────────────────────────────────────
const _ASSERT_FIELDS = [
  { label: 'Status Code',               value: 'statusCode',      hasPath: false },
  { label: 'Response Time (ms)',         value: 'responseTime',    hasPath: false },
  { label: 'Body (JSON path / array)',   value: 'body',            hasPath: true,  pathPlaceholder: 'Path e.g. $.data or $.items[0].id' },
  { label: 'Body (array length)',        value: 'bodyArrayLength', hasPath: true,  pathPlaceholder: 'Array path e.g. $.items' },
  { label: 'Body (field count)',         value: 'bodyFieldCount',  hasPath: true,  pathPlaceholder: 'Object path e.g. $.user' },
  { label: 'Header',                     value: 'header',          hasPath: true,  pathPlaceholder: 'Header name e.g. content-type' },
  { label: 'Cookie',                     value: 'cookie',          hasPath: true,  pathPlaceholder: 'Cookie name e.g. sessionId' },
  { label: 'Body contains',             value: 'bodyContains',    hasPath: false, lockedOperator: 'contains' },
  { label: 'Body is valid JSON',         value: 'bodyIsJson',      hasPath: false, lockedOperator: 'equals',   lockedExpected: 'true' },
  { label: 'Response size (bytes)',      value: 'responseSize',    hasPath: false },
  { label: 'HTTP version',              value: 'httpVersion',     hasPath: false },
];

// Derive the Check field type from the stored field string (handles all encoded formats)
function _assertFieldType(field) {
  if (!field || field === 'statusCode' || field === 'status') return 'statusCode';
  if (field === 'responseTime') return 'responseTime';
  if (field === 'bodyContains') return 'bodyContains';
  if (field === 'bodyIsJson')   return 'bodyIsJson';
  if (field === 'responseSize') return 'responseSize';
  if (field === 'httpVersion')  return 'httpVersion';
  if (field === 'body')         return 'body';
  if (field.startsWith('@arrayLength:')) return 'bodyArrayLength';
  if (field.startsWith('@fieldCount:'))  return 'bodyFieldCount';
  if (field.startsWith('header.') || field === 'header') return 'header';
  if (field.startsWith('cookie.') || field === 'cookie') return 'cookie';
  if (field.startsWith('$')) return 'body';  // direct JSONPath
  return 'statusCode';
}

// Extract the path portion from an encoded field string
function _assertFieldPath(field) {
  if (field.startsWith('@arrayLength:')) return field.slice(13);
  if (field.startsWith('@fieldCount:'))  return field.slice(12);
  if (field.startsWith('header.'))       return field.slice(7);
  if (field.startsWith('cookie.'))       return field.slice(7);
  if (field.startsWith('$'))             return field;  // body JSONPath stored directly
  return '';
}

// Encode fieldType + path back into a single field string for storage
function _assertFieldEncode(fieldType, path) {
  const p = (path || '').trim();
  switch (fieldType) {
    case 'body':            return p || 'body';
    case 'bodyArrayLength': return p ? '@arrayLength:' + p : '@arrayLength:';
    case 'bodyFieldCount':  return p ? '@fieldCount:' + p  : '@fieldCount:';
    case 'header':          return p ? 'header.' + p       : 'header';
    case 'cookie':          return p ? 'cookie.' + p       : 'cookie';
    default:                return fieldType;
  }
}
const _ASSERT_OPS = [
  { label: 'equals', value: 'equals' },
  { label: 'not equals', value: 'notEquals' },
  { label: 'contains', value: 'contains' },
  { label: 'not contains', value: 'notContains' },
  { label: 'starts with', value: 'startsWith' },
  { label: 'ends with', value: 'endsWith' },
  { label: 'greater than', value: 'greaterThan' },
  { label: 'less than', value: 'lessThan' },
  { label: 'exists', value: 'exists' },
  { label: 'not exists', value: 'notExists' },
  { label: 'is empty', value: 'isEmpty' },
  // Array operators
  { label: 'array length equals', value: 'arrayLengthEquals' },
  { label: 'array length > N', value: 'arrayLengthGreaterThan' },
  { label: 'array length < N', value: 'arrayLengthLessThan' },
  { label: 'array not empty', value: 'arrayNotEmpty' },
  { label: 'array contains', value: 'arrayContains' },
];
function _apiColAssertAdd(i) {
  if (!_apiColSteps[i].assertions) _apiColSteps[i].assertions = [];
  _apiColSteps[i].assertions.push({ field: 'statusCode', operator: 'equals', expected: '200', severity: 'critical' });
  _apiColAssertRender(i);
}
function _apiColAssertRender(i) {
  const c = document.getElementById('api-step-assert-' + i);
  if (!c) return;
  const assertions = _apiColSteps[i].assertions ?? [];
  if (!assertions.length) { c.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 0">No assertions — click + Assert to validate the response.</div>'; return; }
  const noExpected = ['exists','notExists','isEmpty','arrayNotEmpty'];
  c.innerHTML = assertions.map((a, ai) => {
    const ft = _assertFieldType(a.field);
    const fp = _assertFieldPath(a.field);
    const fieldDef = _ASSERT_FIELDS.find(f => f.value === ft) || _ASSERT_FIELDS[0];
    const fieldDropdown = `<select class="fm-input" style="font-size:12px" onchange="_apiColAssertFieldType(${i},${ai},this.value)">
      ${_ASSERT_FIELDS.map(f => `<option value="${f.value}" ${ft===f.value?'selected':''}>${f.label}</option>`).join('')}
    </select>`;
    const checkCell = fieldDef.hasPath
      ? `<div style="display:flex;flex-direction:column;gap:2px">
           ${fieldDropdown}
           <input class="fm-input" style="font-size:11px;color:var(--text-muted)" placeholder="${escHtml(fieldDef.pathPlaceholder||'')}" value="${escHtml(fp)}" oninput="_apiColAssertFieldPath(${i},${ai},this.value)"/>
         </div>`
      : fieldDropdown;
    // Operator cell — locked for bodyContains (contains) and bodyIsJson (equals)
    const operatorCell = fieldDef.lockedOperator
      ? `<div class="fm-input" style="font-size:12px;opacity:0.55;display:flex;align-items:center;cursor:not-allowed;user-select:none">${fieldDef.lockedOperator}</div>`
      : `<select class="fm-input" style="font-size:12px" onchange="_apiColAssertField(${i},${ai},'operator',this.value)">
           ${_ASSERT_OPS.map(o => `<option value="${o.value}" ${a.operator===o.value?'selected':''}>${o.label}</option>`).join('')}
         </select>`;
    // Expected cell — locked for bodyIsJson (true), disabled for no-expected operators
    const isLocked   = fieldDef.lockedExpected !== undefined;
    const isDisabled = isLocked || noExpected.includes(a.operator);
    const dispVal    = isLocked ? fieldDef.lockedExpected : escHtml(String(a.expected ?? ''));
    const expectedCell = `<input class="fm-input" style="font-size:12px${isDisabled?';opacity:0.4':''}" placeholder="Expected value or {{var}}" value="${dispVal}" ${isDisabled?'disabled':''} oninput="_apiColAssertField(${i},${ai},'expected',this.value)"/>`;
    return `<div style="display:grid;grid-template-columns:150px 140px 1fr 90px 22px;gap:4px;margin-bottom:4px;align-items:${fieldDef.hasPath?'start':'center'}">
      ${checkCell}
      ${operatorCell}
      ${expectedCell}
      <select class="fm-input" style="font-size:12px" onchange="_apiColAssertField(${i},${ai},'severity',this.value)">
        ${['critical','high','medium','low','soft'].map(s => `<option ${a.severity===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <button class="tbl-btn del" onclick="_apiColAssertRemove(${i},${ai})">✕</button>
    </div>`;
  }).join('');
}
// Change Check field type — reset path, auto-set locked operator/expected, re-render
function _apiColAssertFieldType(i, ai, ft) {
  _apiColSteps[i].assertions[ai].field = _assertFieldEncode(ft, '');
  const fieldDef = _ASSERT_FIELDS.find(f => f.value === ft);
  if (fieldDef?.lockedOperator) _apiColSteps[i].assertions[ai].operator = fieldDef.lockedOperator;
  if (fieldDef?.lockedExpected !== undefined) _apiColSteps[i].assertions[ai].expected = fieldDef.lockedExpected;
  _apiColAssertRender(i);
}
// Update path portion of field — encode type + new path without re-render (live typing)
function _apiColAssertFieldPath(i, ai, path) {
  const ft = _assertFieldType(_apiColSteps[i].assertions[ai].field);
  _apiColSteps[i].assertions[ai].field = _assertFieldEncode(ft, path);
}
function _apiColAssertField(i, ai, f, val) { _apiColSteps[i].assertions[ai][f] = val; if (f === 'operator') _apiColAssertRender(i); }
function _apiColAssertRemove(i, ai) { _apiColSteps[i].assertions.splice(ai, 1); _apiColAssertRender(i); }

// ── Domain Assertion Library ────────────────────────────────────────────────

let _domainAssertStepIdx = -1;
let _domainAssertDomains = [];

async function _domainAssertOpen(i) {
  _domainAssertStepIdx = i;
  let modal = document.getElementById('domain-assert-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'domain-assert-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
    modal.innerHTML = `
      <div style="background:var(--bg-primary,#111);border:1px solid var(--border);border-radius:10px;width:820px;max-width:96vw;max-height:90vh;display:flex;flex-direction:column;position:relative">
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid var(--border);flex-shrink:0">
          <span style="font-size:15px;font-weight:700;color:#a78bfa">Load Domain Assertion Template</span>
          <button class="tbl-btn" onclick="_domainAssertClose()" style="font-size:16px;padding:2px 8px">✕</button>
        </div>
        <!-- Body: two columns -->
        <div style="display:flex;flex:1;overflow:hidden;min-height:0">
          <!-- Left: domain list -->
          <div style="width:240px;flex-shrink:0;padding:12px;border-right:1px solid var(--border);overflow-y:auto">
            <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px;margin-bottom:8px">Select Domain</div>
            <div id="domain-assert-list" style="display:flex;flex-direction:column;gap:6px"></div>
          </div>
          <!-- Right: preview -->
          <div style="flex:1;padding:12px;overflow-y:auto;display:flex;flex-direction:column;gap:10px">
            <div id="domain-assert-preview" style="display:none;flex:1">
              <div style="color:var(--text-muted);font-size:12px">Click a domain on the left to preview its assertions.</div>
            </div>
            <div id="domain-assert-placeholder" style="color:var(--text-muted);font-size:12px;margin-top:20px">
              Select a domain on the left to see the pre-built assertion pack. Assertions are <strong style="color:var(--text)">appended</strong> to your existing ones.
            </div>
          </div>
        </div>
        <!-- Footer -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 18px;border-top:1px solid var(--border);flex-shrink:0">
          <div style="font-size:11px;color:#f59e0b">Advisory: review expected values before saving.</div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-secondary" onclick="_domainAssertClose()">Cancel</button>
            <button class="btn btn-primary" id="domain-assert-apply-btn" style="background:#7c3aed;border-color:#7c3aed;display:none" onclick="_domainAssertApply()">Apply Assertions</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  document.getElementById('domain-assert-apply-btn').style.display = 'none';
  document.getElementById('domain-assert-preview').style.display = 'none';
  modal._selectedDomain = null;
  const list = document.getElementById('domain-assert-list');
  list.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Loading domains…</div>';
  try {
    const res = await fetch('/api/ai-intelligence/domain-assertions');
    if (!res.ok) { list.innerHTML = '<div style="color:#ef4444">Failed to load domains.</div>'; return; }
    const data = await res.json();
    _domainAssertDomains = data.domains || [];
    list.innerHTML = _domainAssertDomains.map(d => `
      <div class="domain-card" data-id="${escHtml(d.id)}" onclick="_domainAssertSelect('${escHtml(d.id)}')"
           style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;cursor:pointer;transition:border-color .15s,background .15s">
        <div style="font-weight:600;font-size:12px;color:#a78bfa">${escHtml(d.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;line-height:1.3">${escHtml(d.description)}</div>
      </div>`).join('');
  } catch { list.innerHTML = '<div style="color:#ef4444">Error loading domains.</div>'; }
}

async function _domainAssertSelect(domainId) {
  document.querySelectorAll('.domain-card').forEach(c => {
    c.style.borderColor = c.dataset.id === domainId ? '#a78bfa' : 'var(--border)';
    c.style.background = c.dataset.id === domainId ? 'rgba(167,139,250,.08)' : '';
  });
  const modal = document.getElementById('domain-assert-modal');
  modal._selectedDomain = domainId;
  const preview = document.getElementById('domain-assert-preview');
  const placeholder = document.getElementById('domain-assert-placeholder');
  if (placeholder) placeholder.style.display = 'none';
  preview.style.display = 'block';
  preview.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Loading…</div>';
  document.getElementById('domain-assert-apply-btn').style.display = 'none';
  try {
    const res = await fetch(`/api/ai-intelligence/domain-assertions/${encodeURIComponent(domainId)}`);
    if (!res.ok) { preview.innerHTML = '<div style="color:#ef4444">Failed to load pack.</div>'; return; }
    const pack = await res.json();
    preview.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px">${escHtml(pack.name)} — ${pack.assertions.length} assertions</div>
      <div style="display:grid;grid-template-columns:1fr 100px 1fr 65px;gap:4px;font-size:11px;font-weight:700;color:var(--text-muted);padding:0 0 4px;border-bottom:1px solid var(--border);margin-bottom:4px">
        <span>Check Field</span><span>Operator</span><span>Expected</span><span>Severity</span>
      </div>
      ${pack.assertions.map(a => `
        <div style="display:grid;grid-template-columns:1fr 100px 1fr 65px;gap:4px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:11px;align-items:center">
          <span style="color:#e2e8f0;word-break:break-all">${escHtml(a.field)}</span>
          <span style="color:#94a3b8">${escHtml(a.operator)}</span>
          <span style="color:#94a3b8">${a.expected !== undefined ? escHtml(String(a.expected)) : '<em style="opacity:.4">—</em>'}</span>
          <span style="color:${a.severity==='critical'?'#f87171':a.severity==='high'?'#fb923c':a.severity==='medium'?'#facc15':'#94a3b8'};font-size:10px;font-weight:600">${escHtml(a.severity||'medium')}</span>
        </div>`).join('')}`;
    document.getElementById('domain-assert-apply-btn').style.display = 'inline-block';
    modal._assertionPack = pack.assertions;
  } catch (e) { preview.innerHTML = `<div style="color:#ef4444">Error: ${e.message}</div>`; }
}

function _domainAssertApply() {
  const modal = document.getElementById('domain-assert-modal');
  const assertions = modal._assertionPack;
  const i = _domainAssertStepIdx;
  if (!assertions || i < 0) return;
  if (!_apiColSteps[i].assertions) _apiColSteps[i].assertions = [];
  _apiColSteps[i].assertions.push(...assertions);
  _apiColAssertRender(i);
  _domainAssertClose();
  showToast('success', `${assertions.length} domain assertions added. Review expected values before saving.`);
}

function _domainAssertClose() {
  const modal = document.getElementById('domain-assert-modal');
  if (modal) modal.style.display = 'none';
}

// ── Flow Control: No-Code Rule Builder ─────────────────────────────────────
// Data schema: FlowRule = { condition?: { field, operator, value }, action, target? }
// action: '__stop__' | '__continue__' | '__jump__' | '__repeat__'
// target: step name (jump) | repeat count as string (repeat)

function _apiColFlowAdd(i) {
  if (!_apiColSteps[i].flowRules) _apiColSteps[i].flowRules = [];
  _apiColSteps[i].flowRules.push({
    condition: { field: 'statusCode', operator: 'equals', value: '200' },
    action: '__continue__',
  });
  _apiColFlowRender(i);
}

function _apiColFlowRender(i) {
  const c = document.getElementById('api-step-flow-' + i);
  if (!c) return;
  const rules = _apiColSteps[i].flowRules ?? [];
  if (!rules.length) {
    c.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 0">No rules added — collection runs sequentially by default.</div>';
    return;
  }
  c.innerHTML = rules.map((r, ri) => {
    // Condition section
    const hasCondition = !!r.condition;
    const field = r.condition?.field || 'statusCode';
    const ft = _assertFieldType(field);
    const fp = _assertFieldPath(field);
    const fieldDef = _ASSERT_FIELDS.find(f => f.value === ft) || _ASSERT_FIELDS[0];

    const condCheckDropdown = `<select class="fm-input" style="font-size:12px" onchange="_apiColFlowCheckType(${i},${ri},this.value)">
      ${_ASSERT_FIELDS.map(f => `<option value="${f.value}" ${ft===f.value?'selected':''}>${f.label}</option>`).join('')}
    </select>`;
    const condCheckCell = fieldDef.hasPath
      ? `<div style="display:flex;flex-direction:column;gap:2px">${condCheckDropdown}
           <input class="fm-input" style="font-size:11px;color:var(--text-muted)" placeholder="${escHtml(fieldDef.pathPlaceholder||'')}" value="${escHtml(fp)}" oninput="_apiColFlowCheckPath(${i},${ri},this.value)"/>
         </div>`
      : condCheckDropdown;
    const condOpCell = fieldDef.lockedOperator
      ? `<div class="fm-input" style="font-size:12px;opacity:0.55;display:flex;align-items:center;cursor:not-allowed;user-select:none">${fieldDef.lockedOperator}</div>`
      : `<select class="fm-input" style="font-size:12px" onchange="_apiColFlowCondField(${i},${ri},'operator',this.value)">
           ${_ASSERT_OPS.map(o => `<option value="${o.value}" ${(r.condition?.operator||'equals')===o.value?'selected':''}>${o.label}</option>`).join('')}
         </select>`;
    const isValLocked = fieldDef.lockedExpected !== undefined;
    const condValCell = `<input class="fm-input" style="font-size:12px${isValLocked?';opacity:0.4':''}" placeholder="Value or {{var}}" value="${isValLocked ? escHtml(fieldDef.lockedExpected) : escHtml(r.condition?.value ?? '')}" ${isValLocked?'disabled':''} oninput="_apiColFlowCondField(${i},${ri},'value',this.value)"/>`;

    const condBlock = hasCondition
      ? `<div style="display:grid;grid-template-columns:140px 140px 1fr;gap:4px;align-items:${fieldDef.hasPath?'start':'center'}">
           ${condCheckCell}${condOpCell}${condValCell}
         </div>`
      : `<div style="color:var(--text-muted);font-size:12px;font-style:italic">Always (no condition)</div>`;

    // Action section
    const action = r.action || '__continue__';
    const actionOpts = [
      { v: '__continue__', label: '▶ Skip to next request' },
      { v: '__stop__',     label: '⛔ Stop collection' },
      { v: '__jump__',     label: '↩ Jump to request...' },
      { v: '__repeat__',   label: '🔁 Repeat this request' },
    ];
    const actionDropdown = `<select class="fm-input" style="font-size:12px;flex:1" onchange="_apiColFlowActionChange(${i},${ri},this.value)">
      ${actionOpts.map(a => `<option value="${a.v}" ${action===a.v?'selected':''}>${a.label}</option>`).join('')}
    </select>`;
    let targetCell = '';
    if (action === '__jump__') {
      targetCell = `<select class="fm-input" style="font-size:12px;flex:1" onchange="_apiColFlowSetTarget(${i},${ri},this.value)">
        <option value="">— pick request —</option>
        ${_apiColSteps.map((s, si) => `<option value="${escHtml(s.name)}" ${r.target===s.name?'selected':''}>${si+1}. ${escHtml(s.name)}${si===i?' (this request)':''}</option>`).join('')}
      </select>`;
    } else if (action === '__repeat__') {
      const maxR = parseInt(r.target, 10);
      targetCell = `<div style="display:flex;align-items:center;gap:4px;flex:1">
        <span style="font-size:12px;color:var(--text-muted);white-space:nowrap">up to</span>
        <input class="fm-input" type="number" min="1" max="10" style="width:60px;font-size:12px" value="${isNaN(maxR)?3:maxR}" oninput="_apiColFlowSetTarget(${i},${ri},this.value)"/>
        <span style="font-size:12px;color:var(--text-muted);white-space:nowrap">times</span>
      </div>`;
    }

    return `<div style="border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin-bottom:6px;background:var(--bg-secondary,#1a1a1a)">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">If</span>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px;cursor:pointer">
          <input type="checkbox" ${hasCondition?'checked':''} onchange="_apiColFlowToggleCond(${i},${ri},this.checked)"/>
          condition is met
        </label>
        <span style="flex:1"></span>
        <button class="tbl-btn del" onclick="_apiColFlowRemove(${i},${ri})" title="Remove rule">✕</button>
      </div>
      <div style="padding:4px 0 8px 18px">${condBlock}</div>
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.4px">Then</span>
        ${actionDropdown}
        ${targetCell}
      </div>
    </div>`;
  }).join('');
}

function _apiColFlowCheckType(i, ri, ft) {
  if (!_apiColSteps[i].flowRules[ri].condition) _apiColSteps[i].flowRules[ri].condition = { field: ft, operator: 'equals', value: '' };
  const encoded = _assertFieldEncode(ft, '');
  _apiColSteps[i].flowRules[ri].condition.field = encoded;
  const fieldDef = _ASSERT_FIELDS.find(f => f.value === ft);
  if (fieldDef?.lockedOperator) _apiColSteps[i].flowRules[ri].condition.operator = fieldDef.lockedOperator;
  if (fieldDef?.lockedExpected !== undefined) _apiColSteps[i].flowRules[ri].condition.value = fieldDef.lockedExpected;
  _apiColFlowRender(i);
}
function _apiColFlowCheckPath(i, ri, path) {
  if (!_apiColSteps[i].flowRules[ri].condition) return;
  const ft = _assertFieldType(_apiColSteps[i].flowRules[ri].condition.field || 'statusCode');
  _apiColSteps[i].flowRules[ri].condition.field = _assertFieldEncode(ft, path);
}
function _apiColFlowCondField(i, ri, f, val) {
  if (!_apiColSteps[i].flowRules[ri].condition) _apiColSteps[i].flowRules[ri].condition = { field: 'statusCode', operator: 'equals', value: '' };
  _apiColSteps[i].flowRules[ri].condition[f] = val;
}
function _apiColFlowToggleCond(i, ri, checked) {
  if (checked) {
    _apiColSteps[i].flowRules[ri].condition = { field: 'statusCode', operator: 'equals', value: '200' };
  } else {
    delete _apiColSteps[i].flowRules[ri].condition;
  }
  _apiColFlowRender(i);
}
function _apiColFlowActionChange(i, ri, action) {
  _apiColSteps[i].flowRules[ri].action = action;
  if (action === '__repeat__') _apiColSteps[i].flowRules[ri].target = '3';
  else if (action !== '__jump__') delete _apiColSteps[i].flowRules[ri].target;
  _apiColFlowRender(i);
}
function _apiColFlowSetTarget(i, ri, val) { _apiColSteps[i].flowRules[ri].target = val; }
function _apiColFlowRemove(i, ri) { _apiColSteps[i].flowRules.splice(ri, 1); _apiColFlowRender(i); }
function _apiColParamAdd(i) {
  if (!_apiColSteps[i].request) _apiColSteps[i].request = {};
  if (!_apiColSteps[i].request.queryParams) _apiColSteps[i].request.queryParams = [];
  _apiColSteps[i].request.queryParams.push({ key: '', value: '' });
  _apiColParamsRender(i);
}
function _apiColParamsRender(i) {
  const container = document.getElementById('api-step-params-' + i);
  if (!container) return;
  const params = Array.isArray(_apiColSteps[i].request?.queryParams) ? _apiColSteps[i].request.queryParams : [];
  if (params.length === 0) { container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 2px">No query params yet.</div>'; return; }
  container.innerHTML = params.map((p, pi) => `
    <div style="display:grid;grid-template-columns:1fr 1fr 22px;gap:4px;margin-bottom:4px;align-items:center">
      <input class="fm-input" style="font-size:12px" placeholder="Key" value="${escHtml(p.key)}" oninput="_apiColParamField(${i},${pi},'key',this.value)"/>
      <input class="fm-input" style="font-size:12px" placeholder="Value" value="${escHtml(p.value)}" oninput="_apiColParamField(${i},${pi},'value',this.value)"/>
      <button class="tbl-btn del" onclick="_apiColParamRemove(${i},${pi})">✕</button>
    </div>`).join('');
}
function _apiColParamField(i, pi, field, val) { _apiColSteps[i].request.queryParams[pi][field] = val; }
function _apiColParamRemove(i, pi) { _apiColSteps[i].request.queryParams.splice(pi, 1); _apiColParamsRender(i); }
function _apiColStepField(i, field, val) { _apiColSteps[i][field] = val; }
function _apiColStepReqField(i, field, val) { if (!_apiColSteps[i].request) _apiColSteps[i].request = {}; _apiColSteps[i].request[field] = val; }
function _apiColModeChanged(mode) {
  const warn = document.getElementById('api-col-mode-warning');
  if (!warn) return;
  if (mode === 'parallel') {
    warn.style.display = 'block';
  } else {
    warn.style.display = 'none';
  }
}
function _apiColStepExecField(i, field, val) { if (!_apiColSteps[i].execution) _apiColSteps[i].execution = {}; _apiColSteps[i].execution[field] = val; }
function _apiColStepRetryField(i, field, val) {
  if (!_apiColSteps[i].execution) _apiColSteps[i].execution = {};
  if (!_apiColSteps[i].execution.retryPolicy) _apiColSteps[i].execution.retryPolicy = { maxRetries: 0, strategy: 'fixed', retryDelayMs: 500, retryOn: [] };
  _apiColSteps[i].execution.retryPolicy[field] = val;
}
function _apiColToggleRetryOn(i, condition, checked) {
  if (!_apiColSteps[i].execution) _apiColSteps[i].execution = {};
  if (!_apiColSteps[i].execution.retryPolicy) _apiColSteps[i].execution.retryPolicy = { maxRetries: 0, strategy: 'fixed', retryDelayMs: 500, retryOn: [] };
  const list = _apiColSteps[i].execution.retryPolicy.retryOn ?? [];
  if (checked && !list.includes(condition)) list.push(condition);
  if (!checked) { const idx = list.indexOf(condition); if (idx > -1) list.splice(idx, 1); }
  _apiColSteps[i].execution.retryPolicy.retryOn = list;
}
function _apiColStepRemove(i) { _apiColSteps.splice(i, 1); _renderApiColSteps(); }
function _apiColBodyInput(i, step) {
  const bodyType = step.request?.bodyType ?? 'none';
  const body = step.request?.body ?? '';
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  if (bodyType === 'none') return '';
  if (bodyType === 'json') return `<textarea class="fm-input" rows="4" style="font-family:monospace;font-size:12px;width:100%" placeholder="JSON body" oninput="_apiColStepReqField(${i},'body',this.value)">${escHtml(bodyStr)}</textarea>`;
  if (bodyType === 'binary') return `<input type="file" class="fm-input" onchange="_apiColStepReqField(${i},'body',this.files[0]?.name ?? '')"/>`;
  if (bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') {
    const pairs = Array.isArray(step.request?.formParams) ? step.request.formParams : [];
    const rows = pairs.map((p, pi) => `
      <div style="display:flex;gap:4px;margin-bottom:4px">
        <input class="fm-input" style="flex:1" placeholder="Key" value="${escHtml(p.key)}" oninput="_apiColFormParamField(${i},${pi},'key',this.value)"/>
        <input class="fm-input" style="flex:1" placeholder="Value" value="${escHtml(p.value)}" oninput="_apiColFormParamField(${i},${pi},'value',this.value)"/>
        <button class="tbl-btn del" onclick="_apiColFormParamRemove(${i},${pi})">✕</button>
      </div>`).join('');
    return `${rows}<button class="btn btn-secondary btn-sm" onclick="_apiColFormParamAdd(${i})">+ Add</button>`;
  }
  const lang = bodyType === 'graphql' ? 'GraphQL query' : bodyType === 'xml' ? 'XML' : 'JSON / text';
  return `<textarea class="fm-input" rows="4" style="font-family:monospace;font-size:12px;width:100%" placeholder="${lang}" oninput="_apiColStepReqField(${i},'body',this.value)">${escHtml(bodyStr)}</textarea>`;
}
function _apiColStepBodyTypeChange(i, val) {
  _apiColStepReqField(i, 'bodyType', val);
  const labelEl = document.getElementById('api-step-body-label-' + i);
  const inputEl = document.getElementById('api-step-body-input-' + i);
  if (labelEl) labelEl.style.display = val === 'none' ? 'none' : '';
  if (inputEl) inputEl.innerHTML = _apiColBodyInput(i, _apiColSteps[i]);
}
function _apiColFormParamAdd(i) {
  if (!_apiColSteps[i].request) _apiColSteps[i].request = {};
  if (!_apiColSteps[i].request.formParams) _apiColSteps[i].request.formParams = [];
  _apiColSteps[i].request.formParams.push({ key: '', value: '' });
  const inputEl = document.getElementById('api-step-body-input-' + i);
  if (inputEl) inputEl.innerHTML = _apiColBodyInput(i, _apiColSteps[i]);
}
function _apiColFormParamField(i, pi, field, val) { _apiColSteps[i].request.formParams[pi][field] = val; }
function _apiColFormParamRemove(i, pi) {
  _apiColSteps[i].request.formParams.splice(pi, 1);
  const inputEl = document.getElementById('api-step-body-input-' + i);
  if (inputEl) inputEl.innerHTML = _apiColBodyInput(i, _apiColSteps[i]);
}

function _apiColExtractRender(i) {
  const container = document.getElementById('api-step-extract-' + i);
  if (!container) return;
  const extracts = _apiColSteps[i].extractVariables ?? [];
  if (extracts.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 2px">No extractions — add one to chain this request\'s response into the next request.</div>';
    return;
  }
  container.innerHTML = extracts.map((ex, ei) => `
    <div style="display:grid;grid-template-columns:1fr 140px 1fr 100px 22px;gap:4px;margin-bottom:4px;align-items:center">
      <input class="fm-input" style="font-size:12px" placeholder="e.g. authToken" value="${escHtml(ex.name)}" oninput="_apiColExtractField(${i},${ei},'name',this.value)"/>
      <select class="fm-input" style="font-size:12px" onchange="_apiColExtractField(${i},${ei},'source',this.value)">
        ${['responseBody','responseHeader','statusCode'].map(s => `<option${s === ex.source ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      <input class="fm-input" style="font-size:12px" placeholder="${ex.source === 'responseHeader' ? 'e.g. Authorization' : ex.source === 'statusCode' ? '(no path needed)' : 'e.g. $.data.token'}" value="${escHtml(ex.path)}" oninput="_apiColExtractField(${i},${ei},'path',this.value)" ${ex.source === 'statusCode' ? 'disabled' : ''}/>
      <select class="fm-input" style="font-size:12px" onchange="_apiColExtractField(${i},${ei},'scope',this.value)">
        ${['collection','global','step'].map(s => `<option${s === ex.scope ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      <button class="tbl-btn del" onclick="_apiColExtractRemove(${i},${ei})">✕</button>
    </div>`).join('');
}
function _apiColExtractAdd(i) {
  if (!_apiColSteps[i].extractVariables) _apiColSteps[i].extractVariables = [];
  _apiColSteps[i].extractVariables.push({ name: '', source: 'responseBody', path: '', scope: 'collection' });
  _apiColExtractRender(i);
}
function _apiColExtractField(i, ei, field, val) {
  _apiColSteps[i].extractVariables[ei][field] = val;
  if (field === 'source') _apiColExtractRender(i);
}
function _apiColExtractRemove(i, ei) {
  _apiColSteps[i].extractVariables.splice(ei, 1);
  _apiColExtractRender(i);
}

const _API_DEFAULT_HEADERS = [
  { key: 'Cache-Control', value: 'no-cache' },
  { key: 'Postman-Token', value: '<calculated when request is sent>' },
  { key: 'Host', value: '<calculated when request is sent>' },
  { key: 'User-Agent', value: 'QAAgent/1.0' },
  { key: 'Accept', value: '*/*' },
  { key: 'Accept-Encoding', value: 'gzip, deflate, br' },
  { key: 'Connection', value: 'keep-alive' },
];
function _apiColStepHeaderAdd(i) {
  if (!_apiColSteps[i].request) _apiColSteps[i].request = {};
  if (!_apiColSteps[i].request.headers) _apiColSteps[i].request.headers = [];
  _apiColSteps[i].request.headers.push({ key: '', value: '', description: '' });
  _apiColStepHeadersRender(i);
}
function _apiColStepHeadersRender(i) {
  const container = document.getElementById('api-step-headers-' + i);
  if (!container) return;
  const userHeaders = Array.isArray(_apiColSteps[i].request?.headers) ? _apiColSteps[i].request.headers : [];
  const dimStyle = 'color:var(--text-muted);font-size:12px;padding:3px 6px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
  const defaultRows = _API_DEFAULT_HEADERS.map(h => `
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:2px;opacity:0.5">
      <input type="checkbox" checked disabled style="flex-shrink:0"/>
      <span style="${dimStyle}">${escHtml(h.key)}</span>
      <span style="${dimStyle}">${escHtml(h.value)}</span>
      <span style="${dimStyle}"></span>
      <span style="width:22px"></span>
    </div>`).join('');
  const userRows = userHeaders.map((h, hi) => `
    <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">
      <input type="checkbox" ${h.disabled ? '' : 'checked'} onchange="_apiColStepHeaderToggle(${i},${hi},this.checked)" style="flex-shrink:0"/>
      <input class="fm-input" style="flex:1" placeholder="Key" value="${escHtml(h.key)}" oninput="_apiColStepHeaderField(${i},${hi},'key',this.value)"/>
      <input class="fm-input" style="flex:1" placeholder="Value" value="${escHtml(h.value)}" oninput="_apiColStepHeaderField(${i},${hi},'value',this.value)"/>
      <input class="fm-input" style="flex:1" placeholder="Description" value="${escHtml(h.description ?? '')}" oninput="_apiColStepHeaderField(${i},${hi},'description',this.value)"/>
      <button class="tbl-btn del" style="flex-shrink:0" onclick="_apiColStepHeaderRemove(${i},${hi})">✕</button>
    </div>`).join('');
  const emptyRow = `
    <div style="display:flex;gap:4px;margin-top:2px">
      <input type="checkbox" disabled style="flex-shrink:0;opacity:0.3"/>
      <input class="fm-input" style="flex:1;opacity:0.4" placeholder="Key" onfocus="_apiColStepHeaderAdd(${i});this.blur()"/>
      <input class="fm-input" style="flex:1;opacity:0.4" placeholder="Value" onfocus="_apiColStepHeaderAdd(${i});this.blur()"/>
      <input class="fm-input" style="flex:1;opacity:0.4" placeholder="Description" onfocus="_apiColStepHeaderAdd(${i});this.blur()"/>
      <span style="width:22px"></span>
    </div>`;
  const colHeaders = `
    <div style="display:flex;gap:4px;margin-bottom:4px;font-size:11px;color:var(--text-muted);font-weight:600">
      <span style="width:18px"></span>
      <span style="flex:1;padding-left:6px">Key</span>
      <span style="flex:1;padding-left:6px">Value</span>
      <span style="flex:1;padding-left:6px">Description</span>
      <span style="width:22px"></span>
    </div>`;
  container.innerHTML = colHeaders + defaultRows + userRows + emptyRow;
}
function _apiColStepHeaderField(i, hi, field, val) {
  if (!_apiColSteps[i].request.headers[hi]) return;
  _apiColSteps[i].request.headers[hi][field] = val;
}
function _apiColStepHeaderToggle(i, hi, checked) { _apiColSteps[i].request.headers[hi].disabled = !checked; }
function _apiColStepHeaderRemove(i, hi) { _apiColSteps[i].request.headers.splice(hi, 1); _apiColStepHeadersRender(i); }

function apiColAddStep() {
  _apiColSteps.push({
    id: 'step-' + Date.now(),
    name: 'New Request',
    request: { method: 'GET', url: '', bodyType: 'none' },
    assertions: [], extractVariables: [], execution: {}, dependsOn: [],
  });
  _renderApiColSteps();
}

function _renderApiColVars() {
  const tbody = document.getElementById('api-col-vars-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  _apiColVars.forEach((v, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="fm-input" style="width:100%" value="${escHtml(v.key)}" oninput="_apiColVarField(${i},'key',this.value)"/></td>
      <td><input class="fm-input" style="width:100%" value="${escHtml(v.value)}" type="${v.sensitive ? 'password' : 'text'}" oninput="_apiColVarField(${i},'value',this.value)"/></td>
      <td style="text-align:center"><input type="checkbox" ${v.sensitive ? 'checked' : ''} onchange="_apiColVarField(${i},'sensitive',this.checked)"/></td>
      <td><button class="tbl-btn del" onclick="_apiColVarRemove(${i})">✕</button></td>`;
    tbody.appendChild(tr);
  });
}
function _apiColVarField(i, f, v) { _apiColVars[i][f] = v; }
function _apiColVarRemove(i) { _apiColVars.splice(i, 1); _renderApiColVars(); }
function apiColVarAdd() { _apiColVars.push({ key: '', value: '', sensitive: false }); _renderApiColVars(); }

async function apiColSave() {
  const name = document.getElementById('api-col-name').value.trim();
  const environmentId = document.getElementById('api-col-env').value;
  if (!name || !environmentId) { modAlert('api-col-modal-alert', 'error', 'Name and Environment are required'); return; }
  const body = {
    name, environmentId,
    steps: _apiColSteps,
    variables: _apiColVars,
    executionMode: document.getElementById('api-col-mode').value,
    onFailure: document.getElementById('api-col-onfail').value,
    projectId: currentProjectId,
  };
  const method = _editingApiColId ? 'PUT' : 'POST';
  const url = _editingApiColId ? `/api/api-collections/${_editingApiColId}` : '/api/api-collections';
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    closeModal('modal-api-col');
    await apiColLoad();
  } catch (e) {
    modAlert('api-col-modal-alert', 'error', e.message);
  }
}

async function apiColDelete(id, name) {
  if (!confirm(`Delete collection "${name}"?`)) return;
  await fetch(`/api/api-collections/${id}`, { method: 'DELETE' });
  await apiColLoad();
}

const _GEN_TEST_CATEGORIES = [
  'Positive','Negative','Security','Edge','Contract',
  'Authorization','Boundary','Business Rules','Content-Type',
  'Idempotency','Token Lifecycle','Unicode'
];
const _GEN_TEST_CATEGORY_ICONS = {
  'Positive':'🟢','Negative':'🔴','Security':'🔒','Edge':'⚡','Contract':'🟣',
  'Authorization':'🛡️','Boundary':'📐','Business Rules':'📋','Content-Type':'📄',
  'Idempotency':'🔁','Token Lifecycle':'🔑','Unicode':'🌐'
};
let _genTestColId = '';
let _genTestColName = '';

function apiColGenTestsOpen(colId, colName) {
  _genTestColId = colId;
  _genTestColName = colName;
  _genTestCases = [];
  _genAssertSuggestions = [];
  const sel = document.getElementById('gen-tests-category-select');
  if (sel) sel.value = 'Negative';
  const content = document.getElementById('gen-tests-content');
  if (content) content.innerHTML = '<div style="color:var(--text-muted);padding:16px 0">Choose a category and click Suggest Tests to see recommendations.</div>';
  const title = document.getElementById('gen-tests-modal-title');
  if (title) title.textContent = '🧪 Suggest Tests — ' + colName;
  _genTestsShowSelControls(false);
  // Hide run picker on open
  const runSel = document.getElementById('gen-tests-run-select');
  if (runSel) runSel.style.display = 'none';
  openModal('modal-gen-tests');
}

// Called when category dropdown changes
async function _genTestsCategoryChanged() {
  const sel = document.getElementById('gen-tests-category-select');
  const runSel = document.getElementById('gen-tests-run-select');
  if (!sel || !runSel) return;
  if (sel.value !== '__suggest_assertions__') {
    runSel.style.display = 'none';
    return;
  }
  // Show run picker and load recent runs for this collection
  runSel.style.display = '';
  runSel.innerHTML = '<option value="">Loading runs…</option>';
  try {
    const projectQs = (typeof currentProjectId !== 'undefined' && currentProjectId) ? '&projectId=' + encodeURIComponent(currentProjectId) : '';
    const res = await fetch('/api/api-runs?collectionId=' + encodeURIComponent(_genTestColId) + projectQs);
    if (!res.ok) { runSel.innerHTML = '<option value="">Failed to load runs</option>'; return; }
    const runs = await res.json();
    const list = Array.isArray(runs) ? runs : (runs.runs || runs.results || []);
    if (!list.length) { runSel.innerHTML = '<option value="">No runs found — run the collection first</option>'; return; }
    runSel.innerHTML = list.map(function(r) {
      const d = r.startedAt ? new Date(r.startedAt).toLocaleString() : r.id;
      const status = r.status === 'passed' ? '✅' : r.status === 'failed' ? '❌' : '⏱';
      return '<option value="' + escHtml(r.id) + '">' + status + ' ' + escHtml(d) + '</option>';
    }).join('');
  } catch (e) {
    runSel.innerHTML = '<option value="">Error: ' + escHtml(e.message) + '</option>';
  }
}

let _genTestCases = [];
let _genAssertSuggestions = []; // [{stepId, stepName, assertionPayload, ...}] for assert-from-run mode

function _genTestsShowSelControls(show) {
  ['btn-gen-tests-select-all','btn-gen-tests-deselect-all','btn-gen-tests-add'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  });
  const cnt = document.getElementById('gen-tests-sel-count');
  if (cnt) cnt.textContent = '';
}

function _genTestsUpdateSelCount() {
  const checked = document.querySelectorAll('#gen-tests-content input[type=checkbox]:checked').length;
  const total   = document.querySelectorAll('#gen-tests-content input[type=checkbox]').length;
  const cnt = document.getElementById('gen-tests-sel-count');
  if (cnt) cnt.textContent = checked + ' of ' + total + ' selected';
}

function apiColGenTestsSelectAll()   { document.querySelectorAll('#gen-tests-content input[type=checkbox]').forEach(cb => cb.checked = true);  _genTestsUpdateSelCount(); }
function apiColGenTestsDeselectAll() { document.querySelectorAll('#gen-tests-content input[type=checkbox]').forEach(cb => cb.checked = false); _genTestsUpdateSelCount(); }

async function apiColGenTestsRun() {
  const sel = document.getElementById('gen-tests-category-select');
  const category = sel ? sel.value : 'Negative';
  const content  = document.getElementById('gen-tests-content');
  const aiBadge  = document.getElementById('gen-tests-ai-badge');
  if (!content) return;

  // ── Suggest Assertions from recent run ──────────────────────────────────────
  if (category === '__suggest_assertions__') {
    const runSel = document.getElementById('gen-tests-run-select');
    const runId  = runSel ? runSel.value : '';
    if (!runId) { content.innerHTML = '<div style="color:var(--warning);padding:12px 0">Select a run from the dropdown first.</div>'; return; }
    _genAssertSuggestions = [];
    _genTestCases = [];
    _genTestsShowSelControls(false);
    if (aiBadge) aiBadge.style.display = 'none';
    content.innerHTML = '<div style="color:var(--text-muted);padding:12px 0">⏳ Analysing run and generating assertion suggestions…</div>';
    try {
      // Fetch collection to know all steps and their existing assertions
      const colRes = await fetch('/api/api-collections/' + encodeURIComponent(_genTestColId));
      if (!colRes.ok) throw new Error('Could not load collection');
      const col = await colRes.json();
      const steps = col.steps || [];

      // For each step, fetch assertion suggestions from the run
      const allRows = [];
      for (const step of steps) {
        let data;
        try {
          const sRes = await fetch('/api/ai-intelligence/steps/' + encodeURIComponent(step.id) + '/suggest-assertions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ runId }),
          });
          if (!sRes.ok) continue;
          data = await sRes.json();
        } catch { continue; }

        const existingKeys = new Set((step.assertions || []).map(a => a.field + '::' + a.operator));
        const newSuggestions = (data.suggestions || []).filter(s => !existingKeys.has(s.field + '::' + s.operator));
        if (!newSuggestions.length) continue;

        newSuggestions.forEach(function(s) {
          _genAssertSuggestions.push({ stepId: step.id, stepName: step.name, suggestion: s });
          allRows.push({ stepId: step.id, stepName: step.name, suggestion: s });
        });
      }

      if (!allRows.length) {
        content.innerHTML = '<div style="color:var(--text-muted);padding:16px 0">No new assertion suggestions — all observed assertions are already added to every request.</div>';
        return;
      }

      const sevColor = { critical:'#ef4444', high:'#fb923c', medium:'#f59e0b', low:'#22c55e', soft:'#9ca3af' };
      const confColor = function(c) { return c >= 85 ? '#22c55e' : c >= 70 ? '#fb923c' : '#9ca3af'; };
      const targetLabel = { status:'Status', header:'Header', responseTime:'Resp Time', body:'Body', array:'Array', domain:'Domain' };

      const rows = allRows.map(function(row, idx) {
        const s = row.suggestion;
        const sc = sevColor[(s.assertionPayload && s.assertionPayload.severity) || 'medium'] || '#9ca3af';
        return '<tr>' +
          '<td style="width:36px;text-align:center"><input type="checkbox" class="gen-test-cb" data-idx="' + idx + '" onchange="_genTestsUpdateSelCount()"/></td>' +
          '<td style="font-size:11px;color:var(--text-muted)">' + escHtml(row.stepName) + '</td>' +
          '<td><span style="display:inline-block;padding:2px 6px;border-radius:8px;font-size:10px;font-weight:700;background:' + sc + '22;color:' + sc + '">' + escHtml((s.assertionPayload && s.assertionPayload.severity) || 'medium') + '</span></td>' +
          '<td style="font-size:11px;color:var(--text-muted)">' + escHtml(targetLabel[s.target] || s.target) + '</td>' +
          '<td style="font-family:monospace;font-size:11px">' + escHtml(s.field || '—') + '</td>' +
          '<td style="font-size:11px">' + escHtml(s.operator || '—') + '</td>' +
          '<td style="font-family:monospace;font-size:11px">' + escHtml(s.expectedValue != null ? String(s.expectedValue) : '—') + '</td>' +
          '<td style="color:' + confColor(s.confidence||0) + ';font-size:11px;font-weight:600">' + (s.confidence||0) + '%</td>' +
          '<td style="font-size:11px;color:var(--text-muted);max-width:180px;white-space:normal">' + escHtml(s.rationale || '') + '</td>' +
          '</tr>';
      }).join('');

      content.innerHTML =
        '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px"><strong>' + allRows.length + '</strong> new assertion suggestion' + (allRows.length !== 1 ? 's' : '') + ' across <strong>' + new Set(allRows.map(r => r.stepId)).size + '</strong> request' + (new Set(allRows.map(r => r.stepId)).size !== 1 ? 's' : '') + '</div>' +
        '<div style="overflow:auto;max-height:420px">' +
          '<table class="data-table">' +
            '<thead><tr><th style="width:36px"></th><th>Request</th><th>Severity</th><th>Type</th><th>Field</th><th>Operator</th><th>Expected</th><th>Confidence</th><th>Rationale</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>';

      _genTestsShowSelControls(true);
      _genTestsUpdateSelCount();
    } catch (e) {
      content.innerHTML = '<div style="color:#ef4444">Error: ' + escHtml(e.message) + '</div>';
    }
    return; // skip regular test generation below
  }
  // ── End Suggest Assertions ──────────────────────────────────────────────────

  _genTestCases = [];
  _genAssertSuggestions = [];
  _genTestsShowSelControls(false);
  if (aiBadge) aiBadge.style.display = 'none';
  content.innerHTML = '<div style="color:var(--text-muted);padding:12px 0">⏳ Generating <strong>' + escHtml(category) + '</strong> tests… this may take a few seconds if AI is enabled.</div>';

  try {
    const col = _apiCols.find(c => c.id === _genTestColId);
    const env = col ? _apiColEnvs.find(e => e.id === col.environmentId) : null;
    const baseUrl = env ? (env.baseUrl || '') : '';

    const res = await fetch('/api/ai-intelligence/collections/' + encodeURIComponent(_genTestColId) + '/generate-tests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, baseUrl }),
    });
    if (!res.ok) { content.innerHTML = '<div style="color:#ef4444">Failed: ' + res.status + '</div>'; return; }

    const suite = await res.json();
    _genTestCases = suite.cases || [];

    if (!_genTestCases.length) {
      content.innerHTML = '<div style="color:var(--text-muted);padding:16px 0">No test suggestions generated. The collection may have no requests with request bodies.</div>';
      return;
    }

    // Show AI badge if enhanced
    if (suite.aiEnhanced && aiBadge) aiBadge.style.display = '';

    // Show advisory note from backend if present
    const advisory = suite.aiError
      ? '<div class="advisory-banner advisory-banner-warn" style="margin-bottom:10px">ℹ️ ' + escHtml(suite.aiError) + '</div>'
      : '';

    const sevColor = { low:'#22c55e', medium:'#f59e0b', high:'#ef4444', critical:'#7c3aed' };

    const rows = _genTestCases.map(function(c, idx) {
      const sc  = sevColor[c.severity] || '#9ca3af';
      const exp = (c.expectedStatusCodes || []).join(', ');
      return '<tr>' +
        '<td style="width:36px;text-align:center"><input type="checkbox" class="gen-test-cb" data-idx="' + idx + '" onchange="_genTestsUpdateSelCount()"/></td>' +
        '<td><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:' + sc + '22;color:' + sc + '">' + escHtml(c.severity) + '</span></td>' +
        '<td style="font-size:11px;color:var(--text-muted)">' + escHtml(c.stepName) + '</td>' +
        '<td>' +
          '<div style="font-size:12px;font-weight:600">' + escHtml(c.title) + '</div>' +
          (c.description ? '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escHtml(c.description) + '</div>' : '') +
        '</td>' +
        '<td style="font-size:11px;text-align:center"><code>' + escHtml(exp) + '</code></td>' +
        '<td style="font-size:11px;color:var(--text-muted);max-width:220px">' + escHtml(c.expectedBehavior) + '</td>' +
        '</tr>';
    }).join('');

    content.innerHTML =
      advisory +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">' +
        '<strong>' + _genTestCases.length + '</strong> suggestions for <strong>' + escHtml(category) + '</strong>' +
        (suite.aiProvider ? ' <span style="color:var(--accent);font-size:11px">via ' + escHtml(suite.aiProvider) + '</span>' : '') +
      '</div>' +
      '<div style="overflow:auto;max-height:420px">' +
        '<table class="data-table">' +
          '<thead><tr><th style="width:36px"></th><th>Severity</th><th>Request</th><th>Test Description</th><th>Expected Status</th><th>What to verify</th></tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>';

    _genTestsShowSelControls(true);
    _genTestsUpdateSelCount();
  } catch (e) {
    content.innerHTML = '<div style="color:#ef4444">Error: ' + escHtml(e.message) + '</div>';
  }
}

async function apiColGenTestsAddSelected() {
  const checked = Array.from(document.querySelectorAll('#gen-tests-content input[type=checkbox]:checked'));
  if (!checked.length) { alert('Select at least one item to add.'); return; }
  const btn = document.getElementById('btn-gen-tests-add');
  if (btn) { btn.textContent = '⏳ Adding…'; btn.disabled = true; }

  // ── Mode: Add assertion suggestions ─────────────────────────────────────────
  if (_genAssertSuggestions.length) {
    const selected = checked.map(cb => _genAssertSuggestions[parseInt(cb.dataset.idx)]);
    try {
      const colRes = await fetch('/api/api-collections/' + encodeURIComponent(_genTestColId));
      if (!colRes.ok) throw new Error('Could not load collection');
      const col = await colRes.json();
      let addedCount = 0;
      selected.forEach(function(row) {
        const step = (col.steps || []).find(function(s) { return s.id === row.stepId; });
        if (!step) return;
        if (!Array.isArray(step.assertions)) step.assertions = [];
        const p = row.suggestion.assertionPayload;
        if (!p) return;
        const already = step.assertions.some(function(a) { return a.field === p.field && a.operator === p.operator; });
        if (already) return;
        step.assertions.push({ field: p.field, operator: p.operator, expected: p.expected, severity: p.severity || 'high', weight: p.weight || 7 });
        addedCount++;
      });
      const saveRes = await fetch('/api/api-collections/' + encodeURIComponent(_genTestColId), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(col),
      });
      if (!saveRes.ok) throw new Error('Save failed (' + saveRes.status + ')');
      closeModal('modal-gen-tests');
      modAlert('api-col-list-alert', 'success', addedCount + ' assertion' + (addedCount !== 1 ? 's' : '') + ' added to collection requests.');
      await apiColLoad();
    } catch (e) {
      modAlert('api-col-list-alert', 'error', e.message);
    } finally {
      if (btn) { btn.textContent = '+ Add Selected to Collection'; btn.disabled = false; }
    }
    return;
  }

  // ── Mode: Add test cases (existing behaviour) ────────────────────────────────
  const selectedCases = checked.map(cb => _genTestCases[parseInt(cb.dataset.idx)]);
  try {
    const res = await fetch('/api/api-collections/' + encodeURIComponent(_genTestColId) + '/add-steps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: selectedCases.map(c => ({
        id: '', name: c.title,
        request: {
          method:  c.suggestedRequest?.method  ?? 'GET',
          url:     c.suggestedRequest?.url     ?? '',
          headers: c.suggestedRequest?.headers ?? {},
          body:    c.suggestedRequest?.body    ?? null,
        },
        assertions: (c.assertions ?? []).map(a => ({ type: 'status', operator: 'equals', value: String(c.expectedStatusCodes?.[0] ?? 200), message: a })),
        variables: [],
      })) }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Add failed'); }
    const data = await res.json();
    const cnt = data.addedCount ?? selectedCases.length;
    closeModal('modal-gen-tests');
    modAlert('api-col-list-alert', 'success', cnt + ' test request' + (cnt !== 1 ? 's' : '') + ' added to collection.');
    await apiColLoad();
  } catch (e) {
    modAlert('api-col-list-alert', 'error', e.message);
  } finally {
    if (btn) { btn.textContent = '+ Add Selected to Collection'; btn.disabled = false; }
  }
}

// ── Try a Request — standalone Postman-style request builder ──────────────────

let _tryReqLastResult = null;  // last successful send result

function apiColTryRequestOpen(preselectColId) {
  _tryReqLastResult = null;

  // Reset request fields
  document.getElementById('try-req-method').value = 'GET';
  document.getElementById('try-req-url').value = '';
  document.getElementById('try-req-headers').value = '';
  document.getElementById('try-req-body').value = '';

  // Populate environment selector
  const envSel = document.getElementById('try-req-env');
  if (envSel) {
    const preEnvId = preselectColId ? (_apiCols.find(c => c.id === preselectColId)?.environmentId ?? '') : '';
    envSel.innerHTML = '<option value="">— No environment —</option>' +
      _apiColEnvs.map(e => `<option value="${e.id}"${e.id === preEnvId ? ' selected' : ''}>${escHtml(e.name)}</option>`).join('');
  }

  // Populate "Load from collection step" — collection dropdown
  const colSel = document.getElementById('try-req-col-select');
  if (colSel) {
    colSel.innerHTML = '<option value="">— choose a collection —</option>' +
      _apiCols.map(c => `<option value="${c.id}"${c.id === preselectColId ? ' selected' : ''}>${escHtml(c.name)}</option>`).join('');
    if (preselectColId) {
      _tryReqPopulateSteps(preselectColId);
    } else {
      const stepSel = document.getElementById('try-req-step-select');
      if (stepSel) { stepSel.innerHTML = '<option value="">— choose a step —</option>'; stepSel.disabled = true; }
    }
  }

  // Populate "Save to collection" dropdown in footer
  const saveSel = document.getElementById('try-req-save-col');
  if (saveSel) {
    saveSel.innerHTML = '<option value="">— choose a collection —</option>' +
      _apiCols.map(c => `<option value="${c.id}"${c.id === preselectColId ? ' selected' : ''}>${escHtml(c.name)}</option>`).join('');
  }

  // Reset save name
  const nameEl = document.getElementById('try-req-save-name');
  if (nameEl) nameEl.value = '';

  // Reset response / error
  document.getElementById('try-req-response').style.display = 'none';
  document.getElementById('try-req-loading').style.display = 'none';
  document.getElementById('try-req-error').style.display = 'none';
  document.getElementById('try-req-save-row').style.display = 'none';

  _tryReqTab('headers');
  _tryRespTab('body');
  openModal('modal-try-request');
}

function _tryReqPopulateSteps(colId) {
  const stepSel = document.getElementById('try-req-step-select');
  if (!stepSel) return;
  const col = _apiCols.find(c => c.id === colId);
  if (!col || !(col.steps || []).length) {
    stepSel.innerHTML = '<option value="">— no requests in this collection —</option>';
    stepSel.disabled = true;
    return;
  }
  stepSel.innerHTML = '<option value="">— choose a request to pre-fill —</option>' +
    col.steps.map((s, i) =>
      `<option value="${i}">${i + 1}. ${escHtml(s.request?.method ?? 'GET')} ${escHtml(s.request?.url ?? s.name ?? '')}</option>`
    ).join('');
  stepSel.disabled = false;
}

function _tryReqColSelected() {
  const colId = document.getElementById('try-req-col-select')?.value ?? '';
  _tryReqPopulateSteps(colId);
  // Also sync environment
  if (colId) {
    const col = _apiCols.find(c => c.id === colId);
    if (col && col.environmentId) {
      const envSel = document.getElementById('try-req-env');
      if (envSel) envSel.value = col.environmentId;
    }
  }
}

function _tryReqStepSelected() {
  const colId   = document.getElementById('try-req-col-select')?.value ?? '';
  const stepIdx = document.getElementById('try-req-step-select')?.value;
  if (!colId || stepIdx === '' || stepIdx === undefined) return;
  const col  = _apiCols.find(c => c.id === colId);
  if (!col) return;
  const step = col.steps[parseInt(stepIdx)];
  if (!step) return;

  // Pre-fill method + URL
  document.getElementById('try-req-method').value = step.request?.method ?? 'GET';
  document.getElementById('try-req-url').value    = step.request?.url ?? '';

  // Pre-fill headers
  const hdrs = step.request?.headers ?? {};
  document.getElementById('try-req-headers').value = Object.entries(hdrs).map(([k, v]) => k + ': ' + v).join('\n');

  // Pre-fill body
  const body = step.request?.body;
  document.getElementById('try-req-body').value = body ? (typeof body === 'string' ? body : JSON.stringify(body, null, 2)) : '';

  // Pre-fill save name
  const nameEl = document.getElementById('try-req-save-name');
  if (nameEl && !nameEl.value) nameEl.value = step.name || '';
}

function _tryReqTab(tab) {
  ['headers','body'].forEach(t => {
    document.getElementById('try-req-panel-' + t).style.display = t === tab ? '' : 'none';
    const btn = document.getElementById('try-req-tab-' + t);
    if (btn) btn.classList.toggle('try-req-tab-active', t === tab);
  });
}

function _tryRespTab(tab) {
  ['body','headers'].forEach(t => {
    document.getElementById('try-resp-panel-' + t).style.display = t === tab ? '' : 'none';
    const btn = document.getElementById('try-resp-tab-' + t);
    if (btn) btn.classList.toggle('try-req-tab-active', t === tab);
  });
}

async function apiColTryRequestSend() {
  const method  = document.getElementById('try-req-method').value;
  const url     = document.getElementById('try-req-url').value.trim();
  const envId   = document.getElementById('try-req-env')?.value ?? '';
  const rawHdrs = document.getElementById('try-req-headers').value.trim();
  const rawBody = document.getElementById('try-req-body').value.trim();

  const errEl = document.getElementById('try-req-error');
  if (!url) { errEl.style.display = ''; errEl.textContent = 'Please enter a URL before sending.'; return; }

  errEl.style.display = 'none';
  document.getElementById('try-req-response').style.display = 'none';
  document.getElementById('try-req-save-row').style.display = 'none';
  document.getElementById('try-req-loading').style.display = '';

  // Parse headers from textarea lines
  const headers = {};
  rawHdrs.split('\n').forEach(line => {
    const colon = line.indexOf(':');
    if (colon > 0) headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  });

  try {
    const res = await fetch('/api/api-collections/try-request', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, url, headers, body: rawBody || null, environmentId: envId || null }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');

    document.getElementById('try-req-loading').style.display = 'none';

    // Detect unresolved variables in resolvedUrl AND resolvedRequestHeaders
    const varWarn = document.getElementById('try-req-var-warn');
    if (varWarn) {
      const urlUnresolved  = (data.resolvedUrl || '').match(/\{\{(\w+)\}\}/g) || [];
      const hdrUnresolved  = Object.values(data.resolvedRequestHeaders || {}).flatMap(v => (v || '').match(/\{\{(\w+)\}\}/g) || []);
      const allUnresolved  = [...new Set([...urlUnresolved, ...hdrUnresolved])];
      // Also detect decryption failure (sensitive var decryption returns '***' on error)
      const decryptFailed  = Object.entries(data.resolvedRequestHeaders || {})
        .filter(([, v]) => typeof v === 'string' && v.includes('***'))
        .map(([k]) => k);
      if (allUnresolved.length || decryptFailed.length) {
        varWarn.style.display = '';
        const msgs = [];
        if (allUnresolved.length) msgs.push('Unresolved variables: ' + allUnresolved.join(', ') + ' — add these keys to the selected Environment.');
        if (decryptFailed.length) msgs.push('Decryption failed for header(s): ' + decryptFailed.join(', ') + ' — re-save the sensitive variable in Admin → Environments.');
        varWarn.textContent = '⚠ ' + msgs.join(' | ');
      } else {
        varWarn.style.display = 'none';
      }
    }

    // ── Status 0 = backend-level error (invalid URL, timeout, connection refused) ──
    if (data.status === 0) {
      const badge = document.getElementById('try-req-status-badge');
      badge.className = 'try-req-status-badge try-req-status-err';
      badge.textContent = '0 Network Error';
      document.getElementById('try-req-latency').textContent = data.durationMs ? data.durationMs + ' ms' : '';

      // Show the actual error message in the body panel + hint about unresolved vars
      let errBody = '⚠ Request could not be sent.\n\n';
      if (data.error) errBody += 'Error: ' + data.error + '\n\n';
      if (data.resolvedUrl) errBody += 'Resolved URL: ' + data.resolvedUrl + '\n\n';
      errBody += 'Common causes:\n';
      errBody += '• URL still contains {{variables}} — make sure the selected Environment has those variable keys defined.\n';
      errBody += '• The server is unreachable (connection refused / timeout).\n';
      errBody += '• HTTPS certificate error on a self-signed cert.\n';
      document.getElementById('try-req-res-body').textContent = errBody;
      document.getElementById('try-req-res-headers').textContent = '';
      document.getElementById('try-req-response').style.display = '';
      document.getElementById('try-req-save-row').style.display = 'none';
      _tryRespTab('body');
      return;
    }

    _tryReqLastResult = { method, url, headers, body: rawBody || null, environmentId: envId || null, response: data };

    // Status badge
    const badge = document.getElementById('try-req-status-badge');
    const isOk  = data.status >= 200 && data.status < 300;
    badge.className = 'try-req-status-badge ' + (isOk ? 'try-req-status-ok' : data.status >= 400 ? 'try-req-status-err' : 'try-req-status-redir');
    badge.textContent = data.status + (data.statusText ? ' ' + data.statusText : '');
    document.getElementById('try-req-latency').textContent = data.durationMs ? data.durationMs + ' ms' : '';

    // Resolved URL hint (shown when different from input — variables were substituted)
    if (data.resolvedUrl && data.resolvedUrl !== url) {
      document.getElementById('try-req-latency').textContent +=
        '  ·  🔗 ' + data.resolvedUrl.slice(0, 80) + (data.resolvedUrl.length > 80 ? '…' : '');
    }

    // Body — pretty-print if JSON
    const rawBodyVal = typeof data.body === 'string' ? data.body : (data.bodyRaw ?? '');
    let bodyText = rawBodyVal;
    if (typeof data.body === 'object' && data.body !== null) {
      bodyText = JSON.stringify(data.body, null, 2);
    } else {
      try { bodyText = JSON.stringify(JSON.parse(rawBodyVal), null, 2); } catch { /* keep raw */ }
    }
    document.getElementById('try-req-res-body').textContent = bodyText || '(empty response body)';

    // Response headers
    const respHdrs = data.headers || {};
    document.getElementById('try-req-res-headers').textContent =
      Object.entries(respHdrs).map(([k, v]) => k + ': ' + v).join('\n') || '(no headers)';

    document.getElementById('try-req-response').style.display = '';
    document.getElementById('try-req-save-row').style.display = 'flex';
    _tryRespTab('body');
  } catch (e) {
    document.getElementById('try-req-loading').style.display = 'none';
    errEl.style.display = '';
    errEl.textContent = e.message;
  }
}

async function apiColTryRequestSave() {
  if (!_tryReqLastResult) return;
  const targetColId = document.getElementById('try-req-save-col')?.value;
  if (!targetColId) { alert('Please select a collection to save into.'); return; }

  const r        = _tryReqLastResult;
  const nameEl   = document.getElementById('try-req-save-name');
  const stepName = (nameEl?.value.trim()) || (r.method + ' ' + r.url).slice(0, 60);

  try {
    const res = await fetch('/api/api-collections/' + encodeURIComponent(targetColId) + '/add-steps', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: [{
        id: '', name: stepName,
        request: { method: r.method, url: r.url, headers: r.headers || {}, body: r.body || null },
        assertions: [{ type: 'status', operator: 'equals', value: String(r.response?.status ?? 200), message: '' }],
        variables: [],
      }] }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Save failed'); }
    closeModal('modal-try-request');
    modAlert('api-col-list-alert', 'success', `"${stepName}" saved to collection.`);
    await apiColLoad();
  } catch (e) {
    modAlert('api-col-list-alert', 'error', e.message);
  }
}

async function apiColRun(id) {
  // OLD: direct run without data file dialog — kept as fallback, main path now uses _apiColRunOpen
  const col = _apiCols.find(c => c.id === id);
  if (!col) return;
  try {
    const res = await fetch(`/api/api-collections/${id}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: currentProjectId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Run failed');
    modAlert('api-col-list-alert', 'success', `Run started — ID: ${data.runId || data.id}`);
    if (typeof apiRunsLoad === 'function') apiRunsLoad(id, data.runId || data.id);
  } catch (e) {
    modAlert('api-col-list-alert', 'error', e.message);
  }
}

// ── Run Dialog (Data File Runner) ─────────────────────────────────────────────

let _apiRunDialogColId = null;
let _apiRunDialogFileId = null;   // currently selected saved file id
let _apiRunDialogFileName = null; // display name
let _apiRunDialogRows = 0;
let _apiRunDialogColumns = [];

function _apiColRunOpen(id) {
  const col = _apiCols.find(c => c.id === id);
  if (!col) return;
  _apiRunDialogColId = id;
  _apiRunDialogFileId = null;
  _apiRunDialogFileName = null;
  _apiRunDialogRows = 0;
  _apiRunDialogColumns = [];

  // Build modal HTML if not present
  if (!document.getElementById('modal-api-run-dialog')) {
    const div = document.createElement('div');
    div.innerHTML = `
<div id="modal-api-run-dialog" class="modal-backdrop" style="display:none;z-index:1200">
  <div class="modal-box" style="max-width:600px">
    <div class="modal-header">
      <h3 id="run-dlg-title">▶ Run Collection</h3>
      <button class="modal-close" onclick="_apiColRunClose()">✕</button>
    </div>
    <div class="modal-body" style="padding:16px">
      <div style="margin-bottom:16px">
        <label style="font-weight:600;display:block;margin-bottom:6px">📂 Data File <span style="font-weight:400;color:var(--text-muted)">(optional — runs once per row)</span></label>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <select id="run-dlg-file-select" style="flex:1" onchange="_apiRunDlgSelectFile(this.value)">
            <option value="">— select a saved file or upload new —</option>
          </select>
          <button class="tbl-btn" onclick="_apiRunDlgUploadClick()" title="Upload new CSV / JSON">⬆ Upload</button>
          <input type="file" id="run-dlg-file-input" accept=".csv,.json" style="display:none" onchange="_apiRunDlgFileChosen(this)">
        </div>
        <div id="run-dlg-file-preview" style="display:none;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:10px;font-size:13px">
          <div id="run-dlg-file-info" style="margin-bottom:6px;color:var(--text-muted)"></div>
          <div id="run-dlg-preview-table"></div>
          <div style="margin-top:8px;display:flex;align-items:center;gap:8px">
            <label style="font-size:12px;font-weight:600">Save as:</label>
            <input id="run-dlg-save-name" type="text" class="form-input" style="flex:1;padding:3px 6px;font-size:12px" placeholder="Name for reuse…">
            <button class="tbl-btn" onclick="_apiRunDlgSaveFile()" id="run-dlg-save-btn">💾 Save</button>
          </div>
          <button class="tbl-btn del" onclick="_apiRunDlgClearFile()" style="margin-top:6px;font-size:11px">✕ Remove file</button>
        </div>
      </div>
      <div style="margin-bottom:14px;display:flex;align-items:center;gap:10px">
        <label style="font-weight:600;font-size:13px">If a row fails:</label>
        <select id="run-dlg-stop-on-fail" style="font-size:13px">
          <option value="false">Continue to next row</option>
          <option value="true">Stop</option>
        </select>
      </div>
      <div id="run-dlg-iteration-note" style="display:none;color:var(--accent);font-size:13px;margin-bottom:12px"></div>
      <div id="run-dlg-uploading" style="display:none;color:var(--text-muted);font-size:13px">⏳ Uploading…</div>
      <div id="run-dlg-error" style="display:none;color:var(--danger);font-size:13px"></div>
    </div>
    <div class="modal-footer">
      <button class="btn-secondary" onclick="_apiColRunClose()">Cancel</button>
      <button class="btn-primary" id="run-dlg-run-btn" onclick="_apiColRunExecute()">▶ Run Collection</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);
  }

  document.getElementById('run-dlg-title').textContent = `▶ Run — ${col.name}`;
  document.getElementById('run-dlg-file-preview').style.display = 'none';
  document.getElementById('run-dlg-iteration-note').style.display = 'none';
  document.getElementById('run-dlg-error').style.display = 'none';
  document.getElementById('run-dlg-run-btn').textContent = '▶ Run Collection';
  document.getElementById('run-dlg-save-name').value = '';

  _apiRunDlgLoadSavedFiles();
  document.getElementById('modal-api-run-dialog').style.display = 'flex';
}

function _apiColRunClose() {
  const m = document.getElementById('modal-api-run-dialog');
  if (m) m.style.display = 'none';
}

async function _apiRunDlgLoadSavedFiles() {
  if (!currentProjectId) return;
  try {
    const res = await fetch(`/api/data-files?projectId=${encodeURIComponent(currentProjectId)}`);
    const files = res.ok ? await res.json() : [];
    const sel = document.getElementById('run-dlg-file-select');
    sel.innerHTML = '<option value="">— select a saved file or upload new —</option>';
    for (const f of files) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = `${f.name} (${f.rowCount} rows — ${(f.columns||[]).join(', ')})`;
      sel.appendChild(opt);
    }
    // Re-select previously chosen file
    if (_apiRunDialogFileId) sel.value = _apiRunDialogFileId;
  } catch { /* ignore */ }
}

async function _apiRunDlgSelectFile(fileId) {
  if (!fileId) {
    _apiRunDialogFileId = null;
    document.getElementById('run-dlg-file-preview').style.display = 'none';
    document.getElementById('run-dlg-iteration-note').style.display = 'none';
    document.getElementById('run-dlg-run-btn').textContent = '▶ Run Collection';
    return;
  }
  try {
    const res = await fetch(`/api/data-files/${encodeURIComponent(fileId)}`);
    if (!res.ok) throw new Error('Not found');
    const data = await res.json();
    _apiRunDialogFileId = data.id;
    _apiRunDialogFileName = data.name;
    _apiRunDialogRows = data.rowCount;
    _apiRunDialogColumns = data.columns || [];
    _apiRunDlgShowPreview(data);
  } catch (e) {
    _apiRunDlgShowError('Failed to load file: ' + e.message);
  }
}

function _apiRunDlgShowPreview(data) {
  const preview = data.preview || (data.rows || []).slice(0, 3);
  const cols = data.columns || [];
  let tbl = `<div style="color:var(--text-muted);font-size:12px;margin-bottom:4px">✔ ${data.rowCount} rows — columns: <strong>${cols.join(' | ')}</strong></div>`;
  if (preview.length && cols.length) {
    tbl += `<table style="width:100%;font-size:11px;border-collapse:collapse"><thead><tr>`;
    for (const c of cols) tbl += `<th style="border:1px solid var(--border);padding:3px 6px;background:var(--bg-accent)">${escHtml(c)}</th>`;
    tbl += '</tr></thead><tbody>';
    for (const row of preview) {
      tbl += '<tr>';
      for (const c of cols) tbl += `<td style="border:1px solid var(--border);padding:3px 6px">${escHtml(String(row[c] ?? ''))}</td>`;
      tbl += '</tr>';
    }
    tbl += '</tbody></table>';
  }
  document.getElementById('run-dlg-file-info').innerHTML = '';
  document.getElementById('run-dlg-preview-table').innerHTML = tbl;
  document.getElementById('run-dlg-file-preview').style.display = '';
  document.getElementById('run-dlg-save-name').value = data.name || '';

  const note = document.getElementById('run-dlg-iteration-note');
  note.textContent = `ℹ️  Collection will run ${data.rowCount} time${data.rowCount !== 1 ? 's' : ''} total.`;
  note.style.display = '';
  document.getElementById('run-dlg-run-btn').textContent = `▶ Run Collection × ${data.rowCount}`;
}

function _apiRunDlgUploadClick() {
  document.getElementById('run-dlg-file-input')?.click();
}

async function _apiRunDlgFileChosen(input) {
  const file = input.files?.[0];
  if (!file) return;
  const uploading = document.getElementById('run-dlg-uploading');
  const errEl = document.getElementById('run-dlg-error');
  errEl.style.display = 'none';
  uploading.style.display = '';

  try {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('projectId', currentProjectId || '');
    fd.append('name', file.name.replace(/\.[^.]+$/, ''));
    // If replacing a previously uploaded (unsaved) file, pass replaceId
    if (_apiRunDialogFileId && !document.getElementById('run-dlg-file-select').value) {
      fd.append('replaceId', _apiRunDialogFileId);
    }
    const res = await fetch('/api/data-files/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    _apiRunDialogFileId = data.id;
    _apiRunDialogFileName = data.name;
    _apiRunDialogRows = data.rowCount;
    _apiRunDialogColumns = data.columns || [];

    document.getElementById('run-dlg-save-name').value = data.name || '';
    _apiRunDlgShowPreview(data);
    // Add to dropdown
    const sel = document.getElementById('run-dlg-file-select');
    let opt = sel.querySelector(`option[value="${data.id}"]`);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = data.id;
      sel.appendChild(opt);
    }
    opt.textContent = `${data.name} (${data.rowCount} rows)`;
    sel.value = data.id;
  } catch (e) {
    _apiRunDlgShowError(e.message);
  } finally {
    uploading.style.display = 'none';
    input.value = '';
  }
}

async function _apiRunDlgSaveFile() {
  if (!_apiRunDialogFileId) return;
  const name = document.getElementById('run-dlg-save-name').value.trim();
  if (!name) { _apiRunDlgShowError('Enter a name before saving.'); return; }
  try {
    const res = await fetch(`/api/data-files/${encodeURIComponent(_apiRunDialogFileId)}/name`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error('Rename failed');
    _apiRunDialogFileName = name;
    const sel = document.getElementById('run-dlg-file-select');
    const opt = sel.querySelector(`option[value="${_apiRunDialogFileId}"]`);
    if (opt) opt.textContent = `${name} (${_apiRunDialogRows} rows)`;
  } catch (e) {
    _apiRunDlgShowError(e.message);
  }
}

function _apiRunDlgClearFile() {
  _apiRunDialogFileId = null;
  _apiRunDialogFileName = null;
  _apiRunDialogRows = 0;
  _apiRunDialogColumns = [];
  document.getElementById('run-dlg-file-select').value = '';
  document.getElementById('run-dlg-file-preview').style.display = 'none';
  document.getElementById('run-dlg-iteration-note').style.display = 'none';
  document.getElementById('run-dlg-run-btn').textContent = '▶ Run Collection';
}

function _apiRunDlgShowError(msg) {
  const el = document.getElementById('run-dlg-error');
  el.textContent = msg;
  el.style.display = '';
}

async function _apiColRunExecute() {
  if (!_apiRunDialogColId) return;
  const runBtn = document.getElementById('run-dlg-run-btn');
  runBtn.disabled = true;
  runBtn.textContent = 'Starting…';
  document.getElementById('run-dlg-error').style.display = 'none';

  try {
    const stopOnFailure = document.getElementById('run-dlg-stop-on-fail').value === 'true';
    const body = { projectId: currentProjectId };
    if (_apiRunDialogFileId) {
      body.dataFileId = _apiRunDialogFileId;
      body.stopOnFailure = stopOnFailure;
    }
    const res = await fetch(`/api/api-collections/${_apiRunDialogColId}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Run failed');
    _apiColRunClose();
    modAlert('api-col-list-alert', 'success', `Run started — ID: ${data.runId || data.id}`);
    if (typeof apiRunsLoad === 'function') apiRunsLoad(_apiRunDialogColId, data.runId || data.id);
  } catch (e) {
    _apiRunDlgShowError(e.message);
    runBtn.disabled = false;
    runBtn.textContent = _apiRunDialogRows > 0 ? `▶ Run Collection × ${_apiRunDialogRows}` : '▶ Run Collection';
  }
}

async function apiColPrescan(id) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  try {
    const res = await fetch(`/api/api-collections/${id}/pre-scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: currentProjectId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Pre-scan failed');
    _apiColShowPrescanResults(data.results || data);
  } catch (e) {
    modAlert('api-col-list-alert', 'error', e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pre-scan';
  }
}

function _apiColShowPrescanResults(results) {
  const content = document.getElementById('api-prescan-content');
  if (!content) return;
  if (!Array.isArray(results) || results.length === 0) {
    content.innerHTML = '<p style="color:var(--text-muted);padding:8px">No results returned.</p>';
    openModal('modal-api-prescan');
    return;
  }
  const rows = results.map(r => {
    const score = r.healthScore ?? 0;
    const color = score >= 80 ? '#22c55e' : score >= 50 ? '#f59e0b' : '#ef4444';
    return `<tr>
      <td>${escHtml(r.stepName ?? r.name ?? '')}</td>
      <td style="font-weight:700;color:${color}">${score}</td>
      <td>${r.durationMs != null ? r.durationMs + 'ms' : '—'}</td>
      <td>${r.status === 'error' ? `<span style="color:#ef4444">${escHtml(r.error ?? 'error')}</span>` : escHtml(r.status ?? '')}</td>
    </tr>`;
  }).join('');
  content.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Request</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Health</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Duration</th>
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  openModal('modal-api-prescan');
}

// ── Import flows ─────────────────────────────────────────────────────────────

function apiColImportOpenApiModal() {
  document.getElementById('api-import-openapi-env').innerHTML = _apiColEnvs.map(e => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('');
  document.getElementById('api-import-openapi-tag').value = '';
  document.getElementById('api-import-openapi-spec').value = '';
  document.getElementById('api-import-openapi-alert').innerHTML = '';
  openModal('modal-api-import-openapi');
}

function apiColImportSwaggerUrlModal() {
  document.getElementById('api-import-swagger-url-env').innerHTML = _apiColEnvs.map(e => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('');
  document.getElementById('api-import-swagger-url-tag').value = '';
  document.getElementById('api-import-swagger-url-input').value = '';
  document.getElementById('api-import-swagger-url-alert').innerHTML = '';
  openModal('modal-api-import-swagger-url');
}

function apiColImportPostmanModal() {
  document.getElementById('api-import-postman-env').innerHTML = _apiColEnvs.map(e => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('');
  document.getElementById('api-import-postman-json').value = '';
  document.getElementById('api-import-postman-alert').innerHTML = '';
  openModal('modal-api-import-postman');
}

function apiColImportCurlModal() {
  document.getElementById('api-import-curl-env').innerHTML = _apiColEnvs.map(e => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('');
  document.getElementById('api-import-curl-cmd').value = '';
  document.getElementById('api-import-curl-alert').innerHTML = '';
  openModal('modal-api-import-curl');
}

async function apiColImportOpenApi() {
  const specContent = document.getElementById('api-import-openapi-spec').value.trim();
  const environmentId = document.getElementById('api-import-openapi-env').value;
  const tag = document.getElementById('api-import-openapi-tag').value.trim() || undefined;
  if (!specContent) { modAlert('api-import-openapi-alert', 'error', 'Paste a spec first'); return; }
  if (!environmentId) { modAlert('api-import-openapi-alert', 'error', 'Select an environment'); return; }
  try {
    const res = await fetch('/api/api-collections/import/openapi', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specContent, environmentId, tag, projectId: currentProjectId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    await _apiColImportConfirm(data, 'modal-api-import-openapi', 'api-import-openapi-alert');
  } catch (e) {
    modAlert('api-import-openapi-alert', 'error', e.message);
  }
}

async function apiColImportSwaggerUrlConfirm() {
  const url = document.getElementById('api-import-swagger-url-input').value.trim();
  const environmentId = document.getElementById('api-import-swagger-url-env').value;
  const tag = document.getElementById('api-import-swagger-url-tag').value.trim() || undefined;
  if (!url) { modAlert('api-import-swagger-url-alert', 'error', 'Enter a URL'); return; }
  if (!environmentId) { modAlert('api-import-swagger-url-alert', 'error', 'Select an environment'); return; }
  const btn = document.getElementById('api-import-swagger-url-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching...'; }
  try {
    const fetchRes = await fetch('/api/api-collections/import/openapi-url', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, environmentId, tag, projectId: currentProjectId }),
    });
    const data = await fetchRes.json();
    if (!fetchRes.ok) throw new Error(data.error || 'Import failed');
    await _apiColImportConfirm(data, 'modal-api-import-swagger-url', 'api-import-swagger-url-alert');
  } catch (e) {
    modAlert('api-import-swagger-url-alert', 'error', e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Fetch & Import'; }
  }
}

async function apiColImportPostman() {
  const collectionJson = document.getElementById('api-import-postman-json').value.trim();
  const environmentId = document.getElementById('api-import-postman-env').value;
  if (!collectionJson) { modAlert('api-import-postman-alert', 'error', 'Paste Postman JSON first'); return; }
  if (!environmentId) { modAlert('api-import-postman-alert', 'error', 'Select an environment'); return; }
  try {
    const res = await fetch('/api/api-collections/import/postman', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collectionJson, environmentId, projectId: currentProjectId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    await _apiColImportConfirm(data, 'modal-api-import-postman', 'api-import-postman-alert');
  } catch (e) {
    modAlert('api-import-postman-alert', 'error', e.message);
  }
}

async function apiColImportCurl() {
  const curlCommand = document.getElementById('api-import-curl-cmd').value.trim();
  const environmentId = document.getElementById('api-import-curl-env').value;
  if (!curlCommand) { modAlert('api-import-curl-alert', 'error', 'Enter a cURL command'); return; }
  if (!environmentId) { modAlert('api-import-curl-alert', 'error', 'Select an environment'); return; }
  try {
    const res = await fetch('/api/api-collections/import/curl', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ curlCommand, environmentId, projectId: currentProjectId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Import failed');
    // cURL returns a single step — wrap in a new collection
    const col = { name: data.name, environmentId, steps: [data], variables: [], onFailure: 'continue', executionMode: 'sequential', tags: [], projectId: currentProjectId };
    await _apiColImportConfirm(col, 'modal-api-import-curl', 'api-import-curl-alert');
  } catch (e) {
    modAlert('api-import-curl-alert', 'error', e.message);
  }
}

async function _apiColImportConfirm(col, modalId, alertId) {
  try {
    const res = await fetch('/api/api-collections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...col, projectId: col.projectId ?? currentProjectId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    closeModal(modalId);
    await apiColLoad();
    modAlert('api-col-list-alert', 'success', `Collection "${col.name}" imported (${col.steps?.length ?? 0} requests)`);
  } catch (e) {
    modAlert(alertId, 'error', e.message);
  }
}

function apiColCloseModal() { closeModal('modal-api-col'); _editingApiColId = null; }
function apiPrescanCloseModal() { closeModal('modal-api-prescan'); }

// ── API Collections — Graph View (Phase D Step 6) ────────────────────────────
// Read-only workflow visualization using Cytoscape.js.
// GraphProjection is a derived view — WorkflowEnvelope remains authoritative.
// NEVER persist graph positions. NEVER mutate the projection from the UI.

let _apiColCurrentView = 'list';
let _apiColGraphCy = null;
let _apiColGraphModalCy = null;
let _apiColGraphProjection = null;
let _apiColGraphColId = null;

const _GRAPH_NODE_TYPE_COLOR = {
  HTTP:      '#f59e0b',
  ASSERTION: '#10b981',
  EXTRACT:   '#6366f1',
  CONDITION: '#f472b6',
  TRANSFORM: '#38bdf8',
  PARALLEL:  '#a78bfa',
  CONTRACT:  '#fb923c',
  AI:        '#e879f9',
  LOOP:      '#34d399',
  default:   '#6b7280',
};

// ── View toggle ───────────────────────────────────────────────────────────────
function apiColViewSwitch(view) {
  _apiColCurrentView = view;
  const listView  = document.getElementById('api-col-list-view');
  const graphView = document.getElementById('api-col-graph-view');
  const listBtn   = document.getElementById('api-col-view-list-btn');
  const graphBtn  = document.getElementById('api-col-view-graph-btn');
  const newColBtn = document.getElementById('btn-new-api-col');

  if (view === 'list') {
    if (listView)  listView.style.display  = '';
    if (graphView) graphView.style.display = 'none';
    if (listBtn)   listBtn.classList.add('active');
    if (graphBtn)  graphBtn.classList.remove('active');
    if (newColBtn) newColBtn.style.display = '';
  } else {
    if (listView)  listView.style.display  = 'none';
    if (graphView) graphView.style.display = '';
    if (listBtn)   listBtn.classList.remove('active');
    if (graphBtn)  graphBtn.classList.add('active');
    if (newColBtn) newColBtn.style.display = 'none';
    _apiColGraphPopulateSelect();
    const sel = document.getElementById('api-col-graph-select');
    if (sel && _apiCols.length === 1) {
      sel.value = _apiCols[0].id;
      apiColGraphLoad(_apiCols[0].id);
    }
  }
}

function _apiColGraphPopulateSelect() {
  const sel = document.getElementById('api-col-graph-select');
  if (!sel) return;
  const opts = _apiCols.map(c =>
    '<option value="' + c.id + '">' + escHtml(c.name) + ' (' + (c.steps ?? []).length + ' requests)</option>'
  ).join('');
  sel.innerHTML = '<option value="">— select a collection —</option>' + opts;
}

// ── Load projection ───────────────────────────────────────────────────────────
async function apiColGraphLoad(collectionId) {
  if (!collectionId) {
    _apiColGraphSetState('Select a collection to visualize its workflow graph.');
    _apiColGraphClearMeta();
    return;
  }
  _apiColGraphColId = collectionId;
  _apiColGraphSetState('Loading graph…', true);
  _apiColGraphClearWarnings();

  try {
    const res = await fetch('/api/workflows/' + encodeURIComponent(collectionId) + '/graph');
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }));
      _apiColGraphSetState('Graph projection failed: ' + (err.message || err.error || res.statusText));
      _apiColGraphClearMeta();
      return;
    }
    const projection = await res.json();
    _apiColGraphProjection = projection;
    _apiColGraphRender(projection, false);
  } catch (e) {
    _apiColGraphSetState('Network error: ' + e.message);
    _apiColGraphClearMeta();
  }
}

// ── Render ─────────────────────────────────────────────────────────────────────
function _apiColGraphRender(projection, isModal) {
  const containerId = isModal ? 'api-col-graph-modal-cy' : 'api-col-graph-cy';
  const container   = document.getElementById(containerId);
  if (!container) return;

  if (!isModal) _apiColGraphShowWarnings(projection.warnings);

  if (!projection.nodes || projection.nodes.length === 0) {
    if (!isModal) _apiColGraphSetState('This collection has no requests to visualize.');
    return;
  }

  const elements = _apiColGraphBuildElements(projection);

  if (!isModal && _apiColGraphCy) { _apiColGraphCy.destroy(); _apiColGraphCy = null; }
  if (isModal  && _apiColGraphModalCy) { _apiColGraphModalCy.destroy(); _apiColGraphModalCy = null; }

  if (!isModal) {
    const stateEl = document.getElementById('api-col-graph-state');
    if (stateEl) stateEl.style.display = 'none';
    container.style.display = '';
  }

  // Hide loading overlay in modal
  if (isModal) {
    const loadEl = document.getElementById('api-col-graph-modal-loading');
    if (loadEl) loadEl.style.display = 'none';
  }

  /* global cytoscape */
  const cy = cytoscape({
    container:            container,
    elements:             elements,
    style:                _apiColGraphCyStyles(),
    layout:               _apiColGraphCyLayout(projection),
    zoom:                 1,
    minZoom:              0.08,
    maxZoom:              5,
    userZoomingEnabled:   true,
    userPanningEnabled:   true,
    boxSelectionEnabled:  false,
  });

  cy.on('layoutstop', function() { cy.fit(undefined, 60); });

  if (!isModal) {
    cy.on('tap', 'node', function(evt) { _apiColGraphShowNodeDetail(evt.target.data()); });
    cy.on('tap', function(evt) { if (evt.target === cy) _apiColGraphHideNodeDetail(); });
    _apiColGraphCy = cy;
    _apiColGraphUpdateMeta(projection);
    _apiColGraphRenderHierarchy(projection);
    _apiColGraphEnableToolbarBtns(true);
  } else {
    cy.on('tap', 'node', function(evt) { _apiColGraphModalShowDetail(evt.target.data()); });
    cy.on('tap', function(evt) { if (evt.target === cy) _apiColGraphModalHideDetail(); });
    _apiColGraphModalCy = cy;
    // Update meta badge
    const metaEl = document.getElementById('api-col-graph-modal-meta');
    if (metaEl && projection.meta) metaEl.textContent = projection.meta.nodeCount + ' requests · ' + projection.meta.edgeCount + ' edges';
  }
}

// ── Topological-sort layout (no extra deps) ────────────────────────────────────
// Computes x/y positions for a top-to-bottom ranked DAG.
function _apiColGraphComputePositions(nodes, edges) {
  const ids = nodes.map(n => n.id);
  const inDeg = {}, children = {}, rank = {};
  ids.forEach(id => { inDeg[id] = 0; children[id] = []; rank[id] = 0; });

  for (const e of edges) {
    if (ids.includes(e.source) && ids.includes(e.target)) {
      inDeg[e.target] = (inDeg[e.target] || 0) + 1;
      children[e.source].push(e.target);
    }
  }

  // Kahn's BFS to compute ranks
  const queue = ids.filter(id => inDeg[id] === 0);
  while (queue.length) {
    const cur = queue.shift();
    for (const child of (children[cur] || [])) {
      rank[child] = Math.max(rank[child], rank[cur] + 1);
      inDeg[child]--;
      if (inDeg[child] === 0) queue.push(child);
    }
  }

  // Group by rank
  const layers = {};
  ids.forEach(id => { const r = rank[id]; (layers[r] = layers[r] || []).push(id); });

  const H_GAP = 220, V_GAP = 120;
  const positions = {};
  for (const [r, layerIds] of Object.entries(layers)) {
    const y = parseInt(r) * V_GAP;
    const totalW = (layerIds.length - 1) * H_GAP;
    layerIds.forEach((id, i) => {
      positions[id] = { x: i * H_GAP - totalW / 2, y };
    });
  }
  return positions;
}

function _apiColGraphBuildElements(projection) {
  const elements = [];

  // Compute topo positions
  const topoPos = _apiColGraphComputePositions(projection.nodes || [], projection.edges || []);

  const clusterNodeIds = new Set();
  for (const cluster of (projection.clusters || [])) {
    if (cluster.source !== 'hint' && cluster.nodeIds.length > 1) {
      elements.push({
        data: { id: 'cluster-' + cluster.clusterId, label: cluster.label, clusterSource: cluster.source, isCluster: true },
        classes: 'cluster-node',
      });
      clusterNodeIds.add(cluster.clusterId);
    }
  }

  for (const node of projection.nodes) {
    let parent;
    for (const cluster of (projection.clusters || [])) {
      if (cluster.source !== 'hint' && cluster.nodeIds.includes(node.id) && clusterNodeIds.has(cluster.clusterId)) {
        parent = 'cluster-' + cluster.clusterId;
        break;
      }
    }
    const classes = ['workflow-node'];
    if (node.disabled) classes.push('node-disabled');
    classes.push('nodetype-' + (node.nodeType || 'HTTP').toLowerCase());

    // Build richer label: step index + method + truncated URL
    const raw  = node.label || node.id;
    // Try to detect "METHOD /path" pattern in label
    const methodMatch = raw.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
    let topLine = raw, bottomLine = '';
    if (methodMatch) {
      topLine    = methodMatch[1].toUpperCase();
      const url  = methodMatch[2];
      bottomLine = url.length > 28 ? '…' + url.slice(-26) : url;
    } else if (raw.length > 30) {
      topLine    = raw.slice(0, 28) + '…';
    }
    const displayLabel = bottomLine ? topLine + '\n' + bottomLine : topLine;

    // Use stored position if available, else topo
    const stored = node.position && !node.isAutoPositioned;
    const pos = stored ? node.position : (topoPos[node.id] || { x: 0, y: 0 });

    elements.push({
      data: {
        id:               node.id,
        label:            displayLabel,
        rawLabel:         raw,
        nodeType:         node.nodeType,
        layer:            node.layer,
        indexWithinLayer: node.indexWithinLayer,
        visualGroup:      node.visualGroup,
        hierarchyPath:    node.hierarchyPath ? node.hierarchyPath.join(' › ') : '',
        disabled:         node.disabled,
        isAutoPositioned: node.isAutoPositioned,
        posX:             pos.x,
        posY:             pos.y,
        parent:           parent,
      },
      position: pos,
      classes:  classes.join(' '),
    });
  }

  for (const edge of (projection.edges || [])) {
    const eClasses = ['workflow-edge', 'edge-' + edge.edgeType];
    if (edge.isHeuristic) eClasses.push('edge-heuristic');
    elements.push({
      data: { id: edge.id, source: edge.source, target: edge.target, edgeType: edge.edgeType, isHeuristic: edge.isHeuristic || false },
      classes: eClasses.join(' '),
    });
  }

  return elements;
}

function _apiColGraphCyStyles() {
  return [
    { selector: 'node.workflow-node', style: {
      shape: 'round-rectangle',
      width: 180, height: 52,
      'background-color': '#1e2030',
      'border-color': '#f59e0b', 'border-width': 2,
      label: 'data(label)',
      'font-size': 11, color: '#e2e8f0',
      'text-valign': 'center', 'text-halign': 'center',
      'text-wrap': 'wrap', 'text-max-width': 165,
      'line-height': 1.4,
      cursor: 'pointer',
      'transition-property': 'border-color, background-color, border-width',
      'transition-duration': '0.15s',
    }},
    { selector: 'node.workflow-node:hover',  style: { 'background-color': '#2a2d45', 'border-width': 2.5 }},
    { selector: 'node.nodetype-http',        style: { 'border-color': '#f59e0b' }},
    { selector: 'node.nodetype-assertion',   style: { 'border-color': '#10b981' }},
    { selector: 'node.nodetype-extract',     style: { 'border-color': '#6366f1' }},
    { selector: 'node.nodetype-condition',   style: { 'border-color': '#f472b6' }},
    { selector: 'node.nodetype-transform',   style: { 'border-color': '#38bdf8' }},
    { selector: 'node.nodetype-parallel',    style: { 'border-color': '#a78bfa' }},
    { selector: 'node.nodetype-ai',          style: { 'border-color': '#e879f9' }},
    { selector: 'node.nodetype-loop',        style: { 'border-color': '#34d399' }},
    { selector: 'node.node-disabled',        style: { opacity: 0.38, 'border-style': 'dashed' }},
    { selector: 'node:selected',             style: { 'border-color': '#fff', 'border-width': 3, 'background-color': '#2e3250' }},
    { selector: 'node:active',               style: { 'overlay-opacity': 0.08 }},
    { selector: 'node.cluster-node',         style: {
      'background-color': 'rgba(245,158,11,.05)', 'border-color': 'rgba(245,158,11,.25)',
      'border-width': 1.5, 'border-style': 'dashed', label: 'data(label)',
      'font-size': 10, color: '#9ca3af', 'text-valign': 'top', 'text-halign': 'center', padding: 20,
    }},
    { selector: 'edge.workflow-edge', style: {
      width: 2, 'line-color': '#4b5563', 'target-arrow-color': '#4b5563',
      'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.9,
    }},
    { selector: 'edge.edge-depends_on',  style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b', width: 2.5 }},
    { selector: 'edge.edge-inferred',    style: { 'line-style': 'dashed', 'line-color': '#6b7280', 'target-arrow-color': '#6b7280' }},
    { selector: 'edge.edge-heuristic',   style: { 'line-style': 'dotted', opacity: 0.55 }},
    { selector: 'edge:selected',         style: { 'line-color': '#fff', 'target-arrow-color': '#fff' }},
  ];
}

function _apiColGraphCyLayout(projection) {
  // Always use preset with our topo-sorted positions
  return { name: 'preset', animate: false, fit: true, padding: 60 };
}

// ── Toolbar ────────────────────────────────────────────────────────────────────
function apiColGraphFit()   { if (_apiColGraphCy) _apiColGraphCy.fit(undefined, 40); }
function apiColGraphReset() { if (_apiColGraphCy) { _apiColGraphCy.reset(); _apiColGraphCy.fit(undefined, 40); } }

function _apiColGraphEnableToolbarBtns(enabled) {
  var fitBtn   = document.getElementById('api-col-graph-fit-btn');
  var resetBtn = document.getElementById('api-col-graph-reset-btn');
  if (fitBtn)   fitBtn.disabled   = !enabled;
  if (resetBtn) resetBtn.disabled = !enabled;
}

// ── State display ─────────────────────────────────────────────────────────────
function _apiColGraphSetState(msg, loading) {
  var stateEl = document.getElementById('api-col-graph-state');
  var cyEl    = document.getElementById('api-col-graph-cy');
  if (stateEl) {
    stateEl.style.display = '';
    if (loading) {
      stateEl.innerHTML = '<div class="spinner" style="width:28px;height:28px"></div><span style="color:var(--neutral-700);font-size:13px">' + escHtml(msg) + '</span>';
    } else {
      stateEl.innerHTML = '<span style="color:var(--neutral-700);font-size:13px">' + escHtml(msg) + '</span>';
    }
  }
  if (cyEl) cyEl.style.display = 'none';
  _apiColGraphHideNodeDetail();
  _apiColGraphEnableToolbarBtns(false);
}

function _apiColGraphClearMeta() {
  var metaEl    = document.getElementById('api-col-graph-meta');
  var stratEl   = document.getElementById('api-col-graph-strategy-badge');
  var sidebarEl = document.getElementById('api-col-graph-sidebar');
  if (metaEl)    metaEl.textContent    = '';
  if (stratEl)   stratEl.textContent   = '';
  if (sidebarEl) sidebarEl.style.display = 'none';
}

function _apiColGraphUpdateMeta(projection) {
  var metaEl  = document.getElementById('api-col-graph-meta');
  var stratEl = document.getElementById('api-col-graph-strategy-badge');
  if (metaEl)  metaEl.textContent  = projection.meta.nodeCount + ' nodes · ' + projection.meta.edgeCount + ' edges';
  if (stratEl) stratEl.textContent = projection.meta.projectionStrategy || '';
}

// ── Warnings ──────────────────────────────────────────────────────────────────
function _apiColGraphShowWarnings(warnings) {
  var el = document.getElementById('api-col-graph-warnings');
  if (!el) return;
  if (!warnings || warnings.length === 0) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = warnings.map(function(w) {
    return '<span>⚠ ' + escHtml(w.code) + (w.detail ? ': ' + escHtml(w.detail) : '') + '</span>';
  }).join('<br>');
}

function _apiColGraphClearWarnings() {
  var el = document.getElementById('api-col-graph-warnings');
  if (el) el.style.display = 'none';
}

// ── Node detail panel ─────────────────────────────────────────────────────────
function _apiColGraphShowNodeDetail(data) {
  var panel = document.getElementById('api-col-graph-node-detail');
  if (!panel) return;
  var rows = [
    ['Type',     data.nodeType || '—'],
    ['Group',    data.visualGroup || '—'],
    ['Path',     data.hierarchyPath || '—'],
    ['Layer',    data.layer != null ? String(data.layer) : '—'],
    ['Position', data.isAutoPositioned ? 'auto-layout' : 'stored (' + Math.round(data.posX || 0) + ', ' + Math.round(data.posY || 0) + ')'],
    ['Disabled', data.disabled ? 'yes' : 'no'],
  ].map(function(pair) {
    return '<div class="api-col-graph-node-detail-row">' +
      '<span class="api-col-graph-node-detail-label">' + escHtml(pair[0]) + '</span>' +
      '<span style="color:var(--neutral-900)">' + escHtml(String(pair[1])) + '</span>' +
      '</div>';
  }).join('');

  panel.style.display = '';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
    '<div class="api-col-graph-node-detail-title">' + escHtml(data.label || data.id) + '</div>' +
    '<button onclick="_apiColGraphHideNodeDetail()" style="background:none;border:none;color:var(--neutral-500);cursor:pointer;padding:0;font-size:14px;line-height:1">×</button>' +
    '</div>' + rows;
}

function _apiColGraphHideNodeDetail() {
  var panel = document.getElementById('api-col-graph-node-detail');
  if (panel) panel.style.display = 'none';
}

// ── Hierarchy sidebar ─────────────────────────────────────────────────────────
function _apiColGraphRenderHierarchy(projection) {
  var sidebar = document.getElementById('api-col-graph-sidebar');
  var treeEl  = document.getElementById('api-col-graph-hierarchy-tree');
  if (!sidebar || !treeEl) return;

  var hier = projection.hierarchy;
  if (!hier || hier.rootId === null || hier.nodes.length === 0) {
    sidebar.style.display = 'none';
    return;
  }

  sidebar.style.display = '';

  function renderNode(nodeId, depth) {
    var h = hier.nodes.find(function(n) { return n.id === nodeId; });
    if (!h) return '';
    var indent = depth * 14;
    var children = hier.nodes.filter(function(n) { return n.parentId === nodeId; });
    var stepCount = h.stepIds.length;
    var label = (depth > 0 ? '└ ' : '') + escHtml(h.name) + (stepCount > 0 ? ' <span style="color:var(--neutral-500);font-size:10px">(' + stepCount + ')</span>' : '');
    return '<div class="api-col-graph-hier-node" style="padding-left:' + (10 + indent) + 'px" onclick="_apiColGraphHierNodeClick(' + JSON.stringify(nodeId) + ')" title="' + escHtml(h.name) + '">' +
      label + '</div>' +
      children.map(function(c) { return renderNode(c.id, depth + 1); }).join('');
  }

  treeEl.innerHTML = renderNode(hier.rootId, 0) || '<div style="color:var(--neutral-500);font-size:12px;padding:4px 10px">No hierarchy</div>';
}

function _apiColGraphHierNodeClick(nodeId) {
  if (!_apiColGraphCy || !_apiColGraphProjection) return;
  var hier  = _apiColGraphProjection.hierarchy;
  var hNode = hier && hier.nodes.find(function(n) { return n.id === nodeId; });
  if (!hNode || !hNode.stepIds.length) return;

  _apiColGraphCy.nodes().forEach(function(n) {
    n.style('opacity', hNode.stepIds.indexOf(n.id()) > -1 ? 1 : 0.3);
  });
  _apiColGraphCy.edges().forEach(function(e) {
    var inGroup = hNode.stepIds.indexOf(e.data('source')) > -1 || hNode.stepIds.indexOf(e.data('target')) > -1;
    e.style('opacity', inGroup ? 1 : 0.2);
  });

  _apiColGraphCy.once('tap', function(evt) {
    if (evt.target === _apiColGraphCy) {
      _apiColGraphCy.nodes().forEach(function(n) { n.style('opacity', 1); });
      _apiColGraphCy.edges().forEach(function(e) { e.style('opacity', 1); });
    }
  });
}

function apiColGraphSidebarToggle(show) {
  var sidebar = document.getElementById('api-col-graph-sidebar');
  if (!sidebar) return;
  sidebar.style.display = show ? '' : 'none';
  if (_apiColGraphCy) setTimeout(function() { _apiColGraphCy.resize(); }, 50);
}

// ── Fullscreen modal ──────────────────────────────────────────────────────────
function apiColGraphOpenModal(collectionId) {
  const col = _apiCols.find(c => c.id === collectionId);
  const titleEl = document.getElementById('api-col-graph-modal-title');
  if (titleEl) titleEl.textContent = (col ? col.name : 'Workflow') + ' — Workflow Graph';

  const metaEl = document.getElementById('api-col-graph-modal-meta');
  if (metaEl) metaEl.textContent = '';

  // Show modal + loading state
  document.getElementById('modal-api-col-graph').style.display = 'flex';
  const loadEl = document.getElementById('api-col-graph-modal-loading');
  if (loadEl) loadEl.style.display = '';
  _apiColGraphModalHideDetail();

  // Destroy previous instance
  if (_apiColGraphModalCy) { _apiColGraphModalCy.destroy(); _apiColGraphModalCy = null; }

  const renderModal = function(p) { setTimeout(function() { _apiColGraphRender(p, true); }, 60); };

  if (_apiColGraphProjection && _apiColGraphColId === collectionId) {
    renderModal(_apiColGraphProjection);
  } else {
    fetch('/api/workflows/' + encodeURIComponent(collectionId) + '/graph')
      .then(r => r.json())
      .then(p => { _apiColGraphProjection = p; _apiColGraphColId = collectionId; renderModal(p); })
      .catch(e => {
        if (loadEl) loadEl.innerHTML = '<span style="color:#ef4444;font-size:13px">Failed to load graph: ' + escHtml(e.message) + '</span>';
      });
  }
}

function apiColGraphModalClose() {
  document.getElementById('modal-api-col-graph').style.display = 'none';
  if (_apiColGraphModalCy) { _apiColGraphModalCy.destroy(); _apiColGraphModalCy = null; }
  _apiColGraphModalHideDetail();
}

function apiColGraphModalFit() {
  if (_apiColGraphModalCy) _apiColGraphModalCy.fit(undefined, 60);
}

function _apiColGraphModalShowDetail(data) {
  const panel = document.getElementById('api-col-graph-modal-detail');
  const body  = document.getElementById('api-col-graph-modal-detail-body');
  if (!panel || !body) return;
  const rows = [
    ['Name',     data.rawLabel || data.label],
    ['Type',     data.nodeType || '—'],
    ['Group',    data.visualGroup || '—'],
    ['Path',     data.hierarchyPath || '—'],
    ['Layer',    data.layer != null ? String(data.layer) : '—'],
    ['Disabled', data.disabled ? 'Yes' : 'No'],
  ];
  body.innerHTML = rows.map(([k, v]) =>
    '<div style="margin-bottom:10px"><div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:2px">' + k + '</div>' +
    '<div style="font-size:13px;word-break:break-all">' + escHtml(v) + '</div></div>'
  ).join('');
  panel.style.display = '';
}

function _apiColGraphModalHideDetail() {
  const panel = document.getElementById('api-col-graph-modal-detail');
  if (panel) panel.style.display = 'none';
}

// ── Collection Analytics Modal ─────────────────────────────────────────────

async function apiColAnalyticsOpen(colId, colName) {
  const modal = document.getElementById('modal-col-analytics');
  const subtitle = document.getElementById('col-analytics-subtitle');
  const body = document.getElementById('col-analytics-body');
  if (!modal) return;
  subtitle.textContent = colName || colId;
  body.innerHTML = '<div style="color:var(--neutral-400);text-align:center;padding:40px">Loading analytics…</div>';
  modal.style.display = 'flex';
  try {
    const res = await fetch('/api/api-collections/' + encodeURIComponent(colId) + '/analytics?limit=20');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    body.innerHTML = _apiColRenderAnalytics(data);
  } catch (err) {
    body.innerHTML = '<div style="color:#ef4444;padding:20px">Failed to load analytics: ' + escHtml(String(err)) + '</div>';
  }
}

function apiColAnalyticsClose() {
  const modal = document.getElementById('modal-col-analytics');
  if (modal) modal.style.display = 'none';
}

function _apiColRenderAnalytics(data) {
  if (!data.summary || data.runs.length === 0) {
    return '<div style="text-align:center;padding:60px;color:var(--neutral-400)">' +
      '<div style="font-size:36px;margin-bottom:12px">📭</div>' +
      '<div style="font-size:15px;font-weight:600;margin-bottom:6px">No run history yet</div>' +
      '<div style="font-size:13px">Run this collection at least once to see analytics.</div>' +
      '</div>';
  }

  const s = data.summary;
  const runs = data.runs; // oldest to newest

  // Summary cards
  const passColor = s.avgPassRate >= 80 ? '#22c55e' : s.avgPassRate >= 50 ? '#f59e0b' : '#ef4444';
  const cards = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">' +
    _analyticsCard('Total Runs', s.totalRuns, '') +
    _analyticsCard('Avg Pass Rate', s.avgPassRate + '%', passColor) +
    _analyticsCard('Avg Duration', _fmtDuration(s.avgDurationMs), '') +
    _analyticsCard('p95 Duration', _fmtDuration(s.p95DurationMs), '#f59e0b') +
    '</div>';

  // Pass rate bar chart
  const bars = runs.map(function(r, i) {
    const color = r.passRate >= 80 ? '#22c55e' : r.passRate >= 50 ? '#f59e0b' : '#ef4444';
    const statusLabel = r.status === 'passed' ? 'PASS' : (r.status === 'failed' || r.status === 'error') ? 'FAIL' : r.status;
    const date = r.startedAt ? r.startedAt.slice(0, 10) : '';
    const tip = statusLabel + ' ' + date + ' - ' + r.passRate + '% pass - ' + _fmtDuration(r.durationMs);
    return '<div style="display:flex;flex-direction:column;align-items:center;flex:1;min-width:0" title="' + escHtml(tip) + '">' +
      '<div style="font-size:9px;color:var(--neutral-400);margin-bottom:2px">' + r.passRate + '%</div>' +
      '<div style="width:100%;background:var(--neutral-100);border-radius:3px;height:80px;display:flex;align-items:flex-end">' +
        '<div style="width:100%;height:' + Math.max(3, r.passRate) + '%;background:' + color + ';border-radius:3px"></div>' +
      '</div>' +
      '<div style="font-size:8px;color:var(--neutral-400);margin-top:3px">' + (i + 1) + '</div>' +
    '</div>';
  }).join('');

  const chart = '<div style="margin-bottom:16px;padding:16px;border:1px solid var(--neutral-200);border-radius:8px">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:10px;color:var(--neutral-700)">Pass Rate — Last ' + runs.length + ' Runs (oldest to newest)</div>' +
    '<div style="display:flex;gap:4px;align-items:flex-end;height:110px;padding:0 4px">' + bars + '</div>' +
    '<div style="display:flex;gap:16px;font-size:10px;color:var(--neutral-500);margin-top:14px">' +
      '<span><span style="color:#22c55e">&#9632;</span> 80%+ pass</span>' +
      '<span><span style="color:#f59e0b">&#9632;</span> 50-79%</span>' +
      '<span><span style="color:#ef4444">&#9632;</span> below 50%</span>' +
    '</div>' +
  '</div>';

  // Duration trend
  const maxDur = Math.max.apply(null, runs.map(function(r) { return r.durationMs || 0; })) || 1;
  const durBars = runs.map(function(r) {
    const pct = Math.max(3, Math.round(((r.durationMs || 0) / maxDur) * 100));
    const date = r.startedAt ? r.startedAt.slice(0, 10) : '';
    return '<div style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center" title="' + escHtml(date + ' - ' + _fmtDuration(r.durationMs)) + '">' +
      '<div style="width:100%;background:var(--neutral-100);border-radius:3px;height:50px;display:flex;align-items:flex-end">' +
        '<div style="width:100%;height:' + pct + '%;background:#6366f1;border-radius:3px;opacity:.8"></div>' +
      '</div>' +
    '</div>';
  }).join('');

  const durChart = '<div style="margin-bottom:16px;padding:16px;border:1px solid var(--neutral-200);border-radius:8px">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:8px;color:var(--neutral-700)">Duration Trend</div>' +
    '<div style="display:flex;gap:3px;align-items:flex-end;height:58px">' + durBars + '</div>' +
    '<div style="font-size:11px;color:var(--neutral-400);margin-top:6px">' +
      'Max: ' + _fmtDuration(maxDur) + '&nbsp;&nbsp;|&nbsp;&nbsp;Avg: ' + _fmtDuration(s.avgDurationMs) + '&nbsp;&nbsp;|&nbsp;&nbsp;p95: ' + _fmtDuration(s.p95DurationMs) +
    '</div>' +
  '</div>';

  // Step failure heatmap
  let stepSection = '';
  if (data.stepStats && data.stepStats.length > 0) {
    const stepRows = data.stepStats.map(function(st) {
      const color = st.failRate >= 50 ? '#ef4444' : st.failRate >= 20 ? '#f59e0b' : '#22c55e';
      const barW = Math.max(2, st.failRate);
      return '<tr>' +
        '<td style="font-size:12px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(st.stepName) + '">' + escHtml(st.stepName) + '</td>' +
        '<td style="text-align:center;font-size:12px">' + st.runs + '</td>' +
        '<td style="text-align:center;font-size:12px;color:' + color + ';font-weight:700">' + st.failures + '</td>' +
        '<td style="min-width:140px">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<div style="flex:1;background:var(--neutral-100);border-radius:3px;height:8px">' +
              '<div style="width:' + barW + '%;height:100%;background:' + color + ';border-radius:3px"></div>' +
            '</div>' +
            '<span style="font-size:11px;color:' + color + ';font-weight:700;min-width:34px">' + st.failRate + '%</span>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join('');
    stepSection = '<div style="margin-bottom:16px;padding:16px;border:1px solid var(--neutral-200);border-radius:8px">' +
      '<div style="font-size:13px;font-weight:700;margin-bottom:10px;color:var(--neutral-700)">Request Failure Heatmap ' +
        '<span style="font-size:11px;font-weight:400;color:var(--neutral-400)">(top 10 by fail rate across last ' + s.totalRuns + ' runs)</span>' +
      '</div>' +
      '<table class="data-table" style="width:100%">' +
        '<thead><tr><th>Request</th><th style="text-align:center">Runs</th><th style="text-align:center">Failures</th><th>Fail Rate</th></tr></thead>' +
        '<tbody>' + stepRows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  // Recent runs table
  const runRows = data.runs.slice().reverse().slice(0, 15).map(function(r) {
    const sc = r.status === 'passed' ? '#22c55e' : (r.status === 'failed' || r.status === 'error') ? '#ef4444' : '#9ca3af';
    const icon = r.status === 'passed' ? '✓' : (r.status === 'failed' || r.status === 'error') ? '✗' : '⊘';
    return '<tr>' +
      '<td style="font-size:11px;color:var(--neutral-500)">' + (r.startedAt || '').slice(0, 16).replace('T', ' ') + '</td>' +
      '<td style="text-align:center"><span style="color:' + sc + ';font-weight:700">' + icon + ' ' + r.status + '</span></td>' +
      '<td style="text-align:center;font-size:12px">' + r.passed + '/' + r.totalSteps + '</td>' +
      '<td style="text-align:center;font-size:12px">' + r.passRate + '%</td>' +
      '<td style="text-align:right;font-size:12px">' + _fmtDuration(r.durationMs) + '</td>' +
    '</tr>';
  }).join('');

  const runTable = '<div style="padding:16px;border:1px solid var(--neutral-200);border-radius:8px">' +
    '<div style="font-size:13px;font-weight:700;margin-bottom:10px;color:var(--neutral-700)">Recent Runs</div>' +
    '<table class="data-table" style="width:100%">' +
      '<thead><tr><th>Started</th><th style="text-align:center">Status</th><th style="text-align:center">Requests</th><th style="text-align:center">Pass%</th><th style="text-align:right">Duration</th></tr></thead>' +
      '<tbody>' + runRows + '</tbody>' +
    '</table>' +
  '</div>';

  return cards + chart + durChart + stepSection + runTable;
}

function _analyticsCard(label, value, color) {
  return '<div style="background:var(--surface-2);border:1px solid var(--neutral-200);border-radius:8px;padding:14px 16px">' +
    '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--neutral-500);margin-bottom:4px">' + escHtml(label) + '</div>' +
    '<div style="font-size:22px;font-weight:700;color:' + (color || 'var(--neutral-900)') + '">' + escHtml(String(value)) + '</div>' +
  '</div>';
}

function _fmtDuration(ms) {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return Math.floor(ms / 60000) + 'm ' + Math.round((ms % 60000) / 1000) + 's';
}
