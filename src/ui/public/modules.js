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
  await usersLoad();
}

async function userDelete(id, username) {
  if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
  const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
  if (res.ok) await usersLoad();
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

let editingCdId  = null;
let allCommonData = [];
let _cdPage = 0;
const CD_PAGE_SIZE = 10;

async function cdLoad() {
  const tbody = document.getElementById('cd-tbody');
  if (!tbody) return;
  if (!currentProjectId) {
    allCommonData = [];
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">Select a project first.</td></tr>';
    document.getElementById('cd-pagination').innerHTML = '';
    return;
  }
  const env = document.getElementById('cd-env-filter')?.value || '';
  const qs  = `?projectId=${encodeURIComponent(currentProjectId)}${env ? '&environment=' + encodeURIComponent(env) : ''}`;
  const res  = await fetch(`/api/common-data${qs}`);
  allCommonData = await res.json();
  _cdPage = 0;
  cdRender();
}

function cdRender() {
  const tbody = document.getElementById('cd-tbody');
  const pgEl  = document.getElementById('cd-pagination');
  if (!tbody) return;
  const list = allCommonData;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:24px">No data entries yet. Click <strong>+ Add Common Data</strong> to create one.</td></tr>';
    if (pgEl) pgEl.innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(list.length / CD_PAGE_SIZE));
  if (_cdPage >= totalPages) _cdPage = totalPages - 1;
  const page = list.slice(_cdPage * CD_PAGE_SIZE, (_cdPage + 1) * CD_PAGE_SIZE);
  tbody.innerHTML = page.map(d => `
    <tr>
      <td title="${escHtml('\${' + d.dataName + '}')}" ><code style="background:var(--neutral-100);padding:2px 6px;border-radius:3px;font-size:12.5px">\${${escHtml(d.dataName)}}</code></td>
      <td>
        ${d.sensitive
          ? `<span style="letter-spacing:2px;color:var(--neutral-400);font-size:13px">••••••••</span>
             <button class="tbl-btn" style="margin-left:6px;font-size:10px;padding:1px 6px" onclick="cdReveal('${escHtml(d.id)}',this)" title="Reveal value">👁</button>`
          : `<span title="${escHtml(d.value)}">${escHtml(d.value)}</span>`}
        ${d.sensitive ? '<span class="badge badge-fail" style="margin-left:6px;font-size:10px;padding:1px 5px">sensitive</span>' : ''}
      </td>
      <td><span class="badge badge-${d.environment === 'PROD' ? 'fail' : d.environment === 'UAT' ? 'medium' : 'active'}">${escHtml(d.environment)}</span></td>
      <td>${escHtml(d.createdBy || '—')}</td>
      <td>${formatDate(d.createdAt)}</td>
      <td>
        <button class="tbl-btn" onclick="cdEdit('${escHtml(d.id)}')">Edit</button>
        <button class="tbl-btn del" onclick="cdDelete('${escHtml(d.id)}','${escHtml(d.dataName)}')">Delete</button>
      </td>
    </tr>`).join('');
  if (pgEl) {
    const start = list.length ? _cdPage * CD_PAGE_SIZE + 1 : 0;
    const end   = Math.min((_cdPage + 1) * CD_PAGE_SIZE, list.length);
    pgEl.innerHTML = totalPages <= 1 ? '' : `
      <button class="tbl-btn" onclick="_cdPageGo(-1)" ${_cdPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span>Page ${_cdPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${list.length})</span>
      <button class="tbl-btn" onclick="_cdPageGo(1)" ${_cdPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`;
  }
}

function _cdPageGo(delta) { _cdPage += delta; cdRender(); }

function cdOpenModal(id = null) {
  editingCdId = id;
  modClearAlert('cd-modal-alert');
  document.getElementById('cd-modal-title').textContent = id ? 'Edit Common Data' : 'Add Common Data';
  if (!id) {
    document.getElementById('cd-name').value  = '';
    document.getElementById('cd-value').value = '';
    document.getElementById('cd-env').value   = 'QA';
    const sensEl = document.getElementById('cd-sensitive');
    if (sensEl) sensEl.checked = false;
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
  // Sensitive values show placeholder — user must re-type to change, or leave to keep existing
  document.getElementById('cd-value').value = d.sensitive ? '' : d.value;
  document.getElementById('cd-value').placeholder = d.sensitive ? 'Leave blank to keep existing value' : '';
  document.getElementById('cd-env').value   = d.environment;
  const sensEl = document.getElementById('cd-sensitive');
  if (sensEl) sensEl.checked = !!d.sensitive;
  modClearAlert('cd-modal-alert');
  openModal('modal-common-data');
}

async function cdSave() {
  modClearAlert('cd-modal-alert');
  const dataName    = document.getElementById('cd-name').value.trim();
  const value       = document.getElementById('cd-value').value.trim();
  const environment = document.getElementById('cd-env').value;
  const sensitive   = !!(document.getElementById('cd-sensitive')?.checked);
  if (!dataName)    { modAlert('cd-modal-alert', 'error', 'Data Name is required'); return; }
  if (!environment) { modAlert('cd-modal-alert', 'error', 'Environment is required'); return; }
  if (!currentProjectId) { modAlert('cd-modal-alert', 'error', 'Select a project first'); return; }
  // On edit of sensitive entry: if value blank, omit it — server keeps existing encrypted value
  const body   = { projectId: currentProjectId, dataName, environment, sensitive,
                   ...(value || !editingCdId ? { value } : {}) };
  const method = editingCdId ? 'PUT'  : 'POST';
  const url    = editingCdId ? `/api/common-data/${editingCdId}` : '/api/common-data';
  const res    = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data   = await res.json();
  if (!res.ok) { modAlert('cd-modal-alert', 'error', data.error || 'Error saving'); return; }
  cdCloseModal();
  await cdLoad();
}

async function cdReveal(id, btn) {
  const cell = btn.parentElement;
  const res  = await fetch(`/api/common-data/${id}/reveal`);
  if (!res.ok) { alert('Could not reveal value'); return; }
  const { value } = await res.json();
  const span = document.createElement('span');
  span.style.cssText = 'font-family:monospace;font-size:12px;background:var(--neutral-100);padding:2px 6px;border-radius:3px;margin-left:4px';
  span.textContent = value;
  btn.replaceWith(span);
  // Auto-hide after 10 seconds
  setTimeout(() => {
    span.replaceWith(btn);
  }, 10000);
}

async function cdDelete(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  await fetch(`/api/common-data/${id}`, { method: 'DELETE' });
  await cdLoad();
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
  await projLoad();
}

async function projDelete(id, name) {
  if (!confirm(`Delete project "${name}"?`)) return;
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  await projLoad();
}

function projCloseModal() { closeModal('modal-project'); editingProjectId = null; }

// ══════════════════════════════════════════════════════════════════════════════
// LOCATOR REPOSITORY
// ══════════════════════════════════════════════════════════════════════════════

let allLocators = [];
let editingLocatorId = null;
let _locPage = 0;
const LOC_PAGE_SIZE = 10;

async function locatorLoad() {
  const url = currentProjectId
    ? `/api/locators?projectId=${encodeURIComponent(currentProjectId)}`
    : '/api/locators';
  const res = await fetch(url);
  allLocators = await res.json();
  _locPage = 0;
  locatorRender();
}

function locatorRender() {
  const nameF   = (document.getElementById('loc-filter-name')?.value   ?? '').toLowerCase();
  const moduleF = (document.getElementById('loc-filter-module')?.value ?? '').toLowerCase();
  const typeF   = (document.getElementById('loc-filter-type')?.value   ?? '').toLowerCase();

  const filtered = allLocators.filter(l =>
    (!nameF   || l.name.toLowerCase().includes(nameF)) &&
    (!moduleF || (l.pageModule || '').toLowerCase().includes(moduleF)) &&
    (!typeF   || (l.selectorType || '').toLowerCase() === typeF)
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / LOC_PAGE_SIZE));
  if (_locPage >= totalPages) _locPage = totalPages - 1;

  const pageItems = filtered.slice(_locPage * LOC_PAGE_SIZE, (_locPage + 1) * LOC_PAGE_SIZE);

  const tbody = document.getElementById('loc-tbody');
  if (!tbody) return;

  tbody.innerHTML = pageItems.map(l => {
    const isAuto = (l.description || '').toLowerCase().includes('auto-captured');
    const autoTag = isAuto ? `<span class="badge" style="background:#7c3aed;color:#fff;font-size:10px;margin-left:4px">Auto</span>` : '';
    const truncSel = l.selector.length > 60 ? `<span title="${escHtml(l.selector)}">${escHtml(l.selector.substring(0, 60))}…</span>` : escHtml(l.selector);
    return `<tr>
      <td><strong>${escHtml(l.name)}</strong>${autoTag}</td>
      <td><code style="font-size:11px">${truncSel}</code></td>
      <td><span class="badge badge-tester">${escHtml(l.selectorType)}</span></td>
      <td>${escHtml(l.pageModule || '—')}</td>
      <td>${escHtml(l.description || '—')}</td>
      <td>
        <button class="tbl-btn" onclick="locatorEdit('${escHtml(l.id)}')">Edit</button>
        <button class="tbl-btn del" onclick="locatorDelete('${escHtml(l.id)}','${escHtml(l.name)}')">Del</button>
      </td>
    </tr>`;
  }).join('');

  if (!pageItems.length) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">No locators found</td></tr>';

  // Pagination controls
  const wrap = document.getElementById('loc-pagination');
  if (wrap) {
    const start = filtered.length ? _locPage * LOC_PAGE_SIZE + 1 : 0;
    const end   = Math.min((_locPage + 1) * LOC_PAGE_SIZE, filtered.length);
    wrap.innerHTML = `
      <span style="font-size:13px;color:var(--neutral-500)">${start}–${end} of ${filtered.length}</span>
      <button class="tbl-btn" onclick="_locPageGo(-1)" ${_locPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span style="font-size:13px">Page ${_locPage + 1} / ${totalPages}</span>
      <button class="tbl-btn" onclick="_locPageGo(1)" ${_locPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`;
  }
}

