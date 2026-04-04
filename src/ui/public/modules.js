/**
 * modules.js
 * Admin Panel, Projects, Locator Repo, Common Functions, Auth check/logout
 * Loaded after app.js in index.html
 */
'use strict';

// ── Auth bootstrap ─────────────────────────────────────────────────────────────

let currentUser = null;   // { userId, username, role }

async function authBootstrap() {
  try {
    const res  = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login'; return; }
    currentUser = await res.json();
    document.getElementById('sidebar-username').textContent = currentUser.username;
    document.getElementById('sidebar-role').textContent     = currentUser.role;

    // Show/hide admin-only elements
    if (currentUser.role !== 'admin') {
      document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }

    // Populate project dropdown
    await projDropdownLoad();
    // Enforce project selection on initial tab
    const initTab = document.querySelector('.nav-item.active')?.dataset?.tab || '';
    _guardCheck(initTab);
  } catch {
    window.location.href = '/login';
  }
}

async function doLogout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login';
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function modAlert(containerId, type, msg) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.className = `alert-${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}

function modClearAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) { el.style.display = 'none'; el.textContent = ''; }
}

function openModal(id)  { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Admin sub-tab switcher ─────────────────────────────────────────────────────

function adminSubTab(name, btn) {
  document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`admin-${name}`).classList.add('active');
  if (name === 'users')    usersLoad();
  if (name === 'audit')    auditLoad();
  if (name === 'settings') settingsLoad();
}

// ══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

let editingUserId = null;

async function usersLoad() {
  const res   = await fetch('/api/admin/users');
  const users = await res.json();
  const tbody = document.getElementById('user-tbody');
  if (!tbody) return;
  tbody.innerHTML = users.map(u => `
    <tr>
      <td><strong>${escHtml(u.username)}</strong></td>
      <td>${escHtml(u.email || '—')}</td>
      <td><span class="badge badge-${u.role}">${escHtml(u.role)}</span></td>
      <td><span class="badge badge-${u.isActive ? 'active' : 'inactive'}">${u.isActive ? 'Active' : 'Disabled'}</span></td>
      <td>${formatDate(u.lastLogin)}</td>
      <td>
        <button class="tbl-btn" onclick="userEdit('${escHtml(u.id)}')">Edit</button>
        <button class="tbl-btn del" onclick="userDelete('${escHtml(u.id)}','${escHtml(u.username)}')">Del</button>
      </td>
    </tr>`).join('');
}

function userOpenModal(userId = null) {
  editingUserId = userId;
  modClearAlert('user-modal-alert');
  document.getElementById('user-modal-title').textContent = userId ? 'Edit User' : 'Add User';
  if (!userId) {
    document.getElementById('um-username').value = '';
    document.getElementById('um-email').value    = '';
    document.getElementById('um-role').value     = 'tester';
    document.getElementById('um-password').value = '';
    document.getElementById('um-force-change').checked = true;
    document.getElementById('um-username').disabled = false;
  }
  openModal('modal-user');
}

async function userEdit(id) {
  const res  = await fetch('/api/admin/users');
  const list = await res.json();
  const u    = list.find(x => x.id === id);
  if (!u) return;
  editingUserId = id;
  document.getElementById('user-modal-title').textContent = 'Edit User';
  document.getElementById('um-username').value            = u.username;
  document.getElementById('um-username').disabled         = true;
  document.getElementById('um-email').value               = u.email || '';
  document.getElementById('um-role').value                = u.role;
  document.getElementById('um-password').value            = '';
  document.getElementById('um-force-change').checked      = !!u.forcePasswordChange;
  modClearAlert('user-modal-alert');
  openModal('modal-user');
}

async function userSave() {
  modClearAlert('user-modal-alert');
  const body = {
    username:            document.getElementById('um-username').value.trim(),
    email:               document.getElementById('um-email').value.trim(),
    role:                document.getElementById('um-role').value,
    password:            document.getElementById('um-password').value,
    forcePasswordChange: document.getElementById('um-force-change').checked,
  };
  if (!body.username) { modAlert('user-modal-alert','error','Username is required'); return; }
  if (!editingUserId && !body.password) { modAlert('user-modal-alert','error','Password is required for new users'); return; }

  const method = editingUserId ? 'PUT' : 'POST';
  const url    = editingUserId ? `/api/admin/users/${editingUserId}` : '/api/admin/users';
  const res    = await fetch(url, { method, headers: { 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  const data   = await res.json();
  if (!res.ok) { modAlert('user-modal-alert','error', data.error || 'Error saving user'); return; }
  userCloseModal();
  usersLoad();
}

async function userDelete(id, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
  if (res.ok) usersLoad();
  else { const d = await res.json(); alert(d.error); }
}

function userCloseModal() { closeModal('modal-user'); editingUserId = null; }

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ══════════════════════════════════════════════════════════════════════════════

let auditPage = 1;

async function auditLoad(page = 1) {
  auditPage = page;
  const res  = await fetch(`/api/admin/audit?page=${page}&size=50`);
  const data = await res.json();
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;

  tbody.innerHTML = data.entries.map(e => `
    <tr>
      <td style="white-space:nowrap">${formatDate(e.createdAt)}</td>
      <td>${escHtml(e.username || '—')}</td>
      <td><code style="font-size:11px">${escHtml(e.action)}</code></td>
      <td>${escHtml(e.resourceType ? `${e.resourceType}:${e.resourceId}` : '—')}</td>
      <td>${escHtml(e.ip || '—')}</td>
    </tr>`).join('');

  const pg = document.getElementById('audit-pagination');
  if (pg) {
    const totalPages = Math.ceil(data.total / data.size);
    pg.innerHTML = `
      <button class="tbl-btn" ${page <= 1 ? 'disabled' : ''} onclick="auditLoad(${page-1})">← Prev</button>
      <span style="font-size:12px;color:var(--neutral-500)">Page ${page} / ${totalPages} &nbsp;(${data.total} entries)</span>
      <button class="tbl-btn" ${page >= totalPages ? 'disabled' : ''} onclick="auditLoad(${page+1})">Next →</button>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

async function settingsLoad() {
  const res  = await fetch('/api/admin/settings');
  const data = await res.json();
  document.getElementById('set-app-name').value    = data.appName ?? '';
  document.getElementById('set-timeout').value     = data.sessionTimeoutMinutes ?? 60;
  document.getElementById('set-max-logins').value  = data.maxFailedLogins ?? 5;
  document.getElementById('set-allow-reg').checked = !!data.allowRegistration;
}

