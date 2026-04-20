/**
 * modules.js
 * Admin Panel, Projects, Locator Repo, Common Functions, Auth check/logout
 * Loaded after app.js in index.html
 */
'use strict';

function _escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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

    // Viewer-mode: hide all write controls, show badge
    if (currentUser.role === 'viewer') {
      _applyViewerMode();
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

function isViewer() { return currentUser?.role === 'viewer'; }

function _applyViewerMode() {
  // Badge next to username in sidebar
  const roleEl = document.getElementById('sidebar-role');
  if (roleEl) {
    roleEl.textContent = '';
    roleEl.innerHTML = '<span style="background:#f48771;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px;letter-spacing:.5px">VIEW ONLY</span>';
  }

  // Hide all write-action buttons — add/new/delete/run/save/edit
  document.querySelectorAll(
    '#btn-new-script, #btn-new-suite, #btn-add-locator, #btn-new-function, #btn-add-cd, ' +
    '.btn-run-suite, .script-bulk-bar, #script-bulk-bar'
  ).forEach(el => el.style.display = 'none');

  // Mark body so CSS can target viewer-specific rules
  document.body.classList.add('viewer-mode');
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
  if (name === 'license')  licenseLoad();
  if (name === 'apikeys')  apikeyLoad();
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
  // NL settings — key is redacted on server side, just show placeholder if set
  const keyEl = document.getElementById('set-anthropic-key');
  if (keyEl) keyEl.placeholder = data.anthropicApiKeySet ? '●●●●●●●●●●●● (saved)' : 'sk-ant-…';
  const modelEl = document.getElementById('set-nl-model');
  if (modelEl && data.nlModel) modelEl.value = data.nlModel;
  const statusEl = document.getElementById('set-nl-status');
  if (statusEl) statusEl.textContent = data.anthropicApiKeySet ? '✓ API key is configured — NL Suggestion active' : 'No API key — NL Suggestion disabled';
  // Load notification settings
  notifLoad(data.notifications ?? {});
}

async function settingsSave() {
  modClearAlert('settings-alert');
  const keyVal = document.getElementById('set-anthropic-key')?.value.trim();
  const body = {
    appName:               document.getElementById('set-app-name').value.trim(),
    sessionTimeoutMinutes: parseInt(document.getElementById('set-timeout').value) || 60,
    maxFailedLogins:       parseInt(document.getElementById('set-max-logins').value) || 5,
    allowRegistration:     document.getElementById('set-allow-reg').checked,
    nlModel:               document.getElementById('set-nl-model')?.value || 'claude-haiku-4-5-20251001',
    ...(keyVal ? { anthropicApiKey: keyVal } : {}),
  };
  const res  = await fetch('/api/admin/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) {
    modAlert('settings-alert','success','Settings saved successfully');
    if (keyVal) { const el = document.getElementById('set-anthropic-key'); if (el) { el.value = ''; el.placeholder = '●●●●●●●●●●●● (saved)'; } }
    settingsLoad();
  } else {
    modAlert('settings-alert','error', data.error || 'Error saving settings');
  }
}

function toggleApiKeyVisibility() {
  const el = document.getElementById('set-anthropic-key');
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

// ── Notification Settings ─────────────────────────────────────────────────────

function notifToggleSection(which, enabled) {
  const bodyEl = document.getElementById(`notif-${which}-body`);
  if (bodyEl) bodyEl.style.display = enabled ? '' : 'none';
}

function notifLoad(n) {
  const g = (id, def) => { const el = document.getElementById(id); if (el) el[el.type === 'checkbox' ? 'checked' : 'value'] = (n[def[0]] !== undefined ? n[def[0]] : def[1]); };
  // Trigger rules
  const onF = document.getElementById('notif-on-failure'); if (onF) onF.checked = n.notifyOnFailure !== false;
  const onS = document.getElementById('notif-on-success'); if (onS) onS.checked = !!n.notifyOnSuccess;
  const onA = document.getElementById('notif-on-always');  if (onA) onA.checked = !!n.notifyOnAlways;
  // Email
  const emailEn = document.getElementById('notif-email-enabled'); if (emailEn) { emailEn.checked = !!n.emailEnabled; notifToggleSection('email', !!n.emailEnabled); }
  document.getElementById('notif-smtp-host').value  = n.smtpHost  ?? '';
  document.getElementById('notif-smtp-port').value  = n.smtpPort  ?? 587;
  document.getElementById('notif-smtp-user').value  = n.smtpUser  ?? '';
  document.getElementById('notif-smtp-pass').value  = n.smtpPass  ?? '';
  document.getElementById('notif-email-from').value = n.emailFrom ?? '';
  document.getElementById('notif-email-to').value   = n.emailTo   ?? '';
  const secureEl = document.getElementById('notif-smtp-secure'); if (secureEl) secureEl.checked = !!n.smtpSecure;
  // Slack
  const slackEn = document.getElementById('notif-slack-enabled'); if (slackEn) { slackEn.checked = !!n.slackEnabled; notifToggleSection('slack', !!n.slackEnabled); }
  document.getElementById('notif-slack-webhook').value = n.slackWebhook ?? '';
  // Teams
  const teamsEn = document.getElementById('notif-teams-enabled'); if (teamsEn) { teamsEn.checked = !!n.teamsEnabled; notifToggleSection('teams', !!n.teamsEnabled); }
  document.getElementById('notif-teams-webhook').value = n.teamsWebhook ?? '';
}

function notifCollect() {
  const v = id => document.getElementById(id)?.value ?? '';
  const c = id => document.getElementById(id)?.checked ?? false;
  return {
    notifyOnFailure: c('notif-on-failure'),
    notifyOnSuccess: c('notif-on-success'),
    notifyOnAlways:  c('notif-on-always'),
    emailEnabled:    c('notif-email-enabled'),
    smtpHost:        v('notif-smtp-host').trim(),
    smtpPort:        parseInt(v('notif-smtp-port')) || 587,
    smtpSecure:      c('notif-smtp-secure'),
    smtpUser:        v('notif-smtp-user').trim(),
    smtpPass:        v('notif-smtp-pass'),
    emailFrom:       v('notif-email-from').trim(),
    emailTo:         v('notif-email-to').trim(),
    slackEnabled:    c('notif-slack-enabled'),
    slackWebhook:    v('notif-slack-webhook').trim(),
    teamsEnabled:    c('notif-teams-enabled'),
    teamsWebhook:    v('notif-teams-webhook').trim(),
  };
}

async function notifSave() {
  modClearAlert('notif-alert');
  const body = { notifications: notifCollect() };
  const res  = await fetch('/api/admin/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) modAlert('notif-alert','success','Notification settings saved');
  else        modAlert('notif-alert','error', data.error || 'Error saving');
}

async function notifTest() {
  modClearAlert('notif-alert');
  modAlert('notif-alert','info','Sending test notification…');
  const res  = await fetch('/api/admin/settings/test-notification', { method:'POST', headers:{'Content-Type':'application/json'} });
  const data = await res.json();
  if (data.success) {
    modAlert('notif-alert','success','Test notification sent successfully to all enabled channels');
  } else {
    const errs = Object.entries(data.errors || {}).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join('; ');
    modAlert('notif-alert','error', errs || data.error || 'Test notification failed — check server logs');
  }
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
        ${isViewer() ? '' : `<button class="tbl-btn" onclick="cdEdit('${escHtml(d.id)}')">Edit</button>`}
        ${isViewer() ? '' : `<button class="tbl-btn del" onclick="cdDelete('${escHtml(d.id)}','${escHtml(d.dataName)}')">Delete</button>`}
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
    // Stability badge — only shown when importanceScore is present (recorder v4+)
    let stabilityBadge = '';
    if (l.importanceScore != null) {
      const score = l.importanceScore;
      const dot   = score >= 80 ? '🟢' : score >= 50 ? '🟡' : '🔴';
      const label = score >= 80 ? 'Stable' : score >= 50 ? 'Moderate' : 'Fragile';
      const altCount = l.alternatives?.length ?? 0;
      const altTip   = altCount ? ` · ${altCount} alt${altCount > 1 ? 's' : ''}` : '';
      const pageKeyTip = l.pageKey ? ` · ${l.pageKey}` : '';
      stabilityBadge = `<span title="Stability score: ${score}/100${altTip}${pageKeyTip}" style="margin-left:5px;font-size:11px;cursor:default">${dot} <span style="font-size:10px;color:var(--neutral-500)">${label}</span></span>`;
    }
    return `<tr>
      <td><strong>${escHtml(l.name)}</strong>${autoTag}${stabilityBadge}</td>
      <td><code style="font-size:11px">${truncSel}</code></td>
      <td><span class="badge badge-tester">${escHtml(l.selectorType)}</span></td>
      <td>${escHtml(l.pageModule || '—')}</td>
      <td>${escHtml(l.description || '—')}</td>
      <td>
        ${isViewer() ? '' : `<button class="tbl-btn" onclick="locatorEdit('${escHtml(l.id)}')">Edit</button>`}
        ${isViewer() ? '' : `<button class="tbl-btn del" onclick="locatorDelete('${escHtml(l.id)}','${escHtml(l.name)}')">Del</button>`}
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

// ── Locator sub-tab switching ─────────────────────────────────────────────────
function locSubTab(tab) {
  const isRepo = tab === 'repo';
  document.getElementById('loc-subpanel-repo').style.display       = isRepo ? '' : 'none';
  document.getElementById('loc-subpanel-proposals').style.display  = isRepo ? 'none' : '';
  document.getElementById('loc-subtab-repo').classList.toggle('loc-subtab-active', isRepo);
  document.getElementById('loc-subtab-proposals').classList.toggle('loc-subtab-active', !isRepo);
  if (!isRepo) proposalLoad();
}

// ── Healing Proposals ─────────────────────────────────────────────────────────
let _allProposals = [];

async function proposalLoad() {
  if (!currentProjectId) return;
  try {
    const res = await fetch(`/api/proposals?projectId=${encodeURIComponent(currentProjectId)}`);
    _allProposals = await res.json();
    proposalRender();
    // Update pending count badge on the sub-tab
    const pending = _allProposals.filter(p => p.status === 'pending-review').length;
    const cntEl = document.getElementById('loc-proposal-count');
    if (cntEl) {
      cntEl.textContent = pending;
      cntEl.style.display = pending ? '' : 'none';
    }
  } catch { /* ignore */ }
}

function proposalRender() {
  const filterStatus = document.getElementById('loc-prop-filter')?.value ?? '';
  const tbody = document.getElementById('prop-tbody');
  if (!tbody) return;

  const items = filterStatus
    ? _allProposals.filter(p => p.status === filterStatus)
    : _allProposals;

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:20px">No proposals found</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(p => {
    const statusBadge = {
      'auto-applied':   `<span class="prop-badge prop-badge-auto">Auto Applied</span>`,
      'pending-review': `<span class="prop-badge prop-badge-pending">Pending Review</span>`,
      'approved':       `<span class="prop-badge prop-badge-ok">Approved</span>`,
      'rejected':       `<span class="prop-badge prop-badge-reject">Rejected</span>`,
    }[p.status] || `<span class="prop-badge">${escHtml(p.status)}</span>`;

    const scoreColor = p.confidence >= 75 ? '#4ec9b0' : p.confidence >= 50 ? '#eab308' : '#f48771';
    const truncOld = p.oldSelector?.length > 50 ? `<span title="${escHtml(p.oldSelector)}">${escHtml(p.oldSelector.substring(0,50))}…</span>` : escHtml(p.oldSelector || '—');
    const truncNew = p.newSelector?.length > 50 ? `<span title="${escHtml(p.newSelector)}">${escHtml(p.newSelector.substring(0,50))}…</span>` : escHtml(p.newSelector || '—');
    const healedAt = p.healedAt ? new Date(p.healedAt).toLocaleString() : '—';

    const actionBtns = p.status === 'pending-review'
      ? `<button class="tbl-btn" style="color:#4ec9b0" onclick="proposalReview('${escHtml(p.id)}','approved')">✓ Approve</button>
         <button class="tbl-btn del" onclick="proposalReview('${escHtml(p.id)}','rejected')">✗ Reject</button>`
      : `<span style="font-size:11px;color:var(--neutral-500)">${escHtml(p.reviewedBy || '')} ${p.reviewedAt ? new Date(p.reviewedAt).toLocaleDateString() : ''}</span>`;

    return `<tr>
      <td><strong>${escHtml(p.locatorName || p.locatorId)}</strong></td>
      <td><code style="font-size:11px">${truncOld}</code></td>
      <td><code style="font-size:11px;color:${scoreColor}">${truncNew}</code></td>
      <td style="text-align:center;font-weight:600;color:${scoreColor}">${p.confidence}</td>
      <td>${statusBadge}</td>
      <td style="font-size:11px">${healedAt}</td>
      <td>${actionBtns}</td>
    </tr>`;
  }).join('');
}

async function proposalReview(id, action) {
  try {
    const res = await fetch(`/api/proposals/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Review failed'); return; }
    await proposalLoad(); // Refresh
  } catch { alert('Network error'); }
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
        ${isViewer() ? '' : `<button class="tbl-btn" onclick="fnEdit('${escHtml(f.id)}')">Edit</button>`}
        ${isViewer() ? '' : `<button class="tbl-btn del" onclick="fnDelete('${escHtml(f.id)}','${escHtml(f.name)}')">Delete</button>`}
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
  (fn.steps || []).forEach(s => fnAddStep(s, true));
  fnReorderNums(); // one call after all steps inserted
  modClearAlert('fn-modal-alert');
  openModal('modal-function');
}

function fnAddStep(step = {}, _skipReorder = false) {
  const container = document.getElementById('fn-steps-container');
  const idx = container.querySelectorAll('.fn-step-card').length;

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
      <select class="fm-select fn-step-kw-select" style="flex:1;font-size:12.5px" onchange="fnStepKwChange(this)">${_kwOptionsFnHtml}</select>
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
            <select class="fm-select fn-step-loc-type" style="font-size:11.5px">${_locTypeOptsHtml}</select>
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

  // Set keyword + locator type selections via JS
  row.querySelector('.fn-step-kw-select').value = step.keyword || '';
  row.querySelector('.fn-step-loc-type').value  = step.locatorType || 'css';

  container.appendChild(row);
  fnStepKwChange(row.querySelector('.fn-step-kw-select'));
  if (!_skipReorder) fnReorderNums();
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

  // Close modal + refresh list immediately — don't wait for locator sync
  const stepsForSync = steps.map(s => ({
    locatorName: s.locatorName,
    locator: s.selector,
    locatorType: s.locatorType,
    description: s.description,
  }));
  _syncFailedLocators.clear();
  fnCloseModal();
  await fnLoad();

  // Background locator sync — surfaces failures as banner
  _syncLocatorsToRepo(stepsForSync).then(failed => {
    if (failed.length) {
      _syncFailedLocators = new Set(failed);
      _showSyncFailBanner(failed, 'function');
    }
  }).catch(() => {});
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
  if (tab === 'locators')   { locatorLoad(); proposalLoad(); }
  if (tab === 'functions')  fnLoad();
  if (tab === 'commondata') cdLoad();
  if (tab === 'scripts')    { scriptLoad(); _debugSessionsPollStart(); }
  if (tab === 'suites')     suiteLoad();
  if (tab === 'execution')  execLoad();
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
const PROJECT_SCOPED_TABS = new Set(['scripts','suites','locators','functions','commondata','history','flaky','analytics','visual']);

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
  analyticsLoad();
  vrLoad();
  execLoad();
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

// ── Keyword option HTML caches — built once after keywordsLoad(), reused per step ──
let _kwOptionsScriptHtml = '';  // script steps: all kws except GOTO
let _kwOptionsFnHtml     = '';  // fn steps: all kws except GOTO + CALL FUNCTION
let _locTypeOptsHtml     = '';  // locator type options (same for both)

// Locators that failed to sync on last save — shown as step-level badges on re-open
let _syncFailedLocators = new Set();

function _buildKwCaches() {
  if (_kwOptionsScriptHtml) return; // already built
  _kwOptionsScriptHtml = scriptKeywords.categories.map(cat => {
    const opts = cat.keywords
      .filter(kw => kw.key !== 'GOTO')
      .map(kw =>
        `<option value="${escHtml(kw.key)}"` +
        ` data-nl="${kw.needsLocator}" data-nv="${kw.needsValue}" data-hint="${escHtml(kw.valueHint || '')}"` +
        ` data-help="${escHtml(kw.helpLabel || '')}" data-tooltip-json="${escHtml(JSON.stringify(kw.tooltip || {}))}"` +
        ` data-auto="${kw.autoFromProject ? 'true' : 'false'}"` +
        `>${escHtml(kw.label)}</option>`
      ).join('');
    return opts ? `<optgroup label="${escHtml(cat.name)}">${opts}</optgroup>` : '';
  }).join('');

  _kwOptionsFnHtml = scriptKeywords.categories.map(cat => {
    const opts = cat.keywords
      .filter(kw => kw.key !== 'GOTO' && kw.key !== 'CALL FUNCTION')
      .map(kw =>
        `<option value="${escHtml(kw.key)}"` +
        ` data-nl="${kw.needsLocator}" data-nv="${kw.needsValue}" data-hint="${escHtml(kw.valueHint || '')}"` +
        ` data-help="${escHtml(kw.helpLabel || '')}" data-tooltip-json="${escHtml(JSON.stringify(kw.tooltip || {}))}"` +
        ` data-auto="false"` +
        `>${escHtml(kw.label)}</option>`
      ).join('');
    return opts ? `<optgroup label="${escHtml(cat.name)}">${opts}</optgroup>` : '';
  }).join('');

  _locTypeOptsHtml = (scriptKeywords.locatorTypes || []).map(lt =>
    `<option value="${escHtml(lt.value)}">${escHtml(lt.label)}</option>`
  ).join('');
}

async function keywordsLoad() {
  if (scriptKeywords.categories.length) return;
  try {
    const res = await fetch('/api/keywords/playwright');
    if (res.ok) {
      scriptKeywords = await res.json();
      _buildKwCaches();
    }
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
    <div style="display:flex;align-items:center;gap:8px;padding:6px 2px 8px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer">
        <input type="checkbox" id="script-select-all" onchange="scriptSelectAll(this)" /> Select All
      </label>
      <span id="script-sel-count" style="font-size:12px;color:var(--neutral-500);font-weight:600"></span>
      <!-- Bulk action bar — hidden until ≥1 selected -->
      <div id="script-bulk-bar" style="display:none;display:none;align-items:center;gap:6px;flex-wrap:wrap">
        <button class="tbl-btn" style="background:#3b82f6;color:#fff;border-color:#3b82f6" onclick="scriptBulkAddToSuite()">&#10133; Add to Suite</button>
        <button class="tbl-btn" onclick="scriptBulkSetPriority()">&#9881; Set Priority</button>
        <button class="tbl-btn" onclick="scriptBulkSetTag()">&#127991; Set Tag</button>
        <button class="tbl-btn del" onclick="scriptDeleteSelected()">&#128465; Delete</button>
      </div>
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
                  ${isViewer() ? '' : `<button class="tbl-btn" onclick="scriptOpenEditor('${escHtml(s.id)}')">Edit</button>`}
                  <button class="tbl-btn dbg" onclick="debugOpen('${escHtml(s.id)}')">&#128027;</button>
                  ${isViewer() ? '' : `<button class="tbl-btn del" onclick="scriptDelete('${escHtml(s.id)}','${escHtml(s.title)}')">Del</button>`}
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${pgHtml}`;
  // Re-apply debug badges after DOM is rebuilt
  _debugApplyBadges();
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
  const checked  = [...document.querySelectorAll('.script-row-chk:checked')];
  const allChk   = document.getElementById('script-select-all');
  const allBoxes = document.querySelectorAll('.script-row-chk');
  if (allChk) allChk.indeterminate = checked.length > 0 && checked.length < allBoxes.length;
  const bulkBar = document.getElementById('script-bulk-bar');
  const countEl = document.getElementById('script-sel-count');
  if (bulkBar) bulkBar.style.display = checked.length > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent   = checked.length > 0 ? `${checked.length} selected` : '';
}

async function scriptDeleteSelected() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} script${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
  const res = await fetch('/api/scripts/bulk', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Delete failed'); return; }
  await scriptLoad();
}

async function scriptBulkAddToSuite() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  const suites = allSuites.filter(s => s.projectId === currentProjectId);
  if (!suites.length) { alert('No suites in this project. Create a suite first.'); return; }
  const options = suites.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
  // Inline modal
  const existing = document.getElementById('bulk-suite-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'bulk-suite-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#1e2329;border-radius:10px;padding:28px 32px;min-width:340px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
      <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:16px">&#10133; Add ${ids.length} Script${ids.length>1?'s':''} to Suite</div>
      <select id="bulk-suite-sel" class="fm-input" style="width:100%;margin-bottom:16px">
        <option value="">— Select a suite —</option>${options}
      </select>
      <div id="bulk-suite-alert" style="margin-bottom:10px;font-size:12.5px;color:#f48771;display:none"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-outline" onclick="document.getElementById('bulk-suite-modal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="scriptBulkAddToSuiteConfirm(${JSON.stringify(ids)})">Add to Suite</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function scriptBulkAddToSuiteConfirm(ids) {
  const suiteId = document.getElementById('bulk-suite-sel')?.value;
  const alertEl = document.getElementById('bulk-suite-alert');
  if (!suiteId) { alertEl.textContent = 'Select a suite first.'; alertEl.style.display = ''; return; }
  const res  = await fetch('/api/scripts/bulk-suite', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, suiteId }),
  });
  const data = await res.json();
  if (!res.ok) { alertEl.textContent = data.error || 'Failed'; alertEl.style.display = ''; return; }
  document.getElementById('bulk-suite-modal')?.remove();
  const suiteName = allSuites.find(s => s.id === suiteId)?.name || suiteId;
  // Brief success toast
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#166534;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  toast.textContent = `✓ ${data.count} script${data.count!==1?'s':''} added to "${suiteName}"`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
  await suiteLoad();
}

async function scriptBulkSetPriority() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  const priorities = ['low','medium','high','critical'];
  const choice = await _bulkPickModal(
    `&#9881; Set Priority for ${ids.length} Script${ids.length>1?'s':''}`,
    'Priority', priorities.map(p => ({ value: p, label: p.charAt(0).toUpperCase()+p.slice(1) }))
  );
  if (!choice) return;
  const res  = await fetch('/api/scripts/bulk', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, patch: { priority: choice } }),
  });
  if (!res.ok) { alert('Failed to update priority'); return; }
  _bulkToast(`✓ Priority set to "${choice}" for ${ids.length} script${ids.length>1?'s':''}`);
  await scriptLoad();
}