function _locPageGo(delta) {
  _locPage += delta;
  locatorRender();
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
let _fnPage = 0;
const FN_PAGE_SIZE = 10;

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
  const pgEl  = document.getElementById('fn-pagination');
  if (!tbody) return;
  const q = (document.getElementById('fn-search')?.value || '').toLowerCase();
  const filtered = allFunctions.filter(f =>
    !q || f.name.toLowerCase().includes(q) || (f.identifier||'').toLowerCase().includes(q) || (f.description||'').toLowerCase().includes(q)
  );
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:24px">
      ${allFunctions.length ? 'No functions match the search.' : 'No functions yet. Click <strong>+ New Function</strong> to create one.'}</td></tr>`;
    if (pgEl) pgEl.innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / FN_PAGE_SIZE));
  if (_fnPage >= totalPages) _fnPage = totalPages - 1;
  const page = filtered.slice(_fnPage * FN_PAGE_SIZE, (_fnPage + 1) * FN_PAGE_SIZE);
  tbody.innerHTML = page.map(f => `
    <tr>
      <td style="font-weight:600" title="${escHtml(f.name)}">${escHtml(f.name)}</td>
      <td><code style="background:var(--neutral-100);padding:2px 7px;border-radius:4px;font-size:12.5px">${escHtml(f.identifier || '—')}</code></td>
      <td title="${escHtml(f.description || '')}" style="color:var(--neutral-500);font-size:12.5px">${escHtml(f.description || '—')}</td>
      <td style="text-align:center">${f.steps.length}</td>
      <td>${escHtml(f.createdBy || '—')}</td>
      <td>${formatDate(f.createdAt)}</td>
      <td>
        <button class="tbl-btn" onclick="fnEdit('${escHtml(f.id)}')">Edit</button>
        <button class="tbl-btn del" onclick="fnDelete('${escHtml(f.id)}','${escHtml(f.name)}')">Delete</button>
      </td>
    </tr>`).join('');
  if (pgEl) {
    const start = filtered.length ? _fnPage * FN_PAGE_SIZE + 1 : 0;
    const end   = Math.min((_fnPage + 1) * FN_PAGE_SIZE, filtered.length);
    pgEl.innerHTML = totalPages <= 1 ? '' : `
      <button class="tbl-btn" onclick="_fnPageGo(-1)" ${_fnPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span>Page ${_fnPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${filtered.length})</span>
      <button class="tbl-btn" onclick="_fnPageGo(1)" ${_fnPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`;
  }
}

function _fnPageGo(delta) { _fnPage += delta; fnRender(); }

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
  await fnLoad();
}

async function fnDelete(id, name) {
  if (!confirm(`Delete function "${name}"?`)) return;
  await fetch(`/api/functions/${id}`, { method: 'DELETE' });
  await fnLoad();
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
const PROJECT_SCOPED_TABS = new Set(['scripts','suites','locators','functions','commondata','history','flaky']);

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
  _scriptPage = 0; _fnPage = 0; _cdPage = 0; _locPage = 0;
  scriptLoad();
  suiteLoad();
  locatorLoadScoped();
  fnLoad();
  cdLoad();
  histLoad();
  flakyLoad();
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
let _scriptPage     = 0;
const SCRIPT_PAGE_SIZE = 10;

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
  const totalPages = Math.max(1, Math.ceil(filtered.length / SCRIPT_PAGE_SIZE));
  if (_scriptPage >= totalPages) _scriptPage = totalPages - 1;
  const page = filtered.slice(_scriptPage * SCRIPT_PAGE_SIZE, (_scriptPage + 1) * SCRIPT_PAGE_SIZE);
  const start = filtered.length ? _scriptPage * SCRIPT_PAGE_SIZE + 1 : 0;
  const end   = Math.min((_scriptPage + 1) * SCRIPT_PAGE_SIZE, filtered.length);
  const pgHtml = totalPages <= 1 ? '' : `
    <div class="lt-pagination">
      <button class="tbl-btn" onclick="_scriptPageGo(-1)" ${_scriptPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span>Page ${_scriptPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${filtered.length})</span>
      <button class="tbl-btn" onclick="_scriptPageGo(1)" ${_scriptPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>
    </div>`;
  listEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 2px 8px">
      <label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer">
        <input type="checkbox" id="script-select-all" onchange="scriptSelectAll(this)" /> Select All
      </label>
      <button class="tbl-btn del" id="script-bulk-del-btn" style="display:none" onclick="scriptDeleteSelected()">Delete Selected</button>
      <span id="script-sel-count" style="font-size:12px;color:var(--neutral-400)"></span>
    </div>
    <div class="lt-wrap">
      <div class="lt-body-wrap">
        <table class="data-table lt-fixed">
          <thead><tr>
            <th style="min-width:32px;width:32px"></th>
            <th style="min-width:86px">TC ID</th>
            <th style="min-width:200px">Title</th>
            <th style="min-width:130px">Component</th>
            <th style="min-width:130px">Tag</th>
            <th style="min-width:90px">Priority</th>
            <th style="min-width:100px">Created By</th>
            <th style="min-width:100px">Date</th>
            <th style="min-width:120px">Actions</th>
          </tr></thead>
          <tbody>
          ${page.map(s => `
            <tr class="script-tbl-row" data-id="${escHtml(s.id)}">
              <td><input type="checkbox" class="script-row-chk" value="${escHtml(s.id)}" onchange="scriptSelectionChanged()" /></td>
              <td><span style="font-family:monospace;font-weight:600;color:var(--primary);font-size:12.5px">${escHtml(s.tcId || '—')}</span></td>
              <td title="${escHtml(s.title)}"><div style="font-weight:500">${escHtml(s.title)}</div></td>
              <td title="${escHtml(s.component || '')}">${escHtml(s.component || '—')}</td>
              <td>${(s.tags||[]).length ? (s.tags||[]).map(t=>`<span class="badge badge-tester">${escHtml(t)}</span>`).join(' ') : '—'}</td>
              <td><span class="badge badge-${escHtml(s.priority)}">${escHtml(s.priority)}</span></td>
              <td style="font-size:12px">${escHtml(s.createdBy || '—')}</td>
              <td style="font-size:12px">${formatDate(s.createdAt)}</td>
              <td>
                <div style="display:flex;gap:4px">
                  <button class="tbl-btn" onclick="scriptOpenEditor('${escHtml(s.id)}')">Edit</button>
                  <button class="tbl-btn dbg" onclick="debugOpen('${escHtml(s.id)}')">&#128027;</button>
                  <button class="tbl-btn del" onclick="scriptDelete('${escHtml(s.id)}','${escHtml(s.title)}')">Del</button>
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${pgHtml}`;
}

function _scriptPageGo(delta) {
  _scriptPage += delta;
  scriptRender();
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
      <button type="button" class="step-action-btn" onclick="scriptStepInsertBelow(this)" title="Insert Step Below">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button type="button" class="step-action-btn step-clone-icon" onclick="scriptStepClone(this)" title="Clone Step">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
      <button type="button" class="step-action-btn step-pin-icon${step.storeAs ? ' step-pin-active' : ''}" onclick="scriptStepPinOpen(this)" title="Save value as variable (📌 Pin)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 6 6 1-4.5 4 1 6L12 16l-5.5 3 1-6L3 9l6-1z"/></svg>
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
    <div class="step-pin-badge${step.storeAs ? '' : ' step-pin-badge-hidden'}" data-store-as="${escHtml(step.storeAs||'')}" data-store-source="${escHtml(step.storeSource||'text')}" data-store-attr="${escHtml(step.storeAttrName||'')}">
      <span class="pin-badge-label">📌 Saved as <code>{{var.${escHtml(step.storeAs||'')}}}</code></span>
      <button type="button" class="pin-badge-clear" onclick="scriptStepPinClear(this)" title="Remove variable">✕</button>
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
            <button type="button" class="value-toggle-btn${valMode==='static'   ?' active':''}" onclick="scriptStepToggleVal(this,'static')">Static</button>
            <button type="button" class="value-toggle-btn${valMode==='dynamic'  ?' active':''}" onclick="scriptStepToggleVal(this,'dynamic')">Dynamic</button>
            <button type="button" class="value-toggle-btn${isCd                 ?' active':''}" onclick="scriptStepToggleVal(this,'commondata')">Common Data</button>
            <button type="button" class="value-toggle-btn value-toggle-td${isTd ?' active':''}" onclick="scriptStepToggleVal(this,'testdata')" title="Placeholder — future Test Data dataset integration">Test Data (Static)</button>
            <button type="button" class="value-toggle-btn value-toggle-var${valMode==='variable'?' active':''}" onclick="scriptStepToggleVal(this,'variable')" title="Use a pinned variable from an earlier step">📌 Variable</button>
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
          <div class="se-step-val-var" style="${valMode==='variable'?'':'display:none'}">
            <select class="fm-select se-step-var-select" style="font-size:12.5px" onchange="_varSelectChanged(this)">
              <option value="">— pick a variable —</option>
            </select>
            <div class="var-usage-hint" style="font-size:11px;color:var(--neutral-500);margin-top:4px;display:none">
              Use <code class="var-usage-token"></code> in any value field to reference this variable
            </div>
            <div class="var-no-vars-hint" style="font-size:11px;color:var(--neutral-400);margin-top:4px;display:none">
              No variables defined yet. Use the 📌 pin icon on an earlier FILL or TYPE step to create one.
            </div>
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
      <!-- FILE CHOOSER upload widget -->
      <div class="se-filechooser-widget" style="display:none">
        <div class="fc-upload-area" style="${step.keyword==='FILE CHOOSER' && step.value ? 'display:none' : ''}">
          <label class="fc-browse-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Browse &amp; Upload File
            <input type="file" class="fc-file-input" style="display:none" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.json,.xml,.zip" onchange="scriptStepFileChooserUpload(this)" />
          </label>
          <span class="fc-hint">File is uploaded to the server and used during test execution</span>
        </div>
        <div class="fc-file-info" style="${step.keyword==='FILE CHOOSER' && step.value ? '' : 'display:none'}" data-server-path="${escHtml(step.value||'')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="fc-filename">${escHtml(step.value ? step.value.split('/').pop() : '')}</span>
          <span class="fc-server-path">${escHtml(step.value||'')}</span>
          <button type="button" class="fc-replace-btn" onclick="scriptStepFileChooserReplace(this)" title="Replace with a different file">
            Replace
            <input type="file" class="fc-file-input" style="display:none" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.json,.xml,.zip" onchange="scriptStepFileChooserUpload(this)" />
          </button>
          <button type="button" class="fc-remove-btn" onclick="scriptStepFileChooserRemove(this)" title="Remove file">✕</button>
        </div>
        <div class="fc-uploading" style="display:none">
          <span class="fc-spinner"></span> Uploading…
        </div>
      </div>
      <!-- SET VARIABLE special fields -->
      <div class="se-setvar-fields" style="display:none">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
          <div class="field" style="margin:0;flex:1;min-width:140px">
            <label style="font-size:11px">Read From</label>
            <select class="fm-select se-setvar-source" style="font-size:12px" onchange="_setVarSourceChanged(this)" data-saved="${escHtml(step.storeSource||'text')}">
              <option value="text"  ${(step.storeSource||'text')==='text' ?'selected':''}>Text shown on page</option>
              <option value="value" ${step.storeSource==='value'?'selected':''}>Value inside an input field</option>
              <option value="attr"  ${step.storeSource==='attr' ?'selected':''}>Element attribute</option>
              <option value="js"    ${step.storeSource==='js'   ?'selected':''}>Run JavaScript (advanced)</option>
            </select>
          </div>
          <div class="field se-setvar-attr-wrap" style="margin:0;width:130px;${step.storeSource==='attr'?'':'display:none'}">
            <label style="font-size:11px">Attribute Name</label>
            <input class="fm-input se-setvar-attr" style="font-size:12px" placeholder="e.g. href" value="${escHtml(step.storeAttrName||'')}"/>
          </div>
          <div class="field" style="margin:0;flex:1;min-width:140px">
            <label style="font-size:11px">Save As (variable name)</label>
            <input class="fm-input se-setvar-name" style="font-size:12px;font-family:monospace"
                   placeholder="e.g. patientId" value="${escHtml(step.storeAs||'')}"
                   oninput="_setVarNameHint(this)" pattern="[A-Za-z0-9_]+" title="Letters, numbers and _ only"/>
          </div>
        </div>
        <div class="setvar-hint" style="font-size:11px;color:var(--neutral-500);margin-top:5px;display:${step.storeAs?'block':'none'}">
          Use <code>{{var.${escHtml(step.storeAs||'')}}}</code> in any later step's value field
        </div>
        <div class="se-setvar-js-wrap" style="${step.storeSource==='js'?'margin-top:6px':'display:none'}">
          <label style="font-size:11px">JavaScript Expression</label>
          <input class="fm-input se-step-val-static" style="font-size:12px;font-family:monospace" placeholder="e.g. document.title" value="${escHtml(step.storeSource==='js'?(step.value||''):'')}" />
        </div>
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
  // If restoring a variable step, pre-load variable options
  if (valMode === 'variable') {
    const varSel = row.querySelector('.se-step-var-select');
    if (varSel && step.value) varSel.dataset.savedVar = step.value;
    _loadVarOptions(row);
  }
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

  const isSetVar    = kwKey === 'SET VARIABLE';
  const isFileChooser = kwKey === 'FILE CHOOSER';

  // GOTO auto-config: hide locator + value, show auto badge
  row.querySelector('.se-step-locator').style.display  = (needsLoc && !isAuto && !isSetVar && !isFileChooser) ? '' : 'none';
  row.querySelector('.se-step-value').style.display    = (needsVal && !isAuto && !isFnCall && !isSetVar && !isFileChooser) ? '' : 'none';
  row.querySelector('.se-step-auto-badge').style.display = isAuto ? '' : 'none';

  // FILE CHOOSER: show custom upload widget, show locator for the trigger button
  const fileChooserWidget = row.querySelector('.se-filechooser-widget');
  if (fileChooserWidget) {
    fileChooserWidget.style.display = isFileChooser ? '' : 'none';
    if (isFileChooser) {
      row.querySelector('.se-step-locator').style.display = '';
      _fileChooserWidgetInit(row);
    }
  }

  // SET VARIABLE: show special fields, show locator only when source needs it
  const setVarFields = row.querySelector('.se-setvar-fields');
  if (setVarFields) {
    setVarFields.style.display = isSetVar ? '' : 'none';
    if (isSetVar) {
      const src = row.querySelector('.se-setvar-source')?.value || 'text';
      const needsLocSV = src !== 'js';
      row.querySelector('.se-step-locator').style.display = needsLocSV ? '' : 'none';
    }
  }

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
  row.querySelector('.se-step-val-var')?.style     && (row.querySelector('.se-step-val-var').style.display     = mode === 'variable'   ? '' : 'none');
  if (mode === 'commondata') _loadCdOptions(row);
  if (mode === 'variable')   _loadVarOptions(row);
}

// ── Variable tab helpers ───────────────────────────────────────────────────────

function _loadVarOptions(row) {
  const sel = row.querySelector('.se-step-var-select');
  if (!sel) return;
  // Collect all storeAs names from steps that come BEFORE this row
  const container = document.getElementById('se-steps-container');
  if (!container) return;
  const allRows  = [...container.querySelectorAll('.script-step-row')];
  const thisIdx  = allRows.indexOf(row);
  const vars = [];
  for (let i = 0; i < thisIdx; i++) {
    const badge = allRows[i].querySelector('.step-pin-badge');
    if (badge && badge.dataset.storeAs) vars.push(badge.dataset.storeAs);
    // Also from SET VARIABLE steps
    const kw = allRows[i].querySelector('.se-step-kw-select')?.value || '';
    if (kw === 'SET VARIABLE') {
      const n = allRows[i].querySelector('.se-setvar-name')?.value?.trim();
      if (n) vars.push(n);
    }
  }
  const savedVal = sel.dataset.savedVar || sel.value || '';
  const noHint   = row.querySelector('.var-no-vars-hint');
  const useHint  = row.querySelector('.var-usage-hint');
  if (!vars.length) {
    sel.innerHTML = '<option value="">— no variables yet —</option>';
    if (noHint) noHint.style.display = '';
    if (useHint) useHint.style.display = 'none';
    return;
  }
  if (noHint) noHint.style.display = 'none';
  sel.innerHTML = '<option value="">— pick a variable —</option>' +
    vars.map(v => `<option value="${escHtml(v)}"${v===savedVal?' selected':''}>${escHtml(v)}</option>`).join('');
  sel.dataset.savedVar = '';
  _varSelectChanged(sel);
}

function _varSelectChanged(sel) {
  const row   = sel.closest('.script-step-row');
  const hint  = row?.querySelector('.var-usage-hint');
  const token = row?.querySelector('.var-usage-token');
  const v     = sel.value;
  if (hint && token) {
    if (v) { token.textContent = `{{var.${v}}}`; hint.style.display = ''; }
    else   { hint.style.display = 'none'; }
  }
}

// ── 📌 Pin icon handlers ───────────────────────────────────────────────────────

function scriptStepPinOpen(btn) {
  const row    = btn.closest('.script-step-row');
  const badge  = row.querySelector('.step-pin-badge');
  const curName = badge?.dataset.storeAs || '';
  const name = window.prompt('Save this step\'s value as a variable.\n\nEnter a variable name (letters, numbers, _ only):\ne.g. patientId, orderId, searchTerm', curName);
  if (name === null) return; // cancelled
  const clean = name.trim().replace(/[^A-Za-z0-9_]/g, '');
  if (!clean) {
    // Treat empty as "clear pin"
    scriptStepPinClear(btn);
    return;
  }
  // Save into badge dataset
  if (badge) {
    badge.dataset.storeAs = clean;
    badge.querySelector('.pin-badge-label').innerHTML = `📌 Saved as <code>{{var.${escHtml(clean)}}}</code>`;
    badge.classList.remove('step-pin-badge-hidden');
  }
  btn.classList.add('step-pin-active');
}

function scriptStepPinClear(btn) {
  const row   = btn.closest('.script-step-row');
  const badge = row.querySelector('.step-pin-badge');
  if (badge) {
    badge.dataset.storeAs = '';
    badge.classList.add('step-pin-badge-hidden');
  }
  row.querySelector('.step-pin-icon')?.classList.remove('step-pin-active');
}

// SET VARIABLE source change
function _setVarSourceChanged(sel) {
  const row = sel.closest('.script-step-row');
  const isAttr = sel.value === 'attr';
  const isJs   = sel.value === 'js';
  const attrW  = row.querySelector('.se-setvar-attr-wrap');
  const jsW    = row.querySelector('.se-setvar-js-wrap');
  const locDiv = row.querySelector('.se-step-locator');
  if (attrW) attrW.style.display = isAttr ? '' : 'none';
  if (jsW)   jsW.style.display   = isJs   ? '' : 'none';
  if (locDiv) locDiv.style.display = isJs ? 'none' : '';
}

function _setVarNameHint(inp) {
  const row  = inp.closest('.script-step-row');
  const hint = row?.querySelector('.setvar-hint');
  const code = hint?.querySelector('code');
  if (!hint || !code) return;
  const v = inp.value.trim();
  if (v) { code.textContent = `{{var.${v}}}`; hint.style.display = 'block'; }
  else   { hint.style.display = 'none'; }
}

// ── FILE CHOOSER widget ───────────────────────────────────────────────────────

function _fileChooserWidgetInit(row) {
  // Nothing to init — widget renders from step data at scriptAddStep time
}

async function scriptStepFileChooserUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!currentProjectId) { alert('Select a project first'); return; }

  const widget    = input.closest('.se-filechooser-widget');
  const row       = input.closest('.script-step-row');
  const uploadArea = widget.querySelector('.fc-upload-area');
  const fileInfo  = widget.querySelector('.fc-file-info');
  const uploading = widget.querySelector('.fc-uploading');

  // Delete previous file from server if replacing
  const prevPath = fileInfo?.dataset.serverPath;
  if (prevPath) {
    const parts = prevPath.split('/');
    if (parts.length >= 3) {
      await fetch(`/api/test-files/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`, { method: 'DELETE' }).catch(() => {});
    }
  }

  // Show uploading state
  if (uploadArea) uploadArea.style.display = 'none';
  if (fileInfo)   fileInfo.style.display   = 'none';
  if (uploading)  uploading.style.display  = '';

  try {
    const fd = new FormData();
    fd.append('file', file);
    const res  = await fetch(`/api/test-files/upload?projectId=${encodeURIComponent(currentProjectId)}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    // Update widget to show file info
    if (fileInfo) {
      fileInfo.dataset.serverPath = data.serverPath;
      fileInfo.querySelector('.fc-filename').textContent  = data.filename;
      fileInfo.querySelector('.fc-server-path').textContent = data.serverPath;
      fileInfo.style.display = '';
    }
    if (uploading) uploading.style.display = 'none';
    // Clear input so same file can be re-selected if needed
    input.value = '';
  } catch (err) {
    if (uploading) uploading.style.display = 'none';
    if (uploadArea) uploadArea.style.display = '';
    alert('Upload failed: ' + err.message);
  }
}

function scriptStepFileChooserReplace(btn) {
  // Trigger the hidden file input inside the replace button
  btn.querySelector('.fc-file-input')?.click();
}

async function scriptStepFileChooserRemove(btn) {
  if (!confirm('Remove this file from the server?')) return;
  const widget    = btn.closest('.se-filechooser-widget');
  const fileInfo  = widget.querySelector('.fc-file-info');
  const uploadArea = widget.querySelector('.fc-upload-area');
  const prevPath  = fileInfo?.dataset.serverPath;

  if (prevPath) {
    const parts = prevPath.split('/');
    if (parts.length >= 3) {
      await fetch(`/api/test-files/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  if (fileInfo)  { fileInfo.dataset.serverPath = ''; fileInfo.style.display = 'none'; }
  if (uploadArea) uploadArea.style.display = '';
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

function scriptStepInsertBelow(btn) {
  const row = btn.closest('.script-step-row');
  // nextSibling = insert after this row; null = append at end (last step)
  scriptAddStep({}, row.nextSibling);
}

function scriptStepClone(btn) {
  const row = btn.closest('.script-step-row');
  const activeTab = row.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
  const kw        = row.querySelector('.se-step-kw-select')?.value || '';
  const isFnCall  = kw === 'CALL FUNCTION';
  let valueMode, value, fnStepValues;
  if (isFnCall) {
    valueMode    = 'static';
    value        = row.querySelector('.se-step-fn-select')?.value || null;
    fnStepValues = [...(row.querySelectorAll('.fn-child-row') || [])]
      .filter(cr => cr.querySelector('.fn-cs-value'))
      .map(cr => {
        const fi       = parseInt(cr.dataset.fnStepIdx);
        const activeCs = cr.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
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
  } else if (activeTab === '📌 Variable') {
    valueMode = 'variable';
    value     = row.querySelector('.se-step-var-select')?.value || null;
  } else if (activeTab === 'Dynamic') {
    valueMode = 'dynamic';
    value     = row.querySelector('.se-step-val-dynamic')?.value || null;
  } else if (activeTab === 'Common Data') {
    valueMode = 'commondata';
    const cdName = row.querySelector('.se-step-cd-select')?.value || '';
    value = cdName ? `\${${cdName}}` : null;
  } else if (activeTab === 'Test Data (Static)') {
    valueMode = 'testdata';
    value     = null;
  } else {
    valueMode = 'static';
    value     = row.querySelector('.se-step-val-static')?.value?.trim() || null;
  }
  const testData = [...(row.querySelectorAll('.td-row') || [])].map(tr => ({
    value: tr.querySelector('.td-val')?.value?.trim() || '',
  })).filter(r => r.value);

  const badge = row.querySelector('.step-pin-badge');
  const clonedStep = {
    id:            `clone-${Date.now()}`,
    keyword:       kw,
    locatorName:   row.querySelector('.se-step-loc-name')?.value?.trim() || null,
    locatorType:   row.querySelector('.se-step-loc-type')?.value || 'css',
    locator:       row.querySelector('.se-step-selector')?.value?.trim() || null,
    locatorId:     row.dataset.locatorId || null,
    valueMode,
    value,
    testData,
    fnStepValues:  fnStepValues || [],
    description:   row.querySelector('.se-step-desc')?.value?.trim() || '',
    screenshot:    row.querySelector('.se-step-screenshot')?.checked || false,
    storeAs:       badge?.dataset.storeAs || undefined,
    storeScope:    badge?.dataset.storeAs ? 'session' : undefined,
    storeSource:   row.querySelector('.se-setvar-source')?.value || undefined,
    storeAttrName: row.querySelector('.se-setvar-attr')?.value?.trim() || undefined,
  };
  scriptAddStep(clonedStep, row.nextSibling);
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
    const isFnCall     = kw === 'CALL FUNCTION';
    const isFileChooser = kw === 'FILE CHOOSER';
    let valueMode, value, fnStepValues;
    if (isFileChooser) {
      valueMode = 'static';
      value = row.querySelector('.fc-file-info')?.dataset.serverPath || null;
    } else if (isFnCall) {
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
    } else if (activeTab === '📌 Variable') {
      valueMode = 'variable';
      value     = row.querySelector('.se-step-var-select')?.value || null;
    } else if (activeTab === 'Dynamic') {
      valueMode = 'dynamic';
      value     = row.querySelector('.se-step-val-dynamic')?.value || null;
    } else if (activeTab === 'Common Data') {
      valueMode = 'commondata';
      const cdName = row.querySelector('.se-step-cd-select')?.value || '';
      value = cdName ? `\${${cdName}}` : null;
    } else if (activeTab === 'Test Data (Static)') {
      valueMode = 'testdata';
      value     = null;
    } else {
      valueMode = 'static';
      value     = row.querySelector('.se-step-val-static')?.value?.trim() || null;
    }

    // SET VARIABLE — override value with JS expression if source=js
    const isSetVar = kw === 'SET VARIABLE';
    const storeSource = isSetVar ? (row.querySelector('.se-setvar-source')?.value || 'text') : undefined;
    if (isSetVar && storeSource === 'js') {
      value = row.querySelector('.se-setvar-js-wrap .se-step-val-static')?.value?.trim() || null;
    }

    // Collect testData rows
    const testData = [...(row.querySelectorAll('.td-row') || [])].map(tr => ({
      value: tr.querySelector('.td-val')?.value?.trim() || '',
    })).filter(r => r.value);

    // 📌 Pin fields
    const badge       = row.querySelector('.step-pin-badge');
    const storeAs     = badge?.dataset.storeAs || undefined;
    const storeAttr   = isSetVar ? (row.querySelector('.se-setvar-attr')?.value?.trim() || undefined) : undefined;
    const storeVarName = isSetVar ? (row.querySelector('.se-setvar-name')?.value?.trim() || undefined) : storeAs;

    return {
      id:            row.dataset.stepId || `step-${i + 1}`,
      order:         i + 1,
      keyword:       kw,
      locatorName:   row.querySelector('.se-step-loc-name')?.value?.trim() || null,
      locatorType:   row.querySelector('.se-step-loc-type')?.value || 'css',
      locator:       row.querySelector('.se-step-selector')?.value?.trim() || null,
      locatorId:     null,
      valueMode,
      value,
      testData,
      fnStepValues:  fnStepValues || [],
      description:   row.querySelector('.se-step-desc')?.value?.trim() || '',
      screenshot:    row.querySelector('.se-step-screenshot')?.checked || false,
      storeAs:       isSetVar ? storeVarName : (storeAs || undefined),
      storeScope:    (isSetVar || storeAs) ? 'session' : undefined,
      storeSource:   isSetVar ? storeSource : undefined,
      storeAttrName: storeAttr || undefined,
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
  if (!id) { document.getElementById('sm-name').value = ''; document.getElementById('sm-desc').value = ''; document.getElementById('sm-retries').value = '0'; }
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
  document.getElementById('sm-retries').value = String(s.retries ?? 0);
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
  const retries = parseInt(document.getElementById('sm-retries')?.value || '0', 10);
  const body = {
    projectId: currentProjectId, name,
    description:   document.getElementById('sm-desc').value.trim(),
    scriptIds,
    environmentId: environmentId || null,
    retries:       [0,1,2].includes(retries) ? retries : 0,
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
      <div><strong>Modified by:</strong> ${escHtml(data.modifiedBy || '—')} &middot; ${formatDate(data.modifiedAt)}</div>
      <div><strong>Auto-Retry:</strong> ${data.retries ? `${data.retries}x on failure` : 'Disabled'}</div>`;
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

  // Populate schedule env selector + load schedules
  const schedEnvSel = document.getElementById('sched-env');
  if (schedEnvSel && project) {
    const envs = project.environments || [];
    schedEnvSel.innerHTML = '<option value="">— Select —</option>' +
      envs.map(e => `<option value="${escHtml(e.id)}"${e.id === data.environmentId ? ' selected' : ''}>${escHtml(e.name)}</option>`).join('');
  }
  schedFormHide();
  await schedLoad();
}

// ══════════════════════════════════════════════════════════════════════════════
// Scheduled Runs
// ══════════════════════════════════════════════════════════════════════════════

const CRON_PRESETS = {
  '0 9 * * *':     'Daily at 9am',
  '0 0 * * *':     'Nightly at midnight',
  '0 9 * * 1-5':   'Weekdays at 9am',
  '0 */4 * * *':   'Every 4 hours',
  '0 * * * *':     'Every hour',
};

function schedPresetLabel(expr) {
  return CRON_PRESETS[expr] || expr;
}

function schedPresetChange() {
  const preset = document.getElementById('sched-preset')?.value;
  const wrap   = document.getElementById('sched-custom-wrap');
  if (wrap) wrap.style.display = preset === 'custom' ? '' : 'none';
}

function schedFormHide() {
  const f = document.getElementById('sched-form');
  if (f) f.style.display = 'none';
  const editId = document.getElementById('sched-edit-id');
  if (editId) editId.value = '';
}

function schedAddShow() {
  const f = document.getElementById('sched-form');
  if (!f) return;
  document.getElementById('sched-edit-id').value = '';
  document.getElementById('sched-label').value = '';
  document.getElementById('sched-preset').value = '0 9 * * *';
  document.getElementById('sched-custom-wrap').style.display = 'none';
  f.style.display = '';
}

async function schedLoad() {
  if (!currentSuiteId) return;
  const res = await fetch(`/api/schedules?suiteId=${currentSuiteId}`);
  if (!res.ok) return;
  const schedules = await res.json();
  const el = document.getElementById('sched-list');
  if (!el) return;

  if (schedules.length === 0) {
    el.innerHTML = '<div style="color:var(--neutral-400);font-size:13px;padding:8px 0">No schedules configured. Add one to run this suite automatically.</div>';
    return;
  }

  el.innerHTML = `
    <table class="sched-table">
      <thead><tr><th>Label</th><th>Frequency</th><th>Last Run</th><th>Enabled</th><th></th></tr></thead>
      <tbody>
        ${schedules.map(s => `
          <tr>
            <td style="font-weight:600">${escHtml(s.label)}</td>
            <td><code class="sched-cron">${escHtml(s.cronExpression)}</code><span class="sched-preset-lbl">${escHtml(schedPresetLabel(s.cronExpression))}</span></td>
            <td style="font-size:12px;color:var(--neutral-400)">${s.lastRunAt ? formatDate(s.lastRunAt) : '—'}</td>
            <td>
              <label class="sched-toggle">
                <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="schedToggle('${escHtml(s.id)}', this.checked)" />
                <span class="sched-toggle-track"></span>
              </label>
            </td>
            <td style="text-align:right">
              <button class="tbl-btn" onclick="schedDelete('${escHtml(s.id)}')">Delete</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function schedSave() {
  if (!currentSuiteId) return;
  const label   = document.getElementById('sched-label')?.value.trim();
  const envId   = document.getElementById('sched-env')?.value;
  const preset  = document.getElementById('sched-preset')?.value;
  const cronVal = preset === 'custom' ? document.getElementById('sched-cron')?.value.trim() : preset;
  const editId  = document.getElementById('sched-edit-id')?.value;

  if (!label)  { alert('Please enter a label.'); return; }
  if (!envId)  { alert('Please select an environment.'); return; }
  if (!cronVal){ alert('Please enter or select a cron expression.'); return; }

  const body = { suiteId: currentSuiteId, environmentId: envId, cronExpression: cronVal, label };

  const res = editId
    ? await fetch(`/api/schedules/${editId}`, { method: 'PUT',  headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) })
    : await fetch('/api/schedules',            { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });

  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to save schedule'); return; }

  schedFormHide();
  await schedLoad();
}

async function schedToggle(id, enabled) {
  await fetch(`/api/schedules/${id}`, {
    method: 'PUT', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ enabled }),
  });
  await schedLoad();
}

async function schedDelete(id) {
  if (!confirm('Delete this schedule?')) return;
  await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
  await schedLoad();
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

  const { runId, queued, queuePosition } = data;
  if (logEl) logEl.innerHTML = '';

  if (queued) {
    runBtn.textContent = '⏳ Queued…';
    if (statusEl) statusEl.textContent = `⏳ Queued — position ${queuePosition} (waiting for a free slot)`;
    if (logEl) logEl.innerHTML = `<div style="color:#dcdcaa">Run queued — will start automatically when a slot is available (position ${queuePosition}).</div>`;
  } else {
    if (statusEl) statusEl.textContent = '⏳ Running…';
  }

  // Use HTTP polling — works through any proxy without WS upgrade support
  let seenLines = 0;
  let pollTimer = null;
  let stopped   = false;

  async function poll() {
    if (stopped) return;
    try {
      const r = await fetch(`/api/run/${runId}`);
      if (!r.ok) {
        pollTimer = setTimeout(poll, 1500);
        return;
      }
      const rec = await r.json();

      // Show queued status while waiting
      if (rec.status === 'queued') {
        if (statusEl) statusEl.textContent = `⏳ Queued — waiting for a free slot…`;
        pollTimer = setTimeout(poll, 1500);
        return;
      }

      // Transitioned from queued → running: clear the queue message
      if (rec.status === 'running' && logEl && logEl.querySelector('[data-queued]')) {
        logEl.innerHTML = '';
        seenLines = 0;
      }
      if (rec.status === 'running') {
        runBtn.textContent = '⏳ Running…';
        if (statusEl) statusEl.textContent = '⏳ Running…';
      }

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
      if (rlEl && anchorEl) { anchorEl.href = `/execution-report?runId=${encodeURIComponent(runId)}`; rlEl.style.display = ''; }

    } catch (err) {
      // Network error — keep retrying
      pollTimer = setTimeout(poll, 2000);
    }
  }

  poll();
}

// ══════════════════════════════════════════════════════════════════════════════
// Flaky Test Detection
// ══════════════════════════════════════════════════════════════════════════════

async function flakyLoad() {
  if (!currentProjectId) {
    document.getElementById('flaky-loading').style.display = '';
    document.getElementById('flaky-loading').textContent = 'Select a project to analyse flaky tests.';
    document.getElementById('flaky-summary').style.display = 'none';
    document.getElementById('flaky-table-wrap').style.display = 'none';
    document.getElementById('flaky-empty').style.display = 'none';
    return;
  }

  // Populate suite filter from loaded suites
  const suiteSel = document.getElementById('flaky-suite-filter');
  if (suiteSel) {
    const proj = allSuites.filter(s => s.projectId === currentProjectId);
    suiteSel.innerHTML = '<option value="">All Suites</option>' +
      proj.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
  }

  const limit   = document.getElementById('flaky-limit')?.value || '50';
  const suiteId = document.getElementById('flaky-suite-filter')?.value || '';
  const loadEl  = document.getElementById('flaky-loading');
  const tableEl = document.getElementById('flaky-table-wrap');
  const emptyEl = document.getElementById('flaky-empty');
  const summaryEl = document.getElementById('flaky-summary');

  loadEl.style.display = '';
  loadEl.textContent = 'Analysing runs…';
  tableEl.style.display = 'none';
  emptyEl.style.display = 'none';
  summaryEl.style.display = 'none';

  let url = `/api/flaky?projectId=${encodeURIComponent(currentProjectId)}&limit=${limit}`;
  if (suiteId) url += `&suiteId=${encodeURIComponent(suiteId)}`;

  const res = await fetch(url);
  if (!res.ok) { loadEl.textContent = 'Failed to load flaky data.'; return; }
  const { runs, tests } = await res.json();

  loadEl.style.display = 'none';

  if (tests.length === 0) {
    document.getElementById('flaky-empty-runs').textContent = runs;
    emptyEl.style.display = '';
    summaryEl.style.display = 'none';
    tableEl.style.display = 'none';
    return;
  }

  // Summary cards
  const high   = tests.filter(t => t.risk === 'high').length;
  const medium = tests.filter(t => t.risk === 'medium').length;
  const low    = tests.filter(t => t.risk === 'low').length;
  summaryEl.style.display = 'flex';
  summaryEl.innerHTML = `
    <div class="flaky-card flaky-card-total">
      <div class="flaky-card-val">${tests.length}</div>
      <div class="flaky-card-lbl">Flaky Tests</div>
    </div>
    <div class="flaky-card flaky-card-runs">
      <div class="flaky-card-val">${runs}</div>
      <div class="flaky-card-lbl">Runs Analysed</div>
    </div>
    <div class="flaky-card flaky-card-high">
      <div class="flaky-card-val">${high}</div>
      <div class="flaky-card-lbl">High Risk (&gt;50%)</div>
    </div>
    <div class="flaky-card flaky-card-medium">
      <div class="flaky-card-val">${medium}</div>
      <div class="flaky-card-lbl">Medium Risk (20–50%)</div>
    </div>
    <div class="flaky-card flaky-card-low">
      <div class="flaky-card-val">${low}</div>
      <div class="flaky-card-lbl">Low Risk (&lt;20%)</div>
    </div>`;

  // Table rows
  const tbody = document.getElementById('flaky-tbody');
  tbody.innerHTML = tests.map(t => {
    const bar = `<div class="flaky-bar-wrap"><div class="flaky-bar flaky-bar-${t.risk}" style="width:${t.failRate}%"></div></div>`;
    const badge = `<span class="flaky-risk flaky-risk-${t.risk}">${t.risk.charAt(0).toUpperCase() + t.risk.slice(1)}</span>`;
    const dur = t.avgMs < 1000 ? `${t.avgMs}ms` : `${(t.avgMs/1000).toFixed(1)}s`;
    return `<tr>
      <td style="font-weight:600;max-width:260px;word-break:break-word">${escHtml(t.name)}</td>
      <td style="font-size:12px;color:var(--neutral-400)">${escHtml(t.suiteName)}</td>
      <td style="text-align:center;color:#4ec9b0;font-weight:700">${t.passes}</td>
      <td style="text-align:center;color:#f48771;font-weight:700">${t.failures}</td>
      <td style="text-align:center;color:var(--neutral-400)">${t.total}</td>
      <td style="min-width:120px">${bar}<span style="font-size:11.5px;color:var(--neutral-300)">${t.failRate}%</span></td>
      <td style="text-align:center">${badge}</td>
      <td style="font-size:12px;color:var(--neutral-400)">${dur}</td>
      <td style="font-size:12px;color:var(--neutral-400)">${_histFmtDate(t.lastSeen)}</td>
    </tr>`;
  }).join('');

  tableEl.style.display = '';
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
    queued:  '<span class="hist-badge hist-badge-queued">&#9203; Queued</span>',
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

// ── Debugger ──────────────────────────────────────────────────────────────────
// Uses HTTP polling — no WebSocket dependency (works through any proxy/IIS).
// Polling interval: 800ms while session is active.

let _debugScriptId      = null;
let _debugSessionId     = null;
let _debugTotalSteps    = 0;
let _debugStepMeta      = [];
let _debugPollTimer     = null;
let _debugHeartbeatTimer = null;  // heartbeat polling interval
let _debugLastStepIdx   = null;  // track which step we last displayed to avoid re-rendering same step
let _debugSseSource     = null;  // SSE EventSource (primary push channel)

// Step state per order: 'pending' | 'active' | 'done' | 'skipped' | 'error'
const _debugStepState = {};

// Called when user clicks "Debug" button on a script row
function debugOpen(scriptId) {
  _debugScriptId = scriptId;

  const select = document.getElementById('debug-env-select');
  if (!select) return;
  select.innerHTML = '<option value="">— Select Environment —</option>';
  const proj = _currentProjectData();
  if (proj && proj.environments) {
    proj.environments.forEach(env => {
      const opt = document.createElement('option');
      opt.value = env.id;
      opt.textContent = env.name;
      select.appendChild(opt);
    });
    if (proj.environments.length === 1) select.value = proj.environments[0].id;
  }

  document.getElementById('debug-env-modal').style.display = 'flex';
}

function debugEnvModalClose() {
  document.getElementById('debug-env-modal').style.display = 'none';
}

// Called when user clicks "Start Debug" in the env modal
async function debugStart() {
  const envId = document.getElementById('debug-env-select')?.value || '';
  debugEnvModalClose();
  if (!_debugScriptId) return;

  // Load script to build left-panel step list
  const scriptRes = await fetch(`/api/scripts/${_debugScriptId}`);
  if (!scriptRes.ok) { alert('Could not load script'); return; }
  const script = await scriptRes.json();

  _debugStepMeta   = (script.steps || []).slice().sort((a, b) => a.order - b.order);
  _debugTotalSteps = _debugStepMeta.length;
  _debugLastStepIdx = null;

  Object.keys(_debugStepState).forEach(k => delete _debugStepState[k]);
  _debugStepMeta.forEach(s => { _debugStepState[s.order] = 'pending'; });

  // Hide error panel from any previous session
  const errPanel = document.getElementById('dbg-error-panel');
  if (errPanel) errPanel.style.display = 'none';

  // Show overlay
  document.getElementById('debug-overlay').style.display = 'flex';
  document.getElementById('debug-overlay-title').textContent = `Debugger — ${script.title}`;
  _debugSetStatus('starting');
  _debugSetProgress('Starting…');

  const proj = _currentProjectData();
  const env  = (proj?.environments || []).find(e => e.id === envId);
  document.getElementById('debug-env-label').textContent = env ? `Env: ${env.name}` : '';

  _debugRenderSteps();
  _debugSetControls(false);

  // Start the debug session on the server
  const res = await fetch('/api/debug/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scriptId: _debugScriptId, environmentId: envId })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(`Failed to start debugger: ${err.error || res.statusText}`);
    debugClose();
    return;
  }

  const { sessionId, totalSteps } = await res.json();
  _debugSessionId  = sessionId;
  _debugTotalSteps = totalSteps;
  _debugSetStatus('starting');

  // ── SSE connection — primary fast path ──────────────────────────────────────
  // SSE works through ALL HTTP proxies (no WS upgrade needed).
  // Server pushes step data + inline base64 screenshot the moment it's ready.
  _debugOpenSse(sessionId);

  // WS subscribe — secondary (works when WS upgrade is not blocked by proxy)
  if (typeof wsSubscribe === 'function') wsSubscribe(sessionId);

  // HTTP polling — final fallback (always active, catches anything SSE/WS miss)
  _debugStartPolling();

  // Orphan cleanup (1/3): Beforeunload beacon — sends stop even on hard refresh/tab close
  window.addEventListener('beforeunload', () => {
    if (_debugSessionId) {
      navigator.sendBeacon('/api/debug/stop', JSON.stringify({ sessionId: _debugSessionId, action: 'stop' }));
      console.log(`[debugger] beforeunload: sent stop beacon for session ${_debugSessionId.slice(0,8)}`);
    }
  });

  // Orphan cleanup (3/3): Start heartbeat polling — every 10s to prevent orphan timeout
  _debugStartHeartbeat();
}

// ── SSE (Server-Sent Events) — primary push channel ──────────────────────────
// Opens a persistent HTTP stream to /api/debug/stream/:sessionId.
// Server pushes debug:step events with inline base64 screenshot instantly.
// Works through all HTTP proxies — no WebSocket upgrade needed.

function _debugOpenSse(sessionId) {
  _debugCloseSse(); // close any existing stream
  try {
    const src = new EventSource(`/api/debug/stream/${sessionId}`, { withCredentials: true });

    src.addEventListener('debug:step', (e) => {
      try {
        const msg = JSON.parse(e.data);
        console.log(`[debugger:sse] debug:step stepIdx=${msg.stepIdx} base64=${msg.screenshotBase64 ? 'yes' : 'no'}`);
        _debugOnStep(msg); // has screenshotBase64 inline — skips HTTP fetch
      } catch (err) {
        console.warn('[debugger:sse] Failed to parse debug:step event', err);
      }
    });

    src.addEventListener('debug:error', (e) => {
      try {
        const msg = JSON.parse(e.data);
        console.log(`[debugger:sse] debug:error stepIdx=${msg.stepIdx} type=${msg.errorType}`);
        _debugOnError(msg);
      } catch (err) {
        console.warn('[debugger:sse] Failed to parse debug:error event', err);
      }
    });

    src.addEventListener('debug:done', (e) => {
      try {
        const msg = JSON.parse(e.data);
        console.log(`[debugger:sse] debug:done status=${msg.status}`);
        _debugStopPolling();
        _debugStopHeartbeat();
        _debugSetStatus(msg.status || 'done');
        _debugCloseSse();
      } catch {}
    });

    src.onerror = () => {
      // SSE connection dropped — HTTP polling fallback already active
      console.warn('[debugger:sse] SSE connection error — falling back to HTTP poll');
    };

    _debugSseSource = src;
    console.log(`[debugger:sse] SSE stream opened for session ${sessionId.slice(0, 8)}`);
  } catch (err) {
    console.warn('[debugger:sse] Failed to open SSE stream:', err);
  }
}

function _debugCloseSse() {
  if (_debugSseSource) {
    _debugSseSource.close();
    _debugSseSource = null;
    console.log('[debugger:sse] SSE stream closed');
  }
}

// ── HTTP polling ─────────────────────────────────────────────────────────────

function _debugStartPolling() {
  _debugStopPolling();
  _debugPollTimer = setInterval(_debugPoll, 800);
}

function _debugStopPolling() {
  if (_debugPollTimer) { clearInterval(_debugPollTimer); _debugPollTimer = null; }
}

// ── Heartbeat polling (orphan cleanup) ────────────────────────────────────────

function _debugStartHeartbeat() {
  _debugStopHeartbeat();
  _debugHeartbeatTimer = setInterval(_debugSendHeartbeat, 10000); // Every 10 seconds

  // visibilitychange: fire immediate heartbeat when user returns to tab
  // Browsers throttle setInterval in background tabs — this ensures server
  // always gets a fresh signal the moment the user is back
  document.addEventListener('visibilitychange', _debugOnVisibilityChange);

  console.log(`[debugger] Heartbeat polling started for session ${_debugSessionId?.slice(0,8)}`);
}

function _debugStopHeartbeat() {
  if (_debugHeartbeatTimer) { clearInterval(_debugHeartbeatTimer); _debugHeartbeatTimer = null; }
  document.removeEventListener('visibilitychange', _debugOnVisibilityChange);
}

function _debugOnVisibilityChange() {
  if (document.visibilityState === 'visible' && _debugSessionId) {
    console.log(`[debugger] Tab became visible — sending immediate heartbeat`);
    _debugSendHeartbeat();
  }
}

async function _debugSendHeartbeat() {
  if (!_debugSessionId) { _debugStopHeartbeat(); return; }
  try {
    const r = await fetch(`/api/debug/heartbeat/${_debugSessionId}`, { method: 'POST', credentials: 'include' });
    // Never stop on failure — network blip or slow server should not kill the heartbeat
    // Only stop if session is explicitly gone (404 means session cleaned up server-side)
    if (r.status === 404) {
      console.log(`[debugger] Heartbeat 404 — session no longer exists, stopping heartbeat`);
      _debugStopHeartbeat();
    } else if (!r.ok) {
      console.log(`[debugger] Heartbeat ${r.status} — will retry next interval`);
      // Do NOT stop — retry on next interval
    }
  } catch (e) {
    console.log(`[debugger] Heartbeat network error: ${e.message} — will retry next interval`);
    // Do NOT stop — network blip, retry next interval
  }
}

// ── HTTP polling ──────────────────────────────────────────────────────────────

async function _debugPoll() {
  if (!_debugSessionId) { _debugStopPolling(); return; }

  let session;
  try {
    const r = await fetch(`/api/debug/session/${_debugSessionId}`);
    if (r.status === 401) {
      // Session expired — user logged out or session timed out
      // Send stop to clean up server-side process, then close overlay
      console.log(`[debugger] Poll got 401 — session expired, sending stop and closing`);
      const sid = _debugSessionId;
      navigator.sendBeacon('/api/debug/stop', JSON.stringify({ sessionId: sid, action: 'stop' }));
      _debugStopPolling();
      _debugStopHeartbeat();
      _debugSessionId = null;
      debugClose();
      return;
    }
    if (!r.ok) { _debugStopPolling(); return; }
    session = await r.json();
  } catch { return; }

  const { status, pendingStep } = session;

  // Terminal states — stop polling
  if (status === 'done' || status === 'stopped' || status === 'error') {
    _debugStopPolling();
    _debugOnDone({ status });
    return;
  }

  // A step is paused and waiting — show it if it changed
  if (pendingStep && pendingStep.stepIdx !== _debugLastStepIdx) {
    _debugLastStepIdx = pendingStep.stepIdx;
    _debugOnStep(pendingStep);
  }
}

// Called when session has a new paused step (from poll or WS — screenshotBase64 skips HTTP fetch)
function _debugOnStep({ stepIdx, keyword, locator, value, screenshotPath, screenshotBase64 }) {
  console.log(`[debugger:step] Received step data: stepIdx=${stepIdx}, keyword=${keyword}, screenshotPath=${screenshotPath}`);

  // Mark previous active step as done
  _debugStepMeta.forEach(s => {
    if (_debugStepState[s.order] === 'active') _debugStepState[s.order] = 'done';
  });

  _debugStepState[stepIdx] = 'active';
  _debugRenderSteps();
  _debugScrollToStep(stepIdx);

  document.getElementById('dbg-kw').textContent  = keyword || '—';
  document.getElementById('dbg-loc').textContent = locator || '—';
  document.getElementById('dbg-val').textContent = value   || '—';

  const idx = _debugStepMeta.findIndex(s => s.order === stepIdx);
  _debugSetProgress(`Step ${idx + 1} of ${_debugTotalSteps}`);
  _debugSetStatus('paused');

  // Keep controls disabled until screenshot loads
  _debugSetControls(false);

  // Load screenshot — prefer base64 from WS (zero HTTP round trip), fall back to HTTP fetch
  console.log(`[debugger:step] Calling _debugSetScreenshot with path: ${screenshotPath} base64=${screenshotBase64 ? 'yes' : 'no'}`);
  _debugSetScreenshot(screenshotPath, () => {
    console.log(`[debugger:step] Screenshot loaded, enabling controls`);
    _debugSetControls(true);
  }, screenshotBase64 || null);
}

// Called when session is terminal
function _debugOnDone({ status }) {
  _debugStepMeta.forEach(s => {
    if (_debugStepState[s.order] === 'active') {
      _debugStepState[s.order] = status === 'stopped' ? 'skipped' : 'done';
    }
  });
  _debugRenderSteps();
  _debugSetStatus(status);
  _debugSetProgress(status === 'stopped' ? 'Stopped by user' : status === 'error' ? 'Finished with errors' : 'Completed ✓');
  _debugSetControls(false);
  document.getElementById('dbg-btn-stop').disabled = true;
}

// Called when a step throws — shows error panel + inline edit, marks step red
function _debugOnError({ stepIdx, keyword, locator, errorMessage, errorType }) {
  // Mark the failed step red in the step list
  _debugStepState[stepIdx] = 'failed';
  _debugRenderSteps();
  _debugScrollToStep(stepIdx);

  // Update header info to show the failed step
  document.getElementById('dbg-kw').textContent  = keyword  || '—';
  document.getElementById('dbg-loc').textContent = locator  || '—';
  document.getElementById('dbg-val').textContent = '—';

  // Find step number + meta for display
  const idx     = _debugStepMeta.findIndex(s => s.order === stepIdx || s.order === Math.floor(stepIdx));
  const stepNum = idx >= 0 ? idx + 1 : stepIdx;
  const stepMeta = idx >= 0 ? _debugStepMeta[idx] : null;

  _debugSetProgress(`Step ${stepNum} of ${_debugTotalSteps} — FAILED`);
  _debugSetStatus('error');

  // Show error panel
  const panel = document.getElementById('dbg-error-panel');
  const title = document.getElementById('dbg-error-title');
  const type  = document.getElementById('dbg-error-type');
  const msg   = document.getElementById('dbg-error-message');
  if (panel) panel.style.display = 'block';
  if (title) title.textContent = `Step ${stepNum} Failed — ${keyword || ''}`;
  if (type)  type.textContent  = errorType || 'Error';
  if (msg)   msg.textContent   = errorMessage || 'Unknown error';

  // ── Inline edit panel ────────────────────────────────────────────────────────
  // Remove any existing edit panel first
  const existingEdit = document.getElementById('dbg-inline-edit');
  if (existingEdit) existingEdit.remove();

  const LOCATOR_TYPES = ['css','xpath','id','name','text','testid','role','label','placeholder'];
  const currentLoc    = locator || (stepMeta?.locator || '');
  const currentLt     = stepMeta?.locatorType || 'css';
  const currentVal    = stepMeta?.value || '';

  const editPanel = document.createElement('div');
  editPanel.id = 'dbg-inline-edit';
  editPanel.style.cssText = 'margin-top:12px;background:#1e293b;border:1px solid #f59e0b;border-radius:8px;padding:14px 16px';
  editPanel.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:10px;letter-spacing:0.5px">✎ EDIT &amp; RETRY — correct the step without stopping the session</div>
    <div style="display:grid;grid-template-columns:130px 1fr;gap:8px;align-items:center;font-size:12px;color:#94a3b8">
      <label>Locator Type</label>
      <select id="dbg-edit-loctype" class="fm-input" style="font-size:12px;padding:3px 6px;background:#0f172a;color:#e2e8f0;border-color:#334155">
        ${LOCATOR_TYPES.map(t => `<option value="${t}" ${currentLt===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <label>Locator</label>
      <input id="dbg-edit-loc" class="fm-input" type="text" value="${escHtml(currentLoc)}"
        placeholder="Enter corrected locator…"
        style="font-family:monospace;font-size:12px;padding:3px 6px;background:#0f172a;color:#e2e8f0;border-color:#334155">
      <label>Value</label>
      <input id="dbg-edit-val" class="fm-input" type="text" value="${escHtml(currentVal)}"
        placeholder="Enter corrected value…"
        style="font-size:12px;padding:3px 6px;background:#0f172a;color:#e2e8f0;border-color:#334155">
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="_debugApplyRetry(${stepIdx}, ${stepNum})">▶ Apply &amp; Retry</button>
      <button class="btn btn-outline btn-sm" onclick="debugContinue('skip')">⏭ Skip Step</button>
      <button class="btn btn-outline btn-sm" style="color:#ef4444;border-color:#ef4444" onclick="debugContinue('stop')">■ Stop</button>
      <label style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;cursor:pointer">
        <input type="checkbox" id="dbg-edit-persist" checked style="cursor:pointer">
        Save changes to Script + Locator Repo
      </label>
    </div>`;

  if (panel) panel.appendChild(editPanel);

  // Disable Step + Skip buttons (handled by edit panel now)
  const btnStep = document.getElementById('dbg-btn-step');
  const btnSkip = document.getElementById('dbg-btn-skip');
  if (btnStep) btnStep.disabled = true;
  if (btnSkip) btnSkip.disabled = true;

  console.log(`[debugger:error] Step ${stepIdx} (${keyword}) failed: ${errorType}: ${(errorMessage||'').slice(0,120)}`);
}

// Apply edits and send retry to the spec
async function _debugApplyRetry(stepIdx, stepNum) {
  const locator     = document.getElementById('dbg-edit-loc')?.value?.trim();
  const locatorType = document.getElementById('dbg-edit-loctype')?.value;
  const value       = document.getElementById('dbg-edit-val')?.value;
  const persist     = document.getElementById('dbg-edit-persist')?.checked !== false;

  if (!locator) { alert('Locator cannot be empty'); return; }

  // Persist changes to script + locator repo
  if (persist && _debugSessionId) {
    try {
      await fetch('/api/debug/patch-step', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sessionId:   _debugSessionId,
          stepOrder:   Math.floor(stepIdx),
          locator,
          locatorType,
          value,
        }),
      });
    } catch (e) {
      console.warn('[debugger] patch-step failed:', e);
    }
  }

  // Remove the inline edit panel
  document.getElementById('dbg-inline-edit')?.remove();

  // Hide error panel
  const panel = document.getElementById('dbg-error-panel');
  if (panel) panel.style.display = 'none';

  _debugSetStatus('running');
  _debugSetProgress(`Retrying step ${stepNum} of ${_debugTotalSteps}…`);

  // Send retry action with patched values to the spec via gate.json
  await fetch('/api/debug/continue', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      sessionId:   _debugSessionId,
      action:      'retry',
      locator,
      locatorType,
      value,
    }),
  }).catch(() => {});
}

// Send continue / skip / stop to server
async function debugContinue(action) {
  if (!_debugSessionId) return;
  _debugSetControls(false);

  if (action === 'skip') {
    const activeStep = _debugStepMeta.find(s => _debugStepState[s.order] === 'active');
    if (activeStep) _debugStepState[activeStep.order] = 'skipped';
    _debugRenderSteps();
  }

  if (action === 'stop') {
    _debugSetStatus('stopped');
    _debugSetProgress('Stopped by user');
    _debugStopPolling();
    document.getElementById('dbg-btn-stop').disabled = true;
  } else {
    _debugSetStatus('running');
    // Keep _debugLastStepIdx as-is — poller will only re-render when a NEW stepIdx arrives
    // (resetting to null caused re-render of the current step while server was still transitioning)
  }

  await fetch('/api/debug/continue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: _debugSessionId, action })
  }).catch(() => {});
}