async function settingsSave() {
  modClearAlert('settings-alert');
  const body = {
    appName:               document.getElementById('set-app-name').value.trim(),
    sessionTimeoutMinutes: parseInt(document.getElementById('set-timeout').value) || 60,
    maxFailedLogins:       parseInt(document.getElementById('set-max-logins').value) || 5,
    allowRegistration:     document.getElementById('set-allow-reg').checked,
  };
  const res  = await fetch('/api/admin/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) modAlert('settings-alert','success','Settings saved successfully');
  else        modAlert('settings-alert','error', data.error || 'Error saving settings');
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════════════════════════════
// Common Data
// ══════════════════════════════════════════════════════════════════════════════

let editingCdId = null;

async function cdLoad() {
  const tbody = document.getElementById('cd-tbody');
  if (!tbody) return;
  if (!currentProjectId) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">Select a project first.</td></tr>';
    return;
  }
  const env = document.getElementById('cd-env-filter')?.value || '';
  const qs  = `?projectId=${encodeURIComponent(currentProjectId)}${env ? '&environment=' + encodeURIComponent(env) : ''}`;
  const res  = await fetch(`/api/common-data${qs}`);
  const list = await res.json();

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">No data entries yet. Click <strong>+ Add Common Data</strong> to create one.</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(d => `
    <tr>
      <td><code style="background:var(--neutral-100);padding:2px 6px;border-radius:3px;font-size:12.5px">\${${escHtml(d.dataName)}}</code></td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(d.value)}">${escHtml(d.value)}</td>
      <td><span class="badge badge-${d.environment === 'PROD' ? 'fail' : d.environment === 'UAT' ? 'medium' : 'active'}">${escHtml(d.environment)}</span></td>
      <td>${escHtml(d.createdBy || '—')}</td>
      <td>${formatDate(d.createdAt)}</td>
      <td>
        <button class="tbl-btn" onclick="cdEdit('${escHtml(d.id)}')">Edit</button>
        <button class="tbl-btn del" onclick="cdDelete('${escHtml(d.id)}','${escHtml(d.dataName)}')">Delete</button>
      </td>
    </tr>`).join('');
}

function cdOpenModal(id = null) {
  editingCdId = id;
  modClearAlert('cd-modal-alert');
  document.getElementById('cd-modal-title').textContent = id ? 'Edit Common Data' : 'Add Common Data';
  if (!id) {
    document.getElementById('cd-name').value  = '';
    document.getElementById('cd-value').value = '';
    document.getElementById('cd-env').value   = 'QA';
  }
  openModal('modal-common-data');
}

async function cdEdit(id) {
  const env = document.getElementById('cd-env-filter')?.value || '';
  const qs  = `?projectId=${encodeURIComponent(currentProjectId)}${env ? '&environment=' + encodeURIComponent(env) : ''}`;
  const res  = await fetch(`/api/common-data${qs}`);
  const list = await res.json();
  const d    = list.find(x => x.id === id);
  if (!d) return;
  editingCdId = id;
  document.getElementById('cd-modal-title').textContent = 'Edit Common Data';
  document.getElementById('cd-name').value  = d.dataName;
  document.getElementById('cd-value').value = d.value;
  document.getElementById('cd-env').value   = d.environment;
  modClearAlert('cd-modal-alert');
  openModal('modal-common-data');
}

async function cdSave() {
  modClearAlert('cd-modal-alert');
  const dataName    = document.getElementById('cd-name').value.trim();
  const value       = document.getElementById('cd-value').value.trim();
  const environment = document.getElementById('cd-env').value;
  if (!dataName)    { modAlert('cd-modal-alert', 'error', 'Data Name is required'); return; }
  if (!environment) { modAlert('cd-modal-alert', 'error', 'Environment is required'); return; }
  if (!currentProjectId) { modAlert('cd-modal-alert', 'error', 'Select a project first'); return; }

  const body   = { projectId: currentProjectId, dataName, value, environment };
  const method = editingCdId ? 'PUT'  : 'POST';
  const url    = editingCdId ? `/api/common-data/${editingCdId}` : '/api/common-data';
  const res    = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data   = await res.json();
  if (!res.ok) { modAlert('cd-modal-alert', 'error', data.error || 'Error saving'); return; }
  cdCloseModal();
  cdLoad();
}

async function cdDelete(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  await fetch(`/api/common-data/${id}`, { method: 'DELETE' });
  cdLoad();
}

function cdCloseModal() { closeModal('modal-common-data'); editingCdId = null; }

// ══════════════════════════════════════════════════════════════════════════════

let editingProjectId = null;

async function projLoad() {
  const url = currentUser?.role === 'admin' ? '/api/projects/all' : '/api/projects';
  const res  = await fetch(url);
  const list = await res.json();
  const el   = document.getElementById('proj-list');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="builder-hint">No projects yet. Click <strong>+ New Project</strong> to create one.</div>'; return; }

  el.innerHTML = list.map(p => {
    const envs = (p.environments || []);
    return `
    <div class="project-card">
      <div class="project-card-header">
        <div style="flex:1">
          <div class="project-name">${escHtml(p.name)}</div>
          ${p.description ? `<div style="font-size:12px;color:var(--neutral-500);margin-top:2px">${escHtml(p.description)}</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            ${envs.map(e => `<span class="cred-chip" title="${escHtml(e.url)}">${escHtml(e.name)}: ${escHtml(e.url)}</span>`).join('')}
            ${!envs.length ? '<span style="font-size:12px;color:var(--neutral-400)">No environments configured</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--neutral-400);margin-top:4px">
            TC Prefix: <strong>${escHtml(p.tcIdPrefix || 'TC')}</strong> &nbsp;·&nbsp; Next ID: <strong>${escHtml(p.tcIdPrefix || 'TC')}-${String(p.tcIdCounter || 1).padStart(2,'0')}</strong>
          </div>
        </div>
        <div style="flex-shrink:0;display:flex;gap:6px;align-items:center">
          <span class="badge badge-${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'Active' : 'Inactive'}</span>
          <button class="tbl-btn" onclick="projEdit('${escHtml(p.id)}')">Edit</button>
          <button class="tbl-btn del" onclick="projDelete('${escHtml(p.id)}','${escHtml(p.name)}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function projOpenModal(id = null) {
  editingProjectId = id;
  modClearAlert('proj-modal-alert');
  document.getElementById('proj-modal-title').textContent = id ? 'Edit Project' : 'New Project';
  if (!id) {
    document.getElementById('pm-name').value   = '';
    document.getElementById('pm-prefix').value = '';
    document.getElementById('pm-desc').value   = '';
    document.getElementById('proj-envs').innerHTML = '';
  }
  openModal('modal-project');
}

async function projEdit(id) {
  const res  = await fetch('/api/projects/all');
  const list = await res.json();
  const p    = list.find(x => x.id === id);
  if (!p) return;
  editingProjectId = id;
  document.getElementById('proj-modal-title').textContent = 'Edit Project';
  document.getElementById('pm-name').value   = p.name;
  document.getElementById('pm-prefix').value = p.tcIdPrefix || '';
  document.getElementById('pm-desc').value   = p.description || '';
  const envsEl = document.getElementById('proj-envs');
  envsEl.innerHTML = '';
  (p.environments || []).forEach(e => projAddEnv(e.id, e.name, e.url));
  modClearAlert('proj-modal-alert');
  openModal('modal-project');
}

function projAddEnv(id = '', name = '', url = '') {
  const row = document.createElement('div');
  row.className = 'env-row';
  row.dataset.envId = id || ('env-' + Date.now());
  row.innerHTML = `
    <input class="fm-input env-name" placeholder="e.g. QA, DEV, UAT" value="${escHtml(name)}" style="width:130px" />
    <input class="fm-input env-url" placeholder="https://your-app-url.com" value="${escHtml(url)}" style="flex:1" />
    <button type="button" class="step-btn del" onclick="this.parentElement.remove()" title="Remove">✕</button>`;
  document.getElementById('proj-envs').appendChild(row);
}

async function projSave() {
  modClearAlert('proj-modal-alert');
  const name   = document.getElementById('pm-name').value.trim();
  const prefix = document.getElementById('pm-prefix').value.trim().toUpperCase();
  if (!name)   { modAlert('proj-modal-alert','error','Project name is required'); return; }
  if (!prefix) { modAlert('proj-modal-alert','error','TC ID Prefix is required'); return; }

  const environments = [...document.querySelectorAll('#proj-envs .env-row')].map(row => ({
    id:   row.dataset.envId || ('env-' + Date.now() + Math.random()),
    name: row.querySelector('.env-name').value,
    url:  row.querySelector('.env-url').value.trim(),
  })).filter(e => e.url);

  const body = {
    name, tcIdPrefix: prefix,
    description: document.getElementById('pm-desc').value.trim(),
    environments,
  };
  const method = editingProjectId ? 'PUT' : 'POST';
  const apiUrl = editingProjectId ? `/api/projects/${editingProjectId}` : '/api/projects';
  const res  = await fetch(apiUrl, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('proj-modal-alert','error', data.error || 'Error'); return; }
  projCloseModal();
  projLoad();
}

async function projDelete(id, name) {
  if (!confirm(`Delete project "${name}"?`)) return;
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  projLoad();
}

function projCloseModal() { closeModal('modal-project'); editingProjectId = null; }

// ══════════════════════════════════════════════════════════════════════════════
// LOCATOR REPOSITORY
// ══════════════════════════════════════════════════════════════════════════════

let allLocators = [];
let editingLocatorId = null;

async function locatorLoad() {
  const url = currentProjectId
    ? `/api/locators?projectId=${encodeURIComponent(currentProjectId)}`
    : '/api/locators';
  const res = await fetch(url);
  allLocators = await res.json();
  locatorRender();
}

function locatorRender() {
  const nameF   = (document.getElementById('loc-filter-name')?.value   ?? '').toLowerCase();
  const moduleF = (document.getElementById('loc-filter-module')?.value ?? '').toLowerCase();
  const filtered = allLocators.filter(l =>
    (!nameF   || l.name.toLowerCase().includes(nameF)) &&
    (!moduleF || (l.pageModule || '').toLowerCase().includes(moduleF))
  );
  const tbody = document.getElementById('loc-tbody');
  if (!tbody) return;
  tbody.innerHTML = filtered.map(l => `
    <tr>
      <td><strong>${escHtml(l.name)}</strong></td>
      <td><code style="font-size:11.5px">${escHtml(l.selector)}</code></td>
      <td><span class="badge badge-tester">${escHtml(l.selectorType)}</span></td>
      <td>${escHtml(l.pageModule || '—')}</td>
      <td>${escHtml(l.description || '—')}</td>
      <td>
        <button class="tbl-btn" onclick="locatorEdit('${escHtml(l.id)}')">Edit</button>
        <button class="tbl-btn del" onclick="locatorDelete('${escHtml(l.id)}','${escHtml(l.name)}')">Del</button>
      </td>
    </tr>`).join('');
  if (!filtered.length) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">No locators found</td></tr>';
}

function locatorOpenModal(id = null) {
  editingLocatorId = id;
  modClearAlert('loc-modal-alert');
  document.getElementById('loc-modal-title').textContent = id ? 'Edit Locator' : 'Add Locator';
  if (!id) {
    ['loc-name','loc-selector','loc-page','loc-desc'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('loc-type').value = 'css';
  }
  openModal('modal-locator');
}

async function locatorEdit(id) {
  const loc = allLocators.find(l => l.id === id);
  if (!loc) return;
  editingLocatorId = id;
  document.getElementById('loc-modal-title').textContent = 'Edit Locator';
  document.getElementById('loc-name').value     = loc.name;
  document.getElementById('loc-selector').value = loc.selector;
  document.getElementById('loc-type').value     = loc.selectorType;
  document.getElementById('loc-page').value     = loc.pageModule || '';
  document.getElementById('loc-desc').value     = loc.description || '';
  modClearAlert('loc-modal-alert');
  openModal('modal-locator');
}

async function locatorSave() {
  modClearAlert('loc-modal-alert');
  const name     = document.getElementById('loc-name').value.trim();
  const selector = document.getElementById('loc-selector').value.trim();
  if (!name || !selector) { modAlert('loc-modal-alert','error','Name and Selector are required'); return; }

  const body = {
    name, selector,
    selectorType: document.getElementById('loc-type').value,
    pageModule:   document.getElementById('loc-page').value.trim(),
    description:  document.getElementById('loc-desc').value.trim(),
    projectId:    currentProjectId || null,
  };
  const method = editingLocatorId ? 'PUT' : 'POST';
  const url    = editingLocatorId ? `/api/locators/${editingLocatorId}` : '/api/locators';
  const res    = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data   = await res.json();
  if (!res.ok) { modAlert('loc-modal-alert','error', data.error || 'Error'); return; }
  locatorCloseModal();
  await locatorLoad();
}

async function locatorDelete(id, name) {
  if (!confirm(`Delete locator "${name}"?`)) return;
  await fetch(`/api/locators/${id}`, { method: 'DELETE' });
  await locatorLoad();
}

function locatorCloseModal() { closeModal('modal-locator'); editingLocatorId = null; }

// ── Locator picker popup (called from TC Builder step selector field) ──────────

let _locatorPickerCallback = null;

function locatorPickerOpen(callback) {
  _locatorPickerCallback = callback;
  document.getElementById('loc-picker-search').value = '';
  locatorPickerFilter();
  openModal('modal-locator-picker');
}

function locatorPickerClose() { closeModal('modal-locator-picker'); _locatorPickerCallback = null; }

function locatorPickerFilter() {
  const q   = document.getElementById('loc-picker-search').value.toLowerCase();
  const el  = document.getElementById('loc-picker-list');
  const filtered = allLocators.filter(l =>
    !q || l.name.toLowerCase().includes(q) || l.selector.toLowerCase().includes(q) || (l.pageModule || '').toLowerCase().includes(q)
  );
  el.innerHTML = filtered.map(l => `
    <div class="loc-pick-item" onclick="locatorPickerSelect('${escHtml(l.id)}')">
      <div class="loc-pick-name">${escHtml(l.name)}</div>
      <div class="loc-pick-sel">${escHtml(l.selector)}</div>
      ${l.pageModule ? `<div class="loc-pick-page">${escHtml(l.pageModule)}</div>` : ''}
    </div>`).join('');
  if (!filtered.length) el.innerHTML = '<div style="padding:12px;color:var(--neutral-400);font-size:13px">No locators found</div>';
}

function locatorPickerSelect(id) {
  const loc = allLocators.find(l => l.id === id);
  if (loc && _locatorPickerCallback) _locatorPickerCallback(loc.selector, loc.selectorType, loc.name);
  locatorPickerClose();
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMON FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════

let allFunctions = [];
let editingFnId  = null;

async function fnLoad() {
  const url = currentProjectId
    ? `/api/functions?projectId=${encodeURIComponent(currentProjectId)}`
    : '/api/functions';
  const res = await fetch(url);
  allFunctions = await res.json();
  fnRender();
}

function fnRender() {
  const tbody = document.getElementById('fn-tbody');
  if (!tbody) return;
  const q = (document.getElementById('fn-search')?.value || '').toLowerCase();
  const list = allFunctions.filter(f =>
    !q || f.name.toLowerCase().includes(q) || (f.identifier||'').toLowerCase().includes(q) || (f.description||'').toLowerCase().includes(q)
  );
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:24px">
      ${allFunctions.length ? 'No functions match the search.' : 'No functions yet. Click <strong>+ New Function</strong> to create one.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(f => `
    <tr>
      <td style="font-weight:600">${escHtml(f.name)}</td>
      <td><code style="background:var(--neutral-100);padding:2px 7px;border-radius:4px;font-size:12.5px">${escHtml(f.identifier || '—')}</code></td>
      <td style="color:var(--neutral-500);font-size:12.5px">${escHtml(f.description || '—')}</td>
      <td style="text-align:center">${f.steps.length}</td>
      <td>${escHtml(f.createdBy || '—')}</td>
      <td>${formatDate(f.createdAt)}</td>
      <td>
        <button class="tbl-btn" onclick="fnEdit('${escHtml(f.id)}')">Edit</button>
        <button class="tbl-btn del" onclick="fnDelete('${escHtml(f.id)}','${escHtml(f.name)}')">Delete</button>
      </td>
    </tr>`).join('');
}

async function fnOpenModal(id = null) {
  await keywordsLoad();
  editingFnId = id;
  modClearAlert('fn-modal-alert');
  document.getElementById('fn-modal-title').textContent = id ? 'Edit Function' : 'New Function';
  if (!id) {
    document.getElementById('fn-name').value       = '';
    document.getElementById('fn-identifier').value = '';
    document.getElementById('fn-desc').value       = '';
    document.getElementById('fn-steps-container').innerHTML = '';
    fnAddStep();
  }
  openModal('modal-function');
}

async function fnEdit(id) {
  await keywordsLoad();
  const fn = allFunctions.find(f => f.id === id);
  if (!fn) return;
  editingFnId = id;
  document.getElementById('fn-modal-title').textContent = 'Edit Function';
  document.getElementById('fn-name').value       = fn.name;
  document.getElementById('fn-identifier').value = fn.identifier || '';
  document.getElementById('fn-desc').value       = fn.description || '';
  const container = document.getElementById('fn-steps-container');
  container.innerHTML = '';
  (fn.steps || []).forEach(s => fnAddStep(s));
  modClearAlert('fn-modal-alert');
  openModal('modal-function');
}

function fnAddStep(step = {}) {
  const container = document.getElementById('fn-steps-container');
  const idx = container.querySelectorAll('.fn-step-card').length;

  // GOTO excluded — URL navigation should not be inside reusable functions
  const kwOptions = scriptKeywords.categories.map(cat => {
    const opts = cat.keywords
      .filter(kw => kw.key !== 'GOTO' && kw.key !== 'CALL FUNCTION')
      .map(kw =>
        `<option value="${escHtml(kw.key)}"` +
        ` data-nl="${kw.needsLocator}" data-nv="${kw.needsValue}" data-hint="${escHtml(kw.valueHint)}"` +
        ` data-help="${escHtml(kw.helpLabel || '')}" data-tooltip-json="${escHtml(JSON.stringify(kw.tooltip || {}))}"` +
        ` data-auto="false"` +
        `${step.keyword === kw.key ? ' selected' : ''}>${escHtml(kw.label)}</option>`
      ).join('');
    return opts ? `<optgroup label="${escHtml(cat.name)}">${opts}</optgroup>` : '';
  }).join('');

  const locTypes = (scriptKeywords.locatorTypes || []);
  const locTypeOpts = locTypes.map(lt =>
    `<option value="${escHtml(lt.value)}"${step.locatorType === lt.value ? ' selected' : ''}>${escHtml(lt.label)}</option>`
  ).join('');

  const curKw    = _seKwGet(step.keyword);
  const needsLoc = curKw ? curKw.needsLocator : true;
  const isAuto   = curKw?.autoFromProject || false;
  const helpLbl  = curKw?.helpLabel || '';
  const tipObj   = curKw?.tooltip || null;
  const tipJson  = (tipObj && (tipObj.what || tipObj.example || tipObj.tip)) ? JSON.stringify(tipObj) : '';

  const row = document.createElement('div');
  row.className = 'fn-step-card';
  row.innerHTML = `
    <div class="step-actions-top">
      <button type="button" class="step-action-btn step-del-icon" onclick="fnStepDelete(this)" title="Delete Step">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    </div>
    <div class="step-row-header">
      <span class="step-num">${idx + 1}</span>
      <select class="fm-select fn-step-kw-select" style="flex:1;font-size:12.5px" onchange="fnStepKwChange(this)">${kwOptions}</select>
    </div>
    <div class="step-help-row"${helpLbl ? '' : ' style="display:none"'}>
      <span class="step-help-label">${escHtml(helpLbl)}</span>
      <span class="step-tooltip-trigger" data-tooltip-json="${escHtml(tipJson)}" onmouseenter="_kwTipShow(this)" onmouseleave="_kwTipHide()"${tipJson ? '' : ' style="display:none"'}>?</span>
    </div>
    <div class="fn-step-auto-badge"${isAuto ? '' : ' style="display:none"'}>
      <span class="auto-config-badge">&#x2699; Auto from Project Config — URL &amp; credentials fetched automatically</span>
    </div>
    <div class="step-row-fields">
      <div class="fn-step-locator"${needsLoc && !isAuto ? '' : ' style="display:none"'}>
        <div class="field" style="margin:0 0 6px 0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <label style="font-size:11px;margin:0">Locator Name</label>
            <span class="loc-repo-badge" style="display:none">From Repo</span>
            <button type="button" class="loc-unlock-btn" style="display:none" onclick="fnStepUnlockLoc(this)" title="Unlock to edit manually">&#x270E; Edit</button>
          </div>
          <div style="display:flex;gap:4px">
            <input class="fm-input fn-step-loc-name" style="flex:1;font-size:12px"
                   placeholder="e.g. LoginButton" value="${escHtml(step.locatorName ?? step.detail ?? '')}" />
            <button type="button" class="tbl-btn" style="padding:5px 8px;font-size:13px;flex-shrink:0"
                    onclick="fnStepPickLoc(this)" title="Pick from Locator Repo">&#x1F50D;</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:start">
          <div class="field" style="margin:0;flex-shrink:0;width:130px"><label style="font-size:11px">Locator Type</label>
            <select class="fm-select fn-step-loc-type" style="font-size:11.5px">${locTypeOpts}</select>
          </div>
          <div class="field" style="margin:0;flex:1"><label style="font-size:11px">Locator Value</label>
            <input class="fm-input fn-step-selector" style="font-size:12px;font-family:monospace"
                   placeholder="e.g. #btn-login" value="${escHtml(step.selector ?? '')}" />
          </div>
        </div>
      </div>
    </div>
    <div class="step-row-bottom">
      <input class="fm-input fn-step-desc" style="flex:1;font-size:12px" placeholder="Step description (optional)"
             value="${escHtml(step.description ?? step.detail ?? '')}" />
    </div>`;

  container.appendChild(row);
  fnStepKwChange(row.querySelector('.fn-step-kw-select'));
  fnReorderNums();
}

function fnStepKwChange(sel) {
  const row  = sel.closest('.fn-step-card');
  const opt  = sel.selectedOptions[0];
  const needsLoc  = opt?.dataset.nl === 'true';
  const isAuto    = opt?.dataset.auto === 'true';
  const helpText  = opt?.dataset.help || '';
  const tipJson   = opt?.dataset.tooltipJson || '';

  row.querySelector('.fn-step-locator').style.display = (needsLoc && !isAuto) ? '' : 'none';
  row.querySelector('.fn-step-auto-badge').style.display = isAuto ? '' : 'none';

  const helpRow = row.querySelector('.step-help-row');
  if (helpRow) {
    helpRow.style.display = helpText ? '' : 'none';
    const lbl = helpRow.querySelector('.step-help-label');
    if (lbl) lbl.textContent = helpText;
    const tip = helpRow.querySelector('.step-tooltip-trigger');
    if (tip) { tip.dataset.tooltipJson = tipJson; tip.style.display = tipJson ? '' : 'none'; }
  }

}

function fnStepPickLoc(btn) {
  const row = btn.closest('.fn-step-card');
  locatorPickerOpen((selector, selectorType, name) => {
    const nameInput = row.querySelector('.fn-step-loc-name');
    if (nameInput) nameInput.value = name || '';
    row.querySelector('.fn-step-selector').value = selector || '';
    const typeSelect = row.querySelector('.fn-step-loc-type');
    if (typeSelect && selectorType) typeSelect.value = selectorType;
    _fnStepLockLocator(row, true);
  });
}

function _fnStepLockLocator(row, locked) {
  const nameInput  = row.querySelector('.fn-step-loc-name');
  const valInput   = row.querySelector('.fn-step-selector');
  const typeSelect = row.querySelector('.fn-step-loc-type');
  const lockBadge  = row.querySelector('.loc-repo-badge');
  const unlockBtn  = row.querySelector('.loc-unlock-btn');
  if (nameInput)  { nameInput.readOnly = locked;  nameInput.classList.toggle('loc-locked', locked); }
  if (valInput)   { valInput.readOnly  = locked;  valInput.classList.toggle('loc-locked', locked); }
  if (typeSelect) { typeSelect.disabled = locked;  typeSelect.classList.toggle('loc-locked', locked); }
  if (lockBadge)  lockBadge.style.display = locked ? '' : 'none';
  if (unlockBtn)  unlockBtn.style.display = locked ? '' : 'none';
}

function fnStepUnlockLoc(btn) {
  const row = btn.closest('.fn-step-card');
  _fnStepLockLocator(row, false);
}

function fnStepDelete(btn) {
  btn.closest('.fn-step-card').remove();
  fnReorderNums();
}

function fnReorderNums() {
  document.querySelectorAll('#fn-steps-container .fn-step-card').forEach((row, i) => {
    const n = row.querySelector('.step-num');
    if (n) n.textContent = i + 1;
  });
}

async function fnSave() {
  modClearAlert('fn-modal-alert');
  const name       = document.getElementById('fn-name').value.trim();
  const identifier = document.getElementById('fn-identifier').value.trim();
  if (!name)       { modAlert('fn-modal-alert','error','Function name is required'); return; }
  if (!identifier) { modAlert('fn-modal-alert','error','Identifier is required'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) { modAlert('fn-modal-alert','error','Identifier must be alphanumeric and underscores only'); return; }

  const steps = [...document.querySelectorAll('#fn-steps-container .fn-step-card')].map((row, i) => {
    return {
      order:       i + 1,
      keyword:     row.querySelector('.fn-step-kw-select')?.value || '',
      locatorName: row.querySelector('.fn-step-loc-name')?.value?.trim() || null,
      locatorType: row.querySelector('.fn-step-loc-type')?.value || 'css',
      selector:    row.querySelector('.fn-step-selector')?.value?.trim() || null,
      description: row.querySelector('.fn-step-desc')?.value?.trim() || '',
    };
  }).filter(s => s.keyword);

  if (!steps.length) { modAlert('fn-modal-alert','error','At least one step is required'); return; }

  const body   = { name, identifier, description: document.getElementById('fn-desc').value.trim(), steps, projectId: currentProjectId || null };
  const method = editingFnId ? 'PUT' : 'POST';
  const url    = editingFnId ? `/api/functions/${editingFnId}` : '/api/functions';
  const res    = await fetch(url, { method, headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data   = await res.json();
  if (!res.ok) { modAlert('fn-modal-alert','error', data.error || 'Error'); return; }

  // Auto-sync locators to Locator Repository (map selector→locator for shared sync fn)
  await _syncLocatorsToRepo(steps.map(s => ({
    locatorName: s.locatorName,
    locator: s.selector,
    locatorType: s.locatorType,
    description: s.description,
  })));

  fnCloseModal();
  fnLoad();
}

async function fnDelete(id, name) {
  if (!confirm(`Delete function "${name}"?`)) return;
  await fetch(`/api/functions/${id}`, { method: 'DELETE' });
  fnLoad();
}

function fnCloseModal() { closeModal('modal-function'); editingFnId = null; }

// ══════════════════════════════════════════════════════════════════════════════
// Tab switch integration — load data on first visit
// ══════════════════════════════════════════════════════════════════════════════

const _panelLoaded = new Set();

// Tabs where the project dropdown is irrelevant and should be hidden
const _HIDE_PROJ_DROPDOWN_TABS = new Set(['projects', 'admin']);

function onModuleTabSwitch(tab) {
  if (tab === 'admin')     usersLoad();
  if (tab === 'projects')  projLoad();
  if (tab === 'locators')   locatorLoad();
  if (tab === 'functions')  fnLoad();
  if (tab === 'commondata') cdLoad();
  if (tab === 'scripts')    scriptLoad();
  if (tab === 'suites')     suiteLoad();
  if (tab === 'admin' && !_panelLoaded.has('admin')) adminSubTab('users', document.querySelector('.sub-tab'));
  _panelLoaded.add(tab);

  // Hide project dropdown on admin/project management tabs
  const projWidget = document.getElementById('global-project-select')?.closest('div');
  if (projWidget) projWidget.style.display = _HIDE_PROJ_DROPDOWN_TABS.has(tab) ? 'none' : '';
  const projLabel = projWidget?.previousElementSibling;
  if (projLabel) projLabel.style.display = _HIDE_PROJ_DROPDOWN_TABS.has(tab) ? 'none' : '';
}

// Hook wired in DOMContentLoaded (see bottom of file) after app.js sets its final switchTab

// ══════════════════════════════════════════════════════════════════════════════
// TC Builder: inject locator picker button into step selector fields
// ══════════════════════════════════════════════════════════════════════════════

// Called by builderAddStep after rendering step content
function injectLocatorPickerBtn(stepRow) {
  const selectorInput = stepRow.querySelector('.step-selector');
  if (!selectorInput) return;
  if (stepRow.querySelector('.loc-pick-btn')) return; // already injected

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'loc-pick-btn tbl-btn';
  btn.title = 'Pick from Locator Repo';
  btn.textContent = '🔍';
  btn.style.cssText = 'padding:5px 7px;font-size:13px;margin-left:4px;flex-shrink:0';
  btn.onclick = () => {
    locatorPickerOpen((selector, type, name) => {
      selectorInput.value = selector;
      const typeEl = stepRow.querySelector('.step-fieldtype');
      // Map selectorType to fieldType roughly
      if (typeEl && type === 'css') { /* keep existing */ }
    });
  };
  selectorInput.parentElement?.appendChild(btn) || selectorInput.insertAdjacentElement('afterend', btn);
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT DROPDOWN + ISOLATION
// ══════════════════════════════════════════════════════════════════════════════

let allProjects      = [];
let currentProjectId = '';

async function projDropdownLoad() {
  const res = await fetch('/api/projects');
  allProjects = await res.json();
  const sel = document.getElementById('global-project-select');
  if (!sel) return;
  const active = allProjects.filter(p => p.isActive);
  sel.innerHTML = '<option value="">— Select Project —</option>' +
    active.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
  if (active.length === 1) { sel.value = active[0].id; onProjectChange(); }
}

// Panels that require a project to be selected before any interaction
const PROJECT_SCOPED_TABS = new Set(['scripts','suites','locators','functions','commondata','history']);

const _PROJ_BANNER_ID = 'proj-required-banner';

function _guardCheck(tab) {
  _removeProjBanner();
  if (!PROJECT_SCOPED_TABS.has(tab)) { _projDropdownNormal(); return; }
  if (!currentProjectId) { _showProjBanner(); _projDropdownPulse(); }
  else                   { _projDropdownNormal(); }
}

function _showProjBanner() {
  if (document.getElementById(_PROJ_BANNER_ID)) return;
  const panel = document.querySelector('.panel.active');
  if (!panel) return;
  const banner = document.createElement('div');
  banner.id = _PROJ_BANNER_ID;
  banner.className = 'proj-required-banner';
  banner.innerHTML = `<span>⚠️ Select a <strong>Project</strong> from the dropdown in the top bar before using this module.</span>`;
  panel.insertBefore(banner, panel.firstChild);
}

function _removeProjBanner() {
  document.getElementById(_PROJ_BANNER_ID)?.remove();
}

function _projDropdownPulse() {
  document.getElementById('global-project-select')?.classList.add('proj-select-required');
}

function _projDropdownNormal() {
  document.getElementById('global-project-select')?.classList.remove('proj-select-required');
}

function onProjectChange() {
  currentProjectId = document.getElementById('global-project-select')?.value || '';
  const activeTab  = document.querySelector('.nav-item.active')?.dataset?.tab || '';
  _guardCheck(activeTab);
  _toggleModuleAddButtons(!!currentProjectId);
  scriptLoad();
  suiteLoad();
  locatorLoadScoped();
  fnLoad();
  cdLoad();
  histLoad();
}

function _toggleModuleAddButtons(enabled) {
  ['btn-new-script','btn-new-suite','btn-add-locator','btn-new-function','btn-add-cd'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !enabled;
  });
}

async function locatorLoadScoped() {
  const url = currentProjectId
    ? `/api/locators?projectId=${encodeURIComponent(currentProjectId)}`
    : '/api/locators';
  const res = await fetch(url);
  allLocators = await res.json();
  locatorRender();
}

// ══════════════════════════════════════════════════════════════════════════════
// KEYWORD REGISTRY
// ══════════════════════════════════════════════════════════════════════════════

let scriptKeywords = { categories: [], dynamicTokens: [] };

async function keywordsLoad() {
  if (scriptKeywords.categories.length) return;
  try {
    const res = await fetch('/api/keywords/playwright');
    if (res.ok) scriptKeywords = await res.json();
  } catch { /* non-fatal */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST SCRIPT BUILDER
// ══════════════════════════════════════════════════════════════════════════════

let allScripts      = [];
let editingScriptId = null;

async function scriptLoad() {
  const emptyEl = document.getElementById('script-list-empty');
  const listEl  = document.getElementById('script-list');
  if (!currentProjectId) {
    if (emptyEl) emptyEl.style.display = '';
    if (listEl)  listEl.innerHTML = '';
    allScripts = [];
    return;
  }
  const res = await fetch(`/api/scripts?projectId=${encodeURIComponent(currentProjectId)}`);
  allScripts = await res.json();
  scriptRender();
}

function scriptRender() {
  const qTitle = (document.getElementById('script-filter-title')?.value ?? '').toLowerCase();
  const qTag   = (document.getElementById('script-filter-tag')?.value ?? '').toLowerCase();
  const qComp  = (document.getElementById('script-filter-comp')?.value ?? '').toLowerCase();
  const listEl  = document.getElementById('script-list');
  const emptyEl = document.getElementById('script-list-empty');
  if (!listEl) return;
  if (!currentProjectId) { emptyEl.style.display = ''; listEl.innerHTML = ''; return; }
  emptyEl.style.display = 'none';
  const filtered = allScripts.filter(s => {
    if (qTitle && !s.title.toLowerCase().includes(qTitle)) return false;
    if (qTag   && !(s.tags || []).some(t => t.toLowerCase().includes(qTag))) return false;
    if (qComp  && !(s.component || '').toLowerCase().includes(qComp)) return false;
    return true;
  });
  if (!filtered.length) {
    listEl.innerHTML = '<div class="builder-hint">No scripts match the filter.</div>';
    return;
  }
  listEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 2px 8px">
      <label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer">
        <input type="checkbox" id="script-select-all" onchange="scriptSelectAll(this)" /> Select All
      </label>
      <button class="tbl-btn del" id="script-bulk-del-btn" style="display:none" onclick="scriptDeleteSelected()">Delete Selected</button>
      <span id="script-sel-count" style="font-size:12px;color:var(--neutral-400)"></span>
    </div>
    <table class="data-tbl" style="width:100%">
      <thead><tr>
        <th style="width:32px"></th>
        <th style="width:90px">TC ID</th>
        <th>Title</th>
        <th style="width:140px">Component</th>
        <th style="width:160px">Tag</th>
        <th style="width:100px">Priority</th>
        <th style="width:110px">Created By</th>
        <th style="width:110px">Created Date</th>
        <th style="width:110px">Actions</th>
      </tr></thead>
      <tbody>
      ${filtered.map(s => `
        <tr class="script-tbl-row" data-id="${escHtml(s.id)}">
          <td><input type="checkbox" class="script-row-chk" value="${escHtml(s.id)}" onchange="scriptSelectionChanged()" /></td>
          <td><span style="font-family:monospace;font-weight:600;color:var(--primary);font-size:12.5px">${escHtml(s.tcId || '—')}</span></td>
          <td><div style="font-weight:500">${escHtml(s.title)}</div></td>
          <td>${escHtml(s.component || '—')}</td>
          <td>${(s.tags||[]).length ? (s.tags||[]).map(t=>`<span class="badge badge-tester">${escHtml(t)}</span>`).join(' ') : '—'}</td>
          <td><span class="badge badge-${escHtml(s.priority)}">${escHtml(s.priority)}</span></td>
          <td style="font-size:12px">${escHtml(s.createdBy || '—')}</td>
          <td style="font-size:12px">${formatDate(s.createdAt)}</td>
          <td>
            <div style="display:flex;gap:4px">
              <button class="tbl-btn" onclick="scriptOpenEditor('${escHtml(s.id)}')">Edit</button>
              <button class="tbl-btn del" onclick="scriptDelete('${escHtml(s.id)}','${escHtml(s.title)}')">Delete</button>
            </div>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}

function scriptSelectAll(chk) {
  document.querySelectorAll('.script-row-chk').forEach(c => c.checked = chk.checked);
  scriptSelectionChanged();
}

function scriptSelectionChanged() {
  const checked = [...document.querySelectorAll('.script-row-chk:checked')];
  const allChk  = document.getElementById('script-select-all');
  const allBoxes = document.querySelectorAll('.script-row-chk');
  if (allChk) allChk.indeterminate = checked.length > 0 && checked.length < allBoxes.length;
  const delBtn  = document.getElementById('script-bulk-del-btn');
  const countEl = document.getElementById('script-sel-count');
  if (delBtn)  delBtn.style.display = checked.length > 0 ? '' : 'none';
  if (countEl) countEl.textContent  = checked.length > 0 ? `${checked.length} selected` : '';
}

async function scriptDeleteSelected() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} script${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
  await Promise.all(ids.map(id => fetch(`/api/scripts/${id}`, { method: 'DELETE' })));
  await scriptLoad();
}

