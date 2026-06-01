// API ENVIRONMENTS MODULE — Enterprise No-Code Edition
// ══════════════════════════════════════════════════════════════════════════════

let _apiEnvs = [];
let _editingApiEnvId = null;
let _apiEnvVars = []; // [{key, value, sensitive, category}]
let _wizardStep = 1;
let _pingInProgress = {};

// ── Load & Render ─────────────────────────────────────────────────────────────

async function apiEnvLoad() {
  if (!currentProjectId) { _apiEnvs = []; _apiEnvRender(); return; }
  try {
    const res = await fetch(`/api/api-envs?projectId=${encodeURIComponent(currentProjectId ?? '')}`);
    if (!res.ok) throw new Error(await res.text());
    _apiEnvs = await res.json();
    _apiEnvRender();
  } catch (e) {
    modAlert('api-env-list-alert', 'error', 'Could not load environments: ' + e.message);
  }
}

function _apiEnvRender() {
  const container = document.getElementById('api-env-cards');
  if (!container) return;

  const searchVal = (document.getElementById('api-env-search')?.value ?? '').toLowerCase();
  const filterType = document.getElementById('api-env-filter-type')?.value ?? '';

  let envs = _apiEnvs;
  if (searchVal) envs = envs.filter(e => e.name.toLowerCase().includes(searchVal) || (e.description ?? '').toLowerCase().includes(searchVal));
  if (filterType) envs = envs.filter(e => (e.envType ?? 'custom') === filterType);

  container.innerHTML = '';

  if (envs.length === 0) {
    container.innerHTML = `
      <div class="api-env-empty">
        <div class="api-env-empty-icon">🌐</div>
        <div class="api-env-empty-title">No environments yet</div>
        <div class="api-env-empty-sub">Create your first environment to start testing your API</div>
        <button class="btn btn-primary" onclick="apiEnvOpenModal()">+ New Environment</button>
      </div>`;
    return;
  }

  for (const env of envs) {
    container.appendChild(_apiEnvBuildCard(env));
  }
}

function _apiEnvBuildCard(env) {
  const card = document.createElement('div');
  card.className = 'api-env-card';
  card.setAttribute('data-id', env.id);

  const typeLabel = { development: 'Development', staging: 'Staging', production: 'Production', custom: 'Custom' }[env.envType ?? 'custom'] ?? 'Custom';
  const typeClass = { development: 'env-type-dev', staging: 'env-type-staging', production: 'env-type-prod', custom: 'env-type-custom' }[env.envType ?? 'custom'] ?? 'env-type-custom';
  const authLabel = _authTypeLabel(env.authConfig?.type ?? 'none');
  const varCount = (env.variables ?? []).length;
  const tags = (env.tags ?? []).map(t => `<span class="env-tag">${escHtml(t)}</span>`).join('');

  // ping status
  const ping = env.lastPingResult;
  let pingDot = '<span class="ping-dot ping-unknown" title="Not tested yet">●</span>';
  if (ping) {
    if (ping.reachable) pingDot = `<span class="ping-dot ping-online" title="Online · ${ping.latencyMs}ms · tested ${_relTime(ping.testedAt)}">●</span>`;
    else pingDot = `<span class="ping-dot ping-offline" title="Unreachable · tested ${_relTime(ping.testedAt)}">●</span>`;
  }

  card.innerHTML = `
    <div class="env-card-banner ${typeClass}">
      <span class="env-type-badge">${typeLabel}</span>
      ${pingDot}
    </div>
    <div class="env-card-body">
      <div class="env-card-name">${escHtml(env.name)}</div>
      ${env.description ? `<div class="env-card-desc">${escHtml(env.description)}</div>` : ''}
      <div class="env-card-url" title="${escHtml(env.baseUrl)}">🔗 ${escHtml(env.baseUrl)}</div>
      <div class="env-card-meta">
        <span class="env-meta-pill">🔑 ${authLabel}</span>
        <span class="env-meta-pill">⚙️ ${varCount} value${varCount !== 1 ? 's' : ''}</span>
      </div>
      ${tags ? `<div class="env-tags">${tags}</div>` : ''}
    </div>
    <div class="env-card-actions">
      <button class="env-action-btn env-action-test" onclick="apiEnvPing('${env.id}')" title="Test Connection">
        <span id="ping-btn-${env.id}">⚡ Test</span>
      </button>
      <button class="env-action-btn env-action-clone" onclick="apiEnvClone('${env.id}')" title="Clone this environment">📋 Clone</button>
      <button class="env-action-btn env-action-promote" onclick="apiEnvPromoteOpen('${env.id}')" title="Copy settings to another environment">🚀 Promote</button>
      <button class="env-action-btn env-action-edit" onclick="apiEnvOpenModal('${env.id}')">✏️ Edit</button>
      <button class="env-action-btn env-action-del" onclick="apiEnvDelete('${env.id}','${escHtml(env.name)}')">🗑</button>
    </div>`;

  return card;
}