function debugClose() {
  _debugStopPolling();
  _debugStopHeartbeat();  // Stop heartbeat before stopping session
  if (_debugSessionId) {
    const sessionId = _debugSessionId;
    console.log(`[debugger] debugClose: Sending stop request for session ${sessionId.slice(0,8)}`);
    fetch('/api/debug/continue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, action: 'stop' })
    }).then(r => {
      console.log(`[debugger] debugClose: Stop request completed (${r.status})`);
    }).catch(e => {
      console.error(`[debugger] debugClose: Stop request failed: ${e.message}`);
    });
  }
  _debugCloseSse();
  if (_debugSessionId && typeof wsUnsubscribe === 'function') wsUnsubscribe(_debugSessionId);
  _debugSessionId   = null;
  _debugScriptId    = null;
  _debugLastStepIdx = null;
  document.getElementById('debug-overlay').style.display = 'none';

  const img = document.getElementById('debug-screenshot-img');
  if (img) { img.src = ''; img.style.display = 'none'; }
  const ph = document.getElementById('debug-screenshot-placeholder');
  if (ph) ph.style.display = 'flex';

  _debugSetControls(false);
  document.getElementById('dbg-btn-stop').disabled = false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _debugRenderSteps() {
  const el = document.getElementById('debug-steps-list');
  if (!el) return;
  el.innerHTML = _debugStepMeta.map(s => {
    const state = _debugStepState[s.order] || 'pending';
    const icons = { pending: '○', active: '●', done: '✓', skipped: '⏭', error: '✗', failed: '✗' };
    const icon  = icons[state] || '○';
    return `<div class="debug-step-row debug-step-${state}" data-order="${s.order}">
      <span class="debug-step-icon">${icon}</span>
      <div class="debug-step-info">
        <span class="debug-step-kw">${escHtml(s.keyword || '')}</span>
        ${s.description ? `<span class="debug-step-desc">${escHtml(s.description)}</span>` : ''}
      </div>
      <span class="debug-step-order">${s.order}</span>
    </div>`;
  }).join('');
}