async function scriptBulkSetTag() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  const tag = await _bulkInputModal(`&#127991; Set Tag for ${ids.length} Script${ids.length>1?'s':''}`, 'Tag value');
  if (tag === null) return;
  const res = await fetch('/api/scripts/bulk', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, patch: { tags: [tag.trim()] } }),
  });
  if (!res.ok) { alert('Failed to update tag'); return; }
  _bulkToast(`✓ Tag "${tag}" applied to ${ids.length} script${ids.length>1?'s':''}`);
  await scriptLoad();
}

// Shared helpers for bulk modals
function _bulkPickModal(title, label, options) {
  return new Promise(resolve => {
    const existing = document.getElementById('bulk-pick-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'bulk-pick-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    const opts = options.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('');
    modal.innerHTML = `
      <div style="background:#1e2329;border-radius:10px;padding:28px 32px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:16px">${title}</div>
        <select id="bulk-pick-sel" class="fm-input" style="width:100%;margin-bottom:16px"><option value="">— Select ${escHtml(label)} —</option>${opts}</select>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-outline" onclick="document.getElementById('bulk-pick-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="
            const v=document.getElementById('bulk-pick-sel').value;
            if(!v)return;
            document.getElementById('bulk-pick-modal').remove();
            window.__bulkPickResolve(v);">Apply</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window.__bulkPickResolve = resolve;
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });
  });
}

function _bulkInputModal(title, placeholder) {
  return new Promise(resolve => {
    const existing = document.getElementById('bulk-input-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'bulk-input-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:#1e2329;border-radius:10px;padding:28px 32px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:16px">${title}</div>
        <input id="bulk-input-val" class="fm-input" placeholder="${escHtml(placeholder)}" style="width:100%;margin-bottom:16px" />
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-outline" onclick="document.getElementById('bulk-input-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="
            const v=document.getElementById('bulk-input-val').value.trim();
            if(!v)return;
            document.getElementById('bulk-input-modal').remove();
            window.__bulkInputResolve(v);">Apply</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window.__bulkInputResolve = resolve;
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });
    document.getElementById('bulk-input-val')?.focus();
  });
}

function _bulkToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#166534;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
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
    (sc.steps || []).forEach(step => scriptAddStep(step, null, true));
    scriptReorderNums(); // one call after all steps inserted
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

function scriptAddStep(step = {}, insertBeforeRow = null, _skipReorder = false) {
  const container = document.getElementById('se-steps-container');
  document.getElementById('se-steps-hint').style.display = 'none';
  const idx = container.querySelectorAll('.script-step-row').length;

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
      <select class="fm-select se-step-kw-select" style="flex:1;font-size:12.5px" onchange="scriptStepKwChange(this)">${_kwOptionsScriptHtml}</select>
      <label class="step-screenshot-lbl">
        <input type="checkbox" class="se-step-screenshot"${step.screenshot ? ' checked' : ''} /> Screenshot
      </label>
    </div>
    <div class="step-nl-row" style="display:flex;align-items:center;gap:6px;margin:4px 0 0 0">
      <span style="font-size:11px;color:var(--neutral-500);flex-shrink:0">&#10024; NL:</span>
      <input class="fm-input se-step-nl-input" type="text" placeholder="Describe this step in plain English…"
             style="flex:1;font-size:12px;padding:4px 8px"
             oninput="nlStepDebounce(this)" />
      <span class="se-step-nl-status" style="font-size:11px;color:var(--neutral-500);flex-shrink:0;min-width:60px;text-align:right"></span>
    </div>
    <div class="step-help-row"${helpLbl ? '' : ' style="display:none"'}>
      <span class="step-help-label">${escHtml(helpLbl)}</span>
      <span class="step-tooltip-trigger" data-tooltip-json="${escHtml(tipJson)}" onmouseenter="_kwTipShow(this)" onmouseleave="_kwTipHide()"${tipJson ? '' : ' style="display:none"'}>?</span>
    </div>
    <div class="step-pin-badge${step.storeAs ? '' : ' step-pin-badge-hidden'}${step.storeScope==='global' ? ' step-pin-badge-global' : ''}" data-store-as="${escHtml(step.storeAs||'')}" data-store-scope="${escHtml(step.storeScope||'session')}" data-store-source="${escHtml(step.storeSource||'text')}" data-store-attr="${escHtml(step.storeAttrName||'')}">
      <span class="pin-badge-label">${step.storeScope==='global' ? '🌐' : '📌'} Saved as <code>{{var.${escHtml(step.storeAs||'')}}}</code><span class="pin-scope-tag">${step.storeScope==='global' ? 'Global' : 'Session'}</span></span>
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
            <select class="fm-select se-step-loc-type" style="font-size:11.5px">${_locTypeOptsHtml}</select>
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
          <div class="field" style="margin:0;min-width:160px">
            <label style="font-size:11px">Scope</label>
            <div class="setvar-scope-toggle">
              <label class="setvar-scope-opt${(step.storeScope||'session')==='session'?' active':''}">
                <input type="radio" name="setvar-scope-${step.id||'new'}" class="se-setvar-scope" value="session" ${(step.storeScope||'session')==='session'?'checked':''} onchange="_setVarScopeChanged(this)"/>
                📌 Session
              </label>
              <label class="setvar-scope-opt${step.storeScope==='global'?' active':''}">
                <input type="radio" name="setvar-scope-${step.id||'new'}" class="se-setvar-scope" value="global" ${step.storeScope==='global'?'checked':''} onchange="_setVarScopeChanged(this)"/>
                🌐 Global
              </label>
            </div>
          </div>
        </div>
        <div class="setvar-hint" style="font-size:11px;color:var(--neutral-500);margin-top:5px;display:${step.storeAs?'block':'none'}">
          Use <code>{{var.${escHtml(step.storeAs||'')}}}</code> in any later step's value field
          <span class="setvar-scope-hint">${step.storeScope==='global' ? ' — 🌐 visible across all scripts in this suite' : ' — 📌 visible only within this script'}</span>
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

  // Set keyword + locator type selections via JS (avoids per-step option string rebuild)
  row.querySelector('.se-step-kw-select').value = step.keyword || '';
  row.querySelector('.se-step-loc-type').value  = step.locatorType || 'css';

  // Sync-fail badge — shown when this step's locator failed to sync on last save
  if (step.locatorName && _syncFailedLocators.has(step.locatorName)) {
    const locField = row.querySelector('.se-step-locator .field');
    if (locField) {
      const badge = document.createElement('span');
      badge.className = 'sync-fail-step-badge';
      badge.title = `"${step.locatorName}" could not be saved to the Locator Repository. Open Locator Repository to add it manually.`;
      badge.textContent = '⚠ Repo sync failed';
      locField.appendChild(badge);
    }
  }

  if (insertBeforeRow) {
    container.insertBefore(row, insertBeforeRow);
  } else {
    container.appendChild(row);
  }
  scriptStepKwChange(row.querySelector('.se-step-kw-select'));
  if (!_skipReorder) scriptReorderNums();
  // If restoring a commondata step, pre-load CD options
  if (valMode === 'commondata') _loadCdOptions(row);
  // If restoring a variable step, pre-load variable options
  if (valMode === 'variable') {
    const varSel = row.querySelector('.se-step-var-select');
    if (varSel && step.value) varSel.dataset.savedVar = step.value;
    _loadVarOptions(row);
  }
}

// ── NL Keyword Suggestion ──────────────────────────────────────────────────────

let _nlTimer = null;

function nlStepDebounce(input) {
  const row = input.closest('.script-step-row');
  const statusEl = row?.querySelector('.se-step-nl-status');
  if (statusEl) statusEl.textContent = '…';
  clearTimeout(_nlTimer);
  const val = input.value.trim();
  if (!val) { if (statusEl) statusEl.textContent = ''; return; }
  _nlTimer = setTimeout(() => nlStepSuggest(input, row, statusEl), 600);
}

async function nlStepSuggest(input, row, statusEl) {
  if (statusEl) { statusEl.textContent = '⏳'; statusEl.style.color = 'var(--neutral-400)'; }
  try {
    const res  = await fetch('/api/nl-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: input.value.trim(), projectId: currentProjectId || '' }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      if (statusEl) { statusEl.textContent = '✗'; statusEl.style.color = '#f48771'; statusEl.title = data.error || 'Error'; }
      return;
    }

    // Auto-fill keyword
    if (data.keyword) {
      const kwSel = row.querySelector('.se-step-kw-select');
      if (kwSel) {
        const match = [...kwSel.options].find(o => o.value.toUpperCase() === data.keyword.toUpperCase());
        if (match) {
          kwSel.value = match.value;
          scriptStepKwChange(kwSel);
        }
      }
    }

    // Auto-fill locator name
    if (data.locatorName) {
      const locInput = row.querySelector('.se-step-loc-name');
      if (locInput && !locInput.value) {
        locInput.value = data.locatorName;
        // Try to resolve from locator repo
        _seResolveLocName(row, data.locatorName);
      }
    }

    // Auto-fill static value
    if (data.value) {
      const staticInput = row.querySelector('.se-step-val-static');
      if (staticInput && !staticInput.value) staticInput.value = data.value;
    }

    const pct = Math.round((data.confidence ?? 1) * 100);
    if (statusEl) {
      statusEl.textContent = `✓ ${pct}%`;
      statusEl.style.color = pct >= 80 ? '#4ec9b0' : pct >= 50 ? '#e9b96e' : '#f48771';
      statusEl.title = `Confidence: ${pct}%`;
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '✗'; statusEl.style.color = '#f48771'; statusEl.title = e.message; }
  }
}

// Resolve a locator name against the repo (same logic as locator picker)
function _seResolveLocName(row, name) {
  if (!currentProjectId || !name) return;
  fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}`)
    .then(r => r.json())
    .then(locs => {
      const match = locs.find(l => l.name?.toLowerCase() === name.toLowerCase());
      if (!match) return;
      const locNameEl  = row.querySelector('.se-step-loc-name');
      const locTypeEl  = row.querySelector('.se-step-loc-type');
      const locSelEl   = row.querySelector('.se-step-selector');
      const repoEl     = row.querySelector('.loc-repo-badge');
      const unlockEl   = row.querySelector('.loc-unlock-btn');
      if (locNameEl)  { locNameEl.value = match.name; locNameEl.readOnly = true; }
      if (locTypeEl)  locTypeEl.value = match.selectorType || match.locatorType || 'css';
      if (locSelEl)   { locSelEl.value = match.selector || ''; locSelEl.readOnly = true; }
      if (repoEl)     repoEl.style.display = '';
      if (unlockEl)   unlockEl.style.display = '';
      row.dataset.locatorId = match.id;
    }).catch(() => {});
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
  const container = document.getElementById('se-steps-container');
  if (!container) return;
  const allRows = [...container.querySelectorAll('.script-step-row')];
  const thisIdx = allRows.indexOf(row);

  // Session vars — only from EARLIER steps in THIS script
  const sessionVars = [];
  for (let i = 0; i < thisIdx; i++) {
    const badge = allRows[i].querySelector('.step-pin-badge');
    if (badge && badge.dataset.storeAs && badge.dataset.storeScope !== 'global') {
      sessionVars.push(badge.dataset.storeAs);
    }
    const kw = allRows[i].querySelector('.se-step-kw-select')?.value || '';
    if (kw === 'SET VARIABLE') {
      const scope = allRows[i].querySelector('.se-setvar-scope:checked')?.value || 'session';
      if (scope !== 'global') {
        const n = allRows[i].querySelector('.se-setvar-name')?.value?.trim();
        if (n) sessionVars.push(n);
      }
    }
  }

  // Global vars — from ALL steps in ALL scripts (any index), storeScope === 'global'
  const globalVars = [];
  allRows.forEach(r => {
    const badge = r.querySelector('.step-pin-badge');
    if (badge && badge.dataset.storeAs && badge.dataset.storeScope === 'global') {
      if (!globalVars.includes(badge.dataset.storeAs)) globalVars.push(badge.dataset.storeAs);
    }
    const kw = r.querySelector('.se-step-kw-select')?.value || '';
    if (kw === 'SET VARIABLE') {
      const scope = r.querySelector('.se-setvar-scope:checked')?.value || 'session';
      if (scope === 'global') {
        const n = r.querySelector('.se-setvar-name')?.value?.trim();
        if (n && !globalVars.includes(n)) globalVars.push(n);
      }
    }
  });

  const savedVal = sel.dataset.savedVar || sel.value || '';
  const noHint   = row.querySelector('.var-no-vars-hint');
  const useHint  = row.querySelector('.var-usage-hint');

  if (!sessionVars.length && !globalVars.length) {
    sel.innerHTML = '<option value="">— no variables yet —</option>';
    if (noHint) noHint.style.display = '';
    if (useHint) useHint.style.display = 'none';
    return;
  }
  if (noHint) noHint.style.display = 'none';

  let html = '<option value="">— pick a variable —</option>';
  if (sessionVars.length) {
    html += `<optgroup label="📌 This Script (session)">`;
    html += sessionVars.map(v => `<option value="${escHtml(v)}"${v===savedVal?' selected':''}>${escHtml(v)}</option>`).join('');
    html += `</optgroup>`;
  }
  if (globalVars.length) {
    html += `<optgroup label="🌐 Suite — all scripts (global)">`;
    html += globalVars.map(v => `<option value="${escHtml(v)}"${v===savedVal?' selected':''}>${escHtml(v)}</option>`).join('');
    html += `</optgroup>`;
  }
  sel.innerHTML = html;
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
  const row      = btn.closest('.script-step-row');
  const badge    = row.querySelector('.step-pin-badge');
  const curName  = badge?.dataset.storeAs || '';
  const curScope = badge?.dataset.storeScope || 'session';

  // Build inline modal
  const existing = document.getElementById('pin-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pin-modal-overlay';
  overlay.innerHTML = `
    <div class="pin-modal-box">
      <div class="pin-modal-title">📌 Save Step Value as Variable</div>
      <div class="pin-modal-body">
        <label style="font-size:11px;font-weight:600">Variable Name</label>
        <input id="pin-modal-name" class="fm-input" style="font-size:13px;font-family:monospace;margin-top:4px"
               placeholder="e.g. patientId" value="${escHtml(curName)}" pattern="[A-Za-z0-9_]+" autocomplete="off"/>
        <div style="margin-top:10px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:6px">Scope</label>
          <div class="setvar-scope-toggle">
            <label class="setvar-scope-opt${curScope==='session'?' active':''}">
              <input type="radio" name="pin-scope" value="session" ${curScope==='session'?'checked':''}/> 📌 Session
              <span style="font-size:10px;display:block;color:var(--neutral-500);margin-top:2px">This script only</span>
            </label>
            <label class="setvar-scope-opt${curScope==='global'?' active':''}">
              <input type="radio" name="pin-scope" value="global" ${curScope==='global'?'checked':''}/> 🌐 Global
              <span style="font-size:10px;display:block;color:var(--neutral-500);margin-top:2px">All scripts in suite</span>
            </label>
          </div>
        </div>
      </div>
      <div class="pin-modal-actions">
        <button type="button" class="tbl-btn" id="pin-modal-cancel">Cancel</button>
        <button type="button" class="tbl-btn tbl-btn-primary" id="pin-modal-save">Save Variable</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Scope radio active style
  overlay.querySelectorAll('input[name="pin-scope"]').forEach(r => {
    r.addEventListener('change', () => {
      overlay.querySelectorAll('.setvar-scope-opt').forEach(l => l.classList.remove('active'));
      r.closest('.setvar-scope-opt')?.classList.add('active');
    });
  });

  document.getElementById('pin-modal-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('pin-modal-save').onclick = () => {
    const nameVal  = document.getElementById('pin-modal-name').value.trim().replace(/[^A-Za-z0-9_]/g, '');
    const scopeVal = overlay.querySelector('input[name="pin-scope"]:checked')?.value || 'session';
    overlay.remove();
    if (!nameVal) { scriptStepPinClear(btn); return; }
    if (badge) {
      badge.dataset.storeAs    = nameVal;
      badge.dataset.storeScope = scopeVal;
      const icon = scopeVal === 'global' ? '🌐' : '📌';
      const scopeTag = scopeVal === 'global' ? 'Global' : 'Session';
      badge.querySelector('.pin-badge-label').innerHTML =
        `${icon} Saved as <code>{{var.${escHtml(nameVal)}}}</code><span class="pin-scope-tag">${scopeTag}</span>`;
      badge.classList.remove('step-pin-badge-hidden');
      badge.classList.toggle('step-pin-badge-global', scopeVal === 'global');
    }
    btn.classList.add('step-pin-active');
  };

  // Focus the name input
  setTimeout(() => document.getElementById('pin-modal-name')?.focus(), 50);
}

function scriptStepPinClear(btn) {
  const row   = btn.closest('.script-step-row');
  const badge = row.querySelector('.step-pin-badge');
  if (badge) {
    badge.dataset.storeAs    = '';
    badge.dataset.storeScope = 'session';
    badge.classList.add('step-pin-badge-hidden');
    badge.classList.remove('step-pin-badge-global');
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

function _setVarScopeChanged(radio) {
  const row       = radio.closest('.script-step-row');
  const isGlobal  = radio.value === 'global';
  // Update active style on scope labels
  row.querySelectorAll('.setvar-scope-opt').forEach(l => l.classList.remove('active'));
  radio.closest('.setvar-scope-opt')?.classList.add('active');
  // Update hint text
  const scopeHint = row.querySelector('.setvar-scope-hint');
  if (scopeHint) scopeHint.textContent = isGlobal
    ? ' — 🌐 visible across all scripts in this suite'
    : ' — 📌 visible only within this script';
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
    storeScope:    badge?.dataset.storeAs ? (badge.dataset.storeScope || 'session') : undefined,
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
      storeScope:    isSetVar
        ? (row.querySelector('.se-setvar-scope:checked')?.value || 'session')
        : (storeAs ? (badge?.dataset.storeScope || 'session') : undefined),
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

  // Close editor + refresh list immediately — don't wait for locator sync
  const stepsForSync = steps;
  _syncFailedLocators.clear();
  scriptEditorClose();
  await scriptLoad();

  // Background locator sync — surfaces failures as banner + step badges on re-open
  _syncLocatorsToRepo(stepsForSync).then(failed => {
    if (failed.length) {
      _syncFailedLocators = new Set(failed);
      _showSyncFailBanner(failed, 'script');
    }
  }).catch(() => {});
}

async function _syncLocatorsToRepo(steps) {
  const failed = [];
  const tasks = steps
    .filter(step => step.locatorName && step.locator)
    .map(async step => {
      try {
        const existing = allLocators.find(l => l.name === step.locatorName);
        if (existing) {
          if (existing.selector !== step.locator || existing.selectorType !== step.locatorType) {
            const res = await fetch(`/api/locators/${existing.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ selector: step.locator, selectorType: step.locatorType }),
            });
            if (!res.ok) failed.push(step.locatorName);
          }
        } else {
          const res = await fetch('/api/locators', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: step.locatorName,
              selector: step.locator,
              selectorType: step.locatorType,
              projectId: currentProjectId || null,
              pageModule: '',
              description: `Auto-synced from step: ${step.description || ''}`.trim(),
            }),
          });
          if (!res.ok) failed.push(step.locatorName);
        }
      } catch {
        failed.push(step.locatorName);
      }
    });
  await Promise.all(tasks);
  try { await locatorLoadScoped(); } catch { /* non-fatal */ }
  return failed;
}