function _authTypeLabel(type) {
  return { none: 'No Login', bearer: 'Token (Bearer)', apiKey: 'API Key', basic: 'Username & Password', oauth2CC: 'Auto-Login (OAuth2)' }[type] ?? type;
}

function _relTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

// ── Search & Filter ───────────────────────────────────────────────────────────

function apiEnvSearch() { _apiEnvRender(); }
function apiEnvFilterType() { _apiEnvRender(); }

// ── Ping / Connection Test ────────────────────────────────────────────────────

async function apiEnvPing(id) {
  if (_pingInProgress[id]) return;
  _pingInProgress[id] = true;
  const btn = document.getElementById(`ping-btn-${id}`);
  if (btn) btn.textContent = '⏳ Testing…';
  try {
    const res = await fetch(`/api/api-envs/${id}/ping`, { method: 'POST' });
    const data = await res.json();
    const env = _apiEnvs.find(e => e.id === id);
    if (env) env.lastPingResult = data;
    // re-render just this card
    const card = document.querySelector(`.api-env-card[data-id="${id}"]`);
    if (card) card.replaceWith(_apiEnvBuildCard(env));
  } catch (e) {
    if (btn) btn.textContent = '⚡ Test';
  } finally {
    _pingInProgress[id] = false;
  }
}

// ── Clone ─────────────────────────────────────────────────────────────────────