async function scriptOpenEditor(id = null) {
  await keywordsLoad();
  if (!allFunctions.length) { try { await fnLoad(); } catch {} }
  editingScriptId = id;
  document.getElementById('script-editor-title').textContent = id ? 'Edit Script' : 'New Script';
  modClearAlert('script-editor-alert');
  document.getElementById('se-steps-container').innerHTML = '';
  document.getElementById('se-steps-hint').style.display = '';

  if (id) {
    const sc = allScripts.find(s => s.id === id);
    if (!sc) return;
    document.getElementById('se-component').value = sc.component || '';
    document.getElementById('se-title').value      = sc.title;
    document.getElementById('se-desc').value       = sc.description || '';
    document.getElementById('se-priority').value   = sc.priority;
    document.getElementById('se-tags').value       = (sc.tags || []).join(', ');
    const mc = document.getElementById('se-metadata-card');
    if (mc) {
      mc.style.display = '';
      document.getElementById('se-meta-createdby').textContent  = sc.createdBy  || '—';
      document.getElementById('se-meta-createdat').textContent  = formatDate(sc.createdAt);
      document.getElementById('se-meta-modifiedby').textContent = sc.modifiedBy || '—';
      document.getElementById('se-meta-modifiedat').textContent = formatDate(sc.modifiedAt);
    }
    (sc.steps || []).forEach(step => scriptAddStep(step));
  } else {
    document.getElementById('se-component').value = '';
    document.getElementById('se-title').value      = '';
    document.getElementById('se-desc').value       = '';
    document.getElementById('se-priority').value   = 'medium';
    document.getElementById('se-tags').value       = '';
    const mc = document.getElementById('se-metadata-card');
    if (mc) mc.style.display = 'none';
    scriptAddStep();
  }
  document.getElementById('script-editor-overlay').style.display = 'flex';
}