function _showSyncFailBanner(failedNames, context) {
  // Remove any stale banner first
  document.getElementById('locator-sync-fail-banner')?.remove();

  const count   = failedNames.length;
  const names   = failedNames.map(n => `<strong>${escHtml(n)}</strong>`).join(', ');
  const subject = context === 'function' ? 'Function' : 'Script';
  const panelId = context === 'function' ? 'panel-functions' : 'panel-scripts';

  const banner = document.createElement('div');
  banner.id        = 'locator-sync-fail-banner';
  banner.className = 'sync-fail-banner';
  banner.innerHTML = `
    <span class="sync-fail-icon">⚠</span>
    <span class="sync-fail-msg">
      ${subject} saved — <strong>${count}</strong> locator${count > 1 ? 's' : ''} failed to sync to Locator Repository: ${names}.
      Open the <strong>Locator Repository</strong> tab to add ${count > 1 ? 'them' : 'it'} manually,
      or re-open this ${subject.toLowerCase()} to see the affected step${count > 1 ? 's' : ''} highlighted.
    </span>
    <button class="sync-fail-close" onclick="this.closest('.sync-fail-banner').remove()" title="Dismiss">✕</button>`;

  const panel = document.getElementById(panelId);
  if (panel) panel.prepend(banner);
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

// ── Suite Hooks state ─────────────────────────────────────────────────────────
let _hookBefore    = []; // [{ keyword, locator, value, description }]
let _hookAfter     = [];
let _hookFastMode  = []; // login steps for Fast Mode beforeAll

// Keywords allowed in hooks (excludes CALL FUNCTION, GOTO, SET VARIABLE, DATE TOKEN, CALL API, file keywords)
const HOOK_EXCLUDED_KW = new Set([
  'CALL FUNCTION','GOTO','SET VARIABLE','DATE TOKEN','CALL API',
  'ASSERT FILE DOWNLOADED','ASSERT DOWNLOAD COUNT','READ EXCEL VALUE',
  'ASSERT EXCEL ROW COUNT','READ PDF TEXT',
]);

function _hookKeywords() {
  const all = [];
  for (const cat of (scriptKeywords.categories || [])) {
    for (const kw of (cat.keywords || [])) {
      if (!HOOK_EXCLUDED_KW.has(kw.key)) all.push(kw);
    }
  }
  return all;
}

function fastModeToggle() {
  const on = document.getElementById('sm-fast-mode')?.checked;
  const body = document.getElementById('sm-fast-mode-body');
  if (body) body.style.display = on ? '' : 'none';
}

function _hookRender(which) {
  const arr     = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  const listId  = which === 'fastmode' ? 'hook-fastmode-list'  : `hook-${which}-list`;
  const emptyId = which === 'fastmode' ? 'hook-fastmode-empty' : `hook-${which}-empty`;
  const listEl  = document.getElementById(listId);
  const emptyEl = document.getElementById(emptyId);
  if (!listEl) return;

  // Remove all step rows (keep the empty placeholder)
  listEl.querySelectorAll('.hook-step-row').forEach(el => el.remove());

  if (arr.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const kws = _hookKeywords();
  arr.forEach((step, idx) => {
    const kw      = kws.find(k => k.key === step.keyword) || null;
    const needLoc = kw ? kw.needsLocator : true;
    const needVal = kw ? kw.needsValue   : true;
    const valHint = kw ? (kw.valueHint || '') : '';

    const row = document.createElement('div');
    row.className = 'hook-step-row';
    row.dataset.which = which;
    row.dataset.idx   = idx;
    row.innerHTML = `
      <div class="hook-step-num">${idx + 1}</div>
      <select class="hook-kw-sel fm-input" style="flex:0 0 160px;font-size:12px" onchange="_hookKwChange('${which}',${idx},this)">
        ${kws.map(k => `<option value="${escHtml(k.key)}"${k.key === step.keyword ? ' selected' : ''}>${escHtml(k.label)}</option>`).join('')}
      </select>
      <input class="hook-loc-inp fm-input" style="flex:1;font-size:12px;${needLoc?'':'opacity:.4'}" placeholder="Locator / selector"
             value="${escHtml(step.locator || '')}" ${needLoc?'':'disabled'}
             oninput="_hookFieldChange('${which}',${idx},'locator',this.value)" />
      <input class="hook-val-inp fm-input" style="flex:1;font-size:12px;${needVal?'':'opacity:.4'}" placeholder="${escHtml(valHint || 'Value')}"
             value="${escHtml(step.value || '')}" ${needVal?'':'disabled'}
             oninput="_hookFieldChange('${which}',${idx},'value',this.value)" />
      <input class="hook-desc-inp fm-input" style="flex:1;font-size:12px" placeholder="Description (optional)"
             value="${escHtml(step.description || '')}"
             oninput="_hookFieldChange('${which}',${idx},'description',this.value)" />
      <button class="tbl-btn del" title="Remove step" onclick="_hookRemoveStep('${which}',${idx})">✕</button>
    `;
    listEl.appendChild(row);
  });
}

function hookAddStep(which) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  const kws = _hookKeywords();
  const first = kws[0];
  arr.push({ keyword: first?.key || 'CLICK', locator: '', value: '', description: '' });
  _hookRender(which);
}

function _hookRemoveStep(which, idx) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  arr.splice(idx, 1);
  _hookRender(which);
}

function _hookFieldChange(which, idx, field, val) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  if (arr[idx]) arr[idx][field] = val;
}

function _hookKwChange(which, idx, sel) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  if (arr[idx]) arr[idx].keyword = sel.value;
  _hookRender(which); // re-render to update locator/value enabled state
}