async function apiEnvClone(id) {
  try {
    const res = await fetch(`/api/api-envs/${id}/clone`, { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error);
    await apiEnvLoad();
  } catch (e) {
    modAlert('api-env-list-alert', 'error', 'Clone failed: ' + e.message);
  }
}

// ── Promote ───────────────────────────────────────────────────────────────────

function apiEnvPromoteOpen(sourceId) {
  const source = _apiEnvs.find(e => e.id === sourceId);
  if (!source) return;
  const others = _apiEnvs.filter(e => e.id !== sourceId);
  if (others.length === 0) { modAlert('api-env-list-alert', 'warn', 'No other environments to promote to. Create a target environment first.'); return; }

  document.getElementById('promote-source-name').textContent = source.name;
  const sel = document.getElementById('promote-target-select');
  sel.innerHTML = others.map(e => `<option value="${e.id}">${escHtml(e.name)}</option>`).join('');
  sel.setAttribute('data-source', sourceId);
  document.getElementById('promote-diff-area').innerHTML = '';
  document.getElementById('promote-confirm-btn').style.display = 'none';
  openModal('modal-api-env-promote');
}

async function apiEnvPromotePreview() {
  const sel = document.getElementById('promote-target-select');
  const sourceId = sel.getAttribute('data-source');
  const targetId = sel.value;
  try {
    // dry run — just compute diff without saving by reading both environments
    const source = _apiEnvs.find(e => e.id === sourceId);
    const target = _apiEnvs.find(e => e.id === targetId);
    const sourceVars = source?.variables ?? [];
    const targetVars = target?.variables ?? [];
    const rows = sourceVars.map(sv => {
      const tv = targetVars.find(v => v.key === sv.key);
      const fromVal = tv ? (tv.sensitive ? '••••••••' : tv.value) : '<em>not set</em>';
      const toVal = sv.sensitive ? '••••••••' : sv.value;
      const isNew = !tv;
      return `<tr>
        <td>${escHtml(sv.key)}</td>
        <td>${fromVal}</td>
        <td>${toVal}</td>
        <td><span class="badge ${isNew ? 'badge-blue' : 'badge-grey'}">${isNew ? 'New' : 'Update'}</span></td>
      </tr>`;
    });
    document.getElementById('promote-diff-area').innerHTML = rows.length
      ? `<table class="tbl" style="margin-top:8px"><thead><tr><th>Setting</th><th>Current in Target</th><th>Will be set to</th><th>Action</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
      : '<p style="color:var(--text-muted)">No configuration values to promote.</p>';
    document.getElementById('promote-confirm-btn').style.display = '';
  } catch (e) {
    modAlert('api-env-list-alert', 'error', e.message);
  }
}

async function apiEnvPromoteConfirm() {
  const sel = document.getElementById('promote-target-select');
  const sourceId = sel.getAttribute('data-source');
  const targetId = sel.value;
  try {
    const res = await fetch(`/api/api-envs/${sourceId}/promote`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetEnvId: targetId })
    });
    if (!res.ok) throw new Error((await res.json()).error);
    closeModal('modal-api-env-promote');
    await apiEnvLoad();
    modAlert('api-env-list-alert', 'success', 'Settings promoted successfully.');
  } catch (e) {
    modAlert('api-env-list-alert', 'error', 'Promote failed: ' + e.message);
  }
}

// ── Delete (with usage check) ─────────────────────────────────────────────────

async function apiEnvDelete(id, name) {
  try {
    const usageRes = await fetch(`/api/api-envs/${id}/usage`);
    const usage = await usageRes.json();
    let msg = `Delete environment "${name}"?`;
    if (usage.count > 0) {
      const names = usage.collections.map(c => `"${c.name}"`).join(', ');
      msg = `"${name}" is used by ${usage.count} collection${usage.count !== 1 ? 's' : ''}: ${names}.\n\nDeleting it will affect those tests. Continue?`;
    }
    if (!confirm(msg)) return;
    await fetch(`/api/api-envs/${id}`, { method: 'DELETE' });
    await apiEnvLoad();
  } catch (e) {
    modAlert('api-env-list-alert', 'error', 'Delete failed: ' + e.message);
  }
}

// ── Wizard Modal ──────────────────────────────────────────────────────────────

function apiEnvOpenModal(id) {
  _editingApiEnvId = id ?? null;
  const env = id ? _apiEnvs.find(e => e.id === id) : null;
  document.getElementById('api-env-modal-title').textContent = id ? 'Edit Environment' : 'New Environment';
  document.getElementById('api-env-modal-alert').textContent = '';

  // Step 1 — Identity
  document.getElementById('api-env-name').value = env?.name ?? '';
  document.getElementById('api-env-description').value = env?.description ?? '';
  document.getElementById('api-env-tags').value = (env?.tags ?? []).join(', ');
  _wizardSetEnvType(env?.envType ?? 'development');

  // Step 2 — Connection
  document.getElementById('api-env-baseurl').value = env?.baseUrl ?? '';
  _apiEnvClearPingInline();

  // Step 3 — Security & Variables
  _apiEnvVars = (env?.variables ?? []).map(v => ({ ...v, category: v.category ?? 'custom' }));
  _apiEnvRenderVars();
  _apiEnvAuthRender(env?.authConfig ?? null);

  _wizardGoto(1);
  openModal('modal-api-env');
}

function _wizardSetEnvType(type) {
  document.querySelectorAll('.env-type-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.env-type-card[data-type="${type}"]`);
  if (card) card.classList.add('selected');
  const hidden = document.getElementById('api-env-type');
  if (hidden) hidden.value = type;
}

function apiEnvSelectType(type) { _wizardSetEnvType(type); }

function _wizardGoto(step) {
  _wizardStep = step;
  [1, 2, 3].forEach(s => {
    const panel = document.getElementById(`wizard-step-${s}`);
    if (panel) panel.style.display = s === step ? '' : 'none';
  });
  document.querySelectorAll('.wizard-step-indicator').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === step);
    el.classList.toggle('done', i + 1 < step);
  });
  document.getElementById('wizard-back-btn').style.display = step > 1 ? '' : 'none';
  document.getElementById('wizard-next-btn').textContent = step === 3 ? 'Save Environment' : 'Next →';
}