function _debugScrollToStep(order) {
  const row = document.querySelector(`.debug-step-row[data-order="${order}"]`);
  if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function _debugSetStatus(status) {
  const el = document.getElementById('debug-status-badge');
  if (!el) return;
  const labels = { starting: 'Starting…', paused: 'Paused', running: 'Executing…', done: 'Done', stopped: 'Stopped', error: 'Error' };
  el.textContent  = labels[status] || status;
  el.className    = `debug-status-badge debug-status-${status}`;
}

function _debugSetProgress(label) {
  const el = document.getElementById('debug-progress-label');
  if (el) el.textContent = label;
}

function _debugSetControls(enabled) {
  document.getElementById('dbg-btn-step').disabled = !enabled;
  document.getElementById('dbg-btn-skip').disabled = !enabled;
}

// Load screenshot with retry logic + callback when ready
// Ensures Step button only enables after screenshot is actually visible
// ── Unified Screenshot Loader ─────────────────────────────────────────────────
// RULE: onReady() is called in EXACTLY ONE place — after double rAF confirms
//       the image is visually painted. Never called on error or missing elements.
//
// Flow:
//   1. Show spinner (or hide old screenshot)
//   2. Poll server every 200ms until file exists (120s max)
//   3. Set img.src → wait for onload
//   4. requestAnimationFrame × 2 → browser has actually painted
//   5. Show image → call onReady() → Step button enables
//
//   On any failure (timeout / decode error / missing elements) → show error,
//   keep button DISABLED. No exceptions.
async function _debugSetScreenshot(screenshotPath, onReady, screenshotBase64 = null) {
  const img     = document.getElementById('debug-screenshot-img');
  const ph      = document.getElementById('debug-screenshot-placeholder');
  const loading = document.getElementById('debug-screenshot-loading');
  const error   = document.getElementById('debug-screenshot-error');

  if (!img) {
    console.warn('[debugger] debug-screenshot-img element not found — button stays disabled');
    return;
  }
  if (!screenshotPath && !screenshotBase64) {
    console.warn('[debugger] No screenshotPath or base64 provided — button stays disabled');
    return;
  }

  // — Helper: update visible panel safely —
  const showPanel = (panel) => {
    [ph, loading, error].forEach(el => { if (el) el.style.display = 'none'; });
    img.style.display = 'none';
    if (panel === 'loading' && loading) loading.style.display = 'flex';
    if (panel === 'error'   && error)   error.style.display   = 'flex';
    if (panel === 'image')              img.style.display      = '';
  };

  showPanel('loading');

  // Fast path — base64 already in WS message, no HTTP round trip needed
  if (screenshotBase64) {
    console.log('[debugger] Using inline base64 screenshot — skipping HTTP fetch');
    const loadedOk = await new Promise((resolve) => {
      img.addEventListener('load',  () => resolve(true),  { once: true });
      img.addEventListener('error', () => resolve(false), { once: true });
      img.src = `data:image/jpeg;base64,${screenshotBase64}`;
    });
    if (!loadedOk) { showPanel('error'); return; }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    showPanel('image');
    console.log('[debugger] Screenshot visually painted (base64 path) — enabling Step button');
    onReady?.();
    return;
  }

  // Fallback path — HTTP fetch (used when WS base64 unavailable: reconnects, replays)
  const screenshotUrl = `/debug-screenshot/${screenshotPath}`;
  console.log(`[debugger] Loading screenshot via HTTP: ${screenshotUrl}`);

  // Poll server until file exists (200ms interval, 120s deadline)
  const deadline = Date.now() + 120000;
  let   fileReady = false;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(screenshotUrl, { credentials: 'include' });
      if (res.ok) { fileReady = true; break; }
    } catch (_) { /* network blip — keep polling */ }
    await new Promise(r => setTimeout(r, 200));
  }

  if (!fileReady) {
    console.warn('[debugger] File never appeared within 120s — showing error, button stays disabled');
    showPanel('error');
    return;
  }

  // Load image
  const loadedOk = await new Promise((resolve) => {
    img.addEventListener('load',  () => { console.log('[debugger] Image onload fired'); resolve(true);  }, { once: true });
    img.addEventListener('error', () => { console.warn('[debugger] Image decode error'); resolve(false); }, { once: true });
    img.src = `${screenshotUrl}?t=${Date.now()}`;
  });

  if (!loadedOk) {
    console.warn('[debugger] Image failed to decode — showing error, button stays disabled');
    showPanel('error');
    return; // onReady NOT called
  }

  // Step 4 — double rAF: guarantees browser has painted before we enable button
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Step 5 — show image, enable controls
  showPanel('image');
  console.log('[debugger] Screenshot visually painted — enabling Step button');
  onReady?.();  // ← THE ONLY PLACE onReady() is ever called
}