function scriptEditorClose() {
  document.getElementById('script-editor-overlay').style.display = 'none';
  editingScriptId = null;
}

// ── Script Detail View ────────────────────────────────────────────────────────

let _detailScriptId = null;

async function scriptOpenDetail(id) {
  if (!id) return;
  _detailScriptId = id;
  // Reload fresh data in case it was edited
  const res = await fetch(`/api/scripts/${encodeURIComponent(id)}`);
  if (!res.ok) return;
  const sc = await res.json();

  document.getElementById('sd-title-header').textContent = `${sc.tcId || ''} — ${sc.title}`;
  document.getElementById('sd-tcid').textContent        = sc.tcId || '—';
  document.getElementById('sd-component').textContent   = sc.component || '—';
  document.getElementById('sd-priority').innerHTML      = `<span class="badge badge-${escHtml(sc.priority)}">${escHtml(sc.priority)}</span>`;
  document.getElementById('sd-tags').innerHTML          = (sc.tags||[]).length
    ? (sc.tags||[]).map(t=>`<span class="badge badge-tester">${escHtml(t)}</span>`).join(' ')
    : '—';
  document.getElementById('sd-description').textContent = sc.description || '—';
  document.getElementById('sd-createdby').textContent   = sc.createdBy || '—';
  document.getElementById('sd-createdat').textContent   = formatDate(sc.createdAt);
  document.getElementById('sd-modifiedby').textContent  = sc.modifiedBy || '—';
  document.getElementById('sd-modifiedat').textContent  = formatDate(sc.modifiedAt);
  document.getElementById('sd-step-count').textContent  = `(${(sc.steps||[]).length} steps)`;

  // Build steps list with function expand/collapse
  const stepsEl = document.getElementById('sd-steps-list');
  stepsEl.innerHTML = _renderDetailSteps(sc.steps || []);

  document.getElementById('script-detail-overlay').style.display = 'flex';
}