function apiEnvWizardBack() {
  if (_wizardStep > 1) _wizardGoto(_wizardStep - 1);
}

function apiEnvWizardNext() {
  if (_wizardStep === 1) {
    const name = document.getElementById('api-env-name').value.trim();
    if (!name) { modAlert('api-env-modal-alert', 'error', 'Environment name is required'); return; }
    _wizardGoto(2);
  } else if (_wizardStep === 2) {
    const baseUrl = document.getElementById('api-env-baseurl').value.trim();
    if (!baseUrl) { modAlert('api-env-modal-alert', 'error', 'Server address is required'); return; }
    _wizardGoto(3);
  } else {
    apiEnvSave();
  }
}

// ── Inline Ping (Step 2) ──────────────────────────────────────────────────────

function _apiEnvClearPingInline() {
  const el = document.getElementById('api-env-ping-inline');
  if (el) el.innerHTML = '';
}

async function apiEnvPingInline() {
  const baseUrl = document.getElementById('api-env-baseurl').value.trim();
  if (!baseUrl) { modAlert('api-env-modal-alert', 'error', 'Enter server address first'); return; }
  const el = document.getElementById('api-env-ping-inline');
  if (el) el.innerHTML = '<span style="color:var(--text-muted)">⏳ Testing connection…</span>';

  if (_editingApiEnvId) {
    // test existing env
    const res = await fetch(`/api/api-envs/${_editingApiEnvId}/ping`, { method: 'POST' }).catch(() => null);
    if (!res) { if (el) el.innerHTML = '<span class="ping-inline-fail">❌ Could not reach server</span>'; return; }
    const data = await res.json();
    if (el) el.innerHTML = data.reachable
      ? `<span class="ping-inline-ok">✅ Online · ${data.latencyMs}ms · HTTP ${data.statusCode}</span>`
      : `<span class="ping-inline-fail">❌ Unreachable · ${data.error ?? ''}</span>`;
  } else {
    // test ad-hoc via a lightweight HEAD fetch from browser
    try {
      const start = Date.now();
      await fetch(baseUrl, { method: 'HEAD', mode: 'no-cors' });
      const ms = Date.now() - start;
      if (el) el.innerHTML = `<span class="ping-inline-ok">✅ Server responded · ~${ms}ms</span>`;
    } catch {
      if (el) el.innerHTML = '<span class="ping-inline-fail">❌ Could not reach server — check the address</span>';
    }
  }
}

// ── Postman Environment Import — fully client-side, no backend call needed ─────

const _TOKEN_RE   = /token|jwt|bearer|auth|session/i;
const _SECRET_RE  = /secret|password|passwd|apikey|api_key|accesstoken|access_token|private|credential/i;
const _URL_RE     = /url|host|endpoint|base|server|domain/i;
const _FLAG_RE    = /flag|feature|toggle|enable|disable/i;

function _classifyVar(key) {
  if (_URL_RE.test(key))    return { category: 'url',        sensitive: false };
  if (_TOKEN_RE.test(key))  return { category: 'credential', sensitive: true  };
  if (_SECRET_RE.test(key)) return { category: 'credential', sensitive: true  };
  if (_FLAG_RE.test(key))   return { category: 'flag',       sensitive: false };
  return                           { category: 'custom',     sensitive: false };
}