// WS handler — receives debug:step/done pushed by server (base64 screenshot inline)
// This is the PRIMARY fast path; HTTP polling is the fallback for missed WS messages.
function debugHandleWsMsg(msg) {
  if (!_debugSessionId) return;
  if (msg.type === 'debug:step' && msg.sessionId === _debugSessionId) {
    _debugOnStep(msg);  // msg includes screenshotBase64 — no HTTP fetch needed
  } else if (msg.type === 'debug:done' && msg.sessionId === _debugSessionId) {
    _debugStopPolling();
    _debugStopHeartbeat();
    _debugSetStatus(msg.status || 'done');
  }
}

// ── Helper to get current project data ──────────────────────────────────────

function _currentProjectData() {
  return allProjects.find(p => p.id === currentProjectId) || null;
}

// ══════════════════════════════════════════════════════════════════════════════
// UI RECORDER — live step capture from browser interactions
// ══════════════════════════════════════════════════════════════════════════════
// Flow:
//   1. User clicks Record → pick environment → POST /api/recorder/start
//   2. AUT opens in new tab with recorder.js injected
//   3. Steps stream in via SSE → appended live to the script editor
//   4. User clicks Stop Recording → POST /api/recorder/stop → session ends

let _recorderToken    = null;   // active session token
let _recorderSse      = null;   // EventSource instance
let _recorderTab      = null;   // reference to opened AUT tab
let _recorderStepBase = 0;      // step order offset (existing steps before recording)