function _hookInit(beforeSteps, afterSteps, fastModeOn, fastSteps) {
  _hookBefore   = (beforeSteps || []).map(s => ({ keyword: s.keyword || 'CLICK', locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  _hookAfter    = (afterSteps  || []).map(s => ({ keyword: s.keyword || 'CLICK', locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  _hookFastMode = (fastSteps   || []).map(s => ({ keyword: s.keyword || 'FILL',  locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  const chk  = document.getElementById('sm-fast-mode');
  const body = document.getElementById('sm-fast-mode-body');
  if (chk)  chk.checked = !!fastModeOn;
  if (body) body.style.display = fastModeOn ? '' : 'none';
  _hookRender('before');
  _hookRender('after');
  _hookRender('fastmode');
}

// ── Overlay Handlers state ────────────────────────────────────────────────────
let _overlayHandlers = []; // [{ type, action, text }]

function overlayAddHandler() {
  _overlayHandlers.push({ type: 'any', action: 'accept', text: '' });
  _overlayRender();
}

function _overlayRemove(idx) {
  _overlayHandlers.splice(idx, 1);
  _overlayRender();
}

function _overlayChange(idx, field, val) {
  if (_overlayHandlers[idx]) _overlayHandlers[idx][field] = val;
  if (field === 'action') _overlayRender(); // re-render to show/hide text field
}

function _overlayRender() {
  const listEl  = document.getElementById('overlay-handler-list');
  const emptyEl = document.getElementById('overlay-handler-empty');
  if (!listEl) return;
  listEl.querySelectorAll('.overlay-row').forEach(el => el.remove());

  if (_overlayHandlers.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  _overlayHandlers.forEach((h, idx) => {
    const showText = h.action === 'accept' && h.type === 'prompt';
    const row = document.createElement('div');
    row.className = 'overlay-row hook-step-row';
    row.innerHTML = `
      <div class="hook-step-num">${idx + 1}</div>
      <select class="fm-input" style="flex:0 0 110px;font-size:12px" onchange="_overlayChange(${idx},'type',this.value)">
        <option value="any"     ${h.type==='any'     ?'selected':''}>Any dialog</option>
        <option value="alert"   ${h.type==='alert'   ?'selected':''}>alert()</option>
        <option value="confirm" ${h.type==='confirm' ?'selected':''}>confirm()</option>
        <option value="prompt"  ${h.type==='prompt'  ?'selected':''}>prompt()</option>
      </select>
      <span style="font-size:12px;color:var(--neutral-500);flex:0 0 auto">&#8594;</span>
      <select class="fm-input" style="flex:0 0 100px;font-size:12px" onchange="_overlayChange(${idx},'action',this.value)">
        <option value="accept"  ${h.action==='accept' ?'selected':''}>Accept</option>
        <option value="dismiss" ${h.action==='dismiss'?'selected':''}>Dismiss</option>
      </select>
      <input class="fm-input" style="flex:1;font-size:12px;display:${showText?'block':'none'}" placeholder="Prompt text (optional)"
             value="${escHtml(h.text||'')}" oninput="_overlayChange(${idx},'text',this.value)" />
      <button class="tbl-btn del" onclick="_overlayRemove(${idx})" title="Remove">✕</button>
    `;
    listEl.appendChild(row);
  });
}

function _overlayInit(handlers) {
  _overlayHandlers = (handlers || []).map(h => ({ type: h.type || 'any', action: h.action || 'accept', text: h.text || '' }));
  _overlayRender();
}

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
  execLoad(); // keep execution tab suite dropdown in sync
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
    <div class="suite-card">
      <div class="suite-card-header">
        <div style="flex:1">
          <div class="suite-name">${escHtml(s.name)}</div>
          ${s.description ? `<div style="font-size:12.5px;color:var(--neutral-500);margin-top:3px">${escHtml(s.description)}</div>` : ''}
          <div class="suite-meta">${(s.scriptIds||[]).length} script${(s.scriptIds||[]).length !== 1 ? 's' : ''} · By ${escHtml(s.createdBy || '—')} · ${formatDate(s.createdAt)}</div>
        </div>
        <div style="flex-shrink:0;display:flex;gap:6px;align-items:center">
          ${isViewer() ? '' : `<button class="tbl-btn" onclick="suiteEditById('${escHtml(s.id)}')">Edit</button>`}
          ${isViewer() ? '' : `<button class="tbl-btn del" onclick="suiteDelete('${escHtml(s.id)}','${escHtml(s.name)}')">Delete</button>`}
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

// ── Suite Modal — state ───────────────────────────────────────────────────────
let _smSelectedIds  = [];   // ordered list of selected script ids (Zone B)
let _smCheckedIds   = new Set(); // checkboxes ticked in Zone A (for bulk-add)
let _smPage         = 1;
let _smPageSize     = 10;
let _smSortCol      = 'tcid';
let _smSortDir      = 'asc';  // 'asc' | 'desc'
let _smFiltered     = [];   // filtered+sorted slice of allScripts for Zone A

// ── Helpers ───────────────────────────────────────────────────────────────────
function _smTcId(s) { return s.tcId || s.id || ''; }

function _smApplyFilter() {
  const qTcid  = (document.getElementById('sm-filter-tcid')?.value      ?? '').toLowerCase().trim();
  const qTitle = (document.getElementById('sm-filter-title')?.value     ?? '').toLowerCase().trim();
  const qComp  = (document.getElementById('sm-filter-component')?.value ?? '').toLowerCase().trim();
  const qTag   = (document.getElementById('sm-filter-tag')?.value       ?? '').toLowerCase().trim();
  let list = allScripts.filter(s => {
    if (qTcid  && !(_smTcId(s)).toLowerCase().includes(qTcid))         return false;
    if (qTitle && !(s.title     || '').toLowerCase().includes(qTitle))  return false;
    if (qComp  && !(s.component || '').toLowerCase().includes(qComp))   return false;
    if (qTag   && !(s.tag       || '').toLowerCase().includes(qTag))    return false;
    return true;
  });
  // Sort
  list.sort((a, b) => {
    let va, vb;
    if (_smSortCol === 'tcid')      { va = _smTcId(a);     vb = _smTcId(b); }
    else if (_smSortCol === 'title')     { va = a.title     || ''; vb = b.title     || ''; }
    else if (_smSortCol === 'component') { va = a.component || ''; vb = b.component || ''; }
    else                                 { va = _smTcId(a);        vb = _smTcId(b); }
    const cmp = va.localeCompare(vb, undefined, { numeric: true });
    return _smSortDir === 'asc' ? cmp : -cmp;
  });
  _smFiltered = list;
  _smPage = 1;  // reset to first page on filter/sort change
}

function _smRenderSortIndicators() {
  ['tcid','title','component'].forEach(col => {
    const el = document.getElementById(`sm-sort-${col}`);
    if (!el) return;
    if (col === _smSortCol) el.textContent = _smSortDir === 'asc' ? '▲' : '▼';
    else el.textContent = '';
  });
}

function _smRenderZoneA() {
  const el = document.getElementById('sm-script-list');
  if (!el) return;

  const totalPages = Math.max(1, Math.ceil(_smFiltered.length / _smPageSize));
  if (_smPage > totalPages) _smPage = totalPages;
  const start = (_smPage - 1) * _smPageSize;
  const page  = _smFiltered.slice(start, start + _smPageSize);

  // Count label
  const countEl = document.getElementById('sm-script-count');
  if (countEl) countEl.textContent = `${_smFiltered.length} script${_smFiltered.length !== 1 ? 's' : ''}`;

  // Pagination controls
  const prevBtn = document.getElementById('sm-prev-btn');
  const nextBtn = document.getElementById('sm-next-btn');
  const pageLabel = document.getElementById('sm-page-label');
  if (prevBtn)  prevBtn.disabled  = _smPage <= 1;
  if (nextBtn)  nextBtn.disabled  = _smPage >= totalPages;
  if (pageLabel) pageLabel.textContent = `Page ${_smPage} of ${totalPages}`;

  if (!page.length) {
    el.innerHTML = `<div style="padding:12px 10px;color:var(--neutral-400);font-size:13px;text-align:center">${allScripts.length ? 'No scripts match the search.' : 'No scripts in this project yet.'}</div>`;
    _smUpdateBulkBar();
    return;
  }

  const selectedSet = new Set(_smSelectedIds);
  // Remove checked ids that are no longer on the current page (page changed / filter changed)
  const pageIds = new Set(page.map(s => s.id));
  _smCheckedIds = new Set([..._smCheckedIds].filter(id => pageIds.has(id)));

  el.innerHTML = page.map(s => {
    const already  = selectedSet.has(s.id);
    const checked  = _smCheckedIds.has(s.id);
    return `<div style="display:grid;grid-template-columns:32px 110px 1fr 130px 110px;align-items:center;border-bottom:1px solid var(--neutral-100);${already ? 'opacity:.45;' : ''}"
                 onmouseover="this.style.background='var(--brand-light)'" onmouseout="this.style.background=''">
      <div style="padding:7px 8px;display:flex;align-items:center;justify-content:center">
        <input type="checkbox" class="sm-row-chk" data-id="${escHtml(s.id)}"
               ${checked ? 'checked' : ''} ${already ? 'disabled' : ''}
               onchange="smRowCheckChange(this)" />
      </div>
      <div style="padding:7px 10px;font-size:12px;color:var(--neutral-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(_smTcId(s))}</div>
      <div style="padding:7px 10px;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.title)}">${escHtml(s.title)}</div>
      <div style="padding:7px 10px;font-size:12px;color:var(--neutral-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.component || '—')}</div>
      <div style="padding:7px 10px;font-size:12px;color:var(--neutral-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.tag || '—')}</div>
    </div>`;
  }).join('');

  // Sync select-all checkbox state
  const allChk = document.getElementById('sm-chk-all');
  if (allChk) {
    const available = page.filter(s => !selectedSet.has(s.id));
    const checkedCount = available.filter(s => _smCheckedIds.has(s.id)).length;
    allChk.checked       = available.length > 0 && checkedCount === available.length;
    allChk.indeterminate = checkedCount > 0 && checkedCount < available.length;
  }
  _smUpdateBulkBar();
}

let _smbCheckedIds = new Set(); // checkboxes ticked in Zone B (for bulk-remove)

function _smbUpdateBulkBar() {
  const bar     = document.getElementById('smb-bulk-bar');
  const countEl = document.getElementById('smb-bulk-count');
  const n = _smbCheckedIds.size;
  if (!bar) return;
  if (n > 0) {
    bar.style.display = 'flex';
    if (countEl) countEl.textContent = `${n} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function smbRowCheckChange(chk) {
  const id = chk.dataset.id;
  if (chk.checked) _smbCheckedIds.add(id);
  else             _smbCheckedIds.delete(id);
  // Sync select-all checkbox
  const allChk = document.getElementById('smb-chk-all');
  if (allChk) {
    const n = _smSelectedIds.length;
    const checked = _smbCheckedIds.size;
    allChk.checked       = n > 0 && checked === n;
    allChk.indeterminate = checked > 0 && checked < n;
  }
  _smbUpdateBulkBar();
}

function smbToggleSelectAll() {
  const allChk = document.getElementById('smb-chk-all');
  if (allChk?.checked) {
    _smSelectedIds.forEach(id => _smbCheckedIds.add(id));
  } else {
    _smbCheckedIds.clear();
  }
  document.querySelectorAll('#sm-selected-list .smb-row-chk').forEach(chk => {
    chk.checked = _smbCheckedIds.has(chk.dataset.id);
  });
  _smbUpdateBulkBar();
}

function smbRemoveSelected() {
  if (!_smbCheckedIds.size) return;
  _smSelectedIds = _smSelectedIds.filter(id => !_smbCheckedIds.has(id));
  _smbCheckedIds.clear();
  _smRenderZoneA();  // re-enable Add buttons for removed scripts
  _smRenderZoneB();
}

function smbDeselectAll() {
  _smbCheckedIds.clear();
  document.querySelectorAll('#sm-selected-list .smb-row-chk').forEach(chk => { chk.checked = false; });
  const allChk = document.getElementById('smb-chk-all');
  if (allChk) { allChk.checked = false; allChk.indeterminate = false; }
  _smbUpdateBulkBar();
}

function _smRenderZoneB() {
  const el    = document.getElementById('sm-selected-list');
  const empty = document.getElementById('sm-selected-empty');
  const countEl = document.getElementById('sm-selected-count');
  if (!el) return;
  if (countEl) countEl.textContent = _smSelectedIds.length ? `(${_smSelectedIds.length})` : '';

  if (!_smSelectedIds.length) {
    _smbCheckedIds.clear();
    _smbUpdateBulkBar();
    if (empty) empty.style.display = '';
    [...el.children].forEach(c => { if (c.id !== 'sm-selected-empty') c.remove(); });
    return;
  }
  if (empty) empty.style.display = 'none';

  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  const n = _smSelectedIds.length;
  const checkedCount = [..._smbCheckedIds].filter(id => _smSelectedIds.includes(id)).length;

  el.innerHTML =
    // Select-all header row
    `<div id="sm-selected-empty" style="display:none"></div>
     <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--neutral-50);border-bottom:1px solid var(--neutral-200);border-radius:4px 4px 0 0">
       <input type="checkbox" id="smb-chk-all" title="Select / deselect all"
              ${checkedCount === n ? 'checked' : ''}
              onchange="smbToggleSelectAll()" />
       <span style="font-size:11.5px;color:var(--neutral-500);flex:1">Select all</span>
     </div>` +
    _smSelectedIds.map((id, idx) => {
      const s = scriptMap[id];
      if (!s) return '';
      const isFirst   = idx === 0;
      const isLast    = idx === n - 1;
      const isChecked = _smbCheckedIds.has(id);
      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--neutral-100);${isChecked ? 'background:var(--red-50,#fff1f2);' : ''}">
        <input type="checkbox" class="smb-row-chk" data-id="${escHtml(id)}"
               ${isChecked ? 'checked' : ''} onchange="smbRowCheckChange(this)" />
        <span style="font-size:12px;color:var(--neutral-400);min-width:22px;text-align:right">${idx + 1}</span>
        <span style="font-size:12px;color:var(--neutral-500);min-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(_smTcId(s))}</span>
        <span style="flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.title)}">${escHtml(s.title)}</span>
        <button class="tbl-btn" title="Move up"   ${isFirst ? 'disabled' : ''} onclick="smMoveScript(${idx},-1)">↑</button>
        <button class="tbl-btn" title="Move down" ${isLast  ? 'disabled' : ''} onclick="smMoveScript(${idx}, 1)">↓</button>
        <button class="tbl-btn del" title="Remove" onclick="smRemoveScript('${escHtml(id)}')">×</button>
      </div>`;
    }).join('');

  // Set indeterminate state if partially selected
  const allChk = document.getElementById('smb-chk-all');
  if (allChk) {
    allChk.checked       = checkedCount === n && n > 0;
    allChk.indeterminate = checkedCount > 0 && checkedCount < n;
  }
  _smbUpdateBulkBar();
}

function smAddScript(id) {
  if (_smSelectedIds.includes(id)) return;
  _smSelectedIds.push(id);
  _smCheckedIds.delete(id);
  _smRenderZoneA();
  _smRenderZoneB();
}

function smRowCheckChange(chk) {
  const id = chk.dataset.id;
  if (chk.checked) _smCheckedIds.add(id);
  else             _smCheckedIds.delete(id);
  _smUpdateBulkBar();
  // sync select-all checkbox
  const selectedSet = new Set(_smSelectedIds);
  const start  = (_smPage - 1) * _smPageSize;
  const page   = _smFiltered.slice(start, start + _smPageSize);
  const available = page.filter(s => !selectedSet.has(s.id));
  const checkedCount = available.filter(s => _smCheckedIds.has(s.id)).length;
  const allChk = document.getElementById('sm-chk-all');
  if (allChk) {
    allChk.checked       = available.length > 0 && checkedCount === available.length;
    allChk.indeterminate = checkedCount > 0 && checkedCount < available.length;
  }
}

function smToggleSelectAll() {
  const allChk = document.getElementById('sm-chk-all');
  const selectedSet = new Set(_smSelectedIds);
  const start  = (_smPage - 1) * _smPageSize;
  const page   = _smFiltered.slice(start, start + _smPageSize);
  const available = page.filter(s => !selectedSet.has(s.id));
  if (allChk?.checked) {
    available.forEach(s => _smCheckedIds.add(s.id));
  } else {
    available.forEach(s => _smCheckedIds.delete(s.id));
  }
  // Re-render checkboxes without rebuilding the full table
  document.querySelectorAll('#sm-script-list .sm-row-chk').forEach(chk => {
    const id = chk.dataset.id;
    if (!chk.disabled) chk.checked = _smCheckedIds.has(id);
  });
  _smUpdateBulkBar();
}

function smAddSelected() {
  const toAdd = [..._smCheckedIds].filter(id => !_smSelectedIds.includes(id));
  toAdd.forEach(id => _smSelectedIds.push(id));
  _smCheckedIds.clear();
  _smRenderZoneA();
  _smRenderZoneB();
}

function smDeselectAll() {
  _smCheckedIds.clear();
  document.querySelectorAll('#sm-script-list .sm-row-chk').forEach(chk => { if (!chk.disabled) chk.checked = false; });
  const allChk = document.getElementById('sm-chk-all');
  if (allChk) { allChk.checked = false; allChk.indeterminate = false; }
  _smUpdateBulkBar();
}

function _smUpdateBulkBar() {
  const bar      = document.getElementById('sm-bulk-bar');
  const countEl  = document.getElementById('sm-bulk-count');
  const n = _smCheckedIds.size;
  if (!bar) return;
  if (n > 0) {
    bar.style.display = 'flex';
    if (countEl) countEl.textContent = `${n} script${n !== 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function smRemoveScript(id) {
  _smSelectedIds = _smSelectedIds.filter(x => x !== id);
  _smbCheckedIds.delete(id);
  _smRenderZoneA();
  _smRenderZoneB();
}

function smMoveScript(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= _smSelectedIds.length) return;
  const arr = [..._smSelectedIds];
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  _smSelectedIds = arr;
  _smRenderZoneB();
}

function smSort(col) {
  if (_smSortCol === col) _smSortDir = _smSortDir === 'asc' ? 'desc' : 'asc';
  else { _smSortCol = col; _smSortDir = 'asc'; }
  _smApplyFilter();
  _smRenderSortIndicators();
  _smRenderZoneA();
}

function smScriptSearch() {
  _smApplyFilter();
  _smRenderZoneA();
}

function smPagePrev() { if (_smPage > 1) { _smPage--; _smRenderZoneA(); } }
function smPageNext() {
  const totalPages = Math.max(1, Math.ceil(_smFiltered.length / _smPageSize));
  if (_smPage < totalPages) { _smPage++; _smRenderZoneA(); }
}
function smPageSizeChange() {
  const sel = document.getElementById('sm-page-size');
  _smPageSize = parseInt(sel?.value || '10', 10);
  _smPage = 1;
  _smRenderZoneA();
}

// ── Open / Edit modal ─────────────────────────────────────────────────────────
function smClearFilters() {
  ['sm-filter-tcid','sm-filter-title','sm-filter-component','sm-filter-tag'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  smScriptSearch();
}

function _smInit(selectedIds) {
  _smSelectedIds = [...selectedIds];
  _smCheckedIds  = new Set();
  _smbCheckedIds = new Set();
  _smPage     = 1;
  _smPageSize = 10;
  _smSortCol  = 'tcid';
  _smSortDir  = 'asc';
  ['sm-filter-tcid','sm-filter-title','sm-filter-component','sm-filter-tag'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const pageSizeSel = document.getElementById('sm-page-size');
  if (pageSizeSel) pageSizeSel.value = '10';
  _smApplyFilter();
  _smRenderSortIndicators();
  _smRenderZoneA();
  _smRenderZoneB();
}

function suiteOpenModal(id = null) {
  editingSuiteId = id;
  currentSuiteId = null;
  modClearAlert('suite-modal-alert');
  document.getElementById('suite-modal-title').textContent = id ? 'Edit Test Suite' : 'New Test Suite';
  if (!id) {
    document.getElementById('sm-name').value = '';
    document.getElementById('sm-desc').value = '';
    document.getElementById('sm-retries').value = '0';
    // Reset browser checkboxes — Chromium on by default
    ['chromium', 'firefox', 'webkit'].forEach(b => {
      const cb = document.getElementById(`sm-browser-${b}`);
      if (cb) cb.checked = b === 'chromium';
    });
    // Hide schedules for new suites (no ID yet)
    const schedWrap = document.getElementById('sm-sched-wrap');
    if (schedWrap) schedWrap.style.display = 'none';
    _hookInit([], [], false, []);
    _overlayInit([]);
  }
  _populateEnvDropdown('');
  _smInit(id ? (allSuites.find(x => x.id === id)?.scriptIds || []) : []);
  openModal('modal-suite');
}

async function suiteEditById(id) {
  const s = allSuites.find(x => x.id === id);
  if (!s) return;
  editingSuiteId = id;
  currentSuiteId = id;
  document.getElementById('suite-modal-title').textContent = 'Edit Test Suite';
  document.getElementById('sm-name').value = s.name;
  document.getElementById('sm-desc').value = s.description || '';
  document.getElementById('sm-retries').value = String(s.retries ?? 0);
  _populateEnvDropdown(s.environmentId || '');
  // Load browser checkboxes
  const savedBrowsers = s.browsers && s.browsers.length > 0 ? s.browsers : ['chromium'];
  ['chromium', 'firefox', 'webkit'].forEach(b => {
    const cb = document.getElementById(`sm-browser-${b}`);
    if (cb) cb.checked = savedBrowsers.includes(b);
  });
  modClearAlert('suite-modal-alert');
  _smInit(s.scriptIds || []);
  _hookInit(s.beforeEachSteps || [], s.afterEachSteps || [], s.fastMode || false, s.fastModeSteps || []);
  _overlayInit(s.overlayHandlers || []);

  // Show and load schedules section (edit only)
  const schedWrap = document.getElementById('sm-sched-wrap');
  if (schedWrap) {
    schedWrap.style.display = '';
    // Populate sched-env from project environments
    const project = allProjects.find(p => p.id === currentProjectId);
    const schedEnvSel = document.getElementById('sched-env');
    if (schedEnvSel && project) {
      const envs = project.environments || [];
      schedEnvSel.innerHTML = '<option value="">— Select —</option>' +
        envs.map(e => `<option value="${escHtml(e.id)}"${e.id === s.environmentId ? ' selected' : ''}>${escHtml(e.name)}</option>`).join('');
    }
    schedFormHide();
    await schedLoad();
  }

  openModal('modal-suite');
}

// Legacy alias kept so any other callers still work
function suiteScriptFilterRender() { smScriptSearch(); }

async function suiteSave() {
  modClearAlert('suite-modal-alert');
  const name = document.getElementById('sm-name').value.trim();
  if (!name)             { modAlert('suite-modal-alert', 'error', 'Suite name is required'); return; }
  if (!currentProjectId) { modAlert('suite-modal-alert', 'error', 'Select a project first'); return; }
  const scriptIds     = [..._smSelectedIds];   // Zone B order is authoritative
  const environmentId = document.getElementById('sm-env')?.value || null;
  const retries = parseInt(document.getElementById('sm-retries')?.value || '0', 10);
  const selectedBrowsers = ['chromium', 'firefox', 'webkit']
    .filter(b => document.getElementById(`sm-browser-${b}`)?.checked);
  const body = {
    projectId: currentProjectId, name,
    description:   document.getElementById('sm-desc').value.trim(),
    scriptIds,
    environmentId: environmentId || null,
    retries:       [0,1,2].includes(retries) ? retries : 0,
    browsers:      selectedBrowsers.length > 0 ? selectedBrowsers : ['chromium'],
    beforeEachSteps: _hookBefore.map((s, i)   => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    afterEachSteps:  _hookAfter.map((s, i)    => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    fastMode:        !!(document.getElementById('sm-fast-mode')?.checked),
    fastModeSteps:   _hookFastMode.map((s, i) => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    overlayHandlers: _overlayHandlers.map(h => ({ type: h.type, action: h.action, text: h.text || '' })),
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

function suiteCloseModal() { closeModal('modal-suite'); editingSuiteId = null; currentSuiteId = null; }

// suiteOpenDetail removed — suite detail overlay is no longer used.
// Schedules are now loaded inside the Edit Suite modal via _schedLoadForModal().

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

// suite detail overlay functions removed — use Execution tab to run suites.

// ══════════════════════════════════════════════════════════════════════════════
// Execution Module
// ══════════════════════════════════════════════════════════════════════════════

let _execLastRunId   = null;   // last runId launched from Execution tab
let _execPollTimer   = null;
let _execPollStopped = false;

async function execLoad() {
  const noProj  = document.getElementById('exec-no-project');
  const body    = document.getElementById('exec-body');
  const suiteSel = document.getElementById('exec-suite-sel');
  if (!suiteSel) return;

  if (!currentProjectId) {
    if (noProj) noProj.style.display = '';
    if (body)   body.style.display   = 'none';
    return;
  }
  if (noProj) noProj.style.display = 'none';
  if (body)   body.style.display   = '';

  // Populate suite dropdown
  const suites = allSuites.filter(s => s.projectId === currentProjectId)
    .sort((a, b) => a.name.localeCompare(b.name));
  suiteSel.innerHTML = '<option value="">— Select Suite —</option>' +
    suites.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');

  // Reset env dropdown
  document.getElementById('exec-env-sel').innerHTML = '<option value="">— Select Environment —</option>';

  // Hide scripts, disable run, hide report
  document.getElementById('exec-scripts-wrap').style.display = 'none';
  document.getElementById('exec-run-btn').disabled = true;
  document.getElementById('exec-report-btn').style.display = 'none';
  document.getElementById('exec-progress-wrap').style.display = 'none';
  document.getElementById('exec-run-hint').textContent = 'Select a suite and environment to run';
}

function execOnSuiteChange() {
  const suiteId  = document.getElementById('exec-suite-sel')?.value;
  const envSel   = document.getElementById('exec-env-sel');
  const scriptsWrap = document.getElementById('exec-scripts-wrap');
  const scriptList  = document.getElementById('exec-script-list');
  const countEl     = document.getElementById('exec-script-count');
  const runBtn      = document.getElementById('exec-run-btn');
  const hintEl      = document.getElementById('exec-run-hint');

  if (!suiteId) {
    envSel.innerHTML = '<option value="">— Select Environment —</option>';
    scriptsWrap.style.display = 'none';
    runBtn.disabled = true;
    hintEl.textContent = 'Select a suite and environment to run';
    return;
  }

  const suite   = allSuites.find(s => s.id === suiteId);
  const project = allProjects.find(p => p.id === currentProjectId);
  const envs    = project?.environments || [];

  // Populate environment dropdown
  envSel.innerHTML = '<option value="">— Select Environment —</option>' +
    envs.map(e => `<option value="${escHtml(e.id)}"${e.id === suite?.environmentId ? ' selected' : ''}>${escHtml(e.name)} — ${escHtml(e.url)}</option>`).join('');

  // Show scripts
  const scriptIds = suite?.scriptIds || [];
  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  const scripts   = scriptIds.map(id => scriptMap[id]).filter(Boolean);

  if (countEl) countEl.textContent = `(${scripts.length})`;

  if (!scripts.length) {
    scriptList.innerHTML = '<div style="padding:12px 10px;color:var(--neutral-400);font-size:13px;text-align:center">No scripts in this suite.</div>';
  } else {
    scriptList.innerHTML = scripts.map((s, idx) => `
      <div style="display:grid;grid-template-columns:32px 90px 1fr 80px;align-items:center;border-bottom:1px solid var(--neutral-100)">
        <div style="padding:7px 8px;font-size:12px;color:var(--neutral-400)">${idx + 1}</div>
        <div style="padding:7px 8px;font-size:12px;color:var(--neutral-500)">${escHtml(_smTcId(s))}</div>
        <div style="padding:7px 8px;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.title)}">${escHtml(s.title)}</div>
        <div style="padding:7px 8px;font-size:12px;color:var(--neutral-400)">${s.steps.length} steps</div>
      </div>`).join('');
  }
  scriptsWrap.style.display = '';

  // Update run button state
  _execUpdateRunBtn();
}

function _execUpdateRunBtn() {
  const suiteId = document.getElementById('exec-suite-sel')?.value;
  const envId   = document.getElementById('exec-env-sel')?.value;
  const runBtn  = document.getElementById('exec-run-btn');
  const hintEl  = document.getElementById('exec-run-hint');
  const ready   = !!(suiteId && envId);
  runBtn.disabled = !ready;
  hintEl.textContent = ready ? '' : (!suiteId ? 'Select a suite first' : 'Select an environment to run');
}

async function execRun() {
  const suiteId = document.getElementById('exec-suite-sel')?.value;
  const envId   = document.getElementById('exec-env-sel')?.value;
  if (!suiteId || !envId) { alert('Select a suite and environment first.'); return; }

  // Stop any previous poll
  _execPollStopped = true;
  clearTimeout(_execPollTimer);

  const runBtn    = document.getElementById('exec-run-btn');
  const reportBtn = document.getElementById('exec-report-btn');
  const progressWrap = document.getElementById('exec-progress-wrap');
  const statusEl  = document.getElementById('exec-run-status');
  const metaEl    = document.getElementById('exec-run-meta');
  const progressBar = document.getElementById('exec-progress-bar');
  const resultsTable = document.getElementById('exec-results-table');
  const resultsBody  = document.getElementById('exec-results-body');
  const summaryEl    = document.getElementById('exec-summary');

  runBtn.disabled = true;
  runBtn.innerHTML = '⏳ Starting…';
  reportBtn.style.display = 'none';
  progressWrap.style.display = '';
  resultsTable.style.display = 'none';
  resultsBody.innerHTML = '';
  summaryEl.style.display = 'none';
  if (statusEl)  statusEl.textContent = '⏳ Starting…';
  if (metaEl)    metaEl.textContent   = '';
  if (progressBar) progressBar.style.width = '0%';

  const res  = await fetch(`/api/suites/${suiteId}/run`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ environmentId: envId }),
  });
  const data = await res.json();
  if (!res.ok) {
    runBtn.disabled = false;
    runBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Suite';
    if (statusEl) statusEl.textContent = '✗ Failed to start';
    return;
  }

  const { runId } = data;
  _execLastRunId   = runId;
  _execPollStopped = false;

  // Render known tests as pending immediately
  const suite     = allSuites.find(s => s.id === suiteId);
  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  const scripts   = (suite?.scriptIds || []).map(id => scriptMap[id]).filter(Boolean);

  function _execRenderResultsTable(tests) {
    if (!tests?.length && !scripts.length) return;
    resultsTable.style.display = '';
    const rows = tests?.length
      ? tests.map(t => {
          const colour = t.status === 'pass' ? '#4ec9b0' : '#f48771';
          const icon   = t.status === 'pass' ? '✓' : '✗';
          const dur    = t.durationMs != null ? `${(t.durationMs / 1000).toFixed(1)}s` : '';
          return `<div style="display:grid;grid-template-columns:1fr 90px 80px;border-bottom:1px solid var(--neutral-100)">
            <div style="padding:7px 10px;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.name)}">${escHtml(t.name)}</div>
            <div style="padding:7px 10px;font-size:12px;font-weight:700;color:${colour}">${icon} ${t.status}</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">${dur}</div>
          </div>`;
        }).join('')
      : scripts.map(s => `
          <div style="display:grid;grid-template-columns:1fr 90px 80px;border-bottom:1px solid var(--neutral-100);opacity:.5">
            <div style="padding:7px 10px;font-size:12.5px">${escHtml(s.title)}</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">pending</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">—</div>
          </div>`).join('');
    resultsBody.innerHTML = rows;
  }

  _execRenderResultsTable(null);

  async function execPoll() {
    if (_execPollStopped) return;
    try {
      const r   = await fetch(`/api/run/${runId}`);
      if (!r.ok) { _execPollTimer = setTimeout(execPoll, 1500); return; }
      const rec = await r.json();

      const total  = rec.total  || scripts.length || 1;
      const done   = (rec.passed || 0) + (rec.failed || 0);
      const pct    = Math.min(100, Math.round((done / total) * 100));
      if (progressBar) progressBar.style.width = `${pct}%`;
      if (metaEl) metaEl.textContent = rec.status === 'running' ? `${done} / ${total}` : '';

      if (rec.tests?.length) _execRenderResultsTable(rec.tests);

      if (rec.status === 'running' || rec.status === 'queued' || !rec.status) {
        if (statusEl) statusEl.textContent = rec.status === 'queued' ? '⏳ Queued…' : '⏳ Running…';
        // P4: poll for T4 heal proposal — spec pauses and writes pending-heal.json
        fetch(`/api/debug/heal-pending?runId=${encodeURIComponent(runId)}`)
          .then(r => r.ok ? r.json() : null)
          .then(proposal => {
            if (proposal) showT4ProposalCard(proposal, runId);
            else hideT4ProposalCard();
          }).catch(() => {});
        // P5-E: poll for prescan health results (written by spec beforeAll)
        fetch(`/api/prescan?runId=${encodeURIComponent(runId)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.locators?.length) renderPrescanHealth(data); })
          .catch(() => {});
        _execPollTimer = setTimeout(execPoll, 1500);
        return;
      }

      // Finished
      _execPollStopped = true;
      if (progressBar) progressBar.style.width = '100%';
      const p = rec.passed || 0, f = rec.failed || 0;
      const ok = f === 0 && rec.exitCode === 0;
      if (statusEl) statusEl.textContent = ok ? `✓ Passed — ${p} tests` : `✗ Done — ${p} passed, ${f} failed`;
      summaryEl.style.display = '';
      summaryEl.innerHTML = `<strong style="color:${ok ? 'var(--green-600,#16a34a)' : 'var(--red-600,#dc2626)'}">${p} passed</strong> · <strong style="color:${f ? 'var(--red-600,#dc2626)' : 'inherit'}">${f} failed</strong> · ${rec.total || 0} total`;

      if (rec.tests?.length) _execRenderResultsTable(rec.tests);

      runBtn.disabled = false;
      runBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Suite';
      reportBtn.style.display = '';

      // Refresh history badge
      if (typeof histLoad === 'function') histLoad();

    } catch { _execPollTimer = setTimeout(execPoll, 2000); }
  }

  execPoll();
}

function execViewReport() {
  if (_execLastRunId) window.open(`/execution-report?runId=${encodeURIComponent(_execLastRunId)}`, '_blank');
}

// ── P5-E: Pre-Scan Health Grid ────────────────────────────────────────────────
function renderPrescanHealth(data) {
  const wrap    = document.getElementById('exec-prescan-wrap');
  const grid    = document.getElementById('exec-prescan-grid');
  const pageEl  = document.getElementById('exec-prescan-page');
  const sumEl   = document.getElementById('exec-prescan-summary');
  if (!wrap || !grid) return;

  const locators = data.locators || [];
  const healthy  = locators.filter(l => l.status === 'healthy').length;
  const degraded = locators.filter(l => l.status === 'degraded').length;
  const broken   = locators.filter(l => l.status === 'broken').length;

  if (pageEl) pageEl.textContent = data.pageKey || '';
  if (sumEl)  sumEl.innerHTML =
    `<span class="ps-chip ps-healthy">${healthy} healthy</span>` +
    (degraded ? `<span class="ps-chip ps-degraded">${degraded} degraded</span>` : '') +
    (broken   ? `<span class="ps-chip ps-broken">${broken} broken</span>`   : '');

  grid.innerHTML = locators.map(l => {
    const icon  = l.status === 'healthy' ? '🟢' : l.status === 'degraded' ? '🟡' : '🔴';
    const score = l.score != null ? `${Math.round(l.score)}%` : '—';
    const barW  = Math.max(0, Math.min(100, Math.round(l.score || 0)));
    const barC  = l.status === 'healthy' ? '#4ec9b0' : l.status === 'degraded' ? '#eab308' : '#f48771';
    return `<div class="ps-row">
      <span class="ps-icon">${icon}</span>
      <span class="ps-name" title="${escHtml(l.selector || '')}">${escHtml(l.name)}</span>
      <div class="ps-bar-wrap"><div class="ps-bar" style="width:${barW}%;background:${barC}"></div></div>
      <span class="ps-score" style="color:${barC}">${score}</span>
    </div>`;
  }).join('');

  wrap.style.display = '';
}

// ── P5-F: Validate Locators (manual prescan trigger) ─────────────────────────
async function validateLocators() {
  if (!currentProjectId) { alert('Select a project first.'); return; }

  // Build env URL list from current project
  const proj = (window._allProjects || []).find(p => p.id === currentProjectId);
  const envs = proj?.environments || [];
  const modal = document.getElementById('prescan-modal');
  if (!modal) return;

  // Populate env dropdown
  const sel = document.getElementById('prescan-env-sel');
  if (sel) {
    if (envs.length) {
      sel.innerHTML = envs.map(e => `<option value="${escHtml(e.url)}">${escHtml(e.name)} — ${escHtml(e.url)}</option>`).join('');
    } else {
      const fallbackUrl = proj?.appUrl || '';
      sel.innerHTML = `<option value="${escHtml(fallbackUrl)}">${escHtml(fallbackUrl || 'Project URL')}</option>`;
    }
  }

  document.getElementById('prescan-results').innerHTML = '';
  document.getElementById('prescan-results-wrap').style.display = 'none';
  modal.style.display = 'flex';
}

function prescanModalClose() {
  const modal = document.getElementById('prescan-modal');
  if (modal) modal.style.display = 'none';
}

async function prescanRun() {
  const sel = document.getElementById('prescan-env-sel');
  const url = sel?.value?.trim();
  if (!url) { alert('Select an environment URL.'); return; }

  const runBtn = document.getElementById('prescan-run-btn');
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = 'Scanning…'; }

  try {
    const res = await fetch('/api/prescan-trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: currentProjectId, url }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Prescan failed'); return; }
    const { scanId } = await res.json();

    // Poll for results
    const poll = async () => {
      const r = await fetch(`/api/prescan?runId=${encodeURIComponent(scanId)}`).catch(() => null);
      if (!r?.ok) { setTimeout(poll, 1500); return; }
      const data = await r.json().catch(() => null);
      if (!data) { setTimeout(poll, 1500); return; }

      // Render in modal
      const wrap = document.getElementById('prescan-results-wrap');
      const grid = document.getElementById('prescan-results');
      if (!grid || !wrap) return;

      const locators = data.locators || [];
      grid.innerHTML = locators.length
        ? locators.map(l => {
            const icon  = l.status === 'healthy' ? '🟢' : l.status === 'degraded' ? '🟡' : '🔴';
            const score = l.score != null ? `${Math.round(l.score)}%` : '—';
            const barW  = Math.max(0, Math.min(100, Math.round(l.score || 0)));
            const barC  = l.status === 'healthy' ? '#4ec9b0' : l.status === 'degraded' ? '#eab308' : '#f48771';
            return `<div class="ps-row">
              <span class="ps-icon">${icon}</span>
              <span class="ps-name" title="${escHtml(l.selector || '')}">${escHtml(l.name)}</span>
              <div class="ps-bar-wrap"><div class="ps-bar" style="width:${barW}%;background:${barC}"></div></div>
              <span class="ps-score" style="color:${barC}">${score}</span>
            </div>`;
          }).join('')
        : `<div style="color:var(--neutral-400);font-size:12px;padding:8px">No locators with healing profiles found for this page (${escHtml(data.pageKey || '')}). Record some interactions first.</div>`;
      wrap.style.display = '';
      if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Scan'; }
    };
    setTimeout(poll, 2000); // give Playwright a head start
  } catch { alert('Network error during prescan trigger'); if (runBtn) { runBtn.disabled = false; runBtn.textContent = 'Scan'; } }
}

// ── T4 Heal Proposal Card ─────────────────────────────────────────────────────
let _t4ActiveProposal = null;

function showT4ProposalCard(proposal, runId) {
  if (_t4ActiveProposal?.at === proposal.at) return; // already showing this one
  _t4ActiveProposal = { ...proposal, runId };

  const modal = document.getElementById('t4-heal-modal');
  if (!modal) return;

  // Populate fields
  const el = id => document.getElementById(id);
  if (el('t4-step-info'))  el('t4-step-info').textContent  = `Step ${proposal.stepOrder} — ${proposal.keyword}`;
  if (el('t4-tier-badge')) el('t4-tier-badge').textContent = proposal.isAssert ? 'ASSERT (forced T4)' : 'T3 score < 75';
  if (el('t4-old-sel'))    el('t4-old-sel').textContent    = proposal.oldSelector  || '(unknown — locator not found)';
  if (el('t4-cand-sel'))   el('t4-cand-sel').textContent   = proposal.candidateSelector || '(no candidate found)';
  if (el('t4-cand-type'))  el('t4-cand-type').textContent  = proposal.candidateSelectorType || '';
  if (el('t4-score'))      el('t4-score').textContent      = proposal.candidateSelector ? `${Math.round(proposal.score)}%` : '—';

  const approveBtn = el('t4-approve-btn');
  if (approveBtn) approveBtn.disabled = !proposal.candidateSelector;

  // Pre-fill override input with candidate selector
  const overrideInput = el('t4-override-sel');
  if (overrideInput) overrideInput.value = proposal.candidateSelector || '';
  const overrideType = el('t4-override-type');
  if (overrideType) overrideType.value = proposal.candidateSelectorType || 'css';

  modal.style.display = 'flex';
}

function hideT4ProposalCard() {
  _t4ActiveProposal = null;
  const modal = document.getElementById('t4-heal-modal');
  if (modal) modal.style.display = 'none';
}

async function respondT4Heal(action) {
  if (!_t4ActiveProposal) return;
  const p = _t4ActiveProposal;

  // On approve, use override input if user edited it
  let selector    = p.candidateSelector;
  let selectorType = p.candidateSelectorType || 'css';
  if (action === 'approve') {
    const overrideInput = document.getElementById('t4-override-sel');
    const overrideType  = document.getElementById('t4-override-type');
    if (overrideInput?.value?.trim()) selector     = overrideInput.value.trim();
    if (overrideType?.value?.trim())  selectorType = overrideType.value.trim();
    if (!selector) { alert('No candidate selector available — cannot approve. You can type one in the override field.'); return; }
  }

  try {
    const res = await fetch('/api/debug/heal-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId:          p.runId,
        action,
        selector:       action === 'approve' ? selector : undefined,
        selectorType:   action === 'approve' ? selectorType : undefined,
        locatorId:      p.locatorId,
        stepOrder:      p.stepOrder,
        keyword:        p.keyword,
        oldSelector:    p.oldSelector,
        oldSelectorType: p.candidateSelectorType,
        score:          p.score,
        projectId:      currentProjectId,
      }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to send response'); return; }
    hideT4ProposalCard();
  } catch { alert('Network error sending heal response'); }
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
    // Stop polling active debug sessions when leaving the scripts tab
    if (tab !== 'scripts') _debugSessionsPollStop();
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
    // Self-healing badge — only shown when at least 1 T2 heal occurred during this run
    const healBadge = (r.healCount && r.healCount > 0)
      ? `<span title="${r.healCount} step(s) auto-healed by T2 Alternatives Fallback" style="margin-left:5px;background:#7c3aed;color:#fff;border-radius:3px;padding:1px 5px;font-size:10px;cursor:default">🩹 Healed ${r.healCount}</span>`
      : '';
    // Derive browsers from test events (populated by parser) or from run record field
    const browserSet = new Set((r.tests || []).map(t => t.browser).filter(Boolean));
    if (r.browsers && Array.isArray(r.browsers)) r.browsers.forEach(b => browserSet.add(b));
    const browserIcons = { chromium: '🐛', firefox: '🦊', webkit: '🌍' };
    const browserLabel = browserSet.size > 0
      ? [...browserSet].map(b => `<span title="${b}" style="font-size:13px">${browserIcons[b] || b}</span>`).join(' ')
      : '<span style="color:var(--neutral-400);font-size:11px">chromium</span>';
    const compareCb = isDone
      ? `<input type="checkbox" class="hist-compare-chk" value="${escHtml(r.runId)}" onchange="histCompareSelChanged()" style="width:14px;height:14px;cursor:pointer" />`
      : `<span style="width:14px;display:inline-block"></span>`;
    return `<tr>
      <td style="text-align:center">${compareCb}</td>
      <td><code style="font-size:11px">${escHtml(shortId)}</code></td>
      <td>${suite}${healBadge}</td>
      <td>${statusBadge}</td>
      <td style="text-align:center">${r.total  || 0}</td>
      <td style="text-align:center;color:#4ec9b0">${r.passed || 0}</td>
      <td style="text-align:center;color:${r.failed ? '#f48771' : 'inherit'}">${r.failed || 0}</td>
      <td style="font-size:12px">${start}</td>
      <td style="font-size:12px">${end}</td>
      <td style="font-size:12px">${dur}</td>
      <td>${env}</td>
      <td>${by}</td>
      <td>${browserLabel}</td>
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

// ── Run Comparison ─────────────────────────────────────────────────────────────

function histCompareSelChanged() {
  const checked = [...document.querySelectorAll('.hist-compare-chk:checked')];
  const bar     = document.getElementById('hist-compare-bar');
  const countEl = document.getElementById('hist-compare-count');
  const btn     = document.getElementById('hist-compare-btn');
  if (!bar) return;
  bar.style.display  = checked.length > 0 ? 'flex' : 'none';
  countEl.textContent = `${checked.length} run${checked.length !== 1 ? 's' : ''} selected`;
  btn.disabled = checked.length !== 2;
}

function histClearCompare() {
  document.querySelectorAll('.hist-compare-chk').forEach(c => c.checked = false);
  histCompareSelChanged();
}

async function histCompare() {
  const ids = [...document.querySelectorAll('.hist-compare-chk:checked')].map(c => c.value);
  if (ids.length !== 2) return;
  // Fetch full run records
  const [r1, r2] = await Promise.all(ids.map(id =>
    fetch(`/api/run/${encodeURIComponent(id)}`).then(r => r.json())
  ));
  _histRenderComparison(r1, r2);
}

function _histRenderComparison(r1, r2) {
  const overlay = document.getElementById('run-compare-overlay');
  const body    = document.getElementById('run-compare-body');
  if (!overlay || !body) return;

  const fmtDate = s => s ? new Date(s).toLocaleString() : '—';
  const fmtDur  = (a, b) => {
    if (!a || !b) return '—';
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return ms < 60000 ? `${Math.round(ms/1000)}s` : `${Math.floor(ms/60000)}m ${Math.round((ms%60000)/1000)}s`;
  };
  const fmtMs = ms => !ms ? '—' : ms < 1000 ? `${ms}ms` : `${(ms/1000).toFixed(1)}s`;

  // Build test name → result maps
  const map1 = new Map((r1.tests || []).map(t => [t.name, t]));
  const map2 = new Map((r2.tests || []).map(t => [t.name, t]));
  const allNames = new Set([...map1.keys(), ...map2.keys()]);

  const newlyFailed = [], newlyPassed = [], durationChanged = [], stable = [], onlyInA = [], onlyInB = [];

  for (const name of allNames) {
    const t1 = map1.get(name);
    const t2 = map2.get(name);
    if (!t1) { onlyInB.push({ name, t: t2 }); continue; }
    if (!t2) { onlyInA.push({ name, t: t1 }); continue; }
    if (t1.status === 'pass' && t2.status === 'fail')      newlyFailed.push({ name, t1, t2 });
    else if (t1.status === 'fail' && t2.status === 'pass') newlyPassed.push({ name, t1, t2 });
    else {
      const durDiff = Math.abs((t2.durationMs || 0) - (t1.durationMs || 0));
      const durPct  = t1.durationMs > 0 ? (durDiff / t1.durationMs) * 100 : 0;
      if (durPct >= 50 && durDiff > 1000) durationChanged.push({ name, t1, t2, durDiff, durPct });
      else stable.push({ name, t1, t2 });
    }
  }

  // ── Section builder ──────────────────────────────────────────────────────
  const tblStyle = 'width:100%;border-collapse:collapse;font-size:12.5px;min-width:560px';
  const thStyle  = 'padding:9px 14px;text-align:left;background:#0f1318;color:#9ca3af;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #2d3748';
  const tdStyle  = 'padding:9px 14px;border-bottom:1px solid #1e2a38;vertical-align:top';

  const section = (title, icon, accentColor, rows, colDefs) => {
    if (!rows.length) return '';
    const ths = colDefs.map(c => `<th style="${thStyle}">${c}</th>`).join('');
    return `
      <div style="margin-bottom:24px;border-radius:10px;overflow:hidden;border:1px solid #2d3748">
        <div style="padding:12px 16px;background:#0f1318;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2d3748">
          <span style="font-size:16px">${icon}</span>
          <span style="font-size:13px;font-weight:700;color:${accentColor}">${title}</span>
          <span style="margin-left:auto;background:${accentColor}22;color:${accentColor};border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700">${rows.length}</span>
        </div>
        <div style="overflow-x:auto">
          <table style="${tblStyle}">
            <thead><tr>${ths}</tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>
      </div>`;
  };

  const statusChip = (status) => status === 'pass'
    ? `<span style="background:#052e16;color:#4ec9b0;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">✓ Pass</span>`
    : `<span style="background:#450a0a;color:#f48771;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600">✗ Fail</span>`;

  const failRows = newlyFailed.map(({name, t1, t2}) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip('pass')}</td>
    <td style="${tdStyle};text-align:center">${statusChip('fail')}</td>
    <td style="${tdStyle};color:#f87171;font-size:11px;max-width:240px;word-break:break-word">${escHtml((t2.errorMessage || 'No error captured').slice(0, 140))}</td>
  </tr>`);

  const passRows = newlyPassed.map(({name, t1, t2}) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip('fail')}</td>
    <td style="${tdStyle};text-align:center">${statusChip('pass')}</td>
    <td style="${tdStyle};color:#86efac;font-size:11px">Fixed ✓</td>
  </tr>`);

  const durRows = durationChanged.map(({name, t1, t2, durPct}) => {
    const slower = t2.durationMs > t1.durationMs;
    const arrow  = slower ? '▲' : '▼';
    const color  = slower ? '#f48771' : '#4ec9b0';
    return `<tr style="background:#1a1f26">
      <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
      <td style="${tdStyle};text-align:center;color:#9ca3af">${fmtMs(t1.durationMs)}</td>
      <td style="${tdStyle};text-align:center;color:#9ca3af">${fmtMs(t2.durationMs)}</td>
      <td style="${tdStyle};text-align:center;font-weight:700;color:${color}">${arrow} ${Math.round(durPct)}%</td>
    </tr>`;
  });

  const stableRows = stable.map(({name, t1, t2}) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#6b7280">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip(t1.status)}</td>
    <td style="${tdStyle};text-align:center">${statusChip(t2.status)}</td>
    <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">${fmtMs(t1.durationMs)} → ${fmtMs(t2.durationMs)}</td>
  </tr>`);

  const passRate = r => r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
  const prColor  = r => passRate(r) >= 90 ? '#4ec9b0' : passRate(r) >= 70 ? '#f6c543' : '#f48771';

  body.innerHTML = `
    <!-- Run header cards -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
      ${[r1, r2].map((r, i) => {
        const accent = i === 0 ? '#3b82f6' : '#8b5cf6';
        const pr = passRate(r);
        return `
        <div style="background:#0f1318;border-radius:10px;border:2px solid ${accent};padding:20px;position:relative;overflow:hidden">
          <div style="position:absolute;top:0;left:0;right:0;height:3px;background:${accent}"></div>
          <div style="font-size:10px;font-weight:800;letter-spacing:1.5px;color:${accent};margin-bottom:10px;text-transform:uppercase">Run ${i + 1}</div>
          <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:6px">&#128203; ${escHtml(r.suiteName || '—')}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:12px">
            <div style="font-size:11.5px;color:#6b7280">&#128197; ${fmtDate(r.startedAt)}</div>
            <div style="font-size:11.5px;color:#6b7280">&#9201; ${fmtDur(r.startedAt, r.finishedAt)}</div>
            <div style="font-size:11.5px;color:#6b7280">&#127758; ${escHtml(r.environmentName || '—')}</div>
            <div style="font-size:11.5px;color:#6b7280">&#128100; ${escHtml(r.executedBy || '—')}</div>
          </div>
          <div style="display:flex;align-items:center;gap:14px">
            <span style="color:#4ec9b0;font-size:18px;font-weight:800">✓ ${r.passed || 0}</span>
            <span style="color:#f48771;font-size:18px;font-weight:800">✗ ${r.failed || 0}</span>
            <span style="color:#6b7280;font-size:13px">/ ${r.total || 0} tests</span>
            <span style="margin-left:auto;font-size:20px;font-weight:800;color:${prColor(r)}">${pr}%</span>
          </div>
        </div>`;
      }).join('')}
    </div>

    <!-- Summary KPI chips -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:24px;padding:16px;background:#0f1318;border-radius:10px;border:1px solid #2d3748">
      <div style="display:flex;align-items:center;gap:8px;background:#450a0a;border:1px solid #7f1d1d;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">🔴</span>
        <div><div style="font-size:18px;font-weight:800;color:#f48771">${newlyFailed.length}</div><div style="font-size:10px;color:#fca5a5;text-transform:uppercase;letter-spacing:.5px">Newly Failed</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#052e16;border:1px solid #14532d;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">🟢</span>
        <div><div style="font-size:18px;font-weight:800;color:#4ec9b0">${newlyPassed.length}</div><div style="font-size:10px;color:#86efac;text-transform:uppercase;letter-spacing:.5px">Fixed</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#422006;border:1px solid #713f12;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">🟡</span>
        <div><div style="font-size:18px;font-weight:800;color:#f6c543">${durationChanged.length}</div><div style="font-size:10px;color:#fde68a;text-transform:uppercase;letter-spacing:.5px">Duration Changed</div></div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;background:#1a1f26;border:1px solid #374151;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">⚪</span>
        <div><div style="font-size:18px;font-weight:800;color:#9ca3af">${stable.length}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Stable</div></div>
      </div>
      ${onlyInA.length ? `<div style="display:flex;align-items:center;gap:8px;background:#1e1b4b;border:1px solid #3730a3;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">📋</span>
        <div><div style="font-size:18px;font-weight:800;color:#a5b4fc">${onlyInA.length}</div><div style="font-size:10px;color:#c7d2fe;text-transform:uppercase;letter-spacing:.5px">Only in Run 1</div></div>
      </div>` : ''}
      ${onlyInB.length ? `<div style="display:flex;align-items:center;gap:8px;background:#1e1b4b;border:1px solid #3730a3;border-radius:8px;padding:8px 16px">
        <span style="font-size:16px">📋</span>
        <div><div style="font-size:18px;font-weight:800;color:#a5b4fc">${onlyInB.length}</div><div style="font-size:10px;color:#c7d2fe;text-transform:uppercase;letter-spacing:.5px">Only in Run 2</div></div>
      </div>` : ''}
    </div>

    ${section('Newly Failed — Regressions', '🔴', '#f48771', failRows, ['Test Name', 'Run 1', 'Run 2', 'Error Message'])}
    ${section('Newly Passed — Fixed', '🟢', '#4ec9b0', passRows, ['Test Name', 'Run 1', 'Run 2', 'Note'])}
    ${section('Duration Changed  (≥50% shift)', '🟡', '#f6c543', durRows, ['Test Name', 'Run 1 Duration', 'Run 2 Duration', 'Change'])}
    ${section('Stable — Same result in both runs', '⚪', '#6b7280', stableRows, ['Test Name', 'Run 1', 'Run 2', 'Duration Trend'])}
    ${onlyInA.length ? section('Only in Run 1 — not executed in Run 2', '📋', '#a5b4fc',
        onlyInA.map(({name, t}) => `<tr style="background:#1a1f26">
          <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
          <td style="${tdStyle};text-align:center">${statusChip(t.status)}</td>
          <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">Not run</td>
          <td style="${tdStyle};text-align:center;color:#6b7280;font-size:11px">${fmtMs(t.durationMs)}</td>
        </tr>`),
        ['Test Name', 'Run 1 Result', 'Run 2 Result', 'Run 1 Duration']) : ''}
    ${onlyInB.length ? section('Only in Run 2 — not executed in Run 1', '📋', '#a5b4fc',
        onlyInB.map(({name, t}) => `<tr style="background:#1a1f26">
          <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
          <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">Not run</td>
          <td style="${tdStyle};text-align:center">${statusChip(t.status)}</td>
          <td style="${tdStyle};text-align:center;color:#6b7280;font-size:11px">${fmtMs(t.durationMs)}</td>
        </tr>`),
        ['Test Name', 'Run 1 Result', 'Run 2 Result', 'Run 2 Duration']) : ''}
    ${(r1.tests||[]).length === 0 || (r2.tests||[]).length === 0 ? `
      <div style="margin-top:8px;padding:16px 20px;background:#1c1917;border:1px solid #713f12;border-radius:10px;color:#fde68a;font-size:13px">
        ⚠️ <strong>One or both runs have no test results.</strong> This usually means the run failed before Playwright could execute any tests (e.g. spec generation error, environment unreachable, or run was aborted).
        Check the run duration — a very short run (under 10s) with 0 tests typically indicates a startup failure.
      </div>` : ''}
  `;

  overlay.style.display = 'block';
  overlay.querySelector('div').scrollTop = 0;
}