function _parsePostmanEnvJson(json) {
  // Validate it looks like a Postman environment file
  if (!json.values || !Array.isArray(json.values)) {
    throw new Error('This does not look like a Postman Environment file. Make sure you export from Postman → Environments → Export.');
  }

  const variables = json.values
    .filter(v => v.enabled !== false && v.key)
    .map(v => {
      const cls = _classifyVar(v.key);
      return { key: v.key, value: v.value ?? '', ...cls };
    });

  const urlVar = variables.find(v => v.category === 'url');
  const baseUrl = urlVar?.value ?? '';

  let envType = 'custom';
  if (/stg|staging/i.test(baseUrl))   envType = 'staging';
  else if (/prod|live/i.test(baseUrl)) envType = 'production';
  else if (/dev|local/i.test(baseUrl)) envType = 'development';

  return { envName: json.name ?? '', baseUrl, envType, variables };
}

function _applyParsedEnvData(data) {
  // Auto-fill Step 1 & 2 if empty
  const nameEl = document.getElementById('api-env-name');
  const urlEl  = document.getElementById('api-env-baseurl');
  if (nameEl && !nameEl.value && data.envName) nameEl.value = data.envName;
  if (urlEl  && !urlEl.value  && data.baseUrl) urlEl.value  = data.baseUrl;
  if (data.envType) _wizardSetEnvType(data.envType);

  // Merge variables — skip keys already present
  const existingKeys = new Set(_apiEnvVars.map(v => v.key));
  let added = 0;
  for (const v of data.variables) {
    if (!existingKeys.has(v.key)) {
      _apiEnvVars.push(v);
      existingKeys.add(v.key);
      added++;
    }
  }
  return added;
}

function apiEnvTriggerPostmanImport() {
  const input = document.getElementById('api-env-postman-file');
  if (input) { input.value = ''; input.click(); }
}

async function apiEnvHandlePostmanFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  await _processPostmanFile(file);
}

async function _processPostmanFile(file) {
  const previewArea = document.getElementById('api-env-import-preview');
  const zone = document.getElementById('api-env-import-zone');
  previewArea.innerHTML = '<p style="color:var(--text-muted);font-size:13px">⏳ Reading file…</p>';
  if (zone) zone.classList.remove('drag-over');

  try {
    const text = await file.text();
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error('File is not valid JSON. Make sure you export from Postman → Environments → ··· menu → Export.');
    }

    const data = _parsePostmanEnvJson(json);
    const added = _applyParsedEnvData(data);

    previewArea.innerHTML = _buildSmartPreviewHtml(data, added);
    _apiEnvRenderVars();
  } catch (e) {
    previewArea.innerHTML = `<div class="smart-preview-error">❌ ${escHtml(e.message)}</div>`;
  }
}

function _buildSmartPreviewHtml(data, added) {
  if (!data.variables.length) return '<p class="smart-preview-empty">No variables found in this file.</p>';

  const categoryLabel = { url: '🌐 URL', credential: '🔑 Credential', flag: '🚩 Flag', custom: '⚙️ Custom' };

  const rows = data.variables.map(v => {
    const catLabel = categoryLabel[v.category] ?? v.category;
    const secretBadge = v.sensitive ? '<span class="smart-badge smart-badge-secret">🔒 Hidden in reports</span>' : '';
    const displayVal = v.sensitive
      ? '••••••••'
      : (!v.value ? '<em style="color:var(--text-muted)">auto-filled at runtime</em>'
                  : escHtml(v.value.slice(0, 48) + (v.value.length > 48 ? '…' : '')));
    return `<tr>
      <td><strong>${escHtml(v.key)}</strong></td>
      <td>${catLabel}</td>
      <td style="font-size:12px;font-family:monospace">${displayVal}</td>
      <td>${secretBadge}</td>
    </tr>`;
  }).join('');

  const baseUrlRow = data.baseUrl
    ? `<div class="smart-preview-row">🌐 <strong>Server address</strong> detected: <code>${escHtml(data.baseUrl)}</code></div>`
    : '';
  const envTypeRow = (data.envType && data.envType !== 'custom')
    ? `<div class="smart-preview-row">🏷️ Environment type detected as <strong>${data.envType}</strong></div>`
    : '';

  return `
    <div class="smart-preview-box">
      <div class="smart-preview-title">✅ We found ${data.variables.length} setting${data.variables.length !== 1 ? 's' : ''} — ${added} added below</div>
      ${baseUrlRow}${envTypeRow}
      <table class="tbl smart-preview-table">
        <thead><tr><th>Setting Name</th><th>Type We Detected</th><th>Value</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="smart-preview-note">💡 Review the table below. You can change the type or value of any setting before saving.</p>
    </div>`;
}

