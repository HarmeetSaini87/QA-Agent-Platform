// API ENVIRONMENTS MODULE
// ══════════════════════════════════════════════════════════════════════════════

let _apiEnvs = [];
let _editingApiEnvId = null;
let _apiEnvVars = []; // [{key, value, sensitive}]

async function apiEnvLoad() {
  if (!currentProjectId) { _apiEnvs = []; _apiEnvRender(); return; }
  try {
    const res = await fetch(`/api/api-envs?projectId=${encodeURIComponent(currentProjectId ?? '')}`);
    if (!res.ok) throw new Error(await res.text());
    _apiEnvs = await res.json();
    _apiEnvRender();
  } catch (e) {
    modAlert('api-env-list-alert', 'error', 'Load failed: ' + e.message);
  }
}

function _apiEnvRender() {
  const tbody = document.getElementById('api-env-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (_apiEnvs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No environments yet</td></tr>';
    return;
  }
  for (const env of _apiEnvs) {
    const tr = document.createElement('tr');
    const authType = env.authConfig?.type ?? 'none';
    const varCount = (env.variables ?? []).length;
    tr.innerHTML = `
      <td>${escHtml(env.name)}</td>
      <td style="font-family:monospace;font-size:12px">${escHtml(env.baseUrl)}</td>
      <td>${varCount} variable${varCount !== 1 ? 's' : ''}</td>
      <td><span class="badge badge-${authType === 'none' ? 'grey' : 'blue'}">${escHtml(authType)}</span></td>
      <td>
        <button class="tbl-btn" onclick="apiEnvOpenModal('${env.id}')">Edit</button>
        <button class="tbl-btn del" onclick="apiEnvDelete('${env.id}','${escHtml(env.name)}')">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }
}

function apiEnvOpenModal(id) {
  _editingApiEnvId = id ?? null;
  const env = id ? _apiEnvs.find(e => e.id === id) : null;
  document.getElementById('api-env-modal-title').textContent = id ? 'Edit Environment' : 'New Environment';
  document.getElementById('api-env-name').value = env?.name ?? '';
  document.getElementById('api-env-baseurl').value = env?.baseUrl ?? '';
  _apiEnvVars = (env?.variables ?? []).map(v => ({ ...v }));
  _apiEnvRenderVars();
  _apiEnvAuthRender(env?.authConfig ?? null);
  document.getElementById('api-env-modal-alert').textContent = '';
  openModal('modal-api-env');
}

function _apiEnvRenderVars() {
  const tbody = document.getElementById('api-env-vars-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  _apiEnvVars.forEach((v, i) => {
    const tr = document.createElement('tr');
    const displayVal = v.sensitive ? '••••••••' : escHtml(v.value);
    tr.innerHTML = `
      <td><input class="fm-input" style="width:100%" value="${escHtml(v.key)}"
        oninput="_apiEnvVarField(${i},'key',this.value)" placeholder="Variable name"/></td>
      <td><input class="fm-input" style="width:100%" value="${displayVal}" type="${v.sensitive ? 'password' : 'text'}"
        oninput="_apiEnvVarField(${i},'value',this.value)" placeholder="Value"/></td>
      <td style="text-align:center">
        <input type="checkbox" ${v.sensitive ? 'checked' : ''} onchange="_apiEnvVarField(${i},'sensitive',this.checked)" title="Sensitive"/>
      </td>
      <td><button class="tbl-btn del" onclick="_apiEnvVarRemove(${i})">✕</button></td>`;
    tbody.appendChild(tr);
  });
}

function _apiEnvVarField(i, field, val) {
  _apiEnvVars[i][field] = val;
  if (field === 'sensitive') _apiEnvRenderVars();
}
function _apiEnvVarRemove(i) { _apiEnvVars.splice(i, 1); _apiEnvRenderVars(); }
function apiEnvVarAdd() { _apiEnvVars.push({ key: '', value: '', sensitive: false }); _apiEnvRenderVars(); }

function _apiEnvAuthRender(authConfig) {
  const type = authConfig?.type ?? 'none';
  document.getElementById('api-env-auth-type').value = type;
  _apiEnvAuthToggle(type, authConfig);
}

function _apiEnvAuthToggle(type, cfg) {
  const panels = ['bearer', 'apikey', 'basic', 'oauth2cc'];
  for (const p of panels) {
    const el = document.getElementById('api-env-auth-' + p);
    if (el) el.style.display = p === type ? '' : 'none';
  }
  if (type === 'bearer' && cfg?.bearer) document.getElementById('api-env-bearer-token').value = cfg.bearer.token ?? '';
  if (type === 'apiKey' && cfg?.apiKey) {
    document.getElementById('api-env-apikey-header').value = cfg.apiKey.header ?? '';
    document.getElementById('api-env-apikey-value').value = cfg.apiKey.value ?? '';
  }
  if (type === 'basic' && cfg?.basic) {
    document.getElementById('api-env-basic-user').value = cfg.basic.username ?? '';
    document.getElementById('api-env-basic-pass').value = cfg.basic.password ?? '';
  }
  if (type === 'oauth2CC' && cfg?.oauth2CC) {
    document.getElementById('api-env-oauth-tokenurl').value = cfg.oauth2CC.tokenUrl ?? '';
    document.getElementById('api-env-oauth-clientid').value = cfg.oauth2CC.clientId ?? '';
    document.getElementById('api-env-oauth-secret').value = cfg.oauth2CC.clientSecret ?? '';
    document.getElementById('api-env-oauth-scope').value = cfg.oauth2CC.scope ?? '';
  }
}

function apiEnvAuthTypeChange(sel) { _apiEnvAuthToggle(sel.value, null); }

function _apiEnvBuildAuthConfig() {
  const type = document.getElementById('api-env-auth-type').value;
  if (type === 'none') return { type: 'none' };
  if (type === 'bearer') return { type: 'bearer', bearer: { token: document.getElementById('api-env-bearer-token').value } };
  if (type === 'apiKey') return { type: 'apiKey', apiKey: { header: document.getElementById('api-env-apikey-header').value, value: document.getElementById('api-env-apikey-value').value } };
  if (type === 'basic') return { type: 'basic', basic: { username: document.getElementById('api-env-basic-user').value, password: document.getElementById('api-env-basic-pass').value } };
  if (type === 'oauth2CC') return { type: 'oauth2CC', oauth2CC: { tokenUrl: document.getElementById('api-env-oauth-tokenurl').value, clientId: document.getElementById('api-env-oauth-clientid').value, clientSecret: document.getElementById('api-env-oauth-secret').value, scope: document.getElementById('api-env-oauth-scope').value } };
  return { type: 'none' };
}

async function apiEnvSave() {
  const name = document.getElementById('api-env-name').value.trim();
  const baseUrl = document.getElementById('api-env-baseurl').value.trim();
  if (!name || !baseUrl) { modAlert('api-env-modal-alert', 'error', 'Name and Base URL are required'); return; }
  const body = { name, baseUrl, variables: _apiEnvVars, authConfig: _apiEnvBuildAuthConfig(), projectId: currentProjectId };
  const method = _editingApiEnvId ? 'PUT' : 'POST';
  const url = _editingApiEnvId ? `/api/api-envs/${_editingApiEnvId}` : '/api/api-envs';
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Save failed');
    closeModal('modal-api-env');
    await apiEnvLoad();
  } catch (e) {
    modAlert('api-env-modal-alert', 'error', e.message);
  }
}

async function apiEnvDelete(id, name) {
  if (!confirm(`Delete environment "${name}"?`)) return;
  await fetch(`/api/api-envs/${id}`, { method: 'DELETE' });
  await apiEnvLoad();
}

function apiEnvCloseModal() { closeModal('modal-api-env'); _editingApiEnvId = null; }