function histCompareClose() {
  document.getElementById('run-compare-overlay').style.display = 'none';
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

// ── Active debug sessions — parallel awareness ────────────────────────────────
// Map of scriptId → { sessionId, username, startedAt, environmentName }
// Polled every 5s from GET /api/debug/sessions so the script list can show
// "🔴 Being debugged by X" badges on rows where another user has an active session.
let _activeDebugSessions = {};   // scriptId → session info (or {} if none)
let _debugSessionsPollTimer = null;

function _debugSessionsPollStart() {
  if (_debugSessionsPollTimer) return; // already running
  _debugSessionsFetch();
  _debugSessionsPollTimer = setInterval(_debugSessionsFetch, 5000);
}

function _debugSessionsPollStop() {
  if (_debugSessionsPollTimer) { clearInterval(_debugSessionsPollTimer); _debugSessionsPollTimer = null; }
}

async function _debugSessionsFetch() {
  if (!currentProjectId) return;
  try {
    const r = await fetch(`/api/debug/sessions?projectId=${encodeURIComponent(currentProjectId)}`, { credentials: 'include' });
    if (!r.ok) return;
    const sessions = await r.json();
    // Rebuild map: scriptId → first active session info for that script
    const map = {};
    for (const s of sessions) {
      if (!map[s.scriptId]) map[s.scriptId] = s;
    }
    _activeDebugSessions = map;
    _debugApplyBadges();
  } catch { /* network hiccup — keep stale data */ }
}

function _debugApplyBadges() {
  // Inject or remove "being debugged" badges on each visible script row
  document.querySelectorAll('.script-tbl-row').forEach(row => {
    const scriptId = row.dataset.id;
    const existing = row.querySelector('.debug-active-badge');
    const session  = _activeDebugSessions[scriptId];
    if (session && session.sessionId !== _debugSessionId) {
      // Another user (or this user in another tab) is debugging this script
      if (!existing) {
        const badge = document.createElement('span');
        badge.className = 'debug-active-badge';
        badge.title = `Being debugged by ${session.username} since ${new Date(session.startedAt).toLocaleTimeString()}${session.environmentName ? ' (' + session.environmentName + ')' : ''}`;
        badge.textContent = '🔴';
        badge.style.cssText = 'margin-left:4px;cursor:default;font-size:13px;vertical-align:middle';
        const titleCell = row.querySelector('td:nth-child(3)');
        if (titleCell) titleCell.appendChild(badge);
      } else {
        // Update tooltip in case username/time changed
        existing.title = `Being debugged by ${session.username} since ${new Date(session.startedAt).toLocaleTimeString()}${session.environmentName ? ' (' + session.environmentName + ')' : ''}`;
      }
    } else if (existing) {
      existing.remove();
    }
  });
}

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
    if (res.status === 409 && err.code === 'DUPLICATE_OWN_SESSION') {
      // Same user already has this script open in another tab/window
      const since = err.since ? new Date(err.since).toLocaleTimeString() : '?';
      const choice = confirm(
        `You already have an active debug session for this script (started ${since}).\n\n` +
        `Click OK to close this dialog and continue your existing session,\n` +
        `or Cancel to stop the old session and start a fresh one.`
      );
      if (choice) {
        // Rejoin existing session — set sessionId and re-open overlay
        debugClose();
        _debugSessionId = err.sessionId;
        document.getElementById('debug-overlay').style.display = 'flex';
        document.getElementById('debug-overlay-title').textContent = `Debugger — ${script.title}`;
        _debugOpenSse(err.sessionId);
        if (typeof wsSubscribe === 'function') wsSubscribe(err.sessionId);
        _debugStartPolling();
        _debugStartHeartbeat();
        return;
      } else {
        // Stop the old session then fall through to start fresh after a brief wait
        await fetch('/api/debug/continue', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: err.sessionId, action: 'stop' })
        }).catch(() => {});
        // Small pause to let the process terminate before spawning a new one
        await new Promise(r => setTimeout(r, 800));
        // Retry start
        const retry = await fetch('/api/debug/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptId: _debugScriptId, environmentId: envId })
        });
        if (!retry.ok) {
          const e2 = await retry.json().catch(() => ({}));
          alert(`Failed to start debugger: ${e2.error || retry.statusText}`);
          debugClose();
          return;
        }
        const data2 = await retry.json();
        _debugSessionId  = data2.sessionId;
        _debugTotalSteps = data2.totalSteps;
        _debugSetStatus('starting');
        _debugOpenSse(data2.sessionId);
        if (typeof wsSubscribe === 'function') wsSubscribe(data2.sessionId);
        _debugStartPolling();
        window.addEventListener('beforeunload', () => {
          if (_debugSessionId) navigator.sendBeacon('/api/debug/stop', JSON.stringify({ sessionId: _debugSessionId, action: 'stop' }));
        });
        _debugStartHeartbeat();
        _debugSessionsFetch(); // refresh badges
        return;
      }
    }
    alert(`Failed to start debugger: ${err.error || res.statusText}`);
    debugClose();
    return;
  }

  const { sessionId, totalSteps, otherDebuggers } = await res.json();

  // Non-blocking notice: other users are also debugging this script right now
  if (otherDebuggers && otherDebuggers.length > 0) {
    const names = otherDebuggers.map(d => `• ${d.username} (since ${new Date(d.since).toLocaleTimeString()})`).join('\n');
    // Show as a dismissible notice in the debugger header rather than a blocking alert
    const noticeEl = document.getElementById('dbg-parallel-notice');
    if (noticeEl) {
      noticeEl.textContent = `⚠ Also being debugged by: ${otherDebuggers.map(d => d.username).join(', ')}`;
      noticeEl.style.display = '';
      setTimeout(() => { if (noticeEl) noticeEl.style.display = 'none'; }, 8000);
    } else {
      // Fallback for older markup — non-blocking console warning
      console.info('[debugger] Parallel debug notice:\n' + names);
    }
  }
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

  // Mark previous active step as done.
  // Also clear any 'failed' state on steps we've moved past — if we're receiving a
  // new step event beyond a failed step, the retry must have succeeded.
  _debugStepMeta.forEach(s => {
    if (_debugStepState[s.order] === 'active') _debugStepState[s.order] = 'done';
    if (_debugStepState[s.order] === 'failed' && s.order < stepIdx) _debugStepState[s.order] = 'done';
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
  // Refresh the parallel-debug badges so the red dot clears on this script's row
  setTimeout(_debugSessionsFetch, 500);
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

  // Immediately flip the failed step back to 'active' so the step list shows a
  // blue/active indicator while the retry is in flight (not stuck on red).
  const failedEntry = _debugStepMeta.find(s => _debugStepState[s.order] === 'failed');
  if (failedEntry) {
    _debugStepState[failedEntry.order] = 'active';
    _debugRenderSteps();
  }

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
    // Mark both 'active' and 'failed' steps as skipped — a failed step can be skipped
    // via the "Skip Step" button in the error panel, so its state must be updated here.
    _debugStepMeta.forEach(s => {
      if (_debugStepState[s.order] === 'active' || _debugStepState[s.order] === 'failed') {
        _debugStepState[s.order] = 'skipped';
      }
    });
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

  let recordedSteps = [];
  try {
    const stopRes = await fetch('/api/recorder/stop', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token }),
    });
    if (stopRes.ok) {
      const stopData = await stopRes.json();
      recordedSteps = stopData.steps || [];
    }
  } catch { /* ignore — server will auto-expire */ }

  // Reset UI
  const btn    = document.getElementById('recorder-btn');
  const status = document.getElementById('recorder-status');
  if (btn)    { btn.textContent = '⬤ Record'; btn.classList.remove('recording'); }
  if (status) { status.style.display = 'none'; }

  console.info('[Recorder] Stopped. Steps are in the editor — review and save.');

  // CR6 — Intelligent Step Grouping: analyse recorded steps for reusable patterns
  if (recordedSteps.length >= 3 && currentProjectId) {
    try {
      const anaRes = await fetch('/api/recorder/analyse', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId: currentProjectId, steps: recordedSteps }),
      });
      if (anaRes.ok) {
        const { patterns } = await anaRes.json();
        if (patterns && patterns.length > 0) {
          _cr6ShowSuggestions(patterns, recordedSteps.length);
        }
      }
    } catch (err) {
      console.warn('[Recorder] Pattern analysis failed:', err);
    }
  }
}