// ── Drag and Drop support ─────────────────────────────────────────────────────

function apiEnvImportZoneDragOver(e) {
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('api-env-import-zone')?.classList.add('drag-over');
}

function apiEnvImportZoneDragLeave(e) {
  e.preventDefault();
  document.getElementById('api-env-import-zone')?.classList.remove('drag-over');
}

async function apiEnvImportZoneDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) {
    document.getElementById('api-env-import-preview').innerHTML =
      '<div class="smart-preview-error">❌ Please drop a .json file exported from Postman.</div>';
    document.getElementById('api-env-import-zone')?.classList.remove('drag-over');
    return;
  }
  await _processPostmanFile(file);
}

// ── Variables ─────────────────────────────────────────────────────────────────

const _VAR_TYPE_TIPS = {
  url:        { icon: '🌐', title: 'URL', desc: 'A web address used in your tests — like a server link or an endpoint. Not secret.' },
  credential: { icon: '🔑', title: 'Credential', desc: 'A password, token, API key, or any secret code. Always kept hidden in reports.' },
  flag:       { icon: '🚩', title: 'Feature Flag', desc: 'A true/false switch that turns a feature on or off during testing.' },
  custom:     { icon: '⚙️', title: 'Custom', desc: 'Any other setting that does not fit the above categories.' },
};

function _varTypeTooltipIcon(cat) {
  const tip = _VAR_TYPE_TIPS[cat] || _VAR_TYPE_TIPS.custom;
  return `<span class="vtt-icon" title="${tip.title}: ${tip.desc}">ℹ️</span>`;
}

function _apiEnvRenderVars() {
  const tbody = document.getElementById('api-env-vars-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  _apiEnvVars.forEach((v, i) => {
    const tr = document.createElement('tr');
    const displayVal = v.sensitive ? '' : escHtml(v.value);
    tr.innerHTML = `
      <td class="var-type-cell">
        <select class="fm-input fm-select-sm" onchange="_apiEnvVarField(${i},'category',this.value)">
          <option value="url" ${v.category==='url'?'selected':''}>🌐 URL</option>
          <option value="credential" ${v.category==='credential'?'selected':''}>🔑 Credential</option>
          <option value="flag" ${v.category==='flag'?'selected':''}>🚩 Feature Flag</option>
          <option value="custom" ${v.category==='custom'?'selected':''}>⚙️ Custom</option>
        </select>
        <span class="var-type-tooltip" data-cat="${v.category ?? 'custom'}">${_varTypeTooltipIcon(v.category)}</span>
      </td>
      <td><input class="fm-input" style="width:100%" value="${escHtml(v.key)}"
        oninput="_apiEnvVarField(${i},'key',this.value)" placeholder="Setting name"/></td>
      <td><input class="fm-input" style="width:100%" value="${displayVal}" type="${v.sensitive ? 'password' : 'text'}"
        oninput="_apiEnvVarField(${i},'value',this.value)" placeholder="Value"/></td>
      <td style="text-align:center">
        <label class="toggle-label" title="Keep this value secret in reports">
          <input type="checkbox" ${v.sensitive ? 'checked' : ''} onchange="_apiEnvVarField(${i},'sensitive',this.checked)"/>
          <span class="toggle-text">Secret</span>
        </label>
      </td>
      <td><button class="tbl-btn del" onclick="_apiEnvVarRemove(${i})" title="Remove">✕</button></td>`;
    tbody.appendChild(tr);
  });
}