// ── Entry point: toggle recording on/off ────────────────────────────────────
async function recorderToggle() {
  if (_recorderToken) {
    await recorderStop();
  } else {
    await recorderStart();
  }
}

// ── Start recording ──────────────────────────────────────────────────────────
async function recorderStart() {
  if (!currentProjectId) {
    alert('Select a project first before recording.');
    return;
  }

  const project = _currentProjectData();
  if (!project || !project.environments || project.environments.length === 0) {
    alert('This project has no environments configured. Add an environment in the Projects module first.');
    return;
  }

  // Pick environment — if only one, use it directly; otherwise prompt
  let env = null;
  if (project.environments.length === 1) {
    env = project.environments[0];
  } else {
    env = await _recorderPickEnv(project.environments);
    if (!env) return; // user cancelled
  }

  // Calculate step order offset — new steps will be appended after existing ones
  const existingRows = document.querySelectorAll('#se-steps-container .script-step-row');
  _recorderStepBase = existingRows.length;

  // Start session on server
  let token;
  try {
    const res = await fetch('/api/recorder/start', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ projectId: currentProjectId, autUrl: env.url }),
    });
    if (res.status === 409) {
      const d = await res.json();
      alert(`Cannot start recording.\n\n${d.message || 'Another recording session is already active for this project.'}\n\nGo to the active session and click Stop Recording first.`);
      return;
    }
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    token = data.token;
  } catch (err) {
    alert('Failed to start recording session: ' + err.message);
    return;
  }

  _recorderToken = token;

  // Open SSE channel for live step delivery
  _recorderOpenSse(token);

  // Update UI
  const btn    = document.getElementById('recorder-btn');
  const status = document.getElementById('recorder-status');
  if (btn)    { btn.textContent = '\u23F9 Stop Recording'; btn.classList.add('recording'); }
  if (status) { status.textContent = 'Recording\u2026'; status.style.display = 'inline'; }

  // Prompt user to activate extension — session is ready, extension just needs to connect
  alert('Recording session started!\n\nNow open the QA Agent Recorder extension in Chrome and click "Start Recording".\nThe extension will inject into your AUT tab and stream steps here live.');
}