// ── CR6 — Intelligent Step Grouping (Common Function suggestions) ─────────────

/**
 * Show a suggestion card for each detected pattern.
 * patterns: array from /api/recorder/analyse
 * recordedStepsTotal: count of steps added during this recording session
 */
function _cr6ShowSuggestions(patterns, recordedStepsTotal) {
  // Process patterns one by one (queue them so user handles each sequentially)
  let idx = 0;
  function showNext() {
    if (idx >= patterns.length) return;
    _cr6ShowCard(patterns[idx], recordedStepsTotal, () => { idx++; showNext(); });
  }
  showNext();
}

/**
 * Show a single pattern suggestion card overlay.
 * onDone: callback when user accepts or keeps (dismisses) this card.
 */
function _cr6ShowCard(pattern, recordedStepsTotal, onDone) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10000;display:flex;align-items:center;justify-content:center';

  const isDuplicate = !!pattern.duplicateFnId;
  const stepsList   = pattern.steps.map((s, i) =>
    `<li style="padding:3px 0;color:var(--neutral-300);font-size:12px">
       <span style="color:var(--purple-400);font-weight:600">${escHtml(s.keyword)}</span>
       ${s.locatorName || s.locator ? `<span style="color:var(--neutral-500);margin:0 4px">→</span><span style="font-family:monospace;font-size:11px">${escHtml(s.locatorName || s.locator || '')}</span>` : ''}
       ${s.value ? `<span style="color:var(--neutral-500);margin:0 4px">=</span><span style="font-family:monospace;font-size:11px;color:var(--green-400)">${escHtml(String(s.value))}</span>` : ''}
     </li>`
  ).join('');

  const dupWarning = isDuplicate
    ? `<div style="margin:10px 0;padding:8px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:6px;font-size:12px;color:#f59e0b">
         ⚠ An identical Common Function already exists. Accepting will reuse it without creating a duplicate.
       </div>`
    : '';

  overlay.innerHTML = `
    <div class="modal-box" style="max-width:520px;padding:24px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:18px">🧩</span>
        <span style="font-weight:700;font-size:15px;color:var(--text-primary)">Reusable Pattern Detected</span>
      </div>
      <div style="font-size:12px;color:var(--neutral-400);margin-bottom:14px">
        This sequence of <strong>${pattern.steps.length} steps</strong> appears in
        <strong>${pattern.matchCount}</strong> other script${pattern.matchCount !== 1 ? 's' : ''} in this project.
        Extract it as a Common Function to avoid duplication.
      </div>
      ${dupWarning}
      <div style="margin-bottom:14px">
        <label style="font-size:12px;color:var(--neutral-300);font-weight:600;display:block;margin-bottom:6px">Function Name</label>
        <input id="cr6-fn-name" class="fm-input" style="width:100%" placeholder="e.g. Login Flow"
               value="${escHtml(pattern.suggestedName)}" ${isDuplicate ? 'disabled' : ''} />
        <div style="margin-top:4px">
          <label style="font-size:12px;color:var(--neutral-300);font-weight:600;display:block;margin-bottom:4px">Identifier</label>
          <input id="cr6-fn-ident" class="fm-input" style="width:100%;font-family:monospace" placeholder="e.g. login_flow"
                 value="${escHtml(_cr6ToIdentifier(pattern.suggestedName))}" ${isDuplicate ? 'disabled' : ''} />
        </div>
      </div>
      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:var(--neutral-400);margin-bottom:6px;font-weight:600">Steps in this group:</div>
        <ul style="list-style:none;margin:0;padding:0;border:1px solid var(--border);border-radius:6px;padding:8px 12px;max-height:180px;overflow-y:auto;background:var(--surface-2)">
          ${stepsList}
        </ul>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-outline btn-sm" id="cr6-keep-btn">Keep as-is</button>
        <button class="btn btn-primary btn-sm" id="cr6-accept-btn" style="background:#7c3aed;border-color:#7c3aed">
          ${isDuplicate ? '🔗 Reuse Existing Function' : '✓ Extract as Common Function'}
        </button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  // Auto-derive identifier as user types name
  if (!isDuplicate) {
    const nameInp  = overlay.querySelector('#cr6-fn-name');
    const identInp = overlay.querySelector('#cr6-fn-ident');
    nameInp.addEventListener('input', () => {
      identInp.value = _cr6ToIdentifier(nameInp.value);
    });
  }

  overlay.querySelector('#cr6-keep-btn').onclick = () => {
    document.body.removeChild(overlay);
    onDone();
  };

  overlay.querySelector('#cr6-accept-btn').onclick = async () => {
    const nameInp  = overlay.querySelector('#cr6-fn-name');
    const identInp = overlay.querySelector('#cr6-fn-ident');
    const fnName   = isDuplicate ? pattern.suggestedName : (nameInp?.value.trim() || '');
    const fnIdent  = isDuplicate ? '' : (identInp?.value.trim() || '');

    if (!isDuplicate && !fnName) { nameInp.style.borderColor = 'red'; nameInp.focus(); return; }
    if (!isDuplicate && !fnIdent) { identInp.style.borderColor = 'red'; identInp.focus(); return; }

    const acceptBtn = overlay.querySelector('#cr6-accept-btn');
    acceptBtn.disabled = true;
    acceptBtn.textContent = 'Saving…';

    try {
      await _cr6AcceptPattern(pattern, recordedStepsTotal, fnName, fnIdent, isDuplicate);
      document.body.removeChild(overlay);
      onDone();
    } catch (err) {
      acceptBtn.disabled = false;
      acceptBtn.textContent = isDuplicate ? '🔗 Reuse Existing Function' : '✓ Extract as Common Function';
      alert('Failed to extract: ' + (err.message || err));
    }
  };
}

/** Convert a display name to a valid identifier (alphanumeric + underscores) */
function _cr6ToIdentifier(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Accept a pattern: create (or reuse) a CommonFunction, then replace the
 * matched rows in the script editor with a single CALL FUNCTION step.
 */
async function _cr6AcceptPattern(pattern, recordedStepsTotal, fnName, fnIdent, isDuplicate) {
  let fnId, fnNameResolved;

  if (isDuplicate) {
    // Reuse existing function — look up by id
    fnId = pattern.duplicateFnId;
    fnNameResolved = pattern.suggestedName;
  } else {
    // ── Last-chance duplicate guard (client-side) ─────────────────────────────
    // The server's analyse endpoint may have been called before a prior pattern
    // was accepted this session. Check allFunctions now (freshly loaded) to
    // prevent creating a function that is identical or a subset/superset of one
    // that already exists.
    function _cr6Fp(step) {
      // CommonFunction steps use `selector`; script/recorded steps use `locator`
      const raw = (step.locatorName || step.locator || step.selector || step.detail || '').trim();
      return `${(step.keyword || '').toUpperCase()}|${raw.toLowerCase().replace(/^[#.]/, '')}`;
    }
    const candidateFpArr = pattern.steps.map(_cr6Fp);
    const candidateFpStr = candidateFpArr.join('::');

    const existingFn = allFunctions.find(f => {
      if (f.projectId && f.projectId !== currentProjectId) return false;
      const fnFpArr = (f.steps || []).map(_cr6Fp);
      const fnFpStr = fnFpArr.join('::');
      if (fnFpStr === candidateFpStr) return true;  // exact

      // Candidate contained inside existing fn
      const cLen = candidateFpArr.length, fLen = fnFpArr.length;
      if (fLen >= cLen) {
        for (let fi = 0; fi <= fLen - cLen; fi++) {
          if (fnFpArr.slice(fi, fi + cLen).join('::') === candidateFpStr) return true;
        }
      }
      // Existing fn contained inside candidate
      if (fLen >= 2 && fLen <= cLen) {
        for (let ci = 0; ci <= cLen - fLen; ci++) {
          if (candidateFpArr.slice(ci, ci + fLen).join('::') === fnFpStr) return true;
        }
      }
      return false;
    });

    if (existingFn) {
      // Silent reuse — don't create a duplicate
      fnId = existingFn.id;
      fnNameResolved = existingFn.name;
    } else {
      // Create new CommonFunction (steps only — no values in fn definition)
      // Exact replication of all locator fields from the script step into the function step.
      // ScriptStep uses 'locator' for the value; FunctionStep stores it as 'selector'.
      // Every other field is copied verbatim — no defaults, no coercion.
      const fnSteps = pattern.steps.map((s, i) => ({
        order:       i + 1,
        keyword:     s.keyword,
        locatorName: s.locatorName ?? null,
        locatorType: s.locatorType ?? 'css',
        selector:    s.locator    ?? s.selector ?? null,  // script uses 'locator', fn uses 'selector'
        description: s.description ?? '',
      }));

      const body = {
        name:        fnName,
        identifier:  fnIdent,
        description: `Auto-extracted from recording — ${pattern.matchCount} matching script${pattern.matchCount !== 1 ? 's' : ''}`,
        steps:       fnSteps,
        projectId:   currentProjectId || null,
      };

      const res = await fetch('/api/functions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      fnId           = data.id;
      fnNameResolved = fnName;

      // Refresh the in-memory allFunctions list so CALL FUNCTION picker finds the new fn
      await fnLoad();
    }
  }

  // ── Replace matched DOM rows with a single CALL FUNCTION step ────────────────
  // The recorded steps were appended to the end of any pre-existing editor rows.
  // So recorded step at index i → DOM row at (totalRows - recordedStepsTotal + i).
  const allRows = [...document.querySelectorAll('#se-steps-container .script-step-row')];
  const offset  = allRows.length - recordedStepsTotal;

  const domStart = offset + pattern.startIndex;
  const domEnd   = offset + pattern.endIndex;

  // The row that will follow the replacement (used as insert-before anchor)
  const anchorRow = allRows[domEnd + 1] || null;

  // Remove matched rows (in reverse order to keep indices stable)
  for (let i = domEnd; i >= domStart; i--) {
    if (allRows[i]) allRows[i].remove();
  }

  // Build fnStepValues — pre-populate with values captured during recording
  const fnStepValues = pattern.steps.reduce((acc, s, fi) => {
    if (s.value != null && s.value !== '') {
      acc.push({
        fnStepIdx: fi,
        valueMode: s.valueMode || 'static',
        value:     s.value,
        testData:  s.testData  || [],
      });
    }
    return acc;
  }, []);

  // Insert a CALL FUNCTION step at the same position
  const callFnStep = {
    keyword:      'CALL FUNCTION',
    value:        fnNameResolved,
    valueMode:    'static',
    fnStepValues,
    locator:      null,
    locatorName:  null,
    locatorType:  'css',
    description:  `Call: ${fnNameResolved}`,
    screenshot:   false,
    testData:     [],
  };
  scriptAddStep(callFnStep, anchorRow);

  // Re-number all steps
  scriptReorderNums();

  console.info(`[CR6] Replaced steps ${pattern.startIndex}–${pattern.endIndex} with CALL FUNCTION "${fnNameResolved}"`);
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

// ══════════════════════════════════════════════════════════════════════════════
// API KEY MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

let _apikeyRawKey    = null;
let _akAllSuites     = [];
let _akAllProjects   = [];
let _akGeneratedId   = null;  // id returned after generation (for YAML suite/env fallback)

async function apikeyLoad() {
  const res  = await fetch('/api/admin/apikeys');
  const keys = await res.json();
  const tbody = document.getElementById('apikey-tbody');
  if (!tbody) return;
  const projects = await _getProjects();
  tbody.innerHTML = keys.length === 0
    ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No API keys yet.</td></tr>'
    : keys.map(k => {
        const proj = projects.find(p => p.id === k.projectId);
        return `<tr>
          <td><strong>${escHtml(k.name)}</strong></td>
          <td><code>${escHtml(k.prefix)}…</code></td>
          <td>${proj ? escHtml(proj.name) : 'All projects'}</td>
          <td>${k.expiresAt ? formatDate(k.expiresAt) : 'Never'}</td>
          <td>${k.lastUsedAt ? formatDate(k.lastUsedAt) : '—'}</td>
          <td><button class="btn btn-danger btn-sm" onclick="apikeyDelete('${k.id}')">Revoke</button></td>
        </tr>`;
      }).join('');
}

async function _getProjects() {
  try { const r = await fetch('/api/projects'); return await r.json(); } catch { return []; }
}

async function _getSuites(projectId) {
  if (!projectId) return [];
  try {
    const r = await fetch(`/api/suites?projectId=${projectId}`);
    if (!r.ok) return [];
    return await r.json();
  } catch { return []; }
}

async function apikeyOpenModal() {
  _apikeyRawKey  = null;
  _akGeneratedId = null;

  // Reset form
  document.getElementById('ak-name').value    = '';
  document.getElementById('ak-expires').value = '';
  document.getElementById('ak-suite').innerHTML  = '<option value="">— select suite —</option>';
  document.getElementById('ak-env').innerHTML    = '<option value="">— select environment —</option>';
  document.getElementById('ak-timeout').value = '30';
  document.getElementById('ak-poll').value    = '5';
  document.getElementById('apikey-modal-alert').innerHTML = '';
  document.getElementById('apikey-result-block').style.display = 'none';
  document.getElementById('apikey-form-block').style.display   = '';
  document.getElementById('ak-save-btn').style.display         = '';
  document.getElementById('ak-modal-title').textContent        = 'Generate API Key';
  document.getElementById('ak-copy-yaml-btn').disabled         = true;
  document.getElementById('ak-dl-yaml-btn').disabled           = true;
  document.getElementById('ak-yaml-preview').textContent       = 'Configure the fields on the left to preview the generated YAML.';

  // Load projects first, then suites
  _akAllProjects = await _getProjects();
  _akAllSuites   = [];

  const projSel = document.getElementById('ak-project');
  projSel.innerHTML = '<option value="">— select project —</option>' +
    _akAllProjects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  document.getElementById('modal-apikey').style.display = 'flex';
  _akYamlUpdate();
}

function _akPopulateSuites(projectId) {
  const list = projectId ? _akAllSuites.filter(s => s.projectId === projectId) : _akAllSuites;
  const sel  = document.getElementById('ak-suite');
  sel.innerHTML = '<option value="">— select suite —</option>' +
    list.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
  document.getElementById('ak-env').innerHTML = '<option value="">— select environment —</option>';
}

async function _akProjectChange() {
  const projectId = document.getElementById('ak-project').value;

  // Reset downstream selects
  document.getElementById('ak-suite').innerHTML = '<option value="">— loading… —</option>';
  document.getElementById('ak-env').innerHTML   = '<option value="">— select environment —</option>';

  if (!projectId) {
    document.getElementById('ak-suite').innerHTML = '<option value="">— select suite —</option>';
    _akAllSuites = [];
    _akYamlUpdate();
    return;
  }

  // Fetch suites for this project directly
  _akAllSuites = await _getSuites(projectId);
  _akPopulateSuites(projectId);
  _akYamlUpdate();
}

function _akSuiteChange() {
  const suiteId = document.getElementById('ak-suite').value;
  const suite   = _akAllSuites.find(s => s.id === suiteId);
  const envSel  = document.getElementById('ak-env');
  envSel.innerHTML = '<option value="">— select environment —</option>';

  if (suite) {
    // Load environments from the suite's project
    const proj = _akAllProjects.find(p => p.id === suite.projectId);
    if (proj && proj.environments && proj.environments.length) {
      proj.environments.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = `${e.name} — ${e.url}`;
        // Pre-select if suite has a saved environmentId
        if (suite.environmentId && suite.environmentId === e.id) opt.selected = true;
        envSel.appendChild(opt);
      });
    }
  }
  _akYamlUpdate();
}