function _renderDetailSteps(steps) {
  if (!steps.length) return '<div class="builder-hint">No steps defined.</div>';
  return steps.map((step, i) => {
    const isCall = step.keyword === 'CALL FUNCTION';
    const fn = isCall ? allFunctions.find(f => f.id === step.value || f.identifier === step.value) : null;
    const fnSteps = fn ? (fn.steps || []) : [];
    const expandId = `sd-fn-${i}`;
    return `
      <div class="sd-step-row ${isCall ? 'sd-step-fn' : ''}">
        <div class="sd-step-num">${i + 1}</div>
        <div class="sd-step-body">
          <div class="sd-step-head">
            <span class="sd-step-kw">${escHtml(step.keyword)}</span>
            ${step.description ? `<span class="sd-step-desc-txt">${escHtml(step.description)}</span>` : ''}
            ${isCall && fn ? `<button class="tbl-btn sd-fn-toggle" onclick="_sdToggleFn('${expandId}',this)" style="font-size:11px;padding:2px 7px">▶ ${escHtml(fn.name)}</button>` : ''}
            ${isCall && !fn ? `<span style="color:var(--neutral-400);font-size:12px">Function: ${escHtml(step.value || '—')}</span>` : ''}
          </div>
          ${!isCall && step.locator ? `<div class="sd-step-locator"><span class="sd-locator-type">${escHtml(step.locatorType||'css')}</span> <code>${escHtml(step.locator)}</code></div>` : ''}
          ${!isCall && step.value   ? `<div class="sd-step-value">Value: <code>${escHtml(step.value)}</code></div>` : ''}
          ${isCall && fn ? `
            <div class="sd-fn-steps" id="${expandId}" style="display:none">
              ${fnSteps.map((fs, fi) => `
                <div class="sd-child-step">
                  <div class="sd-step-num sd-child-num">${i + 1}.${fi + 1}</div>
                  <div class="sd-step-body">
                    <div class="sd-step-head">
                      <span class="sd-step-kw">${escHtml(fs.keyword)}</span>
                      ${fs.detail ? `<span class="sd-step-desc-txt">${escHtml(fs.detail)}</span>` : ''}
                    </div>
                    ${fs.selector ? `<div class="sd-step-locator"><code>${escHtml(fs.selector)}</code></div>` : ''}
                    ${fs.value    ? `<div class="sd-step-value">Value: <code>${escHtml(fs.value)}</code></div>` : ''}
                  </div>
                </div>`).join('')}
            </div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function _sdToggleFn(expandId, btn) {
  const el = document.getElementById(expandId);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : '';
  btn.textContent = open ? `▶ ${btn.textContent.slice(2)}` : `▼ ${btn.textContent.slice(2)}`;
}

function scriptDetailClose() {
  document.getElementById('script-detail-overlay').style.display = 'none';
  _detailScriptId = null;
}

function scriptDetailEdit() {
  if (!_detailScriptId) return;
  scriptDetailClose();
  scriptOpenEditor(_detailScriptId);
}

// ── Keyword tooltip popup ────────────────────────────────────────────────────
let _kwTipPopup = null;

function _kwTipShow(trigger) {
  if (!_kwTipPopup) {
    _kwTipPopup = document.createElement('div');
    _kwTipPopup.id = 'kw-tooltip-popup';
    _kwTipPopup.className = 'kw-tooltip-popup';
    _kwTipPopup.innerHTML =
      `<div class="kw-tp-section kw-tp-what-wrap"><div class="kw-tp-label">What it does</div><div class="kw-tp-what"></div></div>` +
      `<div class="kw-tp-section kw-tp-example-wrap"><div class="kw-tp-label">Example</div><pre class="kw-tp-example"></pre></div>` +
      `<div class="kw-tp-section kw-tp-tip-wrap"><div class="kw-tp-label">Tip</div><div class="kw-tp-tip"></div></div>`;
    document.body.appendChild(_kwTipPopup);
  }
  const raw = trigger.dataset.tooltipJson || '';
  let tip = {};
  try { if (raw) tip = JSON.parse(raw); } catch (e) {}
  if (!tip.what && !tip.example && !tip.tip) return;

  _kwTipPopup.querySelector('.kw-tp-what').textContent    = tip.what    || '';
  _kwTipPopup.querySelector('.kw-tp-example').textContent = tip.example || '';
  _kwTipPopup.querySelector('.kw-tp-tip').textContent     = tip.tip     || '';
  _kwTipPopup.querySelector('.kw-tp-what-wrap').style.display    = tip.what    ? '' : 'none';
  _kwTipPopup.querySelector('.kw-tp-example-wrap').style.display = tip.example ? '' : 'none';
  _kwTipPopup.querySelector('.kw-tp-tip-wrap').style.display     = tip.tip     ? '' : 'none';

  _kwTipPopup.style.display = 'block';
  // position after layout so offsetWidth/Height are valid
  requestAnimationFrame(() => {
    const rect = trigger.getBoundingClientRect();
    const pw   = _kwTipPopup.offsetWidth;
    const ph   = _kwTipPopup.offsetHeight;
    let left   = rect.right + 10;
    if (left + pw > window.innerWidth - 8) left = rect.left - pw - 10;
    let top    = rect.top - 4;
    if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    _kwTipPopup.style.left = Math.max(8, left) + 'px';
    _kwTipPopup.style.top  = Math.max(8, top)  + 'px';
  });
}

function _kwTipHide() {
  if (_kwTipPopup) _kwTipPopup.style.display = 'none';
}

function _seKwGet(key) {
  for (const cat of scriptKeywords.categories) {
    const kw = cat.keywords.find(k => k.key === key);
    if (kw) return kw;
  }
  return null;
}

function scriptAddStep(step = {}, insertBeforeRow = null) {
  const container = document.getElementById('se-steps-container');
  document.getElementById('se-steps-hint').style.display = 'none';
  const idx = container.querySelectorAll('.script-step-row').length;

  // GOTO is excluded from Test Script steps — URL navigation is handled by explicit step values
  const kwOptions = scriptKeywords.categories.map(cat => {
    const opts = cat.keywords
      .filter(kw => kw.key !== 'GOTO')
      .map(kw =>
        `<option value="${escHtml(kw.key)}"` +
        ` data-nl="${kw.needsLocator}" data-nv="${kw.needsValue}" data-hint="${escHtml(kw.valueHint)}"` +
        ` data-help="${escHtml(kw.helpLabel || '')}" data-tooltip-json="${escHtml(JSON.stringify(kw.tooltip || {}))}"` +
        ` data-auto="false"` +
        `${step.keyword === kw.key ? ' selected' : ''}>${escHtml(kw.label)}</option>`
      ).join('');
    return opts ? `<optgroup label="${escHtml(cat.name)}">${opts}</optgroup>` : '';
  }).join('');

  const locTypes = (scriptKeywords.locatorTypes || []);
  const locTypeOpts = locTypes.map(lt =>
    `<option value="${escHtml(lt.value)}"${step.locatorType === lt.value ? ' selected' : ''}>${escHtml(lt.label)}</option>`
  ).join('');

  const valMode   = step.valueMode || 'static';   // 'static' | 'dynamic' | 'commondata' | 'testdata'
  const isDyn     = valMode === 'dynamic';
  const isCd      = valMode === 'commondata';
  const isTd      = valMode === 'testdata';
  const tokenOpts = `<option value="">— choose token —</option>` +
    scriptKeywords.dynamicTokens.map(t =>
      `<option value="${escHtml(t.token)}"${isDyn && step.value === t.token ? ' selected' : ''}>${escHtml(t.label)}</option>`
    ).join('');

  const curKw    = _seKwGet(step.keyword);
  const needsLoc = curKw ? curKw.needsLocator : true;
  const needsVal = curKw ? curKw.needsValue   : false;
  const isAuto   = curKw?.autoFromProject || false;
  const valHint  = curKw?.valueHint || 'Value';
  const helpLbl  = curKw?.helpLabel || '';
  const tipObj   = curKw?.tooltip || null;
  const tipJson  = (tipObj && (tipObj.what || tipObj.example || tipObj.tip)) ? JSON.stringify(tipObj) : '';

  const row = document.createElement('div');
  row.className      = 'script-step-row';
  row.dataset.stepId = step.id || `new-${Date.now()}-${idx}`;
  row.innerHTML = `
    <div class="step-actions-top">
      <button type="button" class="step-action-btn" onclick="scriptStepMoveUp(this)" title="Move Up">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
      </button>
      <button type="button" class="step-action-btn" onclick="scriptStepMoveDown(this)" title="Move Down">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <button type="button" class="step-action-btn" onclick="scriptStepInsertAbove(this)" title="Insert Step Above">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button type="button" class="step-action-btn step-del-icon" onclick="scriptStepDelete(this)" title="Delete Step">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    </div>
    <div class="step-row-header">
      <span class="step-num">${idx + 1}</span>
      <select class="fm-select se-step-kw-select" style="flex:1;font-size:12.5px" onchange="scriptStepKwChange(this)">${kwOptions}</select>
      <label class="step-screenshot-lbl">
        <input type="checkbox" class="se-step-screenshot"${step.screenshot ? ' checked' : ''} /> Screenshot
      </label>
    </div>
    <div class="step-help-row"${helpLbl ? '' : ' style="display:none"'}>
      <span class="step-help-label">${escHtml(helpLbl)}</span>
      <span class="step-tooltip-trigger" data-tooltip-json="${escHtml(tipJson)}" onmouseenter="_kwTipShow(this)" onmouseleave="_kwTipHide()"${tipJson ? '' : ' style="display:none"'}>?</span>
    </div>
    <div class="se-step-auto-badge"${isAuto ? '' : ' style="display:none"'}>
      <span class="auto-config-badge">&#x2699; Auto from Project Config — URL &amp; credentials fetched automatically</span>
    </div>
    <div class="step-row-fields">
      <div class="se-step-locator"${needsLoc && !isAuto ? '' : ' style="display:none"'}>
        <div class="field" style="margin:0 0 6px 0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <label style="font-size:11px;margin:0">Locator Name</label>
            <span class="loc-repo-badge" style="display:none">From Repo</span>
            <button type="button" class="loc-unlock-btn" style="display:none" onclick="scriptStepUnlockLoc(this)" title="Unlock to edit manually">&#x270E; Edit</button>
          </div>
          <div style="display:flex;gap:4px">
            <input class="fm-input se-step-loc-name" style="flex:1;font-size:12px"
                   placeholder="e.g. LoginButton" value="${escHtml(step.locatorName ?? '')}" />
            <button type="button" class="tbl-btn" style="padding:5px 8px;font-size:13px;flex-shrink:0"
                    onclick="scriptStepPickLoc(this)" title="Pick from Locator Repo">&#x1F50D;</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:start">
          <div class="field" style="margin:0;flex-shrink:0;width:130px"><label style="font-size:11px">Locator Type</label>
            <select class="fm-select se-step-loc-type" style="font-size:11.5px">${locTypeOpts}</select>
          </div>
          <div class="field" style="margin:0;flex:1"><label style="font-size:11px">Locator Value</label>
            <input class="fm-input se-step-selector" style="flex:1;font-size:12px;font-family:monospace"
                   placeholder="e.g. #btn-login" value="${escHtml(step.locator ?? '')}" />
          </div>
        </div>
      </div>
      <div class="se-step-value"${needsVal && !isAuto ? '' : ' style="display:none"'}>
        <div class="field" style="margin:0">
          <label style="font-size:11px">Value Source</label>
          <div class="value-toggle">
            <button type="button" class="value-toggle-btn${valMode==='static'  ?' active':''}" onclick="scriptStepToggleVal(this,'static')">Static</button>
            <button type="button" class="value-toggle-btn${valMode==='dynamic' ?' active':''}" onclick="scriptStepToggleVal(this,'dynamic')">Dynamic</button>
            <button type="button" class="value-toggle-btn${isCd               ?' active':''}" onclick="scriptStepToggleVal(this,'commondata')">Common Data</button>
            <button type="button" class="value-toggle-btn value-toggle-td${isTd?' active':''}" onclick="scriptStepToggleVal(this,'testdata')" title="Placeholder — future Test Data dataset integration">Test Data (Static)</button>
          </div>
          <input class="fm-input se-step-val-static" style="font-size:12px${valMode!=='static'?';display:none':''}"
                 placeholder="${escHtml(valHint)}" value="${escHtml(valMode==='static' ? (step.value ?? '') : '')}" />
          <select class="fm-select se-step-val-dynamic" style="font-size:12.5px${valMode!=='dynamic'?';display:none':''}">${tokenOpts}</select>
          <div class="se-step-val-cd" style="${isCd?'':'display:none'}">
            <select class="fm-select se-step-cd-select" style="font-size:12.5px" onchange="scriptStepCdSelected(this)"
                    data-saved-cd="${escHtml(isCd && step.value ? step.value.replace(/^\$\{|\}$/g,'') : '')}">
              <option value="">— loading Common Data… —</option>
            </select>
            ${isCd && step.value ? `<div class="cd-token-preview">Reference: <code>${escHtml(step.value)}</code></div>` : '<div class="cd-token-preview" style="display:none"></div>'}
          </div>
          <div class="se-step-val-td" style="${isTd?'':'display:none'}">
            <div class="td-frame">
              <div class="td-frame-header">
                <span style="font-size:11.5px;font-weight:700;color:var(--neutral-600)">Test Data</span>
                <button type="button" class="tbl-btn" style="font-size:11px;padding:2px 8px" onclick="scriptStepTdAddRow(this)">+ Add Row</button>
              </div>
              <table class="td-table">
                <thead><tr><th style="width:28px">#</th><th>Value <span style="color:var(--danger)">*</span></th><th style="width:32px"></th></tr></thead>
                <tbody class="td-tbody">
                  ${(step.testData||[]).map((r,ri)=>`
                    <tr class="td-row">
                      <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${ri+1}</td>
                      <td><input class="fm-input td-val" style="font-size:12px;font-family:monospace" placeholder="value" value="${escHtml(r.value)}" /></td>
                      <td><button type="button" class="step-action-btn step-del-icon" onclick="scriptStepTdDelRow(this)" title="Delete row"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>
                    </tr>`).join('')}
                </tbody>
              </table>
              <div class="td-info-row">
                <span>&#x2139;&#xFE0F; Each row = one test execution. The step runs once per row using that row's value.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="se-step-fn-picker" style="display:none" data-saved-fn="${escHtml(step.value || '')}" data-fn-step-values="${escHtml(JSON.stringify(step.fnStepValues || []))}">
        <div class="field" style="margin:0"><label style="font-size:11px">Common Function</label>
          <div style="display:flex;gap:4px">
            <select class="fm-select se-step-fn-select" style="flex:1;font-size:12.5px" onchange="scriptStepFnSelected(this)">
              <option value="">— select function —</option>
            </select>
            <button type="button" class="tbl-btn" style="padding:5px 8px;font-size:11px;flex-shrink:0"
                    onclick="scriptStepRefreshFns(this)" title="Refresh function list">&#x21BB;</button>
          </div>
        </div>
        <div class="se-fn-expand-area" style="margin-top:6px;display:none"></div>
      </div>
    </div>
    <div class="step-row-bottom">
      <input class="fm-input se-step-desc" style="flex:1;font-size:12px" placeholder="Step description (optional)"
             value="${escHtml(step.description ?? '')}" />
    </div>`;

  if (insertBeforeRow) {
    container.insertBefore(row, insertBeforeRow);
  } else {
    container.appendChild(row);
  }
  scriptStepKwChange(row.querySelector('.se-step-kw-select'));
  scriptReorderNums();
  // If restoring a commondata step, pre-load CD options
  if (valMode === 'commondata') _loadCdOptions(row);
}

function scriptStepKwChange(sel) {
  const row  = sel.closest('.script-step-row');
  const opt  = sel.selectedOptions[0];
  const kwKey    = opt?.value || '';
  const needsLoc = opt?.dataset.nl === 'true';
  const needsVal = opt?.dataset.nv === 'true';
  const isAuto   = opt?.dataset.auto === 'true';
  const isFnCall = kwKey === 'CALL FUNCTION';
  const hint     = opt?.dataset.hint || 'Value';
  const helpText  = opt?.dataset.help || '';
  const tipJson   = opt?.dataset.tooltipJson || '';

  // GOTO auto-config: hide locator + value, show auto badge
  row.querySelector('.se-step-locator').style.display = (needsLoc && !isAuto) ? '' : 'none';
  row.querySelector('.se-step-value').style.display   = (needsVal && !isAuto && !isFnCall) ? '' : 'none';
  row.querySelector('.se-step-auto-badge').style.display = isAuto ? '' : 'none';

  // CALL FUNCTION: show function picker, hide value
  const fnPicker = row.querySelector('.se-step-fn-picker');
  if (fnPicker) {
    fnPicker.style.display = isFnCall ? '' : 'none';
    if (isFnCall) _populateFnSelect(row);
  }

  // Help label + tooltip
  const helpRow = row.querySelector('.step-help-row');
  if (helpRow) {
    helpRow.style.display = helpText ? '' : 'none';
    const lbl = helpRow.querySelector('.step-help-label');
    if (lbl) lbl.textContent = helpText;
    const tip = helpRow.querySelector('.step-tooltip-trigger');
    if (tip) { tip.dataset.tooltipJson = tipJson; tip.style.display = tipJson ? '' : 'none'; }
  }

  const si = row.querySelector('.se-step-val-static');
  if (si) si.placeholder = hint;
}

function _populateFnSelect(row) {
  const sel = row.querySelector('.se-step-fn-select');
  if (!sel) return;
  // Restore saved value: data-saved-fn on picker div (set at render time from step.value)
  const picker   = row.querySelector('.se-step-fn-picker');
  const savedVal = picker?.dataset.savedFn || sel.value || '';
  sel.innerHTML = '<option value="">— select function —</option>' +
    allFunctions.map(f =>
      `<option value="${escHtml(f.name)}"${f.name === savedVal ? ' selected' : ''}>${escHtml(f.name)}</option>`
    ).join('');
  // Clear saved hint so future manual changes aren't overridden
  if (picker) picker.dataset.savedFn = '';
  // Render child steps for whichever function is now selected
  _renderFnExpandArea(row);
}

function scriptStepFnSelected(sel) {
  const row = sel.closest('.script-step-row');
  _renderFnExpandArea(row);
}

function _renderFnExpandArea(row) {
  const sel      = row.querySelector('.se-step-fn-select');
  const expandEl = row.querySelector('.se-fn-expand-area');
  if (!sel || !expandEl) return;
  const fnName = sel.value;
  const fn     = allFunctions.find(f => f.name === fnName);
  if (!fn || !(fn.steps || []).length) { expandEl.style.display = 'none'; expandEl.innerHTML = ''; return; }

  const picker   = row.querySelector('.se-step-fn-picker');
  let savedVals  = [];
  try { savedVals = JSON.parse(picker?.dataset.fnStepValues || '[]'); } catch {}

  const stepNum  = row.querySelector('.step-num')?.textContent || '?';

  expandEl.style.display = '';
  expandEl.innerHTML = `
    <div class="fn-expand-header">
      <button type="button" class="tbl-btn fn-expand-toggle" onclick="_toggleFnExpand(this)" style="font-size:11px;padding:2px 8px">
        ▶ Show ${fn.steps.length} step${fn.steps.length > 1 ? 's' : ''} (${escHtml(fn.name)})
      </button>
    </div>
    <div class="fn-child-steps" style="display:none">
      ${fn.steps.map((fs, fi) => {
        const kwMeta   = _seKwGet(fs.keyword);
        const needsVal = kwMeta ? kwMeta.needsValue : false;
        const valHint  = kwMeta?.valueHint || 'Value';
        const saved    = savedVals.find(v => v.fnStepIdx === fi) || {};
        const valMode  = saved.valueMode || 'static';
        const isDyn    = valMode === 'dynamic';
        const isCd     = valMode === 'commondata';
        const isTd     = valMode === 'testdata';
        const locDisplay = [fs.locatorName || fs.detail, fs.selector].filter(Boolean).join(' → ');
        const dynOpts  = '<option value="">— choose token —</option>' +
          (scriptKeywords.dynamicTokens || []).map(t =>
            `<option value="${escHtml(t.token)}"${isDyn && saved.value === t.token ? ' selected' : ''}>${escHtml(t.label)}</option>`
          ).join('');
        const tdRows   = (saved.testData || []).map((r, ri) => `
          <tr class="fn-cs-td-row">
            <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${ri + 1}</td>
            <td><input class="fm-input fn-cs-td-val" style="font-size:12px;font-family:monospace" placeholder="value" value="${escHtml(r.value || '')}" /></td>
            <td><button type="button" class="step-action-btn step-del-icon" onclick="fnCsTdDelRow(this)" title="Delete row"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>
          </tr>`).join('');
        return `
        <div class="fn-child-row" data-fn-step-idx="${fi}">
          <div class="fn-cs-header">
            <span class="fn-child-num">${stepNum}.${fi + 1}</span>
            <span class="fn-child-kw">${escHtml(fs.keyword)}</span>
            ${locDisplay ? `<span class="fn-cs-loc-info">${escHtml(locDisplay)}</span>` : ''}
          </div>
          ${needsVal ? `
          <div class="fn-cs-value">
            <div class="value-toggle" style="margin-bottom:6px">
              <button type="button" class="value-toggle-btn${valMode === 'static'   ? ' active' : ''}" onclick="fnCsToggleVal(this,'static')">Static</button>
              <button type="button" class="value-toggle-btn${isDyn                  ? ' active' : ''}" onclick="fnCsToggleVal(this,'dynamic')">Dynamic</button>
              <button type="button" class="value-toggle-btn${isCd                   ? ' active' : ''}" onclick="fnCsToggleVal(this,'commondata')">Common Data</button>
              <button type="button" class="value-toggle-btn value-toggle-td${isTd  ? ' active' : ''}" onclick="fnCsToggleVal(this,'testdata')">Test Data (Static)</button>
            </div>
            <input class="fm-input fn-cs-val-static" style="font-size:12px${valMode !== 'static' ? ';display:none' : ''}"
                   placeholder="${escHtml(valHint)}" value="${escHtml(valMode === 'static' ? (saved.value || '') : '')}" />
            <select class="fm-select fn-cs-val-dynamic" style="font-size:12.5px${!isDyn ? ';display:none' : ''}">${dynOpts}</select>
            <div class="fn-cs-val-cd" style="${isCd ? '' : 'display:none'}">
              <select class="fm-select fn-cs-cd-select" style="font-size:12.5px" onchange="fnCsCdSelected(this)"
                      data-saved-cd="${escHtml(isCd && saved.value ? saved.value.replace(/^\$\{|\}$/g, '') : '')}">
                <option value="">— loading Common Data… —</option>
              </select>
              ${isCd && saved.value
                ? `<div class="cd-token-preview">Reference: <code>${escHtml(saved.value)}</code></div>`
                : '<div class="cd-token-preview" style="display:none"></div>'}
            </div>
            <div class="fn-cs-val-td" style="${isTd ? '' : 'display:none'}">
              <div class="td-frame">
                <div class="td-frame-header">
                  <span style="font-size:11.5px;font-weight:700;color:var(--neutral-600)">Test Data</span>
                  <button type="button" class="tbl-btn" style="font-size:11px;padding:2px 8px" onclick="fnCsTdAddRow(this)">+ Add Row</button>
                </div>
                <table class="td-table">
                  <thead><tr><th style="width:28px">#</th><th>Value <span style="color:var(--danger)">*</span></th><th style="width:32px"></th></tr></thead>
                  <tbody class="fn-cs-td-tbody">${tdRows}</tbody>
                </table>
                <div class="td-info-row"><span>&#x2139;&#xFE0F; Each row = one test execution.</span></div>
              </div>
            </div>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;

  // Load CD options for any child step already set to commondata
  expandEl.querySelectorAll('.fn-child-row').forEach(childRow => {
    if (childRow.querySelector('.fn-cs-val-cd')) _loadFnCsOptions(childRow);
  });
}

function _toggleFnExpand(btn) {
  const childSteps = btn.closest('.se-fn-expand-area').querySelector('.fn-child-steps');
  if (!childSteps) return;
  const open = childSteps.style.display !== 'none';
  childSteps.style.display = open ? 'none' : '';
  btn.textContent = open
    ? btn.textContent.replace('▼', '▶')
    : btn.textContent.replace('▶', '▼');
}

// ── CALL FUNCTION child-step value helpers ────────────────────────────────────

function fnCsToggleVal(btn, mode) {
  const childRow = btn.closest('.fn-child-row');
  childRow.querySelectorAll('.value-toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  childRow.querySelector('.fn-cs-val-static')?.style  && (childRow.querySelector('.fn-cs-val-static').style.display  = mode === 'static'     ? '' : 'none');
  childRow.querySelector('.fn-cs-val-dynamic')?.style && (childRow.querySelector('.fn-cs-val-dynamic').style.display = mode === 'dynamic'    ? '' : 'none');
  childRow.querySelector('.fn-cs-val-cd')?.style      && (childRow.querySelector('.fn-cs-val-cd').style.display      = mode === 'commondata' ? '' : 'none');
  childRow.querySelector('.fn-cs-val-td')?.style      && (childRow.querySelector('.fn-cs-val-td').style.display      = mode === 'testdata'   ? '' : 'none');
  if (mode === 'commondata') _loadFnCsOptions(childRow);
}

async function _loadFnCsOptions(childRow) {
  const sel = childRow.querySelector('.fn-cs-cd-select');
  if (!sel || !currentProjectId) return;
  const res   = await fetch(`/api/common-data?projectId=${encodeURIComponent(currentProjectId)}`);
  if (!res.ok) return;
  const items = await res.json();
  const curVal = sel.dataset.savedCd || sel.value || '';
  sel.innerHTML = `<option value="">— select Common Data —</option>` +
    items.map(cd =>
      `<option value="${escHtml(cd.dataName)}" data-env="${escHtml(cd.environment)}"` +
      `${cd.dataName === curVal ? ' selected' : ''}>${escHtml(cd.dataName)}\u2002·\u2002${escHtml(cd.environment)}</option>`
    ).join('');
  sel.dataset.savedCd = '';
  _updateFnCsTokenPreview(childRow);
}

function fnCsCdSelected(sel) {
  _updateFnCsTokenPreview(sel.closest('.fn-child-row'));
}

function _updateFnCsTokenPreview(childRow) {
  const sel     = childRow.querySelector('.fn-cs-cd-select');
  const preview = childRow.querySelector('.fn-cs-val-cd .cd-token-preview');
  if (!preview) return;
  const name = sel?.value || '';
  if (name) { preview.style.display = ''; preview.innerHTML = `Reference: <code>\${${escHtml(name)}}</code>`; }
  else        preview.style.display = 'none';
}

function fnCsTdAddRow(btn) {
  const tbody  = btn.closest('.td-frame').querySelector('.fn-cs-td-tbody');
  const rowNum = tbody.querySelectorAll('.fn-cs-td-row').length + 1;
  const tr     = document.createElement('tr');
  tr.className = 'fn-cs-td-row';
  tr.innerHTML = `
    <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${rowNum}</td>
    <td><input class="fm-input fn-cs-td-val" style="font-size:12px;font-family:monospace" placeholder="value" /></td>
    <td><button type="button" class="step-action-btn step-del-icon" onclick="fnCsTdDelRow(this)" title="Delete row"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('.fn-cs-td-val').focus();
}

function fnCsTdDelRow(btn) {
  btn.closest('.fn-cs-td-row').remove();
  btn.closest('.fn-cs-td-tbody')?.querySelectorAll('.fn-cs-td-row').forEach((r, i) => {
    const numCell = r.querySelector('td:first-child');
    if (numCell) numCell.textContent = i + 1;
  });
}

function scriptStepRefreshFns(btn) {
  fnLoad().then(() => {
    const row = btn.closest('.script-step-row');
    _populateFnSelect(row);
  });
}

function scriptStepToggleVal(btn, mode) {
  const row = btn.closest('.script-step-row');
  row.querySelectorAll('.value-toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  row.querySelector('.se-step-val-static')?.style && (row.querySelector('.se-step-val-static').style.display  = mode === 'static'     ? '' : 'none');
  row.querySelector('.se-step-val-dynamic')?.style && (row.querySelector('.se-step-val-dynamic').style.display = mode === 'dynamic'    ? '' : 'none');
  row.querySelector('.se-step-val-cd')?.style      && (row.querySelector('.se-step-val-cd').style.display      = mode === 'commondata' ? '' : 'none');
  row.querySelector('.se-step-val-td')?.style      && (row.querySelector('.se-step-val-td').style.display      = mode === 'testdata'   ? '' : 'none');
  if (mode === 'commondata') _loadCdOptions(row);
}

// Populate Common Data dropdown for a step row
async function _loadCdOptions(row) {
  const sel = row.querySelector('.se-step-cd-select');
  if (!sel || !currentProjectId) return;
  const res  = await fetch(`/api/common-data?projectId=${encodeURIComponent(currentProjectId)}`);
  if (!res.ok) return;
  const items = await res.json();
  const curVal = sel.dataset.savedCd || sel.value || '';
  sel.innerHTML = `<option value="">— select Common Data —</option>` +
    items.map(cd =>
      `<option value="${escHtml(cd.dataName)}" data-env="${escHtml(cd.environment)}"` +
      `${cd.dataName === curVal ? ' selected' : ''}>${escHtml(cd.dataName)}\u2002·\u2002${escHtml(cd.environment)}</option>`
    ).join('');
  sel.dataset.savedCd = '';
  // Update token preview
  _updateCdTokenPreview(row);
}

function scriptStepCdSelected(sel) {
  _updateCdTokenPreview(sel.closest('.script-step-row'));
}

function _updateCdTokenPreview(row) {
  const sel      = row.querySelector('.se-step-cd-select');
  const preview  = row.querySelector('.cd-token-preview');
  if (!preview) return;
  const name = sel?.value || '';
  if (name) {
    preview.style.display = '';
    preview.innerHTML = `Reference: <code>\${${escHtml(name)}}</code>`;
  } else {
    preview.style.display = 'none';
  }
}

// ── Test Data (Static) helpers ────────────────────────────────────────────

function scriptStepTdAddRow(btn) {
  const frame = btn.closest('.td-frame');
  const tbody = frame.querySelector('.td-tbody');
  const tr = document.createElement('tr');
  tr.className = 'td-row';
  const rowNum = frame.querySelectorAll('.td-row').length + 1;
  tr.innerHTML = `
    <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${rowNum}</td>
    <td><input class="fm-input td-val" style="font-size:12px;font-family:monospace" placeholder="value" /></td>
    <td><button type="button" class="step-action-btn step-del-icon" onclick="scriptStepTdDelRow(this)" title="Delete row"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('.td-val').focus();
}

function scriptStepTdDelRow(btn) {
  btn.closest('.td-row').remove();
  // Renumber remaining rows
  btn.closest('.td-tbody')?.querySelectorAll('.td-row').forEach((r, i) => {
    const numCell = r.querySelector('td:first-child');
    if (numCell) numCell.textContent = i + 1;
  });
}

// Collect and validate testData rows for all steps — returns error string or null
function _validateTestDataKeys(allRows) {
  const seen = new Map(); // key → stepIndex
  for (const { stepIdx, key } of allRows) {
    if (!key.trim()) return `Step ${stepIdx + 1}: Test Data key cannot be empty.`;
    if (seen.has(key.trim())) {
      return `Duplicate Test Data key "${key.trim()}" — found in step ${seen.get(key.trim()) + 1} and step ${stepIdx + 1}. Keys must be unique across the entire script.`;
    }
    seen.set(key.trim(), stepIdx);
  }
  return null;
}

function scriptStepPickLoc(btn) {
  const row = btn.closest('.script-step-row');
  locatorPickerOpen((selector, selectorType, name) => {
    const nameInput = row.querySelector('.se-step-loc-name');
    const valInput  = row.querySelector('.se-step-selector');
    const typeSelect = row.querySelector('.se-step-loc-type');
    if (nameInput) nameInput.value = name || '';
    if (valInput)  valInput.value  = selector || '';
    if (typeSelect && selectorType) typeSelect.value = selectorType;
    // Lock fields as read-only (inherited from Locator Repo)
    _scriptStepLockLocator(row, true);
  });
}

function _scriptStepLockLocator(row, locked) {
  const nameInput  = row.querySelector('.se-step-loc-name');
  const valInput   = row.querySelector('.se-step-selector');
  const typeSelect = row.querySelector('.se-step-loc-type');
  const lockBadge  = row.querySelector('.loc-repo-badge');
  const unlockBtn  = row.querySelector('.loc-unlock-btn');
  if (nameInput)  { nameInput.readOnly = locked;  nameInput.classList.toggle('loc-locked', locked); }
  if (valInput)   { valInput.readOnly  = locked;  valInput.classList.toggle('loc-locked', locked); }
  if (typeSelect) { typeSelect.disabled = locked;  typeSelect.classList.toggle('loc-locked', locked); }
  if (lockBadge)  lockBadge.style.display = locked ? '' : 'none';
  if (unlockBtn)  unlockBtn.style.display = locked ? '' : 'none';
}

function scriptStepUnlockLoc(btn) {
  const row = btn.closest('.script-step-row');
  _scriptStepLockLocator(row, false);
}

function scriptStepDelete(btn) {
  btn.closest('.script-step-row').remove();
  scriptReorderNums();
  if (!document.querySelectorAll('#se-steps-container .script-step-row').length)
    document.getElementById('se-steps-hint').style.display = '';
}

function scriptStepMoveUp(btn) {
  const row = btn.closest('.script-step-row');
  const prev = row.previousElementSibling;
  if (prev && prev.classList.contains('script-step-row')) {
    row.parentElement.insertBefore(row, prev);
    scriptReorderNums();
  }
}

function scriptStepMoveDown(btn) {
  const row = btn.closest('.script-step-row');
  const next = row.nextElementSibling;
  if (next && next.classList.contains('script-step-row')) {
    row.parentElement.insertBefore(next, row);
    scriptReorderNums();
  }
}

function scriptStepInsertAbove(btn) {
  const row = btn.closest('.script-step-row');
  scriptAddStep({}, row);
}

function scriptReorderNums() {
  document.querySelectorAll('#se-steps-container .script-step-row').forEach((row, i) => {
    const n = row.querySelector('.step-num');
    if (n) n.textContent = i + 1;
  });
}

async function scriptSave() {
  modClearAlert('script-editor-alert');
  const title = document.getElementById('se-title').value.trim();
  if (!title)            { modAlert('script-editor-alert', 'error', 'Title is required'); return; }
  if (!currentProjectId) { modAlert('script-editor-alert', 'error', 'Select a project first'); return; }

  const steps = [...document.querySelectorAll('#se-steps-container .script-step-row')].map((row, i) => {
    const activeTab = row.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
    const kw       = row.querySelector('.se-step-kw-select')?.value || '';
    const isFnCall = kw === 'CALL FUNCTION';
    let valueMode, value, fnStepValues;
    if (isFnCall) {
      valueMode = 'static';
      value     = row.querySelector('.se-step-fn-select')?.value || null;
      fnStepValues = [...(row.querySelectorAll('.fn-child-row') || [])]
        .filter(cr => cr.querySelector('.fn-cs-value'))
        .map(cr => {
          const fi        = parseInt(cr.dataset.fnStepIdx);
          const activeCs  = cr.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
          let csMode, csValue, csTestData = [];
          if (activeCs === 'Dynamic') {
            csMode  = 'dynamic';
            csValue = cr.querySelector('.fn-cs-val-dynamic')?.value || null;
          } else if (activeCs === 'Common Data') {
            csMode  = 'commondata';
            const cdName = cr.querySelector('.fn-cs-cd-select')?.value || '';
            csValue = cdName ? `\${${cdName}}` : null;
          } else if (activeCs === 'Test Data (Static)') {
            csMode     = 'testdata';
            csValue    = null;
            csTestData = [...(cr.querySelectorAll('.fn-cs-td-row') || [])].map(tr => ({
              value: tr.querySelector('.fn-cs-td-val')?.value?.trim() || '',
            })).filter(r => r.value);
          } else {
            csMode  = 'static';
            csValue = cr.querySelector('.fn-cs-val-static')?.value?.trim() || null;
          }
          return { fnStepIdx: fi, valueMode: csMode, value: csValue, testData: csTestData };
        });
    } else if (activeTab === 'Dynamic') {
      valueMode = 'dynamic';
      value     = row.querySelector('.se-step-val-dynamic')?.value || null;
    } else if (activeTab === 'Common Data') {
      valueMode = 'commondata';
      const cdName = row.querySelector('.se-step-cd-select')?.value || '';
      value = cdName ? `\${${cdName}}` : null;
    } else if (activeTab === 'Test Data (Static)') {
      valueMode = 'testdata';
      value     = null;   // testdata — value comes from testData rows at runtime
    } else {
      valueMode = 'static';
      value     = row.querySelector('.se-step-val-static')?.value?.trim() || null;
    }
    // Collect testData rows (label is optional, value is required)
    const testData = [...(row.querySelectorAll('.td-row') || [])].map(tr => ({
      value: tr.querySelector('.td-val')?.value?.trim() || '',
    })).filter(r => r.value);

    return {
      id:          row.dataset.stepId || `step-${i + 1}`,
      order:       i + 1,
      keyword:     kw,
      locatorName: row.querySelector('.se-step-loc-name')?.value?.trim() || null,
      locatorType: row.querySelector('.se-step-loc-type')?.value || 'css',
      locator:     row.querySelector('.se-step-selector')?.value?.trim() || null,
      locatorId:   null,
      valueMode,
      value,
      testData,
      fnStepValues: fnStepValues || [],
      description: row.querySelector('.se-step-desc')?.value?.trim() || '',
      screenshot:  row.querySelector('.se-step-screenshot')?.checked || false,
    };
  });

  // Validate: each testdata step must have at least one value row
  const emptyTdStep = steps.findIndex(s => s.valueMode === 'testdata' && !(s.testData||[]).length);
  if (emptyTdStep !== -1) { modAlert('script-editor-alert', 'error', `Step ${emptyTdStep + 1}: Test Data (Static) requires at least one value row.`); return; }

  const tags = document.getElementById('se-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const body = {
    projectId:   currentProjectId, title,
    component:   document.getElementById('se-component').value.trim(),
    description: document.getElementById('se-desc').value.trim(),
    tags, priority: document.getElementById('se-priority').value, steps,
  };
  const method = editingScriptId ? 'PUT'  : 'POST';
  const url    = editingScriptId ? `/api/scripts/${editingScriptId}` : '/api/scripts';
  const res    = await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
  const data   = await res.json();
  if (!res.ok) { modAlert('script-editor-alert', 'error', data.error || 'Error saving script'); return; }

  // Auto-sync locators to Locator Repository
  await _syncLocatorsToRepo(steps);

  scriptEditorClose();
  await scriptLoad();
}

async function _syncLocatorsToRepo(steps) {
  for (const step of steps) {
    if (!step.locatorName || !step.locator) continue;
    // Check if locator with same name already exists
    const existing = allLocators.find(l => l.name === step.locatorName);
    if (existing) {
      // Update if selector or type changed
      if (existing.selector !== step.locator || existing.selectorType !== step.locatorType) {
        await fetch(`/api/locators/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selector: step.locator, selectorType: step.locatorType }),
        });
      }
    } else {
      // Create new locator in repo
      await fetch('/api/locators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: step.locatorName,
          selector: step.locator,
          selectorType: step.locatorType,
          projectId: currentProjectId || null,
          pageModule: '',
          description: `Auto-synced from script step: ${step.description || ''}`.trim(),
        }),
      });
    }
  }
  // Refresh locator list after sync
  await locatorLoadScoped();
}