// ── Stop recording ───────────────────────────────────────────────────────────
async function recorderStop() {
  if (!_recorderToken) return;
  const token = _recorderToken;

  _recorderCloseSse();
  _recorderToken = null;

  try {
    await fetch('/api/recorder/stop', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });
  } catch { /* ignore — server will auto-expire */ }

  // Reset UI
  const btn    = document.getElementById('recorder-btn');
  const status = document.getElementById('recorder-status');
  if (btn)    { btn.textContent = '⬤ Record'; btn.classList.remove('recording'); }
  if (status) { status.style.display = 'none'; }

  console.info('[Recorder] Stopped. Steps are in the editor — review and save.');
}

// ── Environment picker (for projects with multiple environments) ──────────────
function _recorderPickEnv(environments) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:400px;padding:24px">
        <div style="font-weight:700;font-size:15px;margin-bottom:16px">Select Environment to Record Against</div>
        <select id="rec-env-pick" class="fm-input" style="width:100%;margin-bottom:20px">
          ${environments.map(e => `<option value="${e.id}">${e.name} — ${e.url}</option>`).join('')}
        </select>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-outline btn-sm" id="rec-env-cancel">Cancel</button>
          <button class="btn btn-primary btn-sm" id="rec-env-ok">Start Recording</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('rec-env-cancel').onclick = () => { document.body.removeChild(overlay); resolve(null); };
    document.getElementById('rec-env-ok').onclick = () => {
      const selId = document.getElementById('rec-env-pick').value;
      const env   = environments.find(e => e.id === selId) || environments[0];
      document.body.removeChild(overlay);
      resolve(env);
    };
  });
}