function _akYamlUpdate() {
  const platform  = window.location.origin;
  const keyName   = document.getElementById('ak-name').value.trim() || 'ADO Pipeline — QA';
  const suiteId   = document.getElementById('ak-suite').value;
  const suiteName = suiteId ? ((_akAllSuites.find(s => s.id === suiteId) || {}).name || suiteId) : '<SUITE_ID>';
  const envId     = document.getElementById('ak-env').value || '<ENV_ID>';
  const timeout   = document.getElementById('ak-timeout').value || '30';
  const poll      = document.getElementById('ak-poll').value || '5';
  const rawKey    = _apikeyRawKey || '$(QA_API_KEY)';
  const suiteIdVal = suiteId || '<SUITE_ID>';

  // Use a plain string (not template literal) for the PowerShell block
  // so $ signs are never interpreted by JS
  const ps = [
    "      $ErrorActionPreference = 'Stop'",
    "      $platform  = '" + platform + "'",
    "      $suiteId   = '" + suiteIdVal + "'",
    "      $envId     = '" + envId + "'",
    "      $headers   = @{ Authorization = \"Bearer $env:QA_API_KEY\"; 'Content-Type' = 'application/json' }",
    "      $body      = @{ environmentId = $envId } | ConvertTo-Json",
    "",
    "      Write-Host \"Triggering QA suite: " + suiteName.replace(/"/g, "'") + "\"",
    "      $trigger = Invoke-RestMethod -Uri \"$platform/api/suites/$suiteId/run\" `",
    "                    -Method POST -Headers $headers -Body $body",
    "      $runId = $trigger.runId",
    "      if (-not $runId) { Write-Error \"No runId returned.\"; exit 1 }",
    "      Write-Host \"Run ID: $runId\"",
    "",
    "      $deadline = (Get-Date).AddMinutes(" + timeout + ")",
    "      do {",
    "        Start-Sleep -Seconds " + poll,
    "        $run = Invoke-RestMethod -Uri \"$platform/api/run/$runId\" -Headers $headers",
    "        Write-Host \"[$($run.status)] passed=$($run.passed) failed=$($run.failed) total=$($run.total)\"",
    "        if ((Get-Date) -gt $deadline) { Write-Error \"Timed out after " + timeout + " minutes.\"; exit 1 }",
    "      } while ($run.status -eq 'running')",
    "",
    "      $reportUrl = \"$platform/execution-report?runId=$runId\"",
    "      Write-Host \"Report: $reportUrl\"",
    "",
    "      $md = @\"",
    "## QA Suite Results — " + suiteName,
    "| | |",
    "|---|---|",
    "| Status  | $($run.status) |",
    "| Passed  | $($run.passed) |",
    "| Failed  | $($run.failed) |",
    "| Total   | $($run.total) |",
    "",
    "[Open Full Report]($reportUrl)",
    "\"@",
    "      $md | Out-File \"$($env:AGENT_TEMPDIRECTORY)/qa-summary.md\" -Encoding utf8",
    "      Write-Host \"##vso[task.uploadsummary]$($env:AGENT_TEMPDIRECTORY)/qa-summary.md\"",
    "",
    "      if ($run.status -eq 'failed' -or $run.failed -gt 0) {",
    "        Write-Error \"QA suite FAILED ($($run.failed) test(s) failed).\"",
    "        exit 1",
    "      }",
    "      Write-Host \"All tests passed.\"",
    "      exit 0",
  ].join('\n');

  const yaml =
"# Generated by QA Agent Platform — " + new Date().toISOString().slice(0,10) + "\n" +
"# Key: " + keyName + "\n" +
"# Suite: " + suiteName + "\n" +
"# Store QA_API_KEY in ADO Library > Variable Groups > qa-platform-config (mark as secret)\n" +
(_apikeyRawKey ? "# QA_API_KEY value: " + rawKey + "\n" : "") +
"\n" +
"variables:\n" +
"  - group: qa-platform-config\n" +
"\n" +
"- task: PowerShell@2\n" +
"  displayName: 'QA Suite \u2014 " + suiteName.replace(/'/g, "''") + "'\n" +
"  env:\n" +
"    QA_API_KEY: $(QA_API_KEY)\n" +
"  inputs:\n" +
"    targetType: inline\n" +
"    script: |\n" +
ps;

  document.getElementById('ak-yaml-preview').textContent = yaml;

  // Enable copy/download if suite is selected
  const canExport = !!suiteId;
  document.getElementById('ak-copy-yaml-btn').disabled = !canExport;
  document.getElementById('ak-dl-yaml-btn').disabled   = !canExport;
}

function apikeyCloseModal() {
  document.getElementById('modal-apikey').style.display = 'none';
  if (_apikeyRawKey) apikeyLoad();
}

function apikeyCopyKey() {
  if (!_apikeyRawKey) return;
  const btn  = document.querySelector('#apikey-result-block .btn');
  const orig = btn ? btn.textContent : 'Copy';
  const succeed = () => { if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = orig; }, 1800); } };
  const fail    = () => { if (btn) { btn.textContent = 'Select + Ctrl+C'; setTimeout(() => { btn.textContent = orig; }, 2500); } };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(_apikeyRawKey).then(succeed).catch(() => _akCopyFallback(_apikeyRawKey, succeed, fail));
  } else {
    _akCopyFallback(_apikeyRawKey, succeed, fail);
  }
}

function _akCopyYaml() {
  const yaml = document.getElementById('ak-yaml-preview').textContent;
  const btn  = document.getElementById('ak-copy-yaml-btn');
  const orig = btn.textContent;

  const succeed = () => { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = orig; }, 1800); };
  const fail    = () => { btn.textContent = 'Select + Ctrl+C'; setTimeout(() => { btn.textContent = orig; }, 2500); };

  // Modern clipboard API (HTTPS / localhost)
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(yaml).then(succeed).catch(() => _akCopyFallback(yaml, succeed, fail));
  } else {
    _akCopyFallback(yaml, succeed, fail);
  }
}

function _akCopyFallback(text, succeed, fail) {
  // execCommand fallback — works over HTTP on internal networks
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    const ok = document.execCommand('copy');
    ok ? succeed() : fail();
  } catch { fail(); }
  document.body.removeChild(ta);
}

function _akDownloadYaml() {
  const yaml     = document.getElementById('ak-yaml-preview').textContent;
  const suiteSel = document.getElementById('ak-suite');
  const suiteName = suiteSel.options[suiteSel.selectedIndex]?.text || 'qa-suite';
  const safeName  = suiteName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `qa-pipeline-${safeName}.yml`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function apikeySave() {
  const name      = document.getElementById('ak-name').value.trim();
  const projectId = document.getElementById('ak-project').value || null;
  const expiresIn = document.getElementById('ak-expires').value;
  const alertEl   = document.getElementById('apikey-modal-alert');

  if (!name)      { alertEl.innerHTML = '<div class="alert alert-error">Key name is required.</div>'; return; }
  if (!projectId) { alertEl.innerHTML = '<div class="alert alert-error">Project scope is required.</div>'; return; }

  let expiresAt = null;
  if (expiresIn) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expiresIn));
    expiresAt = d.toISOString();
  }

  const res  = await fetch('/api/admin/apikeys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, projectId, expiresAt })
  });
  const data = await res.json();
  if (!res.ok) { alertEl.innerHTML = `<div class="alert alert-error">${escHtml(data.error || 'Error')}</div>`; return; }

  _apikeyRawKey  = data.key;
  _akGeneratedId = data.id;

  document.getElementById('apikey-raw-display').textContent    = data.key;
  document.getElementById('apikey-result-block').style.display = '';
  document.getElementById('ak-save-btn').style.display         = 'none';
  document.getElementById('ak-modal-title').textContent        = 'Key Generated — Save YAML';

  // Refresh YAML with real key value embedded
  _akYamlUpdate();
}

async function apikeyDelete(id) {
  if (!confirm('Revoke this API key? Any pipelines using it will stop working.')) return;
  await fetch(`/api/admin/apikeys/${id}`, { method: 'DELETE' });
  apikeyLoad();
}

// ══════════════════════════════════════════════════════════════════════════════
// P1: LICENSE MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

async function licenseLoad() {
  try {
    const [licRes, machineRes, auditRes, sessionsRes] = await Promise.all([
      fetch('/api/admin/license'),
      fetch('/api/admin/license/machine'),
      fetch('/api/admin/license/audit'),
      fetch('/api/admin/license/sessions'),
    ]);
    const data     = licRes.ok       ? await licRes.json()       : { activated: false };
    const machine  = machineRes.ok   ? await machineRes.json()   : null;
    const audit    = auditRes.ok     ? await auditRes.json()     : [];
    const sessData = sessionsRes.ok  ? await sessionsRes.json()  : { sessions: [], seatsUsed: 0 };

    // P3-05: Always populate Machine ID display (needed before activation)
    const machineDisplay = document.getElementById('lic-machineid-display');
    if (machineDisplay) {
      machineDisplay.textContent = machine
        ? (machine.currentMachineId ?? machine.currentMachineIdHint ?? '—')
        : '(unavailable)';
    }

    _renderLicensePanel(data, machine, audit, sessData.sessions ?? []);
  } catch (err) {
    console.error('[licenseLoad] error:', err);
    const machineDisplay = document.getElementById('lic-machineid-display');
    if (machineDisplay && machineDisplay.textContent === 'Loading…') {
      machineDisplay.textContent = '(error loading)';
    }
  }
}

// P3-05: Copy full Machine ID to clipboard
async function licenseCopyMachineId() {
  const el = document.getElementById('lic-machineid-display');
  const id = el?.textContent?.trim() ?? '';
  if (!id || id === 'Loading…') return;
  try {
    await navigator.clipboard.writeText(id);
    const btn = document.getElementById('lic-copy-machineid-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Machine ID'; }, 2000); }
  } catch {
    prompt('Copy this Machine ID and send it to your vendor:', id);
  }
}

function _renderLicensePanel(data, machine, audit, sessions) {
  const statusBlock   = document.getElementById('lic-status-block');
  const activateBlock = document.getElementById('lic-activate-block');
  const alertEl       = document.getElementById('license-alert');
  if (!statusBlock || !activateBlock) return;
  alertEl.innerHTML = '';

  const preActivateEl = document.getElementById('lic-machineid-preactivate');
  if (!data.activated) {
    statusBlock.style.display   = 'none';
    activateBlock.style.display = '';
    if (preActivateEl) preActivateEl.style.display = '';
    return;
  }
  if (preActivateEl) preActivateEl.style.display = 'none';

  // Show status block
  statusBlock.style.display   = '';

  // Auto-trial: show activate form alongside status so admin can enter key
  activateBlock.style.display = data.isAutoTrial ? '' : 'none';

  // Trial banner
  const existingBanner = document.getElementById('lic-trial-banner');
  if (existingBanner) existingBanner.remove();
  if (data.isAutoTrial) {
    const days   = data.trialDaysLeft ?? 0;
    const urgent = days <= 3;
    const banner = document.createElement('div');
    banner.id    = 'lic-trial-banner';
    banner.style.cssText = `margin-bottom:14px;padding:10px 14px;border-radius:6px;font-size:.82rem;display:flex;align-items:center;gap:10px;background:${urgent ? '#450a0a' : '#431407'};border:1px solid ${urgent ? '#dc2626' : '#ea580c'};color:${urgent ? '#fca5a5' : '#fdba74'}`;
    banner.innerHTML = `<span style="font-size:1.1rem">${urgent ? '🔴' : '🟠'}</span>
      <span><strong>${days} day${days !== 1 ? 's' : ''} left on your free trial.</strong>
      Enter a license key below to continue using the platform after the trial ends.</span>`;
    statusBlock.insertAdjacentElement('afterbegin', banner);
  }

  const tierBadge = document.getElementById('lic-tier-badge');
  tierBadge.textContent = data.isAutoTrial ? 'TRIAL (AUTO)' : data.tier.toUpperCase();
  tierBadge.className   = `lic-badge lic-badge-${data.tier}`;

  document.getElementById('lic-org-name').textContent = data.orgName || data.orgId;

  const expiryChip = document.getElementById('lic-expiry-chip');
  if (data.expired) {
    expiryChip.textContent = 'EXPIRED';
    expiryChip.className   = 'lic-chip lic-chip-red';
  } else if (data.daysLeft <= 14) {
    expiryChip.textContent = `Expires in ${data.daysLeft} days`;
    expiryChip.className   = 'lic-chip lic-chip-amber';
  } else {
    expiryChip.textContent = `Expires ${new Date(data.expiresAt).toLocaleDateString()}`;
    expiryChip.className   = 'lic-chip lic-chip-green';
  }

  const seatsChip = document.getElementById('lic-seats-chip');
  seatsChip.textContent = data.seats === -1
    ? 'Unlimited seats'
    : `${data.seatsUsed} / ${data.seats} seats`;
  seatsChip.className = 'lic-chip lic-chip-blue';

  const featList = document.getElementById('lic-features-list');
  const f        = data.features || {};
  const ov       = data.featureOverrides || {};   // P4-01: vendor-signed overrides
  const labels   = { recorder: 'Recorder', debugger: 'Debugger', scheduler: 'Scheduler',
    sso: 'SSO', apiAccess: 'API Access', whiteLabel: 'White-label' };

  // Effective value = override (if present) else tier default
  featList.innerHTML = Object.entries(labels).map(([k, label]) => {
    const effective = k in ov ? ov[k] : f[k];
    const isOverride = k in ov;
    if (!effective) return '';
    const addOnBadge = isOverride && !f[k]
      ? ` <sup title="Granted by vendor add-on" style="color:var(--accent);font-size:.65rem;font-weight:700">+</sup>`
      : '';
    return `<span class="lic-feature-chip">${label}${addOnBadge}</span>`;
  }).join('');

  // P4-01: Show revoked features (tier has it, override removes it)
  const revokedEl = document.getElementById('lic-revoked-features');
  if (revokedEl) {
    const revoked = Object.entries(labels)
      .filter(([k]) => k in ov && ov[k] === false && f[k] === true)
      .map(([, label]) => `<span class="lic-feature-chip" style="text-decoration:line-through;opacity:.5">${label}</span>`);
    revokedEl.innerHTML = revoked.length
      ? `<div style="margin-top:6px;font-size:.72rem;color:var(--text-muted)">Revoked by vendor: ${revoked.join('')}</div>`
      : '';
  }

  // P1-EG-06: Machine binding status
  const machineEl = document.getElementById('lic-machine-block');
  if (machineEl && machine) {
    const bound   = machine.boundMachineId;
    const match   = machine.match;
    const matchBadge = match === true
      ? `<span class="lic-chip lic-chip-green" style="font-size:.72rem">Bound ✓</span>`
      : match === false
        ? `<span class="lic-chip lic-chip-red" style="font-size:.72rem">Mismatch ⚠</span>`
        : `<span class="lic-chip" style="font-size:.72rem">Unbound</span>`;
    machineEl.innerHTML = `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px">Machine Binding</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <code style="font-size:.78rem;color:var(--text-secondary)">${_escHtml(bound ? machine.boundMachineIdHint : machine.currentMachineIdHint)}</code>
          ${matchBadge}
          ${match === false ? `<button class="btn btn-outline btn-sm" onclick="licenseTransfer()" style="color:var(--warning)">Transfer to this machine</button>` : ''}
        </div>
        ${data.maxInstances && data.maxInstances !== -1 ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Max ${data.maxInstances} server instance${data.maxInstances === 1 ? '' : 's'} allowed</div>` : ''}
      </div>`;
  }

  // P2-02: Active Seat Dashboard
  const sessionsEl = document.getElementById('lic-sessions-block');
  if (sessionsEl) {
    const activeSessions = Array.isArray(sessions) ? sessions : [];
    const seatsUsed  = data.seatsUsed  ?? 0;
    const seatsTotal = data.seats === -1 ? '∞' : (data.seats ?? '—');
    const ratio      = data.seatRatio  ?? -1;
    const barPct     = ratio === -1 ? 0 : Math.min(100, Math.round(ratio * 100));
    const barColor   = ratio >= 0.9 ? '#ef4444' : ratio >= 0.8 ? '#f59e0b' : '#22c55e';

    sessionsEl.innerHTML = `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:.78rem;color:var(--text-muted)">Active Sessions &mdash; ${seatsUsed} of ${seatsTotal} seats</div>
          <button class="btn btn-outline btn-sm" onclick="licenseLoad()" style="font-size:.72rem;padding:3px 8px">Refresh</button>
        </div>
        ${ratio !== -1 ? `
        <div style="height:6px;background:rgba(255,255,255,.08);border-radius:3px;margin-bottom:10px;overflow:hidden">
          <div style="height:100%;width:${barPct}%;background:${barColor};border-radius:3px;transition:width .3s"></div>
        </div>` : ''}
        ${activeSessions.length === 0
          ? `<div style="font-size:.78rem;color:var(--text-muted);padding:8px 0">No active sessions</div>`
          : `<table style="width:100%;font-size:.74rem;border-collapse:collapse">
              <thead><tr>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">User</th>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Role</th>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Logged in</th>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Last active</th>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">IP</th>
                <th style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)"></th>
              </tr></thead>
              <tbody>
                ${activeSessions.map(s => `<tr>
                  <td style="padding:5px 6px;color:var(--text-secondary);font-weight:${s.isCurrent?'600':'400'}">${_escHtml(s.username||'—')}${s.isCurrent?' <span style="font-size:.68rem;color:#60a5fa">(you)</span>':''}</td>
                  <td style="padding:5px 6px"><span class="badge badge-${s.role||'tester'}">${_escHtml(s.role||'—')}</span></td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${s.loginAt ? new Date(s.loginAt).toLocaleTimeString() : '—'}</td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${s.lastActivity ? new Date(s.lastActivity).toLocaleTimeString() : '—'}</td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${_escHtml(s.ip||'—')}</td>
                  <td style="padding:5px 6px">
                    ${s.isCurrent ? '' : `<button class="tbl-btn del" onclick="licenseRevokeSession('${_escHtml(s.sessionId)}','${_escHtml(s.username||'')}')" title="Force logout">Revoke</button>`}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>`}
      </div>`;
    sessionsEl.style.display = '';
  }

  // P3-11: License Audit Log
  const auditEl = document.getElementById('lic-audit-block');
  if (auditEl && Array.isArray(audit) && audit.length > 0) {
    const ACTION_LABELS = {
      LICENSE_ACTIVATED:   '&#9989; Activated',
      LICENSE_DEACTIVATED: '&#128683; Deactivated',
      LICENSE_TRANSFERRED: '&#128260; Transferred',
      LICENSE_EXPIRED:     '&#128308; Expired',
    };
    auditEl.innerHTML = `
      <details style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">
        <summary style="cursor:pointer;font-size:.78rem;color:var(--text-muted);user-select:none">License Audit Log (${audit.length} events)</summary>
        <table style="width:100%;margin-top:8px;font-size:.74rem;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Time</th>
            <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Event</th>
            <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">User</th>
            <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Details</th>
          </tr></thead>
          <tbody>
            ${audit.map(e => `<tr>
              <td style="padding:4px 6px;color:var(--text-secondary)">${new Date(e.ts || e.timestamp || '').toLocaleString()}</td>
              <td style="padding:4px 6px">${ACTION_LABELS[e.action] || _escHtml(e.action)}</td>
              <td style="padding:4px 6px;color:var(--text-secondary)">${_escHtml(e.username || e.userId || '—')}</td>
              <td style="padding:4px 6px;color:var(--text-secondary)">${_escHtml(e.details || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>`;
    auditEl.style.display = '';
  } else if (auditEl) {
    auditEl.style.display = 'none';
  }
}

async function licenseActivate() {
  const key   = (document.getElementById('lic-key-input').value || '').trim();
  const alert = document.getElementById('license-alert');
  if (!key) { alert.innerHTML = '<div class="alert alert-error">Enter a license key</div>'; return; }
  alert.innerHTML = '<div class="alert alert-info">Activating…</div>';
  const res  = await fetch('/api/admin/license/activate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body:   JSON.stringify({ key }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert.innerHTML = `<div class="alert alert-error">${escHtml(data.error)}</div>`;
    return;
  }
  alert.innerHTML = `<div class="alert alert-success">License activated — ${data.tier.toUpperCase()} tier for ${_escHtml(data.orgName)}</div>`;
  document.getElementById('lic-key-input').value = '';
  licenseLoad();
  licenseCheckBanner();
}

async function licenseActivateFile() {
  const fileInput = document.getElementById('lic-file-input');
  const file = fileInput.files[0];
  if (!file) return;
  const alert = document.getElementById('license-alert');
  alert.innerHTML = '<div class="alert alert-info">Uploading .lic file…</div>';
  const form = new FormData();
  form.append('licFile', file);
  const res  = await fetch('/api/admin/license/activate', { method: 'POST', body: form });
  const data = await res.json();
  fileInput.value = '';
  if (!res.ok) {
    alert.innerHTML = `<div class="alert alert-error">${escHtml(data.error)}</div>`;
    return;
  }
  alert.innerHTML = `<div class="alert alert-success">License activated — ${data.tier.toUpperCase()} tier</div>`;
  licenseLoad();
  licenseCheckBanner();
}

// P2-02: Force-logout a session (frees a seat)
async function licenseRevokeSession(sessionId, username) {
  if (!confirm(`Force-logout ${username || 'this user'}? Their current work may be lost.`)) return;
  const res = await fetch(`/api/admin/license/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to revoke session'); return; }
  licenseLoad();
}

// P3-07: Download seat audit report CSV
function licenseExportSeatReport() {
  const a = document.createElement('a');
  a.href = '/api/admin/license/seat-report';
  a.download = `seat-report-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function licenseDeactivate() {
  if (!confirm('Deactivate license? The platform will continue in dev mode.')) return;
  await fetch('/api/admin/license', { method: 'DELETE' });
  licenseLoad();
  licenseCheckBanner();
}

async function licenseTransfer() {
  if (!confirm('Transfer this license to the current machine?\n\nThis will re-bind the license to this machine\'s hardware fingerprint. The previous machine will no longer be able to use this license.')) return;
  const alert = document.getElementById('license-alert');
  alert.innerHTML = '<div class="alert alert-info">Transferring license…</div>';
  const res  = await fetch('/api/admin/license/transfer', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    alert.innerHTML = `<div class="alert alert-error">${escHtml(data.error)}</div>`;
    return;
  }
  alert.innerHTML = `<div class="alert alert-success">License transferred and bound to this machine.</div>`;
  licenseLoad();
}

// P1-09 / P3-09: Check license status — show banner + read-only mode (P1-10)
async function licenseCheckBanner() {
  const banner = document.getElementById('license-banner');
  if (!banner) return;
  try {
    const res = await fetch('/api/admin/license');
    if (!res.ok) { banner.style.display = 'none'; return; }
    const data = await res.json();
    if (!data.activated) { banner.style.display = 'none'; document.body.classList.remove('lic-readonly'); return; }

    // P2-04: 80% seat warning — shown to admin only
    if (data.seatRatio !== -1 && data.seatRatio >= 0.8 && !data.expired) {
      const pct = Math.round(data.seatRatio * 100);
      const used = data.seatsUsed, total = data.seats;
      document.getElementById('license-banner-seats')?.remove?.();
      const seatBanner = document.createElement('div');
      seatBanner.id = 'license-banner-seats';
      seatBanner.className = 'lic-warn';
      seatBanner.style.cssText = 'display:flex;margin-bottom:4px';
      seatBanner.innerHTML = `&#9888;&#65039; <strong>${used} of ${total} seats</strong> in use (${pct}%) &mdash; consider upgrading your license.`;
      banner.parentNode?.insertBefore(seatBanner, banner);
    } else {
      document.getElementById('license-banner-seats')?.remove?.();
    }

    if (data.expired) {
      banner.innerHTML = '&#128308; Your QA Agent Platform license has <strong>expired</strong>. Contact your vendor to renew.';
      banner.className = 'lic-error';
      banner.style.display = 'flex';
      document.body.classList.add('lic-readonly');  // P1-10
    } else if (data.isAutoTrial) {
      const days   = data.trialDaysLeft ?? data.daysLeft;
      const urgent = days <= 3;
      banner.innerHTML = `${urgent ? '🔴' : '🟠'} <strong>Free Trial — ${days} day${days !== 1 ? 's' : ''} remaining.</strong> &nbsp;
        <a onclick="switchTab('admin');setTimeout(()=>adminSubTab('license',document.querySelector('.sub-tab:nth-child(4)')),100)" href="#"
           style="color:inherit;font-weight:600;text-decoration:underline">Activate your license key &rarr;</a>`;
      banner.className = urgent ? 'lic-error' : 'lic-warn';
      banner.style.display = 'flex';
      document.body.classList.remove('lic-readonly');
    } else if (data.tier === 'trial') {
      // Vendor-issued trial key
      banner.innerHTML = `&#128203; <strong>Trial License</strong> &mdash; expires in <strong>${data.daysLeft} day${data.daysLeft !== 1 ? 's' : ''}</strong>. <a href="mailto:sales@qa-agent.io" style="color:inherit;font-weight:600;margin-left:4px">Purchase a license &rarr;</a>`;
      banner.className = 'lic-info';
      banner.style.display = 'flex';
      document.body.classList.remove('lic-readonly');
    } else if (data.daysLeft <= 14) {
      banner.innerHTML = `&#9888;&#65039; License expires in <strong>${data.daysLeft} day${data.daysLeft !== 1 ? 's' : ''}</strong> &mdash; contact your vendor to renew.`;
      banner.className = 'lic-warn';
      banner.style.display = 'flex';
      document.body.classList.remove('lic-readonly');
    } else {
      banner.style.display = 'none';
      document.body.classList.remove('lic-readonly');
    }
  } catch {
    banner.style.display = 'none';
  }
}

// P3-10: Global 402 upgrade CTA handler — wrap fetch() calls that might hit feature gates
// Usage: const data = await fetchWithUpgradeCTA('/api/schedules', opts);
async function fetchWithUpgradeCTA(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    const upgradeTier = (body.upgrade || 'enterprise');
    const tierLabel   = upgradeTier === 'team' ? 'Team' : 'Enterprise';
    const feature     = body.feature || 'this feature';
    showUpgradeCTA(feature, tierLabel);
    return null;  // caller checks null to abort
  }
  return res;
}