async function scriptDelete(id, title) {
  if (!confirm(`Delete script "${title}"? This cannot be undone.`)) return;
  await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
  await scriptLoad();
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST SUITE MODULE
// ══════════════════════════════════════════════════════════════════════════════

let allSuites      = [];
let editingSuiteId = null;
let currentSuiteId = null;

async function suiteLoad() {
  const emptyEl = document.getElementById('suite-list-empty');
  const listEl  = document.getElementById('suite-list');
  if (!currentProjectId) {
    if (emptyEl) emptyEl.style.display = '';
    if (listEl)  listEl.innerHTML = '';
    allSuites = [];
    return;
  }
  const res = await fetch(`/api/suites?projectId=${encodeURIComponent(currentProjectId)}`);
  allSuites = await res.json();
  suiteRender();
}

function suiteRender() {
  const q       = (document.getElementById('suite-filter')?.value ?? '').toLowerCase();
  const listEl  = document.getElementById('suite-list');
  const emptyEl = document.getElementById('suite-list-empty');
  if (!listEl) return;
  const filtered = allSuites.filter(s => !q || s.name.toLowerCase().includes(q));
  if (!currentProjectId) { emptyEl.style.display = ''; listEl.innerHTML = ''; return; }
  emptyEl.style.display = 'none';
  if (!filtered.length) { listEl.innerHTML = '<div class="builder-hint">No suites match the filter.</div>'; return; }
  listEl.innerHTML = filtered.map(s => `
    <div class="suite-card" onclick="suiteOpenDetail('${escHtml(s.id)}')">
      <div class="suite-card-header">
        <div style="flex:1">
          <div class="suite-name">${escHtml(s.name)}</div>
          ${s.description ? `<div style="font-size:12.5px;color:var(--neutral-500);margin-top:3px">${escHtml(s.description)}</div>` : ''}
          <div class="suite-meta">${(s.scriptIds||[]).length} script${(s.scriptIds||[]).length !== 1 ? 's' : ''} · By ${escHtml(s.createdBy || '—')} · ${formatDate(s.createdAt)}</div>
        </div>
        <div style="flex-shrink:0;display:flex;gap:6px;align-items:center" onclick="event.stopPropagation()">
          <button class="tbl-btn run-btn" data-suite-run="${escHtml(s.id)}" onclick="suiteRunFromCard('${escHtml(s.id)}',this)">&#9654; Run</button>
          <button class="tbl-btn" onclick="suiteEditById('${escHtml(s.id)}')">Edit</button>
          <button class="tbl-btn del" onclick="suiteDelete('${escHtml(s.id)}','${escHtml(s.name)}')">Delete</button>
        </div>
      </div>
    </div>`).join('');
}

function _populateEnvDropdown(selectedEnvId = '') {
  const sel = document.getElementById('sm-env');
  if (!sel) return;
  const project = allProjects.find(p => p.id === currentProjectId);
  const envs    = project?.environments || [];
  sel.innerHTML = '<option value="">— Use project default (first environment) —</option>';
  envs.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = `${e.name} — ${e.url}`;
    if (e.id === selectedEnvId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function suiteOpenModal(id = null) {
  editingSuiteId = id;
  modClearAlert('suite-modal-alert');
  document.getElementById('suite-modal-title').textContent = id ? 'Edit Test Suite' : 'New Test Suite';
  if (!id) { document.getElementById('sm-name').value = ''; document.getElementById('sm-desc').value = ''; }
  document.getElementById('sm-script-filter').value = '';
  _populateEnvDropdown('');
  suiteScriptFilterRender(id ? null : []);
  openModal('modal-suite');
}

async function suiteEditById(id) {
  const s = allSuites.find(x => x.id === id);
  if (!s) return;
  editingSuiteId = id;
  document.getElementById('suite-modal-title').textContent = 'Edit Test Suite';
  document.getElementById('sm-name').value = s.name;
  document.getElementById('sm-desc').value = s.description || '';
  document.getElementById('sm-script-filter').value = '';
  _populateEnvDropdown(s.environmentId || '');
  modClearAlert('suite-modal-alert');
  suiteScriptFilterRender(s.scriptIds || []);
  openModal('modal-suite');
}

function suiteScriptFilterRender(selectedIds = null) {
  const q  = (document.getElementById('sm-script-filter')?.value ?? '').toLowerCase();
  const el = document.getElementById('sm-script-list');
  if (!el) return;
  if (selectedIds === null && editingSuiteId) {
    selectedIds = allSuites.find(x => x.id === editingSuiteId)?.scriptIds || [];
  } else if (selectedIds === null) {
    selectedIds = [];
  }
  const filtered = allScripts.filter(s => !q || s.title.toLowerCase().includes(q));
  if (!filtered.length) {
    el.innerHTML = '<div style="padding:10px;color:var(--neutral-400);font-size:13px">No scripts in this project yet.</div>';
    return;
  }
  el.innerHTML = filtered.map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-radius:5px;transition:background .1s"
           onmouseover="this.style.background='var(--brand-light)'" onmouseout="this.style.background=''">
      <input type="checkbox" class="sm-script-chk" value="${escHtml(s.id)}"${selectedIds.includes(s.id) ? ' checked' : ''} />
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600">${escHtml(s.title)}</div>
        <div style="font-size:11.5px;color:var(--neutral-400)">${s.steps.length} steps ·
          <span class="badge badge-${escHtml(s.priority)}">${escHtml(s.priority)}</span></div>
      </div>
    </label>`).join('');
}

async function suiteSave() {
  modClearAlert('suite-modal-alert');
  const name = document.getElementById('sm-name').value.trim();
  if (!name)             { modAlert('suite-modal-alert', 'error', 'Suite name is required'); return; }
  if (!currentProjectId) { modAlert('suite-modal-alert', 'error', 'Select a project first'); return; }
  const scriptIds     = [...document.querySelectorAll('#sm-script-list .sm-script-chk:checked')].map(c => c.value);
  const environmentId = document.getElementById('sm-env')?.value || null;
  const body = {
    projectId: currentProjectId, name,
    description:   document.getElementById('sm-desc').value.trim(),
    scriptIds,
    environmentId: environmentId || null,
  };
  const method = editingSuiteId ? 'PUT'  : 'POST';
  const url    = editingSuiteId ? `/api/suites/${editingSuiteId}` : '/api/suites';
  const res    = await fetch(url, { method, headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) });
  const data   = await res.json();
  if (!res.ok) { modAlert('suite-modal-alert', 'error', data.error || 'Error saving suite'); return; }
  suiteCloseModal();
  await suiteLoad();
}

async function suiteDelete(id, name) {
  if (!confirm(`Delete suite "${name}"?`)) return;
  await fetch(`/api/suites/${id}`, { method: 'DELETE' });
  await suiteLoad();
}

function suiteCloseModal() { closeModal('modal-suite'); editingSuiteId = null; }

async function suiteOpenDetail(id) {
  const res  = await fetch(`/api/suites/${id}`);
  const data = await res.json();
  if (!res.ok) return;
  currentSuiteId = id;

  const _setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  _setText('suite-detail-title', data.name);
  _setText('suite-detail-desc',  data.description || '');
  _setText('suite-script-count', `${(data.scriptIds||[]).length} script${(data.scriptIds||[]).length !== 1 ? 's' : ''}`);

  const project  = allProjects.find(p => p.id === data.projectId);
  const infoEl = document.getElementById('suite-detail-info');
  if (infoEl) {
    const projName = project?.name || data.projectId;
    const env      = (project?.environments || []).find(e => e.id === data.environmentId);
    const envLabel = env ? `${env.name} — ${env.url}` : (project?.environments?.[0] ? `${project.environments[0].name} — ${project.environments[0].url} (default)` : '—');
    infoEl.innerHTML = `
      <div><strong>Project:</strong> ${escHtml(projName)}</div>
      <div><strong>Default Env:</strong> ${escHtml(envLabel)}</div>
      <div><strong>Created by:</strong> ${escHtml(data.createdBy || '—')} &middot; ${formatDate(data.createdAt)}</div>
      <div><strong>Modified by:</strong> ${escHtml(data.modifiedBy || '—')} &middot; ${formatDate(data.modifiedAt)}</div>`;
  }

  // Populate run-time environment selector
  const runEnvSel = document.getElementById('suite-run-env');
  if (runEnvSel && project) {
    const envs = project.environments || [];
    runEnvSel.innerHTML = '<option value="">— Select Environment —</option>' +
      envs.map(e => `<option value="${escHtml(e.id)}"${e.id === data.environmentId ? ' selected' : ''}>${escHtml(e.name)} — ${escHtml(e.url)}</option>`).join('');
  }

  const scriptsEl = document.getElementById('suite-detail-scripts');
  const scripts   = data.scripts || [];
  scriptsEl.innerHTML = !scripts.length
    ? '<div class="builder-hint">No scripts in this suite.</div>'
    : scripts.map(sc => `
      <div class="suite-script-block">
        <div class="suite-script-header" onclick="suiteToggleScript(this)">
          <input type="checkbox" class="suite-script-chk" value="${escHtml(sc.id)}"
                 onclick="event.stopPropagation()" onchange="suiteCheckChanged()" />
          <span class="suite-script-chevron">&#9658;</span>
          <span style="font-weight:600;font-size:13px;flex:1">${escHtml(sc.title)}</span>
          <span class="badge badge-${escHtml(sc.priority)}" style="flex-shrink:0">${escHtml(sc.priority)}</span>
          <span style="font-size:12px;color:var(--neutral-400);flex-shrink:0;margin-left:6px">${sc.steps.length} steps</span>
        </div>
        <div class="suite-script-steps">
          ${(sc.steps || []).map(step => `
            <div class="suite-step-line">
              <span class="suite-step-num">${step.order}</span>
              <span class="suite-step-kw">${escHtml(step.keyword)}</span>
              ${step.locator     ? `<span class="suite-step-loc">${escHtml(step.locator)}</span>` : ''}
              ${step.value       ? `<span class="suite-step-val">${escHtml(step.value)}</span>` : ''}
              ${step.description ? `<span style="color:var(--neutral-400);font-size:11.5px">${escHtml(step.description)}</span>` : ''}
              ${step.screenshot  ? '<span class="suite-step-ss">&#x1F4F7;</span>' : ''}
            </div>`).join('')}
        </div>
      </div>`).join('');

  document.getElementById('suite-run-card').style.display = 'none';
  document.getElementById('suite-bulk-remove-btn').style.display = 'none';
  document.getElementById('suite-detail-overlay').style.display = 'flex';
}

function suiteDetailClose() {
  document.getElementById('suite-detail-overlay').style.display = 'none';
  currentSuiteId = null;
}

function suiteDetailEdit() {
  if (!currentSuiteId) return;
  suiteDetailClose();
  suiteEditById(currentSuiteId);
}

function suiteToggleScript(header) {
  const chevron = header.querySelector('.suite-script-chevron');
  const steps   = header.nextElementSibling;
  const isOpen  = header.classList.toggle('open');
  if (chevron) chevron.classList.toggle('open', isOpen);
  if (steps)   steps.classList.toggle('open', isOpen);
}

function suiteCheckChanged() {
  const anyChecked = !!document.querySelector('#suite-detail-scripts .suite-script-chk:checked');
  const btn = document.getElementById('suite-bulk-remove-btn');
  if (btn) btn.style.display = anyChecked ? '' : 'none';
}

function suiteSelectAll(checked) {
  document.querySelectorAll('#suite-detail-scripts .suite-script-chk').forEach(c => c.checked = checked);
  const btn = document.getElementById('suite-bulk-remove-btn');
  if (btn) btn.style.display = checked ? '' : 'none';
}

async function suiteRemoveSelected() {
  if (!currentSuiteId) return;
  const toRemove = new Set(
    [...document.querySelectorAll('#suite-detail-scripts .suite-script-chk:checked')].map(c => c.value)
  );
  if (!toRemove.size) { alert('Select at least one script to remove.'); return; }
  if (!confirm(`Remove ${toRemove.size} script(s) from suite?`)) return;
  const s = allSuites.find(x => x.id === currentSuiteId);
  if (!s) return;
  const newIds = (s.scriptIds || []).filter(id => !toRemove.has(id));
  const res = await fetch(`/api/suites/${currentSuiteId}`, {
    method: 'PUT', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ ...s, scriptIds: newIds }),
  });
  if (res.ok) { await suiteLoad(); await suiteOpenDetail(currentSuiteId); }
}

async function suiteRunFromCard(suiteId, btn) {
  btn.disabled = true;
  btn.textContent = '⏳…';
  currentSuiteId = suiteId;
  await suiteOpenDetail(suiteId);
  btn.disabled = false;
  btn.innerHTML = '&#9654; Run';
  suiteRun();
}

async function suiteRun() {
  if (!currentSuiteId) return;
  const runBtn   = document.getElementById('suite-run-btn');
  const runCard  = document.getElementById('suite-run-card');
  const logEl    = document.getElementById('suite-run-output');
  const statusEl = document.getElementById('suite-run-status');
  const statsEl  = document.getElementById('suite-run-stats');
  const rlEl     = document.getElementById('suite-report-link');
  const anchorEl = document.getElementById('suite-report-anchor');

  runBtn.disabled = true;
  runBtn.textContent = '⏳ Running…';
  runCard.style.display = '';
  if (statusEl) statusEl.textContent = '⏳ Starting…';
  if (statsEl)  statsEl.textContent  = '';
  if (logEl)    logEl.innerHTML      = '<div style="color:#858585">Connecting…</div>';
  if (rlEl)     rlEl.style.display   = 'none';

  const runEnvId = document.getElementById('suite-run-env')?.value || null;
  if (!runEnvId) {
    runBtn.disabled = false; runBtn.textContent = '▶ Run Suite';
    if (statusEl) statusEl.textContent = '';
    if (logEl)    logEl.innerHTML = '';
    runCard.style.display = 'none';
    alert('Please select an Environment before running the suite.');
    return;
  }
  const res  = await fetch(`/api/suites/${currentSuiteId}/run`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ environmentId: runEnvId }),
  });
  const data = await res.json();
  if (!res.ok) {
    runBtn.disabled = false; runBtn.textContent = '▶ Run Suite';
    if (statusEl) statusEl.textContent = '✗ Failed to start';
    if (logEl)    logEl.innerHTML = `<div style="color:#f48771">${escHtml(data.error || 'Error')}</div>`;
    return;
  }

  const { runId } = data;
  if (logEl) logEl.innerHTML = '';
  if (statusEl) statusEl.textContent = '⏳ Running…';

  // Use HTTP polling — works through any proxy without WS upgrade support
  let seenLines = 0;
  let pollTimer = null;
  let stopped   = false;

  async function poll() {
    if (stopped) return;
    try {
      const r = await fetch(`/api/run/${runId}`);
      if (!r.ok) {
        // 404 means run not registered yet — retry shortly
        pollTimer = setTimeout(poll, 1500);
        return;
      }
      const rec = await r.json();

      // Append only new lines (server returns last 100; track by index)
      if (logEl && Array.isArray(rec.output)) {
        const newLines = rec.output.slice(seenLines);
        for (const line of newLines) {
          const colour = /\s+✓|\s+passed/i.test(line)  ? '#4ec9b0'
                       : /\s+✗|\s+failed|error/i.test(line) ? '#f48771'
                       : /warn/i.test(line)             ? '#dcdcaa'
                       : '#d4d4d4';
          const div = document.createElement('div');
          div.style.color = colour;
          div.textContent = line;
          logEl.appendChild(div);
          logEl.scrollTop = logEl.scrollHeight;
        }
        seenLines += newLines.length;
      }

      const p = rec.passed || 0, f = rec.failed || 0, t = rec.total || 0;
      if (statsEl) statsEl.textContent = `${p} passed · ${f} failed · ${t} total`;

      if (rec.status === 'running' || rec.status === undefined) {
        pollTimer = setTimeout(poll, 1500);
        return;
      }

      // Run finished
      stopped = true;
      runBtn.disabled = false; runBtn.textContent = '▶ Run Suite';
      const ok = f === 0 && rec.exitCode === 0;
      if (statusEl) statusEl.textContent = ok
        ? `✓ Done — ${p} passed`
        : `✗ Done — ${p} passed, ${f} failed`;
      if (rlEl && anchorEl) { anchorEl.href = `/api/report/${runId}`; rlEl.style.display = ''; }

    } catch (err) {
      // Network error — keep retrying
      pollTimer = setTimeout(poll, 2000);
    }
  }

  poll();
}

// ══════════════════════════════════════════════════════════════════════════════
// Bootstrap on DOMContentLoaded
// ══════════════════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', async () => {
  // Load keyword registry early (non-blocking)
  keywordsLoad();

  await authBootstrap();

  // Wrap switchTab AFTER app.js has set its final version (runtime, not hoist-time)
  const _appSwitchTab = switchTab;
  switchTab = function(tab) {
    _appSwitchTab(tab);
    onModuleTabSwitch(tab);
    _guardCheck(tab);   // enforce project selection on every tab switch
  };

  // Re-bind nav-item clicks so new wrapper is used
  document.querySelectorAll('.nav-item').forEach(item =>
    item.addEventListener('click', () => switchTab(item.dataset.tab))
  );

  // Pre-load locators for the inline picker
  locatorLoad();
});

// ══════════════════════════════════════════════════════════════════════════════
// EXECUTION HISTORY MODULE
// ══════════════════════════════════════════════════════════════════════════════

let _histRuns   = [];
let _histSortCol = 'startedAt';
let _histSortDir = -1; // -1 = desc, 1 = asc

async function histLoad() {
  if (!currentProjectId) {
    _histRuns = [];
    histRender();
    return;
  }
  try {
    const res = await fetch(`/api/runs?projectId=${encodeURIComponent(currentProjectId)}`);
    _histRuns = res.ok ? await res.json() : [];
  } catch { _histRuns = []; }
  _histPopulateEnvFilter();
  histRender();
}

function _histPopulateEnvFilter() {
  const sel = document.getElementById('hist-filter-env');
  if (!sel) return;
  const envs = [...new Set(_histRuns.map(r => r.environmentName).filter(Boolean))];
  sel.innerHTML = '<option value="">All Environments</option>' +
    envs.map(e => `<option value="${escHtml(e)}">${escHtml(e)}</option>`).join('');
}

function histRender() {
  const tbody   = document.getElementById('hist-tbody');
  const emptyEl = document.getElementById('hist-empty');
  if (!tbody) return;

  if (!currentProjectId) {
    tbody.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = 'Select a project to view execution history.'; }
    return;
  }

  const dateVal   = (document.getElementById('hist-filter-date')?.value   || '').trim();
  const search    = (document.getElementById('hist-filter-search')?.value  || '').toLowerCase();
  const statusVal = (document.getElementById('hist-filter-status')?.value  || '');
  const envVal    = (document.getElementById('hist-filter-env')?.value     || '');

  let runs = _histRuns.slice();

  if (dateVal) {
    runs = runs.filter(r => r.startedAt && r.startedAt.startsWith(dateVal));
  }
  if (statusVal) {
    runs = runs.filter(r => r.status === statusVal);
  }
  if (envVal) {
    runs = runs.filter(r => (r.environmentName || '') === envVal);
  }
  if (search) {
    runs = runs.filter(r =>
      (r.runId        || '').toLowerCase().includes(search) ||
      (r.suiteName    || '').toLowerCase().includes(search) ||
      (r.executedBy   || '').toLowerCase().includes(search)
    );
  }

  // Sort
  runs.sort((a, b) => {
    const va = a[_histSortCol] ?? '';
    const vb = b[_histSortCol] ?? '';
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * _histSortDir;
    return String(va).localeCompare(String(vb)) * _histSortDir;
  });

  if (!runs.length) {
    tbody.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = 'No execution records match the current filters.'; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  tbody.innerHTML = runs.map(r => {
    const statusBadge = _histStatusBadge(r.status);
    const start   = r.startedAt  ? _histFmtDate(r.startedAt)  : '—';
    const end     = r.finishedAt ? _histFmtDate(r.finishedAt) : '—';
    const dur     = (r.startedAt && r.finishedAt) ? _histDuration(r.startedAt, r.finishedAt) : '—';
    const shortId = (r.runId || '').slice(0, 8);
    const suite   = escHtml(r.suiteName || r.planId || '—');
    const env     = escHtml(r.environmentName || '—');
    const by      = escHtml(r.executedBy || '—');
    const isDone  = r.status === 'done' || r.status === 'failed';
    const reportBtn = isDone
      ? `<button class="btn btn-secondary btn-xs" onclick="histOpenReport('${escHtml(r.runId)}')">&#128196; View Report</button>`
      : `<span style="color:#858585;font-size:11px">In Progress</span>`;
    return `<tr>
      <td><code style="font-size:11px">${escHtml(shortId)}</code></td>
      <td>${suite}</td>
      <td>${statusBadge}</td>
      <td style="text-align:center">${r.total  || 0}</td>
      <td style="text-align:center;color:#4ec9b0">${r.passed || 0}</td>
      <td style="text-align:center;color:${r.failed ? '#f48771' : 'inherit'}">${r.failed || 0}</td>
      <td style="font-size:12px">${start}</td>
      <td style="font-size:12px">${end}</td>
      <td style="font-size:12px">${dur}</td>
      <td>${env}</td>
      <td>${by}</td>
      <td>${reportBtn}</td>
    </tr>`;
  }).join('');
}

function _histStatusBadge(status) {
  const map = {
    running: '<span class="hist-badge hist-badge-running">&#9679; In Progress</span>',
    done:    '<span class="hist-badge hist-badge-done">&#10003; Completed</span>',
    failed:  '<span class="hist-badge hist-badge-failed">&#10007; Failed</span>',
  };
  return map[status] || `<span class="hist-badge">${escHtml(status)}</span>`;
}

function _histFmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return iso; }
}

