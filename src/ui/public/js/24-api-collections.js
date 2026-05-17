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
    const [colRes, envRes] = await Promise.all([
      fetch(`/api/api-collections?projectId=${encodeURIComponent(currentProjectId ?? '')}`),
      fetch(`/api/api-envs?projectId=${encodeURIComponent(currentProjectId ?? '')}`),
    ]);
    _apiCols = await colRes.json();
    _apiColEnvs = await envRes.json();
    _apiColRenderList();
  } catch (e) {
    modAlert('api-col-list-alert', 'error', 'Load failed: ' + e.message);
  }
}

function _apiColRenderList() {
  const tbody = document.getElementById('api-col-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (_apiCols.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No collections yet</td></tr>';
    return;
  }
  for (const col of _apiCols) {
    const envName = _apiColEnvs.find(e => e.id === col.environmentId)?.name ?? '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escHtml(col.name)}</td>
      <td>${escHtml(envName)}</td>
      <td>${(col.steps ?? []).length} steps</td>
      <td>${escHtml(col.executionMode ?? 'sequential')}</td>
      <td>
        <button class="tbl-btn" onclick="apiColEdit('${col.id}')">Edit</button>
        <button class="tbl-btn run-btn" onclick="apiColRun('${col.id}')">▶ Run</button>
        <button class="tbl-btn" onclick="apiColPrescan('${col.id}')">Pre-scan</button>
        <button class="tbl-btn" onclick="apiColGraphOpenModal('${col.id}')" title="View workflow graph">&#9645; Graph</button>
        <button class="tbl-btn del" onclick="apiColDelete('${col.id}','${escHtml(col.name)}')">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }
}

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
    container.innerHTML = '<div style="color:var(--text-muted);padding:8px">No steps yet — add below</div>';
    return;
  }
  _apiColSteps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'api-step-row';
    div.style.cssText = 'border:1px solid var(--border);border-radius:6px;margin-bottom:8px;padding:8px';
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="_apiColStepToggle(${i})">
        <span style="font-size:11px;font-weight:600;color:var(--text-muted);min-width:48px">Step ${i + 1}</span>
        <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${escHtml(step.name)}
          <span style="font-size:11px;color:var(--text-muted);margin-left:6px">${escHtml(step.request?.method ?? 'GET')} ${escHtml(step.request?.url ?? '')}</span>
        </span>
        <button class="tbl-btn del" style="margin-left:auto" onclick="event.stopPropagation();_apiColStepRemove(${i})">✕</button>
      </div>
      <div id="api-step-body-${i}" style="display:none;padding-top:10px;border-top:1px solid var(--border);margin-top:8px">
        <!-- Name row -->
        <div style="margin-bottom:8px">
          <input class="fm-input" value="${escHtml(step.name)}" oninput="_apiColStepField(${i},'name',this.value)" placeholder="Step name"/>
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
                <span style="font-size:11px;color:var(--text-muted)">Set variables before sending</span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();_apiColPreVarAdd(${i})">+ Add Rule</button>
            </div>
            <div id="pre-vars-${i}" style="padding:8px 12px">
              <div style="display:grid;grid-template-columns:1fr 110px 1fr 22px;gap:4px;font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:4px">
                <span>Variable Name</span><span>Set To</span><span>Value / Source</span><span></span>
              </div>
              <div id="api-step-prevars-${i}"></div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px">💡 Use <code>{{varName}}</code> in URL, Headers, Body of any later step</div>
            </div>
          </div>

          <!-- Section 2: Post-Response — Extract + Assert -->
          <div style="border:1px solid var(--border);border-radius:6px;margin-bottom:10px;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary,#1a1a1a);cursor:pointer" onclick="_apiColRuleToggle('post-rules-${i}')">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#4ade80">② After Response</span>
                <span style="font-size:11px;color:var(--text-muted)">Extract values &amp; assert conditions</span>
              </div>
              <div style="display:flex;gap:6px" onclick="event.stopPropagation()">
                <button class="btn btn-secondary btn-sm" onclick="_apiColExtractAdd(${i})">+ Extract</button>
                <button class="btn btn-secondary btn-sm" onclick="_apiColAssertAdd(${i})">+ Assert</button>
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

          <!-- Section 3: Flow Control — Next Step -->
          <div style="border:1px solid var(--border);border-radius:6px;overflow:hidden">
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg-secondary,#1a1a1a);cursor:pointer" onclick="_apiColRuleToggle('flow-rules-${i}')">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#f59e0b">③ Flow Control</span>
                <span style="font-size:11px;color:var(--text-muted)">Conditionally jump to another step</span>
              </div>
              <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();_apiColFlowAdd(${i})">+ Add Rule</button>
            </div>
            <div id="flow-rules-${i}" style="padding:8px 12px">
              <div style="display:grid;grid-template-columns:130px 140px 1fr 130px 22px;gap:4px;font-size:11px;color:var(--text-muted);font-weight:600;margin-bottom:4px">
                <span>Check</span><span>Operator</span><span>Value</span><span>Then go to</span><span></span>
              </div>
              <div id="api-step-flow-${i}"></div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px">💡 Like <code>postman.setNextRequest()</code> — no code needed. Example: if statusCode equals 401 → go to "Re-Authenticate" step. If no rules match, collection runs sequentially by default.</div>
            </div>
          </div>
        </div>
        <!-- Tab: Settings -->
        <div id="api-step-tab-settings-${i}" style="padding-top:10px;display:none">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Timeout (ms)
                <span title="How long to wait for this step's HTTP response before marking it as failed. Default: 30000ms (30s). Increase for slow APIs (e.g. report generation). Decrease to fail fast on health checks." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <input class="fm-input" type="number" value="${step.execution?.timeoutMs ?? ''}" oninput="_apiColStepExecField(${i},'timeoutMs',+this.value)" placeholder="30000 (default)"/>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Run Condition
                <span title="JavaScript expression evaluated before this step runs. If false, step is SKIPPED (not failed). Variables from previous steps are available as plain values — e.g. write: capturedRole === 'admin'  or  bookingId !== ''  Tip: UC6 in the demo collection uses this to skip the update step when the user is not admin." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <input class="fm-input" value="${escHtml(step.execution?.condition ?? '')}" oninput="_apiColStepExecField(${i},'condition',this.value)" placeholder="e.g. capturedRole === 'admin'"/>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                On Failure
                <span title="What to do when this step fails its assertions:&#10;• continue — run the next step regardless (default when collection onFailure=continue)&#10;• abort — stop the entire collection run immediately&#10;• abort-group — stop steps in the same execution group, but other groups keep running&#10;• skip-dependents — skip all steps that depend on this step's extracted variables" style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
              </label>
              <select class="fm-input" onchange="_apiColStepExecField(${i},'onFailure',this.value)">
                ${['continue','abort','abort-group','skip-dependents'].map(v => `<option value="${v}" ${(step.execution?.onFailure??'')===v?'selected':''}>${v}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:11px;font-weight:600;display:block;margin-bottom:4px">
                Retry On
                <span title="Automatically retry this step when these conditions occur:&#10;• 5xx — server errors (500, 502, 503, 504)&#10;• 429 — rate limited (too many requests)&#10;• network — connection refused, timeout, DNS failure&#10;Set Max Retries and Delay below. Retries do NOT apply to POST/PUT/PATCH unless you also check Idempotent." style="cursor:help;color:var(--text-muted);font-weight:400"> ⓘ</span>
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
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer" title="Teardown steps run AFTER all normal test steps complete — whether the collection passed or failed. Use for cleanup: deleting test data created during the run (e.g. DELETE /booking/{{bookingId}}). A teardown step failing does not affect the collection's overall pass/fail status. UC8 in the demo collection is an example teardown.">
              <input type="checkbox" ${step.execution?.teardown ? 'checked' : ''} onchange="_apiColStepExecField(${i},'teardown',this.checked)"/>
              Teardown step <span style="color:var(--text-muted);font-size:11px">— runs after all tests, used for cleanup (e.g. DELETE created data)</span>
            </label>
          </div>
          <div style="display:flex;gap:24px;padding-top:8px;margin-top:8px">
            <label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer" title="Saves this step's response as the baseline snapshot. On future runs, the response is automatically compared against this saved baseline. Any changes (new fields, removed fields, value changes, status changes) are shown in the Diff tab of the run results. Use this to detect accidental API changes — like a contract test. Once set, run again without this checked to see the diff.">
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
  if (!vars.length) { c.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 0">No rules — click + Add Rule to set a variable before this request.</div>'; return; }
  c.innerHTML = vars.map((v, vi) => `
    <div style="display:grid;grid-template-columns:1fr 110px 1fr 22px;gap:4px;margin-bottom:4px;align-items:center">
      <input class="fm-input" style="font-size:12px" placeholder="e.g. authToken" value="${escHtml(v.name)}" oninput="_apiColPreVarField(${i},${vi},'name',this.value)"/>
      <select class="fm-input" style="font-size:12px" onchange="_apiColPreVarField(${i},${vi},'setTo',this.value)">
        <option value="literal" ${v.setTo==='literal'?'selected':''}>Literal</option>
        <option value="collectionVar" ${v.setTo==='collectionVar'?'selected':''}>Collection Var</option>
        <option value="envVar" ${v.setTo==='envVar'?'selected':''}>Env Var</option>
      </select>
      <input class="fm-input" style="font-size:12px" placeholder="${v.setTo==='literal'?'value':v.setTo==='collectionVar'?'{{varName}}':'{{ENV_VAR}}'}" value="${escHtml(v.value)}" oninput="_apiColPreVarField(${i},${vi},'value',this.value)"/>
      <button class="tbl-btn del" onclick="_apiColPreVarRemove(${i},${vi})">✕</button>
    </div>`).join('');
}
function _apiColPreVarField(i, vi, f, val) { _apiColSteps[i].preVars[vi][f] = val; if (f === 'setTo') _apiColPreVarsRender(i); }
function _apiColPreVarRemove(i, vi) { _apiColSteps[i].preVars.splice(vi, 1); _apiColPreVarsRender(i); }

// ── Post-response: Assertions ───────────────────────────────────────────────
const _ASSERT_FIELDS = [
  { label: 'Status Code', value: 'statusCode' },
  { label: 'Response Time (ms)', value: 'responseTime' },
  { label: 'Body (JSON path)', value: 'body' },
  { label: 'Header', value: 'header' },
  { label: 'Body contains', value: 'bodyContains' },
  { label: 'Body is valid JSON', value: 'bodyIsJson' },
];
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
  const noExpected = ['exists','notExists','isEmpty'];
  c.innerHTML = assertions.map((a, ai) => `
    <div style="display:grid;grid-template-columns:150px 140px 1fr 90px 22px;gap:4px;margin-bottom:4px;align-items:center">
      <select class="fm-input" style="font-size:12px" onchange="_apiColAssertField(${i},${ai},'field',this.value)">
        ${_ASSERT_FIELDS.map(f => `<option value="${f.value}" ${a.field===f.value?'selected':''}>${f.label}</option>`).join('')}
      </select>
      <select class="fm-input" style="font-size:12px" onchange="_apiColAssertField(${i},${ai},'operator',this.value)">
        ${_ASSERT_OPS.map(o => `<option value="${o.value}" ${a.operator===o.value?'selected':''}>${o.label}</option>`).join('')}
      </select>
      <input class="fm-input" style="font-size:12px" placeholder="Expected value or {{var}}" value="${escHtml(String(a.expected ?? ''))}" ${noExpected.includes(a.operator)?'disabled style="font-size:12px;opacity:0.4"':''} oninput="_apiColAssertField(${i},${ai},'expected',this.value)"/>
      <select class="fm-input" style="font-size:12px" onchange="_apiColAssertField(${i},${ai},'severity',this.value)">
        ${['critical','high','medium','low','soft'].map(s => `<option ${a.severity===s?'selected':''}>${s}</option>`).join('')}
      </select>
      <button class="tbl-btn del" onclick="_apiColAssertRemove(${i},${ai})">✕</button>
    </div>`).join('');
}
function _apiColAssertField(i, ai, f, val) { _apiColSteps[i].assertions[ai][f] = val; if (f === 'operator') _apiColAssertRender(i); }
function _apiColAssertRemove(i, ai) { _apiColSteps[i].assertions.splice(ai, 1); _apiColAssertRender(i); }

// ── Flow Control: Next Step ─────────────────────────────────────────────────
function _apiColFlowAdd(i) {
  if (!_apiColSteps[i].flowRules) _apiColSteps[i].flowRules = [];
  _apiColSteps[i].flowRules.push({ check: 'statusCode', operator: 'equals', value: '200', nextStep: '' });
  _apiColFlowRender(i);
}
function _apiColFlowRender(i) {
  const c = document.getElementById('api-step-flow-' + i);
  if (!c) return;
  const rules = _apiColSteps[i].flowRules ?? [];
  if (!rules.length) { c.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 0">No flow rules — collection runs sequentially by default.</div>'; return; }
  const stepOpts = _apiColSteps.map((s, si) => `<option value="${escHtml(s.name)}" ${rules[0]?.nextStep===s.name?'selected':''}>${si+1}. ${escHtml(s.name)}</option>`).join('');
  const stopOpts = `<option value="__stop__">⛔ Stop collection</option><option value="__continue__">▶ Continue next</option>`;
  c.innerHTML = rules.map((r, ri) => `
    <div style="display:grid;grid-template-columns:130px 140px 1fr 130px 22px;gap:4px;margin-bottom:4px;align-items:center">
      <select class="fm-input" style="font-size:12px" onchange="_apiColFlowField(${i},${ri},'check',this.value)">
        ${_ASSERT_FIELDS.map(f => `<option value="${f.value}" ${r.check===f.value?'selected':''}>${f.label}</option>`).join('')}
      </select>
      <select class="fm-input" style="font-size:12px" onchange="_apiColFlowField(${i},${ri},'operator',this.value)">
        ${_ASSERT_OPS.map(o => `<option value="${o.value}" ${r.operator===o.value?'selected':''}>${o.label}</option>`).join('')}
      </select>
      <input class="fm-input" style="font-size:12px" placeholder="Value or {{var}}" value="${escHtml(r.value ?? '')}" oninput="_apiColFlowField(${i},${ri},'value',this.value)"/>
      <select class="fm-input" style="font-size:12px" onchange="_apiColFlowField(${i},${ri},'nextStep',this.value)">
        ${stopOpts}
        ${_apiColSteps.map((s, si) => si !== i ? `<option value="${escHtml(s.name)}" ${r.nextStep===s.name?'selected':''}>${si+1}. ${escHtml(s.name)}</option>` : '').join('')}
      </select>
      <button class="tbl-btn del" onclick="_apiColFlowRemove(${i},${ri})">✕</button>
    </div>`).join('');
}
function _apiColFlowField(i, ri, f, val) { _apiColSteps[i].flowRules[ri][f] = val; }
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
    container.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:4px 2px">No extractions — add one to chain this step\'s response into the next step.</div>';
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
    name: 'New Step',
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

async function apiColRun(id) {
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
        <th style="text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)">Step</th>
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
    modAlert('api-col-list-alert', 'success', `Collection "${col.name}" imported (${col.steps?.length ?? 0} steps)`);
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
    '<option value="' + c.id + '">' + escHtml(c.name) + ' (' + (c.steps ?? []).length + ' steps)</option>'
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
    if (!isModal) _apiColGraphSetState('This collection has no steps to visualize.');
    return;
  }

  const isLarge = (projection.warnings || []).some(function(w) { return w.code === 'LARGE_GRAPH_WARNING'; });
  const elements = _apiColGraphBuildElements(projection);

  if (!isModal && _apiColGraphCy) { _apiColGraphCy.destroy(); _apiColGraphCy = null; }
  if (isModal  && _apiColGraphModalCy) { _apiColGraphModalCy.destroy(); _apiColGraphModalCy = null; }

  if (!isModal) {
    const stateEl = document.getElementById('api-col-graph-state');
    if (stateEl) stateEl.style.display = 'none';
    container.style.display = '';
  }

  /* global cytoscape */
  const cy = cytoscape({
    container:            container,
    elements:             elements,
    style:                _apiColGraphCyStyles(),
    layout:               _apiColGraphCyLayout(projection, isLarge),
    zoom:                 1,
    minZoom:              0.1,
    maxZoom:              4,
    userZoomingEnabled:   true,
    userPanningEnabled:   true,
    boxSelectionEnabled:  false,
  });

  cy.on('layoutstop', function() { cy.fit(undefined, 40); });

  if (!isModal) {
    cy.on('tap', 'node', function(evt) { _apiColGraphShowNodeDetail(evt.target.data()); });
    cy.on('tap', function(evt) { if (evt.target === cy) _apiColGraphHideNodeDetail(); });
    _apiColGraphCy = cy;
    _apiColGraphUpdateMeta(projection);
    _apiColGraphRenderHierarchy(projection);
    _apiColGraphEnableToolbarBtns(true);
  } else {
    _apiColGraphModalCy = cy;
  }
}

function _apiColGraphBuildElements(projection) {
  const elements = [];

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
    classes.push(node.isAutoPositioned ? 'node-auto' : 'node-stored');
    classes.push('nodetype-' + (node.nodeType || 'HTTP').toLowerCase());

    elements.push({
      data: {
        id:               node.id,
        label:            node.label || node.id,
        nodeType:         node.nodeType,
        layer:            node.layer,
        indexWithinLayer: node.indexWithinLayer,
        visualGroup:      node.visualGroup,
        hierarchyPath:    node.hierarchyPath ? node.hierarchyPath.join(' › ') : '',
        disabled:         node.disabled,
        isAutoPositioned: node.isAutoPositioned,
        posX:             node.position && node.position.x,
        posY:             node.position && node.position.y,
        parent:           parent,
      },
      position: { x: node.position ? node.position.x : 0, y: node.position ? node.position.y : 0 },
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
      shape: 'round-rectangle', width: 'label', height: 28, padding: '6px 10px',
      'background-color': '#2a2a30', 'border-color': '#f59e0b', 'border-width': 1.5,
      label: 'data(label)', 'font-size': 11, color: '#e2e8f0',
      'text-valign': 'center', 'text-halign': 'center',
      'text-wrap': 'ellipsis', 'text-max-width': 160, 'min-width': 80, cursor: 'pointer',
    }},
    { selector: 'node.nodetype-http',      style: { 'border-color': '#f59e0b' }},
    { selector: 'node.nodetype-assertion', style: { 'border-color': '#10b981' }},
    { selector: 'node.nodetype-extract',   style: { 'border-color': '#6366f1' }},
    { selector: 'node.nodetype-condition', style: { 'border-color': '#f472b6' }},
    { selector: 'node.nodetype-ai',        style: { 'border-color': '#e879f9' }},
    { selector: 'node.node-disabled',      style: { opacity: 0.4, 'border-style': 'dashed' }},
    { selector: 'node.node-auto',          style: { 'border-style': 'dashed', 'border-width': 1 }},
    { selector: 'node:selected',           style: { 'border-color': '#ffffff', 'border-width': 2.5, 'background-color': '#3a3a44' }},
    { selector: 'node:active',             style: { 'overlay-opacity': 0.1 }},
    { selector: 'node.cluster-node',       style: {
      'background-color': 'rgba(245,158,11,.06)', 'border-color': 'rgba(245,158,11,.3)',
      'border-width': 1, 'border-style': 'dashed', label: 'data(label)',
      'font-size': 10, color: '#6b7280', 'text-valign': 'top', 'text-halign': 'center', padding: 16,
    }},
    { selector: 'edge.workflow-edge',  style: {
      width: 1.5, 'line-color': '#555968', 'target-arrow-color': '#555968',
      'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.8,
    }},
    { selector: 'edge.edge-depends_on',    style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b', width: 2 }},
    { selector: 'edge.edge-inferred',      style: { 'line-style': 'dashed', 'line-color': '#555968', 'target-arrow-color': '#555968', width: 1.5 }},
    { selector: 'edge.edge-heuristic',     style: { 'line-style': 'dotted', opacity: 0.6 }},
    { selector: 'edge:selected',           style: { 'line-color': '#ffffff', 'target-arrow-color': '#ffffff' }},
  ];
}

function _apiColGraphCyLayout(projection, isLarge) {
  const strategy = projection.meta && projection.meta.projectionStrategy;
  if (strategy === 'stored') {
    return { name: 'preset', animate: false, fit: true, padding: 40 };
  }
  return {
    name: 'breadthfirst', directed: true,
    spacingFactor: isLarge ? 1.2 : 1.5,
    animate: false, padding: 40, avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
  };
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
  var col = _apiCols.find(function(c) { return c.id === collectionId; });
  var titleEl = document.getElementById('api-col-graph-modal-title');
  if (titleEl) titleEl.textContent = (col ? col.name : 'Workflow') + ' — Graph';
  document.getElementById('modal-api-col-graph').style.display = '';

  if (_apiColGraphProjection && _apiColGraphColId === collectionId) {
    setTimeout(function() { _apiColGraphRender(_apiColGraphProjection, true); }, 50);
  } else {
    fetch('/api/workflows/' + encodeURIComponent(collectionId) + '/graph')
      .then(function(r) { return r.json(); })
      .then(function(p) {
        _apiColGraphProjection = p;
        _apiColGraphColId = collectionId;
        setTimeout(function() { _apiColGraphRender(p, true); }, 50);
      })
      .catch(function(e) { console.error('Graph modal load error', e); });
  }
}

function apiColGraphModalClose() {
  document.getElementById('modal-api-col-graph').style.display = 'none';
  if (_apiColGraphModalCy) { _apiColGraphModalCy.destroy(); _apiColGraphModalCy = null; }
}

function apiColGraphModalFit() {
  if (_apiColGraphModalCy) _apiColGraphModalCy.fit(undefined, 40);
}