function _apiEnvVarField(i, field, val) {
  _apiEnvVars[i][field] = val;
  if (field === 'sensitive') _apiEnvRenderVars();
}
function _apiEnvVarRemove(i) { _apiEnvVars.splice(i, 1); _apiEnvRenderVars(); }
function apiEnvVarAdd() { _apiEnvVars.push({ key: '', value: '', sensitive: false, category: 'custom' }); _apiEnvRenderVars(); }

function apiEnvVarBulkImport() {
  const raw = document.getElementById('api-env-bulk-import')?.value?.trim() ?? '';
  if (!raw) return;
  raw.split('\n').forEach(line => {
    const idx = line.indexOf('=');
    if (idx < 1) return;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) _apiEnvVars.push({ key, value, sensitive: false, category: 'custom' });
  });
  if (document.getElementById('api-env-bulk-import')) document.getElementById('api-env-bulk-import').value = '';
  _apiEnvRenderVars();
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function _apiEnvAuthRender(authConfig) {
  const type = authConfig?.type ?? 'none';
  document.querySelectorAll('.auth-type-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.auth-type-card[data-auth="${type}"]`);
  if (card) card.classList.add('selected');
  const hidden = document.getElementById('api-env-auth-type');
  if (hidden) hidden.value = type;
  _apiEnvAuthToggle(type, authConfig);
}

function apiEnvSelectAuth(type) {
  document.querySelectorAll('.auth-type-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.auth-type-card[data-auth="${type}"]`);
  if (card) card.classList.add('selected');
  const hidden = document.getElementById('api-env-auth-type');
  if (hidden) hidden.value = type;
  _apiEnvAuthToggle(type, null);
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

// OLD: apiEnvAuthTypeChange(sel) — replaced by card-based selection
// function apiEnvAuthTypeChange(sel) { _apiEnvAuthToggle(sel.value, null); }

function _apiEnvBuildAuthConfig() {
  const type = document.getElementById('api-env-auth-type').value;
  if (type === 'none') return { type: 'none' };
  if (type === 'bearer') return { type: 'bearer', bearer: { token: document.getElementById('api-env-bearer-token').value } };
  if (type === 'apiKey') return { type: 'apiKey', apiKey: { header: document.getElementById('api-env-apikey-header').value, value: document.getElementById('api-env-apikey-value').value } };
  if (type === 'basic') return { type: 'basic', basic: { username: document.getElementById('api-env-basic-user').value, password: document.getElementById('api-env-basic-pass').value } };
  if (type === 'oauth2CC') return { type: 'oauth2CC', oauth2CC: { tokenUrl: document.getElementById('api-env-oauth-tokenurl').value, clientId: document.getElementById('api-env-oauth-clientid').value, clientSecret: document.getElementById('api-env-oauth-secret').value, scope: document.getElementById('api-env-oauth-scope').value } };
  return { type: 'none' };
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function apiEnvSave() {
  const name = document.getElementById('api-env-name').value.trim();
  const baseUrl = document.getElementById('api-env-baseurl').value.trim();
  if (!name || !baseUrl) { modAlert('api-env-modal-alert', 'error', 'Name and server address are required'); return; }

  const tagsRaw = document.getElementById('api-env-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

  const body = {
    name,
    baseUrl,
    description: document.getElementById('api-env-description').value.trim(),
    envType: document.getElementById('api-env-type').value || 'custom',
    tags,
    variables: _apiEnvVars,
    authConfig: _apiEnvBuildAuthConfig(),
    projectId: currentProjectId
  };
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

function apiEnvCloseModal() { closeModal('modal-api-env'); _editingApiEnvId = null; }
function apiEnvClosePromoteModal() { closeModal('modal-api-env-promote'); }