function _histDuration(startIso, endIso) {
  try {
    const ms = new Date(endIso) - new Date(startIso);
    if (ms < 0) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60), rs = s % 60;
    return `${m}m ${rs}s`;
  } catch { return '—'; }
}

async function histViewDetail(runId) {
  const overlay = document.getElementById('hist-detail-overlay');
  const body    = document.getElementById('hist-detail-body');
  const title   = document.getElementById('hist-detail-title');
  if (!overlay || !body) return;

  body.innerHTML = '<div style="padding:24px;text-align:center;color:#858585">Loading…</div>';
  overlay.style.display = '';

  try {
    const res = await fetch(`/api/run/${encodeURIComponent(runId)}`);
    if (!res.ok) throw new Error('Run not found');
    const r = await res.json();

    const shortId = (r.runId || '').slice(0, 8);
    if (title) title.textContent = `Execution Report — ${shortId}`;

    const dur = (r.startedAt && r.finishedAt) ? _histDuration(r.startedAt, r.finishedAt) : '—';
    const passRate = r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
    const statusBadge = _histStatusBadge(r.status);

    // Test results table
    const tests = Array.isArray(r.tests) ? r.tests : [];
    const testRows = tests.map((t, i) => {
      const st = t.status === 'pass'
        ? '<span style="color:#4ec9b0;font-weight:600">&#10003; Passed</span>'
        : t.status === 'fail'
        ? '<span style="color:#f48771;font-weight:600">&#10007; Failed</span>'
        : `<span style="color:#858585">${escHtml(t.status)}</span>`;
      const dur2 = t.durationMs >= 1000
        ? `${(t.durationMs / 1000).toFixed(1)}s`
        : `${t.durationMs}ms`;
      return `<tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escHtml(t.name || '—')}</td>
        <td>${st}</td>
        <td>${dur2}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="hist-report">
        <h3 style="margin:0 0 16px;font-size:14px;color:#9cdcfe;text-transform:uppercase;letter-spacing:1px">Execution Summary</h3>
        <div class="hist-summary-grid">
          <div class="hist-summary-item"><span class="hist-lbl">Execution ID</span><span class="hist-val"><code>${escHtml(r.runId || '—')}</code></span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Project</span><span class="hist-val">${escHtml(r.projectName || '—')}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Test Suite</span><span class="hist-val">${escHtml(r.suiteName || r.planId || '—')}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Environment</span><span class="hist-val">${escHtml(r.environmentName || '—')}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Executed By</span><span class="hist-val">${escHtml(r.executedBy || '—')}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Status</span><span class="hist-val">${statusBadge}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Start Time</span><span class="hist-val">${r.startedAt ? _histFmtDate(r.startedAt) : '—'}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">End Time</span><span class="hist-val">${r.finishedAt ? _histFmtDate(r.finishedAt) : '—'}</span></div>
          <div class="hist-summary-item"><span class="hist-lbl">Duration</span><span class="hist-val">${dur}</span></div>
        </div>

        <h3 style="margin:24px 0 12px;font-size:14px;color:#9cdcfe;text-transform:uppercase;letter-spacing:1px">Test Execution Summary</h3>
        <div class="hist-metrics-row">
          <div class="hist-metric"><div class="hist-metric-val">${r.total  || 0}</div><div class="hist-metric-lbl">Total</div></div>
          <div class="hist-metric hist-metric-pass"><div class="hist-metric-val">${r.passed || 0}</div><div class="hist-metric-lbl">Passed</div></div>
          <div class="hist-metric hist-metric-fail"><div class="hist-metric-val">${r.failed || 0}</div><div class="hist-metric-lbl">Failed</div></div>
          <div class="hist-metric"><div class="hist-metric-val">${passRate}%</div><div class="hist-metric-lbl">Pass Rate</div></div>
        </div>

        ${tests.length ? `
        <h3 style="margin:24px 0 12px;font-size:14px;color:#9cdcfe;text-transform:uppercase;letter-spacing:1px">Test Case Results</h3>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr><th>#</th><th>Test Case</th><th>Status</th><th>Duration</th></tr></thead>
            <tbody>${testRows}</tbody>
          </table>
        </div>` : '<p style="color:#858585;margin-top:16px">No individual test results recorded.</p>'}
      </div>`;
  } catch (err) {
    body.innerHTML = `<div style="padding:24px;color:#f48771">Failed to load report: ${escHtml(err.message)}</div>`;
  }
}

function histDetailClose() {
  const overlay = document.getElementById('hist-detail-overlay');
  if (overlay) overlay.style.display = 'none';
}

function histOpenReport(runId) {
  window.open(`/execution-report?runId=${encodeURIComponent(runId)}`, '_blank');
}

function histSort(col) {
  if (_histSortCol === col) {
    _histSortDir *= -1;
  } else {
    _histSortCol = col;
    _histSortDir = col === 'startedAt' ? -1 : 1;
  }
  // Update sort icons
  document.querySelectorAll('.sort-icon').forEach(el => el.textContent = '');
  const icon = document.getElementById(`si-${col}`);
  if (icon) icon.textContent = _histSortDir === 1 ? ' ▲' : ' ▼';
  histRender();
}