function showUpgradeCTA(feature, tierLabel) {
  const existing = document.getElementById('upgrade-cta-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'upgrade-cta-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#1e2433;border:1px solid #3b4560;border-radius:8px;padding:32px;max-width:420px;text-align:center">
      <div style="font-size:32px;margin-bottom:12px">&#128274;</div>
      <h3 style="color:#e2e8f0;margin:0 0 8px">${_escHtml(feature.charAt(0).toUpperCase() + feature.slice(1))} not available</h3>
      <p style="color:#94a3b8;margin:0 0 20px">This feature requires the <strong style="color:#60a5fa">${_escHtml(tierLabel)}</strong> plan.</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 24px">Contact your vendor to upgrade your license.</p>
      <button onclick="document.getElementById('upgrade-cta-modal').remove()"
        style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:10px 24px;cursor:pointer;font-size:14px">
        Got it
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

// ══════════════════════════════════════════════════════════════════════════════
// Analytics Dashboard
// ══════════════════════════════════════════════════════════════════════════════

let _analyticsData = null;

async function analyticsLoad() {
  if (!currentProjectId) {
    document.getElementById('analytics-loading').style.display = '';
    document.getElementById('analytics-loading').textContent = 'Select a project to view analytics.';
    _analyticsClear();
    return;
  }
  document.getElementById('analytics-loading').style.display = 'none';
  const days = document.getElementById('analytics-days')?.value || '30';
  try {
    const res  = await fetch(`/api/analytics?projectId=${encodeURIComponent(currentProjectId)}&days=${days}`);
    if (!res.ok) throw new Error(await res.text());
    _analyticsData = await res.json();
    _analyticsRender(_analyticsData);
  } catch (e) {
    document.getElementById('analytics-loading').style.display = '';
    document.getElementById('analytics-loading').textContent = 'Failed to load analytics.';
  }
}

function _analyticsClear() {
  ['kpi-runs','kpi-tests','kpi-pass-rate','kpi-passed','kpi-failed'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'kpi-pass-rate' ? '—%' : '—';
  });
  const prchart = document.getElementById('analytics-passrate-chart');
  if (prchart) prchart.innerHTML = '';
  ['analytics-fail-tbody','analytics-flaky-tbody','analytics-suite-tbody'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

function _analyticsRender(d) {
  // KPIs
  document.getElementById('kpi-runs').textContent   = d.totalRuns;
  document.getElementById('kpi-tests').textContent  = d.totalTests;
  document.getElementById('kpi-pass-rate').textContent = d.overallPassRate + '%';
  document.getElementById('kpi-passed').textContent = d.totalPassed;
  document.getElementById('kpi-failed').textContent = d.totalFailed;

  // Pass rate trend chart (inline bar chart)
  const chartEl = document.getElementById('analytics-passrate-chart');
  const emptyEl = document.getElementById('analytics-passrate-empty');
  if (!d.passRateTrend || d.passRateTrend.length === 0) {
    chartEl.innerHTML = '';
    emptyEl.style.display = '';
  } else {
    emptyEl.style.display = 'none';
    chartEl.innerHTML = d.passRateTrend.map(row => {
      const pct  = row.passRate;
      const color = pct >= 90 ? '#4ec9b0' : pct >= 70 ? '#f6c543' : '#f48771';
      return `<div class="an-chart-row">
        <div class="an-chart-day">${row.day.slice(5)}</div>
        <div class="an-chart-bar-wrap"><div class="an-chart-bar" style="width:${pct}%;background:${color}"></div></div>
        <div class="an-chart-pct" style="color:${color}">${pct}%</div>
        <div style="color:var(--neutral-400);font-size:11px;min-width:100px">✓${row.passed} ✗${row.failed} of ${row.total}</div>
      </div>`;
    }).join('');
  }

  // Top failures
  const failTbody = document.getElementById('analytics-fail-tbody');
  const failEmpty = document.getElementById('analytics-fail-empty');
  if (!d.topFailures || d.topFailures.length === 0) {
    failTbody.innerHTML = '';
    failEmpty.style.display = '';
  } else {
    failEmpty.style.display = 'none';
    failTbody.innerHTML = d.topFailures.map(t => `<tr>
      <td style="max-width:260px;word-break:break-word;font-size:12px">${escHtml(t.name)}</td>
      <td style="text-align:center;color:#f48771;font-weight:700">${t.failures}</td>
      <td style="text-align:center;font-size:12px">${t.failRate}%</td>
    </tr>`).join('');
  }

  // Flaky tests
  const flakyTbody = document.getElementById('analytics-flaky-tbody');
  const flakyEmpty = document.getElementById('analytics-flaky-empty');
  if (!d.flaky || d.flaky.length === 0) {
    flakyTbody.innerHTML = '';
    flakyEmpty.style.display = '';
  } else {
    flakyEmpty.style.display = 'none';
    flakyTbody.innerHTML = d.flaky.map(t => `<tr>
      <td style="max-width:260px;word-break:break-word;font-size:12px">${escHtml(t.name)}</td>
      <td style="text-align:center;color:#f48771;font-weight:700">${t.failures}</td>
      <td style="text-align:center;font-size:12px">${t.failRate}%</td>
    </tr>`).join('');
  }

  // Suite comparison
  const suiteTbody = document.getElementById('analytics-suite-tbody');
  const suiteEmpty = document.getElementById('analytics-suite-empty');
  if (!d.suiteComparison || d.suiteComparison.length === 0) {
    suiteTbody.innerHTML = '';
    suiteEmpty.style.display = '';
  } else {
    suiteEmpty.style.display = 'none';
    suiteTbody.innerHTML = d.suiteComparison.map(s => {
      const passRate = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
      const color    = passRate >= 90 ? '#4ec9b0' : passRate >= 70 ? '#f6c543' : '#f48771';
      const avgMs    = s.runs > 0 ? Math.round(s.totalMs / s.runs) : 0;
      const avgDur   = avgMs < 1000 ? `${avgMs}ms` : avgMs < 60000 ? `${(avgMs/1000).toFixed(1)}s` : `${Math.floor(avgMs/60000)}m ${Math.round((avgMs%60000)/1000)}s`;
      return `<tr>
        <td style="font-weight:600;max-width:200px;word-break:break-word">${escHtml(s.suiteName)}</td>
        <td style="text-align:center">${s.runs}</td>
        <td style="text-align:center;color:#4ec9b0">${s.passed}</td>
        <td style="text-align:center;color:${s.failed ? '#f48771' : 'inherit'}">${s.failed}</td>
        <td style="text-align:center;font-weight:700;color:${color}">${passRate}%</td>
        <td style="text-align:center;font-size:12px;color:var(--neutral-500)">${avgDur}</td>
      </tr>`;
    }).join('');
  }
}

// ── Visual Regression ─────────────────────────────────────────────────────────

let _vrBaselines = [];

async function vrLoad() {
  const loading = document.getElementById('vr-loading');
  const empty   = document.getElementById('vr-empty');
  const grid    = document.getElementById('vr-grid');
  const summary = document.getElementById('vr-summary');
  if (!loading || !grid) return;

  if (!currentProjectId) {
    loading.style.display = 'block';
    loading.textContent = 'Select a project to view visual baselines.';
    empty.style.display = 'none';
    grid.style.display  = 'none';
    return;
  }

  loading.style.display = 'block';
  loading.textContent   = 'Loading baselines…';
  empty.style.display   = 'none';
  grid.style.display    = 'none';

  try {
    const res  = await fetch(`/api/visual-baselines?projectId=${encodeURIComponent(currentProjectId)}`);
    const data = await res.json();
    _vrBaselines = Array.isArray(data) ? data : (data.baselines || []);
    vrFilter();
  } catch {
    loading.textContent = 'Error loading baselines.';
  }
}

function vrFilter() {
  const search   = (document.getElementById('vr-search')?.value || '').toLowerCase();
  const status   = document.getElementById('vr-status-filter')?.value || '';
  const loading  = document.getElementById('vr-loading');
  const empty    = document.getElementById('vr-empty');
  const grid     = document.getElementById('vr-grid');
  const summary  = document.getElementById('vr-summary');

  const filtered = _vrBaselines.filter(b => {
    const matchText = !search || b.testName?.toLowerCase().includes(search) || b.locatorName?.toLowerCase().includes(search);
    const matchStat = !status || b.status === status;
    return matchText && matchStat;
  });

  const approved = _vrBaselines.filter(b => b.status === 'approved').length;
  const pending  = _vrBaselines.filter(b => b.status === 'pending-review').length;
  if (summary) {
    summary.innerHTML = `
      <span>Total: <strong>${_vrBaselines.length}</strong></span>
      <span style="color:#4ec9b0">Approved: <strong>${approved}</strong></span>
      ${pending ? `<span style="color:#f48771">Pending Review: <strong>${pending}</strong></span>` : ''}
    `;
  }

  loading.style.display = 'none';
  if (!filtered.length) {
    empty.style.display = 'block';
    grid.style.display  = 'none';
    return;
  }
  empty.style.display = 'none';
  grid.style.display  = 'grid';
  grid.innerHTML = filtered.map(b => vrCard(b)).join('');
}

function vrCard(b) {
  const statusColor = b.status === 'approved' ? '#4ec9b0' : b.status === 'pending-review' ? '#f48771' : '#858585';
  const statusLabel = b.status === 'approved' ? 'Approved' : b.status === 'pending-review' ? 'Pending Review' : 'No Baseline';
  const diffPct     = b.diffPct != null ? `${b.diffPct}% diff` : '';
  const lastRun     = b.lastRunAt ? new Date(b.lastRunAt).toLocaleString() : 'Never';
  const imgBase     = `/api/visual-baselines/${encodeURIComponent(b.id)}/image`;

  return `
    <div class="card" style="padding:0;overflow:hidden;border:1px solid var(--neutral-300)">
      <!-- Header -->
      <div style="padding:10px 14px;background:var(--neutral-100);border-bottom:1px solid var(--neutral-300);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div>
          <div style="font-size:12.5px;font-weight:700;color:var(--neutral-800);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(b.testName)}">${escHtml(b.testName)}</div>
          <div style="font-size:11.5px;color:var(--neutral-500);margin-top:2px">${escHtml(b.locatorName)}</div>
        </div>
        <span style="font-size:11px;font-weight:700;color:${statusColor};background:${statusColor}22;padding:2px 8px;border-radius:10px;white-space:nowrap">${statusLabel}${diffPct ? ' · ' + diffPct : ''}</span>
      </div>

      <!-- Image trio -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;background:#1e1e1e">
        ${vrThumb(imgBase + '?type=baseline', 'Baseline')}
        ${vrThumb(imgBase + '?type=actual', 'Actual')}
        ${b.status === 'pending-review' ? vrThumb(imgBase + '?type=diff', 'Diff') : `<div style="display:flex;align-items:center;justify-content:center;padding:10px;color:#555;font-size:11px">No diff</div>`}
      </div>

      <!-- Meta + actions -->
      <div style="padding:10px 14px">
        <div style="font-size:11.5px;color:var(--neutral-500);margin-bottom:10px">Last run: ${lastRun}${b.width ? ` · ${b.width}×${b.height}` : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${(!isViewer() && b.status === 'pending-review') ? `<button class="btn btn-primary btn-sm" onclick="vrApprove('${b.id}')">&#10003; Approve</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="vrViewDiff('${b.id}')">&#128247; View Images</button>
          ${isViewer() ? '' : `<button class="btn btn-outline btn-sm" style="color:#f48771;border-color:#f48771" onclick="vrDelete('${b.id}', '${escHtml(b.testName)}')">&#128465; Delete</button>`}
        </div>
      </div>
    </div>
  `;
}

function vrThumb(src, label) {
  return `
    <div style="position:relative;cursor:pointer" onclick="window.open('${src}','_blank')">
      <img src="${src}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
           style="width:100%;height:100px;object-fit:contain;display:block;background:#1e1e1e">
      <div style="display:none;align-items:center;justify-content:center;height:100px;color:#555;font-size:11px">${label}: none</div>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;text-align:center;padding:2px">${label}</div>
    </div>`;
}

async function vrApprove(id) {
  if (!confirm('Approve this baseline? The current "actual" screenshot will become the new baseline.')) return;
  try {
    const res = await fetch(`/api/visual-baselines/${encodeURIComponent(id)}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: currentUser?.username || 'ui' })
    });
    const d = await res.json();
    if (d.ok) { await vrLoad(); }
    else alert('Approve failed: ' + (d.error || 'unknown'));
  } catch (e) { alert('Approve failed: ' + e.message); }
}

async function vrDelete(id, name) {
  if (!confirm(`Delete baseline for "${name}"?\n\nThe next test run will create a fresh baseline.`)) return;
  try {
    const res = await fetch(`/api/visual-baselines/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.ok) { await vrLoad(); }
    else alert('Delete failed: ' + (d.error || 'unknown'));
  } catch (e) { alert('Delete failed: ' + e.message); }
}

function vrViewDiff(id) {
  const b = _vrBaselines.find(x => x.id === id);
  if (!b) return;
  const imgBase = `/api/visual-baselines/${encodeURIComponent(id)}/image`;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Visual Diff — ${escHtml(b.testName)}</title>
  <style>body{margin:0;background:#1e1e1e;font-family:sans-serif;color:#ccc}
  .hdr{padding:16px;background:#252526;border-bottom:1px solid #333;display:flex;align-items:center;gap:16px}
  .hdr h2{margin:0;font-size:16px}.meta{font-size:12px;color:#888}
  .imgs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;height:calc(100vh - 70px)}
  .col{display:flex;flex-direction:column;border-right:1px solid #333}
  .col:last-child{border-right:none}
  .col-hdr{padding:8px 12px;font-size:12px;font-weight:700;background:#2d2d2d;text-align:center}
  .col img{width:100%;flex:1;object-fit:contain;background:#1a1a1a}
  </style></head><body>
  <div class="hdr"><h2>&#128247; Visual Diff</h2>
  <div class="meta">${escHtml(b.testName)} · ${escHtml(b.locatorName)}${b.diffPct != null ? ' · ' + b.diffPct + '% diff' : ''}</div></div>
  <div class="imgs">
  <div class="col"><div class="col-hdr">Baseline (approved)</div><img src="${imgBase}?type=baseline" onerror="this.alt='No baseline'"></div>
  <div class="col"><div class="col-hdr">Actual (last run)</div><img src="${imgBase}?type=actual" onerror="this.alt='No actual'"></div>
  <div class="col"><div class="col-hdr">Diff (red = changed)</div><img src="${imgBase}?type=diff" onerror="this.alt='No diff'"></div>
  </div></body></html>`);
  win.document.close();
}