// ── SSE client ───────────────────────────────────────────────────────────────
function _recorderOpenSse(token) {
  _recorderCloseSse();
  const src = new EventSource(`/api/recorder/stream/${encodeURIComponent(token)}`);
  _recorderSse = src;

  src.addEventListener('recorder:step', e => {
    try {
      const { step, locatorCreated, locatorName } = JSON.parse(e.data);
      _recorderAppendStep(step, locatorCreated, locatorName);
    } catch (err) {
      console.warn('[Recorder] Failed to parse step event:', err);
    }
  });

  src.addEventListener('recorder:stopped', () => {
    _recorderCloseSse();
  });

  src.onerror = () => {
    console.warn('[Recorder] SSE connection error — will retry automatically');
  };
}

function _recorderCloseSse() {
  if (_recorderSse) { try { _recorderSse.close(); } catch {} _recorderSse = null; }
}

// ── Append a recorded step to the script editor ───────────────────────────────
function _recorderAppendStep(step, locatorCreated, locatorName) {
  // Build a step object that scriptAddStep understands
  const stepData = {
    keyword:     step.keyword,
    locator:     step.locator     || '',
    locatorId:   step.locatorId   || null,
    locatorType: step.locatorType || 'css',
    locatorName: locatorName      || step.locator || '',
    value:       step.value       || '',
    valueMode:   'static',
    description: step.description || '',
    screenshot:  false,
    testData:    [],
  };

  scriptAddStep(stepData);

  // Visual flash on the newly added row to draw attention
  const rows = document.querySelectorAll('#se-steps-container .script-step-row');
  const last = rows[rows.length - 1];
  if (last) {
    last.style.transition = 'background 0.3s';
    last.style.background = 'rgba(139,92,246,0.15)';
    setTimeout(() => { last.style.background = ''; }, 1200);

    // [Gap 4] Inline locator edit button on recorded step
    const actionsBar = last.querySelector('.step-actions-bar') || last.querySelector('.step-header');
    if (actionsBar) {
      const editLocBtn = document.createElement('button');
      editLocBtn.className = 'tbl-btn';
      editLocBtn.title = 'Edit locator before saving';
      editLocBtn.textContent = '✎ Fix Locator';
      editLocBtn.style.cssText = 'font-size:10px;padding:2px 7px;margin-left:6px;background:#f59e0b;color:#fff;border:none;border-radius:3px;cursor:pointer';
      editLocBtn.onclick = () => _recorderInlineEditLocator(last, stepData);
      actionsBar.appendChild(editLocBtn);
    }

    // Show "New from repo" badge if locator was auto-created
    if (locatorCreated) {
      const badge = document.createElement('span');
      badge.textContent = '★ Added to Repo';
      badge.style.cssText = 'font-size:10px;background:#8b5cf6;color:#fff;border-radius:4px;padding:1px 6px;margin-left:6px;vertical-align:middle';
      const numEl = last.querySelector('.step-num');
      if (numEl) numEl.parentNode.insertBefore(badge, numEl.nextSibling);
      setTimeout(() => { try { badge.remove(); } catch {} }, 4000);
    }
  }
}

// ── [Gap 4] Inline locator editor — edit before saving ───────────────────────
function _recorderInlineEditLocator(rowEl, stepData) {
  // Remove any existing inline editor on this row
  const existing = rowEl.querySelector('.rec-inline-edit');
  if (existing) { existing.remove(); return; }

  const LOCATOR_TYPES = ['css','xpath','id','name','text','testid','role','label','placeholder'];

  const editor = document.createElement('div');
  editor.className = 'rec-inline-edit';
  editor.style.cssText = 'display:flex;gap:6px;align-items:center;padding:6px 10px 8px;background:#fef3c7;border-top:1px solid #f59e0b;flex-wrap:wrap';
  editor.innerHTML = `
    <span style="font-size:11px;font-weight:600;color:#92400e">Fix Locator:</span>
    <select class="fm-input rec-loc-type" style="width:110px;font-size:12px;padding:2px 4px">
      ${LOCATOR_TYPES.map(t => `<option value="${t}" ${stepData.locatorType === t ? 'selected' : ''}>${t}</option>`).join('')}
    </select>
    <input class="fm-input rec-loc-value" type="text" value="${escHtml(stepData.locator || '')}"
      placeholder="Enter locator…" style="flex:1;min-width:200px;font-size:12px;padding:2px 6px;font-family:monospace">
    <button class="btn btn-primary btn-sm" style="font-size:11px;padding:3px 10px" onclick="_recorderApplyLocatorEdit(this)">Apply</button>
    <button class="tbl-btn" style="font-size:11px" onclick="this.closest('.rec-inline-edit').remove()">Cancel</button>`;
  editor._stepData = stepData;
  rowEl.appendChild(editor);
  editor.querySelector('.rec-loc-value').focus();
}

function _recorderApplyLocatorEdit(btn) {
  const editor    = btn.closest('.rec-inline-edit');
  const rowEl     = editor.parentElement;
  const stepData  = editor._stepData;
  const newType   = editor.querySelector('.rec-loc-type').value;
  const newLoc    = editor.querySelector('.rec-loc-value').value.trim();
  if (!newLoc) { alert('Locator cannot be empty'); return; }

  // Update stepData in-place (it's a reference from the scriptAddStep call)
  stepData.locator     = newLoc;
  stepData.locatorType = newType;
  stepData.locatorName = newLoc;

  // Update the displayed locator text in the step row
  const locDisplay = rowEl.querySelector('.step-locator-text, .step-locator, [data-field="locator"]');
  if (locDisplay) locDisplay.textContent = newLoc;

  // Update the underlying hidden inputs if scriptAddStep rendered them
  const locInput     = rowEl.querySelector('input[name="locator"], .se-locator-input');
  const locTypeInput = rowEl.querySelector('select[name="locatorType"], .se-loctype-select');
  if (locInput)     locInput.value     = newLoc;
  if (locTypeInput) locTypeInput.value = newType;

  editor.remove();

  // Flash green to confirm
  rowEl.style.transition = 'background 0.2s';
  rowEl.style.background = 'rgba(34,197,94,0.15)';
  setTimeout(() => { rowEl.style.background = ''; }, 1000);
}
