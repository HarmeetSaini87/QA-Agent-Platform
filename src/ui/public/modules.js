/**
 * modules.js
 * Admin Panel, Projects, Locator Repo, Common Functions, Auth check/logout
 * Loaded after app.js in index.html
 */
'use strict';

function _escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Theme toggle ───────────────────────────────────────────────────────────────

function toggleTheme() {
  const body = document.body;
  const current = body.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  body.setAttribute('data-theme', next);
  localStorage.setItem('qa-theme', next);
}

function initTheme() {
  const saved = localStorage.getItem('qa-theme');
  if (saved) {
    document.body.setAttribute('data-theme', saved);
  } else if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    document.body.setAttribute('data-theme', 'light');
  }
}

// ── Auth bootstrap ─────────────────────────────────────────────────────────────

let currentUser = null;   // { userId, username, role }

async function authBootstrap() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) { window.location.href = '/login'; return; }
    currentUser = await res.json();
    document.body.classList.add('auth-checked');
    initTheme();
    document.getElementById('sidebar-username').textContent = currentUser.username;
    document.getElementById('sidebar-role').textContent = currentUser.role;

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
    '#btn-new-script, #btn-new-suite, #btn-add-locator, #loc-btn-delete-selected, #btn-new-function, #btn-add-cd, ' +
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

function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Admin sub-tab switcher ─────────────────────────────────────────────────────

function adminSubTab(name, btn) {
  document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`admin-${name}`).classList.add('active');
  if (name === 'users') usersLoad();
  if (name === 'audit') auditLoad();
  if (name === 'settings') settingsLoad();
  if (name === 'license') licenseLoad();
  if (name === 'apikeys') apikeyLoad();
}

// ── Toast notifications ────────────────────────────────────────────────────────

function showToast(type, msg, ms) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-hide');
    setTimeout(() => t.remove(), 300);
  }, ms || 3500);
}

// ── Client-side export ─────────────────────────────────────────────────────────

function downloadCSV(filename, headers, rows) {
  const esc = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [headers.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
// ══════════════════════════════════════════════════════════════════════════════
// USER MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

let editingUserId = null;

async function usersLoad() {
  const res = await fetch('/api/admin/users');
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
    document.getElementById('um-email').value = '';
    document.getElementById('um-role').value = 'tester';
    document.getElementById('um-password').value = '';
    document.getElementById('um-force-change').checked = true;
    document.getElementById('um-username').disabled = false;
  }
  openModal('modal-user');
}

async function userEdit(id) {
  const res = await fetch('/api/admin/users');
  const list = await res.json();
  const u = list.find(x => x.id === id);
  if (!u) return;
  editingUserId = id;
  document.getElementById('user-modal-title').textContent = 'Edit User';
  document.getElementById('um-username').value = u.username;
  document.getElementById('um-username').disabled = true;
  document.getElementById('um-email').value = u.email || '';
  document.getElementById('um-role').value = u.role;
  document.getElementById('um-password').value = '';
  document.getElementById('um-force-change').checked = !!u.forcePasswordChange;
  modClearAlert('user-modal-alert');
  openModal('modal-user');
}

async function userSave() {
  modClearAlert('user-modal-alert');
  const body = {
    username: document.getElementById('um-username').value.trim(),
    email: document.getElementById('um-email').value.trim(),
    role: document.getElementById('um-role').value,
    password: document.getElementById('um-password').value,
    forcePasswordChange: document.getElementById('um-force-change').checked,
  };
  if (!body.username) { modAlert('user-modal-alert', 'error', 'Username is required'); return; }
  if (!editingUserId && !body.password) { modAlert('user-modal-alert', 'error', 'Password is required for new users'); return; }

  const method = editingUserId ? 'PUT' : 'POST';
  const url = editingUserId ? `/api/admin/users/${editingUserId}` : '/api/admin/users';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('user-modal-alert', 'error', data.error || 'Error saving user'); return; }
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
let _auditAllEntries = [];

async function auditLoad(page = 1) {
  auditPage = page;
  const res = await fetch(`/api/admin/audit?page=${page}&size=50`);
  const data = await res.json();
  _auditAllEntries = data.entries || [];
  _auditRender(_auditAllEntries, data.total, data.size, page);
}

function auditApplyFilter() {
  const actionF = (document.getElementById('audit-filter-action')?.value || '').toLowerCase();
  const userF   = (document.getElementById('audit-filter-user')?.value || '').toLowerCase();
  const filtered = _auditAllEntries.filter(e => {
    if (actionF && !(e.action || '').toLowerCase().includes(actionF)) return false;
    if (userF   && !(e.username || '').toLowerCase().includes(userF))  return false;
    return true;
  });
  _auditRender(filtered, filtered.length, 50, 1);
}

function auditResetFilter() {
  const af = document.getElementById('audit-filter-action');
  const uf = document.getElementById('audit-filter-user');
  if (af) af.value = '';
  if (uf) uf.value = '';
  auditLoad(1);
}

function _auditActionBadge(action) {
  var a = action || '';
  var bg, color;
  if (a.includes('LOGIN_SUCCESS'))       { bg = 'rgba(22,163,74,.12)';  color = '#16a34a'; }
  else if (a.includes('LOGOUT'))         { bg = 'rgba(107,114,128,.12)'; color = '#6b7280'; }
  else if (a.includes('FAIL') || a.includes('ERROR') || a.includes('DENIED')) { bg = 'rgba(220,38,38,.1)'; color = '#dc2626'; }
  else if (a.includes('CREATE') || a.includes('CREATED')) { bg = 'rgba(37,99,235,.1)';  color = '#2563eb'; }
  else if (a.includes('DELETE') || a.includes('DELETED')) { bg = 'rgba(220,38,38,.08)'; color = '#b91c1c'; }
  else if (a.includes('RUN') || a.includes('EXEC'))       { bg = 'rgba(124,58,237,.1)'; color = '#7c3aed'; }
  else if (a.includes('UPDATE') || a.includes('EDIT'))    { bg = 'rgba(180,83,9,.1)';   color = '#b45309'; }
  else if (a.includes('DEBUG'))          { bg = 'rgba(8,145,178,.1)';  color = '#0891b2'; }
  else                                   { bg = 'rgba(107,114,128,.08)'; color = 'var(--text-muted)'; }
  return '<span style="font-size:11px;padding:2px 7px;border-radius:4px;font-weight:600;background:' + bg + ';color:' + color + '">' + escHtml(a) + '</span>';
}

function _auditModuleLabel(resourceType) {
  var map = {
    'script': 'Test Scripts', 'suite': 'Test Suites', 'execution': 'Execution',
    'api-collection': 'API Collections', 'api-suite': 'API Suites',
    'api-intelligence': 'AI Intelligence', 'api-run': 'API Runs',
    'user': 'Users', 'project': 'Projects', 'environment': 'Environments',
    'locator': 'Locators', 'function': 'Functions', 'jira': 'Jira',
    'healing': 'Self-Healing', 'governance': 'Governance'
  };
  if (!resourceType) return '—';
  return map[resourceType] || escHtml(resourceType);
}

function _auditRender(entries, total, size, page) {
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;

  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:16px;">No audit entries found.</td></tr>';
  } else {
    tbody.innerHTML = entries.map(e => {
      var details = e.details ? escHtml(String(e.details).slice(0, 80)) + (String(e.details).length > 80 ? '…' : '') : '—';
      return '<tr>'
        + '<td style="white-space:nowrap;font-size:12px">' + formatDate(e.createdAt) + '</td>'
        + '<td style="font-size:12px">' + escHtml(e.username || '—') + '</td>'
        + '<td>' + _auditActionBadge(e.action) + '</td>'
        + '<td style="font-size:12px">' + _auditModuleLabel(e.resourceType) + '</td>'
        + '<td style="font-size:12px;color:var(--text-muted)">' + escHtml(e.ip || '—') + '</td>'
        + '<td style="font-size:11px;color:var(--text-muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(e.details || '') + '">' + details + '</td>'
        + '</tr>';
    }).join('');
  }

  const pg = document.getElementById('audit-pagination');
  if (pg) {
    const totalPages = Math.max(1, Math.ceil(total / size));
    pg.innerHTML = `
      <button class="tbl-btn" ${page <= 1 ? 'disabled' : ''} onclick="auditLoad(${page - 1})">← Prev</button>
      <span style="font-size:12px;color:var(--neutral-500)">Page ${page} / ${totalPages} &nbsp;(${total} entries)</span>
      <button class="tbl-btn" ${page >= totalPages ? 'disabled' : ''} onclick="auditLoad(${page + 1})">Next →</button>`;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

// NL provider metadata — loaded from server on settings open
let _nlProviders = [];

async function settingsLoad() {
  const res = await fetch('/api/admin/settings');
  const data = await res.json();
  document.getElementById('set-app-name').value = data.appName ?? '';
  document.getElementById('set-timeout').value = data.sessionTimeoutMinutes ?? 60;
  document.getElementById('set-max-logins').value = data.maxFailedLogins ?? 5;
  document.getElementById('set-allow-reg').checked = !!data.allowRegistration;

  // Load NL provider metadata then restore saved settings
  try {
    const pr = await fetch('/api/nl-providers');
    if (pr.ok) _nlProviders = await pr.json();
  } catch { }

  const provSel = document.getElementById('set-nl-provider');
  if (provSel && data.nlProvider) provSel.value = data.nlProvider;
  nlProviderChanged(data);  // pass saved data to pre-fill fields

  const maxRowsEl = document.getElementById('set-data-file-max-rows');
  if (maxRowsEl) maxRowsEl.value = data.dataFileMaxRows ?? 500;

  notifLoad(data.notifications ?? {});
  if (typeof jiraConfigLoad === 'function') jiraConfigLoad();
  if (typeof nlAliasLoad === 'function') nlAliasLoad();
}

async function settingsSave() {
  modClearAlert('settings-alert');
  const keyVal = document.getElementById('set-nl-key')?.value.trim();
  const customModel = document.getElementById('set-nl-model-custom')?.value.trim();
  const selectModel = document.getElementById('set-nl-model-select')?.value || '';
  const body = {
    appName: document.getElementById('set-app-name').value.trim(),
    sessionTimeoutMinutes: parseInt(document.getElementById('set-timeout').value) || 60,
    maxFailedLogins: parseInt(document.getElementById('set-max-logins').value) || 5,
    allowRegistration: document.getElementById('set-allow-reg').checked,
    dataFileMaxRows: parseInt(document.getElementById('set-data-file-max-rows')?.value) || 500,
    nlProvider: document.getElementById('set-nl-provider')?.value || '',
    nlModel: customModel || selectModel || '',
    nlBaseUrl: document.getElementById('set-nl-baseurl')?.value.trim() || '',
    ...(keyVal ? { nlApiKey: keyVal } : {}),
  };
  const res = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) {
    modAlert('settings-alert', 'success', 'Settings saved successfully');
    if (keyVal) {
      const el = document.getElementById('set-nl-key');
      if (el) { el.value = ''; el.placeholder = '●●●●●●●●●●●● (saved)'; }
      const hint = document.getElementById('nl-key-set-hint');
      if (hint) hint.style.display = '';
    }
    settingsLoad();
  } else {
    modAlert('settings-alert', 'error', data.error || 'Error saving settings');
  }
}

function toggleApiKeyVisibility() {
  const el = document.getElementById('set-nl-key');
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

function nlProviderChanged(savedData) {
  const provId = document.getElementById('set-nl-provider')?.value || '';
  const prov = _nlProviders.find(p => p.id === provId);

  const helpEl = document.getElementById('nl-help-text');
  const keyField = document.getElementById('nl-key-field');
  const urlField = document.getElementById('nl-url-field');
  const mdlField = document.getElementById('nl-model-field');
  const statusEl = document.getElementById('set-nl-status');

  if (!provId || !prov) {
    if (helpEl) { helpEl.style.display = 'none'; helpEl.textContent = ''; }
    if (keyField) keyField.style.display = 'none';
    if (urlField) urlField.style.display = 'none';
    if (mdlField) mdlField.style.display = 'none';
    if (statusEl) { statusEl.textContent = 'NL Suggestion disabled.'; statusEl.style.color = 'var(--neutral-400)'; }
    return;
  }

  // Help text
  if (helpEl) { helpEl.textContent = prov.helpText || ''; helpEl.style.display = ''; }

  // API Key field
  if (keyField) {
    keyField.style.display = prov.needsKey ? '' : 'none';
    const keyInput = document.getElementById('set-nl-key');
    if (keyInput && prov.keyPlaceholder) keyInput.placeholder = prov.keyPlaceholder;
    const hint = document.getElementById('nl-key-set-hint');
    if (hint) hint.style.display = (savedData?.nlApiKeySet && prov.needsKey) ? '' : 'none';
  }

  // Base URL field
  if (urlField) {
    urlField.style.display = prov.needsUrl ? '' : 'none';
    const urlInput = document.getElementById('set-nl-baseurl');
    if (urlInput) {
      if (prov.urlPlaceholder) urlInput.placeholder = prov.urlPlaceholder;
      if (savedData?.nlBaseUrl && !urlInput.value) urlInput.value = savedData.nlBaseUrl;
    }
  }

  // Model field
  if (mdlField) {
    mdlField.style.display = '';
    const sel = document.getElementById('set-nl-model-select');
    const customInput = document.getElementById('set-nl-model-custom');
    if (sel) {
      sel.innerHTML = prov.modelOptions.map(o =>
        `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`
      ).join('') || '<option value="">— type model name below —</option>';
      if (savedData?.nlModel) {
        const match = prov.modelOptions.find(o => o.value === savedData.nlModel);
        if (match) sel.value = savedData.nlModel;
        else if (customInput) customInput.value = savedData.nlModel;
      } else {
        sel.value = prov.defaultModel || (prov.modelOptions[0]?.value || '');
      }
    }
  }

  // Status
  if (statusEl) {
    const keyOk = !prov.needsKey || savedData?.nlApiKeySet;
    const urlOk = !prov.needsUrl || (savedData?.nlBaseUrl || provId === 'ollama');
    if (keyOk && urlOk) {
      statusEl.textContent = `✓ ${prov.label} configured — NL Suggestion active`;
      statusEl.style.color = '#4ec9b0';
    } else {
      statusEl.textContent = `Configure credentials above then Save Settings to activate.`;
      statusEl.style.color = 'var(--neutral-400)';
    }
  }
}

function nlModelSelectChanged() {
  const sel = document.getElementById('set-nl-model-select');
  const custom = document.getElementById('set-nl-model-custom');
  if (sel?.value && custom) custom.value = '';
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
  const onA = document.getElementById('notif-on-always'); if (onA) onA.checked = !!n.notifyOnAlways;
  // Email
  const emailEn = document.getElementById('notif-email-enabled'); if (emailEn) { emailEn.checked = !!n.emailEnabled; notifToggleSection('email', !!n.emailEnabled); }
  document.getElementById('notif-smtp-host').value = n.smtpHost ?? '';
  document.getElementById('notif-smtp-port').value = n.smtpPort ?? 587;
  document.getElementById('notif-smtp-user').value = n.smtpUser ?? '';
  document.getElementById('notif-smtp-pass').value = n.smtpPass ?? '';
  document.getElementById('notif-email-from').value = n.emailFrom ?? '';
  document.getElementById('notif-email-to').value = n.emailTo ?? '';
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
    notifyOnAlways: c('notif-on-always'),
    emailEnabled: c('notif-email-enabled'),
    smtpHost: v('notif-smtp-host').trim(),
    smtpPort: parseInt(v('notif-smtp-port')) || 587,
    smtpSecure: c('notif-smtp-secure'),
    smtpUser: v('notif-smtp-user').trim(),
    smtpPass: v('notif-smtp-pass'),
    emailFrom: v('notif-email-from').trim(),
    emailTo: v('notif-email-to').trim(),
    slackEnabled: c('notif-slack-enabled'),
    slackWebhook: v('notif-slack-webhook').trim(),
    teamsEnabled: c('notif-teams-enabled'),
    teamsWebhook: v('notif-teams-webhook').trim(),
  };
}

async function notifSave() {
  modClearAlert('notif-alert');
  const body = { notifications: notifCollect() };
  const res = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) modAlert('notif-alert', 'success', 'Notification settings saved');
  else modAlert('notif-alert', 'error', data.error || 'Error saving');
}

async function notifTest() {
  modClearAlert('notif-alert');
  modAlert('notif-alert', 'info', 'Sending test notification…');
  const res = await fetch('/api/admin/settings/test-notification', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.success) {
    modAlert('notif-alert', 'success', 'Test notification sent successfully to all enabled channels');
  } else {
    const errs = Object.entries(data.errors || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ');
    modAlert('notif-alert', 'error', errs || data.error || 'Test notification failed — check server logs');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════════════════════════════
// Common Data
// ══════════════════════════════════════════════════════════════════════════════


// ── NL Alias Map ──────────────────────────────────────────────────────────

let _nlAliasData = {};
let _nlAliasPage = 0;
const _NL_ALIAS_PAGE_SIZE = 20;
let _nlAliasSearch = '';

function _nlAliasFilteredEntries() {
  const q = _nlAliasSearch.toLowerCase().trim();
  const all = Object.entries(_nlAliasData);
  if (!q) return all;
  return all.filter(([loc, phrases]) =>
    loc.toLowerCase().includes(q) ||
    (Array.isArray(phrases) && phrases.some(p => p.toLowerCase().includes(q)))
  );
}

function _nlAliasRender() {
  const listEl = document.getElementById('nl-alias-list');
  const infoEl = document.getElementById('nl-alias-info');
  if (!listEl) return;

  const filtered = _nlAliasFilteredEntries();
  const total    = filtered.length;
  const pages    = Math.ceil(total / _NL_ALIAS_PAGE_SIZE) || 1;
  _nlAliasPage   = Math.min(_nlAliasPage, pages - 1);
  const slice    = filtered.slice(_nlAliasPage * _NL_ALIAS_PAGE_SIZE, (_nlAliasPage + 1) * _NL_ALIAS_PAGE_SIZE);

  if (infoEl) {
    const start = total ? _nlAliasPage * _NL_ALIAS_PAGE_SIZE + 1 : 0;
    const end   = Math.min((_nlAliasPage + 1) * _NL_ALIAS_PAGE_SIZE, total);
    infoEl.textContent = total ? `Showing ${start}–${end} of ${total}` : 'No matches.';
  }

  if (!total) {
    listEl.innerHTML = '<span style="font-size:12px;color:var(--neutral-500)">No aliases yet. Add a row below.</span>';
    _nlAliasPagRender(0, 0);
    return;
  }

  // find original key index for rename/update (search may reorder)
  listEl.innerHTML = slice.map(([loc, phrases]) => {
    const escapedLoc     = _escHtml(loc);
    const escapedPhrases = _escHtml(Array.isArray(phrases) ? phrases.join(', ') : '');
    return `
      <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:6px;align-items:center;margin-bottom:5px">
        <input class="fm-input" style="font-size:12px" value="${escapedLoc}"
          placeholder="Locator Name (exact)"
          data-orig="${escapedLoc}"
          onchange="nlAliasRenameKey(this.dataset.orig, this.value); this.dataset.orig=this.value" />
        <input class="fm-input" style="font-size:12px" value="${escapedPhrases}"
          placeholder="alias one, alias two, alias three"
          onchange="nlAliasUpdatePhrases('${escapedLoc}', this.value)" />
        <button class="btn btn-outline btn-sm" style="color:#f48771;border-color:#f48771;padding:2px 8px;min-width:28px"
          onclick="nlAliasDeleteRow('${escapedLoc}')">✕</button>
      </div>`;
  }).join('');

  _nlAliasPagRender(pages, _nlAliasPage);
}

function _nlAliasPagRender(pages, current) {
  const pagEl = document.getElementById('nl-alias-pagination');
  if (!pagEl) return;
  if (pages <= 1) { pagEl.innerHTML = ''; return; }
  pagEl.innerHTML = `
    <button class="btn btn-outline btn-sm" ${current === 0 ? 'disabled' : ''}
      onclick="_nlAliasPage=${current-1};_nlAliasRender()">&#8592; Prev</button>
    <span style="font-size:12px;color:var(--neutral-400)">Page ${current+1} / ${pages}</span>
    <button class="btn btn-outline btn-sm" ${current >= pages-1 ? 'disabled' : ''}
      onclick="_nlAliasPage=${current+1};_nlAliasRender()">Next &#8594;</button>`;
}

async function nlAliasLoad() {
  try {
    const res = await fetch('/api/nl/aliases');
    if (!res.ok) return;
    _nlAliasData = await res.json();
    _nlAliasPage = 0;
    _nlAliasRender();
  } catch { /* silently ignore */ }
}

function nlAliasSearch(q) {
  _nlAliasSearch = q;
  _nlAliasPage   = 0;
  _nlAliasRender();
}

function nlAliasRenameKey(oldKey, newKey) {
  newKey = newKey.trim();
  if (!newKey || newKey === oldKey || !Object.prototype.hasOwnProperty.call(_nlAliasData, oldKey)) return;
  const rebuilt = {};
  for (const [k, v] of Object.entries(_nlAliasData)) rebuilt[k === oldKey ? newKey : k] = v;
  _nlAliasData = rebuilt;
}

function nlAliasUpdatePhrases(key, raw) {
  if (!Object.prototype.hasOwnProperty.call(_nlAliasData, key)) return;
  _nlAliasData[key] = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
}

function nlAliasDeleteRow(key) {
  delete _nlAliasData[key];
  _nlAliasRender();
}

function nlAliasAddRow() {
  const locEl = document.getElementById('nl-alias-new-loc');
  const phEl  = document.getElementById('nl-alias-new-phrases');
  if (!locEl || !phEl) return;
  const loc     = locEl.value.trim();
  const phrases = phEl.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
  if (!loc) { locEl.focus(); return; }
  _nlAliasData[loc] = phrases;
  locEl.value       = '';
  phEl.value        = '';
  _nlAliasSearch    = '';
  _nlAliasPage      = 0;
  const searchEl = document.getElementById('nl-alias-search');
  if (searchEl) searchEl.value = '';
  _nlAliasRender();
}

async function nlAliasSave() {
  try {
    const res = await fetch('/api/nl/aliases', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_nlAliasData),
    });
    const data = await res.json();
    const resultEl = document.getElementById('nl-alias-test-result');
    if (resultEl) {
      resultEl.textContent = res.ok ? '✓ Saved' : ('✗ ' + (data.error || 'Error'));
      resultEl.style.color = res.ok ? '#4ec9b0' : '#f48771';
      setTimeout(() => { resultEl.textContent = ''; resultEl.style.color = ''; }, 2000);
    }
  } catch {
    const resultEl = document.getElementById('nl-alias-test-result');
    if (resultEl) { resultEl.textContent = '✗ Network error'; resultEl.style.color = '#f48771'; }
  }
}

function nlAliasTest() {
  const input = document.getElementById('nl-alias-test-input');
  const resultEl = document.getElementById('nl-alias-test-result');
  if (!input || !input.value.trim() || !resultEl) return;
  const phrase = input.value.trim().toLowerCase().replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim();
  // direct alias map lookup — check if phrase matches any alias for any locator
  let matched = null;
  for (const [loc, aliases] of Object.entries(_nlAliasData)) {
    if (!Array.isArray(aliases)) continue;
    for (const alias of aliases) {
      const normAlias = alias.toLowerCase().replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim();
      if (normAlias === phrase) { matched = loc; break; }
    }
    if (matched) break;
  }
  try {
    if (matched) {
      resultEl.textContent = `→ ${matched}`;
      resultEl.style.color = '#4ec9b0';
    } else {
      resultEl.textContent = 'No match';
      resultEl.style.color = 'var(--neutral-500)';
    }
  } catch {
    resultEl.textContent = '✗ Network error';
    resultEl.style.color = '#f48771';
  }
}

// ── Server Restart (dev convenience — monitor auto-restores within 30s) ──────

async function adminRestartServer() {
  const btn = document.getElementById('btn-restart-server');
  if (!confirm('Restart the server? It will be unavailable for ~30 seconds while the monitor restores it.')) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Restarting…'; }
  try {
    await fetch('/api/admin/restart-server', { method: 'POST' });
  } catch { /* expected — server dies mid-response */ }
  if (btn) btn.textContent = '✓ Restarting — page will reload';
  // Poll until server is back, then reload
  const poll = setInterval(async () => {
    try {
      const r = await fetch('/api/health');
      if (r.ok) { clearInterval(poll); window.location.reload(); }
    } catch { /* still down */ }
  }, 2000);
}
let editingCdId = null;
let allCommonData = [];
let _cdPage = 0;
const CD_PAGE_SIZE = 10;

function _cdPopulateEnvDropdowns() {
  const proj = _currentProjectData();
  const envs = proj?.environments || [];
  const opts = envs.map(e => `<option value="${escHtml(e.name)}" data-url="${escHtml(e.url || '')}">${escHtml(e.name)}</option>`).join('');

  const filter = document.getElementById('cd-env-filter');
  if (filter) { filter.innerHTML = '<option value="">All Environments</option>' + opts; }

  const modal = document.getElementById('cd-env');
  if (modal) { modal.innerHTML = '<option value="">— Select Environment —</option>' + opts; }

  // clear URL hints on project switch
  const fu = document.getElementById('cd-env-filter-url');
  if (fu) fu.textContent = '';
  const mu = document.getElementById('cd-env-url');
  if (mu) mu.textContent = '';
}

function _cdShowEnvUrl(selectId, labelId) {
  const sel = document.getElementById(selectId);
  const lbl = document.getElementById(labelId);
  if (!sel || !lbl) return;
  const opt = sel.options[sel.selectedIndex];
  const url = opt?.dataset?.url || '';
  lbl.textContent = url || '';
}

async function cdLoad() {
  const tbody = document.getElementById('cd-tbody');
  if (!tbody) return;
  if (!currentProjectId) {
    allCommonData = [];
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:20px">Select a project first.</td></tr>';
    document.getElementById('cd-pagination').innerHTML = '';
    return;
  }
  const env = document.getElementById('cd-env-filter')?.value || '';
  const mod = document.getElementById('cd-module-filter')?.value || '';
  const qs = `?projectId=${encodeURIComponent(currentProjectId)}${env ? '&environment=' + encodeURIComponent(env) : ''}${mod ? '&moduleType=' + encodeURIComponent(mod) : ''}`;
  const res = await fetch(`/api/common-data${qs}`);
  allCommonData = await res.json();
  _cdPage = 0;
  cdRender();
}

function cdRender() {
  const tbody = document.getElementById('cd-tbody');
  const pgEl = document.getElementById('cd-pagination');
  if (!tbody) return;
  const list = allCommonData;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:24px">No data entries yet. Click <strong>+ Add Common Data</strong> to create one.</td></tr>';
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
      ? `<span class="cd-masked-wrap" data-id="${escHtml(d.id)}" style="display:inline-flex;align-items:center;gap:6px">
               <span class="cd-masked-dots" style="letter-spacing:2px;color:var(--neutral-400);font-size:13px">••••••••</span>
               <button class="tbl-btn cd-eye-btn" style="font-size:14px;padding:1px 5px;line-height:1;min-width:26px" title="Show value" onclick="cdToggleReveal(this)">👁</button>
             </span>`
      : `<span title="${escHtml(d.value)}">${escHtml(d.value)}</span>`}
      </td>
      <td><span class="badge badge-${(d.moduleType||'shared') === 'api' ? 'active' : (d.moduleType||'shared') === 'ui' ? 'medium' : 'neutral'}">${(d.moduleType||'shared') === 'api' ? 'API' : (d.moduleType||'shared') === 'ui' ? 'UI / Web' : 'Shared'}</span></td>
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
    const end = Math.min((_cdPage + 1) * CD_PAGE_SIZE, list.length);
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
    document.getElementById('cd-name').value = '';
    document.getElementById('cd-value').value = '';
    document.getElementById('cd-env').value = '';
    const mu = document.getElementById('cd-env-url'); if (mu) mu.textContent = '';
    const modEl = document.getElementById('cd-module');
    if (modEl) modEl.value = 'shared';
    const sensEl = document.getElementById('cd-sensitive');
    if (sensEl) sensEl.checked = false;
  }
  openModal('modal-common-data');
}

async function cdEdit(id) {
  const env = document.getElementById('cd-env-filter')?.value || '';
  const qs = `?projectId=${encodeURIComponent(currentProjectId)}${env ? '&environment=' + encodeURIComponent(env) : ''}`;
  const res = await fetch(`/api/common-data${qs}`);
  const list = await res.json();
  const d = list.find(x => x.id === id);
  if (!d) return;
  editingCdId = id;
  document.getElementById('cd-modal-title').textContent = 'Edit Common Data';
  document.getElementById('cd-name').value = d.dataName;
  // Sensitive values show placeholder — user must re-type to change, or leave to keep existing
  document.getElementById('cd-value').value = d.sensitive ? '' : d.value;
  document.getElementById('cd-value').placeholder = d.sensitive ? 'Leave blank to keep existing value' : '';
  document.getElementById('cd-env').value = d.environment;
  _cdShowEnvUrl('cd-env', 'cd-env-url');
  const modEl = document.getElementById('cd-module');
  if (modEl) modEl.value = d.moduleType || 'shared';
  const sensEl = document.getElementById('cd-sensitive');
  if (sensEl) sensEl.checked = !!d.sensitive;
  modClearAlert('cd-modal-alert');
  openModal('modal-common-data');
}

async function cdSave() {
  modClearAlert('cd-modal-alert');
  const dataName = document.getElementById('cd-name').value.trim();
  const value = document.getElementById('cd-value').value.trim();
  const environment = document.getElementById('cd-env').value;
  const sensitive = !!(document.getElementById('cd-sensitive')?.checked);
  const moduleType = document.getElementById('cd-module')?.value || 'shared';
  if (!dataName) { modAlert('cd-modal-alert', 'error', 'Data Name is required'); return; }
  if (!environment) { modAlert('cd-modal-alert', 'error', 'Environment is required'); return; }
  if (!currentProjectId) { modAlert('cd-modal-alert', 'error', 'Select a project first'); return; }
  // On edit of sensitive entry: if value blank, omit it — server keeps existing encrypted value
  const body = {
    projectId: currentProjectId, dataName, environment, sensitive, moduleType,
    ...(value || !editingCdId ? { value } : {})
  };
  const method = editingCdId ? 'PUT' : 'POST';
  const url = editingCdId ? `/api/common-data/${editingCdId}` : '/api/common-data';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('cd-modal-alert', 'error', data.error || 'Error saving'); return; }
  cdCloseModal();
  await cdLoad();
}

async function cdToggleReveal(btn) {
  const wrap = btn.closest('.cd-masked-wrap');
  const dotsEl = wrap.querySelector('.cd-masked-dots');
  const plainEl = wrap.querySelector('.cd-plain-value');
  const id = wrap.dataset.id;

  // If already revealed — hide it
  if (plainEl) {
    plainEl.remove();
    dotsEl.style.display = '';
    btn.title = 'Show value';
    btn.textContent = '👁';
    clearTimeout(wrap._hideTimer);
    return;
  }

  // Fetch and reveal
  btn.disabled = true;
  const res = await fetch(`/api/common-data/${id}/reveal`);
  btn.disabled = false;
  if (!res.ok) { alert('Could not reveal value'); return; }
  const { value } = await res.json();

  dotsEl.style.display = 'none';
  btn.title = 'Hide value';
  btn.textContent = '🙈';

  const span = document.createElement('span');
  span.className = 'cd-plain-value';
  span.style.cssText = 'font-family:monospace;font-size:12px;background:var(--neutral-100);padding:2px 6px;border-radius:3px';
  span.textContent = value;
  wrap.insertBefore(span, btn);

  // Auto-hide after 15 seconds
  clearTimeout(wrap._hideTimer);
  wrap._hideTimer = setTimeout(() => {
    if (wrap.querySelector('.cd-plain-value')) cdToggleReveal(btn);
  }, 15000);
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
  const res = await fetch(url);
  const list = await res.json();
  const el = document.getElementById('proj-list');
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
            TC Prefix: <strong>${escHtml(p.tcIdPrefix || 'TC')}</strong> &nbsp;·&nbsp; Next ID: <strong>${escHtml(p.tcIdPrefix || 'TC')}-${String(p.tcIdCounter || 1).padStart(2, '0')}</strong>
            ${p.jiraProjectKey ? `&nbsp;·&nbsp; Jira: <strong style="color:var(--primary)">${escHtml(p.jiraProjectKey)}</strong>` : '<span style="color:#f59e0b">&nbsp;·&nbsp; Jira key: not set</span>'}
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
  projTabSwitch('details');
  editingProjectId = id;
  modClearAlert('proj-modal-alert');
  document.getElementById('proj-modal-title').textContent = id ? 'Edit Project' : 'New Project';
  if (!id) {
    document.getElementById('pm-name').value = '';
    document.getElementById('pm-prefix').value = '';
    document.getElementById('pm-desc').value = '';
    document.getElementById('pm-jira-key').value = '';
    document.getElementById('pm-vrt-threshold').value       = 20;
    document.getElementById('pm-vrt-ratio').value            = 5;
    document.getElementById('pm-vrt-maxpx').value            = '';
    document.getElementById('pm-vrt-animations').value       = 'disabled';
    document.getElementById('pm-vrt-scale').value            = 'css';
    document.getElementById('pm-vrt-caret').value            = 'hide';
    document.getElementById('pm-vrt-maskcolor').value        = '#FF00FF';
    document.getElementById('pm-vrt-maskcolor-picker').value = '#FF00FF';
    document.getElementById('pm-vrt-stylepath').value        = '';
    document.getElementById('pm-vrt-timeout').value          = 5000;
    document.getElementById('proj-envs').innerHTML = '';
  }
  openModal('modal-project');
}

async function projEdit(id) {
  const res = await fetch('/api/projects/all');
  const list = await res.json();
  const p = list.find(x => x.id === id);
  if (!p) return;
  editingProjectId = id;
  document.getElementById('proj-modal-title').textContent = 'Edit Project';
  document.getElementById('pm-name').value = p.name;
  document.getElementById('pm-prefix').value = p.tcIdPrefix || '';
  document.getElementById('pm-desc').value = p.description || '';
  document.getElementById('pm-jira-key').value = p.jiraProjectKey || '';
  // Populate VRT config
  const vrt = p.vrtConfig || {};
  document.getElementById('pm-vrt-threshold').value   = vrt.threshold         != null ? Math.round(vrt.threshold * 100)         : 20;
  document.getElementById('pm-vrt-ratio').value       = vrt.maxDiffPixelRatio != null ? Math.round(vrt.maxDiffPixelRatio * 100) : 5;
  document.getElementById('pm-vrt-maxpx').value       = vrt.maxDiffPixels     != null ? vrt.maxDiffPixels                       : '';
  document.getElementById('pm-vrt-animations').value  = vrt.animations  || 'disabled';
  document.getElementById('pm-vrt-scale').value       = vrt.scale       || 'css';
  document.getElementById('pm-vrt-caret').value       = vrt.caret       || 'hide';
  const mc = vrt.maskColor || '#FF00FF';
  document.getElementById('pm-vrt-maskcolor').value        = mc;
  document.getElementById('pm-vrt-maskcolor-picker').value = mc;
  document.getElementById('pm-vrt-stylepath').value   = vrt.stylePath   || '';
  document.getElementById('pm-vrt-timeout').value     = vrt.timeout     != null ? vrt.timeout : 5000;
  const envsEl = document.getElementById('proj-envs');
  envsEl.innerHTML = '';
  (p.environments || []).forEach(e => projAddEnv(e.id, e.name, e.url));
  modClearAlert('proj-modal-alert');
  openModal('modal-project');
  projTabSwitch('details');
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
  const name = document.getElementById('pm-name').value.trim();
  const prefix = document.getElementById('pm-prefix').value.trim().toUpperCase();
  if (!name) { modAlert('proj-modal-alert', 'error', 'Project name is required'); return; }
  if (!prefix) { modAlert('proj-modal-alert', 'error', 'TC ID Prefix is required'); return; }

  const environments = [...document.querySelectorAll('#proj-envs .env-row')].map(row => ({
    id: row.dataset.envId || ('env-' + Date.now() + Math.random()),
    name: row.querySelector('.env-name').value,
    url: row.querySelector('.env-url').value.trim(),
  })).filter(e => e.url);

  const jiraKey = (document.getElementById('pm-jira-key').value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Collect VRT config — only include fields that were explicitly set
  const _vrtNum = (id) => { const v = parseFloat(document.getElementById(id)?.value); return isNaN(v) ? null : v; };
  const _vrtStr = (id) => document.getElementById(id)?.value?.trim() || null;
  const vrtThreshold = _vrtNum('pm-vrt-threshold');
  const vrtRatio     = _vrtNum('pm-vrt-ratio');
  const vrtMaxPx     = _vrtNum('pm-vrt-maxpx');
  const vrtConfig = {
    threshold:         vrtThreshold != null ? vrtThreshold / 100 : 0.2,
    maxDiffPixelRatio: vrtRatio     != null ? vrtRatio     / 100 : 0.05,
    maxDiffPixels:     vrtMaxPx     != null ? vrtMaxPx           : null,
    animations:        document.getElementById('pm-vrt-animations')?.value || 'disabled',
    scale:             document.getElementById('pm-vrt-scale')?.value      || 'css',
    caret:             document.getElementById('pm-vrt-caret')?.value      || 'hide',
    maskColor:         _vrtStr('pm-vrt-maskcolor') || '#FF00FF',
    stylePath:         _vrtStr('pm-vrt-stylepath') || undefined,
    timeout:           _vrtNum('pm-vrt-timeout')   != null ? _vrtNum('pm-vrt-timeout') : undefined,
  };

  const body = {
    name, tcIdPrefix: prefix,
    description: document.getElementById('pm-desc').value.trim(),
    environments,
    jiraProjectKey: jiraKey || null,
    vrtConfig,
  };
  const method = editingProjectId ? 'PUT' : 'POST';
  const apiUrl = editingProjectId ? `/api/projects/${editingProjectId}` : '/api/projects';
  const res = await fetch(apiUrl, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('proj-modal-alert', 'error', data.error || 'Error'); return; }
  projCloseModal();
  await projLoad();
}

async function projDelete(id, name) {
  if (!confirm(`Delete project "${name}"?`)) return;
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  await projLoad();
}

function projTabSwitch(tab) {
  ['details', 'environments', 'components', 'vrt'].forEach(t => {
    document.getElementById(`proj-tab-panel-${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`proj-tab-${t}`).classList.toggle('proj-tab-active', t === tab);
  });
  if (tab === 'components') {
    const pid = editingProjectId;
    if (pid) compLoad(pid);
  }
  // Hide Save button on Components tab — components are saved individually
  const saveBtn = document.getElementById('proj-save-btn');
  if (saveBtn) saveBtn.style.display = tab === 'components' ? 'none' : '';
}

async function compLoad(projectId) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/components`);
  if (!res.ok) return;
  _compDefs = await res.json();

  // Auto-migration: if no components yet and scripts exist with component values, seed them
  const banner = document.getElementById('proj-comp-banner');
  if (_compDefs.length === 0) {
    const sRes = await fetch(`/api/scripts?projectId=${encodeURIComponent(projectId)}`);
    if (sRes.ok) {
      const scripts = await sRes.json();
      const distinct = [...new Set(scripts.map(s => (s.component || '').trim()).filter(Boolean))];
      if (distinct.length > 0) {
        for (const name of distinct) {
          const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/components`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
          });
          if (r.ok) { const d = await r.json(); _compDefs.push(d.comp); }
        }
        if (banner) {
          banner.innerHTML = `<div class="alert alert-info" style="font-size:12.5px">${distinct.length} component(s) imported from existing test scripts. <button class="tbl-btn" onclick="document.getElementById('proj-comp-banner').style.display='none'">Dismiss</button></div>`;
          banner.style.display = '';
        }
      }
    }
  }

  compRender();
}

function compRender() {
  const el = document.getElementById('proj-comp-list');
  if (!el) return;
  if (!_compDefs.length) {
    el.innerHTML = '<div class="builder-hint">No components yet. Click + Add Component to create one.</div>';
    return;
  }
  el.innerHTML = _compDefs.map(c => `
    <div class="comp-row" data-comp-id="${escHtml(c.id)}">
      <span class="comp-row-name" id="comp-name-${escHtml(c.id)}">${escHtml(c.name)}</span>
      <button class="tbl-btn" onclick="compRenameStart('${escHtml(c.id)}')">Rename</button>
      <button class="tbl-btn del" onclick="compDeleteComp('${escHtml(c.id)}','${escHtml(c.name)}')">Delete</button>
    </div>
    <div class="subcomp-list" id="subcomp-list-${escHtml(c.id)}">
      ${c.subcomponents.map(s => `
        <div class="subcomp-row" data-sub-id="${escHtml(s.id)}">
          <span class="subcomp-name">\u00b7 ${escHtml(s.name)}</span>
          <button class="tbl-btn del" onclick="compDeleteSub('${escHtml(c.id)}','${escHtml(s.id)}')">✕</button>
        </div>`).join('')}
      <div style="margin-top:4px">
        <button class="tbl-btn" onclick="compAddSub('${escHtml(c.id)}')">+ Add Subcomponent</button>
      </div>
    </div>`).join('');
}

async function compAddComp() {
  const name = prompt('Component name:');
  if (!name?.trim()) return;
  const pid = editingProjectId;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
  });
  if (!res.ok) { alert('Failed to add component'); return; }
  const data = await res.json();
  _compDefs.push(data.comp);
  compRender();
}

function compRenameStart(compId) {
  const nameEl = document.getElementById(`comp-name-${compId}`);
  if (!nameEl) return;
  const current = nameEl.textContent;
  nameEl.outerHTML = `
    <input id="comp-rename-input-${escHtml(compId)}" class="fm-input" value="${escHtml(current)}" style="flex:1;margin-right:4px" />`;
  // Replace Rename button with Save/Cancel
  const row = document.querySelector(`[data-comp-id="${compId}"]`);
  row.querySelectorAll('button').forEach(b => b.style.display = 'none');
  const saveBtn = document.createElement('button');
  saveBtn.className = 'tbl-btn';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = () => compRenameConfirm(compId);
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'tbl-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => compRender();
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
}

async function compRenameConfirm(compId) {
  const input = document.getElementById(`comp-rename-input-${compId}`);
  const newName = input?.value?.trim();
  if (!newName) { alert('Name cannot be empty'); return; }
  const pid = editingProjectId;
  const comp = _compDefs.find(c => c.id === compId);
  if (!comp) return;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components/${encodeURIComponent(compId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, subcomponents: comp.subcomponents }),
  });
  if (!res.ok) { alert('Failed to rename'); return; }
  comp.name = newName;
  compRender();
}

async function compDeleteComp(compId, compName) {
  if (!confirm(`Remove component "${compName}"? Existing test scripts referencing it will keep their saved value.`)) return;
  const pid = editingProjectId;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components/${encodeURIComponent(compId)}`, { method: 'DELETE' });
  if (!res.ok) { alert('Failed to delete'); return; }
  _compDefs = _compDefs.filter(c => c.id !== compId);
  compRender();
}

async function compAddSub(compId) {
  const name = prompt('Subcomponent name:');
  if (!name?.trim()) return;
  const comp = _compDefs.find(c => c.id === compId);
  if (!comp) return;
  const newSub = { id: 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2), name: name.trim() };
  const updatedSubs = [...comp.subcomponents, newSub];
  const pid = editingProjectId;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components/${encodeURIComponent(compId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: comp.name, subcomponents: updatedSubs }),
  });
  if (!res.ok) { alert('Failed to add subcomponent'); return; }
  const data = await res.json();
  comp.subcomponents = data.comp.subcomponents;
  compRender();
}

async function compDeleteSub(compId, subId) {
  const comp = _compDefs.find(c => c.id === compId);
  if (!comp) return;
  const updatedSubs = comp.subcomponents.filter(s => s.id !== subId);
  const pid = editingProjectId;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components/${encodeURIComponent(compId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: comp.name, subcomponents: updatedSubs }),
  });
  if (!res.ok) { alert('Failed to delete subcomponent'); return; }
  const data = await res.json();
  comp.subcomponents = data.comp.subcomponents;
  compRender();
}

async function seLoadComponents() {
  if (!currentProjectId) { _seCompDefs = []; return; }
  const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/components`);
  _seCompDefs = res.ok ? await res.json() : [];
}

function sePopulateComponent(currentValue) {
  const sel = document.getElementById('se-component');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Component —</option>';
  const knownNames = new Set(_seCompDefs.map(c => c.name));
  _seCompDefs.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  if (currentValue && !knownNames.has(currentValue)) {
    const opt = document.createElement('option');
    opt.value = currentValue;
    opt.textContent = `${currentValue} (legacy)`;
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
  } else {
    sel.value = currentValue || '';
  }
  sePopulateSubcomponent(null);
}

function sePopulateSubcomponent(currentValue) {
  const compSel = document.getElementById('se-component');
  const subSel = document.getElementById('se-subcomponent');
  if (!subSel || !compSel) return;
  const selectedComp = _seCompDefs.find(c => c.name === compSel.value);
  subSel.innerHTML = '<option value="">— Select Subcomponent —</option>';
  if (!selectedComp || !selectedComp.subcomponents.length) {
    if (selectedComp) {
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.textContent = 'No subcomponents defined';
      subSel.appendChild(opt);
    }
    subSel.disabled = !selectedComp;
    return;
  }
  subSel.disabled = false;
  selectedComp.subcomponents.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name;
    subSel.appendChild(opt);
  });
  if (currentValue) subSel.value = currentValue;
}

function seComponentChanged() {
  sePopulateSubcomponent(null);
}

function projCloseModal() { closeModal('modal-project'); editingProjectId = null; }

// ══════════════════════════════════════════════════════════════════════════════
// LOCATOR REPOSITORY
// ══════════════════════════════════════════════════════════════════════════════

let allLocators = [];
let selectedLocators = new Set();
let editingLocatorId = null;
let _locPage = 0;
let LOC_PAGE_SIZE = 10;

async function locatorLoad() {
  if (!currentProjectId) {
    allLocators = [];
    _locPage = 0;
    selectedLocators.clear();
    const tbody = document.getElementById('loc-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">Select a project to view locators.</td></tr>';
    const pg = document.getElementById('loc-pagination');
    if (pg) pg.innerHTML = '';
    return;
  }
  const res = await fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}`);
  allLocators = await res.json();
  _locPage = 0;
  selectedLocators.clear();
  locatorRender();
}

function locatorRender() {
  const nameF = (document.getElementById('loc-filter-name')?.value ?? '').toLowerCase();
  const typeF = (document.getElementById('loc-filter-type')?.value ?? '').toLowerCase();

  const filtered = allLocators.filter(l =>
    (!nameF || l.name.toLowerCase().includes(nameF)) &&
    (!typeF || (l.selectorType || '').toLowerCase() === typeF)
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

    // ── Stability Badge (pill) ────────────────────────────────────────────────
    // Reflects PRIMARY locator health based on REAL test run history.
    // Colour = how many times the primary locator needed auto-repair during runs.
    let stabilityBadge = '';
    {
      const hs = l.healingStats;
      const healCount = hs?.healCount ?? 0;
      const lastHealed = hs?.lastHealedAt ? new Date(hs.lastHealedAt) : null;
      const daysSinceHeal = lastHealed ? Math.floor((Date.now() - lastHealed.getTime()) / 86400000) : null;
      const hasRunData = healCount > 0 || lastHealed != null;

      let bg, border, color, icon, lbl, tipLines;

      if (!hasRunData) {
        // Never run yet — show design-time selector quality as a hint
        const sc = l.importanceScore ?? null;
        bg = '#f3f4f6'; border = '#d1d5db'; color = '#6b7280'; icon = '⚪'; lbl = 'Not Run Yet';
        tipLines = [
          '📋 STABILITY BADGE — Not Run Yet',
          '',
          'This locator has never been used in a test run.',
          'There is no real evidence yet about how reliable it is.',
          '',
          sc != null
            ? `Selector Quality Score: ${sc}/100`
            : 'No quality score available (manually created locator).',
          sc != null && sc >= 80 ? '→ Well-anchored selector (has testid / aria-label / role).' : '',
          sc != null && sc >= 50 && sc < 80 ? '→ Average selector — some identifiers present.' : '',
          sc != null && sc < 50 ? '→ Weak selector — no stable identifiers. Consider adding data-testid to the element.' : '',
          '',
          'Run a test suite to get a real stability rating.',
        ].filter(x => x !== undefined);
      } else if (healCount === 0) {
        bg = '#dcfce7'; border = '#86efac'; color = '#15803d'; icon = '✔'; lbl = 'Stable';
        tipLines = [
          '🟢 STABILITY BADGE — Stable',
          '',
          'This locator has NEVER needed auto-repair across all test runs.',
          'The element is found reliably every time — no fixes were required.',
          '',
          'What this means for you:',
          '→ Safe to use. No action needed.',
          '→ If the app UI changes, this badge will degrade automatically.',
        ];
      } else if (healCount <= 2 && (daysSinceHeal === null || daysSinceHeal > 7)) {
        bg = '#fef9c3'; border = '#fde047'; color = '#a16207'; icon = '⚠'; lbl = `Healed ×${healCount}`;
        tipLines = [
          '🟡 STABILITY BADGE — Healed (Monitor)',
          '',
          `This locator needed auto-repair ${healCount} time${healCount > 1 ? 's' : ''} during test runs.`,
          `Last repaired: ${hs?.lastHealedAt?.slice(0, 10) ?? '—'}`,
          '',
          'What this means:',
          '→ The test kept running by using a fallback locator.',
          '→ The original locator may be drifting as the app UI changes.',
          '',
          'Recommended action:',
          '→ Open the Healing Proposals tab to review what changed.',
          '→ Consider promoting the fallback to primary if it is more stable.',
        ];
      } else {
        bg = '#fee2e2'; border = '#fca5a5'; color = '#b91c1c'; icon = '✖'; lbl = `Fragile ×${healCount}`;
        tipLines = [
          '🔴 STABILITY BADGE — Fragile (Action Required)',
          '',
          `This locator has broken and needed auto-repair ${healCount} time${healCount > 1 ? 's' : ''}.`,
          `Last repaired: ${hs?.lastHealedAt?.slice(0, 10) ?? '—'}`,
          '',
          'What this means:',
          '→ The primary locator keeps failing — the element has changed significantly.',
          '→ Tests are only passing because a fallback selector took over.',
          '→ This is a risk — if fallbacks also break, tests will fail.',
          '',
          'Recommended action:',
          '→ Go to Healing Proposals → Approve Permanent to fix the primary.',
          '→ Or open this locator (Edit) and update the selector manually.',
          '→ Ask the developer to add a data-testid attribute to the element.',
        ];
      }

      const tip = tipLines.join('\n');
      stabilityBadge = `<span title="${escHtml(tip)}"
        style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;
               padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;
               background:${bg};border:1px solid ${border};color:${color};
               cursor:help;white-space:nowrap;letter-spacing:.2px">
        ${icon} ${lbl}
      </span>`;
    }

    // ── Fallbacks chip ────────────────────────────────────────────────────────
    const alts = l.alternatives || [];
    const altCount = alts.length;
    const altChip = altCount
      ? `<span onclick="locatorToggleAlts('${escHtml(l.id)}')"
           id="loc-alt-chip-${escHtml(l.id)}"
           title="${escHtml('FALLBACK LOCATORS — ' + altCount + ' backup selector' + (altCount > 1 ? 's' : '') + ' stored\n\nIf the primary locator above fails during a test run, the system automatically tries these backups in order from highest to lowest confidence.\n\nClick to expand and see each fallback selector and its confidence score.\nYou can also promote any fallback to become the new primary.')}"
           style="display:inline-flex;align-items:center;gap:3px;margin-left:5px;
                  padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;
                  background:#ede9fe;border:1px solid #c4b5fd;color:#6d28d9;
                  cursor:pointer;white-space:nowrap;user-select:none">
          ⛓ ${altCount} fallback${altCount > 1 ? 's' : ''}
        </span>`
      : '';

    // ── Inline fallbacks expansion rows ──────────────────────────────────────
    const altRows = alts.length ? alts
      .slice()
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .map((a, i) => {
        const conf = a.confidence ?? 0;
        // Confidence pill per fallback row
        const confBg = conf >= 80 ? '#dcfce7' : conf >= 60 ? '#fef9c3' : '#fee2e2';
        const confBorder = conf >= 80 ? '#86efac' : conf >= 60 ? '#fde047' : '#fca5a5';
        const confColor = conf >= 80 ? '#15803d' : conf >= 60 ? '#a16207' : '#b91c1c';
        const confLabel = conf >= 80 ? 'High' : conf >= 60 ? 'Medium' : 'Low';
        const confTip = [
          'CONFIDENCE SCORE — ' + conf + '/100 (' + confLabel + ')',
          '',
          'This score shows how reliable this BACKUP selector is expected to be.',
          'It is set at the time the recorder captures the element.',
          '',
          conf >= 80
            ? '✔ High confidence — uses a stable attribute like data-testid or aria-label.\n  Very unlikely to break if the app changes.'
            : conf >= 60
              ? '⚠ Medium confidence — uses a role, label or placeholder.\n  Fairly stable but could break if copy or layout changes.'
              : '✖ Low confidence — uses a structural path (XPath) or name attribute.\n  Will break if the page structure or element position changes.',
          '',
          'Higher score = tried first when primary locator fails.',
          'Lower score = last resort before the test reports a failure.',
        ].join('\n');

        const truncAlt = (a.selector || '').length > 70 ? escHtml((a.selector || '').substring(0, 70)) + '…' : escHtml(a.selector || '');
        const promoteBtn = isViewer() ? '' :
          `<button class="tbl-btn" style="font-size:10px;padding:1px 7px" onclick="locatorPromoteAlt('${escHtml(l.id)}',${i})" title="Set this as the primary locator — current primary moves to fallbacks">Set Primary</button>`;
        return `<tr id="loc-alt-row-${escHtml(l.id)}-${i}" style="display:none;background:var(--neutral-50)">
          <td></td>
          <td colspan="2" style="padding:4px 10px 4px 28px">
            <span style="font-size:10px;color:var(--neutral-400);margin-right:6px">#${i + 1}</span>
            <code style="font-size:11px">${truncAlt}</code>
          </td>
          <td><span class="badge badge-tester" style="font-size:10px">${escHtml(a.selectorType || 'css')}</span></td>
          <td>
            <span title="${escHtml(confTip)}"
              style="display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:20px;
                     font-size:10px;font-weight:700;background:${confBg};border:1px solid ${confBorder};
                     color:${confColor};cursor:help;white-space:nowrap">
              ${conf}/100 · ${confLabel}
            </span>
          </td>
          <td>${promoteBtn}</td>
        </tr>`;
      }).join('') : '';

    const isChecked = selectedLocators.has(l.id) ? 'checked' : '';
    return `<tr>
      <td style="text-align:center"><input type="checkbox" class="loc-row-check" data-id="${escHtml(l.id)}" ${isChecked} onclick="locatorToggleSelection('${escHtml(l.id)}')"></td>
      <td><strong>${escHtml(l.name)}</strong>${autoTag}${stabilityBadge}${altChip}</td>
      <td><code style="font-size:11px">${truncSel}</code></td>
      <td><span class="badge badge-tester">${escHtml(l.selectorType)}</span></td>
      <td>${escHtml(l.description || '—')}</td>
      <td>
        ${isViewer() ? '' : `<button class="tbl-btn" onclick="locatorEdit('${escHtml(l.id)}')">Edit</button>`}
        ${isViewer() ? '' : `<button class="tbl-btn del" onclick="locatorDelete('${escHtml(l.id)}','${escHtml(l.name)}')">Del</button>`}
      </td>
    </tr>${altRows}`;
  }).join('');

  if (!pageItems.length) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">No locators found</td></tr>';

  // Update Select All checkbox state
  const selectAll = document.getElementById('loc-select-all');
  if (selectAll) {
    selectAll.style.visibility = isViewer() ? 'hidden' : 'visible';
    if (!isViewer()) {
      const allOnPageChecked = pageItems.length > 0 && pageItems.every(l => selectedLocators.has(l.id));
      selectAll.checked = allOnPageChecked;
    }
  }
  locatorUpdateSelectionUI();

  // Pagination controls
  const wrap = document.getElementById('loc-pagination');
  if (wrap) {
    const start = filtered.length ? _locPage * LOC_PAGE_SIZE + 1 : 0;
    const end = Math.min((_locPage + 1) * LOC_PAGE_SIZE, filtered.length);
    const rppOpts = [10,25,50,100,200,500].map(n => `<option value="${n}"${LOC_PAGE_SIZE===n?' selected':''}>${n}</option>`).join('');
    wrap.innerHTML = `
      <label style="font-size:12px;color:var(--neutral-500)">Rows per page:
        <select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto" onchange="_locSetPageSize(+this.value)">${rppOpts}</select>
      </label>
      ${totalPages <= 1 ? `<span style="font-size:13px;color:var(--neutral-500)">${start}–${end} of ${filtered.length}</span>` : `
      <button class="tbl-btn" onclick="_locPageGo(-1)" ${_locPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span style="font-size:13px">Page ${_locPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${filtered.length})</span>
      <button class="tbl-btn" onclick="_locPageGo(1)" ${_locPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`}`;
  }
}

// ── Locator sub-tab switching ─────────────────────────────────────────────────
function locSubTab(tab) {
  ['repo', 'proposals', 'heallog'].forEach(t => {
    const panel = document.getElementById(`loc-subpanel-${t}`);
    const btn = document.getElementById(`loc-subtab-${t}`);
    if (panel) panel.style.display = t === tab ? '' : 'none';
    if (btn) btn.classList.toggle('loc-subtab-active', t === tab);
  });
  if (tab === 'proposals') proposalLoad();
  if (tab === 'heallog') healLogLoad();
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
      'auto-applied': `<span class="prop-badge prop-badge-auto">Auto Applied</span>`,
      'pending-review': `<span class="prop-badge prop-badge-pending">Pending Review</span>`,
      'approved': `<span class="prop-badge prop-badge-ok">Approved (Permanent)</span>`,
      'approved-temporary': `<span class="prop-badge" style="background:#d97706;color:#fff">Approved (Temp)</span>`,
      'rejected': `<span class="prop-badge prop-badge-reject">Rejected</span>`,
    }[p.status] || `<span class="prop-badge">${escHtml(p.status)}</span>`;

    const scoreColor = p.confidence >= 75 ? '#4ec9b0' : p.confidence >= 50 ? '#eab308' : '#f48771';
    const truncOld = (p.oldSelector?.length ?? 0) > 50 ? `<span title="${escHtml(p.oldSelector)}">${escHtml(p.oldSelector.substring(0, 50))}…</span>` : escHtml(p.oldSelector || '—');
    const truncNew = (p.newSelector?.length ?? 0) > 50 ? `<span title="${escHtml(p.newSelector)}">${escHtml(p.newSelector.substring(0, 50))}…</span>` : escHtml(p.newSelector || '—');
    const healedAt = p.healedAt ? new Date(p.healedAt).toLocaleString() : '—';
    const usedTag = p.usedInRun
      ? `<span title="This candidate was used to continue test execution during the run" style="font-size:10px;padding:1px 6px;border-radius:8px;background:#d97706;color:#fff;margin-left:4px">Used in run</span>`
      : '';

    const actionBtns = p.status === 'pending-review'
      ? `<div style="display:flex;flex-direction:column;gap:3px">
           <button class="tbl-btn" style="color:#4ec9b0;font-size:11px" onclick="proposalReview('${escHtml(p.id)}','approved')" title="Make this the permanent primary selector">✓ Approve Permanent</button>
           <button class="tbl-btn" style="color:#d97706;font-size:11px" onclick="proposalReview('${escHtml(p.id)}','approved-temporary')" title="Add to fallbacks only — primary selector unchanged">⬡ Approve Temporary</button>
           <button class="tbl-btn del" style="font-size:11px" onclick="proposalReview('${escHtml(p.id)}','rejected')">✗ Reject</button>
         </div>`
      : `<span style="font-size:11px;color:var(--neutral-500)">${escHtml(p.reviewedBy || '')} ${p.reviewedAt ? new Date(p.reviewedAt).toLocaleDateString() : ''}</span>`;

    return `<tr>
      <td><strong>${escHtml(p.locatorName || p.locatorId)}</strong>${usedTag}</td>
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
  const labels = {
    'approved': 'Approve as Permanent? The T3 candidate will become the new primary selector.',
    'approved-temporary': 'Approve as Temporary? The candidate will be added to the fallbacks list. Primary selector unchanged.',
    'rejected': 'Reject this proposal? The candidate will be discarded. Next run will re-trigger T3.',
  };
  if (!confirm(labels[action] || 'Confirm?')) return;
  try {
    const res = await fetch(`/api/proposals/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Review failed'); return; }
    await proposalLoad();
  } catch { alert('Network error'); }
}

function _locPageGo(delta) {
  _locPage += delta;
  locatorRender();
}

function _locSetPageSize(n) {
  LOC_PAGE_SIZE = n;
  _locPage = 0;
  locatorRender();
}

function locatorToggleSelection(id) {
  if (selectedLocators.has(id)) {
    selectedLocators.delete(id);
  } else {
    selectedLocators.add(id);
  }
  locatorRender();
}

function locatorSelectAll(el) {
  const nameF = (document.getElementById('loc-filter-name')?.value ?? '').toLowerCase();
  const typeF = (document.getElementById('loc-filter-type')?.value ?? '').toLowerCase();
  const filtered = allLocators.filter(l =>
    (!nameF || l.name.toLowerCase().includes(nameF)) &&
    (!typeF || (l.selectorType || '').toLowerCase() === typeF)
  );
  const pageItems = filtered.slice(_locPage * LOC_PAGE_SIZE, (_locPage + 1) * LOC_PAGE_SIZE);

  if (el.checked) {
    pageItems.forEach(l => selectedLocators.add(l.id));
  } else {
    pageItems.forEach(l => selectedLocators.delete(l.id));
  }
  locatorRender();
}

function locatorUpdateSelectionUI() {
  const btn = document.getElementById('loc-btn-delete-selected');
  if (btn) {
    btn.style.display = (selectedLocators.size > 0 && !isViewer()) ? '' : 'none';
    btn.textContent = `Delete Selected (${selectedLocators.size})`;
  }
}

async function locatorDeleteSelected() {
  if (isViewer()) return;
  if (!selectedLocators.size) return;
  if (!confirm(`Delete ${selectedLocators.size} selected locator(s)?`)) return;

  const ids = Array.from(selectedLocators);
  const res = await fetch('/api/locators/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });

  if (res.ok) {
    selectedLocators.clear();
    await locatorLoad();
  } else {
    const data = await res.json();
    alert(data.error || 'Failed to delete locators');
  }
}

function locatorOpenModal(id = null) {
  editingLocatorId = id;
  modClearAlert('loc-modal-alert');
  document.getElementById('loc-modal-title').textContent = id ? 'Edit Locator' : 'Add Locator';
  if (!id) {
    ['loc-name', 'loc-selector', 'loc-page', 'loc-desc'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('loc-type').value = 'css';
  }
  openModal('modal-locator');
}

async function locatorEdit(id) {
  const loc = allLocators.find(l => l.id === id);
  if (!loc) return;
  editingLocatorId = id;
  document.getElementById('loc-modal-title').textContent = 'Edit Locator';
  document.getElementById('loc-name').value = loc.name;
  document.getElementById('loc-selector').value = loc.selector;
  document.getElementById('loc-type').value = loc.selectorType;
  document.getElementById('loc-page').value = loc.pageModule || '';
  document.getElementById('loc-desc').value = loc.description || '';
  modClearAlert('loc-modal-alert');
  _locatorEditRenderAlts(loc);
  openModal('modal-locator');
}

function _locatorEditRenderAlts(loc) {
  const container = document.getElementById('loc-alts-section');
  if (!container) return;
  const alts = (loc.alternatives || []).slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  if (!alts.length) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  const tbody = document.getElementById('loc-alts-tbody');
  if (!tbody) return;
  tbody.innerHTML = alts.map((a, i) => {
    const confDot = (a.confidence ?? 0) >= 80 ? '🟢' : (a.confidence ?? 0) >= 60 ? '🟡' : '🔴';
    const truncSel = (a.selector || '').length > 55 ? escHtml((a.selector || '').substring(0, 55)) + '…' : escHtml(a.selector || '');
    return `<tr id="loc-edit-alt-row-${i}">
      <td style="font-size:11px;color:var(--neutral-400);padding:4px 6px">#${i + 1}</td>
      <td style="padding:4px 6px"><code style="font-size:11px" title="${escHtml(a.selector || '')}">${truncSel}</code></td>
      <td style="padding:4px 6px"><span class="badge badge-tester" style="font-size:10px">${escHtml(a.selectorType || 'css')}</span></td>
      <td style="padding:4px 6px;font-size:11px">${confDot} ${a.confidence ?? '—'}/100</td>
      <td style="padding:4px 6px">
        <button class="tbl-btn" style="font-size:10px;padding:1px 7px" onclick="_locEditPromoteAlt(${i})" title="Set as primary">Set Primary</button>
      </td>
    </tr>`;
  }).join('');
}

function _locEditPromoteAlt(altIdx) {
  const loc = allLocators.find(l => l.id === editingLocatorId);
  if (!loc) return;
  const alts = (loc.alternatives || []).slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const chosen = alts[altIdx];
  if (!chosen) return;
  // Swap into the form fields
  const curSel = document.getElementById('loc-selector').value.trim();
  const curType = document.getElementById('loc-type').value;
  document.getElementById('loc-selector').value = chosen.selector;
  document.getElementById('loc-type').value = chosen.selectorType;
  // Rebuild in-memory alternatives: demote current primary, remove chosen
  const demoted = { selector: curSel, selectorType: curType, confidence: 50 };
  const remaining = alts.filter((_, i) => i !== altIdx);
  // Store updated alts temporarily so _locatorEditRenderAlts re-renders correctly
  loc._editAlts = [demoted, ...remaining];
  _locatorEditRenderAlts({ ...loc, alternatives: loc._editAlts });
}

async function locatorSave() {
  modClearAlert('loc-modal-alert');
  const name = document.getElementById('loc-name').value.trim();
  const selector = document.getElementById('loc-selector').value.trim();
  if (!name || !selector) { modAlert('loc-modal-alert', 'error', 'Name and Selector are required'); return; }

  const body = {
    name, selector,
    selectorType: document.getElementById('loc-type').value,
    pageModule: document.getElementById('loc-page').value.trim(),
    description: document.getElementById('loc-desc').value.trim(),
    projectId: currentProjectId || null,
  };

  // If a "Set Primary" swap was performed in the modal, include the updated alternatives
  if (editingLocatorId) {
    const loc = allLocators.find(l => l.id === editingLocatorId);
    if (loc?._editAlts) {
      body.alternatives = loc._editAlts;
      delete loc._editAlts;
    }
  }

  const method = editingLocatorId ? 'PUT' : 'POST';
  const url = editingLocatorId ? `/api/locators/${editingLocatorId}` : '/api/locators';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('loc-modal-alert', 'error', data.error || 'Error'); return; }
  locatorCloseModal();
  await locatorLoad();
}

async function locatorDelete(id, name) {
  if (!confirm(`Delete locator "${name}"?`)) return;
  try {
    const res = await fetch(`/api/locators/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert('Delete failed: ' + (data.error || res.statusText));
      return;
    }
    await locatorLoad();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

function locatorCloseModal() {
  // Clear any in-progress primary swap state
  if (editingLocatorId) {
    const loc = allLocators.find(l => l.id === editingLocatorId);
    if (loc) delete loc._editAlts;
  }
  const altsTbody = document.getElementById('loc-alts-tbody');
  if (altsTbody) altsTbody.innerHTML = '';
  const altsSection = document.getElementById('loc-alts-section');
  if (altsSection) altsSection.style.display = 'none';
  closeModal('modal-locator');
  editingLocatorId = null;
}

// ── Fallback locator expand / collapse ────────────────────────────────────────
const _locAltOpen = new Set(); // tracks which locator IDs have expanded fallbacks

function locatorToggleAlts(locId) {
  const loc = allLocators.find(l => l.id === locId);
  const alts = loc?.alternatives || [];
  const chip = document.getElementById(`loc-alt-chip-${locId}`);
  const isOpen = _locAltOpen.has(locId);
  alts.forEach((_, i) => {
    const row = document.getElementById(`loc-alt-row-${locId}-${i}`);
    if (row) row.style.display = isOpen ? 'none' : '';
  });
  if (chip) chip.textContent = isOpen ? `▶ ${alts.length} fallback${alts.length > 1 ? 's' : ''}` : `▼ ${alts.length} fallback${alts.length > 1 ? 's' : ''}`;
  isOpen ? _locAltOpen.delete(locId) : _locAltOpen.add(locId);
}

// ── Promote a fallback to primary ─────────────────────────────────────────────
// Swaps alternatives[altIdx] ↔ primary selector in the locator record.
// The demoted primary is inserted at the top of the alternatives list with the
// same selectorType and a confidence of 50 (unknown — was primary, not scored).
async function locatorPromoteAlt(locId, altIdx) {
  const loc = allLocators.find(l => l.id === locId);
  if (!loc) return;
  const alts = (loc.alternatives || []).slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const chosen = alts[altIdx];
  if (!chosen) return;
  if (!confirm(`Set "${chosen.selector}" (${chosen.selectorType}) as the primary locator for "${loc.name}"?\n\nThe current primary will move to the fallbacks list.`)) return;

  // Build new alternatives: old primary demoted, chosen removed from list
  const demoted = { selector: loc.selector, selectorType: loc.selectorType, confidence: 50 };
  const remaining = alts.filter((_, i) => i !== altIdx);
  const newAlts = [demoted, ...remaining];

  const body = {
    selector: chosen.selector,
    selectorType: chosen.selectorType,
    alternatives: newAlts,
  };
  const res = await fetch(`/api/locators/${locId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    alert('Failed to update locator: ' + (d.error || res.statusText));
    return;
  }
  _locAltOpen.delete(locId); // collapse after swap so user sees fresh state
  await locatorLoad();
}

// ── Healing Report ────────────────────────────────────────────────────────────
let _healLog = [];

async function healLogLoad() {
  if (!currentProjectId) return;
  try {
    const res = await fetch(`/api/heal-log?projectId=${encodeURIComponent(currentProjectId)}&limit=500`);
    if (!res.ok) { _healLog = []; healLogRender(); return; }
    _healLog = await res.json();
  } catch { _healLog = []; }
  healLogRender();
  // Update count badge
  const countEl = document.getElementById('loc-heallog-count');
  if (countEl) {
    if (_healLog.length) { countEl.textContent = _healLog.length; countEl.style.display = ''; }
    else countEl.style.display = 'none';
  }
}

function healLogRender() {
  const tierF = (document.getElementById('heallog-filter-tier')?.value ?? '').toUpperCase();
  const rows = _healLog.filter(e => !tierF || (e.tier || '').toUpperCase() === tierF);
  const tbody = document.getElementById('heallog-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr id="heallog-empty-row"><td colspan="11" style="text-align:center;color:var(--neutral-400);padding:32px;font-size:13px">No healing events recorded yet. Events appear here after a test run where a primary locator failed and a fallback was used.</td></tr>`;
    return;
  }

  const tierBadge = t => {
    const colours = { T2: '#2563eb', T3: '#7c3aed', T4: '#16a34a' };
    const bg = colours[t] || '#6b7280';
    return `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;background:${bg};color:#fff">${escHtml(t || '—')}</span>`;
  };
  const confDot = c => c >= 80 ? '🟢' : c >= 60 ? '🟡' : '🔴';
  const shortId = id => id ? id.substring(0, 8) + '…' : '—';
  const truncSel = s => (s || '').length > 45 ? `<span title="${escHtml(s)}">${escHtml((s || '').substring(0, 45))}…</span>` : escHtml(s || '—');

  tbody.innerHTML = rows.map((e, i) => `<tr>
    <td style="color:var(--neutral-400);font-size:11px">${i + 1}</td>
    <td style="font-size:11px"><code title="${escHtml(e.runId || '')}">${shortId(e.runId)}</code></td>
    <td style="font-size:11px">${escHtml(e.suiteName || '—')}</td>
    <td style="font-size:11px">${escHtml(e.tcId || '—')}</td>
    <td style="font-size:11px;text-align:center">${e.stepOrder ?? '—'}</td>
    <td style="font-size:11px"><strong>${escHtml(e.locatorName || e.locatorId || '—')}</strong></td>
    <td style="font-size:11px"><code style="color:var(--red-600)">${truncSel(e.oldSelector)}</code> <span style="font-size:10px;color:var(--neutral-400)">${escHtml(e.oldSelectorType || '')}</span></td>
    <td style="font-size:11px"><code style="color:var(--green-700)">${truncSel(e.healed)}</code> <span style="font-size:10px;color:var(--neutral-400)">${escHtml(e.healedType || '')}</span></td>
    <td>${tierBadge(e.tier)}</td>
    <td style="font-size:11px">${confDot(e.confidence ?? 0)} ${e.confidence ?? '—'}</td>
    <td style="font-size:11px;color:var(--neutral-400)">${(e.at || '').slice(0, 16).replace('T', ' ')}</td>
  </tr>`).join('');
}

// ── Locator picker popup (called from TC Builder step selector field) ──────────

let _locatorPickerCallback = null;

async function locatorPickerOpen(callback) {
  if (!currentProjectId) { alert('Select a project first before picking a locator.'); return; }
  _locatorPickerCallback = callback;
  document.getElementById('loc-picker-search').value = '';
  // Always reload scoped locators so picker reflects current project
  const res = await fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}`);
  allLocators = await res.json();
  locatorPickerFilter();
  openModal('modal-locator-picker');
}

function locatorPickerClose() { closeModal('modal-locator-picker'); _locatorPickerCallback = null; }

function locatorPickerFilter() {
  const q = document.getElementById('loc-picker-search').value.toLowerCase();
  const el = document.getElementById('loc-picker-list');
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
let editingFnId = null;
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
  const pgEl = document.getElementById('fn-pagination');
  if (!tbody) return;
  const q = (document.getElementById('fn-search')?.value || '').toLowerCase();
  const filtered = allFunctions.filter(f =>
    !q || f.name.toLowerCase().includes(q) || (f.identifier || '').toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q)
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
    const end = Math.min((_fnPage + 1) * FN_PAGE_SIZE, filtered.length);
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
    document.getElementById('fn-name').value = '';
    document.getElementById('fn-identifier').value = '';
    document.getElementById('fn-desc').value = '';
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
  document.getElementById('fn-name').value = fn.name;
  document.getElementById('fn-identifier').value = fn.identifier || '';
  document.getElementById('fn-desc').value = fn.description || '';
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

  const curKw = _seKwGet(step.keyword);
  const needsLoc = curKw ? curKw.needsLocator : true;
  const isAuto = curKw?.autoFromProject || false;
  const helpLbl = curKw?.helpLabel || '';
  const tipObj = curKw?.tooltip || null;
  const tipJson = (tipObj && (tipObj.what || tipObj.example || tipObj.tip)) ? JSON.stringify(tipObj) : '';

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
  row.querySelector('.fn-step-loc-type').value = step.locatorType || 'css';

  container.appendChild(row);
  fnStepKwChange(row.querySelector('.fn-step-kw-select'));
  if (!_skipReorder) fnReorderNums();
}

function fnStepKwChange(sel) {
  const row = sel.closest('.fn-step-card');
  const opt = sel.selectedOptions[0];
  const needsLoc = opt?.dataset.nl === 'true';
  const isAuto = opt?.dataset.auto === 'true';
  const helpText = opt?.dataset.help || '';
  const tipJson = opt?.dataset.tooltipJson || '';

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
  const nameInput = row.querySelector('.fn-step-loc-name');
  const valInput = row.querySelector('.fn-step-selector');
  const typeSelect = row.querySelector('.fn-step-loc-type');
  const lockBadge = row.querySelector('.loc-repo-badge');
  const unlockBtn = row.querySelector('.loc-unlock-btn');
  if (nameInput) { nameInput.readOnly = locked; nameInput.classList.toggle('loc-locked', locked); }
  if (valInput) { valInput.readOnly = locked; valInput.classList.toggle('loc-locked', locked); }
  if (typeSelect) { typeSelect.disabled = locked; typeSelect.classList.toggle('loc-locked', locked); }
  if (lockBadge) lockBadge.style.display = locked ? '' : 'none';
  if (unlockBtn) unlockBtn.style.display = locked ? '' : 'none';
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
  const name = document.getElementById('fn-name').value.trim();
  const identifier = document.getElementById('fn-identifier').value.trim();
  if (!name) { modAlert('fn-modal-alert', 'error', 'Function name is required'); return; }
  if (!identifier) { modAlert('fn-modal-alert', 'error', 'Identifier is required'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) { modAlert('fn-modal-alert', 'error', 'Identifier must be alphanumeric and underscores only'); return; }

  const steps = [...document.querySelectorAll('#fn-steps-container .fn-step-card')].map((row, i) => {
    return {
      order: i + 1,
      keyword: row.querySelector('.fn-step-kw-select')?.value || '',
      locatorName: row.querySelector('.fn-step-loc-name')?.value?.trim() || null,
      locatorType: row.querySelector('.fn-step-loc-type')?.value || 'css',
      selector: row.querySelector('.fn-step-selector')?.value?.trim() || null,
      description: row.querySelector('.fn-step-desc')?.value?.trim() || '',
    };
  }).filter(s => s.keyword);

  if (!steps.length) { modAlert('fn-modal-alert', 'error', 'At least one step is required'); return; }

  const body = { name, identifier, description: document.getElementById('fn-desc').value.trim(), steps, projectId: currentProjectId || null };
  const method = editingFnId ? 'PUT' : 'POST';
  const url = editingFnId ? `/api/functions/${editingFnId}` : '/api/functions';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('fn-modal-alert', 'error', data.error || 'Error'); return; }

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
  _syncLocatorsToRepo(stepsForSync).then(({ failed }) => {
    if (failed.length) {
      _syncFailedLocators = new Set(failed);
      _showSyncFailBanner(failed, 'function');
    }
  }).catch(() => { });
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
const _HIDE_PROJ_DROPDOWN_TABS = new Set(['projects', 'admin', 'worker-health']);

function onModuleTabSwitch(tab) {
  if (tab === 'admin') usersLoad();
  if (tab === 'projects') projLoad();
  if (tab === 'locators') { locatorLoad(); proposalLoad(); }
  if (tab === 'functions') fnLoad();
  if (tab === 'commondata') cdLoad();
  if (tab === 'scripts') { scriptLoad(); _debugSessionsPollStart(); }
  if (tab === 'suites') suiteLoad();
  if (tab === 'execution') execLoad();
  if (tab === 'history') histLoad();
  if (tab === 'flaky') flakyLoad();
  if (tab === 'analytics') analyticsLoad();
  if (tab === 'visual') vrLoad();
  if (tab === 'locator-health') locatorHealthLoad();
  if (tab === 'api-envs') apiEnvLoad();
  if (tab === 'api-collections') apiColLoad();
  if (tab === 'api-runs') apiRunsLoad();
  if (tab === 'api-flakiness') flakinessPageInit();
  if (tab === 'api-suites') apiSuitesInit();
  if (tab === 'api-replay' && !_panelLoaded.has('api-replay')) { if (typeof apiReplayInit === 'function') apiReplayInit(); }
  if (tab === 'worker-health') { if (typeof workerHealthInit === 'function') { var _whPanel = document.getElementById('panel-worker-health'); if (_whPanel) workerHealthInit(_whPanel); } }
  if (tab === 'governance') { if (typeof governanceInit === 'function') { var _govPanel = document.getElementById('panel-governance'); if (_govPanel) governanceInit(_govPanel); } }
  // OLD: Plugin tab trigger removed — plugin ecosystem deactivated 2026-05-30
  // if (tab === 'api-plugins') { if (typeof apiPluginsLoad === 'function') apiPluginsLoad(); }
  if (tab === 'api-graph') { if (typeof graphEditorLoad === 'function') graphEditorLoad(); }
  if (tab === 'api-collab') { if (typeof collabLoad === 'function') collabLoad(); }
  if (tab === 'api-copilot') { if (typeof copilotLoad === 'function') copilotLoad(); }
  if (tab === 'perf-dashboard') { if (typeof perfLoad === 'function') perfLoad(); }
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

let allProjects = [];
let currentProjectId = '';

async function projDropdownLoad() {
  const res = await fetch('/api/projects');
  if (res.status === 401) { window.location.href = '/login?reason=expired'; return; }
  if (!res.ok) return;
  allProjects = await res.json();
  if (!Array.isArray(allProjects)) { allProjects = []; return; }
  const sel = document.getElementById('global-project-select');
  if (!sel) return;
  const active = allProjects.filter(p => p.isActive);
  sel.innerHTML = '<option value="">— Select Project —</option>' +
    active.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
  if (active.length === 1) { sel.value = active[0].id; onProjectChange(); }
}

// Panels that require a project to be selected before any interaction
const PROJECT_SCOPED_TABS = new Set(['scripts', 'suites', 'locators', 'functions', 'commondata', 'history', 'flaky', 'analytics', 'visual', 'locator-health', 'api-envs', 'api-collections', 'api-runs', 'api-flakiness', 'api-suites']);

const _PROJ_BANNER_ID = 'proj-required-banner';

function _guardCheck(tab) {
  _removeProjBanner();
  if (!PROJECT_SCOPED_TABS.has(tab)) { _projDropdownNormal(); return; }
  if (!currentProjectId) { _showProjBanner(); _projDropdownPulse(); }
  else { _projDropdownNormal(); }
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
  const activeTab = document.querySelector('.nav-item.active')?.dataset?.tab || '';
  _guardCheck(activeTab);
  _toggleModuleAddButtons(!!currentProjectId);
  _scriptPage = 0; _fnPage = 0; _cdPage = 0; _locPage = 0;
  scriptLoad();
  suiteLoad();
  locatorLoadScoped();
  fnLoad();
  _cdPopulateEnvDropdowns();
  cdLoad();
  histLoad();
  flakyLoad();
  analyticsLoad();
  vrLoad();
  locatorHealthLoad();
  execLoad();
  apiEnvLoad();
  apiColLoad();
  apiRunsLoad();
  if (typeof apiSuitesLoad === 'function') apiSuitesLoad();
}

function _toggleModuleAddButtons(enabled) {
  ['btn-new-script', 'btn-new-suite', 'btn-add-locator', 'btn-new-function', 'btn-add-cd', 'btn-new-api-env', 'btn-new-api-col'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !enabled;
  });
}

async function locatorLoadScoped() {
  if (!currentProjectId) { allLocators = []; locatorRender(); return; }
  const res = await fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}`);
  allLocators = await res.json();
  locatorRender();
}

// ══════════════════════════════════════════════════════════════════════════════
// KEYWORD REGISTRY
// ══════════════════════════════════════════════════════════════════════════════

let scriptKeywords = { categories: [], dynamicTokens: [] };

// ── Keyword option HTML caches — built once after keywordsLoad(), reused per step ──
let _kwOptionsScriptHtml = '';  // script steps: all kws except GOTO
let _kwOptionsFnHtml = '';  // fn steps: all kws except GOTO + CALL FUNCTION
let _locTypeOptsHtml = '';  // locator type options (same for both)

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

let allScripts = [];
let editingScriptId = null;
let _compDefs = [];   // ComponentDef[] for current project in modal
let _seCompDefs = [];   // ComponentDef[] for current project, used in script editor
let _scriptPage = 0;
let SCRIPT_PAGE_SIZE = 10;

async function scriptLoad() {
  const emptyEl = document.getElementById('script-list-empty');
  const listEl = document.getElementById('script-list');
  if (!currentProjectId) {
    if (emptyEl) emptyEl.style.display = '';
    if (listEl) listEl.innerHTML = '';
    allScripts = [];
    return;
  }
  const res = await fetch(`/api/scripts?projectId=${encodeURIComponent(currentProjectId)}`);
  allScripts = await res.json();
  scriptRender();
  await seLoadComponents();
}

function scriptRender() {
  const qTitle = (document.getElementById('script-filter-title')?.value ?? '').toLowerCase();
  const qTag = (document.getElementById('script-filter-tag')?.value ?? '').toLowerCase();
  const qComp = (document.getElementById('script-filter-comp')?.value ?? '').toLowerCase();
  const qSubcomp = (document.getElementById('script-filter-subcomp')?.value ?? '').toLowerCase();
  const listEl = document.getElementById('script-list');
  const emptyEl = document.getElementById('script-list-empty');
  if (!listEl) return;
  if (!currentProjectId) { emptyEl.style.display = ''; listEl.innerHTML = ''; return; }
  emptyEl.style.display = 'none';
  const filtered = allScripts.filter(s => {
    if (qTitle && !s.title.toLowerCase().includes(qTitle)) return false;
    if (qTag && !(s.tags || []).some(t => t.toLowerCase().includes(qTag))) return false;
    if (qComp && !(s.component || '').toLowerCase().includes(qComp)) return false;
    if (qSubcomp && !(s.subcomponent || '').toLowerCase().includes(qSubcomp)) return false;
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
  const end = Math.min((_scriptPage + 1) * SCRIPT_PAGE_SIZE, filtered.length);
  const rppOpts = [10,25,50,100,200,500].map(n => `<option value="${n}"${SCRIPT_PAGE_SIZE===n?' selected':''}>${n}</option>`).join('');
  const pgHtml = `
    <div class="lt-pagination">
      <label style="font-size:12px;color:var(--neutral-500)">Rows per page:
        <select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto" onchange="_scriptSetPageSize(+this.value)">${rppOpts}</select>
      </label>
      ${totalPages <= 1 ? `<span style="font-size:12px;color:var(--neutral-500)">${start}–${end} of ${filtered.length}</span>` : `
      <button class="tbl-btn" onclick="_scriptPageGo(-1)" ${_scriptPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span>Page ${_scriptPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${filtered.length})</span>
      <button class="tbl-btn" onclick="_scriptPageGo(1)" ${_scriptPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`}
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
            <th style="min-width:130px">Subcomponent</th>
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
              <td title="${escHtml(s.subcomponent || '')}">${escHtml(s.subcomponent || '—')}</td>
              <td>${(s.tags || []).length ? (s.tags || []).map(t => `<span class="badge badge-tester">${escHtml(t)}</span>`).join(' ') : '—'}</td>
              <td><span class="badge badge-${escHtml(s.priority)}">${escHtml(s.priority)}</span></td>
              <td style="font-size:12px">${escHtml(s.createdBy || '—')}</td>
              <td style="font-size:12px">${formatDate(s.createdAt)}</td>
              <td>
                <div style="display:flex;gap:4px">
                  ${isViewer() ? '' : `<button class="tbl-btn" onclick="scriptOpenEditor('${escHtml(s.id)}')">Edit</button>`}
                  <button class="tbl-btn dbg" onclick="debugOpen('${escHtml(s.id)}')">&#128027;</button>
                  ${isViewer() ? '' : `<button class="tbl-btn" onclick="scriptClone('${escHtml(s.id)}')" title="Clone script"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>`}
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

function _scriptSubcompFilter() {
  const compVal = (document.getElementById('script-filter-comp')?.value ?? '').trim().toLowerCase();
  const subSel = document.getElementById('script-filter-subcomp');
  if (!subSel) return;
  subSel.innerHTML = '<option value="">All Subcomponents</option>';
  if (!compVal) {
    subSel.disabled = true;
    return;
  }
  const matching = _seCompDefs.filter(c => c.name.toLowerCase().includes(compVal));
  const allSubs = [...new Set(matching.flatMap(c => c.subcomponents.map(s => s.name)))].sort();
  if (!allSubs.length) { subSel.disabled = true; return; }
  subSel.disabled = false;
  allSubs.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    subSel.appendChild(opt);
  });
}

function _scriptPageGo(delta) {
  _scriptPage += delta;
  scriptRender();
}

function _scriptSetPageSize(n) {
  SCRIPT_PAGE_SIZE = n;
  _scriptPage = 0;
  scriptRender();
}

function scriptSelectAll(chk) {
  document.querySelectorAll('.script-row-chk').forEach(c => c.checked = chk.checked);
  scriptSelectionChanged();
}

function scriptSelectionChanged() {
  const checked = [...document.querySelectorAll('.script-row-chk:checked')];
  const allChk = document.getElementById('script-select-all');
  const allBoxes = document.querySelectorAll('.script-row-chk');
  if (allChk) allChk.indeterminate = checked.length > 0 && checked.length < allBoxes.length;
  const bulkBar = document.getElementById('script-bulk-bar');
  const countEl = document.getElementById('script-sel-count');
  if (bulkBar) bulkBar.style.display = checked.length > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = checked.length > 0 ? `${checked.length} selected` : '';
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
      <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:16px">&#10133; Add ${ids.length} Script${ids.length > 1 ? 's' : ''} to Suite</div>
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
  const res = await fetch('/api/scripts/bulk-suite', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, suiteId }),
  });
  const data = await res.json();
  if (!res.ok) { alertEl.textContent = data.error || 'Failed'; alertEl.style.display = ''; return; }
  document.getElementById('bulk-suite-modal')?.remove();
  const suiteName = allSuites.find(s => s.id === suiteId)?.name || suiteId;
  // Brief success toast
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#166534;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  toast.textContent = `✓ ${data.count} script${data.count !== 1 ? 's' : ''} added to "${suiteName}"`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
  await suiteLoad();
}

async function scriptBulkSetPriority() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  const priorities = ['low', 'medium', 'high', 'critical'];
  const choice = await _bulkPickModal(
    `&#9881; Set Priority for ${ids.length} Script${ids.length > 1 ? 's' : ''}`,
    'Priority', priorities.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))
  );
  if (!choice) return;
  const res = await fetch('/api/scripts/bulk', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, patch: { priority: choice } }),
  });
  if (!res.ok) { alert('Failed to update priority'); return; }
  _bulkToast(`✓ Priority set to "${choice}" for ${ids.length} script${ids.length > 1 ? 's' : ''}`);
  await scriptLoad();
}

async function scriptBulkSetTag() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  const tag = await _bulkInputModal(`&#127991; Set Tag for ${ids.length} Script${ids.length > 1 ? 's' : ''}`, 'Tag value');
  if (tag === null) return;
  const res = await fetch('/api/scripts/bulk', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, patch: { tags: [tag.trim()] } }),
  });
  if (!res.ok) { alert('Failed to update tag'); return; }
  _bulkToast(`✓ Tag "${tag}" applied to ${ids.length} script${ids.length > 1 ? 's' : ''}`);
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
  await seLoadComponents();
  if (!allFunctions.length) { try { await fnLoad(); } catch { } }
  editingScriptId = id;
  document.getElementById('script-editor-title').textContent = id ? 'Edit Script' : 'New Script';
  modClearAlert('script-editor-alert');
  document.getElementById('se-steps-container').innerHTML = '';
  document.getElementById('se-steps-hint').style.display = '';

  if (id) {
    const sc = allScripts.find(s => s.id === id);
    if (!sc) return;
    sePopulateComponent(sc.component || '');
    sePopulateSubcomponent(sc.subcomponent || null);
    document.getElementById('se-title').value = sc.title;
    document.getElementById('se-desc').value = sc.description || '';
    document.getElementById('se-priority').value = sc.priority;
    document.getElementById('se-tags').value = (sc.tags || []).join(', ');
    const mc = document.getElementById('se-metadata-card');
    if (mc) {
      mc.style.display = '';
      document.getElementById('se-meta-createdby').textContent = sc.createdBy || '—';
      document.getElementById('se-meta-createdat').textContent = formatDate(sc.createdAt);
      document.getElementById('se-meta-modifiedby').textContent = sc.modifiedBy || '—';
      document.getElementById('se-meta-modifiedat').textContent = formatDate(sc.modifiedAt);
    }
    (sc.steps || []).forEach(step => scriptAddStep(step, null, true));
    scriptReorderNums(); // one call after all steps inserted
  } else {
    sePopulateComponent('');
    sePopulateSubcomponent(null);
    document.getElementById('se-title').value = '';
    document.getElementById('se-desc').value = '';
    document.getElementById('se-priority').value = 'medium';
    document.getElementById('se-tags').value = '';
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
  document.getElementById('sd-tcid').textContent = sc.tcId || '—';
  document.getElementById('sd-component').textContent = sc.component || '—';
  document.getElementById('sd-priority').innerHTML = `<span class="badge badge-${escHtml(sc.priority)}">${escHtml(sc.priority)}</span>`;
  document.getElementById('sd-tags').innerHTML = (sc.tags || []).length
    ? (sc.tags || []).map(t => `<span class="badge badge-tester">${escHtml(t)}</span>`).join(' ')
    : '—';
  document.getElementById('sd-description').textContent = sc.description || '—';
  document.getElementById('sd-createdby').textContent = sc.createdBy || '—';
  document.getElementById('sd-createdat').textContent = formatDate(sc.createdAt);
  document.getElementById('sd-modifiedby').textContent = sc.modifiedBy || '—';
  document.getElementById('sd-modifiedat').textContent = formatDate(sc.modifiedAt);
  document.getElementById('sd-step-count').textContent = `(${(sc.steps || []).length} steps)`;

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
          ${!isCall && step.locator ? `<div class="sd-step-locator"><span class="sd-locator-type">${escHtml(step.locatorType || 'css')}</span> <code>${escHtml(step.locator)}</code></div>` : ''}
          ${!isCall && step.value ? `<div class="sd-step-value">Value: <code>${escHtml(step.value)}</code></div>` : ''}
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
                    ${fs.value ? `<div class="sd-step-value">Value: <code>${escHtml(fs.value)}</code></div>` : ''}
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
  try { if (raw) tip = JSON.parse(raw); } catch (e) { }
  if (!tip.what && !tip.example && !tip.tip) return;

  _kwTipPopup.querySelector('.kw-tp-what').textContent = tip.what || '';
  _kwTipPopup.querySelector('.kw-tp-example').textContent = tip.example || '';
  _kwTipPopup.querySelector('.kw-tp-tip').textContent = tip.tip || '';
  _kwTipPopup.querySelector('.kw-tp-what-wrap').style.display = tip.what ? '' : 'none';
  _kwTipPopup.querySelector('.kw-tp-example-wrap').style.display = tip.example ? '' : 'none';
  _kwTipPopup.querySelector('.kw-tp-tip-wrap').style.display = tip.tip ? '' : 'none';

  _kwTipPopup.style.display = 'block';
  // position after layout so offsetWidth/Height are valid
  requestAnimationFrame(() => {
    const rect = trigger.getBoundingClientRect();
    const pw = _kwTipPopup.offsetWidth;
    const ph = _kwTipPopup.offsetHeight;
    let left = rect.right + 10;
    if (left + pw > window.innerWidth - 8) left = rect.left - pw - 10;
    let top = rect.top - 4;
    if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    _kwTipPopup.style.left = Math.max(8, left) + 'px';
    _kwTipPopup.style.top = Math.max(8, top) + 'px';
  });
}

function _kwTipHide() {
  if (_kwTipPopup) _kwTipPopup.style.display = 'none';
}

// ── Info-icon tooltip (position:fixed, viewport-clamped, scroll-safe) ────────
let _infoTipPopup = null;
let _infoTipHideTimer = null;

function _infoTipShow(trigger) {
  const text = trigger.dataset.tooltip || '';
  if (!text) return;
  clearTimeout(_infoTipHideTimer);
  if (!_infoTipPopup) {
    _infoTipPopup = document.createElement('div');
    _infoTipPopup.className = 'info-tip-popup';
    // keep visible while hovering the popup itself
    _infoTipPopup.addEventListener('mouseenter', () => clearTimeout(_infoTipHideTimer));
    _infoTipPopup.addEventListener('mouseleave', () => { _infoTipHideTimer = setTimeout(_infoTipHideNow, 120); });
    document.body.appendChild(_infoTipPopup);
  }
  _infoTipPopup.textContent = text;
  _infoTipPopup.style.display = 'block';
  requestAnimationFrame(() => {
    const rect = trigger.getBoundingClientRect();
    const pw = _infoTipPopup.offsetWidth;
    const ph = _infoTipPopup.offsetHeight;
    // prefer right of icon, fall back to left
    let left = rect.right + 10;
    if (left + pw > window.innerWidth - 8) left = rect.left - pw - 10;
    // prefer above icon, fall back to below, then clamp to viewport
    let top = rect.top - ph - 8;
    if (top < 8) top = rect.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    _infoTipPopup.style.left = Math.max(8, left) + 'px';
    _infoTipPopup.style.top = Math.max(8, top) + 'px';
  });
}
function _infoTipHideNow() {
  if (_infoTipPopup) _infoTipPopup.style.display = 'none';
}
function _infoTipHide() {
  clearTimeout(_infoTipHideTimer);
  _infoTipHideTimer = setTimeout(_infoTipHideNow, 120);
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

  const valMode = step.valueMode || 'static';   // 'static' | 'dynamic' | 'commondata' | 'testdata'
  const isDyn = valMode === 'dynamic';
  const isCd = valMode === 'commondata';
  const isTd = valMode === 'testdata';
  const tokenOpts = (() => {
    let html = `<option value="">— choose token —</option>`;
    let currentGroup = null;
    for (const t of scriptKeywords.dynamicTokens) {
      const grp = t.group || '';
      if (grp && grp !== currentGroup) {
        if (currentGroup !== null) html += `</optgroup>`;
        html += `<optgroup label="${escHtml(grp)}">`;
        currentGroup = grp;
      }
      html += `<option value="${escHtml(t.token)}"${isDyn && step.value === t.token ? ' selected' : ''}>${escHtml(t.label)}</option>`;
    }
    if (currentGroup !== null) html += `</optgroup>`;
    return html;
  })();

  const curKw = _seKwGet(step.keyword);
  const needsLoc = curKw ? curKw.needsLocator : true;
  const needsVal = curKw ? curKw.needsValue : false;
  const isAuto = curKw?.autoFromProject || false;
  const isVisual = step.keyword === 'ASSERT VISUAL';
  const valHint = curKw?.valueHint || 'Value';
  const helpLbl = curKw?.helpLabel || '';
  const tipObj = curKw?.tooltip || null;
  const tipJson = (tipObj && (tipObj.what || tipObj.example || tipObj.tip)) ? JSON.stringify(tipObj) : '';

  const row = document.createElement('div');
  row.className = 'script-step-row';
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
      <button type="button" class="step-action-btn step-pin-icon${step.storeAs ? ' step-pin-active' : ''}${isTd ? ' step-pin-disabled' : ''}" onclick="scriptStepPinOpen(this)" title="${isTd ? 'Variable storage not allowed when Value Source is Test Data (Static)' : 'Save value as variable (📌 Pin)'}"${isTd ? ' disabled' : ''}>
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
    <div class="step-pin-badge${(step.storeAs && !isTd) ? '' : ' step-pin-badge-hidden'}${step.storeScope === 'global' ? ' step-pin-badge-global' : ''}" data-store-as="${escHtml(isTd ? '' : (step.storeAs || ''))}" data-store-scope="${escHtml(step.storeScope || 'session')}" data-store-source="${escHtml(step.storeSource || 'text')}" data-store-attr="${escHtml(step.storeAttrName || '')}">
      <span class="pin-badge-label">${step.storeScope === 'global' ? '🌐' : '📌'} Saved as <code>{{var.${escHtml(step.storeAs || '')}}}</code><span class="pin-scope-tag">${step.storeScope === 'global' ? 'Global' : 'Session'}</span></span>
      <button type="button" class="pin-badge-clear" onclick="scriptStepPinClear(this)" title="Remove variable">✕</button>
    </div>
    <div class="se-step-auto-badge"${isAuto ? '' : ' style="display:none"'}>
      <span class="auto-config-badge">&#x2699; Auto from Project Config — URL &amp; credentials fetched automatically</span>
    </div>
    <div class="step-row-fields">
      ${isVisual ? `<div class="vrt-info-banner">
        <span class="vrt-info-icon">&#9432;</span>
        <span class="vrt-info-text"><strong>Visual Regression Mode:</strong>
          <span class="vrt-mode-el">&#128270; <strong>Element</strong> — fill the locator below to screenshot only that element (precise, component-level)</span> &nbsp;|&nbsp;
          <span class="vrt-mode-fp">&#128444; <strong>Full Page</strong> — leave locator blank to capture the entire visible viewport</span>
        </span>
      </div>` : ''}
      <div class="se-step-locator"${needsLoc && !isAuto ? '' : ' style="display:none"'}>
        <div class="field" style="margin:0 0 6px 0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <label style="font-size:11px;margin:0">Locator Name${isVisual ? ' <span style="font-size:10px;color:var(--g400);font-weight:400">(optional — blank = full page)</span>' : ''}</label>
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
      ${isVisual ? `<div class="vrt-options-panel">
        <button type="button" class="vrt-options-toggle" onclick="vrtTogglePanel(this)">
          <span class="vrt-toggle-arrow">&#9654;</span> &#9881; VRT Options <span class="vrt-options-hint">— leave blank to use project defaults</span>
        </button>
        <div class="vrt-options-body" style="display:none">
          <div class="vrt-options-grid">
            <div class="vrt-field">
              <label>Threshold (0–100)</label>
              <input class="fm-input vrt-threshold" type="number" min="0" max="100" step="1"
                     placeholder="e.g. 20" value="${escHtml(String(step.vrtOptions?.threshold != null ? Math.round((step.vrtOptions.threshold)*100) : ''))}"
                     title="Color diff tolerance per pixel. 20 = allow 20% colour variance. Default: project setting." />
            </div>
            <div class="vrt-field">
              <label>Max Diff Pixels</label>
              <input class="fm-input vrt-maxDiffPixels" type="number" min="0" step="1"
                     placeholder="e.g. 200" value="${escHtml(String(step.vrtOptions?.maxDiffPixels ?? ''))}"
                     title="Hard cap on differing pixels. If set, overrides ratio check for this step." />
            </div>
            <div class="vrt-field">
              <label>Max Diff Pixel Ratio (0–100%)</label>
              <input class="fm-input vrt-maxDiffPixelRatio" type="number" min="0" max="100" step="1"
                     placeholder="e.g. 5" value="${escHtml(String(step.vrtOptions?.maxDiffPixelRatio != null ? Math.round((step.vrtOptions.maxDiffPixelRatio)*100) : ''))}"
                     title="Max % of total pixels allowed to differ. 5 = 5% of all pixels. Default: project setting." />
            </div>
            <div class="vrt-field">
              <label>Animations</label>
              <select class="fm-select vrt-animations" title="Freeze CSS animations before capture to prevent flaky diffs.">
                <option value="" ${!step.vrtOptions?.animations ? 'selected' : ''}>Project default</option>
                <option value="disabled" ${step.vrtOptions?.animations === 'disabled' ? 'selected' : ''}>Disabled (freeze)</option>
                <option value="allow"    ${step.vrtOptions?.animations === 'allow'    ? 'selected' : ''}>Allow (live)</option>
              </select>
            </div>
            <div class="vrt-field" style="grid-column:1/-1">
              <label>Mask Selectors <span style="font-weight:400;color:var(--g400)">(comma-separated CSS selectors — blanked before comparison)</span></label>
              <input class="fm-input vrt-mask" type="text"
                     placeholder="e.g. .timestamp, #live-counter, .user-avatar"
                     value="${escHtml((step.vrtOptions?.mask ?? []).join(', '))}"
                     title="These elements are hidden before the screenshot is taken. Use for timestamps, avatars, live counters." />
            </div>
            <div class="vrt-field">
              <label>Mask Color</label>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="color" class="vrt-maskColor-picker" value="${escHtml(step.vrtOptions?.maskColor ?? '#FF00FF')}" style="width:36px;height:28px;border:none;padding:0;cursor:pointer" />
                <input class="fm-input vrt-maskColor" type="text" style="font-family:monospace;font-size:12px"
                       placeholder="#FF00FF" value="${escHtml(step.vrtOptions?.maskColor ?? '')}"
                       title="CSS color used to paint over masked elements." />
              </div>
            </div>
            <div class="vrt-field" style="display:flex;align-items:center;gap:8px;padding-top:18px">
              <label style="margin:0">Omit Background</label>
              <input type="checkbox" class="vrt-omitBackground" ${step.vrtOptions?.omitBackground ? 'checked' : ''}
                     title="Transparent PNG — use for overlay components or elements without a solid background." />
              <span style="font-size:10px;color:var(--g400)">Transparent PNG</span>
            </div>
          </div>
          <div class="vrt-clip-row" style="${step.locator ? 'display:none' : ''}">
            <label style="font-size:11px;display:block;margin-bottom:4px">Clip Region <span style="font-weight:400;color:var(--g400)">(full-page mode only — pixel coordinates)</span></label>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="font-size:11px;color:var(--g500)">X</span><input class="fm-input vrt-clip-x" type="number" min="0" style="width:70px" placeholder="0" value="${step.vrtOptions?.clip?.x ?? ''}" />
              <span style="font-size:11px;color:var(--g500)">Y</span><input class="fm-input vrt-clip-y" type="number" min="0" style="width:70px" placeholder="0" value="${step.vrtOptions?.clip?.y ?? ''}" />
              <span style="font-size:11px;color:var(--g500)">W</span><input class="fm-input vrt-clip-w" type="number" min="1" style="width:70px" placeholder="1280" value="${step.vrtOptions?.clip?.width ?? ''}" />
              <span style="font-size:11px;color:var(--g500)">H</span><input class="fm-input vrt-clip-h" type="number" min="1" style="width:70px" placeholder="720" value="${step.vrtOptions?.clip?.height ?? ''}" />
              <span style="font-size:10px;color:var(--g400)">px</span>
            </div>
          </div>
        </div>
      </div>` : ''}
      <div class="se-step-value"${needsVal && !isAuto ? '' : ' style="display:none"'}>
        <div class="field" style="margin:0">
          <label style="font-size:11px">Value Source</label>
          <div class="value-toggle">
            <button type="button" class="value-toggle-btn${valMode === 'static' ? ' active' : ''}" onclick="scriptStepToggleVal(this,'static')">Static</button>
            <button type="button" class="value-toggle-btn${valMode === 'dynamic' ? ' active' : ''}" onclick="scriptStepToggleVal(this,'dynamic')">Dynamic</button>
            <button type="button" class="value-toggle-btn${isCd ? ' active' : ''}" onclick="scriptStepToggleVal(this,'commondata')">Common Data</button>
            <button type="button" class="value-toggle-btn value-toggle-td${isTd ? ' active' : ''}" onclick="scriptStepToggleVal(this,'testdata')" title="Placeholder — future Test Data dataset integration">Test Data (Static)</button>
            <button type="button" class="value-toggle-btn value-toggle-var${valMode === 'variable' ? ' active' : ''}" onclick="scriptStepToggleVal(this,'variable')" title="Use a pinned variable from an earlier step">📌 Variable</button>
          </div>
          <input class="fm-input se-step-val-static" style="font-size:12px${valMode !== 'static' ? ';display:none' : ''}"
                 placeholder="${escHtml(valHint)}" value="${escHtml(valMode === 'static' ? (step.value ?? '') : '')}" />
          <select class="fm-select se-step-val-dynamic" style="font-size:12.5px${valMode !== 'dynamic' ? ';display:none' : ''}">${tokenOpts}</select>
          <div class="se-step-val-cd" style="${isCd ? '' : 'display:none'}">
            <select class="fm-select se-step-cd-select" style="font-size:12.5px" onchange="scriptStepCdSelected(this)"
                    data-saved-cd="${escHtml(isCd && step.value ? step.value.replace(/^\$\{|\}$/g, '') : '')}">
              <option value="">— loading Common Data… —</option>
            </select>
            ${isCd && step.value ? `<div class="cd-token-preview">Reference: <code>${escHtml(step.value)}</code></div>` : '<div class="cd-token-preview" style="display:none"></div>'}
          </div>
          <div class="se-step-val-var" style="${valMode === 'variable' ? '' : 'display:none'}">
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
          <div class="se-step-val-td" style="${isTd ? '' : 'display:none'}">
            <div class="td-frame">
              <div class="td-frame-header">
                <span style="font-size:11.5px;font-weight:700;color:var(--neutral-600)">Test Data</span>
                <button type="button" class="tbl-btn" style="font-size:11px;padding:2px 8px" onclick="scriptStepTdAddRow(this)">+ Add Row</button>
              </div>
              <table class="td-table">
                <thead><tr><th style="width:28px">#</th><th>Value <span style="color:var(--danger)">*</span></th><th style="width:32px"></th></tr></thead>
                <tbody class="td-tbody">
                  ${(step.testData || []).map((r, ri) => `
                    <tr class="td-row">
                      <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${ri + 1}</td>
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
        <div class="fc-upload-area" style="${step.keyword === 'FILE CHOOSER' && step.value ? 'display:none' : ''}">
          <label class="fc-browse-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Browse &amp; Upload File
            <input type="file" class="fc-file-input" style="display:none" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.json,.xml,.zip" onchange="scriptStepFileChooserUpload(this)" />
          </label>
          <span class="fc-hint">File is uploaded to the server and used during test execution</span>
        </div>
        <div class="fc-file-info" style="${step.keyword === 'FILE CHOOSER' && step.value ? '' : 'display:none'}" data-server-path="${escHtml(step.value || '')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="fc-filename">${escHtml(step.value ? step.value.split('/').pop() : '')}</span>
          <span class="fc-server-path">${escHtml(step.value || '')}</span>
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
            <select class="fm-select se-setvar-source" style="font-size:12px" onchange="_setVarSourceChanged(this)" data-saved="${escHtml(step.storeSource || 'text')}">
              <option value="text"  ${(step.storeSource || 'text') === 'text' ? 'selected' : ''}>Text shown on page</option>
              <option value="value" ${step.storeSource === 'value' ? 'selected' : ''}>Value inside an input field</option>
              <option value="attr"  ${step.storeSource === 'attr' ? 'selected' : ''}>Element attribute</option>
              <option value="js"    ${step.storeSource === 'js' ? 'selected' : ''}>Run JavaScript (advanced)</option>
            </select>
          </div>
          <div class="field se-setvar-attr-wrap" style="margin:0;width:130px;${step.storeSource === 'attr' ? '' : 'display:none'}">
            <label style="font-size:11px">Attribute Name</label>
            <input class="fm-input se-setvar-attr" style="font-size:12px" placeholder="e.g. href" value="${escHtml(step.storeAttrName || '')}"/>
          </div>
          <div class="field" style="margin:0;flex:1;min-width:140px">
            <label style="font-size:11px">Save As (variable name)</label>
            <input class="fm-input se-setvar-name" style="font-size:12px;font-family:monospace"
                   placeholder="e.g. patientId" value="${escHtml(step.storeAs || '')}"
                   oninput="_setVarNameHint(this)" pattern="[A-Za-z0-9_]+" title="Letters, numbers and _ only"/>
          </div>
          <div class="field" style="margin:0;min-width:160px">
            <label style="font-size:11px">Scope</label>
            <div class="setvar-scope-toggle">
              <label class="setvar-scope-opt${(step.storeScope || 'session') === 'session' ? ' active' : ''}">
                <input type="radio" name="setvar-scope-${step.id || 'new'}" class="se-setvar-scope" value="session" ${(step.storeScope || 'session') === 'session' ? 'checked' : ''} onchange="_setVarScopeChanged(this)"/>
                📌 Session
              </label>
              <label class="setvar-scope-opt${step.storeScope === 'global' ? ' active' : ''}">
                <input type="radio" name="setvar-scope-${step.id || 'new'}" class="se-setvar-scope" value="global" ${step.storeScope === 'global' ? 'checked' : ''} onchange="_setVarScopeChanged(this)"/>
                🌐 Global
              </label>
            </div>
          </div>
        </div>
        <div class="setvar-hint" style="font-size:11px;color:var(--neutral-500);margin-top:5px;display:${step.storeAs ? 'block' : 'none'}">
          Use <code>{{var.${escHtml(step.storeAs || '')}}}</code> in any later step's value field
          <span class="setvar-scope-hint">${step.storeScope === 'global' ? ' — 🌐 visible across all scripts in this suite' : ' — 📌 visible only within this script'}</span>
        </div>
        <div class="se-setvar-js-wrap" style="${step.storeSource === 'js' ? 'margin-top:6px' : 'display:none'}">
          <label style="font-size:11px">JavaScript Expression</label>
          <input class="fm-input se-step-val-static" style="font-size:12px;font-family:monospace" placeholder="e.g. document.title" value="${escHtml(step.storeSource === 'js' ? (step.value || '') : '')}" />
        </div>
      </div>
    </div>
    <div class="step-row-bottom">
      <input class="fm-input se-step-desc" style="flex:1;font-size:12px" placeholder="Step description (optional)"
             value="${escHtml(step.description ?? '')}" />
    </div>`;

  // Set keyword + locator type selections via JS (avoids per-step option string rebuild)
  row.querySelector('.se-step-kw-select').value = step.keyword || '';
  row.querySelector('.se-step-loc-type').value = step.locatorType || 'css';

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
    const res = await fetch('/api/nl/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.value.trim(), projectId: currentProjectId || '' }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      if (statusEl) { statusEl.textContent = '✗'; statusEl.style.color = '#f48771'; statusEl.title = data.error || 'Error'; }
      return;
    }

    const step = Array.isArray(data.steps) ? data.steps[0] : data;

    // Auto-fill keyword
    if (step.keyword) {
      const kwSel = row.querySelector('.se-step-kw-select');
      if (kwSel) {
        const match = [...kwSel.options].find(o => o.value.toUpperCase() === step.keyword.toUpperCase());
        if (match) {
          kwSel.value = match.value;
          scriptStepKwChange(kwSel);
        }
      }
    }

    // Auto-fill locator name (always update — user changed NL text intentionally)
    if (step.locatorName) {
      const locInput = row.querySelector('.se-step-loc-name');
      if (locInput) {
        locInput.value = step.locatorName;
        // Try to resolve from locator repo
        _seResolveLocName(row, step.locatorName);
      }
    }

    // Auto-fill static value (always update when NL provides one)
    if (step.value !== undefined && step.value !== null) {
      const staticInput = row.querySelector('.se-step-val-static');
      if (staticInput) staticInput.value = step.value;
    }

    const pct = Math.round((step.confidence ?? data.confidence ?? 1) * 100);
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
      const locNameEl = row.querySelector('.se-step-loc-name');
      const locTypeEl = row.querySelector('.se-step-loc-type');
      const locSelEl = row.querySelector('.se-step-selector');
      const repoEl = row.querySelector('.loc-repo-badge');
      const unlockEl = row.querySelector('.loc-unlock-btn');
      if (locNameEl) { locNameEl.value = match.name; locNameEl.readOnly = true; }
      if (locTypeEl) locTypeEl.value = match.selectorType || match.locatorType || 'css';
      if (locSelEl) { locSelEl.value = match.selector || ''; locSelEl.readOnly = true; }
      if (repoEl) repoEl.style.display = '';
      if (unlockEl) unlockEl.style.display = '';
      row.dataset.locatorId = match.id;
    }).catch(() => { });
}

// ── VRT project defaults cache + loader ───────────────────────────────────
let _vrtProjectCache = null;  // { projectId, config } — one entry, reset on project change

async function _vrtLoadProjectDefaults(projectId) {
  if (_vrtProjectCache && _vrtProjectCache.projectId === projectId) return _vrtProjectCache.config;
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) return null;
    const list = await res.json();
    const proj = list.find(p => p.id === projectId);
    if (!proj) return null;
    _vrtProjectCache = { projectId, config: proj.vrtConfig || {} };
    return _vrtProjectCache.config;
  } catch { return null; }
}

// Apply project VRT defaults as placeholders + dropdown hints on a VRT panel
async function _vrtApplyProjectDefaults(panel, projectId) {
  const cfg = await _vrtLoadProjectDefaults(projectId);
  if (!cfg || !panel) return;

  const numPlaceholder = (sel, val, unit = '') => {
    const el = panel.querySelector(sel);
    if (el) el.placeholder = val != null ? `${val}${unit} (project default)` : 'blank = disabled';
  };
  const dropdownDefault = (sel, val, labelMap) => {
    const el = panel.querySelector(sel);
    if (!el) return;
    // Insert/update the "Project default" first option
    let defOpt = el.querySelector('option[value=""]');
    if (!defOpt) {
      defOpt = document.createElement('option');
      defOpt.value = '';
      el.prepend(defOpt);
    }
    defOpt.textContent = `Project default — ${labelMap[val] || val}`;
    // Only select it if no step-level value is already chosen
    if (!el.dataset.stepValue) el.value = '';
  };

  const t  = cfg.threshold         != null ? Math.round(cfg.threshold * 100)         : 20;
  const r  = cfg.maxDiffPixelRatio  != null ? Math.round(cfg.maxDiffPixelRatio * 100) : 5;
  const mx = cfg.maxDiffPixels      != null ? cfg.maxDiffPixels                       : null;
  const to = cfg.timeout            != null ? cfg.timeout                             : 5000;

  numPlaceholder('.vrt-threshold',        t,  '');
  numPlaceholder('.vrt-maxDiffPixelRatio', r,  '%');
  numPlaceholder('.vrt-maxDiffPixels',    mx);
  numPlaceholder('.vrt-timeout',          to, ' ms');

  dropdownDefault('.vrt-animations', cfg.animations || 'disabled', { disabled: 'Disabled (freeze)', allow: 'Allow (live)' });
  dropdownDefault('.vrt-scale',      cfg.scale      || 'css',      { css: 'CSS logical pixels',     device: 'Device HiDPI' });
  dropdownDefault('.vrt-caret',      cfg.caret      || 'hide',     { hide: 'Hide cursor',           initial: 'Show cursor' });

  // MaskColor — show picker row only when mask selectors has content
  _vrtToggleMaskColor(panel);
}

function _vrtToggleMaskColor(panel) {
  const maskInput = panel.querySelector('.vrt-mask');
  const colorRow  = panel.querySelector('.vrt-maskcolor-row');
  if (!maskInput || !colorRow) return;
  const hasMask = maskInput.value.trim().length > 0;
  colorRow.style.display = hasMask ? '' : 'none';
}

// ── VRT Options panel helpers ──────────────────────────────────────────────
function vrtTogglePanel(btn) {
  const body = btn.closest('.vrt-options-panel').querySelector('.vrt-options-body');
  const arrow = btn.querySelector('.vrt-toggle-arrow');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  arrow.style.transform = open ? 'rotate(90deg)' : '';
}

function _seCollectVrtOptions(row) {
  const panel = row.querySelector('.vrt-options-panel');
  if (!panel) return undefined;
  const get = (sel) => panel.querySelector(sel);
  const numOrNull = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  const threshold        = numOrNull(get('.vrt-threshold')?.value);
  const maxDiffPixels    = numOrNull(get('.vrt-maxDiffPixels')?.value);
  const maxDiffPixelRatio = numOrNull(get('.vrt-maxDiffPixelRatio')?.value);
  const animations       = get('.vrt-animations')?.value || null;
  const maskRaw          = get('.vrt-mask')?.value?.trim() || '';
  const mask             = maskRaw ? maskRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const maskColor        = get('.vrt-maskColor')?.value?.trim() || null;
  const omitBackground   = get('.vrt-omitBackground')?.checked || false;
  const cx = numOrNull(get('.vrt-clip-x')?.value);
  const cy = numOrNull(get('.vrt-clip-y')?.value);
  const cw = numOrNull(get('.vrt-clip-w')?.value);
  const ch = numOrNull(get('.vrt-clip-h')?.value);
  const clip = (cx != null && cy != null && cw != null && ch != null)
    ? { x: cx, y: cy, width: cw, height: ch } : null;

  const opts = {};
  if (threshold != null)        opts.threshold        = threshold / 100;
  if (maxDiffPixels != null)    opts.maxDiffPixels    = maxDiffPixels;
  if (maxDiffPixelRatio != null) opts.maxDiffPixelRatio = maxDiffPixelRatio / 100;
  if (animations)               opts.animations       = animations;
  if (mask.length)              opts.mask             = mask;
  if (maskColor)                opts.maskColor        = maskColor;
  if (omitBackground)           opts.omitBackground   = true;
  if (clip)                     opts.clip             = clip;
  return Object.keys(opts).length ? opts : undefined;
}

function scriptStepKwChange(sel) {
  const row = sel.closest('.script-step-row');
  const opt = sel.selectedOptions[0];
  const kwKey = opt?.value || '';
  const needsLoc = opt?.dataset.nl === 'true';
  const needsVal = opt?.dataset.nv === 'true';
  const isAuto = opt?.dataset.auto === 'true';
  const isFnCall = kwKey === 'CALL FUNCTION';
  const hint = opt?.dataset.hint || 'Value';
  const helpText = opt?.dataset.help || '';
  const tipJson = opt?.dataset.tooltipJson || '';

  const isSetVar = kwKey === 'SET VARIABLE';
  const isFileChooser = kwKey === 'FILE CHOOSER';

  // GOTO auto-config: hide locator + value, show auto badge
  row.querySelector('.se-step-locator').style.display = (needsLoc && !isAuto && !isSetVar && !isFileChooser) ? '' : 'none';
  row.querySelector('.se-step-value').style.display = (needsVal && !isAuto && !isFnCall && !isSetVar && !isFileChooser) ? '' : 'none';
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

  // ── VRT info banner + options panel — inject/remove on keyword change ──
  const isVisualKw = kwKey === 'ASSERT VISUAL';
  // Info banner
  let vrtBanner = row.querySelector('.vrt-info-banner');
  if (isVisualKw && !vrtBanner) {
    vrtBanner = document.createElement('div');
    vrtBanner.className = 'vrt-info-banner';
    vrtBanner.innerHTML = '<span class="vrt-info-icon">&#9432;</span>'
      + '<span class="vrt-info-text"><strong>Visual Regression Mode:</strong>'
      + ' <span class="vrt-mode-el">&#128270; <strong>Element</strong> — fill the locator to screenshot only that element</span>'
      + ' &nbsp;|&nbsp; <span class="vrt-mode-fp">&#128444; <strong>Full Page</strong> — leave locator blank to capture the entire viewport</span>'
      + '</span>';
    const locDiv = row.querySelector('.se-step-locator');
    if (locDiv) locDiv.before(vrtBanner);
  } else if (!isVisualKw && vrtBanner) {
    vrtBanner.remove();
  }
  // Locator label optional hint
  const locLabel = row.querySelector('.se-step-locator label');
  if (locLabel) {
    let optSpan = locLabel.querySelector('.vrt-loc-optional');
    if (isVisualKw && !optSpan) {
      optSpan = document.createElement('span');
      optSpan.className = 'vrt-loc-optional';
      optSpan.style.cssText = 'font-size:10px;color:var(--g400);font-weight:400';
      optSpan.textContent = ' (optional — blank = full page)';
      locLabel.appendChild(optSpan);
    } else if (!isVisualKw && optSpan) {
      optSpan.remove();
    }
  }
  // VRT Options panel
  let vrtPanel = row.querySelector('.vrt-options-panel');
  if (isVisualKw && !vrtPanel) {
    vrtPanel = document.createElement('div');
    vrtPanel.className = 'vrt-options-panel';
    vrtPanel.innerHTML = '<button type="button" class="vrt-options-toggle" onclick="vrtTogglePanel(this)">'
      + '<span class="vrt-toggle-arrow">&#9654;</span> &#9881; VRT Options'
      + ' <span class="vrt-options-hint">— leave blank to use project defaults</span></button>'
      + '<div class="vrt-options-body" style="display:none">'
      + '<div class="vrt-options-grid">'
      + '<div class="vrt-field"><label>Threshold (0–100)</label><input class="fm-input vrt-threshold" type="number" min="0" max="100" step="1" title="Color diff tolerance per pixel. 20 = allow 20% colour variance." /></div>'
      + '<div class="vrt-field"><label>Max Diff Pixels</label><input class="fm-input vrt-maxDiffPixels" type="number" min="0" step="1" title="Hard cap on differing pixels. Blank = no pixel cap." /></div>'
      + '<div class="vrt-field"><label>Max Diff Pixel Ratio (0–100%)</label><input class="fm-input vrt-maxDiffPixelRatio" type="number" min="0" max="100" step="1" title="Max % of total pixels allowed to differ." /></div>'
      + '<div class="vrt-field"><label>Animations</label><select class="fm-select vrt-animations"><option value="">Loading project default…</option><option value="disabled">Disabled (freeze)</option><option value="allow">Allow (live)</option></select></div>'
      + '<div class="vrt-field"><label>Scale</label><select class="fm-select vrt-scale"><option value="">Loading project default…</option><option value="css">CSS (device-independent)</option><option value="device">Device (physical pixels)</option></select></div>'
      + '<div class="vrt-field"><label>Caret</label><select class="fm-select vrt-caret"><option value="">Loading project default…</option><option value="hide">Hide</option><option value="initial">Initial</option></select></div>'
      + '<div class="vrt-field" style="grid-column:1/-1"><label>Mask Selectors <span style="font-weight:400;color:var(--g400)">(comma-separated CSS — blanked before comparison)</span></label>'
      + '<input class="fm-input vrt-mask" type="text" placeholder="e.g. .timestamp, #live-counter, .user-avatar" title="Elements hidden before screenshot — use for timestamps, avatars, live counters."'
      + ' oninput="_vrtToggleMaskColor(this.closest(\'.vrt-options-panel\'))" /></div>'
      + '<div class="vrt-maskcolor-row" style="display:none"><div class="vrt-field"><label>Mask Color</label><div style="display:flex;gap:6px;align-items:center">'
      + '<input type="color" class="vrt-maskColor-picker" value="#FF00FF" style="width:36px;height:28px;border:none;padding:0;cursor:pointer" oninput="this.nextElementSibling.value=this.value" />'
      + '<input class="fm-input vrt-maskColor" type="text" style="font-family:monospace;font-size:12px" placeholder="#FF00FF" oninput="this.previousElementSibling.value=this.value" /></div></div></div>'
      + '<div class="vrt-field" style="display:flex;align-items:center;gap:8px;padding-top:18px"><label style="margin:0">Omit Background</label>'
      + '<input type="checkbox" class="vrt-omitBackground" title="Transparent PNG for overlay components." />'
      + '<span style="font-size:10px;color:var(--g400)">Transparent PNG</span></div>'
      + '</div>'
      + '<div class="vrt-clip-row" style="display:none"><label style="font-size:11px;display:block;margin-bottom:4px">Clip Region <span style="font-weight:400;color:var(--g400)">(full-page mode only)</span></label>'
      + '<div style="display:flex;gap:8px;align-items:center">'
      + '<span style="font-size:11px;color:var(--g500)">X</span><input class="fm-input vrt-clip-x" type="number" min="0" style="width:70px" placeholder="0" />'
      + '<span style="font-size:11px;color:var(--g500)">Y</span><input class="fm-input vrt-clip-y" type="number" min="0" style="width:70px" placeholder="0" />'
      + '<span style="font-size:11px;color:var(--g500)">W</span><input class="fm-input vrt-clip-w" type="number" min="1" style="width:70px" placeholder="1280" />'
      + '<span style="font-size:11px;color:var(--g500)">H</span><input class="fm-input vrt-clip-h" type="number" min="1" style="width:70px" placeholder="720" />'
      + '<span style="font-size:10px;color:var(--g400)">px</span></div></div>'
      + '</div>';
    const valDiv = row.querySelector('.se-step-value');
    if (valDiv) valDiv.before(vrtPanel);
    // Load project-specific defaults as placeholders — isolated per project via currentProjectId global
    _vrtApplyProjectDefaults(vrtPanel, currentProjectId);
  } else if (!isVisualKw && vrtPanel) {
    vrtPanel.remove();
  }
  // Show/hide clip row based on whether locator is filled
  if (isVisualKw) {
    const locInput = row.querySelector('.se-step-selector');
    const clipRow = row.querySelector('.vrt-clip-row');
    if (locInput && clipRow) {
      locInput.addEventListener('input', () => {
        clipRow.style.display = locInput.value.trim() ? 'none' : '';
      }, { once: false });
      clipRow.style.display = locInput.value.trim() ? 'none' : '';
    }
  }
}

function _populateFnSelect(row) {
  const sel = row.querySelector('.se-step-fn-select');
  if (!sel) return;
  // Restore saved value: data-saved-fn on picker div (set at render time from step.value)
  const picker = row.querySelector('.se-step-fn-picker');
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
  const sel = row.querySelector('.se-step-fn-select');
  const expandEl = row.querySelector('.se-fn-expand-area');
  if (!sel || !expandEl) return;
  const fnName = sel.value;
  const fn = allFunctions.find(f => f.name === fnName);
  if (!fn || !(fn.steps || []).length) { expandEl.style.display = 'none'; expandEl.innerHTML = ''; return; }

  const picker = row.querySelector('.se-step-fn-picker');
  let savedVals = [];
  try { savedVals = JSON.parse(picker?.dataset.fnStepValues || '[]'); } catch { }

  const stepNum = row.querySelector('.step-num')?.textContent || '?';

  expandEl.style.display = '';
  expandEl.innerHTML = `
    <div class="fn-expand-header">
      <button type="button" class="tbl-btn fn-expand-toggle" onclick="_toggleFnExpand(this)" style="font-size:11px;padding:2px 8px">
        ▶ Show ${fn.steps.length} step${fn.steps.length > 1 ? 's' : ''} (${escHtml(fn.name)})
      </button>
    </div>
    <div class="fn-child-steps" style="display:none">
      ${fn.steps.map((fs, fi) => {
    const kwMeta = _seKwGet(fs.keyword);
    const needsVal = kwMeta ? kwMeta.needsValue : false;
    const valHint = kwMeta?.valueHint || 'Value';
    const saved = savedVals.find(v => v.fnStepIdx === fi) || {};
    const valMode = saved.valueMode || 'static';
    const isDyn = valMode === 'dynamic';
    const isCd = valMode === 'commondata';
    const isTd = valMode === 'testdata';
    const locDisplay = [fs.locatorName || fs.detail, fs.selector].filter(Boolean).join(' → ');
    const dynOpts = '<option value="">— choose token —</option>' +
      (scriptKeywords.dynamicTokens || []).map(t =>
        `<option value="${escHtml(t.token)}"${isDyn && saved.value === t.token ? ' selected' : ''}>${escHtml(t.label)}</option>`
      ).join('');
    const tdRows = (saved.testData || []).map((r, ri) => `
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
              <button type="button" class="value-toggle-btn${valMode === 'static' ? ' active' : ''}" onclick="fnCsToggleVal(this,'static')">Static</button>
              <button type="button" class="value-toggle-btn${isDyn ? ' active' : ''}" onclick="fnCsToggleVal(this,'dynamic')">Dynamic</button>
              <button type="button" class="value-toggle-btn${isCd ? ' active' : ''}" onclick="fnCsToggleVal(this,'commondata')">Common Data</button>
              <button type="button" class="value-toggle-btn value-toggle-td${isTd ? ' active' : ''}" onclick="fnCsToggleVal(this,'testdata')">Test Data (Static)</button>
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
  childRow.querySelector('.fn-cs-val-static')?.style && (childRow.querySelector('.fn-cs-val-static').style.display = mode === 'static' ? '' : 'none');
  childRow.querySelector('.fn-cs-val-dynamic')?.style && (childRow.querySelector('.fn-cs-val-dynamic').style.display = mode === 'dynamic' ? '' : 'none');
  childRow.querySelector('.fn-cs-val-cd')?.style && (childRow.querySelector('.fn-cs-val-cd').style.display = mode === 'commondata' ? '' : 'none');
  childRow.querySelector('.fn-cs-val-td')?.style && (childRow.querySelector('.fn-cs-val-td').style.display = mode === 'testdata' ? '' : 'none');
  if (mode === 'commondata') _loadFnCsOptions(childRow);
}

async function _loadFnCsOptions(childRow) {
  const sel = childRow.querySelector('.fn-cs-cd-select');
  if (!sel || !currentProjectId) return;
  const res = await fetch(`/api/common-data?projectId=${encodeURIComponent(currentProjectId)}`);
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
  const sel = childRow.querySelector('.fn-cs-cd-select');
  const preview = childRow.querySelector('.fn-cs-val-cd .cd-token-preview');
  if (!preview) return;
  const name = sel?.value || '';
  if (name) { preview.style.display = ''; preview.innerHTML = `Reference: <code>\${${escHtml(name)}}</code>`; }
  else preview.style.display = 'none';
}

function fnCsTdAddRow(btn) {
  const tbody = btn.closest('.td-frame').querySelector('.fn-cs-td-tbody');
  const rowNum = tbody.querySelectorAll('.fn-cs-td-row').length + 1;
  const tr = document.createElement('tr');
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
  row.querySelector('.se-step-val-static')?.style && (row.querySelector('.se-step-val-static').style.display = mode === 'static' ? '' : 'none');
  row.querySelector('.se-step-val-dynamic')?.style && (row.querySelector('.se-step-val-dynamic').style.display = mode === 'dynamic' ? '' : 'none');
  row.querySelector('.se-step-val-cd')?.style && (row.querySelector('.se-step-val-cd').style.display = mode === 'commondata' ? '' : 'none');
  row.querySelector('.se-step-val-td')?.style && (row.querySelector('.se-step-val-td').style.display = mode === 'testdata' ? '' : 'none');
  row.querySelector('.se-step-val-var')?.style && (row.querySelector('.se-step-val-var').style.display = mode === 'variable' ? '' : 'none');
  if (mode === 'commondata') _loadCdOptions(row);
  if (mode === 'variable') _loadVarOptions(row);

  // Pin (Store As Variable) is not allowed when Value Source is Test Data (Static)
  const pinBtn = row.querySelector('.step-pin-icon');
  const pinBadge = row.querySelector('.step-pin-badge');
  if (mode === 'testdata') {
    // Disable pin button
    if (pinBtn) {
      pinBtn.disabled = true;
      pinBtn.classList.add('step-pin-disabled');
      pinBtn.title = 'Variable storage not allowed when Value Source is Test Data (Static)';
    }
    // Clear and hide any existing pin badge
    if (pinBadge) {
      pinBadge.dataset.storeAs = '';
      pinBadge.classList.add('step-pin-badge-hidden');
    }
  } else {
    // Re-enable pin button
    if (pinBtn) {
      pinBtn.disabled = false;
      pinBtn.classList.remove('step-pin-disabled');
      pinBtn.title = 'Save value as variable (📌 Pin)';
    }
    // Restore badge visibility if storeAs was previously set
    if (pinBadge && pinBadge.dataset.storeAs) {
      pinBadge.classList.remove('step-pin-badge-hidden');
    }
  }
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

  // 1. Scan DOM rows of the currently open editor (catches unsaved edits)
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

  // 2. Scan saved scripts in allScripts (catches global vars defined in other scripts)
  (allScripts || []).forEach(sc => {
    (sc.steps || []).forEach(step => {
      if (step.storeAs && step.storeScope === 'global') {
        if (!globalVars.includes(step.storeAs)) globalVars.push(step.storeAs);
      }
      if (step.keyword === 'SET VARIABLE' && step.storeScope === 'global' && step.storeAs) {
        if (!globalVars.includes(step.storeAs)) globalVars.push(step.storeAs);
      }
    });
  });

  const savedVal = sel.dataset.savedVar || sel.value || '';
  const noHint = row.querySelector('.var-no-vars-hint');
  const useHint = row.querySelector('.var-usage-hint');

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
    html += sessionVars.map(v => `<option value="${escHtml(v)}"${v === savedVal ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
    html += `</optgroup>`;
  }
  if (globalVars.length) {
    html += `<optgroup label="🌐 Suite — all scripts (global)">`;
    html += globalVars.map(v => `<option value="${escHtml(v)}"${v === savedVal ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
    html += `</optgroup>`;
  }
  sel.innerHTML = html;
  sel.dataset.savedVar = '';
  _varSelectChanged(sel);
}

function _varSelectChanged(sel) {
  const row = sel.closest('.script-step-row');
  const hint = row?.querySelector('.var-usage-hint');
  const token = row?.querySelector('.var-usage-token');
  const v = sel.value;
  if (hint && token) {
    if (v) { token.textContent = `{{var.${v}}}`; hint.style.display = ''; }
    else { hint.style.display = 'none'; }
  }
}

// ── 📌 Pin icon handlers ───────────────────────────────────────────────────────

function scriptStepPinOpen(btn) {
  const row = btn.closest('.script-step-row');

  // Block pin when Value Source is Test Data (Static) — N rows would overwrite same variable unpredictably
  const isTestData = row.querySelector('.value-toggle-td.active') !== null;
  if (isTestData) {
    alert('Variable storage is not allowed when Value Source is "Test Data (Static)".\n\nReason: Test Data runs multiple rows — each row would overwrite the same variable, producing unpredictable results in later steps.');
    return;
  }

  const badge = row.querySelector('.step-pin-badge');
  const curName = badge?.dataset.storeAs || '';
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
            <label class="setvar-scope-opt${curScope === 'session' ? ' active' : ''}">
              <input type="radio" name="pin-scope" value="session" ${curScope === 'session' ? 'checked' : ''}/> 📌 Session
              <span style="font-size:10px;display:block;color:var(--neutral-500);margin-top:2px">This script only</span>
            </label>
            <label class="setvar-scope-opt${curScope === 'global' ? ' active' : ''}">
              <input type="radio" name="pin-scope" value="global" ${curScope === 'global' ? 'checked' : ''}/> 🌐 Global
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
    const nameVal = document.getElementById('pin-modal-name').value.trim().replace(/[^A-Za-z0-9_]/g, '');
    const scopeVal = overlay.querySelector('input[name="pin-scope"]:checked')?.value || 'session';
    overlay.remove();
    if (!nameVal) { scriptStepPinClear(btn); return; }
    if (badge) {
      badge.dataset.storeAs = nameVal;
      badge.dataset.storeScope = scopeVal;
      const icon = scopeVal === 'global' ? '🌐' : '📌';
      const scopeTag = scopeVal === 'global' ? 'Global' : 'Session';
      badge.querySelector('.pin-badge-label').innerHTML =
        `${icon} Saved as <code>{{var.${escHtml(nameVal)}}}</code><span class="pin-scope-tag">${scopeTag}</span>`;
      badge.classList.remove('step-pin-badge-hidden');
      badge.classList.toggle('step-pin-badge-global', scopeVal === 'global');
    }
    btn.classList.add('step-pin-active');
    // Refresh all downstream steps currently in Variable mode so they pick up the new pin
    _refreshAllVarDropdowns();
  };

  // Focus the name input
  setTimeout(() => document.getElementById('pin-modal-name')?.focus(), 50);
}

function scriptStepPinClear(btn) {
  const row = btn.closest('.script-step-row');
  const badge = row.querySelector('.step-pin-badge');
  if (badge) {
    badge.dataset.storeAs = '';
    badge.dataset.storeScope = 'session';
    badge.classList.add('step-pin-badge-hidden');
    badge.classList.remove('step-pin-badge-global');
  }
  row.querySelector('.step-pin-icon')?.classList.remove('step-pin-active');
  // Refresh all downstream steps in Variable mode so they drop the cleared pin
  _refreshAllVarDropdowns();
}

// Refresh every step currently showing the Variable source panel — called after any pin change
function _refreshAllVarDropdowns() {
  document.querySelectorAll('#se-steps-container .script-step-row').forEach(r => {
    if (r.querySelector('.se-step-val-var') && r.querySelector('.se-step-val-var').style.display !== 'none') {
      _loadVarOptions(r);
    }
  });
}

// SET VARIABLE source change
function _setVarSourceChanged(sel) {
  const row = sel.closest('.script-step-row');
  const isAttr = sel.value === 'attr';
  const isJs = sel.value === 'js';
  const attrW = row.querySelector('.se-setvar-attr-wrap');
  const jsW = row.querySelector('.se-setvar-js-wrap');
  const locDiv = row.querySelector('.se-step-locator');
  if (attrW) attrW.style.display = isAttr ? '' : 'none';
  if (jsW) jsW.style.display = isJs ? '' : 'none';
  if (locDiv) locDiv.style.display = isJs ? 'none' : '';
}

function _setVarNameHint(inp) {
  const row = inp.closest('.script-step-row');
  const hint = row?.querySelector('.setvar-hint');
  const code = hint?.querySelector('code');
  if (!hint || !code) return;
  const v = inp.value.trim();
  if (v) { code.textContent = `{{var.${v}}}`; hint.style.display = 'block'; }
  else { hint.style.display = 'none'; }
}

function _setVarScopeChanged(radio) {
  const row = radio.closest('.script-step-row');
  const isGlobal = radio.value === 'global';
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

  const widget = input.closest('.se-filechooser-widget');
  const row = input.closest('.script-step-row');
  const uploadArea = widget.querySelector('.fc-upload-area');
  const fileInfo = widget.querySelector('.fc-file-info');
  const uploading = widget.querySelector('.fc-uploading');

  // Delete previous file from server if replacing
  const prevPath = fileInfo?.dataset.serverPath;
  if (prevPath) {
    const parts = prevPath.split('/');
    if (parts.length >= 3) {
      await fetch(`/api/test-files/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`, { method: 'DELETE' }).catch(() => { });
    }
  }

  // Show uploading state
  if (uploadArea) uploadArea.style.display = 'none';
  if (fileInfo) fileInfo.style.display = 'none';
  if (uploading) uploading.style.display = '';

  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/test-files/upload?projectId=${encodeURIComponent(currentProjectId)}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    // Update widget to show file info
    if (fileInfo) {
      fileInfo.dataset.serverPath = data.serverPath;
      fileInfo.querySelector('.fc-filename').textContent = data.filename;
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
  const widget = btn.closest('.se-filechooser-widget');
  const fileInfo = widget.querySelector('.fc-file-info');
  const uploadArea = widget.querySelector('.fc-upload-area');
  const prevPath = fileInfo?.dataset.serverPath;

  if (prevPath) {
    const parts = prevPath.split('/');
    if (parts.length >= 3) {
      await fetch(`/api/test-files/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`, { method: 'DELETE' }).catch(() => { });
    }
  }
  if (fileInfo) { fileInfo.dataset.serverPath = ''; fileInfo.style.display = 'none'; }
  if (uploadArea) uploadArea.style.display = '';
}

// Populate Common Data dropdown for a step row
async function _loadCdOptions(row) {
  const sel = row.querySelector('.se-step-cd-select');
  if (!sel || !currentProjectId) return;
  const res = await fetch(`/api/common-data?projectId=${encodeURIComponent(currentProjectId)}`);
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
  const sel = row.querySelector('.se-step-cd-select');
  const preview = row.querySelector('.cd-token-preview');
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
    const valInput = row.querySelector('.se-step-selector');
    const typeSelect = row.querySelector('.se-step-loc-type');
    if (nameInput) nameInput.value = name || '';
    if (valInput) valInput.value = selector || '';
    if (typeSelect && selectorType) typeSelect.value = selectorType;
    // Lock fields as read-only (inherited from Locator Repo)
    _scriptStepLockLocator(row, true);
  });
}

function _scriptStepLockLocator(row, locked) {
  const nameInput = row.querySelector('.se-step-loc-name');
  const valInput = row.querySelector('.se-step-selector');
  const typeSelect = row.querySelector('.se-step-loc-type');
  const lockBadge = row.querySelector('.loc-repo-badge');
  const unlockBtn = row.querySelector('.loc-unlock-btn');
  if (nameInput) { nameInput.readOnly = locked; nameInput.classList.toggle('loc-locked', locked); }
  if (valInput) { valInput.readOnly = locked; valInput.classList.toggle('loc-locked', locked); }
  if (typeSelect) { typeSelect.disabled = locked; typeSelect.classList.toggle('loc-locked', locked); }
  if (lockBadge) lockBadge.style.display = locked ? '' : 'none';
  if (unlockBtn) unlockBtn.style.display = locked ? '' : 'none';
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
  const kw = row.querySelector('.se-step-kw-select')?.value || '';
  const isFnCall = kw === 'CALL FUNCTION';
  let valueMode, value, fnStepValues;
  if (isFnCall) {
    valueMode = 'static';
    value = row.querySelector('.se-step-fn-select')?.value || null;
    fnStepValues = [...(row.querySelectorAll('.fn-child-row') || [])]
      .filter(cr => cr.querySelector('.fn-cs-value'))
      .map(cr => {
        const fi = parseInt(cr.dataset.fnStepIdx);
        const activeCs = cr.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
        let csMode, csValue, csTestData = [];
        if (activeCs === 'Dynamic') {
          csMode = 'dynamic';
          csValue = cr.querySelector('.fn-cs-val-dynamic')?.value || null;
        } else if (activeCs === 'Common Data') {
          csMode = 'commondata';
          const cdName = cr.querySelector('.fn-cs-cd-select')?.value || '';
          csValue = cdName ? `\${${cdName}}` : null;
        } else if (activeCs === 'Test Data (Static)') {
          csMode = 'testdata';
          csValue = null;
          csTestData = [...(cr.querySelectorAll('.fn-cs-td-row') || [])].map(tr => ({
            value: tr.querySelector('.fn-cs-td-val')?.value?.trim() || '',
          })).filter(r => r.value);
        } else {
          csMode = 'static';
          csValue = cr.querySelector('.fn-cs-val-static')?.value?.trim() || null;
        }
        return { fnStepIdx: fi, valueMode: csMode, value: csValue, testData: csTestData };
      });
  } else if (activeTab === '📌 Variable') {
    valueMode = 'variable';
    value = row.querySelector('.se-step-var-select')?.value || null;
  } else if (activeTab === 'Dynamic') {
    valueMode = 'dynamic';
    value = row.querySelector('.se-step-val-dynamic')?.value || null;
  } else if (activeTab === 'Common Data') {
    valueMode = 'commondata';
    const cdName = row.querySelector('.se-step-cd-select')?.value || '';
    value = cdName ? `\${${cdName}}` : null;
  } else if (activeTab === 'Test Data (Static)') {
    valueMode = 'testdata';
    value = null;
  } else {
    valueMode = 'static';
    value = row.querySelector('.se-step-val-static')?.value?.trim() || null;
  }
  const testData = [...(row.querySelectorAll('.td-row') || [])].map(tr => ({
    value: tr.querySelector('.td-val')?.value?.trim() || '',
  })).filter(r => r.value);

  const badge = row.querySelector('.step-pin-badge');
  const clonedStep = {
    id: `clone-${Date.now()}`,
    keyword: kw,
    locatorName: row.querySelector('.se-step-loc-name')?.value?.trim() || null,
    locatorType: row.querySelector('.se-step-loc-type')?.value || 'css',
    locator: row.querySelector('.se-step-selector')?.value?.trim() || null,
    locatorId: row.dataset.locatorId || null,
    valueMode,
    value,
    testData,
    fnStepValues: fnStepValues || [],
    description: row.querySelector('.se-step-desc')?.value?.trim() || '',
    screenshot: row.querySelector('.se-step-screenshot')?.checked || false,
    storeAs: badge?.dataset.storeAs || undefined,
    storeScope: badge?.dataset.storeAs ? (badge.dataset.storeScope || 'session') : undefined,
    storeSource: row.querySelector('.se-setvar-source')?.value || undefined,
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
  if (!title) { modAlert('script-editor-alert', 'error', 'Title is required'); return; }
  if (!currentProjectId) { modAlert('script-editor-alert', 'error', 'Select a project first'); return; }

  const steps = [...document.querySelectorAll('#se-steps-container .script-step-row')].map((row, i) => {
    const activeTab = row.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
    const kw = row.querySelector('.se-step-kw-select')?.value || '';
    const isFnCall = kw === 'CALL FUNCTION';
    const isFileChooser = kw === 'FILE CHOOSER';
    let valueMode, value, fnStepValues;
    if (isFileChooser) {
      valueMode = 'static';
      value = row.querySelector('.fc-file-info')?.dataset.serverPath || null;
    } else if (isFnCall) {
      valueMode = 'static';
      value = row.querySelector('.se-step-fn-select')?.value || null;
      fnStepValues = [...(row.querySelectorAll('.fn-child-row') || [])]
        .filter(cr => cr.querySelector('.fn-cs-value'))
        .map(cr => {
          const fi = parseInt(cr.dataset.fnStepIdx);
          const activeCs = cr.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
          let csMode, csValue, csTestData = [];
          if (activeCs === 'Dynamic') {
            csMode = 'dynamic';
            csValue = cr.querySelector('.fn-cs-val-dynamic')?.value || null;
          } else if (activeCs === 'Common Data') {
            csMode = 'commondata';
            const cdName = cr.querySelector('.fn-cs-cd-select')?.value || '';
            csValue = cdName ? `\${${cdName}}` : null;
          } else if (activeCs === 'Test Data (Static)') {
            csMode = 'testdata';
            csValue = null;
            csTestData = [...(cr.querySelectorAll('.fn-cs-td-row') || [])].map(tr => ({
              value: tr.querySelector('.fn-cs-td-val')?.value?.trim() || '',
            })).filter(r => r.value);
          } else {
            csMode = 'static';
            csValue = cr.querySelector('.fn-cs-val-static')?.value?.trim() || null;
          }
          return { fnStepIdx: fi, valueMode: csMode, value: csValue, testData: csTestData };
        });
    } else if (activeTab === '📌 Variable') {
      valueMode = 'variable';
      value = row.querySelector('.se-step-var-select')?.value || null;
    } else if (activeTab === 'Dynamic') {
      valueMode = 'dynamic';
      value = row.querySelector('.se-step-val-dynamic')?.value || null;
    } else if (activeTab === 'Common Data') {
      valueMode = 'commondata';
      const cdName = row.querySelector('.se-step-cd-select')?.value || '';
      value = cdName ? `\${${cdName}}` : null;
    } else if (activeTab === 'Test Data (Static)') {
      valueMode = 'testdata';
      value = null;
    } else {
      valueMode = 'static';
      value = row.querySelector('.se-step-val-static')?.value?.trim() || null;
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
    const badge = row.querySelector('.step-pin-badge');
    const storeAs = badge?.dataset.storeAs || undefined;
    const storeAttr = isSetVar ? (row.querySelector('.se-setvar-attr')?.value?.trim() || undefined) : undefined;
    const storeVarName = isSetVar ? (row.querySelector('.se-setvar-name')?.value?.trim() || undefined) : storeAs;

    return {
      id: row.dataset.stepId || `step-${i + 1}`,
      order: i + 1,
      keyword: kw,
      locatorName: row.querySelector('.se-step-loc-name')?.value?.trim() || null,
      locatorType: row.querySelector('.se-step-loc-type')?.value || 'css',
      locator: row.querySelector('.se-step-selector')?.value?.trim() || null,
      // OLD: locatorId: null,  // was always null — prevented T2 healing from finding alternatives
      locatorId: row.dataset.locatorId || null,
      valueMode,
      value,
      testData,
      fnStepValues: fnStepValues || [],
      description: row.querySelector('.se-step-desc')?.value?.trim() || '',
      screenshot: row.querySelector('.se-step-screenshot')?.checked || false,
      storeAs: isSetVar ? storeVarName : (storeAs || undefined),
      storeScope: isSetVar
        ? (row.querySelector('.se-setvar-scope:checked')?.value || 'session')
        : (storeAs ? (badge?.dataset.storeScope || 'session') : undefined),
      storeSource: isSetVar ? storeSource : undefined,
      storeAttrName: storeAttr || undefined,
      vrtOptions: kw === 'ASSERT VISUAL' ? _seCollectVrtOptions(row) : undefined,
    };
  });

  // Validate: each testdata step must have at least one value row
  const emptyTdStep = steps.findIndex(s => s.valueMode === 'testdata' && !(s.testData || []).length);
  if (emptyTdStep !== -1) { modAlert('script-editor-alert', 'error', `Step ${emptyTdStep + 1}: Test Data (Static) requires at least one value row.`); return; }

  const tags = document.getElementById('se-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const subcompVal = document.getElementById('se-subcomponent')?.value || '';
  const body = {
    projectId: currentProjectId, title,
    component: document.getElementById('se-component').value,
    subcomponent: subcompVal || undefined,
    description: document.getElementById('se-desc').value.trim(),
    tags, priority: document.getElementById('se-priority').value, steps,
  };
  const method = editingScriptId ? 'PUT' : 'POST';
  const url = editingScriptId ? `/api/scripts/${editingScriptId}` : '/api/scripts';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('script-editor-alert', 'error', data.error || 'Error saving script'); return; }

  // Close editor + refresh list immediately — don't wait for locator sync
  const stepsForSync = steps;
  const savedScriptId = editingScriptId || data.id; // capture before scriptEditorClose() nulls it
  _syncFailedLocators.clear();
  scriptEditorClose();
  await scriptLoad();

  // Background locator sync — surfaces failures as banner + step badges on re-open
  // Also patches locatorId back onto each step so T2 self-healing can find alternatives at codegen time
  _syncLocatorsToRepo(stepsForSync).then(({ failed, selectorToId }) => {
    if (failed.length) {
      _syncFailedLocators = new Set(failed);
      _showSyncFailBanner(failed, 'script');
    }
    // Patch locatorId back onto saved steps — only if any were resolved
    if (selectorToId.size > 0 && savedScriptId) {
      const patchedSteps = stepsForSync.map(s =>
        s.locator && selectorToId.has(s.locator)
          ? { ...s, locatorId: selectorToId.get(s.locator) }
          : s
      );
      const anyChanged = patchedSteps.some((s, i) => s.locatorId !== stepsForSync[i].locatorId);
      if (anyChanged) {
        fetch(`/api/scripts/${savedScriptId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ steps: patchedSteps }),
        }).catch(() => { });
      }
    }
  }).catch(() => { });
}

async function _syncLocatorsToRepo(steps) {
  if (!currentProjectId) return { failed: [], selectorToId: new Map() }; // never save unscoped locators
  const failed = [];
  // selector → locatorId — returned so caller can patch locatorId back onto steps
  const selectorToId = new Map();

  // Dedup: one entry per unique selector — prevents parallel duplicate creation
  const seen = new Map(); // selector -> step
  for (const step of steps) {
    if (step.locatorName && step.locator && !seen.has(step.locator)) {
      seen.set(step.locator, step);
    }
  }
  const uniqueSteps = Array.from(seen.values());

  // Fetch ALL locators for this project including draft=true (recorder-captured ones)
  // so we can promote them instead of creating bare duplicates
  let allWithDraft = [];
  try {
    const r = await fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}&includeDraft=true`);
    allWithDraft = r.ok ? await r.json() : [];
  } catch { allWithDraft = []; }

  // Sequential to avoid race conditions
  for (const step of uniqueSteps) {
    try {
      // Match by selector+selectorType (finds draft recorder-created locators with alternatives)
      // then fall back to name match
      const existing =
        allWithDraft.find(l => l.selector === step.locator && l.selectorType === step.locatorType) ||
        allWithDraft.find(l => l.name === step.locatorName);

      if (existing) {
        // Promote draft → live, preserving all alternatives and healingProfile
        const needsUpdate = existing.draft === true ||
          existing.selector !== step.locator ||
          existing.selectorType !== step.locatorType;
        if (needsUpdate) {
          const res = await fetch(`/api/locators/${existing.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ draft: false }),
          });
          if (!res.ok) failed.push(step.locatorName);
          else allWithDraft = allWithDraft.map(l => l.id === existing.id ? { ...l, draft: false } : l);
        }
        selectorToId.set(step.locator, existing.id);
      } else {
        // No recorder-captured locator exists — create bare one as fallback
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
        if (!res.ok) {
          failed.push(step.locatorName);
        } else {
          const created = await res.clone().json().catch(() => null);
          if (created?.id) {
            allWithDraft = [...allWithDraft, created];
            selectorToId.set(step.locator, created.id);
          }
        }
      }
    } catch {
      failed.push(step.locatorName);
    }
  }

  try { await locatorLoadScoped(); } catch { /* non-fatal */ }
  return { failed, selectorToId };
}

function _showSyncFailBanner(failedNames, context) {
  // Remove any stale banner first
  document.getElementById('locator-sync-fail-banner')?.remove();

  const count = failedNames.length;
  const names = failedNames.map(n => `<strong>${escHtml(n)}</strong>`).join(', ');
  const subject = context === 'function' ? 'Function' : 'Script';
  const panelId = context === 'function' ? 'panel-functions' : 'panel-scripts';

  const banner = document.createElement('div');
  banner.id = 'locator-sync-fail-banner';
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

async function scriptClone(id) {
  const res  = await fetch(`/api/scripts/${id}/clone`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#991b1b;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
    toast.textContent = '✗ ' + (data.error || 'Clone failed');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
    return;
  }
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#166534;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  toast.textContent = `✓ Cloned as ${data.tcId}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
  await scriptLoad();
}

async function scriptDelete(id, title) {
  if (!confirm(`Delete script "${title}"? This cannot be undone.`)) return;
  await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
  await scriptLoad();
}

// ══════════════════════════════════════════════════════════════════════════════

// ── NL Bulk Suggest Panel ──────────────────────────────────────────────────

let _nlBulkResults = [];

async function nlSuggestSteps() {
  const input = document.getElementById('nl-input');
  const statusEl = document.getElementById('nl-status');
  const resultsEl = document.getElementById('nl-results');
  const noAiHint = document.getElementById('nl-no-ai-hint');
  const aiBadge = document.getElementById('nl-ai-badge');
  const ruleBadge = document.getElementById('nl-rule-badge');

  if (!input || !input.value.trim()) return;

  statusEl.textContent = '⏳ Thinking…';
  document.getElementById('nl-suggest-btn').disabled = true;
  resultsEl.innerHTML = '';
  _nlBulkResults = [];
  ['nl-apply-all-btn', 'nl-apply-matched-btn', 'nl-clear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  try {
    const res = await fetch('/api/nl/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.value.trim(), projectId: currentProjectId || '' }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      statusEl.textContent = '✗ ' + (data.error || 'Error');
      statusEl.style.color = '#f48771';
      return;
    }

    _nlBulkResults = data.steps || [];
    const hasAi = _nlBulkResults.some(s => s.source === 'ai');
    const hasMatched = _nlBulkResults.some(s => s.matched);

    if (aiBadge) aiBadge.style.display = hasAi ? '' : 'none';
    if (ruleBadge) ruleBadge.style.display = hasAi ? 'none' : '';
    if (noAiHint) noAiHint.style.display = (!hasAi && data.meta && !data.meta.provider) ? '' : 'none';

    statusEl.textContent = `${_nlBulkResults.length} step${_nlBulkResults.length !== 1 ? 's' : ''} suggested`;
    statusEl.style.color = '';

    resultsEl.innerHTML = _nlBulkResults.map((s, i) => `
      <div class="nl-result-row" style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border,#2a2b2e)">
        <input type="checkbox" id="nl-check-${i}" checked style="flex-shrink:0" />
        <span style="flex:1;font-size:12px;color:var(--text,#e0e0e0)">${_escHtml(s.originalSentence || '')}</span>
        <span style="font-size:11px;color:var(--neutral-500);white-space:nowrap">${_escHtml(s.keyword || '—')}</span>
        <span style="font-size:11px;color:${s.matched ? '#4ec9b0' : 'var(--neutral-500)'};white-space:nowrap">${s.matched ? '✓' : '?'}</span>
      </div>
    `).join('');

    ['nl-apply-all-btn', 'nl-clear'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    if (hasMatched) {
      const mb = document.getElementById('nl-apply-matched-btn');
      if (mb) mb.style.display = '';
    }
  } catch (e) {
    statusEl.textContent = '✗ Network error';
    statusEl.style.color = '#f48771';
  } finally {
    document.getElementById('nl-suggest-btn').disabled = false;
  }
}

function nlApplyAll() {
  if (!_nlBulkResults.length) return;
  const container = document.getElementById('se-steps-container');
  _nlBulkResults.forEach(s => {
    scriptAddStep({ keyword: s.keyword || '', locatorName: s.locatorName || '', value: s.value || '' });
    if (s.locatorName) {
      const row = container.querySelector('.script-step-row:last-child');
      if (row) _seResolveLocName(row, s.locatorName);
    }
  });
  nlClearSuggestions();
}

function nlApplyMatched() {
  if (!_nlBulkResults.length) return;
  const container = document.getElementById('se-steps-container');
  _nlBulkResults
    .filter((s, i) => {
      const cb = document.getElementById('nl-check-' + i);
      return s.matched && (!cb || cb.checked);
    })
    .forEach(s => {
      scriptAddStep({ keyword: s.keyword || '', locatorName: s.locatorName || '', value: s.value || '' });
      if (s.locatorName) {
        const row = container.querySelector('.script-step-row:last-child');
        if (row) _seResolveLocName(row, s.locatorName);
      }
    });
  nlClearSuggestions();
}

function nlClearSuggestions() {
  _nlBulkResults = [];
  const resultsEl = document.getElementById('nl-results');
  if (resultsEl) resultsEl.innerHTML = '';
  const statusEl = document.getElementById('nl-status');
  if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
  ['nl-apply-all-btn', 'nl-apply-matched-btn', 'nl-clear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const noAiHint = document.getElementById('nl-no-ai-hint');
  if (noAiHint) noAiHint.style.display = 'none';
}
// TEST SUITE MODULE
// ══════════════════════════════════════════════════════════════════════════════

let allSuites = [];
let editingSuiteId = null;
let currentSuiteId = null;
let _suitePage = 0;
let SUITE_PAGE_SIZE = 10;
let _suiteChecked = new Set();

// ── Suite Hooks state ─────────────────────────────────────────────────────────
let _hookBefore = []; // [{ keyword, locator, value, description }]
let _hookAfter = [];
let _hookFastMode = []; // login steps for Fast Mode beforeAll

// Keywords allowed in hooks (excludes CALL FUNCTION, GOTO, SET VARIABLE, DATE TOKEN, CALL API, file keywords)
const HOOK_EXCLUDED_KW = new Set([
  'CALL FUNCTION', 'GOTO', 'SET VARIABLE', 'DATE TOKEN', 'CALL API',
  'ASSERT FILE DOWNLOADED', 'ASSERT DOWNLOAD COUNT', 'READ EXCEL VALUE',
  'ASSERT EXCEL ROW COUNT', 'READ PDF TEXT',
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
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  const listId = which === 'fastmode' ? 'hook-fastmode-list' : `hook-${which}-list`;
  const emptyId = which === 'fastmode' ? 'hook-fastmode-empty' : `hook-${which}-empty`;
  const listEl = document.getElementById(listId);
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
    const kw = kws.find(k => k.key === step.keyword) || null;
    const needLoc = kw ? kw.needsLocator : true;
    const needVal = kw ? kw.needsValue : true;
    const valHint = kw ? (kw.valueHint || '') : '';

    const row = document.createElement('div');
    row.className = 'hook-step-row';
    row.dataset.which = which;
    row.dataset.idx = idx;
    row.innerHTML = `
      <div class="hook-step-num">${idx + 1}</div>
      <select class="hook-kw-sel fm-input" style="flex:0 0 160px;font-size:12px" onchange="_hookKwChange('${which}',${idx},this)">
        ${kws.map(k => `<option value="${escHtml(k.key)}"${k.key === step.keyword ? ' selected' : ''}>${escHtml(k.label)}</option>`).join('')}
      </select>
      <input class="hook-loc-inp fm-input" style="flex:1;font-size:12px;${needLoc ? '' : 'opacity:.4'}" placeholder="Locator / selector"
             value="${escHtml(step.locator || '')}" ${needLoc ? '' : 'disabled'}
             oninput="_hookFieldChange('${which}',${idx},'locator',this.value)" />
      <input class="hook-val-inp fm-input" style="flex:1;font-size:12px;${needVal ? '' : 'opacity:.4'}" placeholder="${escHtml(valHint || 'Value')}"
             value="${escHtml(step.value || '')}" ${needVal ? '' : 'disabled'}
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
  _hookBefore = (beforeSteps || []).map(s => ({ keyword: s.keyword || 'CLICK', locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  _hookAfter = (afterSteps || []).map(s => ({ keyword: s.keyword || 'CLICK', locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  _hookFastMode = (fastSteps || []).map(s => ({ keyword: s.keyword || 'FILL', locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  const chk = document.getElementById('sm-fast-mode');
  const body = document.getElementById('sm-fast-mode-body');
  if (chk) chk.checked = !!fastModeOn;
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
  const listEl = document.getElementById('overlay-handler-list');
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
        <option value="any"     ${h.type === 'any' ? 'selected' : ''}>Any dialog</option>
        <option value="alert"   ${h.type === 'alert' ? 'selected' : ''}>alert()</option>
        <option value="confirm" ${h.type === 'confirm' ? 'selected' : ''}>confirm()</option>
        <option value="prompt"  ${h.type === 'prompt' ? 'selected' : ''}>prompt()</option>
      </select>
      <span style="font-size:12px;color:var(--neutral-500);flex:0 0 auto">&#8594;</span>
      <select class="fm-input" style="flex:0 0 100px;font-size:12px" onchange="_overlayChange(${idx},'action',this.value)">
        <option value="accept"  ${h.action === 'accept' ? 'selected' : ''}>Accept</option>
        <option value="dismiss" ${h.action === 'dismiss' ? 'selected' : ''}>Dismiss</option>
      </select>
      <input class="fm-input" style="flex:1;font-size:12px;display:${showText ? 'block' : 'none'}" placeholder="Prompt text (optional)"
             value="${escHtml(h.text || '')}" oninput="_overlayChange(${idx},'text',this.value)" />
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
  const listEl = document.getElementById('suite-list');
  if (!currentProjectId) {
    if (emptyEl) emptyEl.style.display = '';
    if (listEl) listEl.innerHTML = '';
    allSuites = [];
    return;
  }
  const res = await fetch(`/api/suites?projectId=${encodeURIComponent(currentProjectId)}`);
  allSuites = await res.json();
  _suitePage = 0;
  _suiteChecked.clear();
  suiteRender();
  execLoad(); // keep execution tab suite dropdown in sync
}

function suiteRender() {
  const q = (document.getElementById('suite-filter')?.value ?? '').toLowerCase();
  const listEl = document.getElementById('suite-list');
  const emptyEl = document.getElementById('suite-list-empty');
  if (!listEl) return;
  const filtered = allSuites.filter(s => !q || s.name.toLowerCase().includes(q));
  if (!currentProjectId) { emptyEl.style.display = ''; listEl.innerHTML = ''; return; }
  emptyEl.style.display = 'none';
  if (!filtered.length) { listEl.innerHTML = '<div class="builder-hint">No suites match the filter.</div>'; return; }

  const totalPages = Math.max(1, Math.ceil(filtered.length / SUITE_PAGE_SIZE));
  if (_suitePage >= totalPages) _suitePage = totalPages - 1;
  const page = filtered.slice(_suitePage * SUITE_PAGE_SIZE, (_suitePage + 1) * SUITE_PAGE_SIZE);
  const start = filtered.length ? _suitePage * SUITE_PAGE_SIZE + 1 : 0;
  const end = Math.min((_suitePage + 1) * SUITE_PAGE_SIZE, filtered.length);

  const checkedOnPage = page.filter(s => _suiteChecked.has(s.id)).length;
  const allChecked = page.length > 0 && checkedOnPage === page.length;

  const rppOpts = [10,25,50,100,200,500].map(n => `<option value="${n}"${SUITE_PAGE_SIZE===n?' selected':''}>${n}</option>`).join('');

  const pgHtml = `
    <div class="lt-pagination">
      <label style="font-size:12px;color:var(--neutral-500)">Rows per page:
        <select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto" onchange="_suiteSetPageSize(+this.value)">${rppOpts}</select>
      </label>
      ${totalPages <= 1
        ? `<span style="font-size:12px;color:var(--neutral-500)">${start}–${end} of ${filtered.length}</span>`
        : `<button class="tbl-btn" onclick="_suitePageGo(-1)" ${_suitePage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
           <span style="font-size:12px">Page ${_suitePage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${filtered.length})</span>
           <button class="tbl-btn" onclick="_suitePageGo(1)" ${_suitePage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`}
    </div>`;

  listEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 2px 8px;flex-wrap:wrap">
      ${!isViewer() ? `<label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer">
        <input type="checkbox" id="suite-chk-all" ${allChecked ? 'checked' : ''} onchange="_suiteToggleAll(this.checked)" /> Select All
      </label>` : ''}
      <span id="suite-sel-count" style="font-size:12px;color:var(--neutral-500);font-weight:600">${_suiteChecked.size ? _suiteChecked.size + ' selected' : ''}</span>
      <div id="suite-bulk-bar" style="${_suiteChecked.size ? 'display:flex' : 'display:none'};align-items:center;gap:6px;flex-wrap:wrap">
        <button class="tbl-btn del" onclick="suiteDeleteSelected()">&#128465; Delete Selected</button>
      </div>
    </div>
    <div class="lt-wrap">
      <div class="lt-body-wrap">
        <table class="data-table lt-fixed">
          <thead><tr>
            ${!isViewer() ? '<th style="min-width:32px;width:32px"></th>' : ''}
            <th style="min-width:200px">Suite Name</th>
            <th style="min-width:220px">Description</th>
            <th style="min-width:80px">Scripts</th>
            <th style="min-width:110px">Created By</th>
            <th style="min-width:110px">Date</th>
            <th style="min-width:120px">Actions</th>
          </tr></thead>
          <tbody>
          ${page.map(s => `
            <tr class="suite-tbl-row" data-id="${escHtml(s.id)}">
              ${!isViewer() ? `<td><input type="checkbox" class="suite-row-chk" value="${escHtml(s.id)}" ${_suiteChecked.has(s.id) ? 'checked' : ''} onchange="_suiteChkChange(this)" /></td>` : ''}
              <td title="${escHtml(s.name)}"><div style="font-weight:500">${escHtml(s.name)}</div></td>
              <td title="${escHtml(s.description || '')}" style="font-size:12px;color:var(--neutral-500)">${escHtml(s.description || '—')}</td>
              <td style="font-weight:600;color:var(--primary)">${(s.scriptIds || []).length}</td>
              <td style="font-size:12px">${escHtml(s.createdBy || '—')}</td>
              <td style="font-size:12px">${formatDate(s.createdAt)}</td>
              <td>
                <div style="display:flex;gap:4px">
                  ${isViewer() ? '' : `<button class="tbl-btn" onclick="suiteEditById('${escHtml(s.id)}')">Edit</button>`}
                  ${isViewer() ? '' : `<button class="tbl-btn del" onclick="suiteDelete('${escHtml(s.id)}','${escHtml(s.name)}')">Delete</button>`}
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${pgHtml}`;
}

function _suiteChkChange(chk) {
  if (chk.checked) _suiteChecked.add(chk.value);
  else _suiteChecked.delete(chk.value);
  _suiteUpdateBulkBar();
}

function _suiteToggleAll(checked) {
  const q = (document.getElementById('suite-filter')?.value ?? '').toLowerCase();
  const filtered = allSuites.filter(s => !q || s.name.toLowerCase().includes(q));
  const page = filtered.slice(_suitePage * SUITE_PAGE_SIZE, (_suitePage + 1) * SUITE_PAGE_SIZE);
  page.forEach(s => checked ? _suiteChecked.add(s.id) : _suiteChecked.delete(s.id));
  suiteRender();
}

function _suiteUpdateBulkBar() {
  const bar = document.getElementById('suite-bulk-bar');
  const cnt = document.getElementById('suite-sel-count');
  if (bar) bar.style.display = _suiteChecked.size ? 'flex' : 'none';
  if (cnt) cnt.textContent = _suiteChecked.size ? `${_suiteChecked.size} selected` : '';
}

function _suitePageGo(delta) {
  _suitePage += delta;
  suiteRender();
}

function _suiteSetPageSize(n) {
  SUITE_PAGE_SIZE = n;
  _suitePage = 0;
  suiteRender();
}

async function suiteDeleteSelected() {
  const ids = [..._suiteChecked];
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} suite${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
  const res = await fetch('/api/suites/bulk', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Delete failed'); return; }
  _suiteChecked.clear();
  await suiteLoad();
}

function _populateEnvDropdown(selectedEnvId = '') {
  const sel = document.getElementById('sm-env');
  if (!sel) return;
  const project = allProjects.find(p => p.id === currentProjectId);
  const envs = project?.environments || [];
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
let _smSelectedIds = [];   // ordered list of selected script ids (Zone B)
let _smCheckedIds = new Set(); // checkboxes ticked in Zone A (for bulk-add)
let _smPage = 1;
let _smPageSize = 10;
let _smSortCol = 'tcid';
let _smSortDir = 'asc';  // 'asc' | 'desc'
let _smFiltered = [];   // filtered+sorted slice of allScripts for Zone A

// ── Helpers ───────────────────────────────────────────────────────────────────
function _smTcId(s) { return s.tcId || s.id || ''; }

function _smApplyFilter() {
  const qTcid = (document.getElementById('sm-filter-tcid')?.value ?? '').toLowerCase().trim();
  const qTitle = (document.getElementById('sm-filter-title')?.value ?? '').toLowerCase().trim();
  const qComp = (document.getElementById('sm-filter-component')?.value ?? '').toLowerCase().trim();
  const qTag = (document.getElementById('sm-filter-tag')?.value ?? '').toLowerCase().trim();
  let list = allScripts.filter(s => {
    if (qTcid && !(_smTcId(s)).toLowerCase().includes(qTcid)) return false;
    if (qTitle && !(s.title || '').toLowerCase().includes(qTitle)) return false;
    if (qComp && !(s.component || '').toLowerCase().includes(qComp)) return false;
    if (qTag && !(s.tag || '').toLowerCase().includes(qTag)) return false;
    return true;
  });
  // Sort
  list.sort((a, b) => {
    let va, vb;
    if (_smSortCol === 'tcid') { va = _smTcId(a); vb = _smTcId(b); }
    else if (_smSortCol === 'title') { va = a.title || ''; vb = b.title || ''; }
    else if (_smSortCol === 'component') { va = a.component || ''; vb = b.component || ''; }
    else { va = _smTcId(a); vb = _smTcId(b); }
    const cmp = va.localeCompare(vb, undefined, { numeric: true });
    return _smSortDir === 'asc' ? cmp : -cmp;
  });
  _smFiltered = list;
  _smPage = 1;  // reset to first page on filter/sort change
}

function _smRenderSortIndicators() {
  ['tcid', 'title', 'component'].forEach(col => {
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
  const page = _smFiltered.slice(start, start + _smPageSize);

  // Count label
  const countEl = document.getElementById('sm-script-count');
  if (countEl) countEl.textContent = `${_smFiltered.length} script${_smFiltered.length !== 1 ? 's' : ''}`;

  // Pagination controls
  const prevBtn = document.getElementById('sm-prev-btn');
  const nextBtn = document.getElementById('sm-next-btn');
  const pageLabel = document.getElementById('sm-page-label');
  if (prevBtn) prevBtn.disabled = _smPage <= 1;
  if (nextBtn) nextBtn.disabled = _smPage >= totalPages;
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
    const already = selectedSet.has(s.id);
    const checked = _smCheckedIds.has(s.id);
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
    allChk.checked = available.length > 0 && checkedCount === available.length;
    allChk.indeterminate = checkedCount > 0 && checkedCount < available.length;
  }
  _smUpdateBulkBar();
}

let _smbCheckedIds = new Set(); // checkboxes ticked in Zone B (for bulk-remove)

function _smbUpdateBulkBar() {
  const bars = document.querySelectorAll('.smb-bulk-bar');
  const countEls = document.querySelectorAll('.smb-bulk-count');
  const n = _smbCheckedIds.size;
  bars.forEach(bar => {
    bar.style.display = n > 0 ? 'flex' : 'none';
  });
  countEls.forEach(el => {
    el.textContent = n > 0 ? `${n} selected` : '';
  });
}

function smbRowCheckChange(chk) {
  const id = chk.dataset.id;
  if (chk.checked) _smbCheckedIds.add(id);
  else _smbCheckedIds.delete(id);
  // Sync select-all checkbox
  const allChk = document.getElementById('smb-chk-all');
  if (allChk) {
    const displayList = _smGetZoneBDisplayList();
    const n = displayList.length;
    const checkedCount = displayList.filter(item => _smbCheckedIds.has(item.id)).length;
    allChk.checked = n > 0 && checkedCount === n;
    allChk.indeterminate = checkedCount > 0 && checkedCount < n;
  }
  _smbUpdateBulkBar();
}

function smbToggleSelectAll() {
  const allChk = document.getElementById('smb-chk-all');
  const displayList = _smGetZoneBDisplayList();
  if (allChk?.checked) {
    displayList.forEach(item => _smbCheckedIds.add(item.id));
  } else {
    displayList.forEach(item => _smbCheckedIds.delete(item.id));
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

function _smGetZoneBDisplayList() {
  const searchInput = document.getElementById('smb-search')?.value.toLowerCase() || '';
  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  return _smSelectedIds.map((id, idx) => ({ id, idx, s: scriptMap[id] })).filter(item => {
    if (!item.s) return false;
    if (!searchInput) return true;
    return item.s.title.toLowerCase().includes(searchInput) || 
           (item.s.tcid || '').toLowerCase().includes(searchInput) ||
           (item.s.tags || '').toLowerCase().includes(searchInput) ||
           (item.s.component || '').toLowerCase().includes(searchInput);
  });
}

function _smRenderZoneB() {
  const el = document.getElementById('sm-selected-list');
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

  const displayList = _smGetZoneBDisplayList();
  const n = displayList.length;
  const checkedCount = displayList.filter(item => _smbCheckedIds.has(item.id)).length;

  if (n === 0) {
    el.innerHTML = `<div style="padding:12px 10px;color:var(--neutral-400);font-size:12px;text-align:center">No selected scripts match your filter.</div>`;
    _smbUpdateBulkBar();
    return;
  }

  el.innerHTML =
    // Select-all header row
    `<div id="sm-selected-empty" style="display:none"></div>
     <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--neutral-50);border-bottom:1px solid var(--neutral-200);border-radius:4px 4px 0 0">
       <input type="checkbox" id="smb-chk-all" title="Select / deselect all"
              ${checkedCount === n && n > 0 ? 'checked' : ''}
              onchange="smbToggleSelectAll()" />
       <span style="font-size:11.5px;color:var(--neutral-500);flex:1">Select all</span>
     </div>` +
    displayList.map(({ id, idx, s }) => {
      const isFirst = idx === 0;
      const isLast = idx === _smSelectedIds.length - 1;
      const isChecked = _smbCheckedIds.has(id);
      return `<div draggable="true" ondragstart="smDragStart(event, ${idx})" ondragover="smDragOver(event)" ondragleave="smDragLeave(event)" ondrop="smDrop(event, ${idx})" ondragend="smDragEnd(event)" style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--neutral-100);${isChecked ? 'background:var(--red-50,#fff1f2);' : ''}">
        <span style="cursor:grab;color:var(--neutral-400);user-select:none;font-size:14px;line-height:1;margin-right:2px" title="Drag to reorder">⋮⋮</span>
        <input type="checkbox" class="smb-row-chk" data-id="${escHtml(id)}"
               ${isChecked ? 'checked' : ''} onchange="smbRowCheckChange(this)" />
        <span style="font-size:12px;color:var(--neutral-400);min-width:22px;text-align:right">${idx + 1}</span>
        <span style="font-size:12px;color:var(--neutral-500);min-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(_smTcId(s))}</span>
        <span style="flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.title)}">${escHtml(s.title)}</span>
        <button class="tbl-btn" title="Move up"   ${isFirst ? 'disabled' : ''} onclick="smMoveScript(${idx},-1)">↑</button>
        <button class="tbl-btn" title="Move down" ${isLast ? 'disabled' : ''} onclick="smMoveScript(${idx}, 1)">↓</button>
        <button class="tbl-btn del" title="Remove" onclick="smRemoveScript('${escHtml(id)}')">×</button>
      </div>`;
    }).join('');

  // Set indeterminate state if partially selected
  const allChk = document.getElementById('smb-chk-all');
  if (allChk) {
    allChk.checked = checkedCount === n && n > 0;
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
  else _smCheckedIds.delete(id);
  _smUpdateBulkBar();
  // sync select-all checkbox
  const selectedSet = new Set(_smSelectedIds);
  const start = (_smPage - 1) * _smPageSize;
  const page = _smFiltered.slice(start, start + _smPageSize);
  const available = page.filter(s => !selectedSet.has(s.id));
  const checkedCount = available.filter(s => _smCheckedIds.has(s.id)).length;
  const allChk = document.getElementById('sm-chk-all');
  if (allChk) {
    allChk.checked = available.length > 0 && checkedCount === available.length;
    allChk.indeterminate = checkedCount > 0 && checkedCount < available.length;
  }
}

function smToggleSelectAll() {
  const allChk = document.getElementById('sm-chk-all');
  const selectedSet = new Set(_smSelectedIds);
  const start = (_smPage - 1) * _smPageSize;
  const page = _smFiltered.slice(start, start + _smPageSize);
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
  const bars = document.querySelectorAll('.sm-bulk-bar');
  const countEls = document.querySelectorAll('.sm-bulk-count');
  const n = _smCheckedIds.size;
  bars.forEach(bar => {
    bar.style.display = n > 0 ? 'flex' : 'none';
  });
  countEls.forEach(el => {
    el.textContent = n > 0 ? `${n} script${n !== 1 ? 's' : ''} selected` : '';
  });
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

let _smDragSourceIds = [];

function smDragStart(e, idx) {
  const draggedId = _smSelectedIds[idx];
  if (_smbCheckedIds.has(draggedId)) {
    // Drag all checked items
    _smDragSourceIds = _smSelectedIds.filter(id => _smbCheckedIds.has(id));
  } else {
    // Drag only this item
    _smDragSourceIds = [draggedId];
  }
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.target.style.opacity = '0.4', 0);
}

function smDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.borderTop = '2px solid var(--brand-500)';
}

function smDragLeave(e) {
  e.currentTarget.style.borderTop = '';
}

function smDragEnd(e) {
  e.target.style.opacity = '1';
  _smDragSourceIds = [];
}

function smDrop(e, dropIdx) {
  e.preventDefault();
  e.currentTarget.style.borderTop = '';
  
  if (!_smDragSourceIds.length) return;
  const targetId = _smSelectedIds[dropIdx];
  if (_smDragSourceIds.includes(targetId)) return;
  
  let arr = [..._smSelectedIds];
  arr = arr.filter(id => !_smDragSourceIds.includes(id));
  
  const newTargetIdx = arr.indexOf(targetId);
  arr.splice(newTargetIdx, 0, ..._smDragSourceIds);
  
  _smSelectedIds = arr;
  _smDragSourceIds = [];
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
  ['sm-filter-tcid', 'sm-filter-title', 'sm-filter-component', 'sm-filter-tag'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  smScriptSearch();
}

function _smInit(selectedIds) {
  _smSelectedIds = [...selectedIds];
  _smCheckedIds = new Set();
  _smbCheckedIds = new Set();
  _smPage = 1;
  _smPageSize = 10;
  _smSortCol = 'tcid';
  _smSortDir = 'asc';
  ['sm-filter-tcid', 'sm-filter-title', 'sm-filter-component', 'sm-filter-tag'].forEach(id => {
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
    // Hide schedules for new suites (no ID yet)
    const schedWrap = document.getElementById('sm-sched-wrap');
    if (schedWrap) schedWrap.style.display = 'none';
    _hookInit([], [], false, []);
    _overlayInit([]);
    // Reset preset to Custom and populate Intelligence tab defaults
    const presetEl = document.getElementById('flaky-preset');
    if (presetEl) presetEl.value = '';
    flakyApplyPreset();
  }
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

  flakyConfigLoad(id, currentProjectId);
  openModal('modal-suite');
}

// Legacy alias kept so any other callers still work
// ── Suite Modal Tabs ──────────────────────────────────────────────────────────

function suiteTab(paneId, btn) {
  const modal = document.getElementById('modal-suite');
  if (!modal) return;
  modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  modal.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const pane = document.getElementById(`sm-pane-${paneId}`);
  if (pane) pane.classList.add('active');
}

async function suiteSave() {
  modClearAlert('suite-modal-alert');
  const name = document.getElementById('sm-name').value.trim();
  if (!name) { modAlert('suite-modal-alert', 'error', 'Suite name is required'); return; }
  if (!currentProjectId) { modAlert('suite-modal-alert', 'error', 'Select a project first'); return; }
  const scriptIds = [..._smSelectedIds];   // Zone B order is authoritative
  const retries = parseInt(document.getElementById('sm-retries')?.value || '0', 10);

  const body = {
    projectId: currentProjectId, name,
    description: document.getElementById('sm-desc').value.trim(),
    scriptIds,
    retries: [0, 1, 2].includes(retries) ? retries : 0,
    beforeEachSteps: _hookBefore.map((s, i) => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    afterEachSteps: _hookAfter.map((s, i) => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    fastMode: !!(document.getElementById('sm-fast-mode')?.checked),
    fastModeSteps: _hookFastMode.map((s, i) => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    overlayHandlers: _overlayHandlers.map(h => ({ type: h.type, action: h.action, text: h.text || '' })),
    // Unified Save: Include flakiness intelligence
    flakinessOverrides: {
      threshold: parseInt(document.getElementById('flaky-cfg-threshold').value) || 30,
      minRuns: parseInt(document.getElementById('flaky-cfg-minruns').value) || 5,
      quarantineBudget: parseInt(document.getElementById('flaky-cfg-budget').value) || 5,
      autoPromotePassRate: parseInt(document.getElementById('flaky-cfg-passrate').value) || 95
    }
  };
  const method = editingSuiteId ? 'PUT' : 'POST';
  const url = editingSuiteId ? `/api/suites/${editingSuiteId}` : '/api/suites';

  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error saving suite');

    // Unified Save: Sync local schedules if in edit mode
    if (editingSuiteId && typeof smLocalSchedules !== 'undefined' && smLocalSchedules.length > 0) {
      await _syncLocalSchedules(editingSuiteId);
    }

    suiteCloseModal();
    await suiteLoad();
  } catch (err) {
    modAlert('suite-modal-alert', 'error', 'Save failed: ' + err.message);
  }
}

/** Local schedule management for unified save */
let smLocalSchedules = [];
function schedSaveLocal() {
  const label = document.getElementById('sched-label').value.trim();
  const envId = document.getElementById('sched-env').value;
  const cron = document.getElementById('sched-cron').value.trim() || document.getElementById('sched-preset').value;
  if (!label || !envId || !cron) return modAlert('suite-modal-alert', 'error', 'All schedule fields required');
  smLocalSchedules.push({ label, environmentId: envId, cronExpression: cron });
  _renderLocalSchedules();
  schedFormHide();
}

async function _syncLocalSchedules(suiteId) {
  for (const s of smLocalSchedules) {
    await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, suiteId, projectId: currentProjectId, enabled: true })
    });
  }
  smLocalSchedules = [];
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
  '0 9 * * *': 'Daily at 9am',
  '0 0 * * *': 'Nightly at midnight',
  '0 9 * * 1-5': 'Weekdays at 9am',
  '0 */4 * * *': 'Every 4 hours',
  '0 * * * *': 'Every hour',
};

function schedPresetLabel(expr) {
  return CRON_PRESETS[expr] || expr;
}

function schedPresetChange() {
  const preset = document.getElementById('sched-preset')?.value;
  const wrap = document.getElementById('sched-custom-wrap');
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
  const label = document.getElementById('sched-label')?.value.trim();
  const envId = document.getElementById('sched-env')?.value;
  const preset = document.getElementById('sched-preset')?.value;
  const cronVal = preset === 'custom' ? document.getElementById('sched-cron')?.value.trim() : preset;
  const editId = document.getElementById('sched-edit-id')?.value;

  if (!label) { alert('Please enter a label.'); return; }
  if (!envId) { alert('Please select an environment.'); return; }
  if (!cronVal) { alert('Please enter or select a cron expression.'); return; }

  const body = { suiteId: currentSuiteId, environmentId: envId, cronExpression: cronVal, label };

  const res = editId
    ? await fetch(`/api/schedules/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    : await fetch('/api/schedules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to save schedule'); return; }

  schedFormHide();
  await schedLoad();
}

async function schedToggle(id, enabled) {
  await fetch(`/api/schedules/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
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

let _execLastRunId = null;   // last runId launched from Execution tab
let _execPollTimer = null;
let _execPollStopped = false;

async function execLoad() {
  const noProj = document.getElementById('exec-no-project');
  const body = document.getElementById('exec-body');
  const suiteSel = document.getElementById('exec-suite-sel');
  if (!suiteSel) return;

  if (!currentProjectId) {
    if (noProj) noProj.style.display = '';
    if (body) body.style.display = 'none';
    return;
  }
  if (noProj) noProj.style.display = 'none';
  if (body) body.style.display = '';

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

// Cached flag: set once per suite change (O(N) scan with early exit via .some())
// Checkbox onchange reads this flag — O(1), no re-scan on every click.
let _execSuiteHasTestData = false;

// Returns true if execution is allowed, false if blocked.
// Trace toggle — cycles: 'on' → 'retain-on-failure' → 'off'
var _execTraceMode = 'on';

var _TRACE_STATES = {
  'on': {
    next: 'retain-on-failure',
    dot: '#16a34a',
    label: 'Always',
    hint: 'Trace recorded for every test (pass & fail)',
    borderColor: 'var(--neutral-300)',
    color: 'var(--neutral-700)',
  },
  'retain-on-failure': {
    next: 'off',
    dot: '#d97706',
    label: 'Failed Only',
    hint: 'Trace recorded for failed tests only — no retries required',
    borderColor: '#d97706',
    color: '#92400e',
  },
  'off': {
    next: 'on',
    dot: '#94a3b8',
    label: 'Off',
    hint: 'No traces recorded',
    borderColor: '#94a3b8',
    color: '#64748b',
  },
};

function _execTraceWarnCheck() {
  const warn = document.getElementById('exec-trace-retry-warning');
  if (!warn) return;
  warn.style.display = 'none'; // no warnings needed with new 3-state model
}

function _execToggleTrace() {
  const state = _TRACE_STATES[_execTraceMode] || _TRACE_STATES['on'];
  _execTraceMode = state.next;
  const next = _TRACE_STATES[_execTraceMode];
  const dot = document.getElementById('exec-trace-dot');
  const label = document.getElementById('exec-trace-label');
  const hint = document.getElementById('exec-trace-hint');
  const btn = document.getElementById('exec-trace-toggle');
  dot.style.background = next.dot;
  label.textContent = next.label;
  hint.textContent = next.hint;
  btn.style.borderColor = next.borderColor;
  btn.style.color = next.color;
}

function _execCheckBrowserConstraint() {
  const warningEl = document.getElementById('exec-browser-warning');
  const runBtn = document.getElementById('exec-run-btn');
  const hintEl = document.getElementById('exec-run-hint');

  if (!_execSuiteHasTestData) {
    // No testdata steps — no restriction, hide warning
    if (warningEl) warningEl.style.display = 'none';
    _execUpdateRunBtn();
    return true;
  }

  const selectedCount = ['chromium', 'firefox', 'webkit']
    .filter(b => document.getElementById(`exec-browser-${b}`)?.checked).length;

  if (selectedCount > 1) {
    if (warningEl) warningEl.style.display = '';
    if (runBtn) runBtn.disabled = true;
    if (hintEl) hintEl.textContent = '';
    return false;
  }

  // Single browser selected — allowed
  if (warningEl) warningEl.style.display = 'none';
  _execUpdateRunBtn();
  return true;
}

function execOnSuiteChange() {
  const suiteId = document.getElementById('exec-suite-sel')?.value;
  const envSel = document.getElementById('exec-env-sel');
  const scriptsWrap = document.getElementById('exec-scripts-wrap');
  const scriptList = document.getElementById('exec-script-list');
  const countEl = document.getElementById('exec-script-count');
  const runBtn = document.getElementById('exec-run-btn');
  const hintEl = document.getElementById('exec-run-hint');

  if (!suiteId) {
    envSel.innerHTML = '<option value="">— Select Environment —</option>';
    scriptsWrap.style.display = 'none';
    runBtn.disabled = true;
    hintEl.textContent = 'Select a suite and environment to run';
    _execSuiteHasTestData = false;
    const warnEl = document.getElementById('exec-browser-warning');
    if (warnEl) warnEl.style.display = 'none';
    return;
  }

  const suite = allSuites.find(s => s.id === suiteId);
  const project = allProjects.find(p => p.id === currentProjectId);
  const envs = project?.environments || [];

  // Populate environment dropdown
  envSel.innerHTML = '<option value="">— Select Environment —</option>' +
    envs.map(e => `<option value="${escHtml(e.id)}"${e.id === suite?.environmentId ? ' selected' : ''}>${escHtml(e.name)} — ${escHtml(e.url)}</option>`).join('');

  // Show scripts
  const scriptIds = suite?.scriptIds || [];
  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  const scripts = scriptIds.map(id => scriptMap[id]).filter(Boolean);

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

  // Scan ALL steps in suite scripts for testdata valueMode — short-circuits on first match.
  // Result cached in _execSuiteHasTestData; checkbox onchange reads it at O(1).
  _execSuiteHasTestData = scripts.some(s =>
    (s.steps || []).some(step => step.valueMode === 'testdata')
  );

  // Apply browser constraint (may disable Run button and show warning)
  _execCheckBrowserConstraint();
  // Re-evaluate trace retry warning for newly selected suite
  _execTraceWarnCheck();
}

function _execUpdateRunBtn() {
  const suiteId = document.getElementById('exec-suite-sel')?.value;
  const envId = document.getElementById('exec-env-sel')?.value;
  const runBtn = document.getElementById('exec-run-btn');
  const hintEl = document.getElementById('exec-run-hint');
  const ready = !!(suiteId && envId);
  runBtn.disabled = !ready;
  hintEl.textContent = ready ? '' : (!suiteId ? 'Select a suite first' : 'Select an environment to run');
}

async function execRun() {
  const suiteId = document.getElementById('exec-suite-sel')?.value;
  const envId = document.getElementById('exec-env-sel')?.value;
  if (!suiteId || !envId) { alert('Select a suite and environment first.'); return; }

  // Guard: re-validate browser constraint before executing (defence-in-depth)
  if (!_execCheckBrowserConstraint()) return;

  // ── Fast Mode: detect login steps in selected scripts and warn ────────────
  const _fmSuite = allSuites.find(s => s.id === suiteId);
  if (_fmSuite?.fastMode && (_fmSuite.fastModeSteps || []).length > 0) {
    const _fmScriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
    const _LOGIN_LOCATOR_RE = /user|email|login|username|password|pass|pwd|credential/i;
    const _LOGIN_KW = new Set(['FILL', 'TYPE', 'CLICK', 'CLICK BUTTON', 'SUBMIT']);
    const _SUBMIT_KW = new Set(['CLICK', 'CLICK BUTTON', 'SUBMIT']);
    const _warnings = [];
    for (const sid of (_fmSuite.scriptIds || [])) {
      const sc = _fmScriptMap[sid];
      if (!sc) continue;
      const steps = (sc.steps || []).slice().sort((a, b) => a.order - b.order);
      // Detect pattern: FILL on username/password locator OR CLICK on submit-like locator near a fill
      let hasFillCred = false;
      let hasSubmit = false;
      for (const st of steps) {
        const kw = (st.keyword || '').toUpperCase().trim();
        const loc = (st.locator || st.locatorName || st.description || '').toLowerCase();
        if ((kw === 'FILL' || kw === 'TYPE') && _LOGIN_LOCATOR_RE.test(loc)) hasFillCred = true;
        if (_SUBMIT_KW.has(kw) && hasFillCred) hasSubmit = true;
      }
      if (hasFillCred && hasSubmit) {
        const tcId = sc.name || sc.id;
        _warnings.push(`• ${tcId}`);
      }
    }
    if (_warnings.length > 0) {
      const msg = [
        '⚠️ Fast Mode Warning — Login Steps Detected',
        '',
        'The following scripts contain login steps (fill credentials + submit):',
        ..._warnings,
        '',
        'Fast Mode already logs in once via beforeAll and reuses the auth state.',
        'Running login steps inside each test will re-authenticate and may break auth state reuse.',
        '',
        'Recommended: Remove login steps from these scripts when using Fast Mode.',
        '',
        'Click OK to run anyway, or Cancel to review the scripts first.',
      ].join('\n');
      if (!confirm(msg)) return;
    }
  }

  // Stop any previous poll
  _execPollStopped = true;
  clearTimeout(_execPollTimer);

  const runBtn = document.getElementById('exec-run-btn');
  const reportBtn = document.getElementById('exec-report-btn');
  const progressWrap = document.getElementById('exec-progress-wrap');
  const statusEl = document.getElementById('exec-run-status');
  const metaEl = document.getElementById('exec-run-meta');
  const progressBar = document.getElementById('exec-progress-bar');
  const resultsTable = document.getElementById('exec-results-table');
  const resultsBody = document.getElementById('exec-results-body');
  const summaryEl = document.getElementById('exec-summary');

  runBtn.disabled = true;
  runBtn.innerHTML = '⏳ Starting…';
  reportBtn.style.display = 'none';
  progressWrap.style.display = '';
  resultsTable.style.display = 'none';
  resultsBody.innerHTML = '';
  summaryEl.style.display = 'none';
  if (statusEl) statusEl.textContent = '⏳ Starting…';
  if (metaEl) metaEl.textContent = '';
  if (progressBar) progressBar.style.width = '0%';

  const execBrowsers = ['chromium', 'firefox', 'webkit']
    .filter(b => document.getElementById(`exec-browser-${b}`)?.checked);
  const res = await fetch(`/api/suites/${suiteId}/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ environmentId: envId, browsers: execBrowsers.length ? execBrowsers : ['chromium'], traceMode: _execTraceMode }),
  });
  const data = await res.json();
  if (!res.ok) {
    runBtn.disabled = false;
    runBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-2px"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Suite';
    if (statusEl) statusEl.textContent = '✗ Failed to start';
    return;
  }

  const { runId } = data;
  _execLastRunId = runId;
  _execPollStopped = false;

  // Render known tests as pending immediately
  const suite = allSuites.find(s => s.id === suiteId);
  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  const scripts = (suite?.scriptIds || []).map(id => scriptMap[id]).filter(Boolean);

  function _execRenderResultsTable(tests) {
    if (!tests?.length && !scripts.length) return;
    resultsTable.style.display = '';
const _execChromeIcon = '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364z" fill="#4285F4"/><path d="M12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z" fill="#DC4E41"/><circle cx="12" cy="12" r="4.364" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#4285F4"/></svg>';
     const _execFirefoxIcon = '<svg width="16" height="16" viewBox="0 0 512 512" style="vertical-align:-2px"><defs><radialGradient id="e1g" cx="210%" cy="-100%" r="290%"><stop offset=".1" stop-color="#ffe226"/><stop offset=".79" stop-color="#ff7139"/></radialGradient><radialGradient id="e1c" cx="49%" cy="40%" r="128%" gradientTransform="matrix(.82 0 0 1 .088 0)"><stop offset=".3" stop-color="#960e18"/><stop offset=".35" stop-color="#b11927" stop-opacity=".74"/><stop offset=".43" stop-color="#db293d" stop-opacity=".34"/><stop offset=".5" stop-color="#f5334b" stop-opacity=".09"/><stop offset=".53" stop-color="#ff3750" stop-opacity="0"/></radialGradient><radialGradient id="e1d" cx="48%" cy="-12%" r="140%"><stop offset=".13" stop-color="#fff44f"/><stop offset=".53" stop-color="#ff980e"/></radialGradient><radialGradient id="e1e" cx="22.76%" cy="110.11%" r="100%"><stop offset=".35" stop-color="#3a8ee6"/><stop offset=".67" stop-color="#9059ff"/><stop offset="1" stop-color="#c139e6"/></radialGradient><radialGradient id="e1f" cx="52%" cy="33%" r="59%" gradientTransform="scale(.9 1)"><stop offset=".21" stop-color="#9059ff" stop-opacity="0"/><stop offset=".97" stop-color="#6e008b" stop-opacity=".6"/></radialGradient><radialGradient id="e1b" cx="87.4%" cy="-12.9%" r="128%" gradientTransform="matrix(.8 0 0 1 .178 .129)"><stop offset=".13" stop-color="#ffbd4f"/><stop offset=".28" stop-color="#ff980e"/><stop offset=".47" stop-color="#ff3750"/><stop offset=".78" stop-color="#eb0878"/><stop offset=".86" stop-color="#e50080"/></radialGradient><radialGradient id="e1h" cx="84%" cy="-41%" r="180%"><stop offset=".11" stop-color="#fff44f"/><stop offset=".46" stop-color="#ff980e"/><stop offset=".72" stop-color="#ff3647"/><stop offset=".9" stop-color="#e31587"/></radialGradient><radialGradient id="e1i" cx="16.1%" cy="-18.6%" r="348.8%" gradientTransform="scale(1 .47) rotate(84 .279 -.297)"><stop offset="0" stop-color="#fff44f"/><stop offset=".3" stop-color="#ff980e"/><stop offset=".57" stop-color="#ff3647"/><stop offset=".74" stop-color="#e31587"/></radialGradient><radialGradient id="e1j" cx="18.9%" cy="-42.5%" r="238.4%"><stop offset=".14" stop-color="#fff44f"/><stop offset=".48" stop-color="#ff980e"/><stop offset=".66" stop-color="#ff3647"/><stop offset=".9" stop-color="#e31587"/></radialGradient><radialGradient id="e1k" cx="159.3%" cy="-44.72%" r="313.1%"><stop offset=".09" stop-color="#fff44f"/><stop offset=".63" stop-color="#ff980e"/></radialGradient><linearGradient id="e1a" x1="87.25%" y1="15.5%" x2="9.4%" y2="93.1%"><stop offset=".05" stop-color="#fff44f"/><stop offset=".37" stop-color="#ff980e"/><stop offset=".53" stop-color="#ff3647"/><stop offset=".7" stop-color="#e31587"/></linearGradient><linearGradient id="e1l" x1="80%" y1="14%" x2="18%" y2="84%"><stop offset=".17" stop-color="#fff44f" stop-opacity=".8"/><stop offset=".6" stop-color="#fff44f" stop-opacity="0"/></linearGradient></defs><path d="M478.711 166.353c-10.445-25.124-31.6-52.248-48.212-60.821 13.52 26.505 21.345 53.093 24.335 72.936 0 .039.015.136.047.4C427.706 111.135 381.627 83.823 344 24.355c-1.9-3.007-3.805-6.022-5.661-9.2a73.716 73.716 0 01-2.646-4.972A43.7 43.7 0 01332.1.677a.626.626 0 00-.546-.644.818.818 0 00-.451 0c-.034.012-.084.051-.12.065-.053.021-.12.069-.176.1.027-.036.083-.117.1-.136-60.37 35.356-80.85 100.761-82.732 133.484a120.249 120.249 0 00-66.142 25.488 71.355 71.355 0 00-6.225-4.7 111.338 111.338 0 01-.674-58.732c-24.688 11.241-43.89 29.01-57.85 44.7h-.111c-9.527-12.067-8.855-51.873-8.312-60.184-.114-.515-7.107 3.63-8.023 4.255a175.073 175.073 0 00-23.486 20.12 210.478 210.478 0 00-22.442 26.913c0 .012-.007.026-.011.038 0-.013.007-.026.011-.038a202.838 202.838 0 00-32.247 72.805c-.115.521-.212 1.061-.324 1.586-.452 2.116-2.08 12.7-2.365 15-.022.177-.032.347-.053.524a229.066 229.066 0 00-3.9 33.157c0 .41-.025.816-.025 1.227C16 388.418 123.6 496 256.324 496c118.865 0 217.56-86.288 236.882-199.63.407-3.076.733-6.168 1.092-9.271 4.777-41.21-.53-84.525-15.587-120.746z" fill="url(#e1a)"/><path d="M478.711 166.353c-10.445-25.124-31.6-52.248-48.212-60.821 13.52 26.505 21.345 53.093 24.335 72.936 0-.058.011.048.036.226.012.085.027.174.04.259 22.675 61.47 10.322 123.978-7.479 162.175-27.539 59.1-94.215 119.67-198.576 116.716C136.1 454.651 36.766 370.988 18.223 261.41c-3.379-17.28 0-26.054 1.7-40.084-2.071 10.816-2.86 13.94-3.9 33.157 0 .41-.025.816-.025 1.227C16 388.418 123.6 496 256.324 496c118.865 0 217.56-86.288 236.882-199.63.407-3.076.733-6.168 1.092-9.271 4.777-41.21-.53-84.525-15.587-120.746z" fill="url(#e1b)"/><path d="M361.922 194.6c.524.368 1 .734 1.493 1.1a130.706 130.706 0 00-22.31-29.112C266.4 91.892 321.516 4.626 330.811.194c.027-.036.083-.117.1-.136-60.37 35.356-80.85 100.761-82.732 133.484 2.8-.194 5.592-.429 8.442-.429 45.051 0 84.289 24.77 105.301 61.487z" fill="url(#e1d)"/><path d="M256.772 209.514c-.393 5.978-21.514 26.593-28.9 26.593-68.339 0-79.432 41.335-79.432 41.335 3.027 34.81 27.261 63.475 56.611 78.643 1.339.692 2.694 1.317 4.05 1.935a132.768 132.768 0 007.059 2.886 106.743 106.743 0 0031.271 6.031c119.78 5.618 142.986-143.194 56.545-186.408 22.137-3.85 45.115 5.053 57.947 14.067-21.012-36.714-60.25-61.484-105.3-61.484-2.85 0-5.641.235-8.442.429a120.249 120.249 0 00-66.142 25.488c3.664 3.1 7.8 7.244 16.514 15.828 16.302 16.067 58.13 32.705 58.219 34.657z" fill="url(#e1e)"/><path d="M170.829 151.036a244.042 244.042 0 014.981 3.3 111.338 111.338 0 01-.674-58.732c-24.688 11.241-43.89 29.01-57.85 44.7 1.155-.033 36.014-.66 53.543 10.732z" fill="url(#e1g)"/></svg>';
     const _execSafariIcon = '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm-.004.953h.006c.063 0 .113.05.113.113v1.842c0 .063-.05.113-.113.113h-.006a.112.112 0 0 1-.113-.113V1.066c0-.063.05-.113.113-.113z" fill="#006CFF"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" fill="#5AC8FA" opacity=".3"/><path d="M12 3.4l-1.76 6.84L12 12l1.76-1.76z" fill="#FF3B30"/><path d="M12 20.6l1.76-6.84L12 12l-1.76 1.76z" fill="#fff"/><circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-width=".6" opacity=".5"/><circle cx="12" cy="12" r="1.8" fill="#fff"/><circle cx="12" cy="12" r="1" fill="#007AFF"/></svg>';
    function _execBrBadge(b) {
      if (b === 'firefox') return `<span title="Firefox" style="display:inline-flex;align-items:center">${_execFirefoxIcon}</span>`;
      if (b === 'webkit') return `<span title="Safari" style="display:inline-flex;align-items:center">${_execSafariIcon}</span>`;
      return `<span title="Chrome" style="display:inline-flex;align-items:center">${_execChromeIcon}</span>`;
    }
    const rows = tests?.length
      ? tests.map(t => {
        const colour = t.status === 'pass' ? '#4ec9b0' : '#f48771';
        const icon = t.status === 'pass' ? '✓' : '✗';
        const dur = t.durationMs != null ? `${(t.durationMs / 1000).toFixed(1)}s` : '';
        return `<div style="display:grid;grid-template-columns:1fr 100px 90px 80px;border-bottom:1px solid var(--neutral-100)">
            <div style="padding:7px 10px;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(t.name)}">${escHtml(t.name)}</div>
            <div style="padding:7px 10px;display:flex;align-items:center">${_execBrBadge(t.browser || 'chromium')}</div>
            <div style="padding:7px 10px;font-size:12px;font-weight:700;color:${colour}">${icon} ${t.status}</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">${dur}</div>
          </div>`;
      }).join('')
      : scripts.map(s => `
          <div style="display:grid;grid-template-columns:1fr 100px 90px 80px;border-bottom:1px solid var(--neutral-100);opacity:.5">
            <div style="padding:7px 10px;font-size:12.5px">${escHtml(s.title)}</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">—</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">pending</div>
            <div style="padding:7px 10px;font-size:12px;color:var(--neutral-400)">—</div>
          </div>`).join('');
    resultsBody.innerHTML = rows;
  }

  _execRenderResultsTable(null);

  async function execPoll() {
    if (_execPollStopped) return;
    try {
      const r = await fetch(`/api/run/${runId}`);
      if (!r.ok) { _execPollTimer = setTimeout(execPoll, 1500); return; }
      const rec = await r.json();

      const total = rec.total || scripts.length || 1;
      const done = (rec.passed || 0) + (rec.failed || 0);
      const pct = Math.min(100, Math.round((done / total) * 100));
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
          }).catch(() => { });
        // P5-E: poll for prescan health results (written by spec beforeAll)
        fetch(`/api/prescan?runId=${encodeURIComponent(runId)}`)
          .then(r => r.ok ? r.json() : null)
          .then(data => { if (data?.locators?.length) renderPrescanHealth(data); })
          .catch(() => { });
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
  const wrap = document.getElementById('exec-prescan-wrap');
  const grid = document.getElementById('exec-prescan-grid');
  const pageEl = document.getElementById('exec-prescan-page');
  const sumEl = document.getElementById('exec-prescan-summary');
  if (!wrap || !grid) return;

  const locators = data.locators || [];
  const healthy = locators.filter(l => l.status === 'healthy').length;
  const degraded = locators.filter(l => l.status === 'degraded').length;
  const broken = locators.filter(l => l.status === 'broken').length;

  if (pageEl) pageEl.textContent = data.pageKey || '';
  if (sumEl) sumEl.innerHTML =
    `<span class="ps-chip ps-healthy">${healthy} healthy</span>` +
    (degraded ? `<span class="ps-chip ps-degraded">${degraded} degraded</span>` : '') +
    (broken ? `<span class="ps-chip ps-broken">${broken} broken</span>` : '');

  grid.innerHTML = locators.map(l => {
    const icon = l.status === 'healthy' ? '🟢' : l.status === 'degraded' ? '🟡' : '🔴';
    const score = l.score != null ? `${Math.round(l.score)}%` : '—';
    const barW = Math.max(0, Math.min(100, Math.round(l.score || 0)));
    const barC = l.status === 'healthy' ? '#4ec9b0' : l.status === 'degraded' ? '#eab308' : '#f48771';
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
  const proj = allProjects.find(p => p.id === currentProjectId);
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
          const icon = l.status === 'healthy' ? '🟢' : l.status === 'degraded' ? '🟡' : '🔴';
          const score = l.score != null ? `${Math.round(l.score)}%` : '—';
          const barW = Math.max(0, Math.min(100, Math.round(l.score || 0)));
          const barC = l.status === 'healthy' ? '#4ec9b0' : l.status === 'degraded' ? '#eab308' : '#f48771';
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
  if (el('t4-step-info')) el('t4-step-info').textContent = `Step ${proposal.stepOrder} — ${proposal.keyword}`;
  if (el('t4-tier-badge')) el('t4-tier-badge').textContent = proposal.isAssert ? 'ASSERT (forced T4)' : 'T3 score < 75';
  if (el('t4-old-sel')) el('t4-old-sel').textContent = proposal.oldSelector || '(unknown — locator not found)';
  if (el('t4-cand-sel')) el('t4-cand-sel').textContent = proposal.candidateSelector || '(no candidate found)';
  if (el('t4-cand-type')) el('t4-cand-type').textContent = proposal.candidateSelectorType || '';
  if (el('t4-score')) el('t4-score').textContent = proposal.candidateSelector ? `${Math.round(proposal.score)}%` : '—';

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
  let selector = p.candidateSelector;
  let selectorType = p.candidateSelectorType || 'css';
  if (action === 'approve') {
    const overrideInput = document.getElementById('t4-override-sel');
    const overrideType = document.getElementById('t4-override-type');
    if (overrideInput?.value?.trim()) selector = overrideInput.value.trim();
    if (overrideType?.value?.trim()) selectorType = overrideType.value.trim();
    if (!selector) { alert('No candidate selector available — cannot approve. You can type one in the override field.'); return; }
  }

  try {
    const res = await fetch('/api/debug/heal-respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: p.runId,
        action,
        selector: action === 'approve' ? selector : undefined,
        selectorType: action === 'approve' ? selectorType : undefined,
        locatorId: p.locatorId,
        stepOrder: p.stepOrder,
        keyword: p.keyword,
        oldSelector: p.oldSelector,
        oldSelectorType: p.candidateSelectorType,
        score: p.score,
        projectId: currentProjectId,
      }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Failed to send response'); return; }
    hideT4ProposalCard();
  } catch { alert('Network error sending heal response'); }
}

// showToast is defined in 02-shared-helpers.js — signature: showToast(type, msg, ms)

// Flaky Test Detection
// ══════════════════════════════════════════════════════════════════════════════

let _flakyAllTests = [];
let _flakyFilter = 'all';
let _flakyTop10 = false;
let _flakyPage = 0;
let _flakyPageSize = 25;
let _flakyTotal = 0;

function flakyToggleTop10() {
  _flakyTop10 = !_flakyTop10;
  const btn = document.getElementById('flaky-top10-btn');
  if (btn) btn.classList.toggle('active', _flakyTop10);
  flakyRender();
}

function flakySetFilter(f) {
  _flakyFilter = f;
  document.querySelectorAll('.flaky-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f));
  flakyRender();
}

async function flakyLoad(resetPage = true) {
  if (!currentProjectId) {
    const loadEl = document.getElementById('flaky-loading');
    if (loadEl) { loadEl.style.display = ''; loadEl.textContent = 'Select a project to analyse flaky tests.'; }
    ['flaky-summary-bar', 'flaky-table-wrap', 'flaky-empty', 'flaky-filter-tabs', 'flaky-budget-banner', 'flaky-pagination']
      .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    return;
  }

  // FIX: read suiteId BEFORE repopulating the dropdown to preserve user selection
  const suiteSel = document.getElementById('flaky-suite-filter');
  const prevSuiteId = suiteSel?.value || '';
  if (suiteSel && typeof allSuites !== 'undefined') {
    const proj = allSuites.filter(s => s.projectId === currentProjectId);
    suiteSel.innerHTML = '<option value="">All Suites</option>' +
      proj.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
    if (prevSuiteId) suiteSel.value = prevSuiteId; // restore selection after repopulate
  }

  const suiteId = suiteSel?.value || '';
  const sort = document.getElementById('flaky-sort')?.value || 'flakeScore';
  if (resetPage) _flakyPage = 0;

  const loadEl = document.getElementById('flaky-loading');
  if (loadEl) { loadEl.style.display = ''; loadEl.textContent = 'Analysing runs…'; }
  ['flaky-summary-bar', 'flaky-table-wrap', 'flaky-empty', 'flaky-filter-tabs', 'flaky-budget-banner', 'flaky-pagination']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });

  // Fetch all (up to 200) for client-side filter counts, then paginate client-side
  let url = `/api/flaky?projectId=${encodeURIComponent(currentProjectId)}&limit=200&sort=${encodeURIComponent(sort)}`;
  if (suiteId) url += `&suiteId=${encodeURIComponent(suiteId)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) { if (loadEl) loadEl.textContent = 'Failed to load flaky data.'; return; }
    const data = await res.json();
    _flakyAllTests = data.tests || [];
  } catch (e) {
    if (loadEl) loadEl.textContent = 'Error loading flaky data.';
    return;
  }

  if (loadEl) loadEl.style.display = 'none';

  if (_flakyAllTests.length === 0) {
    const empty = document.getElementById('flaky-empty');
    if (empty) empty.style.display = '';
    return;
  }

  const tabs = document.getElementById('flaky-filter-tabs');
  if (tabs) tabs.style.display = '';
  flakyRender();
}

function flakyRender() {
  let tests = [..._flakyAllTests];
  if (_flakyFilter === 'flagged') tests = tests.filter(t => t.evaluationState === 'evaluated' && t.shouldQuarantine && !t.isQuarantined);
  if (_flakyFilter === 'quarantined') tests = tests.filter(t => t.isQuarantined);
  if (_flakyFilter === 'insufficient') tests = tests.filter(t => t.evaluationState === 'insufficient_data');
  if (_flakyTop10) tests = tests.slice(0, 10);

  const total = _flakyAllTests.length;
  const quarantined = _flakyAllTests.filter(t => t.isQuarantined).length;
  const flagged = _flakyAllTests.filter(t => t.shouldQuarantine && !t.isQuarantined).length;

  const summaryBar = document.getElementById('flaky-summary-bar');
  if (summaryBar) {
    summaryBar.style.display = '';
    summaryBar.innerHTML = `
      <span style="color:var(--flaky-text);font-size:13px">
        ${total} tests &nbsp;·&nbsp;
        <span style="color:var(--flaky-danger)">${quarantined} quarantined</span> &nbsp;·&nbsp;
        <span style="color:var(--flaky-warn)">${flagged} flagged</span>
      </span>`;
  }

  const empty = document.getElementById('flaky-empty');
  const wrap = document.getElementById('flaky-table-wrap');
  if (tests.length === 0) {
    if (empty) empty.style.display = '';
    if (wrap) wrap.style.display = 'none';
    _flakyRenderPagination(0, 0);
    return;
  }
  if (empty) empty.style.display = 'none';
  if (wrap) wrap.style.display = '';

  // Pagination
  const filteredTotal = tests.length;
  const pageSize = _flakyTop10 ? filteredTotal : _flakyPageSize;
  const totalPages = _flakyTop10 ? 1 : Math.ceil(filteredTotal / pageSize);
  if (_flakyPage >= totalPages) _flakyPage = Math.max(0, totalPages - 1);
  const paged = _flakyTop10 ? tests : tests.slice(_flakyPage * pageSize, (_flakyPage + 1) * pageSize);

  const tbody = document.getElementById('flaky-tbody');
  if (tbody) tbody.innerHTML = paged.map(t => flakyRow(t)).join('');

  _flakyRenderPagination(filteredTotal, totalPages);
}

function _flakyRenderPagination(filteredTotal, totalPages) {
  let pg = document.getElementById('flaky-pagination');
  if (!pg) return;
  if (filteredTotal === 0 || _flakyTop10) { pg.style.display = 'none'; return; }

  const pageSize = _flakyPageSize;
  const start = _flakyPage * pageSize + 1;
  const end = Math.min((_flakyPage + 1) * pageSize, filteredTotal);

  pg.style.display = 'flex';
  pg.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-size:12px;color:var(--flaky-text)">
        ${start}–${end} of ${filteredTotal}
      </span>
      <div style="display:flex;align-items:center;gap:6px">
        <label style="font-size:12px;color:var(--flaky-text)">Rows:</label>
        <select class="fm-input" style="height:26px;font-size:12px;padding:0 4px;width:70px"
          onchange="_flakySetPageSize(parseInt(this.value))">
          ${[10,25,50,100].map(n =>
            `<option value="${n}"${n === pageSize ? ' selected' : ''}>${n}</option>`
          ).join('')}
        </select>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn btn-xs btn-outline" onclick="_flakyGoPage(0)" ${_flakyPage === 0 ? 'disabled' : ''} title="First">«</button>
        <button class="btn btn-xs btn-outline" onclick="_flakyGoPage(${_flakyPage - 1})" ${_flakyPage === 0 ? 'disabled' : ''} title="Previous">‹</button>
        <span style="font-size:12px;color:var(--flaky-text);padding:2px 8px;align-self:center">
          Page ${_flakyPage + 1} / ${totalPages}
        </span>
        <button class="btn btn-xs btn-outline" onclick="_flakyGoPage(${_flakyPage + 1})" ${_flakyPage >= totalPages - 1 ? 'disabled' : ''} title="Next">›</button>
        <button class="btn btn-xs btn-outline" onclick="_flakyGoPage(${totalPages - 1})" ${_flakyPage >= totalPages - 1 ? 'disabled' : ''} title="Last">»</button>
      </div>
    </div>`;
}

function _flakyGoPage(p) {
  _flakyPage = p;
  flakyRender();
}

function _flakySetPageSize(n) {
  _flakyPageSize = n;
  _flakyPage = 0;
  flakyRender();
}

function flakyRow(t) {
  const isInsuff = t.evaluationState === 'insufficient_data';
  // OLD: const rowStyle = isInsuff ? 'opacity:0.5' : '';
  // opacity:0.5 on the <tr> made all child colors appear faded — CSS child opacity can't exceed parent.
  // Status label + muted color already signal insufficient state; row opacity is redundant.
  const rowStyle = '';
  const newBadge = t.quarantinedAt && (Date.now() - new Date(t.quarantinedAt).getTime() < 86400000)
    ? '<span class="flaky-badge-new">NEW</span>' : '';
  const autoBadge = t.isQuarantined
    ? `<span class="flaky-badge-q">${t.autoQuarantined ? '⛔ Auto' : '⛔ Manual'}</span>` : '';

  const statusLabel = t.isQuarantined ? 'Quarantined' : isInsuff ? 'Insufficient' : t.shouldQuarantine ? 'Flagged' : 'Active';
  const statusColor = t.isQuarantined ? 'var(--flaky-danger)' : isInsuff ? 'var(--flaky-muted)' : t.shouldQuarantine ? 'var(--flaky-warn)' : 'var(--flaky-pass)';

  let scoreCell = '—';
  if (!isInsuff && t.flakeScore !== undefined) {
    const sc = t.flakeScore;
    const thr = 0.30;
    const near = Math.abs(sc - thr) < 0.05;
    const color = sc >= thr ? 'var(--flaky-danger)' : near ? 'var(--flaky-warn)' : 'var(--flaky-pass)';
    const arrow = sc >= thr ? ' ↑' : '';
    const tooltip = sc >= thr ? `Above threshold (${thr})` : near ? `Near threshold (${thr})` : `Below threshold (${thr})`;
    scoreCell = `<span style="color:${color};font-weight:700" title="${tooltip}">${sc.toFixed(2)}${arrow}</span>`;
  }

  const confLabel = !isInsuff && t.confidence !== undefined
    ? (t.confidence >= 0.7 ? 'High' : t.confidence >= 0.4 ? 'Med' : 'Low') : '—';

  const sparkline = (t.recentRunsPreview || []).map(r =>
    `<span style="color:${r.status === 'pass' ? 'var(--flaky-pass)' : 'var(--flaky-danger)'};font-size:10px;font-weight:700">${r.status === 'pass' ? 'P' : 'F'}</span>`
  ).join('');

  const cat = t.classification?.primary ?? '—';
  const catColor = { network: 'var(--flaky-network)', timing: 'var(--flaky-warn)', locator: 'var(--flaky-locator)', assertion: 'var(--flaky-danger)', environment: 'var(--flaky-env)', unknown: 'var(--flaky-muted)' }[cat] || 'var(--flaky-muted)';
  const catCell = cat !== '—' ? `<span style="color:${catColor};font-size:11px">${cat}</span>` : '—';

  const lastRun = t.lastRunAt ? _flakyFmtDate(t.lastRunAt) : '—';
  const lastFail = t.lastFailureAt ? _flakyFmtDate(t.lastFailureAt) : '—';

  let actionBtns = '';
  if (t.isQuarantined) {
    actionBtns = `<button class="btn btn-xs btn-outline" onclick="flakyRestore('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')" title="Restore from quarantine">Restore</button>`;
  } else if (!isInsuff) {
    actionBtns = `<button class="btn btn-xs btn-outline" onclick="flakyQuarantine('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')" title="Manually quarantine">Quarantine</button>`;
  } else {
    // Insufficient data — allow manual quarantine override, clearly labelled
    actionBtns = `<button class="btn btn-xs btn-outline" style="opacity:0.75" onclick="flakyQuarantineInsuff('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')" title="Force quarantine — overrides insufficient data state">Force Quarantine</button>`;
  }

  const expandId = `flaky-expand-${escHtml(t.testId)}`;

  return `
    <tr style="${rowStyle};cursor:pointer" onclick="flakyToggleExpand('${escHtml(t.testId)}')">
      <td style="font-weight:600;max-width:280px;word-break:break-word">
        ${escHtml(t.testName)} ${newBadge} ${autoBadge}
      </td>
      <td style="color:${statusColor};font-size:12px;font-weight:600">${statusLabel}</td>
      <td style="text-align:center">${scoreCell}</td>
      <td style="text-align:center;font-size:12px;color:var(--neutral-400)">${confLabel}</td>
      <td style="letter-spacing:2px">${sparkline}</td>
      <td style="text-align:center">${catCell}</td>
      <td style="font-size:12px;color:var(--neutral-400)">${lastRun}</td>
      <td style="font-size:12px;color:var(--neutral-400)">${lastFail}</td>
      <td onclick="event.stopPropagation()">${actionBtns}</td>
    </tr>
    <tr id="${expandId}" style="display:none">
      <td colspan="9" style="background:var(--bg-2);padding:16px">
        ${flakyExpandedRow(t)}
      </td>
    </tr>`;
}

function flakyExpandedRow(t) {
  if (t.evaluationState === 'insufficient_data') {
    return `<div style="color:var(--flaky-muted);font-size:13px">Insufficient data — need ≥5 runs to compute flake score.</div>`;
  }

  const thr = 0.30;
  const eligible = t.shouldQuarantine ? '✔ Eligible for auto-quarantine' : `Below threshold (${thr})`;

  const history = (t.recentRunsPreview || []).map(r =>
    `<span style="color:${r.status === 'pass' ? 'var(--flaky-pass)' : 'var(--flaky-danger)'};font-weight:700">${r.status === 'pass' ? 'P' : 'F'}</span>`
  ).join(' ');

  const sig = t.signals || {};
  const sigLines = [];
  if (sig.timeout) sigLines.push('· Timeout detected');
  if (sig.slowTest) sigLines.push(`· Avg failure duration: ${((sig.durationMs || 0) / 1000).toFixed(1)}s (baseline p95: ${((sig.baselineP95 || 0) / 1000).toFixed(1)}s)`);
  if (sig.networkError) sigLines.push('· Network error detected (ECONNRESET / fetch failed)');
  if (sig.locatorError) sigLines.push('· Locator instability detected');
  if (sig.assertionError) sigLines.push('· Assertion failure pattern');
  if (sig.recentFailSpike) sigLines.push('· ⚠ Consistent recent failures (all recent runs failed)');
  if (sig.rawErrors?.length) sigLines.push(`· Last error: <code style="font-size:11px">${escHtml(sig.rawErrors[sig.rawErrors.length - 1].slice(0, 120))}</code>`);

  const dominant = t.dominantCategory
    ? `Dominant cause: <strong>${t.dominantCategory}</strong> (${t.dominantCategoryCount}/${t.dominantCategoryTotal} recent failures)`
    : '';

  let qBlock = '';
  if (t.isQuarantined) {
    const qDate = t.quarantinedAt ? _flakyFmtDate(t.quarantinedAt) : '—';
    const promoteElig = t.shouldAutoPromote ? '✔ Eligible for auto-promote' : 'Not yet eligible for auto-promote';
    qBlock = `
      <div style="margin-top:12px;padding:10px;border:1px solid #f4877155;border-radius:6px">
        <div style="font-size:12px;font-weight:600;color:#f48771;margin-bottom:6px">⛔ Quarantine Status: Active</div>
        <div style="font-size:12px;color:var(--neutral-400)">Quarantined: ${qDate} (${t.autoQuarantined ? 'auto' : 'manual'})</div>
        <div style="font-size:12px;color:var(--neutral-400)">Reason: ${escHtml(t.quarantineReason || '—')}</div>
        <div style="font-size:12px;color:var(--neutral-400)">${promoteElig}</div>
        <button class="btn btn-sm btn-outline" style="margin-top:8px" onclick="flakyRestore('${escHtml(t.suiteId)}','${escHtml(t.testId)}','${escHtml(t.testName)}')">Restore Manually</button>
      </div>`;
  }

  return `
    <div style="display:grid;gap:12px">
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--neutral-500);margin-bottom:4px">Decision</div>
        <div style="font-size:13px">Flake Score: <strong>${(t.flakeScore || 0).toFixed(2)}</strong> &nbsp; Threshold: ${thr} &nbsp; ${eligible}</div>
        <div style="font-size:12px;color:var(--neutral-400)">Confidence: ${t.confidence >= 0.7 ? 'High' : t.confidence >= 0.4 ? 'Med' : 'Low'} &nbsp;·&nbsp; Last run: ${t.lastRunAt ? _flakyFmtDate(t.lastRunAt) : '—'} &nbsp;·&nbsp; Last failure: ${t.lastFailureAt ? _flakyFmtDate(t.lastFailureAt) : '—'}</div>
      </div>
      ${sigLines.length ? `<div><div style="font-size:11px;text-transform:uppercase;color:var(--neutral-500);margin-bottom:4px">Signals</div><div style="font-size:12px;color:var(--neutral-300);line-height:1.8">${sigLines.join('<br>')}</div></div>` : ''}
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--neutral-500);margin-bottom:4px">History (last 10)</div>
        <div style="letter-spacing:4px;font-size:13px">${history || '—'}</div>
      </div>
      <div>
        <div style="font-size:11px;text-transform:uppercase;color:var(--neutral-500);margin-bottom:4px">Classification</div>
        <div style="font-size:13px">Primary: <strong>${t.classification?.primary || '—'}</strong> (${((t.classification?.primaryConfidence || 0) * 100).toFixed(0)}%)
          ${t.classification?.secondary ? `&nbsp;·&nbsp; Secondary: ${t.classification.secondary}` : ''}
        </div>
        ${dominant ? `<div style="font-size:12px;color:var(--neutral-400)">${dominant}</div>` : ''}
        ${t.actionHint ? `<div style="font-size:12px;color:#dcdcaa;margin-top:4px">💡 ${escHtml(t.actionHint)}</div>` : ''}
      </div>
      ${qBlock}
    </div>`;
}

function flakyToggleExpand(testId) {
  const el = document.getElementById(`flaky-expand-${testId}`);
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function _flakyFmtDate(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    return d.toLocaleDateString();
  } catch { return '—'; }
}

async function flakyQuarantine(suiteId, testId, testName) {
  if (!confirm('This will exclude the test from suite pass/fail. Continue?')) return;
  const res = await fetch('/api/flaky/quarantine', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suiteId, testId, testName, reason: 'manual' })
  });
  if (res.ok) { showToast('info', 'Test quarantined.'); flakyLoad(); }
  else showToast('error', 'Quarantine failed.');
}

async function flakyQuarantineInsuff(suiteId, testId, testName) {
  if (!confirm(`Force quarantine "${testName}"?\n\nThis test has insufficient run history to score automatically. Quarantining manually will exclude it from suite pass/fail immediately.\n\nContinue?`)) return;
  const res = await fetch('/api/flaky/quarantine', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suiteId, testId, testName, reason: 'manual-insufficient' })
  });
  if (res.ok) { showToast('info', 'Test force-quarantined.'); flakyLoad(); }
  else showToast('error', 'Quarantine failed.');
}

async function flakyRestore(suiteId, testId, testName) {
  if (!confirm(`Restore "${testName}" from quarantine? It will affect pipeline results again.`)) return;
  const res = await fetch('/api/flaky/restore', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suiteId, testId })
  });
  if (res.ok) { showToast('info', 'Test restored from quarantine.'); flakyLoad(); }
  else showToast('error', 'Restore failed.');
}

// Flakiness Config (Suite Settings)
// ══════════════════════════════════════════════════════════════════════════════

const FLAKY_PRESETS = { smoke: 20, regression: 30, e2e: 40 };

async function flakyConfigLoad(suiteId, projectId) {
  if (!suiteId || !projectId) return;
  try {
    const res = await fetch(`/api/flaky/config?projectId=${encodeURIComponent(projectId)}&suiteId=${encodeURIComponent(suiteId)}`);
    if (!res.ok) return;
    const { effective, projectDefaults } = await res.json();
    const g = id => document.getElementById(id);
    if (g('flaky-cfg-threshold')) g('flaky-cfg-threshold').value = Math.round((effective.threshold || 0.30) * 100);
    if (g('flaky-cfg-minruns')) g('flaky-cfg-minruns').value = effective.minRuns || 5;
    if (g('flaky-cfg-budget')) g('flaky-cfg-budget').value = effective.quarantineBudget ?? 5;
    if (g('flaky-cfg-passrate')) g('flaky-cfg-passrate').value = Math.round((effective.autoPromoteMinPassRate || 0.95) * 100);
    const projThr = g('flaky-cfg-proj-threshold');
    if (projThr) projThr.textContent = `(Project default: ${Math.round((projectDefaults?.threshold || 0.30) * 100)}%)`;
  } catch (e) { console.warn('flakyConfigLoad error', e); }
}

function flakyApplyPreset() {
  const preset = document.getElementById('flaky-preset').value;
  const t = document.getElementById('flaky-cfg-threshold');
  const m = document.getElementById('flaky-cfg-minruns');
  const b = document.getElementById('flaky-cfg-budget');
  const p = document.getElementById('flaky-cfg-passrate');

  if (preset === 'smoke') {
    if (t) t.value = 20; if (m) m.value = 3; if (b) b.value = 2; if (p) p.value = 98;
  } else if (preset === 'regression') {
    if (t) t.value = 30; if (m) m.value = 5; if (b) b.value = 5; if (p) p.value = 95;
  } else if (preset === 'e2e') {
    if (t) t.value = 40; if (m) m.value = 5; if (b) b.value = 5; if (p) p.value = 90;
  } else {
    // Custom — populate with project-standard defaults so fields are never blank
    if (t) t.value = 30; if (m) m.value = 5; if (b) b.value = 5; if (p) p.value = 95;
  }
}

async function flakyConfigSave() {
  const suiteId = window._editingSuiteId || editingSuiteId;
  const projectId = currentProjectId;
  if (!suiteId || !projectId) { showToast('info', 'No suite selected.'); return; }

  const threshold = parseFloat(document.getElementById('flaky-cfg-threshold')?.value || '');
  const minRuns = parseInt(document.getElementById('flaky-cfg-minruns')?.value || '');
  const budget = parseInt(document.getElementById('flaky-cfg-budget')?.value || '');
  const passRate = parseFloat(document.getElementById('flaky-cfg-passrate')?.value || '');

  const overrides = {};
  if (!isNaN(threshold)) overrides.threshold = threshold / 100;
  if (!isNaN(minRuns)) overrides.minRuns = minRuns;
  if (!isNaN(budget)) overrides.quarantineBudget = budget;
  if (!isNaN(passRate)) overrides.autoPromoteMinPassRate = passRate / 100;

  try {
    const res = await fetch('/api/flaky/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, suiteId, overrides })
    });
    if (res.ok) {
      showToast('info', 'Flakiness config saved.');
    } else {
      const e = await res.json();
      showToast('error', 'Save failed: ' + ((e.errors || []).join(', ') || 'unknown error'));
    }
  } catch { showToast('error', 'Save failed.'); }
}

async function flakyConfigReset() {
  const suiteId = window._editingSuiteId || editingSuiteId;
  const projectId = currentProjectId;

  // Scenario 1: New suite — no suiteId yet, just reset fields to Custom defaults
  if (!suiteId) {
    const presetEl = document.getElementById('flaky-preset');
    if (presetEl) presetEl.value = '';
    flakyApplyPreset();
    showToast('info', 'Reset to default values.');
    return;
  }

  if (!projectId) return;
  if (!confirm('Reset suite flakiness config to project defaults?')) return;

  try {
    await fetch('/api/flaky/config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, suiteId, overrides: {} })
    });
    await flakyConfigLoad(suiteId, projectId);
    // Scenario 2: Reset preset dropdown to Custom — project defaults don't map to any named preset
    const presetEl = document.getElementById('flaky-preset');
    if (presetEl) presetEl.value = '';
    showToast('info', 'Reset to project defaults.');
  } catch { showToast('error', 'Reset failed.'); }
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
  switchTab = function (tab) {
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

let _histRuns = [];
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
  const tbody = document.getElementById('hist-tbody');
  const emptyEl = document.getElementById('hist-empty');
  if (!tbody) return;

  if (!currentProjectId) {
    tbody.innerHTML = '';
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = 'Select a project to view execution history.'; }
    return;
  }

  const dateVal = (document.getElementById('hist-filter-date')?.value || '').trim();
  const search = (document.getElementById('hist-filter-search')?.value || '').toLowerCase();
  const statusVal = (document.getElementById('hist-filter-status')?.value || '');
  const envVal = (document.getElementById('hist-filter-env')?.value || '');

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
      (r.runId || '').toLowerCase().includes(search) ||
      (r.suiteName || '').toLowerCase().includes(search) ||
      (r.executedBy || '').toLowerCase().includes(search)
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
    const start = r.startedAt ? _histFmtDate(r.startedAt) : '—';
    const end = r.finishedAt ? _histFmtDate(r.finishedAt) : '—';
    const dur = (r.startedAt && r.finishedAt) ? _histDuration(r.startedAt, r.finishedAt) : '—';
    const shortId = (r.runId || '').slice(0, 8);
    const suite = escHtml(r.suiteName || r.planId || '—');
    const env = escHtml(r.environmentName || '—');
    const by = escHtml(r.executedBy || '—');
    const isDone = r.status === 'done' || r.status === 'failed';
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
const _chromeIcon = '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M12 0C8.21 0 4.831 1.757 2.632 4.501l3.953 6.848A5.454 5.454 0 0 1 12 6.545h10.691A12 12 0 0 0 12 0zM1.931 5.47A11.943 11.943 0 0 0 0 12c0 6.012 4.42 10.991 10.189 11.864l3.953-6.847a5.45 5.45 0 0 1-6.865-2.29zm13.342 2.166a5.446 5.446 0 0 1 1.45 7.09l.002.001h-.002l-5.344 9.257c.206.01.413.016.621.016 6.627 0 12-5.373 12-12 0-1.54-.29-3.011-.818-4.364z" fill="#4285F4"/><path d="M12 16.364a4.364 4.364 0 1 1 0-8.728 4.364 4.364 0 0 1 0 8.728z" fill="#DC4E41"/><circle cx="12" cy="12" r="4.364" fill="#fff"/><circle cx="12" cy="12" r="3" fill="#4285F4"/></svg>';
     const _firefoxIcon = '<svg width="16" height="16" viewBox="0 0 512 512" style="vertical-align:-2px"><defs><radialGradient id="ffg" cx="210%" cy="-100%" r="290%"><stop offset=".1" stop-color="#ffe226"/><stop offset=".79" stop-color="#ff7139"/></radialGradient><radialGradient id="ffc" cx="49%" cy="40%" r="128%" gradientTransform="matrix(.82 0 0 1 .088 0)"><stop offset=".3" stop-color="#960e18"/><stop offset=".35" stop-color="#b11927" stop-opacity=".74"/><stop offset=".43" stop-color="#db293d" stop-opacity=".34"/><stop offset=".5" stop-color="#f5334b" stop-opacity=".09"/><stop offset=".53" stop-color="#ff3750" stop-opacity="0"/></radialGradient><radialGradient id="ffd" cx="48%" cy="-12%" r="140%"><stop offset=".13" stop-color="#fff44f"/><stop offset=".53" stop-color="#ff980e"/></radialGradient><radialGradient id="ffe" cx="22.76%" cy="110.11%" r="100%"><stop offset=".35" stop-color="#3a8ee6"/><stop offset=".67" stop-color="#9059ff"/><stop offset="1" stop-color="#c139e6"/></radialGradient><radialGradient id="fff2" cx="52%" cy="33%" r="59%" gradientTransform="scale(.9 1)"><stop offset=".21" stop-color="#9059ff" stop-opacity="0"/><stop offset=".97" stop-color="#6e008b" stop-opacity=".6"/></radialGradient><radialGradient id="ffb" cx="87.4%" cy="-12.9%" r="128%" gradientTransform="matrix(.8 0 0 1 .178 .129)"><stop offset=".13" stop-color="#ffbd4f"/><stop offset=".28" stop-color="#ff980e"/><stop offset=".47" stop-color="#ff3750"/><stop offset=".78" stop-color="#eb0878"/><stop offset=".86" stop-color="#e50080"/></radialGradient><radialGradient id="ffh" cx="84%" cy="-41%" r="180%"><stop offset=".11" stop-color="#fff44f"/><stop offset=".46" stop-color="#ff980e"/><stop offset=".72" stop-color="#ff3647"/><stop offset=".9" stop-color="#e31587"/></radialGradient><radialGradient id="ffi" cx="16.1%" cy="-18.6%" r="348.8%" gradientTransform="scale(1 .47) rotate(84 .279 -.297)"><stop offset="0" stop-color="#fff44f"/><stop offset=".3" stop-color="#ff980e"/><stop offset=".57" stop-color="#ff3647"/><stop offset=".74" stop-color="#e31587"/></radialGradient><radialGradient id="ffj" cx="18.9%" cy="-42.5%" r="238.4%"><stop offset=".14" stop-color="#fff44f"/><stop offset=".48" stop-color="#ff980e"/><stop offset=".66" stop-color="#ff3647"/><stop offset=".9" stop-color="#e31587"/></radialGradient><radialGradient id="ffk" cx="159.3%" cy="-44.72%" r="313.1%"><stop offset=".09" stop-color="#fff44f"/><stop offset=".63" stop-color="#ff980e"/></radialGradient><linearGradient id="ffa" x1="87.25%" y1="15.5%" x2="9.4%" y2="93.1%"><stop offset=".05" stop-color="#fff44f"/><stop offset=".37" stop-color="#ff980e"/><stop offset=".53" stop-color="#ff3647"/><stop offset=".7" stop-color="#e31587"/></linearGradient><linearGradient id="ffl" x1="80%" y1="14%" x2="18%" y2="84%"><stop offset=".17" stop-color="#fff44f" stop-opacity=".8"/><stop offset=".6" stop-color="#fff44f" stop-opacity="0"/></linearGradient></defs><path d="M478.711 166.353c-10.445-25.124-31.6-52.248-48.212-60.821 13.52 26.505 21.345 53.093 24.335 72.936 0 .039.015.136.047.4C427.706 111.135 381.627 83.823 344 24.355c-1.9-3.007-3.805-6.022-5.661-9.2a73.716 73.716 0 01-2.646-4.972A43.7 43.7 0 01332.1.677a.626.626 0 00-.546-.644.818.818 0 00-.451 0c-.034.012-.084.051-.12.065-.053.021-.12.069-.176.1.027-.036.083-.117.1-.136-60.37 35.356-80.85 100.761-82.732 133.484a120.249 120.249 0 00-66.142 25.488 71.355 71.355 0 00-6.225-4.7 111.338 111.338 0 01-.674-58.732c-24.688 11.241-43.89 29.01-57.85 44.7h-.111c-9.527-12.067-8.855-51.873-8.312-60.184-.114-.515-7.107 3.63-8.023 4.255a175.073 175.073 0 00-23.486 20.12 210.478 210.478 0 00-22.442 26.913c0 .012-.007.026-.011.038 0-.013.007-.026.011-.038a202.838 202.838 0 00-32.247 72.805c-.115.521-.212 1.061-.324 1.586-.452 2.116-2.08 12.7-2.365 15-.022.177-.032.347-.053.524a229.066 229.066 0 00-3.9 33.157c0 .41-.025.816-.025 1.227C16 388.418 123.6 496 256.324 496c118.865 0 217.56-86.288 236.882-199.63.407-3.076.733-6.168 1.092-9.271 4.777-41.21-.53-84.525-15.587-120.746z" fill="url(#ffa)"/><path d="M478.711 166.353c-10.445-25.124-31.6-52.248-48.212-60.821 13.52 26.505 21.345 53.093 24.335 72.936 0-.058.011.048.036.226.012.085.027.174.04.259 22.675 61.47 10.322 123.978-7.479 162.175-27.539 59.1-94.215 119.67-198.576 116.716C136.1 454.651 36.766 370.988 18.223 261.41c-3.379-17.28 0-26.054 1.7-40.084-2.071 10.816-2.86 13.94-3.9 33.157 0 .41-.025.816-.025 1.227C16 388.418 123.6 496 256.324 496c118.865 0 217.56-86.288 236.882-199.63.407-3.076.733-6.168 1.092-9.271 4.777-41.21-.53-84.525-15.587-120.746z" fill="url(#ffb)"/><path d="M361.922 194.6c.524.368 1 .734 1.493 1.1a130.706 130.706 0 00-22.31-29.112C266.4 91.892 321.516 4.626 330.811.194c.027-.036.083-.117.1-.136-60.37 35.356-80.85 100.761-82.732 133.484 2.8-.194 5.592-.429 8.442-.429 45.051 0 84.289 24.77 105.301 61.487z" fill="url(#ffd)"/><path d="M256.772 209.514c-.393 5.978-21.514 26.593-28.9 26.593-68.339 0-79.432 41.335-79.432 41.335 3.027 34.81 27.261 63.475 56.611 78.643 1.339.692 2.694 1.317 4.05 1.935a132.768 132.768 0 007.059 2.886 106.743 106.743 0 0031.271 6.031c119.78 5.618 142.986-143.194 56.545-186.408 22.137-3.85 45.115 5.053 57.947 14.067-21.012-36.714-60.25-61.484-105.3-61.484-2.85 0-5.641.235-8.442.429a120.249 120.249 0 00-66.142 25.488c3.664 3.1 7.8 7.244 16.514 15.828 16.302 16.067 58.13 32.705 58.219 34.657z" fill="url(#ffe)"/><path d="M170.829 151.036a244.042 244.042 0 014.981 3.3 111.338 111.338 0 01-.674-58.732c-24.688 11.241-43.89 29.01-57.85 44.7 1.155-.033 36.014-.66 53.543 10.732z" fill="url(#ffg)"/></svg>';
     const _safariIcon = '<svg width="16" height="16" viewBox="0 0 24 24" style="vertical-align:-2px"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm-.004.953h.006c.063 0 .113.05.113.113v1.842c0 .063-.05.113-.113.113h-.006a.112.112 0 0 1-.113-.113V1.066c0-.063.05-.113.113-.113z" fill="#006CFF"/><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" fill="#5AC8FA" opacity=".3"/><path d="M12 3.4l-1.76 6.84L12 12l1.76-1.76z" fill="#FF3B30"/><path d="M12 20.6l1.76-6.84L12 12l-1.76 1.76z" fill="#fff"/><circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-width=".6" opacity=".5"/><circle cx="12" cy="12" r="1.8" fill="#fff"/><circle cx="12" cy="12" r="1" fill="#007AFF"/></svg>';
    function _brBadge(b) {
      if (b === 'firefox') return `<span title="Firefox" style="display:inline-flex;align-items:center">${_firefoxIcon}</span>`;
      if (b === 'webkit') return `<span title="Safari" style="display:inline-flex;align-items:center">${_safariIcon}</span>`;
      return `<span title="Chrome" style="display:inline-flex;align-items:center">${_chromeIcon}</span>`;
    }
    const browserLabel = browserSet.size > 0
      ? [...browserSet].map(b => _brBadge(b)).join(' ')
      : _brBadge('chromium');
    const compareCb = isDone
      ? `<input type="checkbox" class="hist-compare-chk" value="${escHtml(r.runId)}" onchange="histCompareSelChanged()" style="width:14px;height:14px;cursor:pointer" />`
      : `<span style="width:14px;display:inline-block"></span>`;
    return `<tr>
      <td style="text-align:center">${compareCb}</td>
      <td><code style="font-size:11px">${escHtml(shortId)}</code></td>
      <td>${suite}${healBadge}</td>
      <td>${statusBadge}</td>
      <td style="text-align:center">${r.total || 0}</td>
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
    queued: '<span class="hist-badge hist-badge-queued">&#9203; Queued</span>',
    running: '<span class="hist-badge hist-badge-running">&#9679; In Progress</span>',
    done: '<span class="hist-badge hist-badge-done">&#10003; Completed</span>',
    failed: '<span class="hist-badge hist-badge-failed">&#10007; Failed</span>',
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
  const body = document.getElementById('hist-detail-body');
  const title = document.getElementById('hist-detail-title');
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
        <td style="text-align:center">${_brBadge(t.browser || 'chromium')}</td>
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
          <div class="hist-metric"><div class="hist-metric-val">${r.total || 0}</div><div class="hist-metric-lbl">Total</div></div>
          <div class="hist-metric hist-metric-pass"><div class="hist-metric-val">${r.passed || 0}</div><div class="hist-metric-lbl">Passed</div></div>
          <div class="hist-metric hist-metric-fail"><div class="hist-metric-val">${r.failed || 0}</div><div class="hist-metric-lbl">Failed</div></div>
          <div class="hist-metric"><div class="hist-metric-val">${passRate}%</div><div class="hist-metric-lbl">Pass Rate</div></div>
        </div>

        ${tests.length ? `
        <h3 style="margin:24px 0 12px;font-size:14px;color:#9cdcfe;text-transform:uppercase;letter-spacing:1px">Test Case Results</h3>
        <div style="overflow-x:auto">
          <table class="data-table">
            <thead><tr><th>#</th><th>Test Case</th><th>Browser</th><th>Status</th><th>Duration</th></tr></thead>
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
  const bar = document.getElementById('hist-compare-bar');
  const countEl = document.getElementById('hist-compare-count');
  const btn = document.getElementById('hist-compare-btn');
  if (!bar) return;
  bar.style.display = checked.length > 0 ? 'flex' : 'none';
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
  const body = document.getElementById('run-compare-body');
  if (!overlay || !body) return;

  const fmtDate = s => s ? new Date(s).toLocaleString() : '—';
  const fmtDur = (a, b) => {
    if (!a || !b) return '—';
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };
  const fmtMs = ms => !ms ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

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
    if (t1.status === 'pass' && t2.status === 'fail') newlyFailed.push({ name, t1, t2 });
    else if (t1.status === 'fail' && t2.status === 'pass') newlyPassed.push({ name, t1, t2 });
    else {
      const durDiff = Math.abs((t2.durationMs || 0) - (t1.durationMs || 0));
      const durPct = t1.durationMs > 0 ? (durDiff / t1.durationMs) * 100 : 0;
      if (durPct >= 50 && durDiff > 1000) durationChanged.push({ name, t1, t2, durDiff, durPct });
      else stable.push({ name, t1, t2 });
    }
  }

  // ── Section builder ──────────────────────────────────────────────────────
  const tblStyle = 'width:100%;border-collapse:collapse;font-size:12.5px;min-width:560px';
  const thStyle = 'padding:9px 14px;text-align:left;background:#0f1318;color:#9ca3af;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #2d3748';
  const tdStyle = 'padding:9px 14px;border-bottom:1px solid #1e2a38;vertical-align:top';

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

  const failRows = newlyFailed.map(({ name, t1, t2 }) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip('pass')}</td>
    <td style="${tdStyle};text-align:center">${statusChip('fail')}</td>
    <td style="${tdStyle};color:#f87171;font-size:11px;max-width:240px;word-break:break-word">${escHtml((t2.errorMessage || 'No error captured').slice(0, 140))}</td>
  </tr>`);

  const passRows = newlyPassed.map(({ name, t1, t2 }) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip('fail')}</td>
    <td style="${tdStyle};text-align:center">${statusChip('pass')}</td>
    <td style="${tdStyle};color:#86efac;font-size:11px">Fixed ✓</td>
  </tr>`);

  const durRows = durationChanged.map(({ name, t1, t2, durPct }) => {
    const slower = t2.durationMs > t1.durationMs;
    const arrow = slower ? '▲' : '▼';
    const color = slower ? '#f48771' : '#4ec9b0';
    return `<tr style="background:#1a1f26">
      <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
      <td style="${tdStyle};text-align:center;color:#9ca3af">${fmtMs(t1.durationMs)}</td>
      <td style="${tdStyle};text-align:center;color:#9ca3af">${fmtMs(t2.durationMs)}</td>
      <td style="${tdStyle};text-align:center;font-weight:700;color:${color}">${arrow} ${Math.round(durPct)}%</td>
    </tr>`;
  });

  const stableRows = stable.map(({ name, t1, t2 }) => `<tr style="background:#1a1f26">
    <td style="${tdStyle};color:#6b7280">${escHtml(name)}</td>
    <td style="${tdStyle};text-align:center">${statusChip(t1.status)}</td>
    <td style="${tdStyle};text-align:center">${statusChip(t2.status)}</td>
    <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">${fmtMs(t1.durationMs)} → ${fmtMs(t2.durationMs)}</td>
  </tr>`);

  const passRate = r => r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
  const prColor = r => passRate(r) >= 90 ? '#4ec9b0' : passRate(r) >= 70 ? '#f6c543' : '#f48771';

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
    onlyInA.map(({ name, t }) => `<tr style="background:#1a1f26">
          <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
          <td style="${tdStyle};text-align:center">${statusChip(t.status)}</td>
          <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">Not run</td>
          <td style="${tdStyle};text-align:center;color:#6b7280;font-size:11px">${fmtMs(t.durationMs)}</td>
        </tr>`),
    ['Test Name', 'Run 1 Result', 'Run 2 Result', 'Run 1 Duration']) : ''}
    ${onlyInB.length ? section('Only in Run 2 — not executed in Run 1', '📋', '#a5b4fc',
      onlyInB.map(({ name, t }) => `<tr style="background:#1a1f26">
          <td style="${tdStyle};color:#f1f5f9;font-weight:500">${escHtml(name)}</td>
          <td style="${tdStyle};text-align:center;color:#4b5563;font-size:11px">Not run</td>
          <td style="${tdStyle};text-align:center">${statusChip(t.status)}</td>
          <td style="${tdStyle};text-align:center;color:#6b7280;font-size:11px">${fmtMs(t.durationMs)}</td>
        </tr>`),
      ['Test Name', 'Run 1 Result', 'Run 2 Result', 'Run 2 Duration']) : ''}
    ${(r1.tests || []).length === 0 || (r2.tests || []).length === 0 ? `
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

let _debugScriptId = null;
let _debugSessionId = null;
let _debugTotalSteps = 0;
let _debugStepMeta = [];
let _debugPollTimer = null;
let _debugHeartbeatTimer = null;  // heartbeat polling interval
let _debugLastStepIdx = null;  // track which step we last displayed to avoid re-rendering same step
let _debugSseSource = null;  // SSE EventSource (primary push channel)

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
    const session = _activeDebugSessions[scriptId];
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

  _debugStepMeta = (script.steps || []).slice().sort((a, b) => a.order - b.order);
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
  const env = (proj?.environments || []).find(e => e.id === envId);
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
        }).catch(() => { });
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
        _debugSessionId = data2.sessionId;
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
  _debugSessionId = sessionId;
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
      console.log(`[debugger] beforeunload: sent stop beacon for session ${_debugSessionId.slice(0, 8)}`);
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
      } catch { }
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

  console.log(`[debugger] Heartbeat polling started for session ${_debugSessionId?.slice(0, 8)}`);
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

  document.getElementById('dbg-kw').textContent = keyword || '—';
  document.getElementById('dbg-loc').textContent = locator || '—';
  document.getElementById('dbg-val').textContent = value || '—';

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
  document.getElementById('dbg-kw').textContent = keyword || '—';
  document.getElementById('dbg-loc').textContent = locator || '—';
  document.getElementById('dbg-val').textContent = '—';

  // Find step number + meta for display
  const idx = _debugStepMeta.findIndex(s => s.order === stepIdx || s.order === Math.floor(stepIdx));
  const stepNum = idx >= 0 ? idx + 1 : stepIdx;
  const stepMeta = idx >= 0 ? _debugStepMeta[idx] : null;

  _debugSetProgress(`Step ${stepNum} of ${_debugTotalSteps} — FAILED`);
  _debugSetStatus('error');

  // Show error panel
  const panel = document.getElementById('dbg-error-panel');
  const title = document.getElementById('dbg-error-title');
  const type = document.getElementById('dbg-error-type');
  const msg = document.getElementById('dbg-error-message');
  if (panel) panel.style.display = 'block';
  if (title) title.textContent = `Step ${stepNum} Failed — ${keyword || ''}`;
  if (type) type.textContent = errorType || 'Error';
  if (msg) msg.textContent = errorMessage || 'Unknown error';

  // ── Inline edit panel ────────────────────────────────────────────────────────
  // Remove any existing edit panel first
  const existingEdit = document.getElementById('dbg-inline-edit');
  if (existingEdit) existingEdit.remove();

  const LOCATOR_TYPES = ['css', 'xpath', 'id', 'name', 'text', 'testid', 'role', 'label', 'placeholder', 'nth', 'last'];
  const currentLoc = locator || (stepMeta?.locator || '');
  const currentLt = stepMeta?.locatorType || 'css';
  const currentVal = stepMeta?.value || '';

  // Page-level asserts: act on `page` directly — locator fields not applicable
  const PAGE_LEVEL_ASSERT_KW = new Set([
    'ASSERT URL', 'ASSERT URL NOT', 'ASSERT TITLE', 'ASSERT TITLE NOT',
    'ASSERT DOWNLOAD COUNT', 'ASSERT RESPONSE OK', 'ASSERT FILE DOWNLOADED', 'ASSERT EXCEL ROW COUNT',
    // GAP13 + RF: locator field not applicable for these — hide in retry edit panel
    'PRESS KEY', 'PRESS_KEY',
    'SCROLL TO', 'SCROLL_TO',
    'SWITCH FRAME', 'SWITCH_FRAME',
    'RF PAN', 'RF_PAN',
    'RF DROP NODE', 'RF_DROP_NODE',
  ]);
  const kwUpper = (keyword || '').toUpperCase().trim();
  const isPageLevel = PAGE_LEVEL_ASSERT_KW.has(kwUpper);

  // frameContext: from step metadata — null = top frame, string = iframe selector
  const stepFrameCtx = stepMeta?.frameContext || null;

  const editPanel = document.createElement('div');
  editPanel.id = 'dbg-inline-edit';
  editPanel.style.cssText = 'margin-top:12px;background:#1e293b;border:1px solid #f59e0b;border-radius:8px;padding:14px 16px';
  editPanel.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:10px;letter-spacing:0.5px">✎ EDIT &amp; RETRY — correct the step without stopping the session${stepFrameCtx ? ` <span style="font-size:10px;background:#1d4ed8;color:#bfdbfe;padding:2px 6px;border-radius:4px;margin-left:6px;font-weight:600">⬚ iframe: ${escHtml(stepFrameCtx)}</span>` : ''}</div>
    <input type="hidden" id="dbg-edit-framecontext" value="${escHtml(stepFrameCtx || '')}">
    <div style="display:grid;grid-template-columns:130px 1fr;gap:8px;align-items:center;font-size:12px;color:#94a3b8">
      ${isPageLevel ? '' : `
      <label>Locator Type</label>
      <select id="dbg-edit-loctype" class="fm-input" style="font-size:12px;padding:3px 6px;background:#0f172a;color:#e2e8f0;border-color:#334155">
        ${LOCATOR_TYPES.map(t => `<option value="${t}" ${currentLt === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <label>Locator</label>
      <input id="dbg-edit-loc" class="fm-input" type="text" value="${escHtml(currentLoc)}"
        placeholder="Enter corrected locator…"
        style="font-family:monospace;font-size:12px;padding:3px 6px;background:#0f172a;color:#e2e8f0;border-color:#334155">
      `}
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

  console.log(`[debugger:error] Step ${stepIdx} (${keyword}) failed: ${errorType}: ${(errorMessage || '').slice(0, 120)}`);
}

// Apply edits and send retry to the spec
async function _debugApplyRetry(stepIdx, stepNum) {
  const locator = document.getElementById('dbg-edit-loc')?.value?.trim();
  const locatorType = document.getElementById('dbg-edit-loctype')?.value;
  const value = document.getElementById('dbg-edit-val')?.value;
  const persist = document.getElementById('dbg-edit-persist')?.checked !== false;

  // frameContext: read from hidden field (populated from step metadata on error panel render)
  // null = top frame, string = iframe selector e.g. "#flowIframe"
  const frameContextEl = document.getElementById('dbg-edit-framecontext');
  const frameContext = frameContextEl ? (frameContextEl.value || null) : null;

  // OLD: always required locator — blocked page-level asserts (ASSERT URL, ASSERT TITLE, etc.)
  // if (!locator) { alert('Locator cannot be empty'); return; }
  // Locator is optional for page-level asserts (no locator field shown); required only when field is visible
  if (document.getElementById('dbg-edit-loc') && !locator) { alert('Locator cannot be empty'); return; }

  // Persist changes to script + locator repo
  if (persist && _debugSessionId) {
    try {
      await fetch('/api/debug/patch-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: _debugSessionId,
          stepOrder: Math.floor(stepIdx),
          locator,
          locatorType,
          value,
          frameContext,
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: _debugSessionId,
      action: 'retry',
      locator,
      locatorType,
      value,
      frameContext,
    }),
  }).catch(() => { });
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
    // Clear error panel + inline edit so next step renders cleanly (not underneath error UI)
    document.getElementById('dbg-inline-edit')?.remove();
    const _skipErrPanel = document.getElementById('dbg-error-panel');
    if (_skipErrPanel) _skipErrPanel.style.display = 'none';
    // Reset header to neutral "running" state — next _debugOnStep will populate real values
    document.getElementById('dbg-kw').textContent = '—';
    document.getElementById('dbg-loc').textContent = '—';
    document.getElementById('dbg-val').textContent = '—';
    _debugSetProgress('Stepping…');
    _debugSetStatus('running');
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
  }).catch(() => { });
}

function debugClose() {
  _debugStopPolling();
  _debugStopHeartbeat();  // Stop heartbeat before stopping session
  if (_debugSessionId) {
    const sessionId = _debugSessionId;
    console.log(`[debugger] debugClose: Sending stop request for session ${sessionId.slice(0, 8)}`);
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
  _debugSessionId = null;
  _debugScriptId = null;
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
    const icon = icons[state] || '○';
    // Show iframe badge when step lives inside a frame context
    const fcBadge = s.frameContext ? `<span style="font-size:9px;background:#1d4ed8;color:#bfdbfe;padding:1px 4px;border-radius:3px;margin-left:4px;vertical-align:middle" title="Runs inside iframe: ${escHtml(s.frameContext)}">⬚</span>` : '';
    return `<div class="debug-step-row debug-step-${state}" data-order="${s.order}">
      <span class="debug-step-icon">${icon}</span>
      <div class="debug-step-info">
        <span class="debug-step-kw">${escHtml(s.keyword || '')}${fcBadge}</span>
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
  el.textContent = labels[status] || status;
  el.className = `debug-status-badge debug-status-${status}`;
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
  const img = document.getElementById('debug-screenshot-img');
  const ph = document.getElementById('debug-screenshot-placeholder');
  const loading = document.getElementById('debug-screenshot-loading');
  const error = document.getElementById('debug-screenshot-error');

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
    if (panel === 'error' && error) error.style.display = 'flex';
    if (panel === 'image') img.style.display = '';
  };

  showPanel('loading');

  // Fast path — base64 already in WS message, no HTTP round trip needed
  if (screenshotBase64) {
    console.log('[debugger] Using inline base64 screenshot — skipping HTTP fetch');
    const loadedOk = await new Promise((resolve) => {
      img.addEventListener('load', () => resolve(true), { once: true });
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
  let fileReady = false;

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
    img.addEventListener('load', () => { console.log('[debugger] Image onload fired'); resolve(true); }, { once: true });
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

﻿// ══════════════════════════════════════════════════════════════════════════════
// UI RECORDER — live step capture from browser interactions
// ══════════════════════════════════════════════════════════════════════════════
// Flow:
//   1. User clicks Record → pick environment → POST /api/recorder/start
//   2. AUT opens in new tab with recorder.js injected
//   3. Steps stream in via SSE → appended live to the script editor
//   4. User clicks Stop Recording → POST /api/recorder/stop → session ends

let _recorderToken = null;   // active session token
let _recorderSse = null;   // EventSource instance
let _recorderTab = null;   // reference to opened AUT tab
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: currentProjectId, autUrl: env.url }),
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
  const btn = document.getElementById('recorder-btn');
  const status = document.getElementById('recorder-status');
  if (btn) { btn.textContent = '\u23F9 Stop Recording'; btn.classList.add('recording'); }
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (stopRes.ok) {
      const stopData = await stopRes.json();
      recordedSteps = stopData.steps || [];
      // N13 — boilerplate suggestion returned by server
      if (stopData.boilerplateSuggestions && stopData.boilerplateSuggestions.length > 0) {
        _showBoilerplateSuggestions(stopData.boilerplateSuggestions, recordedSteps);
      }
    }
  } catch { /* ignore — server will auto-expire */ }

  // Reset UI
  const btn = document.getElementById('recorder-btn');
  const status = document.getElementById('recorder-status');
  if (btn) { btn.textContent = '⬤ Record'; btn.classList.remove('recording'); }
  if (status) { status.style.display = 'none'; }

  console.info('[Recorder] Stopped. Steps are in the editor — review and save.');

  // Replace raw SSE-streamed rows with server-normalized steps
  if (recordedSteps.length > 0) {
    const container = document.getElementById('se-steps-container');
    if (container) {
      container.innerHTML = '';
      recordedSteps.forEach(step => scriptAddStep(step));
    }
  }

  // CR6 — Intelligent Step Grouping: analyse recorded steps for reusable patterns
  if (recordedSteps.length >= 3 && currentProjectId) {
    try {
      const anaRes = await fetch('/api/recorder/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProjectId, steps: recordedSteps }),
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

// ── N13 — Login Boilerplate Suggestion ───────────────────────────────────────
// Shows a banner after Stop Recording when login+nav steps are detected.
// Lets the user wrap them into a CALL FUNCTION in one click.
function _showBoilerplateSuggestions(suggestions, steps) {
  if (!suggestions || suggestions.length === 0) return;
  const s = suggestions[0]; // process first (login is always the only one)

  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:10001;background:#1e293b;border:1px solid rgba(139,92,246,.5);border-radius:12px;padding:16px 20px;max-width:540px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:10px';

  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="background:#7c3aed;color:#fff;font-size:10px;padding:2px 8px;border-radius:999px;font-weight:700;flex-shrink:0">SUGGESTION</span>
      <span style="color:#e2e8f0;font-size:13px;font-weight:600">Login boilerplate detected</span>
      <button id="bp-dismiss" style="margin-left:auto;background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;line-height:1">&#x2715;</button>
    </div>
    <div style="color:#94a3b8;font-size:12px;line-height:1.6">
      Steps ${s.startIndex + 1}–${s.endIndex + 1} (${s.stepCount} steps) are login+navigation — repeated in every script.
      Wrap them in a <strong style="color:#a78bfa">Common Function</strong> once and reuse via <code style="background:#0f172a;padding:1px 5px;border-radius:3px;font-size:11px">CALL FUNCTION</code>.
    </div>
    <div style="display:flex;gap:8px">
      <button id="bp-wrap" style="flex:1;background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:13px;font-weight:600;cursor:pointer">Wrap in Common Function</button>
      <button id="bp-keep" style="flex:1;background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:8px;padding:8px 14px;font-size:13px;cursor:pointer">Keep as-is</button>
    </div>`;

  document.body.appendChild(banner);

  document.getElementById('bp-dismiss').onclick = () => banner.remove();
  document.getElementById('bp-keep').onclick    = () => banner.remove();
  document.getElementById('bp-wrap').onclick    = async () => {
    banner.remove();
    // Reuse CR6 mechanism: build a synthetic pattern and call _cr6ShowCard
    const boilerplateSteps = steps.slice(s.startIndex, s.endIndex + 1);
    const syntheticPattern = {
      startIndex:      s.startIndex,
      endIndex:        s.endIndex,
      steps:           boilerplateSteps,
      matchCount:      0,
      suggestedName:   'Login',
      duplicateFnId:   undefined,
    };
    _cr6ShowCard(syntheticPattern, steps.length, () => {});
  };
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
  const stepsList = pattern.steps.map((s, i) =>
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
    const nameInp = overlay.querySelector('#cr6-fn-name');
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
    const nameInp = overlay.querySelector('#cr6-fn-name');
    const identInp = overlay.querySelector('#cr6-fn-ident');
    const fnName = isDuplicate ? pattern.suggestedName : (nameInp?.value.trim() || '');
    const fnIdent = isDuplicate ? '' : (identInp?.value.trim() || '');

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
        order: i + 1,
        keyword: s.keyword,
        locatorName: s.locatorName ?? null,
        locatorType: s.locatorType ?? 'css',
        selector: s.locator ?? s.selector ?? null,  // script uses 'locator', fn uses 'selector'
        description: s.description ?? '',
      }));

      const body = {
        name: fnName,
        identifier: fnIdent,
        description: `Auto-extracted from recording — ${pattern.matchCount} matching script${pattern.matchCount !== 1 ? 's' : ''}`,
        steps: fnSteps,
        projectId: currentProjectId || null,
      };

      const res = await fetch('/api/functions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      fnId = data.id;
      fnNameResolved = fnName;

      // Refresh the in-memory allFunctions list so CALL FUNCTION picker finds the new fn
      await fnLoad();
    }
  }

  // ── Replace matched DOM rows with a single CALL FUNCTION step ────────────────
  // The recorded steps were appended to the end of any pre-existing editor rows.
  // So recorded step at index i → DOM row at (totalRows - recordedStepsTotal + i).
  const allRows = [...document.querySelectorAll('#se-steps-container .script-step-row')];
  const offset = allRows.length - recordedStepsTotal;

  const domStart = offset + pattern.startIndex;
  const domEnd = offset + pattern.endIndex;

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
        value: s.value,
        testData: s.testData || [],
      });
    }
    return acc;
  }, []);

  // Insert a CALL FUNCTION step at the same position
  const callFnStep = {
    keyword: 'CALL FUNCTION',
    value: fnNameResolved,
    valueMode: 'static',
    fnStepValues,
    locator: null,
    locatorName: null,
    locatorType: 'css',
    description: `Call: ${fnNameResolved}`,
    screenshot: false,
    testData: [],
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
      const env = environments.find(e => e.id === selId) || environments[0];
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
  if (_recorderSse) { try { _recorderSse.close(); } catch { } _recorderSse = null; }
}

// ── Append a recorded step to the script editor ───────────────────────────────
function _recorderAppendStep(step, locatorCreated, locatorName) {
  // Build a step object that scriptAddStep understands
  const stepData = {
    keyword: step.keyword,
    locator: step.locator || '',
    locatorId: step.locatorId || null,
    locatorType: step.locatorType || 'css',
    locatorName: locatorName || step.locator || '',
    value: step.value || '',
    valueMode: 'static',
    description: step.description || '',
    screenshot: false,
    testData: [],
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
      setTimeout(() => { try { badge.remove(); } catch { } }, 4000);
    }
  }
}

// ── [Gap 4] Inline locator editor — edit before saving ───────────────────────
function _recorderInlineEditLocator(rowEl, stepData) {
  // Remove any existing inline editor on this row
  const existing = rowEl.querySelector('.rec-inline-edit');
  if (existing) { existing.remove(); return; }

  const LOCATOR_TYPES = ['css', 'xpath', 'id', 'name', 'text', 'testid', 'role', 'label', 'placeholder', 'nth', 'last'];

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
  const editor = btn.closest('.rec-inline-edit');
  const rowEl = editor.parentElement;
  const stepData = editor._stepData;
  const newType = editor.querySelector('.rec-loc-type').value;
  const newLoc = editor.querySelector('.rec-loc-value').value.trim();
  if (!newLoc) { alert('Locator cannot be empty'); return; }

  // Update stepData in-place (it's a reference from the scriptAddStep call)
  stepData.locator = newLoc;
  stepData.locatorType = newType;
  stepData.locatorName = newLoc;

  // Update the displayed locator text in the step row
  const locDisplay = rowEl.querySelector('.step-locator-text, .step-locator, [data-field="locator"]');
  if (locDisplay) locDisplay.textContent = newLoc;

  // Update the underlying hidden inputs if scriptAddStep rendered them
  const locInput = rowEl.querySelector('input[name="locator"], .se-locator-input');
  const locTypeInput = rowEl.querySelector('select[name="locatorType"], .se-loctype-select');
  if (locInput) locInput.value = newLoc;
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

let _apikeyRawKey = null;
let _akAllSuites = [];
let _akAllProjects = [];
let _akGeneratedId = null;  // id returned after generation (for YAML suite/env fallback)

async function apikeyLoad() {
  const res = await fetch('/api/admin/apikeys');
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
  _apikeyRawKey = null;
  _akGeneratedId = null;

  // Reset form
  document.getElementById('ak-name').value = '';
  document.getElementById('ak-expires').value = '';
  document.getElementById('ak-suite').innerHTML = '<option value="">— select suite —</option>';
  document.getElementById('ak-env').innerHTML = '<option value="">— select environment —</option>';
  document.getElementById('ak-timeout').value = '30';
  document.getElementById('ak-poll').value = '5';
  document.getElementById('apikey-modal-alert').innerHTML = '';
  document.getElementById('apikey-result-block').style.display = 'none';
  document.getElementById('apikey-form-block').style.display = '';
  document.getElementById('ak-save-btn').style.display = '';
  document.getElementById('ak-modal-title').textContent = 'Generate API Key';
  document.getElementById('ak-copy-yaml-btn').disabled = true;
  document.getElementById('ak-dl-yaml-btn').disabled = true;
  document.getElementById('ak-yaml-preview').textContent = 'Configure the fields on the left to preview the generated YAML.';

  // Load projects first, then suites
  _akAllProjects = await _getProjects();
  _akAllSuites = [];

  const projSel = document.getElementById('ak-project');
  projSel.innerHTML = '<option value="">— select project —</option>' +
    _akAllProjects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

  document.getElementById('modal-apikey').style.display = 'flex';
  _akYamlUpdate();
}

function _akPopulateSuites(projectId) {
  const list = projectId ? _akAllSuites.filter(s => s.projectId === projectId) : _akAllSuites;
  const sel = document.getElementById('ak-suite');
  sel.innerHTML = '<option value="">— select suite —</option>' +
    list.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
  document.getElementById('ak-env').innerHTML = '<option value="">— select environment —</option>';
}

async function _akProjectChange() {
  const projectId = document.getElementById('ak-project').value;

  // Reset downstream selects
  document.getElementById('ak-suite').innerHTML = '<option value="">— loading… —</option>';
  document.getElementById('ak-env').innerHTML = '<option value="">— select environment —</option>';

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
  const suite = _akAllSuites.find(s => s.id === suiteId);
  const envSel = document.getElementById('ak-env');
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
  const platform = window.location.origin;
  const keyName = document.getElementById('ak-name').value.trim() || 'ADO Pipeline — QA';
  const suiteId = document.getElementById('ak-suite').value;
  const suiteName = suiteId ? ((_akAllSuites.find(s => s.id === suiteId) || {}).name || suiteId) : '<SUITE_ID>';
  const envId = document.getElementById('ak-env').value || '<ENV_ID>';
  const timeout = document.getElementById('ak-timeout').value || '30';
  const poll = document.getElementById('ak-poll').value || '5';
  const rawKey = _apikeyRawKey || '$(QA_API_KEY)';
  const suiteIdVal = suiteId || '<SUITE_ID>';

  // bash + curl - Linux ADO agents (ubuntu-latest)
  // Fixed: jq JSON, QA_PLATFORM_URL from var group, curl --retry
  const sh = [
    '      set -euo pipefail',
    "      trap 'echo \"ERROR: Script failed at line $LINENO\"' ERR",
    '      PLATFORM="${QA_PLATFORM_URL}"',
    "      SUITE_ID='" + suiteIdVal + "'",
    "      SUITE_NAME='" + suiteName.replace(/'/g, '') + "'",
    "      ENV_ID='" + envId + "'",
    '      TIMEOUT_SECS=$(( ' + timeout + ' * 60 ))',
    '      POLL_SECS=' + poll,
    '',
    '      if ! command -v jq >/dev/null 2>&1; then',
    '        echo "ERROR: jq is required but not installed on this agent"',
    '        exit 1',
    '      fi',
    '',
    '      AUTH_HEADER="Authorization: Bearer ${QA_API_KEY}"',
    '',
    '      echo "Triggering suite: ${SUITE_NAME}"',
    '      RESPONSE=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 -X POST "${PLATFORM}/api/suites/${SUITE_ID}/run" \\',
    '        -H "$AUTH_HEADER" \\',
    "        -H 'Content-Type: application/json' \\",
    '        -d \'{"environmentId":"\'${ENV_ID}\'"}\')',
    '',
    "      RUN_ID=$(echo \"$RESPONSE\" | jq -r '.runId // empty')",
    '      [ -z "$RUN_ID" ] && { echo "ERROR: No runId. Response: $RESPONSE"; exit 1; }',
    '      echo "Run ID: $RUN_ID"',
    '',
    '      DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))',
    '      while true; do',
    '        if [ "$(date +%s)" -gt "$DEADLINE" ]; then',
    "          echo 'ERROR: Timed out after " + timeout + " min.'",
    '          exit 1',
    '        fi',
    '        sleep "$POLL_SECS"',
    '        [ "$POLL_SECS" -lt 30 ] && POLL_SECS=$(( POLL_SECS + 5 ))',
    '        [ "$POLL_SECS" -gt 30 ] && POLL_SECS=30',
    '        echo "Polling run status for RUN_ID=${RUN_ID} ..."',
    '        RUN=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 "${PLATFORM}/api/run/${RUN_ID}" \\',
    '          -H "$AUTH_HEADER")',
    "        STATUS=$(echo \"$RUN\" | jq -r '.status // \"unknown\"')",
    "        PASSED=$(echo \"$RUN\" | jq -r '.passed // 0')",
    "        FAILED=$(echo \"$RUN\" | jq -r '.failed // 0')",
    "        TOTAL=$( echo \"$RUN\" | jq -r '.total  // 0')",
    '        echo "[$STATUS] passed=${PASSED} | failed=${FAILED} | total=${TOTAL}"',
    '        case "$STATUS" in',
    "          running)   ;;",
    "          passed)    break ;;",
    "          failed)    break ;;",
    "          cancelled) echo 'Run was cancelled in TestForge.'; exit 1 ;;",
    '          *)         echo "ERROR: Unexpected status: $STATUS"; exit 1 ;;',
    '        esac',
    '      done',
    '      echo "Final Status: ${STATUS}"',
    '',
    '      REPORT_URL="${PLATFORM}/execution-report?runId=${RUN_ID}"',
    '      echo "Report: ${REPORT_URL}"',
    '',
    '      SUMMARY="${AGENT_TEMPDIRECTORY}/qa-summary.md"',
    '      printf \'## TestForge Results\\\\n**Suite:** %s\\\\n\\\\n\' "${SUITE_NAME}" > "$SUMMARY"',
    "      printf '| | |\\\\n|---|---|\\\\n' >> \"$SUMMARY\"",
    '      printf \'| Status | %s |\\\\n\' "$STATUS"  >> "$SUMMARY"',
    '      printf \'| Passed | %s |\\\\n\' "$PASSED"  >> "$SUMMARY"',
    '      printf \'| Failed | %s |\\\\n\' "$FAILED"  >> "$SUMMARY"',
    '      printf \'| Total  | %s |\\\\n\' "$TOTAL"   >> "$SUMMARY"',
    '      printf \'\\\\n[Open Report](%s)\\\\n\' "$REPORT_URL" >> "$SUMMARY"',
    '      echo "##vso[task.uploadsummary]${SUMMARY}"',
    '',
    "      if [ \"$STATUS\" = 'failed' ] || [ \"${FAILED}\" -gt 0 ]; then",
    '        echo "ERROR: Suite FAILED (${FAILED} test(s) failed)."',
    '        exit 1',
    '      fi',
    "      echo 'All tests passed.'",
  ].join('\n');

  // Reusable ADO template content (second download button)
  const templateYaml =
    "# testforge-run-template.yml\n"
  "# Drop in your repo root. Reference from any pipeline via:\n"
  "#   - template: testforge-run-template.yml\n"
  "#     parameters:\n"
  "#       suiteName: My Suite\n"
  "#       suiteId: <id>\n"
  "#       envId: <env>\n"
  "# Variable Group 'qa-platform-config' must have:\n"
  "#   QA_API_KEY      - secret, from TestForge Admin > API Keys\n"
  "#   QA_PLATFORM_URL - TestForge server base URL\n"
  "\n"
  "parameters:\n"
  "  - name: suiteName\n"
  "    type: string\n"
  "  - name: suiteId\n"
  "    type: string\n"
  "  - name: envId\n"
  "    type: string\n"
  "  - name: timeoutMinutes\n"
  "    type: number\n"
  "    default: 30\n"
  "  - name: pollSeconds\n"
  "    type: number\n"
  "    default: 5\n"
  "\n"
  "steps:\n"
  "- task: Bash@3\n"
  "  displayName: 'TestForge \u2014 ${{ parameters.suiteName }}'\n"
  "  env:\n"
  "    QA_API_KEY:      $(QA_API_KEY)\n"
  "    QA_PLATFORM_URL: $(QA_PLATFORM_URL)\n"
  "  inputs:\n"
  "    targetType: inline\n"
  "    script: |\n"
  "      set -euo pipefail\n"
  "      trap 'echo \"ERROR: Script failed at line $LINENO\"' ERR\n"
  "      PLATFORM=\"${QA_PLATFORM_URL}\"\n"
  "      SUITE_ID='${{ parameters.suiteId }}'\n"
  "      ENV_ID='${{ parameters.envId }}'\n"
  "      TIMEOUT_SECS=$(( ${{ parameters.timeoutMinutes }} * 60 ))\n"
  "      POLL_SECS=${{ parameters.pollSeconds }}\n"
  "      if ! command -v jq >/dev/null 2>&1; then\n"
  "        echo \"ERROR: jq is required but not installed on this agent\"\n"
  "        exit 1\n"
  "      fi\n"
  "      AUTH_HEADER=\"Authorization: Bearer ${QA_API_KEY}\"\n"
  "      echo 'Triggering: ${{ parameters.suiteName }}'\n"
  "      RESPONSE=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 -X POST \"${PLATFORM}/api/suites/${SUITE_ID}/run\" \\\n"
  "        -H \"$AUTH_HEADER\" \\\n"
  "        -H 'Content-Type: application/json' \\\n"
  "        -d '{\"environmentId\":\"${{ parameters.envId }}\"}')\n"
  "      RUN_ID=$(echo \"$RESPONSE\" | jq -r '.runId // empty')\n"
  "      [ -z \"$RUN_ID\" ] && { echo \"ERROR: No runId. Response: $RESPONSE\"; exit 1; }\n"
  "      echo \"Run ID: $RUN_ID\"\n"
  "      DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))\n"
  "      while true; do\n"
  "        if [ \"$(date +%s)\" -gt \"$DEADLINE\" ]; then\n"
  "          echo 'ERROR: Timed out.'; exit 1\n"
  "        fi\n"
  "        sleep \"$POLL_SECS\"\n"
  "        [ \"$POLL_SECS\" -lt 30 ] && POLL_SECS=$(( POLL_SECS + 5 ))\n"
  "        [ \"$POLL_SECS\" -gt 30 ] && POLL_SECS=30\n"
  "        echo \"Polling run status for RUN_ID=${RUN_ID} ...\"\n"
  "        RUN=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 \"${PLATFORM}/api/run/${RUN_ID}\" \\\n"
  "          -H \"$AUTH_HEADER\")\n"
  "        STATUS=$(echo \"$RUN\" | jq -r '.status // \"unknown\"')\n"
  "        PASSED=$(echo \"$RUN\" | jq -r '.passed // 0')\n"
  "        FAILED=$(echo \"$RUN\" | jq -r '.failed // 0')\n"
  "        TOTAL=$( echo \"$RUN\" | jq -r '.total  // 0')\n"
  "        echo \"[$STATUS] passed=${PASSED} | failed=${FAILED} | total=${TOTAL}\"\n"
  "        case \"$STATUS\" in\n"
  "          running)   ;;\n"
  "          passed)    break ;;\n"
  "          failed)    break ;;\n"
  "          cancelled) echo 'Run was cancelled in TestForge.'; exit 1 ;;\n"
  "          *)         echo \"ERROR: Unexpected status: $STATUS\"; exit 1 ;;\n"
  "        esac\n"
  "      done\n"
  "      echo \"Final Status: ${STATUS}\"\n"
  "      if [ \"$STATUS\" = 'failed' ] || [ \"${FAILED}\" -gt 0 ]; then\n"
  "        echo \"ERROR: Suite FAILED (${FAILED} test(s) failed).\"; exit 1\n"
  "      fi\n"
  "      echo 'All tests passed.'\n";

  const yaml =
    "# Generated by TestForge \u2014 " + new Date().toISOString().slice(0, 10) + "\n" +
    "# Inline pipeline step. For reuse across suites, download testforge-run-template.yml.\n" +
    "# Variable Group 'qa-platform-config' must contain:\n" +
    "#   QA_API_KEY:      (secret) API key from TestForge Admin > API Keys\n" +
    "#   QA_PLATFORM_URL: " + platform + "\n" +
    (_apikeyRawKey ? "# QA_API_KEY value: " + rawKey + "\n" : "") +
    "\n" +
    "variables:\n" +
    "  - group: qa-platform-config\n" +
    "\n" +
    "- task: Bash@3\n" +
    "  displayName: 'TestForge Suite \u2014 " + suiteName.replace(/'/g, "''") + "'\n" +
    "  env:\n" +
    "    QA_API_KEY:      $(QA_API_KEY)\n" +
    "    QA_PLATFORM_URL: $(QA_PLATFORM_URL)\n" +
    "  inputs:\n" +
    "    targetType: inline\n" +
    "    script: |\n" +
    sh;


  document.getElementById('ak-yaml-preview').textContent = yaml;

  // Enable copy/download if suite is selected
  const canExport = !!suiteId;
  document.getElementById('ak-copy-yaml-btn').disabled = !canExport;
  document.getElementById('ak-dl-yaml-btn').disabled = !canExport;
}

function apikeyCloseModal() {
  document.getElementById('modal-apikey').style.display = 'none';
  if (_apikeyRawKey) apikeyLoad();
}

function apikeyCopyKey() {
  if (!_apikeyRawKey) return;
  const btn = document.querySelector('#apikey-result-block .btn');
  const orig = btn ? btn.textContent : 'Copy';
  const succeed = () => { if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = orig; }, 1800); } };
  const fail = () => { if (btn) { btn.textContent = 'Select + Ctrl+C'; setTimeout(() => { btn.textContent = orig; }, 2500); } };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(_apikeyRawKey).then(succeed).catch(() => _akCopyFallback(_apikeyRawKey, succeed, fail));
  } else {
    _akCopyFallback(_apikeyRawKey, succeed, fail);
  }
}

function _akCopyYaml() {
  const yaml = document.getElementById('ak-yaml-preview').textContent;
  const btn = document.getElementById('ak-copy-yaml-btn');
  const orig = btn.textContent;

  const succeed = () => { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = orig; }, 1800); };
  const fail = () => { btn.textContent = 'Select + Ctrl+C'; setTimeout(() => { btn.textContent = orig; }, 2500); };

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
  const yaml = document.getElementById('ak-yaml-preview').textContent;
  const suiteSel = document.getElementById('ak-suite');
  const suiteName = suiteSel.options[suiteSel.selectedIndex]?.text || 'qa-suite';
  const safeName = suiteName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const blob = new Blob([yaml], { type: 'text/yaml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `testforge-pipeline-${safeName}.yml`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function _akDownloadTemplate() {
  const suiteIdVal = (document.getElementById('ak-suite') || {}).value || '';
  const envId = (document.getElementById('ak-env') || {}).value || '';
  const timeout = (document.getElementById('ak-timeout') || {}).value || '30';
  const poll = (document.getElementById('ak-poll') || {}).value || '5';
  const suiteSel = document.getElementById('ak-suite');
  const suiteName = suiteSel?.options[suiteSel.selectedIndex]?.text || 'My Suite';

  // Build template — uses ADO ${{ parameters.x }} syntax, not runtime values
  const content = _akBuildTemplateYaml();
  const blob = new Blob([content], { type: 'text/yaml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'testforge-run-template.yml';
  a.click();
  URL.revokeObjectURL(a.href);
}

function _akBuildTemplateYaml() {
  const suiteIdVal = (document.getElementById('ak-suite') || {}).value || '<suite-id>';
  const envId = (document.getElementById('ak-env') || {}).value || '<env-id>';
  const suiteSel = document.getElementById('ak-suite');
  const suiteName = suiteSel?.options[suiteSel.selectedIndex]?.text || 'My Suite';

  // templateYaml is defined in _akYamlUpdate scope — rebuild inline
  return (
    "# testforge-run-template.yml\n" +
    "# Drop in your repo root. Reference from any pipeline via:\n" +
    "#   - template: testforge-run-template.yml\n" +
    "#     parameters:\n" +
    "#       suiteName: " + suiteName + "\n" +
    "#       suiteId: " + suiteIdVal + "\n" +
    "#       envId: " + envId + "\n" +
    "# Variable Group 'qa-platform-config' must have:\n" +
    "#   QA_API_KEY      - secret, from TestForge Admin > API Keys\n" +
    "#   QA_PLATFORM_URL - " + window.location.origin + "\n" +
    "\n" +
    "parameters:\n" +
    "  - name: suiteName\n" +
    "    type: string\n" +
    "  - name: suiteId\n" +
    "    type: string\n" +
    "  - name: envId\n" +
    "    type: string\n" +
    "  - name: timeoutMinutes\n" +
    "    type: number\n" +
    "    default: 30\n" +
    "  - name: pollSeconds\n" +
    "    type: number\n" +
    "    default: 5\n" +
    "\n" +
    "steps:\n" +
    "- task: Bash@3\n" +
    "  displayName: 'TestForge — ${{ parameters.suiteName }}'\n" +
    "  env:\n" +
    "    QA_API_KEY:      $(QA_API_KEY)\n" +
    "    QA_PLATFORM_URL: $(QA_PLATFORM_URL)\n" +
    "  inputs:\n" +
    "    targetType: inline\n" +
    "    script: |\n" +
    "      set -euo pipefail\n" +
    "      trap 'echo \"ERROR: Script failed at line $LINENO\"' ERR\n" +
    "      PLATFORM=\"${QA_PLATFORM_URL}\"\n" +
    "      SUITE_ID='${{ parameters.suiteId }}'\n" +
    "      ENV_ID='${{ parameters.envId }}'\n" +
    "      TIMEOUT_SECS=$(( ${{ parameters.timeoutMinutes }} * 60 ))\n" +
    "      POLL_SECS=${{ parameters.pollSeconds }}\n" +
    "      if ! command -v jq >/dev/null 2>&1; then\n" +
    "        echo \"ERROR: jq is required but not installed on this agent\"\n" +
    "        exit 1\n" +
    "      fi\n" +
    "      AUTH_HEADER=\"Authorization: Bearer ${QA_API_KEY}\"\n" +
    "      echo 'Triggering: ${{ parameters.suiteName }}'\n" +
    "      RESPONSE=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 -X POST \"${PLATFORM}/api/suites/${SUITE_ID}/run\" \\\n" +
    "        -H \"$AUTH_HEADER\" \\\n" +
    "        -H 'Content-Type: application/json' \\\n" +
    "        -d '{\"environmentId\":\"${{ parameters.envId }}\"}')\n" +
    "      RUN_ID=$(echo \"$RESPONSE\" | jq -r '.runId // empty')\n" +
    "      [ -z \"$RUN_ID\" ] && { echo \"ERROR: No runId. Response: $RESPONSE\"; exit 1; }\n" +
    "      echo \"Run ID: $RUN_ID\"\n" +
    "      DEADLINE=$(( $(date +%s) + TIMEOUT_SECS ))\n" +
    "      while true; do\n" +
    "        if [ \"$(date +%s)\" -gt \"$DEADLINE\" ]; then\n" +
    "          echo 'ERROR: Timed out.'; exit 1\n" +
    "        fi\n" +
    "        sleep \"$POLL_SECS\"\n" +
    "        [ \"$POLL_SECS\" -lt 30 ] && POLL_SECS=$(( POLL_SECS + 5 ))\n" +
    "        [ \"$POLL_SECS\" -gt 30 ] && POLL_SECS=30\n" +
    "        echo \"Polling run status for RUN_ID=${RUN_ID} ...\"\n" +
    "        RUN=$(curl -sS --fail-with-body --retry 3 --retry-delay 5 \"${PLATFORM}/api/run/${RUN_ID}\" \\\n" +
    "          -H \"$AUTH_HEADER\")\n" +
    "        STATUS=$(echo \"$RUN\" | jq -r '.status // \"unknown\"')\n" +
    "        PASSED=$(echo \"$RUN\" | jq -r '.passed // 0')\n" +
    "        FAILED=$(echo \"$RUN\" | jq -r '.failed // 0')\n" +
    "        TOTAL=$( echo \"$RUN\" | jq -r '.total  // 0')\n" +
    "        echo \"[$STATUS] passed=${PASSED} | failed=${FAILED} | total=${TOTAL}\"\n" +
    "        case \"$STATUS\" in\n" +
    "          running)   ;;\n" +
    "          passed)    break ;;\n" +
    "          failed)    break ;;\n" +
    "          cancelled) echo 'Run was cancelled in TestForge.'; exit 1 ;;\n" +
    "          *)         echo \"ERROR: Unexpected status: $STATUS\"; exit 1 ;;\n" +
    "        esac\n" +
    "      done\n" +
    "      echo \"Final Status: ${STATUS}\"\n" +
    "      if [ \"$STATUS\" = 'failed' ] || [ \"${FAILED}\" -gt 0 ]; then\n" +
    "        echo \"ERROR: Suite FAILED (${FAILED} test(s) failed).\"; exit 1\n" +
    "      fi\n" +
    "      echo 'All tests passed.'\n"
  );
}

async function apikeySave() {
  const name = document.getElementById('ak-name').value.trim();
  const projectId = document.getElementById('ak-project').value || null;
  const expiresIn = document.getElementById('ak-expires').value;
  const alertEl = document.getElementById('apikey-modal-alert');

  if (!name) { alertEl.innerHTML = '<div class="alert alert-error">Key name is required.</div>'; return; }
  if (!projectId) { alertEl.innerHTML = '<div class="alert alert-error">Project scope is required.</div>'; return; }

  let expiresAt = null;
  if (expiresIn) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(expiresIn));
    expiresAt = d.toISOString();
  }

  const res = await fetch('/api/admin/apikeys', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, projectId, expiresAt })
  });
  const data = await res.json();
  if (!res.ok) { alertEl.innerHTML = `<div class="alert alert-error">${escHtml(data.error || 'Error')}</div>`; return; }

  _apikeyRawKey = data.key;
  _akGeneratedId = data.id;

  document.getElementById('apikey-raw-display').textContent = data.key;
  document.getElementById('apikey-result-block').style.display = '';
  document.getElementById('ak-save-btn').style.display = 'none';
  document.getElementById('ak-modal-title').textContent = 'Key Generated — Save YAML';

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
    const data = licRes.ok ? await licRes.json() : { activated: false };
    const machine = machineRes.ok ? await machineRes.json() : null;
    const audit = auditRes.ok ? await auditRes.json() : [];
    const sessData = sessionsRes.ok ? await sessionsRes.json() : { sessions: [], seatsUsed: 0 };

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

async function licCopyMachineId() {
  const field = document.getElementById('lic-machine-id-field');
  const id = field?.value?.trim() ?? '';
  if (!id) return;
  const btn = document.getElementById('lic-copy-mid-btn');
  try {
    await navigator.clipboard.writeText(id);
    if (btn) { btn.textContent = 'Copied!'; btn.style.color = 'var(--success,#4ade80)'; setTimeout(() => { btn.textContent = 'Copy ID'; btn.style.color = ''; }, 2000); }
  } catch {
    field.select();
    prompt('Copy this Machine ID and send it to your vendor:', id);
  }
}

function _renderLicensePanel(data, machine, audit, sessions) {
  const statusBlock = document.getElementById('lic-status-block');
  const activateBlock = document.getElementById('lic-activate-block');
  const alertEl = document.getElementById('license-alert');
  if (!statusBlock || !activateBlock) return;
  alertEl.innerHTML = '';

  const preActivateEl = document.getElementById('lic-machineid-preactivate');
  if (!data.activated) {
    statusBlock.style.display = 'none';
    activateBlock.style.display = '';
    if (preActivateEl) preActivateEl.style.display = '';
    return;
  }
  // Also show Machine ID block during trial so customer can request a paid license
  if (preActivateEl) preActivateEl.style.display = data.isAutoTrial ? '' : 'none';

  // Show status block
  statusBlock.style.display = '';

  // Auto-trial: show activate form alongside status so admin can enter key
  activateBlock.style.display = data.isAutoTrial ? '' : 'none';

  // Trial banner
  const existingBanner = document.getElementById('lic-trial-banner');
  if (existingBanner) existingBanner.remove();
  if (data.isAutoTrial) {
    const days = data.trialDaysLeft ?? 0;
    const urgent = days <= 3;
    const banner = document.createElement('div');
    banner.id = 'lic-trial-banner';
    banner.style.cssText = `margin-bottom:14px;padding:10px 14px;border-radius:6px;font-size:.82rem;display:flex;align-items:center;gap:10px;background:${urgent ? '#450a0a' : '#431407'};border:1px solid ${urgent ? '#dc2626' : '#ea580c'};color:${urgent ? '#fca5a5' : '#fdba74'}`;
    banner.innerHTML = `<span style="font-size:1.1rem">${urgent ? '🔴' : '🟠'}</span>
      <span><strong>${days} day${days !== 1 ? 's' : ''} left on your free trial.</strong>
      Enter a license key below to continue using the platform after the trial ends.</span>`;
    statusBlock.insertAdjacentElement('afterbegin', banner);
  }

  const tierBadge = document.getElementById('lic-tier-badge');
  tierBadge.textContent = data.isAutoTrial ? 'TRIAL (AUTO)' : data.tier.toUpperCase();
  tierBadge.className = `lic-badge lic-badge-${data.tier}`;

  document.getElementById('lic-org-name').textContent = data.orgName || data.orgId;

  const expiryChip = document.getElementById('lic-expiry-chip');
  if (data.expired) {
    expiryChip.textContent = 'EXPIRED';
    expiryChip.className = 'lic-chip lic-chip-red';
  } else if (data.daysLeft <= 14) {
    expiryChip.textContent = `Expires in ${data.daysLeft} days`;
    expiryChip.className = 'lic-chip lic-chip-amber';
  } else {
    expiryChip.textContent = `Expires ${new Date(data.expiresAt).toLocaleDateString()}`;
    expiryChip.className = 'lic-chip lic-chip-green';
  }

  const seatsChip = document.getElementById('lic-seats-chip');
  seatsChip.textContent = data.seats === -1
    ? 'Unlimited seats'
    : `${data.seatsUsed} / ${data.seats} seats`;
  seatsChip.className = 'lic-chip lic-chip-blue';

  const projChip = document.getElementById('lic-projects-chip');
  if (projChip) {
    const mp = data.features?.maxProjects ?? -1;
    if (mp !== -1) {
      projChip.textContent = `${mp} projects max`;
      projChip.style.display = '';
    } else {
      projChip.style.display = 'none';
    }
  }

  const featList = document.getElementById('lic-features-list');
  const f = data.features || {};
  const ov = data.featureOverrides || {};   // P4-01: vendor-signed overrides
  const labels = {
    recorder: 'Recorder', debugger: 'Debugger', scheduler: 'Scheduler',
    sso: 'SSO', apiAccess: 'API Access', whiteLabel: 'White-label'
  };

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
    const bound = machine.boundMachineId;
    const match = machine.match;
    const fullMachineId = machine.currentMachineId || '';
    const c = machine.components || {};
    const stability = machine.stability || 'unknown';
    const signalCount = machine.signalCount ?? 0;

    const matchBadge = match === true
      ? `<span class="lic-chip lic-chip-green" style="font-size:.72rem">Bound ✓</span>`
      : match === false
        ? `<span class="lic-chip lic-chip-red" style="font-size:.72rem">Mismatch ⚠</span>`
        : `<span class="lic-chip" style="font-size:.72rem">Unbound</span>`;

    const stabilityColor = stability === 'excellent' ? '#4ade80' : stability === 'good' ? '#86efac'
      : stability === 'fair' ? '#fbbf24' : '#f87171';
    const stabilityLabel = stability === 'excellent' ? '● Excellent — 3+ hardware signals'
      : stability === 'good' ? '● Good — 2 hardware signals'
      : stability === 'fair' ? '● Fair — 1 hardware signal'
      : '● Weak — no hardware signals (VM/container with no identifiers)';

    const sig = (label, val) => `<div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="font-size:.72rem;color:var(--text-muted);min-width:140px;flex-shrink:0">${label}</span>
      <code style="font-size:.72rem;color:${val ? '#e2e8f0' : 'var(--text-muted)'};word-break:break-all">${_escHtml(val || '—')}</code>
    </div>`;

    machineEl.innerHTML = `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:8px">Machine Binding</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <code style="font-size:.78rem;color:var(--text-secondary)">${_escHtml(bound ? machine.boundMachineIdHint : machine.currentMachineIdHint)}</code>
          ${matchBadge}
          ${match === false ? `<button class="btn btn-outline btn-sm" onclick="licenseTransfer()" style="color:var(--warning)">Transfer to this machine</button>` : ''}
        </div>

        <div style="margin-bottom:10px">
          <div style="font-size:.72rem;margin-bottom:4px">
            <span style="color:${stabilityColor};font-weight:600">${stabilityLabel}</span>
            <span style="color:var(--text-muted);margin-left:6px">(${signalCount} of 4 hardware signals available)</span>
          </div>
          <div style="background:rgba(0,0,0,.25);border-radius:6px;padding:8px 10px">
            ${sig('Windows GUID (S1)', c.windowsMachineGuid)}
            ${sig('BIOS UUID (S2)', c.biosUuid)}
            ${sig('Volume Serial (S3)', c.volumeSerial)}
            ${sig('Physical MAC (S4)', c.stableMAC)}
            ${sig('Hostname', c.hostname)}
            ${sig('CPU Model', c.cpuModel)}
            ${sig('Platform / Arch', c.platform && c.arch ? c.platform + ' / ' + c.arch : '')}
          </div>
        </div>

        <div>
          <div style="font-size:.74rem;color:var(--text-muted);margin-bottom:5px">Share this Machine ID with your vendor to receive a license key:</div>
          <div style="display:flex;align-items:center;gap:8px">
            <input id="lic-machine-id-field" type="text" readonly value="${_escHtml(fullMachineId)}"
              style="font-family:monospace;font-size:.78rem;background:var(--bg-secondary,#1e1e2e);border:1px solid rgba(255,255,255,.12);
                     border-radius:6px;padding:6px 10px;color:var(--text-primary);flex:1;min-width:0;cursor:pointer"
              onclick="this.select()" title="Click to select all" />
            <button class="btn btn-outline btn-sm" onclick="licCopyMachineId()" id="lic-copy-mid-btn"
              style="white-space:nowrap;flex-shrink:0">Copy ID</button>
          </div>
        </div>
        ${data.maxInstances && data.maxInstances !== -1 ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:6px">Max ${data.maxInstances} server instance${data.maxInstances === 1 ? '' : 's'} allowed</div>` : ''}
      </div>`;
  }

  // P2-02: Active Seat Dashboard
  const sessionsEl = document.getElementById('lic-sessions-block');
  if (sessionsEl) {
    const activeSessions = Array.isArray(sessions) ? sessions : [];
    const seatsUsed = data.seatsUsed ?? 0;
    const seatsTotal = data.seats === -1 ? '∞' : (data.seats ?? '—');
    const ratio = data.seatRatio ?? -1;
    const barPct = ratio === -1 ? 0 : Math.min(100, Math.round(ratio * 100));
    const barColor = ratio >= 0.9 ? '#ef4444' : ratio >= 0.8 ? '#f59e0b' : '#22c55e';

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
                ${(window._licSessions = activeSessions, activeSessions.map((s, idx) => `<tr>
                  <td style="padding:5px 6px;color:var(--text-secondary);font-weight:${s.isCurrent ? '600' : '400'}">${_escHtml(s.username || '—')}${s.isCurrent ? ' <span style="font-size:.68rem;color:#60a5fa">(you)</span>' : ''}</td>
                  <td style="padding:5px 6px"><span class="badge badge-${s.role || 'tester'}">${_escHtml(s.role || '—')}</span></td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${s.loginAt ? new Date(s.loginAt).toLocaleTimeString() : '—'}</td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${s.lastActivity ? new Date(s.lastActivity).toLocaleTimeString() : '—'}</td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${_escHtml(s.ip || '—')}</td>
                  <td style="padding:5px 6px">
                    ${s.isCurrent ? '' : `<button class="tbl-btn del" onclick="licenseRevokeSession(${idx})" title="Force logout">Revoke</button>`}
                  </td>
                </tr>`)).join('')}
              </tbody>
            </table>`}
      </div>`;
    sessionsEl.style.display = '';
  }

  // P3-11: License Audit Log
  const auditEl = document.getElementById('lic-audit-block');
  if (auditEl && Array.isArray(audit) && audit.length > 0) {
    const ACTION_LABELS = {
      LICENSE_ACTIVATED: '&#9989; Activated',
      LICENSE_DEACTIVATED: '&#128683; Deactivated',
      LICENSE_TRANSFERRED: '&#128260; Transferred',
      LICENSE_EXPIRED: '&#128308; Expired',
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
  const key = (document.getElementById('lic-key-input').value || '').trim();
  const alert = document.getElementById('license-alert');
  if (!key) { alert.innerHTML = '<div class="alert alert-error">Enter a license key</div>'; return; }
  alert.innerHTML = '<div class="alert alert-info">Activating…</div>';
  const res = await fetch('/api/admin/license/activate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
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
  const res = await fetch('/api/admin/license/activate', { method: 'POST', body: form });
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
async function licenseRevokeSession(idx) {
  const s = (window._licSessions || [])[idx];
  if (!s) { alert('Session not found — please refresh and try again.'); return; }
  if (!confirm(`Force-logout ${s.username || 'this user'}? Their current work may be lost.`)) return;
  const res = await fetch(`/api/admin/license/sessions/${encodeURIComponent(s.sessionId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: s.userId }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to revoke session'); return; }
  licenseLoad();
}

// P3-07: Download seat audit report CSV
function licenseExportSeatReport() {
  const a = document.createElement('a');
  a.href = '/api/admin/license/seat-report';
  a.download = `seat-report-${new Date().toISOString().slice(0, 10)}.csv`;
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
  const res = await fetch('/api/admin/license/transfer', { method: 'POST' });
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
      const days = data.trialDaysLeft ?? data.daysLeft;
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
    const tierLabel = upgradeTier === 'team' ? 'Team' : 'Enterprise';
    const feature = body.feature || 'this feature';
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
    const res = await fetch(`/api/analytics?projectId=${encodeURIComponent(currentProjectId)}&days=${days}`);
    if (!res.ok) throw new Error(await res.text());
    _analyticsData = await res.json();
    _analyticsRender(_analyticsData);
  } catch (e) {
    document.getElementById('analytics-loading').style.display = '';
    document.getElementById('analytics-loading').textContent = 'Failed to load analytics.';
  }
}

function _analyticsClear() {
  ['kpi-runs', 'kpi-tests', 'kpi-pass-rate', 'kpi-passed', 'kpi-failed'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = id === 'kpi-pass-rate' ? '—%' : '—';
  });
  const prchart = document.getElementById('analytics-passrate-chart');
  if (prchart) prchart.innerHTML = '';
  ['analytics-fail-tbody', 'analytics-flaky-tbody', 'analytics-suite-tbody'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
}

function _analyticsRender(d) {
  // KPIs
  document.getElementById('kpi-runs').textContent = d.totalRuns;
  document.getElementById('kpi-tests').textContent = d.totalTests;
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
      const pct = row.passRate;
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
      const color = passRate >= 90 ? '#4ec9b0' : passRate >= 70 ? '#f6c543' : '#f48771';
      const avgMs = s.runs > 0 ? Math.round(s.totalMs / s.runs) : 0;
      const avgDur = avgMs < 1000 ? `${avgMs}ms` : avgMs < 60000 ? `${(avgMs / 1000).toFixed(1)}s` : `${Math.floor(avgMs / 60000)}m ${Math.round((avgMs % 60000) / 1000)}s`;
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

// ── Heatmap + AI Analysis helpers (added Task 6) ─────────────────────────────

function vrDrawHeatOverlay(canvas, diffImgUrl) {
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function () {
    var w = img.naturalWidth, h = img.naturalHeight;
    canvas.width = w; canvas.height = h;
    var off = document.createElement('canvas');
    off.width = w; off.height = h;
    var ox = off.getContext('2d');
    ox.drawImage(img, 0, 0);
    var data = ox.getImageData(0, 0, w, h).data;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        if (data[i] > 200 && data[i + 1] < 80 && data[i + 2] < 80) {
          var v = Math.min(1, (data[i] - 200) / 55);
          var g = Math.round(179 - v * 179);
          ctx.fillStyle = 'rgba(239,' + g + ',0,' + (0.45 + v * 0.45).toFixed(2) + ')';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    canvas.classList.add('vr-heat-on');
  };
  img.src = diffImgUrl;
}

function vrAiChipClass(label) {
  var map = {
    'Content Change': 'vrt-chip-content',
    'Layout Shift': 'vrt-chip-layout',
    'Style Drift': 'vrt-chip-style',
    'Element Added': 'vrt-chip-added',
    'Element Removed': 'vrt-chip-removed',
    'Dynamic Data': 'vrt-chip-dynamic',
    'Dimension Change': 'vrt-chip-dimension'
  };
  return map[label] || 'vrt-chip-content';
}

function vrAiRenderPanel(panelEl, data) {
  var chips = (data.classifications || []).map(function (c) {
    return '<span class="vrt-chip ' + vrAiChipClass(c) + '">' + c + '</span>';
  }).join('');
  var recClass = 'vrt-rec-' + (data.recommendation || 'review');
  var recIcon = data.recommendation === 'approve' ? '✓' : data.recommendation === 'flag' ? '✗' : '⚠';
  var recLabel = (data.recommendation || 'review').charAt(0).toUpperCase() + (data.recommendation || 'review').slice(1);
  var html = '<div class="vrt-ai-panel-inner">'
    + (chips ? '<div>' + chips + '</div>' : '')
    + '<div class="vrt-rec ' + recClass + '">' + recIcon + ' ' + recLabel + '</div>'
    + (data.recommendationReason ? '<div class="vrt-rec-reason">' + data.recommendationReason + '</div>' : '')
    + '<hr class="vrt-ai-divider">';
  if (data.stage === 'ai-enhanced') {
    html += '<div class="vrt-ai-narrative">' + (data.narrative || '') + '<div class="vrt-model-tag">Model: ' + (data.model || '') + ' · Confidence: ' + (data.confidence || 0) + '%</div></div>';
  } else {
    html += '<button class="vrt-enhance-btn" onclick="vrAiEnhance(this)">✨ Enhance with AI</button>'
      + '<div class="vrt-ai-narrative" style="display:none"></div>';
  }
  html += '</div>';
  panelEl.innerHTML = html;
}

function vrAiAnalyse(btn) {
  var card = btn.closest('[data-baseline-id]') || btn.closest('.vr-card') || btn.parentElement;
  var baselineId = card.dataset.baselineId || card.getAttribute('data-baseline-id');
  var cached = btn.dataset.cachedResult;
  if (cached) {
    var panel = btn.nextElementSibling;
    panel.classList.toggle('vrt-ai-open');
    return;
  }
  var runCtx = {
    testName: card.dataset.testName || '',
    locatorName: card.dataset.locatorName || '',
    diffPct: parseFloat(card.dataset.diffPct || '0'),
    diffPixels: parseInt(card.dataset.diffPixels || '0'),
    totalPixels: parseInt(card.dataset.totalPixels || '0'),
    baselineWidth: parseInt(card.dataset.baselineWidth || '0'),
    baselineHeight: parseInt(card.dataset.baselineHeight || '0'),
    actualWidth: parseInt(card.dataset.actualWidth || '0'),
    actualHeight: parseInt(card.dataset.actualHeight || '0')
  };
  var panel = btn.nextElementSibling;
  panel.classList.add('vrt-ai-open');
  panel.innerHTML = '<div class="vrt-ai-panel-inner"><span class="vrt-ai-spin"></span> Analysing…</div>';
  fetch('/api/visual-baselines/' + baselineId + '/ai-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enhance: false, runContext: runCtx })
  }).then(function (r) { return r.json(); }).then(function (data) {
    btn.dataset.cachedResult = '1';
    vrAiRenderPanel(panel, data);
  }).catch(function (err) {
    panel.innerHTML = '<div class="vrt-ai-panel-inner"><div class="vrt-ai-error">Analysis failed: ' + err.message + '</div></div>';
  });
}

function vrAiEnhance(enhanceBtn) {
  enhanceBtn.disabled = true;
  enhanceBtn.textContent = '⏳ Enhancing…';
  var card = enhanceBtn.closest('[data-baseline-id]') || enhanceBtn.closest('.vr-card');
  var baselineId = card.dataset.baselineId || card.getAttribute('data-baseline-id');
  var runCtx = {
    testName: card.dataset.testName || '',
    locatorName: card.dataset.locatorName || '',
    diffPct: parseFloat(card.dataset.diffPct || '0'),
    diffPixels: parseInt(card.dataset.diffPixels || '0'),
    totalPixels: parseInt(card.dataset.totalPixels || '0'),
    baselineWidth: parseInt(card.dataset.baselineWidth || '0'),
    baselineHeight: parseInt(card.dataset.baselineHeight || '0'),
    actualWidth: parseInt(card.dataset.actualWidth || '0'),
    actualHeight: parseInt(card.dataset.actualHeight || '0')
  };
  fetch('/api/visual-baselines/' + baselineId + '/ai-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enhance: true, runContext: runCtx })
  }).then(function (r) { return r.json(); }).then(function (data) {
    if (data.error && data.error.match(/No AI provider/i)) {
      enhanceBtn.replaceWith(Object.assign(document.createElement('div'), { className: 'vrt-ai-error', innerHTML: data.error + ' <a href="/admin#settings-ai">Configure AI →</a>' }));
      return;
    }
    var panel = enhanceBtn.closest('.vrt-ai-panel');
    vrAiRenderPanel(panel, data);
  }).catch(function (err) {
    enhanceBtn.replaceWith(Object.assign(document.createElement('div'), { className: 'vrt-ai-error', textContent: err.message }));
  });
}

// ── End Heatmap + AI Analysis helpers ────────────────────────────────────────

let _vrBaselines = [];

// Browser icon SVGs (inline, same as execution-report.html)
const VR_BROWSER_ICONS = {
  chromium: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#4285F4"/><circle cx="12" cy="12" r="4" fill="white"/><path d="M12 8 A4 4 0 0 1 19.46 10 L22 10 A10 10 0 0 0 2.54 10 L8 10 A4 4 0 0 1 12 8Z" fill="#EA4335"/><path d="M8 10 A4 4 0 0 0 12 16 L9 20.93 A10 10 0 0 1 2.54 10Z" fill="#34A853"/><path d="M12 16 A4 4 0 0 0 19.46 14 L22 14 A10 10 0 0 1 9 20.93Z" fill="#FBBC05"/></svg>`,
  firefox:  `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#FF6611"/><circle cx="12" cy="12" r="5" fill="#FFB830"/><circle cx="12" cy="12" r="2.5" fill="#FF6611"/></svg>`,
  webkit:   `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#006EAF"/><circle cx="12" cy="12" r="3" fill="white"/><line x1="12" y1="4" x2="12" y2="20" stroke="white" stroke-width="1.5"/><line x1="4" y1="12" x2="20" y2="12" stroke="white" stroke-width="1.5"/></svg>`,
};

function vrBrowserIcon(browser) {
  return VR_BROWSER_ICONS[(browser || 'chromium').toLowerCase()] || VR_BROWSER_ICONS.chromium;
}

async function vrLoad() {
  const loading = document.getElementById('vr-loading');
  const empty = document.getElementById('vr-empty');
  const grid = document.getElementById('vr-grid');
  const summary = document.getElementById('vr-summary');
  if (!loading || !grid || !empty) return;

  if (!currentProjectId) {
    loading.style.display = 'block';
    loading.textContent = 'Select a project to view visual baselines.';
    empty.style.display = 'none';
    grid.style.display = 'none';
    return;
  }

  loading.style.display = 'block';
  loading.textContent = 'Loading baselines…';
  empty.style.display = 'none';
  grid.style.display = 'none';

  try {
    const res = await fetch(`/api/visual-baselines?projectId=${encodeURIComponent(currentProjectId)}`);
    const data = await res.json();
    _vrBaselines = Array.isArray(data) ? data : (data.baselines || []);
    vrFilter();
  } catch {
    loading.textContent = 'Error loading baselines.';
  }
}

function vrFilter() {
  const search  = (document.getElementById('vr-search')?.value || '').toLowerCase();
  const status  = document.getElementById('vr-status-filter')?.value  || '';
  const browser = document.getElementById('vr-browser-filter')?.value || '';
  const loading = document.getElementById('vr-loading');
  const empty   = document.getElementById('vr-empty');
  const grid    = document.getElementById('vr-grid');
  const summary = document.getElementById('vr-summary');

  let filtered = _vrBaselines.filter(b => {
    const matchText    = !search  || b.testName?.toLowerCase().includes(search) || b.locatorName?.toLowerCase().includes(search);
    const matchStatus  = !status  || b.status === status;
    const bBrowser     = b.browser || '__legacy';
    const matchBrowser = !browser || bBrowser === browser;
    return matchText && matchStatus && matchBrowser;
  });

  const approved  = _vrBaselines.filter(b => b.status === 'approved').length;
  const pending   = _vrBaselines.filter(b => b.status === 'pending-review').length;
  const logicalSet = new Set(_vrBaselines.map(b => `${b.testName}||${b.locatorName}`));
  const browserEntries = _vrBaselines.filter(b => b.browser).length;
  if (summary) {
    summary.innerHTML = `
      <span>Logical baselines: <strong>${logicalSet.size}</strong></span>
      <span style="color:#4ec9b0">Approved: <strong>${approved}</strong></span>
      ${pending   ? `<span style="color:#f48771">Pending: <strong>${pending}</strong></span>` : ''}
      ${browserEntries ? `<span style="color:#818cf8">Browser-scoped: <strong>${browserEntries}</strong></span>` : ''}
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

  // Group by logical key (testName + locatorName)
  const groups = new Map();
  for (const b of filtered) {
    const key = `${b.testName}||${b.locatorName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  grid.innerHTML = Array.from(groups.values()).map(entries => vrGroupedCard(entries)).join('');
  // Init sliders now that HTML is in the DOM
  vrSlidersInit(grid);
  // Show/hide bulk bar based on whether viewer mode
  const bulkBar = document.getElementById('vr-bulk-bar');
  if (bulkBar) bulkBar.style.display = isViewer() ? 'none' : 'flex';
  vrBulkBarUpdate();
}

function vrGroupedCard(entries) {
  const BROWSER_ORDER = { chromium: 0, firefox: 1, webkit: 2 };
  entries.sort((a, b) => {
    const oa = a.browser ? (BROWSER_ORDER[a.browser] ?? 9) : 99;
    const ob = b.browser ? (BROWSER_ORDER[b.browser] ?? 9) : 99;
    return oa - ob;
  });

  const rep = entries[0];
  // Stable unique ID for collapse/expand toggle
  // OLD: slicing to 40 chars caused ID collisions when all cards share the same long testName prefix
  // const groupId = 'vrg-' + btoa(encodeURIComponent(rep.testName + '||' + rep.locatorName)).replace(/[^a-z0-9]/gi, '').slice(0, 40);
  const groupId = 'vrg-' + btoa(encodeURIComponent(rep.projectId + '|' + rep.locatorName)).replace(/[^a-z0-9]/gi, '');
  const allIdsJson = escHtml(JSON.stringify(entries.map(e => e.id)));

  const approvedCount = entries.filter(e => e.status === 'approved').length;
  const pendingCount  = entries.filter(e => e.status === 'pending-review').length;
  const coverageBadge = entries.some(e => e.browser)
    ? `<span style="font-size:10px;background:#ede9fe;color:#4f46e5;padding:2px 7px;border-radius:10px;font-weight:700" title="Browser-scoped baselines">${approvedCount}/${entries.length} ✓</span>`
    : '';
  const ignoreTotal = entries.reduce((s, e) => s + (e.ignoreRegions?.length || 0), 0);
  const browserRows = entries.map(b => vrBrowserRow(b)).join('');
  const pendingBadge = pendingCount
    ? `<span style="font-size:11px;font-weight:700;color:#f48771;background:#f4877122;padding:2px 8px;border-radius:10px">${pendingCount} pending</span>`
    : '';
  const ignoreBadge = ignoreTotal
    ? `<span style="font-size:10px;background:#dcfce7;color:#166534;padding:2px 7px;border-radius:10px;">&#127919; ${ignoreTotal} region${ignoreTotal > 1 ? 's' : ''}</span>`
    : '';
  const browserCountBadge = entries.length > 1
    ? `<span style="font-size:10px;background:#f1f5f9;color:#64748b;padding:2px 7px;border-radius:10px">${entries.length} browser${entries.length > 1 ? 's' : ''}</span>`
    : '';

  return `
    <div class="card" style="padding:0;overflow:hidden;border:1px solid var(--neutral-300)">
      <!-- Group header — click to expand/collapse -->
      <div style="padding:10px 14px;background:var(--neutral-100);border-bottom:1px solid var(--neutral-300);display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none" onclick="vrToggleGroup('${groupId}')">
        ${isViewer() ? '' : `<input type="checkbox" class="vr-bulk-cb" data-ids='${allIdsJson}' onclick="event.stopPropagation();vrBulkBarUpdate()" style="margin:0;cursor:pointer;flex-shrink:0">`}
        <span id="${groupId}-arrow" style="font-size:11px;color:var(--neutral-400);flex-shrink:0">▶</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:700;color:var(--neutral-800);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(rep.testName)}">${escHtml(rep.testName)}</div>
          <div style="font-size:11.5px;color:var(--neutral-500);margin-top:2px">${escHtml(rep.locatorName)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0" onclick="event.stopPropagation()">
          ${browserCountBadge}${coverageBadge}${pendingBadge}${ignoreBadge}
        </div>
      </div>
      <!-- Browser rows — hidden by default, expanded on click -->
      <div id="${groupId}-rows" style="display:none;padding:8px 14px;flex-direction:column;gap:8px">
        ${browserRows}
      </div>
    </div>
  `;
}

function vrToggleGroup(groupId) {
  const rows  = document.getElementById(groupId + '-rows');
  const arrow = document.getElementById(groupId + '-arrow');
  if (!rows) return;
  const opening = rows.style.display === 'none';
  rows.style.display  = opening ? 'flex' : 'none';
  if (arrow) arrow.textContent = opening ? '▼' : '▶';
  // Init any viewers that became visible (defensive — covers lazy-render edge cases)
  if (opening) vrSlidersInit(rows);
}

function vrBulkBarUpdate() {
  const cbs    = Array.from(document.querySelectorAll('.vr-bulk-cb'));
  const checked = cbs.filter(c => c.checked);
  const bar    = document.getElementById('vr-bulk-bar');
  const count  = document.getElementById('vr-bulk-count');
  const selAll = document.getElementById('vr-select-all');
  if (!bar) return;
  const totalIds = checked.flatMap(c => { try { return JSON.parse(c.dataset.ids); } catch { return []; } });
  bar.style.display = cbs.length ? 'flex' : 'none';
  if (count) count.textContent = checked.length ? `${totalIds.length} baseline${totalIds.length > 1 ? 's' : ''} selected` : 'None selected';
  if (selAll) selAll.checked = cbs.length > 0 && checked.length === cbs.length;
}

function vrSelectAll(checked) {
  document.querySelectorAll('.vr-bulk-cb').forEach(cb => { cb.checked = checked; });
  vrBulkBarUpdate();
}

function vrClearSelection() {
  document.querySelectorAll('.vr-bulk-cb').forEach(cb => { cb.checked = false; });
  vrBulkBarUpdate();
}

async function vrBulkDelete() {
  const checked = Array.from(document.querySelectorAll('.vr-bulk-cb:checked'));
  if (!checked.length) return;
  const ids = checked.flatMap(c => { try { return JSON.parse(c.dataset.ids); } catch { return []; } });
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} baseline${ids.length > 1 ? 's' : ''}? The next test run will create fresh baselines for each.`)) return;
  let failed = 0;
  for (const id of ids) {
    try {
      const res = await fetch(`/api/visual-baselines/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!d.ok && !d.success) failed++;
    } catch { failed++; }
  }
  if (failed) alert(`${failed} deletion${failed > 1 ? 's' : ''} failed. Refreshing…`);
  await vrLoad();
}

function vrBrowserRow(b) {
  const statusColor = b.status === 'approved' ? '#4ec9b0' : b.status === 'pending-review' ? '#f48771' : '#858585';
  const statusLabel = b.status === 'approved' ? 'Approved' : b.status === 'pending-review' ? 'Pending' : 'No Baseline';
  const diffPct     = b.diffPct != null && b.diffPct > 0 ? ` · ${b.diffPct}%` : '';
  const browserLabel = b.browser
    ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--neutral-700)">${vrBrowserIcon(b.browser)} ${b.browser.charAt(0).toUpperCase() + b.browser.slice(1)}</span>`
    : `<span style="font-size:11px;color:#94a3b8;font-style:italic">Legacy (no browser)</span>`;
  const imgBase = `/api/visual-baselines/${encodeURIComponent(b.id)}/image`;
  // OLD: const hasDiff = b.diffPct > 0 || b.lastSavedPixels > 0;
  const hasDiff = (b.diffPct != null && b.diffPct > 0) || b.lastSavedPixels > 0;
  const lastRun = b.lastRunAt ? new Date(b.lastRunAt).toLocaleString() : 'Never run';

  return `
    <div style="border:1px solid var(--neutral-200);border-radius:8px;overflow:hidden">
      <div style="padding:6px 10px;background:#fafafa;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--neutral-200)">
        <div style="display:flex;align-items:center;gap:8px">
          ${browserLabel}
          <span style="font-size:11px;color:${statusColor};background:${statusColor}22;padding:1px 7px;border-radius:8px;font-weight:600">${statusLabel}${diffPct}</span>
          ${(b.ignoreRegions?.length) ? `<span style="font-size:10px;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:8px">&#127919; ${b.ignoreRegions.length}</span>` : ''}
        </div>
        <div style="font-size:10.5px;color:var(--neutral-400)">${lastRun}${b.width ? ` · ${b.width}×${b.height}` : ''}</div>
      </div>
      <div style="background:#111">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0">${vrThumb(imgBase + '?type=baseline', 'Baseline')}${vrThumb(imgBase + '?type=actual', 'Actual')}${hasDiff ? vrThumb(imgBase + '?type=diff', b.lastSavedPixels > 0 ? 'Diff (Regions)' : 'Diff') : '<div style="display:flex;align-items:center;justify-content:center;height:70px;color:#555;font-size:10px">No diff</div>'}</div>
      </div>
      <div style="padding:6px 10px;display:flex;gap:6px;flex-wrap:wrap">
        ${(!isViewer() && b.status === 'pending-review') ? `<button class="btn btn-primary btn-sm" onclick="vrApprove('${escHtml(b.id)}')">&#10003; Approve</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="vrViewDiff('${escHtml(b.id)}')">&#128247; View</button>
        ${isViewer() ? '' : `<button class="btn btn-outline btn-sm" style="color:#f48771;border-color:#f48771" onclick="vrDelete('${escHtml(b.id)}', '${escHtml(b.testName)}')">&#128465;</button>`}
        <button class="btn btn-outline btn-sm" onclick="vrtOpenIgnoreEditor('${escHtml(b.id)}')" style="color:#4f46e5;border-color:#4f46e5;font-size:11px">&#127919; Regions${(b.ignoreRegions?.length) ? ` <span style="background:#22c55e;color:#fff;border-radius:8px;padding:0 4px;font-size:9px;margin-left:3px">${b.ignoreRegions.length}</span>` : ''}</button>
      </div>
    </div>
  `;
}

// Backward-compat alias — kept in case of any direct vrCard() calls elsewhere
function vrCard(b) { return vrGroupedCard([b]); }

function vrThumb(src, label) {
  return `
    <div style="position:relative;cursor:pointer" onclick="window.open('${src}','_blank')">
      <img src="${src}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
           style="width:100%;height:100px;object-fit:contain;display:block;background:#1e1e1e">
      <div style="display:none;align-items:center;justify-content:center;height:100px;color:#555;font-size:11px">${label}: none</div>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;text-align:center;padding:2px">${label}</div>
    </div>`;
}

// ── Multi-Mode Viewer Component ──────────────────────────────────────────────
// 4 modes: Slider (B+C hot-zone), Onion Skin, Blink/Flicker, Diff-only.

function vrSliderHtml(baseUrl, actualUrl, diffUrl) {
  if (!baseUrl || !actualUrl) return '';
  const mb = `style="padding:3px 10px;border:none;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.08);color:#94a3b8;transition:all .15s"`;
  const mbOn = `style="padding:3px 10px;border:none;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;background:#334155;color:#f1f5f9"`;
  return `<div class="vr-viewer" data-diff="${diffUrl||''}" style="background:#111;display:block">
    <div style="display:flex;gap:4px;padding:5px 6px;background:#0d0d0d;border-bottom:1px solid #1e1e1e">
      <button class="vr-mb vr-mb-on" data-mode="slider" ${mbOn}>⟺ Slider</button>
      <button class="vr-mb" data-mode="onion"  ${mb}>👁 Onion</button>
      <button class="vr-mb" data-mode="blink"  ${mb}>💡 Blink</button>
      ${diffUrl ? `<button class="vr-mb" data-mode="diff" ${mb}>▣ Diff</button>` : ''}
    </div>
    <div class="vr-m vr-m-slider">
      <div class="vr-sl" style="position:relative;overflow:hidden;cursor:ew-resize;user-select:none">
        <img class="vr-sl-a" src="${actualUrl}"  draggable="false" alt="Actual"   style="display:block;width:100%;object-fit:contain;background:#111">
        <img class="vr-sl-b" src="${baseUrl}"    draggable="false" alt="Baseline" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;clip-path:inset(0 50% 0 0)">
        <div class="vr-sl-d" style="position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);pointer-events:none;background:rgba(255,255,255,.85);transition:background .1s,box-shadow .1s"></div>
        <div class="vr-sl-k" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:#fff;color:#333;box-shadow:0 2px 10px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-size:14px;pointer-events:none;transition:background .15s,box-shadow .15s">⟺</div>
        <div class="vr-sl-t" style="display:none;position:absolute;bottom:calc(50% + 20px);transform:translateX(-50%);background:#fff;border:1px solid #e2e8f0;color:#111;font-size:10px;padding:3px 10px;border-radius:6px;white-space:nowrap;pointer-events:none;font-weight:700;z-index:4;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>
        <span style="position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:space-between;pointer-events:none;padding:0 4px 2px">
          <span style="background:rgba(0,0,0,.35);color:rgba(255,255,255,.45);font-size:8px;padding:0 4px;border-radius:2px;font-weight:600;letter-spacing:.03em">B</span>
          <span style="background:rgba(0,0,0,.35);color:rgba(255,255,255,.45);font-size:8px;padding:0 4px;border-radius:2px;font-weight:600;letter-spacing:.03em">A</span>
        </span>
      </div>
      ${diffUrl ? `<div style="height:4px;background:#0a0a0a;position:relative;overflow:hidden">
        <canvas class="vr-ht-c" height="4" style="display:block;width:100%;height:4px"></canvas>
        <div class="vr-ht-n" style="position:absolute;top:0;bottom:0;width:2px;background:#fff;opacity:.5;transform:translateX(-50%);left:50%;pointer-events:none"></div>
      </div>` : ''}
    </div>
    <div class="vr-m vr-m-onion" style="display:none">
      <div style="position:relative;overflow:hidden">
        <img src="${actualUrl}"  draggable="false" alt="Actual"   style="display:block;width:100%;object-fit:contain;background:#111">
        <img class="vr-onion-bl" src="${baseUrl}" draggable="false" alt="Baseline" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.5">
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:#0d0d0d;border-top:1px solid #1e1e1e">
        <span style="font-size:10px;color:#555;white-space:nowrap">Baseline</span>
        <input type="range" class="vr-onion-r" min="0" max="100" value="50" style="flex:1;accent-color:#059669;height:3px;cursor:pointer">
        <span class="vr-onion-p" style="font-size:10px;color:#6ee7b7;font-weight:700;min-width:28px;text-align:right">50%</span>
      </div>
    </div>
    <div class="vr-m vr-m-blink" style="display:none">
      <div style="position:relative;overflow:hidden">
        <img class="vr-blink-a" src="${actualUrl}"  draggable="false" alt="Actual"   style="display:block;width:100%;object-fit:contain;background:#111">
        <img class="vr-blink-b" src="${baseUrl}"    draggable="false" alt="Baseline" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity 0s">
        <span class="vr-blink-lbl" style="position:absolute;top:6px;left:8px;background:rgba(0,0,0,.72);color:#fff;font-size:10px;padding:2px 7px;border-radius:3px;font-weight:600">Actual</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:#0d0d0d;border-top:1px solid #1e1e1e">
        <button class="vr-blink-btn" style="padding:3px 12px;background:#d9770622;color:#fbbf24;border:1px solid #d9770644;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer">▶ Blink</button>
        <span style="font-size:10px;color:#444">Alternates baseline ↔ actual — eye catches the change</span>
      </div>
    </div>
    ${diffUrl ? `<div class="vr-m vr-m-diff" style="display:none">
      <img src="${diffUrl}" draggable="false" alt="Diff" style="display:block;width:100%;object-fit:contain;background:#111">
    </div>` : ''}
  </div>`;
}

function vrViewerInit(el) {
  if (el.dataset.vrReady) return;
  el.dataset.vrReady = '1';
  const diffUrl = el.dataset.diff || '';
  const mBtns  = el.querySelectorAll('.vr-mb');
  const mPanels= el.querySelectorAll('.vr-m');
  let blinkTimer = null;

  // ── Mode switch ──────────────────────────────────────────────────
  function applyModeStyles(btn, on) {
    if (on) { btn.style.background='#334155'; btn.style.color='#f1f5f9'; }
    else     { btn.style.background='rgba(255,255,255,.08)'; btn.style.color='#94a3b8'; }
  }
  function switchMode(m) {
    if (blinkTimer && m !== 'blink') stopBlink();
    mBtns.forEach(b => applyModeStyles(b, b.dataset.mode === m));
    mPanels.forEach(p => { p.style.display = p.classList.contains('vr-m-' + m) ? '' : 'none'; });
  }
  mBtns.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); switchMode(b.dataset.mode); }));

  // ── Slider (B+C) ─────────────────────────────────────────────────
  const slFrame = el.querySelector('.vr-sl');
  const slBase  = el.querySelector('.vr-sl-b');
  const slDiv   = el.querySelector('.vr-sl-d');
  const slKnob  = el.querySelector('.vr-sl-k');
  const slTip   = el.querySelector('.vr-sl-t');
  const htNeedle= el.querySelector('.vr-ht-n');
  let zones = [], dragging = false;

  function inDiff(p) { return zones.some(z => p >= z.s && p <= z.e); }
  function setSlPos(pct) {
    pct = Math.max(0, Math.min(100, pct));
    slBase.style.clipPath = `inset(0 ${100-pct}% 0 0)`;
    slDiv.style.left = slKnob.style.left = pct + '%';
    if (htNeedle) htNeedle.style.left = pct + '%';
    const hot = inDiff(pct);
    slDiv.style.background   = hot ? '#ef4444' : 'rgba(255,255,255,.85)';
    slDiv.style.boxShadow    = hot ? '0 0 12px 4px rgba(239,68,68,.65)' : '';
    slKnob.style.background  = hot ? '#ef4444' : '#fff';
    slKnob.style.color       = hot ? '#fff' : '#333';
    slKnob.style.boxShadow   = hot ? '0 0 16px 5px rgba(239,68,68,.55)' : '0 2px 10px rgba(0,0,0,.6)';
    slKnob.textContent       = hot ? '⚡' : '⟺';
    if (slTip) {
      slTip.style.left    = pct + '%';
      slTip.style.display = (dragging && zones.length) ? 'block' : 'none';
      slTip.textContent   = hot ? '⚡ Diff here!' : `Baseline · ${Math.round(pct)}%`;
      Object.assign(slTip.style, hot
        ? { background:'#dc2626', borderColor:'#ef4444', color:'#fff' }
        : { background:'#fff', borderColor:'#e2e8f0', color:'#111' });
    }
  }
  function fromE(e) {
    const r  = slFrame.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    return ((cx - r.left) / r.width) * 100;
  }
  function onMove(e) { if (dragging) setSlPos(fromE(e)); }
  function onUp()    { dragging=false; if(slTip) slTip.style.display='none'; document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
  if (slFrame) {
    slFrame.addEventListener('mousedown', e => { dragging=true; setSlPos(fromE(e)); document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp); e.preventDefault(); });
    slFrame.addEventListener('touchstart', e => { dragging=true; setSlPos(fromE(e)); e.preventDefault(); }, {passive:false});
    slFrame.addEventListener('touchmove',  e => { if(dragging) setSlPos(fromE(e)); e.preventDefault(); }, {passive:false});
    slFrame.addEventListener('touchend',   () => { dragging=false; if(slTip) slTip.style.display='none'; });
  }
  setSlPos(50);

  // ── Canvas analysis — pixel-accurate B+C hot-zone ─────────────────
  if (diffUrl) {
    const img = new Image();
    img.onload = () => {
      try {
        const W = img.naturalWidth, H = img.naturalHeight;
        if (!W || !H) return;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, W, H).data;
        const cols = new Float32Array(W);
        for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
          const i=(y*W+x)*4;
          if (px[i]>180 && px[i+1]<80 && px[i+2]<80) cols[x]++;
        }
        const THRESH = Math.max(1, H*0.005);
        const found=[]; let inZ=false, zS=0;
        for (let x=0;x<W;x++) {
          if (!inZ && cols[x]>THRESH) { inZ=true; zS=x; }
          if (inZ && cols[x]<=THRESH) { inZ=false; const pad=W*0.02; found.push({s:Math.max(0,(zS-pad)/W*100),e:Math.min(100,(x+pad)/W*100)}); }
        }
        if (inZ) found.push({s:Math.max(0,(zS-W*0.02)/W*100),e:100});
        if (found.length) { zones=found; drawHeatCols(el,cols,W); }
      } catch(e) { /* canvas blocked — no hot-zone, plain slider still works */ }
    };
    img.src = diffUrl;
  }

  function drawHeatCols(viewer, cols, W) {
    const canvas = viewer.querySelector('.vr-ht-c'); if(!canvas) return;
    canvas.width = Math.round((canvas.offsetWidth||300)*(window.devicePixelRatio||1));
    const ctx=canvas.getContext('2d'), cw=canvas.width;
    let maxV=0; for(let i=0;i<cols.length;i++) if(cols[i]>maxV) maxV=cols[i];
    for(let x=0;x<cw;x++){
      const v=maxV>0?cols[Math.floor((x/cw)*W)]/maxV:0;
      ctx.fillStyle=v>0.01?`rgba(239,68,68,${(0.25+v*0.75).toFixed(2)})`:'#0a0a0a';
      ctx.fillRect(x,0,1,4);
    }
  }

  // ── Onion skin ───────────────────────────────────────────────────
  const onionBl = el.querySelector('.vr-onion-bl');
  const onionR  = el.querySelector('.vr-onion-r');
  const onionP  = el.querySelector('.vr-onion-p');
  if (onionR) onionR.addEventListener('input', function() {
    if (onionBl) onionBl.style.opacity = this.value/100;
    if (onionP)  onionP.textContent = this.value+'%';
  });

  // ── Blink ────────────────────────────────────────────────────────
  const blinkBtn = el.querySelector('.vr-blink-btn');
  const blinkA   = el.querySelector('.vr-blink-a');
  const blinkB   = el.querySelector('.vr-blink-b');
  const blinkLbl = el.querySelector('.vr-blink-lbl');
  let   blinkState = false;

  // use opacity toggle — blinkA stays in flow so container height is stable
  function stopBlink() {
    if (!blinkTimer) return;
    clearInterval(blinkTimer); blinkTimer=null;
    if (blinkBtn) { blinkBtn.textContent='▶ Blink'; blinkBtn.style.background='#d9770622'; blinkBtn.style.color='#fbbf24'; }
    if (blinkA)   blinkA.style.opacity='1';
    if (blinkB)   blinkB.style.opacity='0';
    if (blinkLbl) blinkLbl.textContent='Actual';
    blinkState=false;
  }
  if (blinkBtn) blinkBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (blinkTimer) { stopBlink(); return; }
    blinkBtn.textContent='⏹ Stop'; blinkBtn.style.background='#d97706'; blinkBtn.style.color='#fff';
    blinkTimer=setInterval(()=>{
      blinkState=!blinkState;
      if(blinkA)   blinkA.style.opacity   = blinkState?'0':'1';
      if(blinkB)   blinkB.style.opacity   = blinkState?'1':'0';
      if(blinkLbl) blinkLbl.textContent   = blinkState?'Baseline':'Actual';
    },400);
  });
}

// legacy alias kept so vrViewDiff popup (which still uses vrSliderInit) keeps working
function vrSliderInit(el) {
  const baseline = el.querySelector('.vr-slider-baseline') || el.querySelector('.baseline');
  const divider  = el.querySelector('.vr-slider-divider')  || el.querySelector('.divider');
  const knob     = el.querySelector('.vr-slider-knob')     || el.querySelector('.knob');
  const pctEl    = el.querySelector('.vr-slider-pct');
  if (!baseline || !divider || !knob) return;

  function setPos(pct) {
    pct = Math.max(0, Math.min(100, pct));
    const right = 100 - pct;
    baseline.style.clipPath = `inset(0 ${right}% 0 0)`;
    divider.style.left      = pct + '%';
    knob.style.left         = pct + '%';
    el.setAttribute('aria-valuenow', Math.round(pct));
    if (pctEl) {
      pctEl.style.left    = pct + '%';
      pctEl.textContent   = Math.round(pct) + '%';
    }
  }

  function pctFromEvent(e) {
    const rect = el.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }

  function curPct() {
    const m = baseline.style.clipPath.match(/inset\(0 ([\d.]+)% 0 0\)/);
    return m ? 100 - parseFloat(m[1]) : 50;
  }

  let dragging = false;

  function onMouseMove(e) { if (dragging) setPos(pctFromEvent(e)); }
  function onMouseUp()    { dragging = false; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); }
  function onTouchMove(e) { if (dragging) { setPos(pctFromEvent(e)); e.preventDefault(); } }
  function onTouchEnd()   { dragging = false; document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd); }

  el.addEventListener('mousedown', e => {
    dragging = true;
    setPos(pctFromEvent(e));
    e.preventDefault();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
  el.addEventListener('touchstart', e => {
    dragging = true;
    setPos(pctFromEvent(e));
    e.preventDefault();
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }, { passive: false });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { setPos(curPct() - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setPos(curPct() + 1); e.preventDefault(); }
    if (e.key === 'Home')       { setPos(0);   e.preventDefault(); }
    if (e.key === 'End')        { setPos(100); e.preventDefault(); }
  });
  setPos(50); // initial 50/50 split
}

function vrSlidersInit(container) {
  (container || document).querySelectorAll('.vr-viewer:not([data-vr-ready])').forEach(el => vrViewerInit(el));
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
    if (d.ok || d.success) { await vrLoad(); }
    else alert('Delete failed: ' + (d.error || 'unknown'));
  } catch (e) { alert('Delete failed: ' + e.message); }
}

function vrViewDiff(id) {
  const b = _vrBaselines.find(x => x.id === id);
  if (!b) return;
  const imgBase   = `/api/visual-baselines/${encodeURIComponent(id)}/image`;
  const baseUrl   = imgBase + '?type=baseline';
  const actualUrl = imgBase + '?type=actual';
  const diffUrl   = imgBase + '?type=diff';
  const hasDiff   = b.diffPct > 0 || b.lastSavedPixels > 0;
  const win = window.open('', '_blank');
  // OLD: no null-check — crashes when popup is blocked
  if (!win) { alert('Popup blocked. Please allow popups for this page.'); return; }

  const diffPctStr = b.diffPct != null ? b.diffPct + '% diff' : '';

  win.document.write(`<!DOCTYPE html><html><head>
  <title>Visual Diff — ${escHtml(b.testName)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0d0d0d;font-family:system-ui,sans-serif;color:#ccc;height:100vh;display:flex;flex-direction:column;overflow:hidden}
    .hdr{padding:10px 18px;background:#1a1a1a;border-bottom:1px solid #2a2a2a;display:flex;align-items:center;gap:12px;flex-shrink:0}
    .hdr h2{font-size:14px;color:#fff;font-weight:700}
    .meta{font-size:11px;color:#666}
    .badge{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700}
    .badge-diff{background:#fee2e2;color:#b91c1c}.badge-ok{background:#dcfce7;color:#166534}
    .layout{display:grid;grid-template-columns:2fr 1fr;flex:1;min-height:0;overflow:hidden;gap:0}
    .left-panel{display:flex;flex-direction:column;border-right:1px solid #2a2a2a;overflow:hidden}
    .right-panel{display:flex;flex-direction:column;overflow:hidden}
    .panel-hdr{padding:6px 12px;font-size:11px;font-weight:700;background:#161616;border-bottom:1px solid #222;flex-shrink:0;color:#888;display:flex;align-items:center;gap:8px}
    .panel-body{flex:1;overflow:hidden;position:relative;background:#111}
    /* ── Mode bar ── */
    .vr-mb-bar{display:flex;gap:4px;padding:5px 8px;background:#0d0d0d;border-bottom:1px solid #1e1e1e;flex-shrink:0}
    .vr-mb{padding:4px 12px;border:none;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.07);color:#64748b;transition:all .15s}
    .vr-mb.on{background:#334155;color:#f1f5f9}
    /* ── Slider mode ── */
    .vr-sl{position:relative;overflow:hidden;cursor:ew-resize;user-select:none;width:100%;height:100%}
    .vr-sl-a{display:block;width:100%;height:100%;object-fit:contain;background:#111}
    .vr-sl-b{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;clip-path:inset(0 50% 0 0)}
    .vr-sl-d{position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);pointer-events:none;background:rgba(255,255,255,.85);transition:background .1s,box-shadow .1s}
    .vr-sl-k{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:36px;height:36px;border-radius:50%;background:#fff;color:#333;box-shadow:0 2px 12px rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;font-size:16px;pointer-events:none;transition:background .15s}
    .vr-sl-t{display:none;position:absolute;bottom:calc(50% + 22px);transform:translateX(-50%);background:#fff;border:1px solid #e2e8f0;color:#111;font-size:11px;padding:4px 12px;border-radius:6px;white-space:nowrap;pointer-events:none;font-weight:700;z-index:4;box-shadow:0 2px 8px rgba(0,0,0,.5)}
    .vr-ht-bar{height:4px;background:#0a0a0a;position:relative;overflow:hidden;flex-shrink:0}
    /* ── Onion mode ── */
    .vr-onion{position:relative;overflow:hidden;width:100%;height:100%}
    .vr-onion-a{display:block;width:100%;height:100%;object-fit:contain;background:#111}
    .vr-onion-bl{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.5}
    .vr-onion-bar{display:flex;align-items:center;gap:10px;padding:6px 12px;background:#0d0d0d;border-top:1px solid #1e1e1e;flex-shrink:0}
    /* ── Blink mode ── */
    .vr-blink-wrap{position:relative;overflow:hidden;width:100%;height:100%}
    .vr-blink-a{display:block;width:100%;height:100%;object-fit:contain;background:#111}
    .vr-blink-b{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity 0s}
    .vr-blink-lbl{position:absolute;top:8px;left:10px;background:rgba(0,0,0,.72);color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;font-weight:700}
    .vr-blink-bar{display:flex;align-items:center;gap:10px;padding:6px 12px;background:#0d0d0d;border-top:1px solid #1e1e1e;flex-shrink:0}
    /* ── Diff panel ── */
    .diff-img{width:100%;height:100%;object-fit:contain;background:#111;display:block}
    .no-diff{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:14px}
    .no-diff svg{opacity:.3}.no-diff span{font-size:13px;font-weight:600;color:#4caf50}
    .protect-box{padding:10px 12px;background:#0a1628;border-top:1px solid #1e293b;font-size:11px;flex-shrink:0}
  </style>
  </head><body>
  <div class="hdr">
    <h2>&#128247; Visual Diff</h2>
    <div class="meta">${escHtml(b.testName)} &middot; ${escHtml(b.locatorName)}${diffPctStr ? ' &middot; ' + diffPctStr : ''}</div>
    ${hasDiff ? '<span class="badge badge-diff">&#9889; Diff Detected</span>' : '<span class="badge badge-ok">&#10003; Pixel-Identical</span>'}
  </div>
  <div class="layout"
    data-baseline-id="${escHtml(b.id)}"
    data-test-name="${escHtml(b.testName || '')}"
    data-locator-name="${escHtml(b.locatorName || '')}"
    data-diff-pct="${b.diffPct || 0}"
    data-diff-pixels="${b.diffPixels || 0}"
    data-total-pixels="${b.totalPixels || ((b.baselineWidth || 0) * (b.baselineHeight || 0)) || 0}"
    data-baseline-width="${b.baselineWidth || b.width || 0}"
    data-baseline-height="${b.baselineHeight || b.height || 0}"
    data-actual-width="${b.actualWidth || b.baselineWidth || b.width || 0}"
    data-actual-height="${b.actualHeight || b.baselineHeight || b.height || 0}">
    <!-- Left: multi-mode viewer -->
    <div class="left-panel">
      <div class="vr-mb-bar">
        <button class="vr-mb on" data-mode="slider">&#8660; Slider</button>
        <button class="vr-mb" data-mode="onion">&#128065; Onion</button>
        <button class="vr-mb" data-mode="blink">&#128161; Blink</button>
        <button class="vr-mb" data-mode="heatmap" title="Heatmap overlay">🌡 Heatmap</button>
      </div>
      <!-- Slider mode -->
      <div class="vr-m vr-m-slider" style="display:flex;flex-direction:column;flex:1;min-height:0">
        <div class="panel-body">
          <div class="vr-sl" id="vr-sl">
            <img class="vr-sl-a" src="${actualUrl}"  alt="Actual"   onerror="this.style.opacity='.2'">
            <img class="vr-sl-b" src="${baseUrl}"    alt="Baseline" onerror="this.style.opacity='.2'">
            <canvas class="vr-heat-canvas" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;display:none"></canvas>
            <div class="vr-sl-d" id="vr-sl-d"></div>
            <div class="vr-sl-k" id="vr-sl-k">&#8660;</div>
            <div class="vr-sl-t" id="vr-sl-t"></div>
          </div>
        </div>
        ${hasDiff ? '<div class="vr-ht-bar"><canvas id="vr-ht-c" height="4" style="display:block;width:100%;height:4px"></canvas><div id="vr-ht-n" style="position:absolute;top:0;bottom:0;width:2px;background:#fff;opacity:.5;transform:translateX(-50%);left:50%;pointer-events:none"></div></div>' : ''}
      </div>
      <!-- Onion mode -->
      <div class="vr-m vr-m-onion" style="display:none;flex-direction:column;flex:1;min-height:0">
        <div class="panel-body">
          <div class="vr-onion">
            <img class="vr-onion-a"  src="${actualUrl}"  alt="Actual">
            <img class="vr-onion-bl" src="${baseUrl}"    alt="Baseline">
          </div>
        </div>
        <div class="vr-onion-bar">
          <span style="font-size:11px;color:#555;white-space:nowrap">Baseline opacity</span>
          <input type="range" id="vr-onion-r" min="0" max="100" value="50" style="flex:1;accent-color:#059669;height:3px;cursor:pointer">
          <span id="vr-onion-p" style="font-size:11px;color:#6ee7b7;font-weight:700;min-width:32px;text-align:right">50%</span>
        </div>
      </div>
      <!-- Blink mode -->
      <div class="vr-m vr-m-blink" style="display:none;flex-direction:column;flex:1;min-height:0">
        <div class="panel-body">
          <div class="vr-blink-wrap">
            <img class="vr-blink-a" src="${actualUrl}"  alt="Actual">
            <img class="vr-blink-b" src="${baseUrl}"    alt="Baseline">
            <span class="vr-blink-lbl">Actual</span>
          </div>
        </div>
        <div class="vr-blink-bar">
          <button id="vr-blink-btn" style="padding:4px 14px;background:#d9770622;color:#fbbf24;border:1px solid #d9770644;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer">&#9654; Blink</button>
          <span style="font-size:11px;color:#444">Alternates baseline &harr; actual — eye catches the change</span>
        </div>
      </div>
    </div>
    <!-- Right: diff image -->
    <div class="right-panel">
      <div class="panel-hdr">&#9889; Diff ${diffPctStr ? '&mdash; ' + diffPctStr : '(red = changed pixels)'}</div>
      <div class="panel-body" style="display:flex;flex-direction:column">
        ${hasDiff
          ? `<img class="diff-img" src="${diffUrl}" alt="Diff">`
          : `<div class="no-diff"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg><span>No Differences</span></div>`}
        ${b.lastSavedPixels > 0 ? `<div class="protect-box">
          <div style="font-weight:700;color:#22c55e">&#128737; ${b.totalRunsProtected||1} false positive${(b.totalRunsProtected||1)>1?'s':''} prevented</div>
          <div style="color:#64748b;margin-top:2px">${b.lastSavedPixels.toLocaleString()} pixels neutralised</div>
        </div>` : ''}
        ${hasDiff ? `<div style="padding:8px 12px;border-top:1px solid #1e293b;flex-shrink:0">
          <button class="vrt-ai-btn" onclick="vrAiAnalyse(this)" style="width:100%;padding:6px 10px;background:#1e293b;color:#94a3b8;border:1px solid #334155;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">🤖 AI Analysis</button>
          <div class="vrt-ai-panel" style="margin-top:6px"></div>
        </div>` : ''}
      </div>
    </div>
  </div>
  <\x73cript>
  (function(){
    // ── Mode switching ──
    var mBtns   = document.querySelectorAll('.vr-mb');
    var mPanels = document.querySelectorAll('.vr-m');
    var blinkTimer = null;
    function applyMb(btn, on){ btn.classList.toggle('on', on); }
    var slContainer = document.getElementById('vr-sl');
    var diffUrlForHeat = '${hasDiff ? diffUrl : ''}';
    function switchMode(m){
      if(blinkTimer && m!=='blink') stopBlink();
      mBtns.forEach(function(b){ applyMb(b, b.dataset.mode===m); });
      // Clear heatmap canvas when leaving heatmap mode
      var heatCanvas = slContainer && slContainer.querySelector('.vr-heat-canvas');
      if(heatCanvas && m !== 'heatmap'){
        heatCanvas.classList.remove('vr-heat-on');
        heatCanvas.style.display = 'none';
        var hCtx = heatCanvas.getContext('2d');
        if(hCtx) hCtx.clearRect(0, 0, heatCanvas.width, heatCanvas.height);
      }
      if(m === 'heatmap'){
        mPanels.forEach(function(p){ p.style.display = p.classList.contains('vr-m-slider')?'flex':'none'; });
        if(heatCanvas && diffUrlForHeat){
          heatCanvas.style.display = 'block';
          // inline heatmap draw (mirrors vrDrawHeatOverlay)
          (function(){
            var img2 = new Image();
            img2.crossOrigin = 'anonymous';
            img2.onload = function(){
              var w2 = img2.naturalWidth, h2 = img2.naturalHeight;
              heatCanvas.width = w2; heatCanvas.height = h2;
              var off2 = document.createElement('canvas');
              off2.width = w2; off2.height = h2;
              var ox2 = off2.getContext('2d');
              ox2.drawImage(img2, 0, 0);
              var data2 = ox2.getImageData(0, 0, w2, h2).data;
              var ctx2 = heatCanvas.getContext('2d');
              ctx2.clearRect(0, 0, w2, h2);
              for(var y2=0;y2<h2;y2++){for(var x2=0;x2<w2;x2++){
                var i2=(y2*w2+x2)*4;
                if(data2[i2]>200&&data2[i2+1]<80&&data2[i2+2]<80){
                  var v2=Math.min(1,(data2[i2]-200)/55);
                  var g2=Math.round(179-v2*179);
                  ctx2.fillStyle='rgba(239,'+g2+',0,'+(0.45+v2*0.45).toFixed(2)+')';
                  ctx2.fillRect(x2,y2,1,1);
                }
              }}
            };
            img2.src = diffUrlForHeat;
          })();
        }
        return;
      }
      mPanels.forEach(function(p){ p.style.display = p.classList.contains('vr-m-'+m)?'flex':'none'; });
    }
    mBtns.forEach(function(b){ b.addEventListener('click', function(){ switchMode(b.dataset.mode); }); });

    // ── Slider ──
    var slFrame = document.getElementById('vr-sl');
    var slBase  = slFrame && slFrame.querySelector('.vr-sl-b');
    var slDiv   = document.getElementById('vr-sl-d');
    var slKnob  = document.getElementById('vr-sl-k');
    var slTip   = document.getElementById('vr-sl-t');
    var htNeedle= document.getElementById('vr-ht-n');
    var zones=[], dragging=false;

    function inDiff(p){ return zones.some(function(z){return p>=z.s&&p<=z.e;}); }
    function setSlPos(pct){
      pct=Math.max(0,Math.min(100,pct));
      if(slBase)  slBase.style.clipPath='inset(0 '+(100-pct)+'% 0 0)';
      if(slDiv)   slDiv.style.left=pct+'%';
      if(slKnob)  slKnob.style.left=pct+'%';
      if(htNeedle)htNeedle.style.left=pct+'%';
      var hot=inDiff(pct);
      if(slDiv){  slDiv.style.background=hot?'#ef4444':'rgba(255,255,255,.85)'; slDiv.style.boxShadow=hot?'0 0 12px 4px rgba(239,68,68,.65)':''; }
      if(slKnob){ slKnob.style.background=hot?'#ef4444':'#fff'; slKnob.style.color=hot?'#fff':'#333'; slKnob.textContent=hot?'\\u26a1':'\\u21d4'; }
      if(slTip){
        slTip.style.left=pct+'%';
        slTip.style.display=(dragging&&zones.length)?'block':'none';
        slTip.textContent=hot?'\\u26a1 Diff here!':'Baseline \\xb7 '+Math.round(pct)+'%';
        slTip.style.background=hot?'#dc2626':'#fff';
        slTip.style.borderColor=hot?'#ef4444':'#e2e8f0';
        slTip.style.color=hot?'#fff':'#111';
      }
    }
    function fromE(e){ var r=slFrame.getBoundingClientRect(),cx=e.touches?e.touches[0].clientX:e.clientX; return((cx-r.left)/r.width)*100; }
    function onMove(e){ if(dragging)setSlPos(fromE(e)); }
    function onUp(){ dragging=false; if(slTip)slTip.style.display='none'; document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
    if(slFrame){
      slFrame.addEventListener('mousedown',function(e){dragging=true;setSlPos(fromE(e));document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);e.preventDefault();});
      slFrame.addEventListener('touchstart',function(e){dragging=true;setSlPos(fromE(e));e.preventDefault();},{passive:false});
      slFrame.addEventListener('touchmove',function(e){if(dragging)setSlPos(fromE(e));e.preventDefault();},{passive:false});
      slFrame.addEventListener('touchend',function(){dragging=false;if(slTip)slTip.style.display='none';});
    }
    setSlPos(50);

    // B+C hot-zone analysis
    if('${hasDiff ? diffUrl : ''}'){
      var di=new Image();
      di.onload=function(){
        try{
          var W=di.naturalWidth,H=di.naturalHeight; if(!W||!H)return;
          var cv=document.createElement('canvas'); cv.width=W; cv.height=H;
          var ctx=cv.getContext('2d'); ctx.drawImage(di,0,0);
          var px=ctx.getImageData(0,0,W,H).data, cols=new Float32Array(W);
          for(var y=0;y<H;y++) for(var x=0;x<W;x++){var i=(y*W+x)*4; if(px[i]>180&&px[i+1]<80&&px[i+2]<80)cols[x]++;}
          var THRESH=Math.max(1,H*0.005),found=[],inZ=false,zS=0;
          for(var x=0;x<W;x++){
            if(!inZ&&cols[x]>THRESH){inZ=true;zS=x;}
            if(inZ&&cols[x]<=THRESH){inZ=false;var pad=W*0.02;found.push({s:Math.max(0,(zS-pad)/W*100),e:Math.min(100,(x+pad)/W*100)});}
          }
          if(inZ)found.push({s:Math.max(0,(zS-W*0.02)/W*100),e:100});
          if(found.length){
            zones=found;
            var canvas=document.getElementById('vr-ht-c'); if(!canvas)return;
            canvas.width=Math.round((canvas.offsetWidth||600)*(window.devicePixelRatio||1));
            var ctx2=canvas.getContext('2d'),cw=canvas.width,maxV=0;
            for(var i=0;i<cols.length;i++)if(cols[i]>maxV)maxV=cols[i];
            for(var x=0;x<cw;x++){var v=maxV>0?cols[Math.floor((x/cw)*W)]/maxV:0;ctx2.fillStyle=v>0.01?'rgba(239,68,68,'+(0.25+v*0.75).toFixed(2)+')':'#0a0a0a';ctx2.fillRect(x,0,1,4);}
          }
        }catch(e){}
      };
      di.src='${hasDiff ? diffUrl : ''}';
    }

    // ── Onion ──
    var onionBl=document.querySelector('.vr-onion-bl');
    var onionR=document.getElementById('vr-onion-r');
    var onionP=document.getElementById('vr-onion-p');
    if(onionR) onionR.addEventListener('input',function(){ if(onionBl)onionBl.style.opacity=this.value/100; if(onionP)onionP.textContent=this.value+'%'; });

    // ── Blink ──
    var blinkBtn=document.getElementById('vr-blink-btn');
    var blinkA=document.querySelector('.vr-blink-a');
    var blinkB=document.querySelector('.vr-blink-b');
    var blinkLbl=document.querySelector('.vr-blink-lbl');
    var blinkState=false;
    function stopBlink(){
      if(!blinkTimer)return;
      clearInterval(blinkTimer); blinkTimer=null;
      if(blinkBtn){blinkBtn.textContent='\\u25b6 Blink';blinkBtn.style.background='#d9770622';blinkBtn.style.color='#fbbf24';}
      if(blinkA)blinkA.style.opacity='1';
      if(blinkB)blinkB.style.opacity='0';
      if(blinkLbl)blinkLbl.textContent='Actual';
      blinkState=false;
    }
    if(blinkBtn) blinkBtn.addEventListener('click',function(){
      if(blinkTimer){stopBlink();return;}
      blinkBtn.textContent='\\u23f9 Stop'; blinkBtn.style.background='#d97706'; blinkBtn.style.color='#fff';
      blinkTimer=setInterval(function(){
        blinkState=!blinkState;
        if(blinkA)blinkA.style.opacity=blinkState?'0':'1';
        if(blinkB)blinkB.style.opacity=blinkState?'1':'0';
        if(blinkLbl)blinkLbl.textContent=blinkState?'Baseline':'Actual';
      },400);
    });
  })();
  </\x73cript>
  </body></html>`);
  win.document.close();
}

// ── Ignore Region Editor ────────────────────────────────────────────────────

const VRT_IGNORE_CATEGORIES = [
  { value: 'dynamic-data',  label: 'Dynamic Data',  color: '#22c55e', desc: 'Live counters, metrics, prices' },
  { value: 'temporal',      label: 'Timestamp',     color: '#3b82f6', desc: 'Clock, "2 mins ago", dates' },
  { value: 'advertisement', label: 'Advertisement', color: '#eab308', desc: 'Rotating banners, promo slots' },
  { value: 'user-specific', label: 'User Content',  color: '#a855f7', desc: 'Avatars, user names, role badges' },
  { value: 'animated',      label: 'Animated',      color: '#f97316', desc: 'Spinners, carousels, transitions' },
  { value: 'third-party',   label: 'Third Party',   color: '#94a3b8', desc: 'Chat widgets, maps, social feeds' },
];

let _vrtIgnoreBaselineId  = null;
let _vrtIgnoreRegions     = [];
let _vrtIgnoreDraw        = null;
let _vrtIgnoreScale       = 1;
let _vrtIgnorePending     = null;
let _vrtIgnoreEditId      = null;   // regionId being edited (null = new)
let _vrtIgnoreSelCategory = 'dynamic-data'; // currently selected category value

function vrtEnsureIgnoreModal() {
  if (document.getElementById('vrt-ignore-modal')) return;
  // Build category picker rows with color dot + label (native <select> can't show colored dots)
  const catPickerOptions = VRT_IGNORE_CATEGORIES.map(c =>
    `<div class="vrt-cat-opt" data-value="${c.value}" onclick="vrtSelectCategory('${c.value}')"
       style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-radius:5px;font-size:12px;color:#cbd5e1;">
      <span style="width:10px;height:10px;min-width:10px;border-radius:50%;background:${c.color};display:inline-block;"></span>
      <span style="font-weight:600;color:#e2e8f0;">${c.label}</span>
      <span style="color:#64748b;font-size:11px;">— ${c.desc}</span>
    </div>`
  ).join('');

  document.body.insertAdjacentHTML('beforeend', `
    <div id="vrt-ignore-modal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);flex-direction:column;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:#1e293b;color:#fff;flex-shrink:0;">
        <div>
          <span style="font-weight:700;font-size:15px;">&#127919; Ignore Regions Editor</span>
          <span id="vrt-ignore-modal-subtitle" style="font-size:12px;color:#94a3b8;margin-left:12px;"></span>
        </div>
        <button onclick="vrtCloseIgnoreEditor()" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">&#10005;</button>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;gap:0;">
        <div style="flex:1;overflow:auto;padding:20px;display:flex;align-items:flex-start;justify-content:center;background:#0f172a;">
          <div style="position:relative;display:inline-block;user-select:none;" id="vrt-ignore-img-wrap">
            <img id="vrt-ignore-img" style="display:block;max-width:100%;border:1px solid #334155;" />
            <canvas id="vrt-ignore-canvas" style="position:absolute;top:0;left:0;cursor:crosshair;"></canvas>
            <div id="vrt-draw-hint" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,229,255,0.9);color:#0f172a;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:700;pointer-events:none;opacity:0;transition:opacity 0.3s;white-space:nowrap;">
              &#8592; Draw a rectangle on the image
            </div>
          </div>
        </div>
        <div style="width:360px;min-width:360px;background:#1e293b;display:flex;flex-direction:column;border-left:1px solid #334155;">
          <div style="padding:10px 16px;border-bottom:1px solid #334155;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Ignore Regions <span id="vrt-ignore-count" style="color:#64748b;font-weight:400;"></span></span>
            <button onclick="vrtPromptNewRegion()" style="padding:4px 10px;background:#4f46e5;color:#fff;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;">+ Add Region</button>
          </div>
          <div id="vrt-ignore-region-list" style="flex:1;overflow-y:auto;padding:8px 0;"></div>
          <div id="vrt-ignore-add-form" style="display:none;padding:14px 16px;border-top:1px solid #334155;background:#0f172a;">
            <div id="vrt-ignore-form-title" style="font-size:12px;font-weight:700;color:#94a3b8;margin-bottom:10px;text-transform:uppercase;">New Region</div>
            <input id="vrt-ignore-name" placeholder="Name (e.g. Live Clock)" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;margin-bottom:8px;" />
            <!-- Custom category picker with color dots -->
            <div style="position:relative;margin-bottom:8px;">
              <div id="vrt-cat-trigger" onclick="vrtToggleCatDropdown()"
                style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;cursor:pointer;">
                <span id="vrt-cat-dot" style="width:10px;height:10px;min-width:10px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
                <span id="vrt-cat-label">Dynamic Data — Live counters, metrics, prices</span>
                <span style="margin-left:auto;color:#64748b;">&#9660;</span>
              </div>
              <div id="vrt-cat-dropdown" style="display:none;position:absolute;bottom:100%;left:0;right:0;background:#0f172a;border:1px solid #334155;border-radius:6px;z-index:100;padding:4px;max-height:220px;overflow-y:auto;">
                ${catPickerOptions}
              </div>
            </div>
            <input id="vrt-ignore-selector" placeholder="CSS selector (optional, e.g. #live-clock)" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;margin-bottom:8px;" />
            <input id="vrt-ignore-reason" placeholder="Reason (optional)" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;margin-bottom:10px;" />
            <div style="display:flex;gap:8px;">
              <button id="vrt-ignore-save-btn" onclick="vrtSaveIgnoreRegion()" style="flex:1;padding:8px;background:#4f46e5;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Save Region</button>
              <button onclick="vrtCancelIgnoreDraw()" style="padding:8px 12px;background:#334155;color:#94a3b8;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>
            </div>
          </div>
          <div id="vrt-ignore-savings" style="padding:12px 16px;border-top:1px solid #334155;font-size:11px;color:#64748b;display:none;">
            <span id="vrt-ignore-savings-text"></span>
          </div>
        </div>
      </div>
    </div>
  `);
}

async function vrtOpenIgnoreEditor(baselineId) {
  vrtEnsureIgnoreModal();
  _vrtIgnoreBaselineId = baselineId;
  const [regions] = await Promise.all([
    fetch(`/api/visual-baselines/${encodeURIComponent(baselineId)}/ignore-regions`).then(r => r.json()),
  ]);
  _vrtIgnoreRegions = regions;
  const entry = _vrBaselines.find(b => b.id === baselineId);
  document.getElementById('vrt-ignore-modal-subtitle').textContent =
    entry ? `${entry.testName} · ${entry.locatorName}` : baselineId;
  document.getElementById('vrt-ignore-modal').style.display = 'flex';
  document.getElementById('vrt-ignore-add-form').style.display = 'none';
  const img = document.getElementById('vrt-ignore-img');
  img.onload = () => vrtIgnoreInitCanvas(img);
  img.src = `/api/visual-baselines/${encodeURIComponent(baselineId)}/image?type=baseline&_=${Date.now()}`;
  vrtRenderIgnoreRegionList();
  vrtUpdateIgnoreSavings(entry);
}

function vrtIgnoreInitCanvas(img) {
  const canvas = document.getElementById('vrt-ignore-canvas');
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.style.width  = img.offsetWidth  + 'px';
  canvas.style.height = img.offsetHeight + 'px';
  _vrtIgnoreScale = img.naturalWidth / img.offsetWidth;
  const wrap = document.getElementById('vrt-ignore-img-wrap');
  wrap.style.width  = img.offsetWidth  + 'px';
  wrap.style.height = img.offsetHeight + 'px';
  canvas.onmousedown = vrtIgnoreMouseDown;
  canvas.onmousemove = vrtIgnoreMouseMove;
  canvas.onmouseup   = vrtIgnoreMouseUp;
  vrtIgnoreRedrawCanvas();
}

function vrtIgnoreCanvasPos(e) {
  const canvas = document.getElementById('vrt-ignore-canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - rect.left) * _vrtIgnoreScale),
    y: Math.round((e.clientY - rect.top)  * _vrtIgnoreScale),
  };
}

function vrtIgnoreMouseDown(e) {
  const pos = vrtIgnoreCanvasPos(e);
  _vrtIgnoreDraw = { startX: pos.x, startY: pos.y, currentX: pos.x, currentY: pos.y };
}

function vrtIgnoreMouseMove(e) {
  if (!_vrtIgnoreDraw) return;
  const pos = vrtIgnoreCanvasPos(e);
  _vrtIgnoreDraw.currentX = pos.x;
  _vrtIgnoreDraw.currentY = pos.y;
  vrtIgnoreRedrawCanvas();
}

function vrtIgnoreMouseUp(e) {
  if (!_vrtIgnoreDraw) return;
  const pos = vrtIgnoreCanvasPos(e);
  const x = Math.min(_vrtIgnoreDraw.startX, pos.x);
  const y = Math.min(_vrtIgnoreDraw.startY, pos.y);
  const w = Math.abs(pos.x - _vrtIgnoreDraw.startX);
  const h = Math.abs(pos.y - _vrtIgnoreDraw.startY);
  _vrtIgnoreDraw = null;
  if (w < 10 || h < 10) { vrtIgnoreRedrawCanvas(); return; }
  _vrtIgnorePending = { x, y, width: w, height: h };
  _vrtIgnoreEditId  = null;
  document.getElementById('vrt-ignore-form-title').textContent = 'New Region';
  document.getElementById('vrt-ignore-save-btn').textContent   = 'Save Region';
  document.getElementById('vrt-ignore-add-form').style.display = 'block';
  document.getElementById('vrt-ignore-name').focus();
  vrtIgnoreRedrawCanvas();
}

function vrtIgnoreRedrawCanvas() {
  const canvas = document.getElementById('vrt-ignore-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const region of _vrtIgnoreRegions) {
    const cat   = VRT_IGNORE_CATEGORIES.find(c => c.value === region.category);
    const color = cat ? cat.color : '#94a3b8';
    vrtIgnoreDrawRegionOnCanvas(ctx, region.x, region.y, region.width, region.height, color, region.name);
  }
  if (_vrtIgnorePending) {
    vrtIgnoreDrawRegionOnCanvas(ctx, _vrtIgnorePending.x, _vrtIgnorePending.y, _vrtIgnorePending.width, _vrtIgnorePending.height, '#ffffff', '...');
  }
  if (_vrtIgnoreDraw) {
    const x = Math.min(_vrtIgnoreDraw.startX, _vrtIgnoreDraw.currentX);
    const y = Math.min(_vrtIgnoreDraw.startY, _vrtIgnoreDraw.currentY);
    const w = Math.abs(_vrtIgnoreDraw.currentX - _vrtIgnoreDraw.startX);
    const h = Math.abs(_vrtIgnoreDraw.currentY - _vrtIgnoreDraw.startY);
    ctx.save();
    // Bright cyan outline — highly visible on both light and dark backgrounds
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(x, y, w, h);
    // Semi-transparent cyan fill so user can see what's being selected
    ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
    ctx.fillRect(x, y, w, h);
    // Corner size indicator
    if (w > 40 && h > 20) {
      ctx.setLineDash([]);
      ctx.font = 'bold 11px system-ui';
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(`${Math.round(w)}×${Math.round(h)}`, x + 4, y + h - 4);
    }
    ctx.restore();
  }
}

function vrtIgnoreDrawRegionOnCanvas(ctx, x, y, w, h, color, label) {
  ctx.save();
  const HATCH_STEP = 10;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  for (let i = -h; i < w + h; i += HATCH_STEP) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
  if (label) {
    ctx.save();
    ctx.font = 'bold 11px system-ui';
    const textW = ctx.measureText(label).width;
    const pillW = textW + 10;
    const pillH = 18;
    const pillX = x + 4;
    const pillY = y + 4;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, 4);
    else ctx.rect(pillX, pillY, pillW, pillH);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.fillText(label, pillX + 5, pillY + 13);
    ctx.restore();
  }
}

// ── Category dropdown helpers ──────────────────────────────────────────────
function vrtToggleCatDropdown() {
  const dd = document.getElementById('vrt-cat-dropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function vrtSelectCategory(value) {
  _vrtIgnoreSelCategory = value;
  const cat = VRT_IGNORE_CATEGORIES.find(c => c.value === value);
  if (!cat) return;
  const dot   = document.getElementById('vrt-cat-dot');
  const label = document.getElementById('vrt-cat-label');
  if (dot)   dot.style.background = cat.color;
  if (label) label.textContent = `${cat.label} — ${cat.desc}`;
  // Highlight selected row
  document.querySelectorAll('.vrt-cat-opt').forEach(el => {
    el.style.background = el.dataset.value === value ? '#1e3a5f' : 'transparent';
  });
  const dd = document.getElementById('vrt-cat-dropdown');
  if (dd) dd.style.display = 'none';
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const trigger = document.getElementById('vrt-cat-trigger');
  const dd      = document.getElementById('vrt-cat-dropdown');
  if (dd && trigger && !trigger.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

async function vrtSaveIgnoreRegion() {
  const name     = document.getElementById('vrt-ignore-name').value.trim();
  const category = _vrtIgnoreSelCategory;
  const selector = document.getElementById('vrt-ignore-selector').value.trim();
  const reason   = document.getElementById('vrt-ignore-reason').value.trim();
  if (!name) { alert('Please enter a name for this region.'); return; }

  const isEdit = !!_vrtIgnoreEditId;

  if (isEdit) {
    // PUT — update existing region (can edit any field including selector/reason)
    const res = await fetch(`/api/visual-baselines/${encodeURIComponent(_vrtIgnoreBaselineId)}/ignore-regions/${_vrtIgnoreEditId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, ...(selector ? { selector } : {}), ...(reason ? { reason } : {}) }),
    });
    if (!res.ok) { alert('Failed to update region'); return; }
    const updated = await res.json();
    const idx = _vrtIgnoreRegions.findIndex(r => r.id === _vrtIgnoreEditId);
    if (idx >= 0) _vrtIgnoreRegions[idx] = updated;
    _vrtIgnoreEditId = null;
  } else {
    // POST — create new region
    if (!_vrtIgnorePending) return;
    const body = { name, category, ...(selector ? { selector } : {}), ...(reason ? { reason } : {}), ..._vrtIgnorePending };
    const res  = await fetch(`/api/visual-baselines/${encodeURIComponent(_vrtIgnoreBaselineId)}/ignore-regions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { alert('Failed to save region'); return; }
    const saved = await res.json();
    _vrtIgnoreRegions.push(saved);
    _vrtIgnorePending = null;
  }

  document.getElementById('vrt-ignore-name').value     = '';
  document.getElementById('vrt-ignore-selector').value = '';
  document.getElementById('vrt-ignore-reason').value   = '';
  document.getElementById('vrt-ignore-add-form').style.display = 'none';
  vrtSelectCategory('dynamic-data');
  vrtRenderIgnoreRegionList();
  vrtIgnoreRedrawCanvas();
  vrLoad();
}

function vrtCancelIgnoreDraw() {
  _vrtIgnorePending = null;
  _vrtIgnoreEditId  = null;
  document.getElementById('vrt-ignore-add-form').style.display = 'none';
  vrtIgnoreRedrawCanvas();
}

function vrtPromptNewRegion() {
  // Close any open form, reset state, show instruction hint on canvas
  _vrtIgnorePending = null;
  _vrtIgnoreEditId  = null;
  document.getElementById('vrt-ignore-add-form').style.display = 'none';
  // Flash a hint overlay on the canvas area
  const hint = document.getElementById('vrt-draw-hint');
  if (hint) { hint.style.opacity = '1'; setTimeout(() => { hint.style.opacity = '0'; }, 2000); }
}

function vrtEditIgnoreRegion(regionId) {
  const region = _vrtIgnoreRegions.find(r => r.id === regionId);
  if (!region) return;
  _vrtIgnoreEditId  = regionId;
  _vrtIgnorePending = null; // not drawing a new rect — editing existing
  // Pre-fill form
  document.getElementById('vrt-ignore-name').value     = region.name;
  document.getElementById('vrt-ignore-selector').value = region.selector || '';
  document.getElementById('vrt-ignore-reason').value   = region.reason   || '';
  vrtSelectCategory(region.category);
  document.getElementById('vrt-ignore-form-title').textContent = 'Edit Region';
  document.getElementById('vrt-ignore-save-btn').textContent   = 'Update Region';
  document.getElementById('vrt-ignore-add-form').style.display = 'block';
  document.getElementById('vrt-ignore-name').focus();
}

function vrtCloseIgnoreEditor() {
  document.getElementById('vrt-ignore-modal').style.display = 'none';
  _vrtIgnoreBaselineId = null;
  _vrtIgnoreRegions    = [];
}

async function vrtDeleteIgnoreRegion(regionId) {
  if (!confirm('Delete this ignore region?')) return;
  await fetch(`/api/visual-baselines/${encodeURIComponent(_vrtIgnoreBaselineId)}/ignore-regions/${regionId}`, { method: 'DELETE' });
  _vrtIgnoreRegions = _vrtIgnoreRegions.filter(r => r.id !== regionId);
  vrtRenderIgnoreRegionList();
  vrtIgnoreRedrawCanvas();
  vrLoad();
}

function vrtRenderIgnoreRegionList() {
  const list  = document.getElementById('vrt-ignore-region-list');
  const count = document.getElementById('vrt-ignore-count');
  count.textContent = `(${_vrtIgnoreRegions.length})`;
  if (!_vrtIgnoreRegions.length) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:#475569;font-size:13px;">
      No ignore regions defined.<br><span style="font-size:11px;color:#334155;">Draw a rectangle on the image to add one.</span>
    </div>`;
    return;
  }
  list.innerHTML = _vrtIgnoreRegions.map(r => {
    const cat   = VRT_IGNORE_CATEGORIES.find(c => c.value === r.category);
    const color = cat ? cat.color : '#94a3b8';
    const label = cat ? cat.label : r.category;
    return `<div style="padding:10px 14px;border-bottom:1px solid #1e293b;display:flex;align-items:flex-start;gap:10px;">
      <div style="width:12px;height:12px;min-width:12px;border-radius:2px;background:${color};margin-top:3px;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.name)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">${label} · ${r.width}×${r.height}px @ (${r.x},${r.y})</div>
        ${r.selector ? `<div style="font-size:10px;color:#4f46e5;margin-top:2px;font-family:monospace;">${escHtml(r.selector)}</div>` : ''}
        ${r.reason   ? `<div style="font-size:10px;color:#475569;margin-top:2px;">${escHtml(r.reason)}</div>` : ''}
      </div>
      <button onclick="vrtEditIgnoreRegion('${r.id}')" style="background:none;border:none;color:#4f46e5;cursor:pointer;font-size:13px;padding:0 4px;" title="Edit">&#9998;</button>
      <button onclick="vrtDeleteIgnoreRegion('${r.id}')" style="background:none;border:none;color:#475569;cursor:pointer;font-size:14px;padding:0 4px;" title="Delete">&#128465;</button>
    </div>`;
  }).join('');
}

function vrtUpdateIgnoreSavings(entry) {
  const el = document.getElementById('vrt-ignore-savings');
  if (!el) return;
  if (entry && entry.ignoreRegions && entry.ignoreRegions.length > 0 && entry.diffPct != null) {
    el.style.display = 'block';
    document.getElementById('vrt-ignore-savings-text').textContent =
      `Last run: ${entry.diffPct}% diff detected. ${entry.ignoreRegions.length} region(s) active.`;
  } else {
    el.style.display = 'none';
  }
}

// ── Locator Health ────────────────────────────────────────────────────────────

async function locatorHealthLoad() {
  const pid = currentProjectId;
  if (!pid) return;
  try {
    const res = await fetch(`/api/locator-health?projectId=${encodeURIComponent(pid)}`);
    const data = await res.json();
    locatorHealthRender(data);
  } catch (e) {
    document.getElementById('locator-health-empty').style.display = '';
    document.getElementById('locator-health-empty').textContent = 'Failed to load: ' + e.message;
    document.getElementById('locator-health-table').style.display = 'none';
    document.getElementById('locator-health-summary').innerHTML = '';
  }
}

function locatorHealthRender(rows) {
  const summary = document.getElementById('locator-health-summary');
  const empty = document.getElementById('locator-health-empty');
  const table = document.getElementById('locator-health-table');
  const tbody = document.getElementById('locator-health-tbody');

  empty.style.display = 'none';
  table.style.display = '';

  if (!rows || rows.length === 0) {
    summary.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:20px">No healing events recorded for this project</td></tr>';
    return;
  }

  const totalHeals = rows.reduce((s, r) => s + r.healCount, 0);
  const autoCount = rows.filter(r => r.lastHealedBy === 'auto').length;
  const avgConf = rows.filter(r => r.avgConfidence != null).length
    ? Math.round(rows.filter(r => r.avgConfidence != null).reduce((s, r) => s + r.avgConfidence, 0) / rows.filter(r => r.avgConfidence != null).length)
    : '—';

  summary.innerHTML = `
    <div class="stat-card"><div class="stat-value">${rows.length}</div><div class="stat-label">Healed Locators</div></div>
    <div class="stat-card"><div class="stat-value">${totalHeals}</div><div class="stat-label">Total Heal Events</div></div>
    <div class="stat-card"><div class="stat-value">${autoCount}</div><div class="stat-label">Auto-Healed</div></div>
    <div class="stat-card"><div class="stat-value">${avgConf}%</div><div class="stat-label">Avg Confidence</div></div>
  `;

  tbody.innerHTML = rows.map(r => {
    const latest = r.recentEvents && r.recentEvents[0];
    const oldSel = latest?.oldSelector ? escHtml(latest.oldSelector.slice(0, 40)) + (latest.oldSelector.length > 40 ? '…' : '') : '—';
    const newSel = latest?.newSelector ? escHtml(latest.newSelector.slice(0, 40)) + (latest.newSelector.length > 40 ? '…' : '') : '—';
    const badge = r.lastHealedBy === 'auto'
      ? '<span class="badge badge-success">auto</span>'
      : r.lastHealedBy
        ? `<span class="badge badge-info">${escHtml(r.lastHealedBy)}</span>`
        : '—';
    const conf = r.avgConfidence != null ? `<span class="${r.avgConfidence >= 75 ? 'text-success' : 'text-warning'}">${r.avgConfidence}%</span>` : '—';
    const date = r.lastHealedAt ? new Date(r.lastHealedAt).toLocaleDateString() : '—';
    return `<tr>
      <td>${escHtml(r.name)}</td>
      <td><code style="font-size:11px">${escHtml((r.selector || '').slice(0, 50))}</code></td>
      <td style="text-align:center"><strong>${r.healCount}</strong></td>
      <td style="text-align:center">${conf}</td>
      <td>${date}</td>
      <td>${badge}</td>
      <td style="font-size:11px"><span style="color:var(--text-muted)">${oldSel}</span> → ${newSel}</td>
    </tr>`;
  }).join('');
}

// ── Jira Integration admin panel ─────────────────────────────────────

async function jiraConfigLoad() {
  try {
    const r = await fetch('/api/jira/config');
    const cfg = await r.json();
    if (!cfg) {
      document.getElementById('jira-status-badge').textContent = 'Not configured';
      return;
    }
    // OLD: document.getElementById('jira-project-key').value = cfg.projectKey || '';
    // projectKey is now per-project (Admin → Project Management → Jira Project Key)
    document.getElementById('jira-issue-type').value = cfg.issueType || 'Defect';
    document.getElementById('jira-default-priority').value = cfg.defaultPriority || 'Medium';
    document.getElementById('jira-close-transition').value = cfg.closeTransitionName || 'Closed';
    document.getElementById('jira-max-attach-mb').value = cfg.maxAttachmentMB || 50;
    const baseUrlEl = document.getElementById('jira-base-url');
    if (baseUrlEl) baseUrlEl.value = cfg.baseUrl || '';
    const emailEl = document.getElementById('jira-creds-email');
    if (emailEl) emailEl.value = cfg.email || '';
    const tokenEl = document.getElementById('jira-creds-token');
    if (tokenEl) tokenEl.placeholder = cfg.hasTokenSet ? '(token set — leave blank to keep)' : 'Paste API token';
    if (cfg.parentLinkFieldId) {
      const sel = document.getElementById('jira-parent-field');
      sel.innerHTML = `<option value="${cfg.parentLinkFieldId}">${cfg.parentLinkFieldId} (saved)</option>`;
    }
    if (cfg.referSSFieldId) {
      const sel = document.getElementById('jira-refer-ss-field');
      sel.innerHTML = `<option value="${cfg.referSSFieldId}">${cfg.referSSFieldId} (saved)</option>`;
    }
    document.getElementById('jira-status-badge').textContent = '✓ Configured';
  } catch (e) {
    document.getElementById('jira-status-badge').textContent = 'Load failed';
  }
}

async function jiraTestConnection() {
  const msg = document.getElementById('jira-config-msg');
  msg.textContent = '⏳ Testing...'; msg.style.color = '';
  const r = await fetch('/api/jira/test', { method: 'POST' });
  const j = await r.json();
  if (j.ok) { msg.style.color = '#16a34a'; msg.textContent = `✓ Connected as ${j.user || 'unknown'}`; }
  else { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j.error || j?.error?.message || 'Connection failed'}`; }
}

async function jiraDiscoverFields() {
  const msg = document.getElementById('jira-config-msg');
  msg.textContent = '⏳ Discovering...'; msg.style.color = '';
  const r = await fetch('/api/jira/fields');
  const j = await r.json();
  if (!r.ok) { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j?.error?.message || 'Discovery failed'}`; return; }
  const fields = (j.fields || []).filter(f => f.custom);
  const opts = fields.map(f => `<option value="${f.id}">${f.name} (${f.id})</option>`).join('');
  document.getElementById('jira-parent-field').innerHTML = '<option value="">— pick parent field —</option>' + opts;
  document.getElementById('jira-refer-ss-field').innerHTML = '<option value="">— none —</option>' + opts;
  msg.style.color = '#16a34a'; msg.textContent = `✓ ${fields.length} custom fields loaded`;
}

async function jiraConfigSave() {
  const body = {
    // OLD: projectKey: document.getElementById('jira-project-key').value.trim(),
    // projectKey is now per-project — not sent in global config save
    issueType: document.getElementById('jira-issue-type').value.trim(),
    defaultPriority: document.getElementById('jira-default-priority').value,
    parentLinkFieldId: document.getElementById('jira-parent-field').value,
    referSSFieldId: document.getElementById('jira-refer-ss-field').value,
    closeTransitionName: document.getElementById('jira-close-transition').value.trim(),
    maxAttachmentMB: Number(document.getElementById('jira-max-attach-mb').value) || 50,
    baseUrl: (document.getElementById('jira-base-url')?.value || '').trim(),
    email: (document.getElementById('jira-creds-email')?.value || '').trim(),
    apiToken: (document.getElementById('jira-creds-token')?.value || ''),
  };
  const msg = document.getElementById('jira-config-msg');
  const r = await fetch('/api/jira/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.ok) {
    msg.style.color = '#16a34a'; msg.textContent = '✓ Saved';
    document.getElementById('jira-status-badge').textContent = '✓ Configured';
    const tokenEl = document.getElementById('jira-creds-token');
    if (tokenEl) { tokenEl.value = ''; tokenEl.placeholder = '(token set — leave blank to keep)'; }
  } else { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j?.error?.message || 'Save failed'}`; }
}
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
// API RUN RESULTS MODULE
// ══════════════════════════════════════════════════════════════════════════════

let _apiRunsCollectionId = null;
let _apiRunsList = [];
let _apiRunsPage = 0;
let _apiRunsPageSize = 10;
let _apiRunsPollTimer = null;
let _apiRunsCurrentRunId = null;

function _apiRunsEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function _apiRunsRelTime(iso) {
  const diff = Date.now() - new Date(iso);
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function _apiRunsDateMatches(run, filter) {
  if (!filter) return true;
  if (!run.startedAt) return false;
  const started = new Date(run.startedAt);
  const now = new Date();
  if (filter === 'today') return started.toDateString() === now.toDateString();
  if (filter === '7d') return (now - started) <= 7 * 86400000;
  if (filter === '30d') return (now - started) <= 30 * 86400000;
  return true;
}

function _apiRunsPassRateCell(passed, total) {
  if (!total) return '<td>—</td>';
  const pct = Math.round((passed / total) * 100);
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444';
  return `<td style="width:120px">
    <div style="display:flex;align-items:center;gap:6px">
      <div style="flex:1;height:6px;background:var(--border);border-radius:3px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:3px"></div>
      </div>
      <span style="font-size:11px;color:var(--text-muted);min-width:32px;text-align:right">${pct}%</span>
    </div>
  </td>`;
}

function _apiRunsPageGo(delta) {
  _apiRunsPage += delta;
  _apiRunsRenderList();
}

function _apiRunsSetPageSize(n) {
  _apiRunsPageSize = n;
  _apiRunsPage = 0;
  _apiRunsRenderList();
}

function _apiRunsRenderPagination(totalPages, total) {
  const table = document.querySelector('#api-runs-tbody')?.closest('table');
  if (!table) return;
  let tfoot = table.querySelector('tfoot');
  if (!tfoot) { tfoot = document.createElement('tfoot'); table.appendChild(tfoot); }
  if (total === 0) { tfoot.innerHTML = ''; return; }
  const start = _apiRunsPage * _apiRunsPageSize + 1;
  const end   = Math.min((_apiRunsPage + 1) * _apiRunsPageSize, total);
  const rppOpts = [10, 25, 50, 100, 200].map(n =>
    `<option value="${n}"${_apiRunsPageSize === n ? ' selected' : ''}>${n}</option>`
  ).join('');
  tfoot.innerHTML = `<tr><td colspan="11" style="padding:6px 4px">
    <div class="lt-pagination">
      <label style="font-size:12px;color:var(--text-muted)">Rows per page:
        <select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto"
          onchange="_apiRunsSetPageSize(+this.value)">${rppOpts}</select>
      </label>
      ${totalPages <= 1
        ? `<span style="font-size:12px;color:var(--text-muted)">${start}–${end} of ${total}</span>`
        : `<button class="tbl-btn" onclick="_apiRunsPageGo(-1)" ${_apiRunsPage === 0 ? 'disabled' : ''}>← Prev</button>
           <span style="font-size:12px;color:var(--text-muted)">Page ${_apiRunsPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${total})</span>
           <button class="tbl-btn" onclick="_apiRunsPageGo(1)" ${_apiRunsPage >= totalPages - 1 ? 'disabled' : ''}>Next →</button>`}
    </div>
  </td></tr>`;
}

async function apiRunsLoad(collectionId, focusRunId) {
  _apiRunsCollectionId = collectionId ?? _apiRunsCollectionId;
  const projectQs = currentProjectId ? `&projectId=${encodeURIComponent(currentProjectId)}` : '';
  const url = _apiRunsCollectionId
    ? `/api/api-runs?collectionId=${encodeURIComponent(_apiRunsCollectionId)}${projectQs}`
    : `/api/api-runs?${currentProjectId ? `projectId=${encodeURIComponent(currentProjectId)}` : ''}`;
  try {
    const res = await fetch(url);
    _apiRunsList = await res.json();
    if (_apiRunsCollectionId) {
      await _apiRunsFetchFlakiness(_apiRunsCollectionId);
    }
    _apiRunsPage = 0;
    _apiRunsRenderList();
    if (focusRunId) {
      setTimeout(() => apiRunsViewDetail(focusRunId), 800);
    }
  } catch (e) {
    modAlert('api-runs-list-alert', 'error', 'Load failed: ' + e.message);
  }
}

// OLD _apiRunsRenderList: 6-column simple loop with flakiness hotspot badge, no filtering/pagination.
// Replaced with enterprise 9-column table render (2026-05-28).
function _apiRunsRenderList() {
  const tbody = document.getElementById('api-runs-tbody');
  if (!tbody) return;
  if (_apiRunsPage < 0) _apiRunsPage = 0;

  // Read filter values
  const search    = (document.getElementById('api-runs-search')?.value || '').toLowerCase();
  const envSearch = (document.getElementById('api-runs-filter-env')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('api-runs-filter-status')?.value || '';
  const dateFilter   = document.getElementById('api-runs-filter-date')?.value || '';

  // Filter
  const filtered = _apiRunsList.filter(r => {
    if (search    && !(r.collectionName  || r.collectionId  || '').toLowerCase().includes(search))    return false;
    if (envSearch && !(r.environmentName || '').toLowerCase().includes(envSearch)) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    if (!_apiRunsDateMatches(r, dateFilter)) return false;
    return true;
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / _apiRunsPageSize));
  if (_apiRunsPage >= totalPages) _apiRunsPage = totalPages - 1;
  const pageStart = _apiRunsPage * _apiRunsPageSize;
  const pageRows  = filtered.slice(pageStart, pageStart + _apiRunsPageSize);

  // Empty state
  if (pageRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--text-muted)">No runs match the current filters.</td></tr>`;
    _apiRunsRenderPagination(totalPages, filtered.length);
    return;
  }

  tbody.innerHTML = pageRows.map((r, i) => {
    const sr = pageStart + i + 1;
    const colName = r.collectionName || r.collectionId || '—';
    const envName = r.environmentName || '—';

    // Duration
    let durStr = '—';
    if (r.completedAt && r.startedAt) {
      const ms = new Date(r.completedAt) - new Date(r.startedAt);
      if (ms >= 60000) {
        durStr = Math.floor(ms / 60000) + 'm ' + Math.floor((ms % 60000) / 1000) + 's';
      } else {
        durStr = (ms / 1000).toFixed(1) + 's';
      }
    } else if (r.startedAt) {
      const sumMs = (r.stepResults || []).reduce((acc, s) => acc + (s.durationMs || 0), 0);
      if (sumMs > 0) {
        durStr = sumMs >= 60000
          ? Math.floor(sumMs / 60000) + 'm ' + Math.floor((sumMs % 60000) / 1000) + 's'
          : (sumMs / 1000).toFixed(1) + 's';
      }
    }

    // Steps counts (exclude teardown steps)
    const steps = (r.stepResults || []).filter(s => !s.isTeardown);
    const total  = steps.length;
    const passed = steps.filter(s => s.status === 'passed').length;
    const stepsStr = total > 0 ? `${passed} / ${total}` : '—';

    // Status badge
    const statusColors = { passed: '#22c55e', failed: '#ef4444', error: '#f59e0b', running: '#3b82f6' };
    const statusColor = statusColors[r.status] || '#6b7280';
    const isRunning = r.status === 'running';
    const statusBadge = `<span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;color:#fff;background:${statusColor};${isRunning ? 'animation:pulse 1.5s infinite;' : ''}">${_apiRunsEsc(r.status)}</span>`;

    // Flakiness hotspot indicator (restored from old render)
    let flakyBadge = '';
    if (typeof _apiRunsFlakinessReport !== 'undefined' && _apiRunsFlakinessReport?.hotspots) {
      const hotspotSet = new Set(_apiRunsFlakinessReport.hotspots.map(h => h.stepId));
      const hasFlaky = (r.stepResults || []).some(s => hotspotSet.has(s.stepId) && s.status !== 'passed');
      if (hasFlaky) flakyBadge = ' <span title="Contains flaky requests" style="font-size:10px;color:#f59e0b">⚡</span>';
    }

    // Start Time / End Time (formatted locale string)
    const startTimeFmt = r.startedAt   ? new Date(r.startedAt).toLocaleString()   : '—';
    const endTimeFmt   = r.completedAt ? new Date(r.completedAt).toLocaleString() : '—';

    // Executed By
    const executedBy = r.triggeredBy || r.executedBy || r.createdBy || '—';

    const dataFileBadge = r.dataFileName ? `<span title="Data file: ${_apiRunsEsc(r.dataFileName)}" style="font-size:10px;background:#6366f1;color:#fff;padding:1px 5px;border-radius:8px;margin-left:4px">📂 ${_apiRunsEsc(r.dataFileName)} (${r.iterationCount||0} rows)</span>` : '';
    return `<tr>
      <td style="text-align:center;color:var(--text-muted);font-size:12px">${sr}</td>
      <td style="font-weight:500">${_apiRunsEsc(colName)}${dataFileBadge}</td>
      <td style="color:var(--text-muted);font-size:12px">${_apiRunsEsc(envName)}</td>
      <td style="font-size:12px;color:var(--text-muted);white-space:nowrap">${startTimeFmt}</td>
      <td style="font-size:12px;color:var(--text-muted);white-space:nowrap">${endTimeFmt}</td>
      <td style="font-size:12px">${durStr}</td>
      <td style="text-align:center;font-size:12px">${stepsStr}</td>
      ${_apiRunsPassRateCell(passed, total)}
      <td style="text-align:center">${statusBadge}${flakyBadge}</td>
      <td style="font-size:12px;color:var(--text-muted)">${_apiRunsEsc(executedBy)}</td>
      <td><button class="tbl-btn" data-run-id="${_apiRunsEsc(r.id)}">View</button></td>
    </tr>`;
  }).join('');

  _apiRunsRenderPagination(totalPages, filtered.length);

  // delegated handler for View buttons
  const tbodyEl = document.getElementById('api-runs-tbody');
  if (tbodyEl && !tbodyEl._runsClickBound) {
    tbodyEl._runsClickBound = true;
    tbodyEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-run-id]');
      if (btn) apiRunsViewDetail(btn.dataset.runId);
    });
  }
}

async function apiRunsViewDetail(runId) {
  _apiRunsCurrentRunId = runId;
  clearInterval(_apiRunsPollTimer);
  // Reset lazy-load panels for new run
  const tlPanel = document.getElementById('run-timeline-panel');
  if (tlPanel) { tlPanel.dataset.loaded = ''; tlPanel.innerHTML = ''; }
  const vtPanel = document.getElementById('run-var-trace-panel');
  if (vtPanel) { vtPanel.dataset.loaded = ''; vtPanel.innerHTML = ''; }
  const obsPanel = document.getElementById('run-observability-panel');
  if (obsPanel) { obsPanel.dataset.loaded = ''; obsPanel.innerHTML = ''; }
  await _apiRunsFetchAndRender(runId);
  openModal('modal-api-run-detail');
}

async function _apiRunsFetchAndRender(runId, _retries = 5) {
  try {
    const projectQs = currentProjectId ? `?projectId=${encodeURIComponent(currentProjectId)}` : '';
    const res = await fetch(`/api/api-runs/${runId}${projectQs}`);
    if (!res.ok) {
      if (_retries > 0) {
        _apiRunsPollTimer = setTimeout(() => _apiRunsFetchAndRender(runId, _retries - 1), 1000);
      } else {
        modAlert('api-run-detail-alert', 'error', 'Run not found');
      }
      return;
    }
    const run = await res.json();
    _apiRunsRenderDetail(run);

    if (run.status === 'running') {
      _apiRunsPollTimer = setTimeout(() => _apiRunsFetchAndRender(runId), 2000);
    } else {
      clearInterval(_apiRunsPollTimer);
      // Refresh list with final status
      await apiRunsLoad();
    }
  } catch (e) {
    modAlert('api-run-detail-alert', 'error', e.message);
  }
}

let _apiRunsCurrentRun = null;

function _apiRunsRenderDetail(run) {
  _apiRunsCurrentRun = run;
  _execGraphReset();
  const statusColor = run.status === 'passed' ? '#22c55e' : run.status === 'failed' ? '#ef4444' : run.status === 'running' ? '#3b82f6' : '#f59e0b';
  const dur = run.startedAt && run.completedAt
    ? Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000) + 's'
    : '—';

  const steps   = run.stepResults ?? [];
  const total   = steps.length;
  const passed  = steps.filter(s => s.status === 'passed').length;
  const failed  = steps.filter(s => s.status === 'failed').length;
  const errored = steps.filter(s => s.status === 'error').length;
  const skipped = steps.filter(s => s.status === 'skipped').length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
  const barColor = passRate === 100 ? '#22c55e' : passRate >= 70 ? '#f59e0b' : '#ef4444';

  // Update subtitle with run ID
  const subtitleEl = document.getElementById('api-run-detail-subtitle');
  if (subtitleEl) subtitleEl.textContent = 'Run ID: ' + run.id + (run.collectionName ? ' · ' + run.collectionName : '');

  document.getElementById('api-run-detail-summary').innerHTML = `
    <div style="padding:14px 16px;background:var(--surface-2);border-radius:10px;margin-bottom:12px">
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
        <span style="font-weight:800;font-size:18px;color:${statusColor};letter-spacing:.02em">${run.status.toUpperCase()}</span>
        ${run.status === 'running' ? '<span class="badge badge-blue" style="font-size:11px">⟳ Live</span>' : ''}
        <span style="font-size:13px">⏱ <strong>${dur}</strong></span>
        <span style="font-size:13px">📋 <strong>${total}</strong> requests</span>
        <span style="font-size:13px;color:#22c55e">✓ <strong>${passed}</strong> passed</span>
        ${failed  > 0 ? `<span style="font-size:13px;color:#ef4444">✗ <strong>${failed}</strong> failed</span>` : ''}
        ${errored > 0 ? `<span style="font-size:13px;color:#f97316">⚠ <strong>${errored}</strong> error</span>` : ''}
        ${skipped > 0 ? `<span style="font-size:13px;color:#9ca3af">⊘ <strong>${skipped}</strong> skipped</span>` : ''}
        <span style="margin-left:auto;font-size:13px;font-weight:700;color:${barColor}">${passRate}% pass rate</span>
      </div>
      <!-- Pass rate progress bar -->
      <div style="height:6px;background:var(--neutral-200);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${passRate}%;background:${barColor};border-radius:3px;transition:width .4s"></div>
      </div>
    </div>`;

  // Failure clustering (show when >1 failure)
  const failedSteps = (run.stepResults ?? []).filter(s => s.status === 'failed' || s.status === 'error');
  const clusterEl = document.getElementById('api-run-clusters');
  if (clusterEl) {
    if (failedSteps.length > 1) {
      const clusters = {};
      for (const s of failedSteps) {
        const key = `${s.response?.status ?? 'error'}-${s.assertionResults?.find(a => !a.passed)?.field ?? s.error ?? 'unknown'}`;
        if (!clusters[key]) clusters[key] = { count: 0, label: `status ${s.response?.status ?? 'network error'}`, steps: [] };
        clusters[key].count++;
        clusters[key].steps.push(s.stepName);
      }
      const clusterHtml = Object.entries(clusters).map(([, c]) =>
        `<div style="padding:8px 12px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:6px;margin-bottom:6px;color:var(--text);font-size:13px">
           <span style="color:#ef4444;font-weight:700">${c.count} request${c.count > 1 ? 's' : ''} failed</span>
           <span style="color:var(--text-muted)"> → ${c.label}:</span>
           <span style="color:var(--text)"> ${c.steps.join(', ')}</span>
         </div>`
      ).join('');
      clusterEl.innerHTML = `<div style="margin-bottom:14px"><div style="font-weight:700;margin-bottom:8px;font-size:13px;letter-spacing:.05em">Failure Clusters:</div>${clusterHtml}</div>`;
    } else {
      clusterEl.innerHTML = '';
    }
  }

  // Data File iteration summary banner
  const iterBannerEl = document.getElementById('api-run-iteration-banner') || (() => {
    const el = document.createElement('div');
    el.id = 'api-run-iteration-banner';
    document.getElementById('api-run-detail-summary')?.after(el);
    return el;
  })();
  if (run.iterationCount > 1 && run.iterationSummary?.length) {
    const iters = run.iterationSummary;
    const iterPassed = iters.filter(it => it.status === 'passed').length;
    const rows = iters.map((it, i) => {
      const sc = it.status === 'passed' ? '#22c55e' : '#ef4444';
      return `<tr style="font-size:12px">
        <td style="padding:3px 8px">${i + 1}</td>
        <td style="padding:3px 8px;color:var(--text-muted)">${_apiRunsEsc(it.rowIdentifier ?? '')}</td>
        <td style="padding:3px 8px"><span style="color:${sc};font-weight:700">${it.status}</span></td>
        <td style="padding:3px 8px;color:var(--text-muted)">${it.durationMs ? (it.durationMs/1000).toFixed(1)+'s' : '—'}</td>
      </tr>`;
    }).join('');
    iterBannerEl.innerHTML = `
      <div style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;margin-bottom:12px">
        <div style="font-weight:700;margin-bottom:8px;font-size:13px">📂 ${_apiRunsEsc(run.dataFileName || 'Data File')} — ${run.iterationCount} iterations &nbsp;·&nbsp; ${iterPassed}/${run.iterationCount} passed</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="font-size:11px;color:var(--text-muted)"><th style="text-align:left;padding:3px 8px">#</th><th style="text-align:left;padding:3px 8px">Row</th><th style="padding:3px 8px;text-align:left">Status</th><th style="padding:3px 8px;text-align:left">Duration</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:10px;display:flex;gap:8px">
          <button class="tbl-btn" onclick="_apiRunsExportSummaryCsv()">📊 Export Summary CSV</button>
          <button class="tbl-btn" onclick="_apiRunsExportDetailCsv()">📋 Export Step Detail CSV</button>
        </div>
      </div>`;
  } else {
    iterBannerEl.innerHTML = '';
  }

  // Step results table — store steps for filter/search
  _apiRunsAllSteps = run.stepResults ?? [];
  apiRunsFilterSteps('__reset__');
  _apiRunsRenderStepRows();

  // HAR tab
  _apiRunsRenderHar(run);
}

function _buildStepDetailHtml(step) {
  const assertRows = (step.assertionResults ?? []).map(a =>
    `<tr>
       <td>${escHtml(a.field)}</td>
       <td>${escHtml(a.operator)}</td>
       <td style="font-family:monospace">${escHtml(JSON.stringify(a.expected))}</td>
       <td style="font-family:monospace">${escHtml(JSON.stringify(a.actual))}</td>
       <td style="color:${a.passed ? '#22c55e' : '#ef4444'}">${a.passed ? '✓' : '✗'}</td>
       <td>${(a.confidenceScore ?? 0).toFixed(1)}</td>
     </tr>`
  ).join('');

  const extractedRows = Object.entries(step.extractedVariables ?? {}).map(([k, v]) =>
    `<tr><td>${escHtml(k)}</td><td style="font-family:monospace">${escHtml(v)}</td></tr>`
  ).join('');

  const reqHeaders = Object.entries(step.request?.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const resHeaders = Object.entries(step.response?.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const resBody = typeof step.response?.body === 'string' ? step.response.body : JSON.stringify(step.response?.body, null, 2);

  // Baseline diff tab content
  const bd = step.response?.baselineDiff;
  const hasDiff = bd && (bd.statusChanged || bd.bodyDiff?.length || bd.headersAdded?.length || bd.headersRemoved?.length);
  const diffHtml = hasDiff ? `
    <div>
      ${bd.statusChanged ? '<div style="color:#ef4444;margin-bottom:4px">Status changed</div>' : ''}
      ${bd.headersAdded?.length ? `<div style="color:#22c55e;margin-bottom:4px">Headers added: ${escHtml(bd.headersAdded.join(', '))}</div>` : ''}
      ${bd.headersRemoved?.length ? `<div style="color:#ef4444;margin-bottom:4px">Headers removed: ${escHtml(bd.headersRemoved.join(', '))}</div>` : ''}
      ${bd.bodyDiff?.length ? `<table class="data-table"><thead><tr><th>Path</th><th style="color:#22c55e">Expected</th><th style="color:#ef4444">Actual</th></tr></thead><tbody>
        ${bd.bodyDiff.map(d => `<tr><td style="font-family:monospace">${escHtml(d.path)}</td><td style="color:#22c55e;font-family:monospace">${escHtml(JSON.stringify(d.expected))}</td><td style="color:#ef4444;font-family:monospace">${escHtml(JSON.stringify(d.actual))}</td></tr>`).join('')}
      </tbody></table>` : '<div style="color:#22c55e">No body diff</div>'}
    </div>` : '<div style="color:#9ca3af">No baseline diff recorded</div>';

  // Contract violations
  const contractHtml = step.contractViolations?.length
    ? `<ul style="margin:0;padding-left:16px">${step.contractViolations.map(v => `<li style="color:#ef4444;font-size:12px">${escHtml(v)}</li>`).join('')}</ul>`
    : '';

  const detailId = 'api-run-step-tabs-' + step.stepId;
  const setBaselineBtn = step.response
    ? `<button class="tbl-btn" style="margin-top:6px" onclick="_apiRunsSetBaseline('${step.stepId}')">Set as Baseline</button>` : '';

  return `
    <div style="padding:8px;background:var(--surface-2);border-radius:6px">
      <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
        <button class="tbl-btn active" onclick="_apiRunsStepTab(this,'${detailId}','assertions')" data-steptab="assertions">Assertions</button>
        <button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','diff')" data-steptab="diff">Diff ${hasDiff ? '●' : ''}</button>
        ${step.contractViolations?.length ? `<button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','contract')" data-steptab="contract">Contract ⚠</button>` : ''}
        <button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','request')" data-steptab="request">Request</button>
        <button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','response')" data-steptab="response">Response</button>
        ${extractedRows ? `<button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','vars')" data-steptab="vars">Vars</button>` : ''}
        <button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','jira');_apiRunsLoadJiraPanel('${step.stepId}')" data-steptab="jira">Jira &amp; Heal</button>
        <button class="tbl-btn" onclick="_apiRunsStepTab(this,'${detailId}','suggest');_apiRunsLoadSuggestPanel('${step.stepId}')" data-steptab="suggest">&#x1F4A1; Suggest</button>
      </div>
      <div id="${detailId}">
        <div data-steppanel="assertions">
          ${assertRows ? `<table class="data-table"><thead><tr><th>Field</th><th>Op</th><th>Expected</th><th>Actual</th><th>Pass</th><th>Score</th></tr></thead><tbody>${assertRows}</tbody></table>` : '<div style="color:#9ca3af">No assertions</div>'}
        </div>
        <div data-steppanel="diff" style="display:none">${diffHtml}${setBaselineBtn}</div>
        ${step.contractViolations?.length ? `<div data-steppanel="contract" style="display:none"><strong style="color:#f59e0b">Contract Violations</strong>${contractHtml}</div>` : ''}
        <div data-steppanel="request" style="display:none">
          <pre style="font-size:11px;background:var(--surface-1);padding:6px;border-radius:4px;overflow:auto;max-height:160px">${escHtml(step.request?.method + ' ' + step.request?.url + '\n' + reqHeaders)}</pre>
        </div>
        <div data-steppanel="response" style="display:none">
          ${step.response ? `<pre style="font-size:11px;background:var(--surface-1);padding:6px;border-radius:4px;overflow:auto;max-height:160px">${escHtml('Status: ' + step.response.status + '\n' + resHeaders + '\n\n' + (resBody ?? ''))}</pre>
          ${step.response.bodyTruncated ? '<span style="color:#f59e0b;font-size:11px">[body truncated at 50KB]</span>' : ''}` : 'No response'}
        </div>
        ${extractedRows ? `<div data-steppanel="vars" style="display:none"><table class="data-table"><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>${extractedRows}</tbody></table></div>` : ''}
        <div data-steppanel="jira" style="display:none;padding:10px;">
          ${step.status !== 'passed'
            ? `<button class="btn btn-sm" style="margin-bottom:8px;" onclick="_apiRunsFileDefect(_apiRunsCurrentRun&&_apiRunsCurrentRun.id,'${step.stepId}')">🐛 File Defect in Jira</button>`
            : '<div style="color:var(--text-muted);font-size:12px;">Request passed — no defect to file.</div>'}
          <div id="jira-defect-ref-${step.stepId}" style="margin-top:6px;"></div>
          <div id="jira-heal-panel-${step.stepId}" style="margin-top:10px;"></div>
        </div>
        <div data-steppanel="suggest" style="display:none;padding:10px">
          <div id="suggest-panel-${step.stepId}"><span style="color:var(--text-muted);font-size:12px">Click "Suggest" to generate assertion suggestions for this request.</span></div>
        </div>
      </div>
    </div>`;
}

// ── Step filter / search state ─────────────────────────────────────────────
let _apiRunsAllSteps = [];
let _apiRunsActiveFilter = 'all';

function apiRunsFilterSteps(filter) {
  if (filter && filter !== '__reset__') {
    _apiRunsActiveFilter = filter;
    // Update pill active state
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
  }
  if (filter === '__reset__') {
    _apiRunsActiveFilter = 'all';
    document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    const srch = document.getElementById('api-run-step-search');
    if (srch) srch.value = '';
  }
  _apiRunsRenderStepRows();
}

function _apiRunsRenderStepRows() {
  const stepTbody = document.getElementById('api-run-steps-tbody');
  if (!stepTbody) return;
  const search = (document.getElementById('api-run-step-search')?.value ?? '').toLowerCase();
  const filtered = _apiRunsAllSteps.filter(s => {
    if (_apiRunsActiveFilter !== 'all' && s.status !== _apiRunsActiveFilter) return false;
    if (search && !s.stepName?.toLowerCase().includes(search)) return false;
    return true;
  });

  const countEl = document.getElementById('api-run-step-count');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${_apiRunsAllSteps.length} requests`;

  stepTbody.innerHTML = '';
  let _lastIterIdx = -1;
  filtered.forEach((step, idx) => {
    // Insert iteration group header when iterationIndex changes (data-driven runs only)
    if (step.iterationIndex !== undefined && step.iterationIndex !== _lastIterIdx) {
      _lastIterIdx = step.iterationIndex;
      const iterRow = document.createElement('tr');
      const sc = (() => {
        const sum = _apiRunsCurrentRun?.iterationSummary?.[step.iterationIndex];
        return sum?.status === 'passed' ? '#22c55e' : '#ef4444';
      })();
      iterRow.innerHTML = `<td colspan="8" style="padding:6px 10px;background:var(--bg-accent);border-top:2px solid var(--border);font-size:12px;font-weight:700;color:${sc}">
        Row ${step.iterationIndex + 1}${step.rowIdentifier ? ' — ' + _apiRunsEsc(step.rowIdentifier) : ''}</td>`;
      stepTbody.appendChild(iterRow);
    }
    const isTeardown = step.stepName?.includes('[teardown]') || false;
    const sc = step.status === 'passed' ? '#22c55e' : step.status === 'failed' || step.status === 'error' ? '#ef4444' : step.status === 'degraded' ? '#f59e0b' : '#9ca3af';
    const rowId = 'api-run-step-' + step.stepId;
    const httpStatus = step.response?.status;
    const httpColor = !httpStatus ? '#9ca3af' : httpStatus < 300 ? '#22c55e' : httpStatus < 500 ? '#f59e0b' : '#ef4444';
    const assertTotal = step.assertionResults?.length ?? 0;
    const assertPassed = step.assertionResults?.filter(a => a.passed).length ?? 0;
    const assertColor = assertTotal === 0 ? '#9ca3af' : assertPassed === assertTotal ? '#22c55e' : '#ef4444';

    const contractBadge = (step.contractViolations?.length ?? 0) > 0
      ? `<span class="badge badge-red" style="font-size:10px" title="${escHtml(step.contractViolations.join('\n'))}">⚠ ${step.contractViolations.length} contract</span>` : '';
    const diffBadge = step.response?.baselineDiff &&
      (step.response.baselineDiff.statusChanged || step.response.baselineDiff.bodyDiff?.length || step.response.baselineDiff.headersAdded?.length || step.response.baselineDiff.headersRemoved?.length)
      ? '<span class="badge badge-yellow" style="font-size:10px">~ diff</span>' : '';

    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.dataset.stepstatus = step.status;
    tr.onclick = () => _apiRunsToggleStepDetail(step.stepId, step);
    // Status pill with icon
    const statusIcon = step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : step.status === 'error' ? '⚠' : '⊘';
    tr.innerHTML = `
      <td style="font-size:11px;color:var(--neutral-400);text-align:center">${idx + 1}</td>
      <td>
        <span style="font-weight:500">${escHtml(step.stepName)}</span>
        ${httpStatus ? `<span style="font-size:10px;color:${httpColor};margin-left:4px">[${httpStatus}]</span>` : ''}
        ${isTeardown ? '<span class="badge badge-grey" style="font-size:10px;margin-left:4px">teardown</span>' : ''}
        ${assertTotal === 0 && !isTeardown ? '<span class="badge badge-yellow" style="font-size:10px;margin-left:4px" title="No assertions configured — response contract not validated">⚠ No assertion</span>' : ''}
        ${step.healingProposal ? `<span class="badge badge-yellow" style="font-size:10px" title="${escHtml(step.healingProposal)}">💡 heal</span>` : ''}
        ${diffBadge}${contractBadge}
      </td>
      <td><span style="color:${sc};font-weight:700;font-size:12px">${statusIcon} ${step.status}</span></td>
      <td style="font-size:12px">${step.durationMs != null ? step.durationMs + 'ms' : '—'}</td>
      <td style="font-size:12px;color:${assertColor};font-weight:${assertTotal > 0 ? '600' : '400'}">${assertTotal > 0 ? assertPassed + '/' + assertTotal : '—'}</td>
      <td><button class="tbl-btn" onclick="event.stopPropagation();_apiRunsToggleStepDetail('${step.stepId}', null)">▼</button></td>`;
    stepTbody.appendChild(tr);

    const detailTr = document.createElement('tr');
    detailTr.id = rowId;
    detailTr.style.display = 'none';
    detailTr.innerHTML = `<td colspan="6">${_buildStepDetailHtml(step)}</td>`;
    stepTbody.appendChild(detailTr);
  });
}

const _apiRunsExpandedSteps = new Set();
function _apiRunsToggleStepDetail(stepId, stepData) {
  const row = document.getElementById('api-run-step-' + stepId);
  if (!row) return;
  if (_apiRunsExpandedSteps.has(stepId)) {
    row.style.display = 'none';
    _apiRunsExpandedSteps.delete(stepId);
  } else {
    if (stepData) row.querySelector('td').innerHTML = _buildStepDetailHtml(stepData);
    row.style.display = '';
    _apiRunsExpandedSteps.add(stepId);
  }
}

let _apiRunsHarFilter = 'all';
let _apiRunsHarSteps  = [];

function apiRunsHarFilter(filter) {
  _apiRunsHarFilter = filter;
  document.querySelectorAll('[data-harfilter]').forEach(b => b.classList.toggle('active', b.dataset.harfilter === filter));
  _apiRunsRenderHarRows();
}

function _apiRunsRenderHarRows() {
  const harTbody = document.getElementById('api-run-har-tbody');
  if (!harTbody) return;
  const filtered = _apiRunsHarSteps.filter(step => {
    if (!step.response) return false;
    if (_apiRunsHarFilter === 'all') return true;
    const s = step.response.status;
    if (_apiRunsHarFilter === '2xx') return s >= 200 && s < 300;
    if (_apiRunsHarFilter === '4xx') return s >= 400 && s < 500;
    if (_apiRunsHarFilter === '5xx') return s >= 500;
    return true;
  });
  const countEl = document.getElementById('api-run-har-count');
  if (countEl) countEl.textContent = `${filtered.length} request${filtered.length !== 1 ? 's' : ''}`;

  harTbody.innerHTML = '';
  filtered.forEach((step, idx) => {
    const sc = step.response.status < 300 ? '#22c55e' : step.response.status < 500 ? '#f59e0b' : '#ef4444';
    const detailId = 'har-detail-' + step.stepId;
    const harTr = document.createElement('tr');
    harTr.style.cursor = 'pointer';
    harTr.onclick = () => _apiRunsHarToggle(detailId);
    harTr.innerHTML = `
      <td style="font-size:11px;color:var(--neutral-400);text-align:center">${idx + 1}</td>
      <td style="font-weight:500">${escHtml(step.stepName)}</td>
      <td><span class="badge badge-blue" style="font-size:11px">${step.request?.method ?? ''}</span></td>
      <td style="font-family:monospace;font-size:11px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(step.request?.url ?? '')}">${escHtml(step.request?.url ?? '')}</td>
      <td style="font-weight:700;color:${sc}">${step.response.status}</td>
      <td style="font-size:12px">${step.response.durationMs ?? '—'}ms</td>
      <td>
        <button class="tbl-btn" onclick="event.stopPropagation();_apiRunsCopyCurl('${detailId}')" title="Copy as cURL">cURL</button>
        <button class="tbl-btn" onclick="event.stopPropagation();_apiRunsHarToggle('${detailId}')">▼</button>
      </td>`;
    harTbody.appendChild(harTr);

    // Expandable body inspector row
    const reqHeaders = Object.entries(step.request?.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n') || '(none)';
    const resHeaders = Object.entries(step.response?.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n') || '(none)';
    const resBody = typeof step.response?.body === 'string' ? step.response.body : JSON.stringify(step.response?.body, null, 2);
    const reqBody = step.request?.body ? (typeof step.request.body === 'string' ? step.request.body : JSON.stringify(step.request.body, null, 2)) : '(no body)';

    const detailTr = document.createElement('tr');
    detailTr.id = detailId;
    detailTr.dataset.stepJson = JSON.stringify(step);
    detailTr.style.display = 'none';
    detailTr.innerHTML = `<td colspan="7" style="padding:0">
      <div style="background:var(--surface-2);padding:12px 16px;border-top:1px solid var(--neutral-200)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--neutral-500);margin-bottom:6px">Request</div>
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">${escHtml((step.request?.method ?? '') + ' ' + (step.request?.url ?? ''))}</div>
            <pre style="font-size:10px;background:var(--surface-1);padding:6px;border-radius:4px;max-height:120px;overflow:auto;margin:0 0 6px">${escHtml(reqHeaders)}</pre>
            <pre style="font-size:10px;background:var(--surface-1);padding:6px;border-radius:4px;max-height:100px;overflow:auto;margin:0">${escHtml(reqBody)}</pre>
          </div>
          <div>
            <div style="font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--neutral-500);margin-bottom:6px">Response <span style="color:${sc}">${step.response.status}</span></div>
            <pre style="font-size:10px;background:var(--surface-1);padding:6px;border-radius:4px;max-height:120px;overflow:auto;margin:0 0 6px">${escHtml(resHeaders)}</pre>
            <pre style="font-size:10px;background:var(--surface-1);padding:6px;border-radius:4px;max-height:140px;overflow:auto;margin:0">${escHtml(resBody ?? '')}</pre>
          </div>
        </div>
      </div>
    </td>`;
    harTbody.appendChild(detailTr);
  });
}

function _apiRunsHarToggle(detailId) {
  const row = document.getElementById(detailId);
  if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
}

function _apiRunsCopyCurl(detailId) {
  try {
    // Retrieve step data stored on the detail row element
    const detailRow = document.getElementById(detailId);
    const stepJson = detailRow && detailRow.dataset.stepJson;
    const step = stepJson ? JSON.parse(stepJson) : {};
    const method = step.request?.method ?? 'GET';
    const url    = step.request?.url ?? '';
    const hdrs   = Object.entries(step.request?.headers ?? {}).map(([k, v]) => `-H '${k}: ${v}'`).join(' \\\n  ');
    const body   = step.request?.body ? `-d '${typeof step.request.body === 'string' ? step.request.body : JSON.stringify(step.request.body)}'` : '';
    const curl   = `curl -X ${method} '${url}' \\\n  ${hdrs}${body ? ' \\\n  ' + body : ''}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(curl).then(() => showToast('cURL copied to clipboard', 'success'));
    } else {
      const ta = document.createElement('textarea');
      ta.value = curl; ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); showToast('cURL copied', 'success'); } catch { showToast('Could not copy', 'error'); }
      document.body.removeChild(ta);
    }
  } catch { showToast('Could not build cURL', 'error'); }
}

function _apiRunsRenderHar(run) {
  _apiRunsHarSteps  = run.stepResults ?? [];
  _apiRunsHarFilter = 'all';
  document.querySelectorAll('[data-harfilter]').forEach(b => b.classList.toggle('active', b.dataset.harfilter === 'all'));
  _apiRunsRenderHarRows();
}

function _apiRunsStepTab(btn, containerId, tab) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('[data-steppanel]').forEach(p => p.style.display = p.dataset.steppanel === tab ? '' : 'none');
  btn.closest('div').querySelectorAll('[data-steptab]').forEach(b => b.classList.toggle('active', b.dataset.steptab === tab));
}

async function _apiRunsSetBaseline(stepId) {
  if (!confirm('Set current response as baseline for this request?')) return;
  // Trigger a "captureBaseline" re-run is complex — instead tell user to set captureBaseline:true on the request
  showToast('To capture a baseline: edit the request in the collection and enable "Capture Baseline", then run once. The baseline file will be saved automatically.', 'info');
}

function apiRunsCopySummary() {
  const run = _apiRunsCurrentRun;
  if (!run) return;
  const steps   = run.stepResults ?? [];
  const passed  = steps.filter(s => s.status === 'passed').length;
  const failed  = steps.filter(s => s.status === 'failed').length;
  const errored = steps.filter(s => s.status === 'error').length;
  const dur = run.startedAt && run.completedAt
    ? Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000) + 's' : '—';
  const passRate = steps.length > 0 ? Math.round((passed / steps.length) * 100) : 0;
  const lines = [
    `API Run Summary`,
    `Run ID: ${run.id}`,
    `Status: ${run.status.toUpperCase()}`,
    `Duration: ${dur}`,
    `Requests: ${steps.length} total — ${passed} passed, ${failed} failed, ${errored} error`,
    `Pass Rate: ${passRate}%`,
    ``,
    `Request Results:`,
    ...steps.map((s, i) => `  ${i + 1}. ${s.stepName} — ${s.status}${s.response ? ' [' + s.response.status + ']' : ''} (${s.durationMs ?? '—'}ms)`),
  ];
  const text = lines.join('\n');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => showToast('Run summary copied to clipboard', 'success'));
  } else {
    // HTTP fallback — create temp textarea
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Run summary copied to clipboard', 'success'); } catch { showToast('Could not copy — please copy manually', 'error'); }
    document.body.removeChild(ta);
  }
}

function apiRunsCloseDetail() {
  clearInterval(_apiRunsPollTimer);
  closeModal('modal-api-run-detail');
  _apiRunsExpandedSteps.clear();
  _apiRunsCurrentRun = null;
  _execGraphDestroy();
}

function apiRunsTabSwitch(tab) {
  document.querySelectorAll('.api-run-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.api-run-tab-panel').forEach(p => p.style.display = p.dataset.tab === tab ? '' : 'none');
  if (tab === 'graph' && _apiRunsCurrentRun) _execGraphEnsureLoaded(_apiRunsCurrentRun);

  if (tab === 'timeline' && _apiRunsCurrentRunId) {
    const panel = document.getElementById('run-timeline-panel');
    if (panel && !panel.dataset.loaded) { panel.dataset.loaded = '1'; _apiRunsLoadTimeline(_apiRunsCurrentRunId, panel); }
  }
  if (tab === 'var-trace' && _apiRunsCurrentRunId) {
    const panel = document.getElementById('run-var-trace-panel');
    if (panel && !panel.dataset.loaded) { panel.dataset.loaded = '1'; _apiRunsLoadVarTrace(_apiRunsCurrentRunId, panel); }
  }
  if (tab === 'observability' && _apiRunsCurrentRunId) {
    const panel = document.getElementById('run-observability-panel');
    if (panel && !panel.dataset.loaded) { panel.dataset.loaded = '1'; _apiRunsLoadObservability(_apiRunsCurrentRunId, panel); }
  }
}

// ── Debugger Engine — Timeline (Phase F) ────────────────────────────────────

async function _apiRunsLoadTimeline(runId, panel) {
  panel.innerHTML = '<div style="color:var(--text-muted)">Loading timeline…</div>';
  try {
    const res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/timeline');
    if (res.ok) {
      const data = await res.json();
      const events = (data.timeline && data.timeline.events) || [];
      if (events.length) {
        _apiRunsRenderTimelineEvents(panel, events, data);
        return;
      }
    }
    // Fallback: synthesize timeline from step results
    _apiRunsSynthesizeTimeline(panel);
  } catch (e) {
    _apiRunsSynthesizeTimeline(panel);
  }
}

function _apiRunsSynthesizeTimeline(panel) {
  const run = _apiRunsCurrentRun;
  const steps = run && run.stepResults || [];
  if (!steps.length) { panel.innerHTML = '<div style="color:var(--text-muted)">No request data available.</div>'; return; }

  const totalMs = steps.reduce(function(s, r) { return s + (r.durationMs || 0); }, 0);
  const maxDur  = Math.max(...steps.map(function(s) { return s.durationMs || 0; }), 1);

  const colorMap = { passed: '#22c55e', failed: '#ef4444', error: '#f97316', skipped: '#9ca3af', degraded: '#f59e0b' };

  const rows = steps.map(function(step, idx) {
    const col = colorMap[step.status] || '#9ca3af';
    const dur = step.durationMs || 0;
    const pct = Math.max(2, Math.round((dur / maxDur) * 100));
    const assertSummary = step.assertionResults && step.assertionResults.length
      ? step.assertionResults.filter(function(a) { return a.passed; }).length + '/' + step.assertionResults.length + ' assertions'
      : '';
    const httpBadge = step.response ? '<span style="color:' + (step.response.status < 300 ? '#22c55e' : step.response.status < 500 ? '#f59e0b' : '#ef4444') + ';font-weight:600;font-size:10px"> [' + step.response.status + ']</span>' : '';
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--neutral-200)">' +
      '<span style="font-size:10px;color:var(--neutral-400);min-width:24px;text-align:right">' + (idx + 1) + '</span>' +
      '<span style="font-size:12px;min-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escHtml(step.stepName) + '">' + escHtml(step.stepName) + httpBadge + '</span>' +
      '<div style="flex:1;background:var(--neutral-200);border-radius:3px;height:8px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:' + col + ';border-radius:3px"></div>' +
      '</div>' +
      '<span style="font-size:11px;color:var(--neutral-500);min-width:54px;text-align:right">' + dur + 'ms</span>' +
      '<span style="font-size:10px;font-weight:600;color:' + col + ';min-width:50px">' + escHtml(step.status) + '</span>' +
      '<span style="font-size:10px;color:var(--neutral-400)">' + assertSummary + '</span>' +
    '</div>';
  }).join('');

  panel.innerHTML =
    '<div style="font-size:11px;color:var(--neutral-500);margin-bottom:10px;padding:6px 8px;background:var(--neutral-100);border-radius:6px">' +
      '&#x23F1; Execution waterfall — ' + steps.length + ' requests · ' + totalMs + 'ms total' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;margin-bottom:4px;font-size:10px;font-weight:700;color:var(--neutral-500);text-transform:uppercase;letter-spacing:.06em">' +
      '<span style="min-width:24px"></span><span style="min-width:140px">Request</span>' +
      '<span style="flex:1">Duration (relative)</span><span style="min-width:54px;text-align:right">ms</span>' +
      '<span style="min-width:50px">Status</span><span>Assertions</span>' +
    '</div>' + rows;
}

function _apiRunsRenderTimelineEvents(panel, events, data) {
  const maxDur = Math.max(...events.map(function(e) { return e.durationMs || 0; }), 1);
  const colorMap = { 'node-started': '#3b82f6', 'node-completed': '#22c55e', 'node-failed': '#ef4444',
    'node-skipped': '#9ca3af', 'node-retrying': '#f59e0b', 'assertion-failed': '#ef4444',
    'variable-extracted': '#a78bfa', 'failure-propagated': '#ef4444' };
  const rows = events.map(function(e) {
    const col = colorMap[e.eventType] || '#9ca3af';
    const pct = e.durationMs ? Math.max(4, Math.round((e.durationMs / maxDur) * 100)) : 0;
    const bar = e.durationMs ? '<div style="height:6px;width:' + pct + '%;background:' + col + ';border-radius:3px;margin-top:3px"></div>' : '';
    const ts = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '';
    const detail = e.detail ? ' <span style="color:var(--text-muted);font-size:11px">— ' + escHtml(e.detail) + '</span>' : '';
    const dur = e.durationMs != null ? ' <span style="color:var(--text-muted);font-size:11px">' + e.durationMs + 'ms</span>' : '';
    return '<div style="padding:4px 0;border-bottom:1px solid var(--border)">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:10px;color:var(--text-muted);min-width:70px">' + ts + '</span>' +
        '<span style="font-size:11px;font-weight:600;color:' + col + '">' + escHtml(e.eventType) + '</span>' +
        '<span style="font-size:12px">' + escHtml(e.nodeName || '') + '</span>' + detail + dur +
      '</div>' + bar + '</div>';
  }).join('');
  const tl = data.timeline;
  const src = data.source === 'synthesized-from-snapshot'
    ? '<div style="color:#f59e0b;font-size:11px;margin-bottom:8px">&#x26A0; ' + escHtml(data.advisoryNote || '') + '</div>' : '';
  panel.innerHTML = src + '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px">' + events.length + ' events · ' + (tl.totalDurationMs || 0) + 'ms total</div>' + rows;
}

// ── Debugger Engine — Variable Trace (Phase F) ───────────────────────────────

async function _apiRunsLoadVarTrace(runId, panel) {
  panel.innerHTML = '<div style="color:var(--text-muted)">Loading variable trace…</div>';
  try {
    const res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/variable-trace');
    if (!res.ok) { _apiRunsSynthesizeVarTrace(panel); return; }
    const data = await res.json();
    const mutations = data.mutations || [];
    if (!mutations.length) { panel.innerHTML = '<div style="color:var(--text-muted)">No variable mutations recorded.</div>'; return; }

    const mutRows = mutations.map(function(m) {
      const extracted = Object.entries(m.extracted || {});
      if (!extracted.length) return '';
      const kvRows = extracted.map(function(kv) {
        return '<tr><td style="font-family:monospace;font-size:11px;color:#a78bfa">' + escHtml(kv[0]) + '</td><td style="font-family:monospace;font-size:11px">' + escHtml(kv[1]) + '</td></tr>';
      }).join('');
      return '<div style="margin-bottom:10px">' +
        '<div style="font-size:12px;font-weight:600;margin-bottom:4px">' + escHtml(m.nodeName) + '</div>' +
        '<table class="data-table"><thead><tr><th>Variable</th><th>New Value</th></tr></thead><tbody>' + kvRows + '</tbody></table>' +
        '</div>';
    }).filter(Boolean).join('');

    const finalKeys = Object.entries(data.finalState || {});
    const finalRows = finalKeys.length
      ? finalKeys.map(function(kv) { return '<tr><td style="font-family:monospace;font-size:11px">' + escHtml(kv[0]) + '</td><td style="font-family:monospace;font-size:11px">' + escHtml(kv[1]) + '</td></tr>'; }).join('')
      : '<tr><td colspan="2" style="color:var(--text-muted)">No variables in final state</td></tr>';

    panel.innerHTML =
      '<div style="margin-bottom:16px">' +
        '<strong style="font-size:13px">Mutations by node</strong>' +
        '<div style="margin-top:8px">' + (mutRows || '<div style="color:var(--text-muted)">No variable mutations found.</div>') + '</div>' +
      '</div>' +
      '<div>' +
        '<strong style="font-size:13px">Final variable state</strong>' +
        '<table class="data-table" style="margin-top:8px"><thead><tr><th>Variable</th><th>Value</th></tr></thead><tbody>' + finalRows + '</tbody></table>' +
      '</div>';
  } catch (e) {
    _apiRunsSynthesizeVarTrace(panel);
  }
}

function _apiRunsSynthesizeVarTrace(panel) {
  const run = _apiRunsCurrentRun;
  const steps = run && run.stepResults || [];

  // Collect all extracted variables per step
  const mutations = steps
    .filter(function(s) { return s.extractedVariables && Object.keys(s.extractedVariables).length > 0; })
    .map(function(s) { return { name: s.stepName, vars: s.extractedVariables }; });

  // Final state = merge all extracted variables (last write wins)
  const finalState = {};
  steps.forEach(function(s) {
    Object.assign(finalState, s.extractedVariables || {});
  });

  if (!mutations.length && !Object.keys(finalState).length) {
    panel.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:16px 0">' +
      'No variables were extracted in this run. To capture variables, add an <strong>Extract Variable</strong> assertion on a step.' +
      '</div>';
    return;
  }

  const mutHtml = mutations.length
    ? mutations.map(function(m) {
        const rows = Object.entries(m.vars).map(function(kv) {
          return '<tr><td style="font-family:monospace;font-size:11px;color:#a78bfa">' + escHtml(kv[0]) + '</td>' +
            '<td style="font-family:monospace;font-size:11px;word-break:break-all">' + escHtml(String(kv[1])) + '</td></tr>';
        }).join('');
        return '<div style="margin-bottom:12px">' +
          '<div style="font-size:12px;font-weight:600;margin-bottom:4px;color:var(--neutral-700)">&#x27A4; ' + escHtml(m.name) + '</div>' +
          '<table class="data-table"><thead><tr><th>Variable</th><th>Extracted Value</th></tr></thead><tbody>' + rows + '</tbody></table>' +
          '</div>';
      }).join('')
    : '<div style="color:var(--text-muted);font-size:12px">No variable mutations in this run.</div>';

  const finalRows = Object.entries(finalState).map(function(kv) {
    return '<tr><td style="font-family:monospace;font-size:11px;color:#a78bfa">' + escHtml(kv[0]) + '</td>' +
      '<td style="font-family:monospace;font-size:11px;word-break:break-all">' + escHtml(String(kv[1])) + '</td></tr>';
  }).join('');

  panel.innerHTML =
    '<div style="font-size:11px;color:var(--neutral-500);margin-bottom:10px;padding:6px 8px;background:var(--neutral-100);border-radius:6px">' +
      '&#x1F4CA; Synthesized from step results — ' + mutations.length + ' step(s) extracted variables' +
    '</div>' +
    '<div style="margin-bottom:16px"><strong style="font-size:13px">Mutations by step</strong>' +
      '<div style="margin-top:8px">' + mutHtml + '</div></div>' +
    '<div><strong style="font-size:13px">Final variable state</strong>' +
      '<table class="data-table" style="margin-top:8px"><thead><tr><th>Variable</th><th>Value</th></tr></thead><tbody>' +
        (finalRows || '<tr><td colspan="2" style="color:var(--text-muted)">No variables captured</td></tr>') +
      '</tbody></table></div>';
}

// ── AI Assertion Suggester (Phase III) ──────────────────────────────────────

async function _apiRunsLoadSuggestPanel(stepId) {
  const panel = document.getElementById('suggest-panel-' + stepId);
  if (!panel || panel.dataset.loaded) return;
  panel.dataset.loaded = '1';
  const runId = _apiRunsCurrentRunId;
  const run   = _apiRunsCurrentRun;
  if (!runId) { panel.innerHTML = '<div style="color:var(--danger);font-size:12px">No active run.</div>'; return; }
  panel.innerHTML = '<div style="color:var(--text-muted);font-size:12px">Analysing response and generating suggestions…</div>';
  try {
    // Fetch collection to get existing assertions for this step (dedup checkpoint)
    var existingAssertionKeys = new Set();
    if (run && run.collectionId) {
      try {
        var colRes = await fetch('/api/api-collections/' + encodeURIComponent(run.collectionId));
        if (colRes.ok) {
          var col = await colRes.json();
          var colStep = (col.steps || []).find(function(s) { return s.id === stepId; });
          if (colStep && Array.isArray(colStep.assertions)) {
            colStep.assertions.forEach(function(a) {
              existingAssertionKeys.add(a.field + '::' + a.operator);
            });
          }
        }
      } catch (e) { /* non-fatal — skip dedup if collection fetch fails */ }
    }

    var res = await fetch('/api/ai-intelligence/steps/' + encodeURIComponent(stepId) + '/suggest-assertions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runId }),
    });
    if (!res.ok) { panel.innerHTML = '<div style="color:var(--danger);font-size:12px">No suggestions available for this request.</div>'; return; }
    var data = await res.json();
    var allSuggestions = data.suggestions || [];

    // Dedup: filter out suggestions whose field+operator already exist in step assertions
    var suggestions = allSuggestions.filter(function(s) {
      return !existingAssertionKeys.has(s.field + '::' + s.operator);
    });
    var skippedCount = allSuggestions.length - suggestions.length;

    if (!suggestions.length) {
      panel.innerHTML = '<div style="color:var(--text-muted);font-size:12px">'
        + (skippedCount > 0
          ? 'All ' + skippedCount + ' suggested assertion' + (skippedCount > 1 ? 's are' : ' is') + ' already added to this request.'
          : 'No suggestions generated for this request.')
        + '</div>';
      return;
    }

    var domainBadge = data.detectedDomain
      ? '<span style="background:rgba(167,139,250,.15);color:#a78bfa;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:600">Domain detected: ' + escHtml(data.detectedDomain) + '</span>'
      : '';
    var skippedNote = skippedCount > 0
      ? '<span style="color:var(--text-muted);font-size:11px">' + skippedCount + ' already added — hidden</span>'
      : '';

    var targetOrder = ['status','header','responseTime','body','array','domain'];
    var grouped = {};
    targetOrder.forEach(function(t) { grouped[t] = []; });
    suggestions.forEach(function(s) {
      var t = s.target || 'body';
      if (!grouped[t]) grouped[t] = [];
      grouped[t].push(s);
    });

    var targetLabels = { status:'Status Code', header:'Headers', responseTime:'Response Time SLA', body:'Body Fields (Observed)', array:'Arrays (Observed)', domain:'Domain-Aware Suggestions' };
    var targetColors = { status:'var(--success)', header:'#38bdf8', responseTime:'#fb923c', body:'var(--neutral-900)', array:'#a78bfa', domain:'#f59e0b' };

    var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap">'
      + '<span style="color:var(--warning);font-size:11px">&#x26A0; Advisory — based on actual observed response. Review before saving.</span>'
      + (domainBadge ? domainBadge : '')
      + (skippedNote ? '<span style="margin-left:auto">' + skippedNote + '</span>' : '<span style="margin-left:auto;font-size:11px;color:var(--text-muted)">' + suggestions.length + ' new suggestions</span>')
      + '</div>';

    targetOrder.forEach(function(t) {
      var group = grouped[t];
      if (!group || !group.length) return;
      html += '<div style="margin-bottom:12px">'
        + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:' + (targetColors[t]||'var(--text-muted)') + ';margin-bottom:5px">' + (targetLabels[t]||t) + '</div>'
        + '<table class="data-table" style="font-size:11px">'
        + '<thead><tr><th>Field</th><th>Operator</th><th>Expected Value</th><th>Confidence</th><th>Rationale</th><th></th></tr></thead><tbody>'
        + group.map(function(s) {
            var confColor = s.confidence >= 85 ? 'var(--success)' : s.confidence >= 70 ? '#fb923c' : 'var(--text-muted)';
            var payloadStr = encodeURIComponent(JSON.stringify(s.assertionPayload || {}));
            var colId = (run && run.collectionId) ? encodeURIComponent(run.collectionId) : '';
            return '<tr>'
              + '<td style="font-family:monospace;word-break:break-all">' + escHtml(s.field || '—') + '</td>'
              + '<td>' + escHtml(s.operator || '—') + '</td>'
              + '<td style="font-family:monospace">' + escHtml(s.expectedValue != null ? String(s.expectedValue) : '—') + '</td>'
              + '<td style="color:' + confColor + ';font-weight:600">' + (s.confidence||0) + '%</td>'
              + '<td style="color:var(--text-muted);max-width:200px;white-space:normal">' + escHtml(s.rationale || '') + '</td>'
              + '<td><button class="tbl-btn" style="white-space:nowrap;color:var(--success)" '
              +   'onclick="_apiRunsAddSuggestion(\'' + escHtml(stepId) + '\',\'' + escHtml(colId) + '\',decodeURIComponent(\'' + payloadStr + '\'))">+ Add</button></td>'
              + '</tr>';
          }).join('')
        + '</tbody></table></div>';
    });

    panel.innerHTML = html;
  } catch (e) {
    panel.innerHTML = '<div style="color:var(--danger);font-size:12px">Failed: ' + escHtml(e.message) + '</div>';
  }
}

async function _apiRunsAddSuggestion(stepId, collectionId, payloadJson) {
  var payload;
  try { payload = JSON.parse(payloadJson); } catch { showToast('error', 'Invalid assertion payload.'); return; }
  if (!payload || !payload.field) return;
  if (!collectionId) { showToast('error', 'Cannot determine collection — reload the run and try again.'); return; }

  var assertion = { field: payload.field, operator: payload.operator, expected: payload.expected, severity: payload.severity || 'high', weight: payload.weight || 7 };

  try {
    // Fetch current collection, inject assertion into the matching request, PUT back
    var colRes = await fetch('/api/api-collections/' + collectionId);
    if (!colRes.ok) throw new Error('Collection fetch failed');
    var col = await colRes.json();
    var step = (col.steps || []).find(function(s) { return s.id === stepId; });
    if (!step) throw new Error('Request not found in collection');
    if (!Array.isArray(step.assertions)) step.assertions = [];
    // Guard: skip if already present
    var alreadyExists = step.assertions.some(function(a) { return a.field === assertion.field && a.operator === assertion.operator; });
    if (alreadyExists) { showToast('info', 'This assertion is already on the request.'); return; }
    step.assertions.push(assertion);
    var saveRes = await fetch('/api/api-collections/' + collectionId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(col),
    });
    if (!saveRes.ok) throw new Error('Save failed (' + saveRes.status + ')');
    showToast('success', 'Assertion saved to request "' + escHtml(step.name || step.id) + '".');
    // Refresh suggest panel so the added assertion no longer appears
    var panel = document.getElementById('suggest-panel-' + stepId);
    if (panel) { delete panel.dataset.loaded; _apiRunsLoadSuggestPanel(stepId); }
  } catch (e) {
    showToast('error', 'Failed to save assertion: ' + e.message);
  }
}

// ── Execution Graph Overlay (Phase D Step 7) ─────────────────────────────────
// Fetches GraphProjection for the run's collection, then overlays step result
// status/duration onto each node. Read-only — projection never mutated.

let _execGraphCy         = null;   // inline Cytoscape instance
let _execGraphFsCy       = null;   // fullscreen Cytoscape instance
let _execGraphProjection = null;   // cached GraphProjection
let _execGraphColId      = null;   // collection ID of cached projection
let _execGraphRun        = null;   // run whose results are overlaid
// Phase D Step 8: cache flakiness report per collection
var _apiRunsFlakinessReport = null;
var _apiRunsFlakinessColId  = null;
var _apiRunsApiDefectCache = {};

async function _apiRunsFetchStepDefect(stepId) {
  if (Object.prototype.hasOwnProperty.call(_apiRunsApiDefectCache, stepId)) {
    return _apiRunsApiDefectCache[stepId];
  }
  try {
    var res = await fetch('/api/api-defects/by-step/' + encodeURIComponent(stepId));
    if (!res.ok) { _apiRunsApiDefectCache[stepId] = null; return null; }
    var data = await res.json();
    var open = (data.defects || []).find(function(d) { return d.status === 'open'; }) || null;
    _apiRunsApiDefectCache[stepId] = open ? { defectKey: open.defectKey, jiraUrl: open.jiraUrl } : null;
    return _apiRunsApiDefectCache[stepId];
  } catch (e) {
    _apiRunsApiDefectCache[stepId] = null;
    return null;
  }
}

// Thin wrapper — delegates to the shared defect modal in 28-defect-modal.js
function _apiRunsFileDefect(runId, stepId) {
  openDefectModal({
    mode: 'api-step',
    runId: runId,
    contextId: stepId,
    onSuccess: function (result) {
      delete _apiRunsApiDefectCache[stepId];
      var refEl = document.getElementById('jira-defect-ref-' + stepId);
      if (refEl) refEl.innerHTML =
        '<span class="api-defect-pill">🔗 <a href="' + escHtml(result.jiraUrl) + '" target="_blank">' +
        escHtml(result.defectKey) + '</a></span>';
    },
  });
}

async function _apiRunsLoadJiraPanel(stepId) {
  var defectEl = document.getElementById('jira-defect-ref-' + stepId);
  var healEl   = document.getElementById('jira-heal-panel-' + stepId);
  if (!defectEl) return;

  var defect = await _apiRunsFetchStepDefect(stepId);
  if (defect) {
    defectEl.innerHTML = '<span class="api-defect-pill">🔗 <a href="' + escHtml(defect.jiraUrl) + '" target="_blank">' + escHtml(defect.defectKey) + '</a></span>';
  }

  var currentRunId = _apiRunsCurrentRun && _apiRunsCurrentRun.id;
  if (!currentRunId || !healEl) return;
  try {
    var r = await fetch('/api/api-defects/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: currentRunId, stepId: stepId }),
    });
    if (!r.ok) return;
    var data = await r.json();
    var suggestions = (data.payload && data.payload.healingSuggestions) ? data.payload.healingSuggestions : [];
    if (suggestions.length === 0) {
      healEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted);">No healing suggestions.</div>';
      return;
    }
    healEl.innerHTML = '<div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-muted);">💡 Healing Suggestions</div>'
      + suggestions.map(function(s) {
        return '<div class="api-heal-card">'
          + '<div style="font-size:11px;font-weight:600;color:#a78bfa;">' + escHtml(s.type.replace(/_/g, ' ').toUpperCase()) + ' \xB7 ' + Math.round(s.confidence * 100) + '% confidence</div>'
          + '<div style="font-size:11px;margin-top:2px;">' + escHtml(s.reason) + '</div>'
          + (s.suggestedUrl !== s.currentUrl ? '<div style="font-size:10px;color:var(--text-muted);margin-top:2px;">→ ' + escHtml(s.suggestedUrl) + '</div>' : '')
          + '</div>';
      }).join('');
  } catch (e) { /* non-fatal */ }
}
// Phase D Step 7 full: cache the full RunGraphProjection (graph + nodeResults merged)
let _execGraphRunGraph   = null;   // cached RunGraphProjection for current run
let _execGraphRunId      = null;   // runId of cached RunGraphProjection

// Status → border/glow color
const _EXEC_STATUS_COLOR = {
  passed:    '#22c55e',
  failed:    '#ef4444',
  error:     '#fb923c',
  skipped:   '#6b7280',
  running:   '#3b82f6',
  degraded:  '#f59e0b',
  pending:   '#555968',
  queued:    '#a78bfa',
  retrying:  '#facc15',
  timed_out: '#f97316',
};

function _execGraphStatusColor(status) {
  return _EXEC_STATUS_COLOR[status] || _EXEC_STATUS_COLOR.pending;
}

// Called when Graph tab is activated for a run.
// Phase D Step 7 full: uses /api/api-runs/:runId/graph which returns RunGraphProjection
// (graph + nodeResults merged with retry history from ExecutionSnapshot).
// Falls back to legacy /api/workflows/:colId/graph if run graph endpoint fails.
async function _execGraphEnsureLoaded(run) {
  _execGraphRun = run;
  const colId = run.collectionId;
  if (!colId) {
    _execGraphSetState('No collectionId on this run — cannot load graph.');
    return;
  }

  // For live runs: always re-fetch to get latest step results
  const isLive = run.status === 'running';

  // Reuse cached RunGraphProjection for same completed run
  if (!isLive && _execGraphRunGraph && _execGraphRunId === run.id) {
    _execGraphRenderRunGraph(_execGraphRunGraph);
    return;
  }

  _execGraphSetState('Loading execution graph…', true);

  try {
    const res = await fetch('/api/api-runs/' + encodeURIComponent(run.id) + '/graph');
    if (res.ok) {
      const runGraph = await res.json();
      _execGraphRunGraph = runGraph;
      _execGraphRunId    = run.id;
      // Also cache the projection for fallback compatibility
      _execGraphProjection = runGraph.graph;
      _execGraphColId      = colId;
      _execGraphRenderRunGraph(runGraph);
      return;
    }
    // Non-fatal fallthrough: log and try legacy endpoint
    console.warn('[exec-graph] run graph endpoint failed (' + res.status + '), falling back to collection projection');
  } catch (e) {
    console.warn('[exec-graph] run graph fetch error:', e.message);
  }

  // Legacy fallback: collection-level projection only (no retry data)
  try {
    if (_execGraphProjection && _execGraphColId === colId) {
      _execGraphRenderOverlay(run, _execGraphProjection);
      return;
    }
    const res2 = await fetch('/api/workflows/' + encodeURIComponent(colId) + '/graph');
    if (!res2.ok) {
      const err = await res2.json().catch(function() { return {}; });
      _execGraphSetState('Graph unavailable: ' + (err.message || err.error || res2.statusText));
      return;
    }
    _execGraphProjection = await res2.json();
    _execGraphColId = colId;
    _execGraphRenderOverlay(run, _execGraphProjection);
  } catch (e2) {
    _execGraphSetState('Network error: ' + e2.message);
  }
}

// Render using the rich RunGraphProjection (nodeResults keyed by stepId)
function _execGraphRenderRunGraph(runGraph) {
  var container = document.getElementById('exec-graph-cy');
  if (!container) return;

  var projection = runGraph.graph;
  if (!projection.nodes || projection.nodes.length === 0) {
    _execGraphSetState('No graph nodes for this collection.');
    return;
  }

  var nodeResults = runGraph.nodeResults || {};
  var isLive = runGraph.runStatus === 'running';

  // Populate run meta in toolbar
  var metaEl = document.getElementById('exec-graph-run-meta');
  if (metaEl) {
    var total = projection.nodes.length;
    var passed = Object.values(nodeResults).filter(function(r) { return r && r.status === 'passed'; }).length;
    var failed = Object.values(nodeResults).filter(function(r) { return r && r.status === 'failed'; }).length;
    metaEl.textContent = ' · ' + total + ' steps · ✓' + passed + ' ✗' + failed;
  }

  // Build element map using nodeResults (richer than plain stepResults)
  var elements = _execGraphBuildElementsFromNodeResults(projection, nodeResults);

  if (_execGraphCy) { _execGraphCy.destroy(); _execGraphCy = null; }

  var stateEl = document.getElementById('exec-graph-state');
  if (stateEl) stateEl.style.display = 'none';
  container.style.display = '';

  /* global cytoscape */
  _execGraphCy = cytoscape({
    container:           container,
    elements:            elements,
    style:               _execGraphCyStyles(),
    layout:              _execGraphCyLayout(projection),
    zoom:                1,
    minZoom:             0.1,
    maxZoom:             4,
    userZoomingEnabled:  true,
    userPanningEnabled:  true,
    boxSelectionEnabled: false,
  });

  _execGraphCy.on('layoutstop', function() { _execGraphCy.fit(undefined, 32); });

  _execGraphCy.on('tap', 'node', function(evt) {
    var d = evt.target.data();
    if (!d.isCluster) {
      var nr = nodeResults[d.id];
      _execGraphShowNodeDetailRich(d, nr);
    }
  });
  _execGraphCy.on('tap', function(evt) {
    if (evt.target === _execGraphCy) _execGraphHideNodeDetail();
  });

  _execGraphRenderTimelineFromNodeResults(runGraph);

  if (isLive) {
    setTimeout(function() {
      if (_apiRunsCurrentRun && _apiRunsCurrentRun.id === runGraph.runId && _apiRunsCurrentRun.status === 'running') {
        _execGraphEnsureLoaded(_apiRunsCurrentRun);
      }
    }, 2500);
  }
}

async function _apiRunsFetchFlakiness(collectionId) {
  if (_apiRunsFlakinessColId === collectionId && _apiRunsFlakinessReport) return _apiRunsFlakinessReport;
  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(collectionId));
    if (res.ok) {
      _apiRunsFlakinessReport = await res.json();
      _apiRunsFlakinessColId  = collectionId;
    }
  } catch (_) { /* non-fatal */ }
  return _apiRunsFlakinessReport;
}

// Build a stepId→result lookup from run.stepResults
function _execGraphBuildResultMap(run) {
  var map = {};
  for (var i = 0; i < (run.stepResults || []).length; i++) {
    var sr = run.stepResults[i];
    map[sr.stepId] = sr;
  }
  return map;
}

function _execGraphRenderOverlay(run, projection) {
  var container = document.getElementById('exec-graph-cy');
  if (!container) return;

  if (!projection.nodes || projection.nodes.length === 0) {
    _execGraphSetState('No graph nodes for this collection.');
    return;
  }

  var resultMap = _execGraphBuildResultMap(run);
  var isLive    = run.status === 'running';

  // Populate run meta in toolbar
  var metaEl2 = document.getElementById('exec-graph-run-meta');
  if (metaEl2) {
    var total2 = projection.nodes.length;
    var stepResults = run.stepResults || [];
    var passed2 = stepResults.filter(function(s) { return s.status === 'passed'; }).length;
    var failed2 = stepResults.filter(function(s) { return s.status === 'failed'; }).length;
    metaEl2.textContent = ' · ' + total2 + ' steps · ✓' + passed2 + ' ✗' + failed2;
  }

  // Build Cytoscape elements with execution status overlay
  var elements = _execGraphBuildElements(projection, resultMap);

  // Destroy previous
  if (_execGraphCy) { _execGraphCy.destroy(); _execGraphCy = null; }

  var stateEl = document.getElementById('exec-graph-state');
  if (stateEl) stateEl.style.display = 'none';
  container.style.display = '';

  /* global cytoscape */
  _execGraphCy = cytoscape({
    container:           container,
    elements:            elements,
    style:               _execGraphCyStyles(),
    layout:              _execGraphCyLayout(projection),
    zoom:                1,
    minZoom:             0.1,
    maxZoom:             4,
    userZoomingEnabled:  true,
    userPanningEnabled:  true,
    boxSelectionEnabled: false,
  });

  _execGraphCy.on('layoutstop', function() { _execGraphCy.fit(undefined, 32); });

  _execGraphCy.on('tap', 'node', function(evt) {
    var d = evt.target.data();
    if (!d.isCluster) _execGraphShowNodeDetail(d, resultMap[d.id]);
  });
  _execGraphCy.on('tap', function(evt) {
    if (evt.target === _execGraphCy) _execGraphHideNodeDetail();
  });

  _execGraphRenderTimeline(run, projection);

  // If run is live, keep refreshing overlay (no full re-fetch — reuse projection)
  if (isLive) {
    setTimeout(function() {
      if (_apiRunsCurrentRun && _apiRunsCurrentRun.id === run.id && _apiRunsCurrentRun.status === 'running') {
        _execGraphEnsureLoaded(_apiRunsCurrentRun);
      }
    }, 2500);
  }
}

function _execGraphBuildElements(projection, resultMap) {
  var elements = [];

  // Cluster compound nodes (same logic as collection graph)
  var clusterNodeIds = {};
  for (var ci = 0; ci < (projection.clusters || []).length; ci++) {
    var cluster = projection.clusters[ci];
    if (cluster.source !== 'hint' && cluster.nodeIds.length > 1) {
      elements.push({
        data: { id: 'cluster-' + cluster.clusterId, label: cluster.label, isCluster: true },
        classes: 'exec-cluster-node',
      });
      clusterNodeIds[cluster.clusterId] = true;
    }
  }

  // Nodes with execution status overlay
  for (var ni = 0; ni < projection.nodes.length; ni++) {
    var node = projection.nodes[ni];
    var result = resultMap[node.id];
    var status = result ? result.status : 'pending';
    var dur    = result ? result.durationMs : null;

    var parent;
    for (var pci = 0; pci < (projection.clusters || []).length; pci++) {
      var pc = projection.clusters[pci];
      if (pc.source !== 'hint' && pc.nodeIds.indexOf(node.id) > -1 && clusterNodeIds[pc.clusterId]) {
        parent = 'cluster-' + pc.clusterId;
        break;
      }
    }

    var classes = ['exec-node', 'exec-status-' + status];
    if (node.disabled) classes.push('exec-node-disabled');

    elements.push({
      data: {
        id:       node.id,
        label:    node.label || node.id,
        nodeType: node.nodeType,
        status:   status,
        dur:      dur,
        layer:    node.layer,
        visualGroup: node.visualGroup,
        hierarchyPath: node.hierarchyPath ? node.hierarchyPath.join(' › ') : '',
        isCluster: false,
        parent:   parent,
      },
      position: { x: node.position ? node.position.x : 0, y: node.position ? node.position.y : 0 },
      classes: classes.join(' '),
    });
  }

  // Edges
  for (var ei = 0; ei < (projection.edges || []).length; ei++) {
    var edge = projection.edges[ei];
    var srcResult = resultMap[edge.source];
    var tgtResult = resultMap[edge.target];
    var edgeClasses = ['exec-edge', 'exec-edge-' + edge.edgeType];
    // Highlight path if both nodes executed
    if (srcResult && tgtResult && srcResult.status !== 'pending' && tgtResult.status !== 'pending') {
      edgeClasses.push('exec-edge-active');
    }
    if (edge.isHeuristic) edgeClasses.push('exec-edge-heuristic');

    elements.push({
      data: { id: edge.id, source: edge.source, target: edge.target, edgeType: edge.edgeType },
      classes: edgeClasses.join(' '),
    });
  }

  return elements;
}

// Phase D Step 7 full: build elements from RunGraphProjection.nodeResults
// nodeResults is keyed by stepId (same as node.id in projection)
function _execGraphBuildElementsFromNodeResults(projection, nodeResults) {
  var elements = [];

  var clusterNodeIds = {};
  for (var ci = 0; ci < (projection.clusters || []).length; ci++) {
    var cluster = projection.clusters[ci];
    if (cluster.source !== 'hint' && cluster.nodeIds.length > 1) {
      elements.push({
        data: { id: 'cluster-' + cluster.clusterId, label: cluster.label, isCluster: true },
        classes: 'exec-cluster-node',
      });
      clusterNodeIds[cluster.clusterId] = true;
    }
  }

  for (var ni = 0; ni < projection.nodes.length; ni++) {
    var node = projection.nodes[ni];
    var nr   = nodeResults[node.id];
    var isHotspot = _apiRunsFlakinessReport && (_apiRunsFlakinessReport.hotspots || []).indexOf(node.id) > -1;
    var status = nr ? nr.status : 'pending';
    var dur    = nr ? nr.durationMs : null;

    var parent;
    for (var pci = 0; pci < (projection.clusters || []).length; pci++) {
      var pc = projection.clusters[pci];
      if (pc.source !== 'hint' && pc.nodeIds.indexOf(node.id) > -1 && clusterNodeIds[pc.clusterId]) {
        parent = 'cluster-' + pc.clusterId;
        break;
      }
    }

    var retryBadge = nr && nr.retryCount > 0 ? ' ↺' + nr.retryCount : '';
    var classes = ['exec-node', 'exec-status-' + status];
    if (node.disabled) classes.push('exec-node-disabled');
    if (nr && nr.retryCount > 0) classes.push('exec-node-retried');
    if (isHotspot) classes.push('exec-node-flaky');

    elements.push({
      data: {
        id:            node.id,
        label:         (isHotspot ? '⚡ ' : '') + (node.label || node.id) + retryBadge,
        nodeType:      node.nodeType,
        status:        status,
        dur:           dur,
        retryCount:    nr ? nr.retryCount : 0,
        layer:         node.layer,
        visualGroup:   node.visualGroup,
        hierarchyPath: node.hierarchyPath ? node.hierarchyPath.join(' › ') : '',
        isCluster:     false,
        parent:        parent,
      },
      position: { x: node.position ? node.position.x : 0, y: node.position ? node.position.y : 0 },
      classes: classes.join(' '),
    });
  }

  for (var ei = 0; ei < (projection.edges || []).length; ei++) {
    var edge = projection.edges[ei];
    var srcNr = nodeResults[edge.source];
    var tgtNr = nodeResults[edge.target];
    var edgeClasses = ['exec-edge', 'exec-edge-' + edge.edgeType];
    if (srcNr && tgtNr && srcNr.status !== 'pending' && tgtNr.status !== 'pending') {
      edgeClasses.push('exec-edge-active');
    }
    if (edge.isHeuristic) edgeClasses.push('exec-edge-heuristic');
    elements.push({
      data: { id: edge.id, source: edge.source, target: edge.target, edgeType: edge.edgeType },
      classes: edgeClasses.join(' '),
    });
  }

  return elements;
}

// Rich node detail panel with retry history from ExecutionSnapshot
function _execGraphShowNodeDetailRich(nodeData, nr) {
  var panel = document.getElementById('exec-graph-node-detail');
  if (!panel) { _execGraphShowNodeDetail(nodeData, null); return; }

  var status = nr ? nr.status : 'pending';
  var color  = _execGraphStatusColor(status);

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">'
    + '<strong style="font-size:13px;word-break:break-word;">' + _escHtml(nodeData.label) + '</strong>'
    + '<button onclick="_execGraphHideNodeDetail()" style="background:none;border:none;color:#9ca3af;cursor:pointer;font-size:16px;padding:0 4px;">✕</button>'
    + '</div>';

  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">'
    + '<span style="background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55;border-radius:4px;padding:2px 8px;font-size:11px;font-weight:600;">'
    + status.toUpperCase() + '</span>';
  if (nr && nr.durationMs != null) {
    html += '<span style="color:#9ca3af;font-size:11px;padding:2px 6px;">' + nr.durationMs + 'ms</span>';
  }
  if (nr && nr.retryCount > 0) {
    html += '<span style="background:#facc1522;color:#facc15;border:1px solid #facc1555;border-radius:4px;padding:2px 8px;font-size:11px;">↺ ' + nr.retryCount + ' retr' + (nr.retryCount === 1 ? 'y' : 'ies') + '</span>';
  }
  html += '</div>';

  if (nodeData.hierarchyPath) {
    html += '<div style="color:#6b7280;font-size:10px;margin-bottom:6px;">' + _escHtml(nodeData.hierarchyPath) + '</div>';
  }

  if (nr && nr.error) {
    html += '<div style="background:#ef444415;border:1px solid #ef444440;border-radius:4px;padding:6px 8px;margin-bottom:8px;font-size:11px;color:#fca5a5;">'
      + _escHtml(nr.error) + '</div>';
  }

  if (nr && nr.assertionFailures && nr.assertionFailures.length > 0) {
    html += '<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Assertion failures:</div><ul style="margin:0 0 8px 0;padding-left:16px;font-size:11px;color:#fca5a5;">';
    for (var i = 0; i < nr.assertionFailures.length; i++) {
      html += '<li>' + _escHtml(nr.assertionFailures[i]) + '</li>';
    }
    html += '</ul>';
  }

  if (nr && nr.retryHistory && nr.retryHistory.length > 0) {
    html += '<div style="font-size:11px;color:#9ca3af;margin-bottom:4px;">Retry history:</div>';
    html += '<div style="display:flex;flex-direction:column;gap:4px;">';
    for (var ri = 0; ri < nr.retryHistory.length; ri++) {
      var rh = nr.retryHistory[ri];
      var rhColor = _execGraphStatusColor(rh.resultStatus);
      html += '<div style="background:#1e2130;border-radius:4px;padding:4px 8px;font-size:11px;">'
        + '<span style="color:' + rhColor + ';font-weight:600;">Attempt ' + (rh.attempt + 1) + '</span>'
        + ' <span style="color:#9ca3af;">' + rh.durationMs + 'ms</span>'
        + (rh.httpStatus ? ' <span style="color:#6b7280;">HTTP ' + rh.httpStatus + '</span>' : '')
        + (rh.error ? '<div style="color:#fca5a5;margin-top:2px;">' + _escHtml(rh.error) + '</div>' : '')
        + '</div>';
    }
    html += '</div>';
  }

  panel.innerHTML = html;
  panel.style.display = 'block';
}

function _escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Render timeline bar chart from RunGraphProjection (uses nodeResults timing)
function _execGraphRenderTimelineFromNodeResults(runGraph) {
  var el = document.getElementById('exec-graph-timeline');
  if (!el) return;

  var nodeResults = runGraph.nodeResults || {};
  var entries = Object.values(nodeResults).filter(function(nr) {
    return nr.startedAt && nr.completedAt;
  });

  if (entries.length === 0) {
    // Fall back to old timeline using run.stepResults if no timing data
    if (_execGraphRun) _execGraphRenderTimeline(_execGraphRun, runGraph.graph);
    return;
  }

  var runStart = new Date(runGraph.startedAt).getTime();
  var runEnd   = new Date(runGraph.completedAt).getTime() || Date.now();
  var totalMs  = Math.max(runEnd - runStart, 1);

  var html = '<div style="font-size:11px;color:#6b7280;margin-bottom:6px;">Timeline</div>';
  html += '<div style="display:flex;flex-direction:column;gap:3px;">';

  entries.sort(function(a, b) { return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(); });

  for (var i = 0; i < entries.length; i++) {
    var nr = entries[i];
    var start = new Date(nr.startedAt).getTime() - runStart;
    var dur   = nr.durationMs || 0;
    var left  = Math.max(0, (start / totalMs) * 100);
    var width = Math.max(0.5, (dur / totalMs) * 100);
    var color = _execGraphStatusColor(nr.status);
    var retryTip = nr.retryCount > 0 ? ' ↺' + nr.retryCount : '';
    html += '<div style="display:flex;align-items:center;gap:6px;">'
      + '<div style="width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;color:#9ca3af;flex-shrink:0;" title="' + _escHtml(nr.stepName) + '">' + _escHtml(nr.stepName) + '</div>'
      + '<div style="flex:1;position:relative;height:12px;background:#1e2130;border-radius:2px;">'
      + '<div style="position:absolute;left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%;height:100%;background:' + color + ';border-radius:2px;" title="' + nr.durationMs + 'ms' + retryTip + '"></div>'
      + '</div>'
      + '<div style="width:40px;text-align:right;font-size:10px;color:#6b7280;flex-shrink:0;">' + dur + 'ms</div>'
      + '</div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

function _execGraphCyStyles() {
  return [
    // Base node
    { selector: 'node.exec-node', style: {
      shape: 'round-rectangle', width: 'label', height: 30, padding: '6px 12px',
      'background-color': '#1c1c20', 'border-width': 2, 'border-color': '#555968',
      label: 'data(label)', 'font-size': 11, color: '#e2e8f0',
      'text-valign': 'center', 'text-halign': 'center',
      'text-wrap': 'ellipsis', 'text-max-width': 150, 'min-width': 80, cursor: 'pointer',
    }},
    // Status border colors
    { selector: 'node.exec-status-passed',  style: { 'border-color': '#22c55e', 'background-color': 'rgba(34,197,94,.12)' }},
    { selector: 'node.exec-status-failed',  style: { 'border-color': '#ef4444', 'background-color': 'rgba(239,68,68,.15)', 'border-width': 2.5 }},
    { selector: 'node.exec-status-error',   style: { 'border-color': '#fb923c', 'background-color': 'rgba(251,146,60,.12)', 'border-width': 2.5 }},
    { selector: 'node.exec-status-skipped', style: { 'border-color': '#6b7280', 'background-color': 'rgba(107,114,128,.08)', opacity: 0.6 }},
    { selector: 'node.exec-status-running', style: { 'border-color': '#3b82f6', 'background-color': 'rgba(59,130,246,.15)', 'border-style': 'dashed' }},
    { selector: 'node.exec-status-degraded',style: { 'border-color': '#f59e0b', 'background-color': 'rgba(245,158,11,.12)' }},
    { selector: 'node.exec-status-pending', style: { 'border-color': '#2a2a30', 'background-color': '#1c1c20', opacity: 0.5 }},
    { selector: 'node.exec-node-disabled',  style: { opacity: 0.35 }},
    { selector: 'node.exec-node-flaky', style: {
        'border-color': '#facc15',
        'border-width': 3,
        'border-style': 'dashed',
    }},
    { selector: 'node:selected',            style: { 'border-width': 3, 'overlay-opacity': 0.08 }},
    { selector: 'node.exec-cluster-node',   style: {
      'background-color': 'rgba(245,158,11,.05)', 'border-color': 'rgba(245,158,11,.2)',
      'border-width': 1, 'border-style': 'dashed', label: 'data(label)',
      'font-size': 10, color: '#6b7280', 'text-valign': 'top', 'text-halign': 'center', padding: 14,
    }},
    // Edges
    { selector: 'edge.exec-edge', style: {
      width: 1.5, 'line-color': '#2a2a30', 'target-arrow-color': '#2a2a30',
      'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'arrow-scale': 0.8,
    }},
    { selector: 'edge.exec-edge-active',    style: { 'line-color': '#555968', 'target-arrow-color': '#555968' }},
    { selector: 'edge.exec-edge-depends_on',style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b', width: 2 }},
    { selector: 'edge.exec-edge-inferred',  style: { 'line-style': 'dashed', width: 1.5 }},
    { selector: 'edge.exec-edge-heuristic', style: { 'line-style': 'dotted', opacity: 0.5 }},
    { selector: 'edge:selected',            style: { 'line-color': '#fff', 'target-arrow-color': '#fff' }},
  ];
}

function _execGraphCyLayout(projection) {
  var strategy = projection.meta && projection.meta.projectionStrategy;
  if (strategy === 'stored') return { name: 'preset', animate: false, fit: true, padding: 32 };
  return { name: 'breadthfirst', directed: true, spacingFactor: 1.4, animate: false, padding: 32, avoidOverlap: true };
}

// ── Timeline bar chart ────────────────────────────────────────────────────────
function _execGraphRenderTimeline(run, projection) {
  var tlEl   = document.getElementById('exec-graph-timeline');
  var barsEl = document.getElementById('exec-graph-timeline-bars');
  if (!tlEl || !barsEl) return;

  var results = run.stepResults || [];
  if (results.length === 0) { tlEl.style.display = 'none'; return; }

  var maxDur = 1;
  for (var i = 0; i < results.length; i++) {
    if ((results[i].durationMs || 0) > maxDur) maxDur = results[i].durationMs;
  }

  var html = '';
  for (var j = 0; j < results.length; j++) {
    var sr    = results[j];
    var pct   = Math.max(2, Math.round(((sr.durationMs || 0) / maxDur) * 100));
    var cls   = 'exec-tl-' + (sr.status || 'pending');
    var label = sr.stepName || sr.stepId;
    if (label.length > 28) label = label.slice(0, 26) + '…';
    html += '<div class="exec-graph-timeline-row">' +
      '<div class="exec-graph-timeline-label" title="' + escHtml(sr.stepName || '') + '">' + escHtml(label) + '</div>' +
      '<div class="exec-graph-timeline-bar-wrap">' +
        '<div class="exec-graph-timeline-bar ' + cls + '" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<div class="exec-graph-timeline-dur">' + (sr.durationMs != null ? sr.durationMs + 'ms' : '—') + '</div>' +
      '</div>';
  }

  barsEl.innerHTML = html;
  tlEl.style.display = '';
}

// ── Node detail panel ─────────────────────────────────────────────────────────
function _execGraphShowNodeDetail(nodeData, stepResult) {
  var panel = document.getElementById('exec-graph-node-detail');
  if (!panel) return;

  var statusColor = _execGraphStatusColor(nodeData.status);
  var rows = [
    ['Status',   '<span style="color:' + statusColor + ';font-weight:700">' + escHtml(nodeData.status || '—') + '</span>'],
    ['Duration', stepResult ? stepResult.durationMs + 'ms' : '—'],
    ['Type',     nodeData.nodeType || '—'],
    ['Group',    nodeData.visualGroup || '—'],
    ['Path',     nodeData.hierarchyPath || '—'],
  ];

  var assertSummary = '';
  if (stepResult && stepResult.assertionResults && stepResult.assertionResults.length) {
    var passed = stepResult.assertionResults.filter(function(a) { return a.passed; }).length;
    assertSummary = passed + '/' + stepResult.assertionResults.length + ' passed';
    rows.push(['Assertions', assertSummary]);
  }
  if (stepResult && stepResult.error) {
    rows.push(['Error', '<span style="color:#ef4444">' + escHtml(stepResult.error) + '</span>']);
  }

  var rowsHtml = rows.map(function(r) {
    return '<div class="exec-graph-node-detail-row">' +
      '<span class="exec-graph-node-detail-label">' + escHtml(r[0]) + '</span>' +
      '<span style="color:var(--neutral-900)">' + r[1] + '</span>' +
      '</div>';
  }).join('');

  panel.style.display = '';
  panel.innerHTML =
    '<div class="exec-graph-node-detail-title" style="color:' + statusColor + '">' +
      escHtml(nodeData.label || nodeData.id) +
    '</div>' + rowsHtml;
}

function _execGraphHideNodeDetail() {
  var panel = document.getElementById('exec-graph-node-detail');
  if (panel) panel.style.display = 'none';
}

// ── State helpers ─────────────────────────────────────────────────────────────
function _execGraphSetState(msg, loading) {
  var stateEl = document.getElementById('exec-graph-state');
  var cyEl    = document.getElementById('exec-graph-cy');
  var tlEl    = document.getElementById('exec-graph-timeline');
  if (stateEl) {
    stateEl.style.display = '';
    stateEl.innerHTML = loading
      ? '<div class="spinner" style="width:24px;height:24px"></div><span>' + escHtml(msg) + '</span>'
      : '<span>' + escHtml(msg) + '</span>';
  }
  if (cyEl) cyEl.style.display = 'none';
  if (tlEl) tlEl.style.display = 'none';
  _execGraphHideNodeDetail();
}

function _execGraphReset() {
  _execGraphSetState('Loading execution graph…');
  // Switch tabs without triggering graph load (pass internal flag)
  document.querySelectorAll('.api-run-tab-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.tab === 'steps'); });
  document.querySelectorAll('.api-run-tab-panel').forEach(function(p) { p.style.display = p.dataset.tab === 'steps' ? '' : 'none'; });
  if (_execGraphCy) { _execGraphCy.destroy(); _execGraphCy = null; }
  // Reset AI Insights lazy-load flag so fresh data is fetched on next activation
  var aiPanel = document.getElementById('ai-insights-panel-run');
  if (aiPanel) { delete aiPanel.dataset.loaded; aiPanel.innerHTML = ''; }
}

function _execGraphDestroy() {
  if (_execGraphCy) { _execGraphCy.destroy(); _execGraphCy = null; }
  if (_execGraphFsCy) { _execGraphFsCy.destroy(); _execGraphFsCy = null; }
  _execGraphRun = null;
}

// ── Toolbar buttons ───────────────────────────────────────────────────────────
function apiRunsGraphFit() {
  if (_execGraphCy) _execGraphCy.fit(undefined, 32);
}

// ── Fullscreen modal ──────────────────────────────────────────────────────────
function apiRunsGraphFullscreen() {
  if (!_execGraphRun || !_execGraphProjection) return;
  var col = null;
  // Try to get collection name from cached data
  if (typeof _apiCols !== 'undefined') {
    col = _apiCols.find(function(c) { return c.id === _execGraphRun.collectionId; });
  }
  var titleEl = document.getElementById('exec-graph-fs-title');
  if (titleEl) titleEl.textContent = (col ? col.name : 'Execution') + ' — Run Graph';
  document.getElementById('modal-exec-graph-fullscreen').style.display = '';

  var fsContainer = document.getElementById('exec-graph-fs-cy');
  if (!fsContainer) return;
  if (_execGraphFsCy) { _execGraphFsCy.destroy(); _execGraphFsCy = null; }

  var resultMap = _execGraphBuildResultMap(_execGraphRun);
  var elements  = _execGraphBuildElements(_execGraphProjection, resultMap);

  _execGraphFsCy = cytoscape({
    container:           fsContainer,
    elements:            elements,
    style:               _execGraphCyStyles(),
    layout:              _execGraphCyLayout(_execGraphProjection),
    zoom:                1,
    minZoom:             0.05,
    maxZoom:             4,
    userZoomingEnabled:  true,
    userPanningEnabled:  true,
    boxSelectionEnabled: false,
  });
  _execGraphFsCy.on('layoutstop', function() { _execGraphFsCy.fit(undefined, 40); });
}

function apiRunsGraphFullscreenClose() {
  document.getElementById('modal-exec-graph-fullscreen').style.display = 'none';
  if (_execGraphFsCy) { _execGraphFsCy.destroy(); _execGraphFsCy = null; }
}

function apiRunsGraphFullscreenFit() {
  if (_execGraphFsCy) _execGraphFsCy.fit(undefined, 40);
}

// ── AI Insights Panel (Phase D Step 14) ──────────────────────────────────────
// Advisory recommendations and RCA hints for a run. Lazy-loaded on tab click.
// ADVISORY ONLY — never mutates collections, runtime, or WorkflowEnvelope.

async function _apiRunsRenderAiInsights(runId, collectionId, container) {
  container.innerHTML = '<div class="ai-insights-loading">Loading AI insights…</div>';
  try {
    const [recRes, rcaRes, propRes] = await Promise.all([
      fetch(`/api/ai-intelligence/collections/${encodeURIComponent(collectionId)}/recommendations`),
      fetch(`/api/ai-intelligence/runs/${encodeURIComponent(runId)}/rca-hints`),
      fetch(`/api/remediation/collections/${encodeURIComponent(collectionId)}/proposals`),
    ]);

    const recBundle = recRes.ok ? await recRes.json() : null;
    const rcaBundle = rcaRes.ok ? await rcaRes.json() : null;
    const propData  = propRes.ok ? await propRes.json() : null;

    let html = `<div class="ai-insights-advisory">⚠️ ${_aiEscHtml(recBundle?.advisoryNote ?? 'AI recommendations are advisory only.')}</div>`;

    // RCA Hints section
    if (rcaBundle && rcaBundle.hints && rcaBundle.hints.length > 0) {
      html += '<div class="ai-insights-section"><h4>RCA Hints</h4><ul class="ai-hints-list">';
      for (const hint of rcaBundle.hints) {
        const conf = hint.confidence;
        const confClass = conf >= 85 ? 'ai-conf-high' : conf >= 65 ? 'ai-conf-med' : 'ai-conf-low';
        html += `<li class="ai-hint-item">
          <span class="ai-hint-title">${_aiEscHtml(hint.title)}</span>
          <span class="ai-conf-badge ${confClass}">${conf}% confidence</span>
          <div class="ai-hint-cause">${_aiEscHtml(hint.probableCause)}</div>
        </li>`;
      }
      html += '</ul></div>';
    } else if (rcaBundle) {
      html += '<div class="ai-insights-section"><h4>RCA Hints</h4><p class="ai-empty">No anomalies detected in replay events for this run.</p></div>';
    } else {
      html += '<div class="ai-insights-section"><h4>RCA Hints</h4><p class="ai-empty">No replay session available for this run. Execute the collection to generate replay data.</p></div>';
    }

    // Recommendations section
    if (recBundle && recBundle.recommendations && recBundle.recommendations.length > 0) {
      html += '<div class="ai-insights-section"><h4>Collection Recommendations</h4><ul class="ai-rec-list">';
      for (const rec of recBundle.recommendations) {
        const sevClass = { critical: 'ai-sev-critical', warning: 'ai-sev-warning', info: 'ai-sev-info' }[rec.severity] || 'ai-sev-info';
        html += `<li class="ai-rec-item ${sevClass}">
          <div class="ai-rec-header">
            <span class="ai-sev-badge">${rec.severity.toUpperCase()}</span>
            <span class="ai-rec-title">${_aiEscHtml(rec.title)}</span>
            <span class="ai-conf-badge">${rec.confidence}%</span>
          </div>
          <div class="ai-rec-detail">${_aiEscHtml(rec.detail)}</div>
          <div class="ai-rec-action"><strong>Action:</strong> ${_aiEscHtml(rec.actionHint)}</div>
        </li>`;
      }
      html += '</ul></div>';
    } else if (recBundle) {
      html += '<div class="ai-insights-section"><h4>Collection Recommendations</h4><p class="ai-empty">No recommendations — collection looks healthy.</p></div>';
    }

    // Remediation Proposals section
    html += '<div class="ai-insights-section"><h4>Remediation Proposals</h4>';
    if (propData && propData.proposals && propData.proposals.length > 0) {
      html += `<p class="ai-remediation-advisory">${_aiEscHtml(propData.advisoryNote ?? '')}</p>`;
      html += '<ul class="ai-proposal-list">';
      for (const prop of propData.proposals) {
        const statusCls = 'ai-prop-' + _aiEscHtml(prop.status);
        const canAct = prop.status === 'pending-approval';
        const diffRows = (prop.diff || []).map(function(ch) {
          return '<tr><td>' + _aiEscHtml(ch.humanLabel) + '</td>' +
            '<td class="ai-diff-before">' + _aiEscHtml(String(ch.before)) + '</td>' +
            '<td class="ai-diff-after">' + _aiEscHtml(String(ch.after)) + '</td></tr>';
        }).join('');
        const safeId = _aiEscHtml(prop.id);
        const safeCol = _aiEscHtml(collectionId);
        html += `<li class="ai-proposal-item ${statusCls}">
          <div class="ai-prop-header">
            <span class="ai-prop-type-badge">${_aiEscHtml(prop.type)}</span>
            <span class="ai-prop-title">${_aiEscHtml(prop.title)}</span>
            <span class="ai-conf-badge">${_aiEscHtml(String(prop.confidence))}%</span>
            <span class="ai-prop-status-badge">${_aiEscHtml(prop.status)}</span>
          </div>
          <div class="ai-prop-rationale">${_aiEscHtml(prop.rationale)}</div>
          ${diffRows ? '<table class="ai-prop-diff-table"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>' + diffRows + '</tbody></table>' : ''}
          ${canAct ? '<div class="ai-prop-actions">' +
            '<button class="ai-prop-approve-btn" onclick="_apiRunsApproveProposal(\'' + _aiEscHtml(prop.id) + '\', this)">Approve</button>' +
            '<button class="ai-prop-reject-btn" onclick="_apiRunsRejectProposal(\'' + _aiEscHtml(prop.id) + '\', this)">Reject</button>' +
            '</div>' : ''}
        </li>`;
      }
      html += '</ul>';
    } else {
      html += '<p class="ai-empty">No proposals generated yet.</p>';
      html += '<button class="ai-generate-proposals-btn" onclick="_apiRunsGenerateProposals(\'' +
        _aiEscHtml(collectionId) + '\', this)">Generate Remediation Proposals</button>';
    }
    html += '</div>';

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="ai-insights-error">Failed to load AI insights: ${_aiEscHtml(String(err))}</div>`;
  }
}

function _aiEscHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function _apiRunsGenerateProposals(collectionId, btn) {
  if (!collectionId || collectionId === 'undefined' || collectionId === 'null') {
    showToast('Cannot generate proposals — collection ID not available for this run.', 'error');
    return;
  }
  btn.disabled = true;
  btn.textContent = '⟳ Generating…';
  try {
    var res = await fetch('/api/remediation/collections/' + encodeURIComponent(collectionId) + '/proposals', { method: 'POST' });
    if (!res.ok) {
      const errBody = await res.json().catch(function() { return {}; });
      const errMsg = errBody.error || errBody.reason || res.statusText;
      throw new Error('Server returned ' + res.status + ': ' + errMsg);
    }
    const result = await res.json();
    const count = result.proposals ? result.proposals.length : 0;
    if (count === 0) {
      btn.disabled = false;
      btn.textContent = 'Generate Remediation Proposals';
      showToast('No actionable proposals could be generated. The current recommendations do not have step-level targets that map to remediation actions.', 'warning');
      return;
    }
    showToast(count + ' remediation proposal' + (count === 1 ? '' : 's') + ' generated', 'success');
    var panel = document.getElementById('ai-insights-panel-run');
    if (panel) { panel.removeAttribute('data-loaded'); }
    if (_apiRunsCurrentRun && panel) {
      _apiRunsRenderAiInsights(_apiRunsCurrentRun.id, _apiRunsCurrentRun.collectionId, panel);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Generate Remediation Proposals';
    showToast('Failed: ' + String(err), 'error');
  }
}

async function _apiRunsApproveProposal(proposalId, btn) {
  btn.disabled = true;
  try {
    var res = await fetch('/api/remediation/proposals/' + encodeURIComponent(proposalId) + '/approve', { method: 'POST' });
    if (!res.ok) throw new Error(await res.text());
    var panel = document.getElementById('ai-insights-panel-run');
    if (panel) { panel.removeAttribute('data-loaded'); }
    if (_apiRunsCurrentRun && panel) {
      _apiRunsRenderAiInsights(_apiRunsCurrentRun.id, _apiRunsCurrentRun.collectionId, panel);
    }
  } catch (err) {
    btn.disabled = false;
    alert('Approval failed: ' + String(err));
  }
}

async function _apiRunsRejectProposal(proposalId, btn) {
  var comment = prompt('Rejection reason (optional):') || '';
  btn.disabled = true;
  try {
    var res = await fetch('/api/remediation/proposals/' + encodeURIComponent(proposalId) + '/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewComment: comment || undefined }),
    });
    if (!res.ok) throw new Error(await res.text());
    var panel = document.getElementById('ai-insights-panel-run');
    if (panel) { panel.removeAttribute('data-loaded'); }
    if (_apiRunsCurrentRun && panel) {
      _apiRunsRenderAiInsights(_apiRunsCurrentRun.id, _apiRunsCurrentRun.collectionId, panel);
    }
  } catch (err) {
    btn.disabled = false;
    alert('Rejection failed: ' + String(err));
  }
}

// ── Observability Tab (integrated from Replay page) ───────────────────────────

async function _apiRunsLoadObservability(runId, panel) {
  panel.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px;">Loading observability data…</div>';
  try {
    var res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/observability');
    if (!res.ok) {
      panel.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:12px;">No observability data available for this run.</div>';
      return;
    }
    var summary = await res.json();
    _apiRunsRenderObservability(runId, summary, panel);
  } catch (e) {
    panel.innerHTML = '<div style="color:var(--flaky-danger);font-size:13px;padding:12px;">Error loading observability: ' + escHtml(e.message) + '</div>';
  }
}

function _apiRunsRenderObservability(runId, summary, panel) {
  var replay = summary.replay || {};
  var stats = replay.stats || {};

  var statusBadge = summary.status === 'passed'
    ? '<span class="badge badge-green">PASSED</span>'
    : '<span class="badge badge-red">FAILED</span>';

  var html =
    // Summary header
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">'
    + statusBadge
    + '<span style="font-size:12px;color:var(--text-muted)">'
    + escHtml((summary.startedAt || '').replace('T',' ').slice(0,19))
    + ' &middot; ' + (summary.stepCount || 0) + ' steps'
    + (summary.hasSnapshot ? ' &middot; <span style="color:var(--brand)">snapshot</span>' : '')
    + (summary.hasTimeline ? ' &middot; <span style="color:var(--brand)">timeline</span>' : '')
    + '</span>'
    + '</div>'

    // Stat cards
    + '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px">'
    + _obsCard(stats.requestsSent || 0,       'Requests Sent',       'var(--neutral-600)')
    + _obsCard(stats.assertionsPassed || 0,   'Assertions Passed',   '#16a34a')
    + _obsCard(stats.assertionsFailed || 0,   'Assertions Failed',   '#dc2626')
    + _obsCard(stats.retriesTriggered || 0,   'Retries',             '#b45309')
    + _obsCard(stats.teardownEvents || 0,     'Teardown Events',     'var(--brand)')
    + _obsCard(stats.failuresPropagated || 0, 'Failures Propagated', '#dc2626')
    + '</div>'

    // Inner tab bar — Snapshot removed (limited standalone value)
    + '<div style="display:flex;gap:6px;margin-bottom:12px;border-bottom:1px solid var(--neutral-200);padding-bottom:8px">'
    + '<button class="tbl-btn obs-inner-tab active" onclick="_obsLoadEvents(' + JSON.stringify(runId) + ')">Replay Events (' + (replay.eventCount || 0) + ')</button>'
    + '</div>'
    + '<div id="obs-inner-content-' + escHtml(runId) + '"></div>';

  panel.innerHTML = html;

  // Auto-load events
  _obsLoadEvents(runId);
}

function _obsCard(value, label, color) {
  return '<div style="padding:10px 16px;border:1px solid var(--neutral-200);border-radius:8px;min-width:110px;text-align:center">'
    + '<div style="font-size:20px;font-weight:700;color:' + color + '">' + value + '</div>'
    + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">' + escHtml(label) + '</div>'
    + '</div>';
}

function _obsTab(btn, tab, runId) {
  btn.closest('div').querySelectorAll('.obs-inner-tab').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  if (tab === 'events') _obsLoadEvents(runId);
  else if (tab === 'snapshot') _obsLoadSnapshot(runId);
}

async function _obsLoadEvents(runId) {
  var el = document.getElementById('obs-inner-content-' + runId);
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Loading replay events…</div>';
  try {
    var res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/replay-events');
    if (!res.ok) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">No replay events available.</div>'; return; }
    var session = await res.json();
    // Filter out bookkeeping events — step-completed adds no user value
    var events = (session.events || []).filter(function(ev) {
      var k = ev.kind || '';
      return k !== 'step-completed' && k !== 'step-started';
    });
    if (!events.length) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">No replay events recorded for this run.</div>'; return; }

    el.innerHTML = '<div style="max-height:400px;overflow-y:auto">'
      + '<table class="data-table" style="margin:0">'
      + '<thead style="position:sticky;top:0;z-index:2"><tr>'
        + '<th style="width:130px">Event</th>'
        + '<th style="width:150px">Request</th>'
        + '<th>Detail</th>'
        + '<th style="width:80px;text-align:center">Result</th>'
        + '<th style="width:80px;text-align:right">Duration</th>'
      + '</tr></thead>'
      + '<tbody>'
      + events.map(function(ev) {
          var kind = ev.kind || '';
          var eventBadge = _obsEventBadge(kind);
          var detail = _obsEventDetail(ev);
          var result = _obsResultBadge(ev);
          var dur = ev.durationMs != null ? ev.durationMs + 'ms' : '—';
          return '<tr>'
            + '<td>' + eventBadge + '</td>'
            + '<td style="font-size:12px;font-weight:500">' + escHtml(ev.stepName || '—') + '</td>'
            + '<td style="font-size:12px;color:var(--text-muted)">' + detail + '</td>'
            + '<td style="text-align:center">' + result + '</td>'
            + '<td style="text-align:right;font-size:12px;color:var(--text-muted)">' + dur + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table></div>';
  } catch (e) {
    el.innerHTML = '<div style="color:var(--flaky-danger);font-size:12px;">Error: ' + escHtml(e.message) + '</div>';
  }
}

function _obsEventBadge(kind) {
  var label, bg, color;
  if (kind === 'request-sent')        { label = '→ Request Sent';    bg = 'rgba(37,99,235,.1)';   color = '#2563eb'; }
  else if (kind === 'response-received') { label = '← Response';     bg = 'rgba(124,58,237,.1)';  color = '#7c3aed'; }
  else if (kind === 'assertion-passed')  { label = '✓ Assertion';    bg = 'rgba(22,163,74,.1)';   color = '#16a34a'; }
  else if (kind === 'assertion-failed')  { label = '✗ Assertion';    bg = 'rgba(220,38,38,.1)';   color = '#dc2626'; }
  else if (kind === 'variable-extracted'){ label = '⬇ Variable';     bg = 'rgba(180,83,9,.1)';    color = '#b45309'; }
  else if (kind === 'failure-propagated'){ label = '✗ Failure';      bg = 'rgba(220,38,38,.12)';  color = '#dc2626'; }
  else if (kind === 'step-skipped')      { label = '⊘ Skipped';      bg = 'rgba(107,114,128,.1)'; color = '#6b7280'; }
  else if (kind === 'retry-triggered')   { label = '↺ Retry';        bg = 'rgba(180,83,9,.1)';    color = '#b45309'; }
  else                                   { label = escHtml(kind.replace(/-/g,' ')); bg = 'rgba(107,114,128,.08)'; color = 'var(--text-muted)'; }
  return '<span style="font-size:11px;padding:2px 7px;border-radius:4px;font-weight:600;white-space:nowrap;background:' + bg + ';color:' + color + '">' + label + '</span>';
}

function _obsEventDetail(ev) {
  if (ev.request)    return escHtml(ev.request.method + ' ' + ev.request.url);
  if (ev.assertion)  return (ev.assertion.passed ? '✓ ' : '✗ ') + escHtml(ev.assertion.type) + (ev.assertion.message ? ': ' + escHtml(ev.assertion.message) : '');
  if (ev.variable)   return escHtml(ev.variable.key) + ' = ' + escHtml(ev.variable.maskedValue);
  if (ev.failure)    return escHtml(ev.failure.reason);
  if (ev.skipReason) return escHtml(ev.skipReason);
  return '—';
}

function _obsResultBadge(ev) {
  if (!ev.response) return '<span style="color:var(--text-muted);font-size:11px">—</span>';
  var status = ev.response.status;
  var bg = status >= 500 ? 'rgba(220,38,38,.1)'
    : status >= 400 ? 'rgba(180,83,9,.1)'
    : status >= 200 ? 'rgba(22,163,74,.1)'
    : 'rgba(107,114,128,.1)';
  var color = status >= 500 ? '#dc2626'
    : status >= 400 ? '#b45309'
    : status >= 200 ? '#16a34a'
    : '#6b7280';
  return '<span style="font-size:11px;padding:2px 7px;border-radius:4px;font-weight:700;background:' + bg + ';color:' + color + '">' + status + '</span>';
}

async function _obsLoadSnapshot(runId) {
  var el = document.getElementById('obs-inner-content-' + runId);
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;">Loading snapshot…</div>';
  try {
    var res = await fetch('/api/api-runs/' + encodeURIComponent(runId) + '/observability');
    var obs = res.ok ? await res.json() : null;
    var snap = obs && obs.snapshotSummary;
    if (!snap) { el.innerHTML = '<div style="color:var(--text-muted);font-size:12px;padding:8px;">No snapshot available for this run.</div>'; return; }
    el.innerHTML = '<div style="padding:12px;border:1px solid var(--neutral-200);border-radius:6px;font-size:12px">'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + _obsSnapshotRow('Captured at', (snap.capturedAt || '').replace('T',' ').slice(0,19))
      + _obsSnapshotRow('Completed nodes', snap.completedNodeIds)
      + _obsSnapshotRow('Failed nodes', snap.failedNodeIds)
      + _obsSnapshotRow('Skipped nodes', snap.skippedNodeIds)
      + '</div>'
      + '</div>';
  } catch (e) {
    el.innerHTML = '<div style="color:var(--flaky-danger);font-size:12px;">Error: ' + escHtml(e.message) + '</div>';
  }
}

// ── Data File CSV Exports ──────────────────────────────────────────────────────

function _apiRunsCsvEscape(v) {
  const s = String(v ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n') ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function _apiRunsCsvDownload(filename, rows) {
  const csv = rows.map(r => r.map(_apiRunsCsvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function _apiRunsExportSummaryCsv() {
  const run = _apiRunsCurrentRun;
  if (!run) return;
  const iters = run.iterationSummary || [];
  const header = ['Row', 'Identifier', 'Status', 'Duration (ms)'];
  const rows = [header, ...iters.map((it, i) => [
    i + 1,
    it.rowIdentifier ?? '',
    it.status,
    it.durationMs ?? 0,
  ])];
  _apiRunsCsvDownload(`run-summary-${run.id}.csv`, rows);
}

function _apiRunsExportDetailCsv() {
  const run = _apiRunsCurrentRun;
  if (!run) return;
  const steps = run.stepResults || [];
  const header = ['Row', 'Row Identifier', 'Step Name', 'Status', 'HTTP Status', 'Duration (ms)', 'Assertion Failures'];
  const rows = [header, ...steps.map(s => {
    const failedAsserts = (s.assertionResults || []).filter(a => !a.passed).map(a => a.message).join('; ');
    return [
      s.iterationIndex !== undefined ? s.iterationIndex + 1 : 1,
      s.rowIdentifier ?? '',
      s.stepName ?? s.stepId,
      s.status,
      s.response?.status ?? '',
      s.durationMs ?? 0,
      failedAsserts,
    ];
  })];
  _apiRunsCsvDownload(`run-detail-${run.id}.csv`, rows);
}

function _obsSnapshotRow(label, value) {
  return '<div style="padding:8px;border:1px solid var(--neutral-200);border-radius:6px">'
    + '<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">' + escHtml(label) + '</div>'
    + '<div style="font-weight:600">' + escHtml(String(value ?? '—')) + '</div>'
    + '</div>';
}
// Shared Defect-to-Jira modal — works for both UI-test and API-step failures.
// Usage:
//   openDefectModal(runId, testId)                          ← legacy positional (ui-test)
//   openDefectModal({ mode:'ui-test',  runId, contextId:testId })
//   openDefectModal({ mode:'api-step', runId, contextId:stepId, onSuccess:fn })

(function () {
  'use strict';

  function _dfxEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _dfxInjectModal() {
    if (document.getElementById('shared-defect-modal')) return;

    var style = document.createElement('style');
    style.textContent = [
      '.s-dfx-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9998;display:flex;align-items:center;justify-content:center}',
      '.s-dfx-overlay[hidden]{display:none!important}',
      '.s-dfx-inner{width:88vw;max-width:1200px;height:92vh;background:#fff;border-radius:8px;display:flex;flex-direction:column}',
      '.s-dfx-header{padding:14px 18px;border-bottom:1px solid #e5e7eb;font-weight:700;display:flex;align-items:center;justify-content:space-between}',
      '.s-dfx-header button{background:none;border:1px solid #d1d5db;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}',
      '.s-dfx-body{flex:1;overflow:auto;padding:16px 18px}',
      '.s-dfx-footer{padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}',
      '.s-dfx-section{margin-bottom:14px}',
      '.s-dfx-section h4{margin:0 0 6px;font-size:12.5px;color:#374151}',
      '.s-dfx-section textarea,.s-dfx-section input,.s-dfx-section select{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #d1d5db;border-radius:5px;font:inherit;font-size:13px}',
      '.s-dfx-section textarea{height:320px!important;min-height:200px!important;resize:vertical!important;font-family:ui-monospace,monospace;width:100%!important}',
      '.s-dfx-warn{padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;color:#9a3412;margin-bottom:14px}',
      '.s-dfx-error{padding:10px 14px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;color:#7f1d1d;margin-bottom:14px}',
      '.s-dfx-ok{padding:10px 14px;background:#d1fae5;border:1px solid #6ee7b7;border-radius:6px;color:#065f46;margin-bottom:14px}',
      '.s-dfx-footer .s-btn{padding:6px 14px;border-radius:6px;font-size:12.5px;font-weight:600;border:1px solid #d1d5db;background:#fff;cursor:pointer}',
      '.s-dfx-footer .s-btn-primary{background:#16a34a;color:#fff;border-color:#16a34a}',
      '.s-dfx-footer .s-btn-primary:hover{background:#15803d}',
      '.s-dfx-footer .s-btn-primary[disabled]{background:#9ca3af;border-color:#9ca3af;cursor:not-allowed}',
    ].join('');
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="shared-defect-modal" class="s-dfx-overlay" hidden>' +
      '  <div class="s-dfx-inner">' +
      '    <div class="s-dfx-header">' +
      '      <span>&#128030; File Defect to Jira</span>' +
      '      <button onclick="closeDefectModal()">&#10005; Close</button>' +
      '    </div>' +
      '    <div class="s-dfx-body" id="s-dfx-body">Loading…</div>' +
      '    <div class="s-dfx-footer" id="s-dfx-footer"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);
  }

  var _dfxDraft = null; // { mode, runId, contextId, draft, onSuccess }

  function closeDefectModal() {
    var m = document.getElementById('shared-defect-modal');
    if (m) m.hidden = true;
    _dfxDraft = null;
  }

  function _dfxAdfPreview(adf) {
    if (!adf || !adf.content) return '';
    var lines = [];
    for (var i = 0; i < adf.content.length; i++) {
      var node = adf.content[i];
      if (node.type === 'heading')
        lines.push('\n## ' + (node.content && node.content[0] && node.content[0].text || ''));
      else if (node.type === 'paragraph')
        lines.push((node.content || []).map(function (c) { return c.text || ''; }).join(''));
      else if (node.type === 'orderedList')
        (node.content || []).forEach(function (li, idx) {
          var txt = li.content && li.content[0] && li.content[0].content &&
            li.content[0].content[0] && li.content[0].content[0].text || '';
          lines.push((idx + 1) + '. ' + txt);
        });
      else if (node.type === 'codeBlock')
        lines.push('```\n' + (node.content && node.content[0] && node.content[0].text || '') + '\n```');
    }
    return lines.join('\n');
  }

  // Convert edited plain-text description back to minimal ADF so Jira renders it
  function _dfxTextToAdf(text) {
    var nodes = [];
    var lines = (text || '').split('\n');
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (line.indexOf('## ') === 0) {
        nodes.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: line.slice(3) }] });
        i++;
      } else if (line === '```') {
        var codeLines = [];
        i++;
        while (i < lines.length && lines[i] !== '```') { codeLines.push(lines[i]); i++; }
        nodes.push({ type: 'codeBlock', content: [{ type: 'text', text: codeLines.join('\n') }] });
        i++;
      } else if (line.trim() === '') {
        i++;
      } else {
        nodes.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
        i++;
      }
    }
    return { version: 1, type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph', content: [] }] };
  }

  async function _dfxApproveAndFile() {
    if (!_dfxDraft) return;
    var parent  = document.getElementById('s-dfx-parent').value.trim();
    var summary = document.getElementById('s-dfx-summary').value.trim();
    var msgEl   = document.getElementById('s-dfx-msg');
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(parent)) {
      msgEl.innerHTML = '<span style="color:#dc2626">User Story key must look like ABC-123</span>';
      return;
    }
    if (!summary) { msgEl.innerHTML = '<span style="color:#dc2626">Summary required</span>'; return; }
    var priority = document.getElementById('s-dfx-priority').value;
    msgEl.textContent = '⏳ Filing…';

    // If user edited the description textarea, convert their text to ADF; otherwise use original ADF
    var descEl = document.getElementById('s-dfx-desc');
    var originalPreview = _dfxAdfPreview(_dfxDraft.draft.descriptionADF);
    var descriptionADF = (descEl && descEl.value !== originalPreview)
      ? _dfxTextToAdf(descEl.value)
      : _dfxDraft.draft.descriptionADF;

    var body = {
      summary: summary,
      descriptionADF: descriptionADF,
      priority: priority,
      parentStoryKey: parent,
    };
    if (_dfxDraft.mode === 'ui-test') {
      body.runId  = _dfxDraft.runId;
      body.testId = _dfxDraft.contextId;
      var attachEls = document.querySelectorAll('.s-dfx-attach');
      body.attachKinds = Array.from(attachEls)
        .filter(function (c) { return c.checked && !c.disabled; })
        .map(function (c) { return c.dataset.kind; });
    } else {
      body.runId  = _dfxDraft.runId;
      body.stepId = _dfxDraft.contextId;
    }

    var endpoint = _dfxDraft.mode === 'ui-test' ? '/api/defects/file' : '/api/api-defects/file';
    var r = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var j = await r.json();

    if (r.ok) {
      msgEl.innerHTML = '<div class="s-dfx-ok">✓ Filed as <strong>' + _dfxEsc(j.defectKey) + '</strong>. ' +
        '<a href="' + _dfxEsc(j.jiraUrl) + '" target="_blank" rel="noopener">Open in Jira ↗</a></div>';
      var closeLabel = _dfxDraft.mode === 'ui-test' ? 'Close &amp; Refresh' : 'Close';
      var closeExtra = _dfxDraft.mode === 'ui-test' ? ';location.reload()' : '';
      document.getElementById('s-dfx-footer').innerHTML =
        '<button class="s-btn s-btn-primary" onclick="closeDefectModal()' + closeExtra + '">' + closeLabel + '</button>';
      if (_dfxDraft.onSuccess) _dfxDraft.onSuccess(j);
    } else if (r.status === 409) {
      var ex = j && j.error && j.error.details || {};
      msgEl.innerHTML = '<div class="s-dfx-warn">⚠ Already filed as <strong>' + _dfxEsc(ex.defectKey || '') + '</strong>.' +
        (ex.jiraUrl ? ' <a href="' + _dfxEsc(ex.jiraUrl) + '" target="_blank" rel="noopener">Open in Jira ↗</a>' : '') + '</div>';
    } else {
      var errMsg = j && j.error && j.error.message || 'File failed';
      var errDetail = j && j.error && j.error.details ? '\n' + JSON.stringify(j.error.details, null, 2) : '';
      msgEl.innerHTML = '<div class="s-dfx-error">✗ ' + _dfxEsc(errMsg) +
        (errDetail ? '<pre style="margin:6px 0 0;font-size:11px;white-space:pre-wrap;word-break:break-all">' + _dfxEsc(errDetail) + '</pre>' : '') + '</div>';
    }
  }

  async function dismissDefectFromModal() {
    if (!_dfxDraft || _dfxDraft.mode !== 'ui-test') return;
    var catEl = document.getElementById('s-dfx-dismiss-cat');
    var cat = catEl && catEl.value;
    if (!cat) { alert('Select a dismiss category first'); return; }
    var r = await fetch('/api/defects/dismiss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: _dfxDraft.runId, testId: _dfxDraft.contextId, category: cat }),
    });
    if (r.ok) { closeDefectModal(); location.reload(); }
    else { var j = await r.json(); alert('Dismiss failed: ' + (j && j.error && j.error.message || 'error')); }
  }

  async function commentOnExisting(defectKey) {
    if (!_dfxDraft) return;
    var r = await fetch('/api/defects/comment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: _dfxDraft.runId, testId: _dfxDraft.contextId, defectKey: defectKey }),
    });
    var j = await r.json();
    var bodyEl = document.getElementById('s-dfx-body');
    if (r.ok) {
      bodyEl.innerHTML = '<div class="s-dfx-ok">✓ Comment added to <strong>' + _dfxEsc(defectKey) + '</strong>.</div>';
      document.getElementById('s-dfx-footer').innerHTML =
        '<button class="s-btn s-btn-primary" onclick="closeDefectModal();location.reload()">Close &amp; Refresh</button>';
    } else {
      bodyEl.innerHTML += '<div class="s-dfx-error">✗ ' + _dfxEsc((j && j.error && j.error.message) || 'Comment failed') + '</div>';
    }
  }

  async function openDefectModal(opts, legacyTestId) {
    // Legacy positional call: openDefectModal(runId, testId)
    if (typeof opts === 'string') {
      opts = { mode: 'ui-test', runId: opts, contextId: legacyTestId };
    }
    var mode      = opts.mode || 'ui-test';
    var runId     = opts.runId;
    var contextId = opts.contextId;
    var onSuccess = opts.onSuccess || null;

    _dfxInjectModal();

    var m    = document.getElementById('shared-defect-modal');
    var bodyEl = document.getElementById('s-dfx-body');
    var foot = document.getElementById('s-dfx-footer');
    m.hidden = false;
    bodyEl.innerHTML = '⏳ Loading draft…';
    foot.innerHTML = '';

    var draftEndpoint = mode === 'ui-test' ? '/api/defects/draft' : '/api/api-defects/draft';
    var draftBody = mode === 'ui-test'
      ? { runId: runId, testId: contextId }
      : { runId: runId, stepId: contextId };

    var draft;
    try {
      var draftRes = await fetch(draftEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftBody),
      });
      if (draftRes.status === 409) {
        var d409 = await draftRes.json();
        var ex409 = d409.error && d409.error.details || {};
        if (mode === 'ui-test' && ex409.defectKey) {
          bodyEl.innerHTML =
            '<div class="s-dfx-warn">⚠ Already filed as <strong>' + _dfxEsc(ex409.defectKey) + '</strong>' +
            (ex409.status ? ' (' + _dfxEsc(ex409.status) + ')' : '') + '.<br>' +
            '<a href="' + _dfxEsc(ex409.jiraUrl || '') + '" target="_blank" rel="noopener">Open in Jira ↗</a></div>' +
            '<p>You can add this run\'s failure as a comment on the existing ticket, or cancel.</p>';
          foot.innerHTML =
            '<button class="s-btn" onclick="closeDefectModal()">Cancel</button>' +
            '<button class="s-btn s-btn-primary" onclick="commentOnExisting(' + JSON.stringify(ex409.defectKey) + ')">Add as Comment</button>';
        } else {
          bodyEl.innerHTML =
            '<div class="s-dfx-warn">⚠ Already filed as <strong>' + _dfxEsc(ex409.defectKey || 'existing') + '</strong>.' +
            (ex409.jiraUrl ? ' <a href="' + _dfxEsc(ex409.jiraUrl) + '" target="_blank" rel="noopener">Open in Jira ↗</a>' : '') + '</div>';
          foot.innerHTML = '<button class="s-btn s-btn-primary" onclick="closeDefectModal()">Close</button>';
        }
        return;
      }
      if (!draftRes.ok) {
        var derr = await draftRes.json();
        throw new Error((derr.error && derr.error.message) || 'Draft failed');
      }
      draft = await draftRes.json();
    } catch (e) {
      bodyEl.innerHTML = '<div class="s-dfx-error">✗ ' + _dfxEsc(e.message) + '</div>';
      foot.innerHTML = '<button class="s-btn" onclick="closeDefectModal()">Close</button>';
      return;
    }

    _dfxDraft = { mode: mode, runId: runId, contextId: contextId, draft: draft, onSuccess: onSuccess };

    var isConfigured = mode === 'ui-test' ? !!draft.config : !!draft.isJiraConfigured;
    if (!isConfigured) {
      bodyEl.innerHTML = '<div class="s-dfx-error">✗ Jira not configured. Ask an admin to configure it in Admin → Notification Settings.</div>';
      foot.innerHTML = '<button class="s-btn" onclick="closeDefectModal()">Close</button>';
      return;
    }

    if (draft.existingDefect) {
      var d = draft.existingDefect;
      bodyEl.innerHTML =
        '<div class="s-dfx-warn">⚠ Already filed as <strong>' + _dfxEsc(d.defectKey) + '</strong> (' + _dfxEsc(d.status) + ').<br>' +
        '<a href="' + _dfxEsc(d.jiraUrl) + '" target="_blank" rel="noopener">Open in Jira ↗</a></div>' +
        (mode === 'ui-test'
          ? '<p>You can add this run\'s failure as a comment on the existing ticket, or cancel.</p>'
          : '<p style="font-size:13px;color:#374151;margin:0">This step already has an open defect.</p>');
      foot.innerHTML =
        '<button class="s-btn" onclick="closeDefectModal()">Cancel</button>' +
        (mode === 'ui-test'
          ? '<button class="s-btn s-btn-primary" onclick="commentOnExisting(' + JSON.stringify(d.defectKey) + ')">Add as Comment</button>'
          : '<button class="s-btn s-btn-primary" onclick="closeDefectModal()">Close</button>');
      return;
    }

    var cfg = draft.config || {};
    var projectKey = draft.jiraProjectKey || cfg.projectKey || '';
    var projectKeyHtml = projectKey
      ? '<div style="padding:6px 10px;background:#f0fdf4;border:1px solid #86efac;border-radius:5px;font-weight:700;color:#15803d;font-size:13px">' + _dfxEsc(projectKey) + '</div>'
      : '<div style="padding:6px 10px;background:#fef2f2;border:1px solid #fca5a5;border-radius:5px;color:#dc2626;font-size:12.5px">⚠ Jira Project Key not set for this project. Go to Admin → Project Management to configure it.</div>';

    var attachSection = '';
    if (mode === 'ui-test') {
      var attachRows = (draft.attachments || []).map(function (a) {
        var sizeMb = (a.sizeBytes / 1024 / 1024).toFixed(2);
        return '<label style="display:block;margin:4px 0"><input type="checkbox" class="s-dfx-attach" data-kind="' + _dfxEsc(a.kind) + '" ' +
          (a.tooLarge ? 'disabled' : 'checked') + '> ' + _dfxEsc(a.kind) + ' — ' + _dfxEsc(a.name) +
          ' (' + sizeMb + ' MB)' + (a.tooLarge ? '<span style="color:#dc2626"> — too large, will be skipped</span>' : '') + '</label>';
      }).join('');
      attachSection = '<div class="s-dfx-section"><h4>Attachments</h4>' + (attachRows || '<em>(no artifacts available)</em>') + '</div>';
    }

    bodyEl.innerHTML =
      '<div class="s-dfx-section"><h4>Jira Project</h4>' + projectKeyHtml + '</div>' +
      '<div class="s-dfx-section"><h4>Issue Type</h4><input type="text" value="' + _dfxEsc(cfg.issueType || 'Defect') + '" readonly></div>' +
      '<div class="s-dfx-section"><h4>Priority *</h4><select id="s-dfx-priority">' +
        ['Highest', 'High', 'Medium', 'Low', 'Lowest'].map(function (p) {
          return '<option' + (draft.suggestedPriority === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="s-dfx-section"><h4>User Story * (e.g. ' + _dfxEsc(projectKey || 'PROJ') + '-123)</h4>' +
        '<input id="s-dfx-parent" type="text" placeholder="' + _dfxEsc(projectKey || 'PROJ') + '-_____"></div>' +
      '<div class="s-dfx-section"><h4>Summary *</h4>' +
        '<input id="s-dfx-summary" type="text" value="' + _dfxEsc(draft.summary || '') + '" maxlength="255"></div>' +
      '<div class=”s-dfx-section”><h4>Description <span style=”font-size:11px;color:#6b7280;font-weight:400”>(editable — Jira renders as rich text)</span></h4>' +
        '<textarea id=”s-dfx-desc” style=”height:320px;min-height:200px;resize:vertical;width:100%;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:13px;padding:7px 10px;border:1px solid #d1d5db;border-radius:5px”>' + _dfxEsc(_dfxAdfPreview(draft.descriptionADF)) + '</textarea>' +
        '<div style=”font-size:11px;color:#6b7280;margin-top:3px”>Edit freely. Changes are sent to Jira as plain-text ADF paragraphs.</div></div>' +
      attachSection +
      '<div id=”s-dfx-msg” style=”margin-top:8px;font-size:12.5px”></div>';

    foot.innerHTML =
      '<button class="s-btn" onclick="closeDefectModal()">Cancel</button>' +
      (mode === 'ui-test'
        ? '<select id="s-dfx-dismiss-cat" style="padding:6px 10px;border-radius:5px">' +
            '<option value="">Categorise Issue ▾</option>' +
            '<option value="aut-bug">AUT Bug</option>' +
            '<option value="script-issue">Script Issue</option>' +
            '<option value="locator-issue">Locator Issue</option>' +
            '<option value="flaky">Flaky</option>' +
            '<option value="data-issue">Data Issue</option>' +
            '<option value="env-issue">Env Issue</option>' +
          '</select><button class="s-btn" onclick="dismissDefectFromModal()">Dismiss</button>'
        : '') +
      (projectKey
        ? '<button class="s-btn s-btn-primary" onclick="_dfxApproveAndFile()">Approve &amp; File</button>'
        : '<button class="s-btn s-btn-primary" disabled title="Set Jira Project Key in Admin → Project Management first">Approve &amp; File</button>');
  }

  // Expose on window — accessible from inline onclick handlers in both pages
  window.openDefectModal        = openDefectModal;
  window.closeDefectModal       = closeDefectModal;
  window.commentOnExisting      = commentOnExisting;
  window.dismissDefectFromModal = dismissDefectFromModal;
  window._dfxApproveAndFile     = _dfxApproveAndFile;

}());
// API FLAKINESS ANALYTICS MODULE
// Redesigned 2026-05-29: matches Flaky Tests page layout pattern
// All colours use --afl-* CSS tokens (defined in styles_addon.css) — works in both dark & light themes
// ══════════════════════════════════════════════════════════════════════════════

var _flakinessColId    = null;
var _flakinessReport   = null;
var _flakinessFilter   = 'all';
var _flakinessTop10    = false;
var _flakinessAllCols  = [];
var _flakinessPage     = 0;
var _flakinessPageSize = 25;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function flakinessPageInit() {
  await _flakinessLoadCollections();
}

async function _flakinessLoadCollections() {
  if (!currentProjectId) return;
  try {
    const res  = await fetch(`/api/api-collections?projectId=${encodeURIComponent(currentProjectId)}`);
    const data = await res.json();
    _flakinessAllCols = data.collections || data || [];
    const sel = document.getElementById('flakiness-col-filter');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select a collection —</option>' +
      _flakinessAllCols.map(c =>
        `<option value="${_flEsc(c.id)}">${_flEsc(c.name)}</option>`
      ).join('');
  } catch (e) { /* ignore */ }
}

// ── Load / Recompute ───────────────────────────────────────────────────────────

async function flakinessLoad() {
  const sel = document.getElementById('flakiness-col-filter');
  _flakinessColId = sel ? sel.value : _flakinessColId;

  if (!_flakinessColId) {
    _flakinessShowState('empty');
    return;
  }

  _flakinessShowState('loading');
  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(_flakinessColId));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _flakinessReport = await res.json();
    _flakinessRender();
  } catch (e) {
    _flakinessShowState('empty');
    _flAlert('error', 'Load failed: ' + e.message);
  }
}

async function flakinessRecompute() {
  if (!_flakinessColId) { _flAlert('warn', 'Select a collection first.'); return; }
  const btn = document.getElementById('flakiness-recompute-btn');
  if (btn) { btn.disabled = true; btn.textContent = '↺ Computing…'; }
  _flakinessShowState('loading');
  try {
    const res = await fetch('/api/flakiness/' + encodeURIComponent(_flakinessColId) + '/recompute', { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _flakinessReport = await res.json();
    _flakinessRender();
  } catch (e) {
    _flAlert('error', 'Recompute failed: ' + e.message);
    _flakinessShowState('table');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↺ Recompute'; }
  }
}

// ── Filter / Sort Controls ─────────────────────────────────────────────────────

function flakinessSetFilter(f) {
  _flakinessFilter = f;
  _flakinessPage   = 0;
  document.querySelectorAll('.flaky-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f));
  _flakinessRenderTable();
}

function flakinessToggleTop10() {
  _flakinessTop10 = !_flakinessTop10;
  _flakinessPage  = 0;
  const btn = document.getElementById('flakiness-top10-btn');
  if (btn) btn.classList.toggle('active', _flakinessTop10);
  _flakinessRenderTable();
}

function flakinessApplyFilters() {
  _flakinessPage = 0;
  _flakinessRenderTable();
}

function _flakinessSetPageSize(n) {
  _flakinessPageSize = n;
  _flakinessPage     = 0;
  _flakinessRenderTable();
}

function _flakinessPageGo(dir) {
  _flakinessPage += dir;
  _flakinessRenderTable();
}

// ── Render ────────────────────────────────────────────────────────────────────

function _flakinessRender() {
  if (!_flakinessReport) return;
  _flakinessShowState('table');
  const tabs = document.getElementById('flakiness-filter-tabs');
  if (tabs) tabs.style.display = '';
  _flakinessRenderSummaryBar();
  _flakinessRenderTable();
}

function _flakinessRenderSummaryBar() {
  const r   = _flakinessReport;
  const bar = document.getElementById('flakiness-summary-bar');
  if (!bar || !r) return;

  const records   = r.stepRecords || [];
  const total     = records.length;
  const critical  = records.filter(s => _flakinessStatus(s) === 'critical').length;
  const unstable  = records.filter(s => _flakinessStatus(s) === 'unstable').length;
  const stable    = records.filter(s => _flakinessStatus(s) === 'stable').length;
  const stability = Math.round((r.stabilityScore || 0) * 100);
  const stabColor = stability >= 90 ? 'var(--afl-pass)' : stability >= 70 ? 'var(--afl-warn)' : 'var(--afl-danger)';

  bar.style.display = '';
  bar.innerHTML =
    `<span style="color:var(--afl-text);font-size:13px">` +
    `${total} request${total !== 1 ? 's' : ''} &nbsp;·&nbsp; ` +
    `<span style="color:var(--afl-danger)">${critical} critical</span> &nbsp;·&nbsp; ` +
    `<span style="color:var(--afl-warn)">${unstable} unstable</span> &nbsp;·&nbsp; ` +
    `<span style="color:var(--afl-pass)">${stable} stable</span>` +
    `</span>` +
    `<span style="margin-left:16px;font-size:12px;color:var(--afl-subtext)">` +
    `Stability <strong style="color:${stabColor}">${stability}%</strong> &nbsp;·&nbsp; ` +
    `${r.runsAnalyzed} run${r.runsAnalyzed !== 1 ? 's' : ''} analysed &nbsp;·&nbsp; ` +
    `Computed ${new Date(r.computedAt).toLocaleString()}` +
    `</span>`;
}

function _flakinessRenderTable() {
  const r = _flakinessReport;
  if (!r) return;

  let records = [...(r.stepRecords || [])];

  if (_flakinessFilter === 'critical')      records = records.filter(s => _flakinessStatus(s) === 'critical');
  if (_flakinessFilter === 'unstable')      records = records.filter(s => _flakinessStatus(s) === 'unstable');
  if (_flakinessFilter === 'stable')        records = records.filter(s => _flakinessStatus(s) === 'stable');
  if (_flakinessFilter === 'insufficient')  records = records.filter(s => s.totalRuns < 3);

  const sort = document.getElementById('flakiness-sort')?.value || 'score';
  if (sort === 'score')    records.sort((a, b) => b.flakinessScore - a.flakinessScore);
  if (sort === 'failrate') records.sort((a, b) => b.failRate - a.failRate);
  if (sort === 'runs')     records.sort((a, b) => b.totalRuns - a.totalRuns);
  if (sort === 'name')     records.sort((a, b) => (a.stepName || '').localeCompare(b.stepName || ''));

  if (_flakinessTop10) records = records.slice(0, 10);

  const total      = records.length;
  const totalPages = _flakinessTop10 ? 1 : Math.max(1, Math.ceil(total / _flakinessPageSize));
  if (_flakinessPage >= totalPages) _flakinessPage = totalPages - 1;
  if (_flakinessPage < 0)          _flakinessPage = 0;

  const start   = _flakinessTop10 ? 0 : _flakinessPage * _flakinessPageSize;
  const end     = _flakinessTop10 ? records.length : Math.min(start + _flakinessPageSize, total);
  const visible = records.slice(start, end);

  const tbody = document.getElementById('flakiness-step-tbody');
  if (!tbody) return;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--afl-muted);font-size:13px;">No requests match this filter.</td></tr>`;
    _flakinessRenderPagination(0, 0, 0);
    return;
  }
  tbody.innerHTML = visible.map(s => _flakinessRow(s)).join('');
  _flakinessRenderPagination(totalPages, total, start, end);
}

function _flakinessRenderPagination(totalPages, total, start, end) {
  const table = document.querySelector('#flakiness-step-tbody')?.closest('table');
  if (!table) return;
  let tfoot = table.querySelector('tfoot');
  if (!tfoot) { tfoot = document.createElement('tfoot'); table.appendChild(tfoot); }
  if (total === 0) { tfoot.innerHTML = ''; return; }

  const dispStart = total === 0 ? 0 : start + 1;
  const rppOpts = [10, 25, 50, 100, 200, 500].map(n =>
    `<option value="${n}"${_flakinessPageSize === n ? ' selected' : ''}>${n}</option>`
  ).join('');

  tfoot.innerHTML = `<tr><td colspan="8" style="padding:6px 4px;">
    <div class="lt-pagination">
      <label style="font-size:12px;color:var(--neutral-500)">Rows per page:
        <select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto"
          onchange="_flakinessSetPageSize(+this.value)">${rppOpts}</select>
      </label>
      ${totalPages <= 1
        ? `<span style="font-size:12px;color:var(--neutral-500)">${dispStart}–${end} of ${total}</span>`
        : `<button class="tbl-btn" onclick="_flakinessPageGo(-1)" ${_flakinessPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
           <span style="font-size:12px;color:var(--neutral-500)">Page ${_flakinessPage + 1} / ${totalPages} &nbsp;(${dispStart}–${end} of ${total})</span>
           <button class="tbl-btn" onclick="_flakinessPageGo(1)" ${_flakinessPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`}
    </div>
  </td></tr>`;
}

function _flakinessRow(s) {
  const pct      = Math.round((s.flakinessScore || 0) * 100);
  const failPct  = Math.round((s.failRate || 0) * 100);
  const status   = _flakinessStatus(s);
  const isInsuff = s.totalRuns < 3;

  const barColor = status === 'critical' ? 'var(--afl-danger)' : status === 'unstable' ? 'var(--afl-warn)' : 'var(--afl-pass)';
  const scoreBar =
    `<div style="display:flex;align-items:center;gap:6px;">` +
    `<div style="width:70px;background:var(--afl-bar-track);border-radius:3px;height:6px;flex-shrink:0;">` +
    `<div style="width:${pct}%;background:${barColor};border-radius:3px;height:100%;"></div></div>` +
    `<span style="font-size:11px;color:${barColor};font-weight:600;">${pct}%</span>` +
    `</div>`;

  const sig         = _flakinessSignatureLabel(s.dominantSignature);
  const action      = isInsuff ? '—' : _flakinessGetSuggestedAction(s);
  const actionShort = action.length > 40 ? action.slice(0, 38) + '…' : action;

  return `<tr style="${isInsuff ? 'opacity:0.6;' : ''}cursor:pointer" onclick="flakinessOpenDrawer(${JSON.stringify(s.stepId)})">` +
    `<td style="font-size:12px;font-weight:500;color:var(--afl-text);">${_flEsc(s.stepName || s.stepId)}</td>` +
    `<td>${_flakinessStatusBadge(status, isInsuff)}</td>` +
    `<td>${isInsuff ? `<span style="color:var(--afl-muted);font-size:11px;">Insufficient data</span>` : scoreBar}</td>` +
    `<td style="text-align:center;font-size:12px;color:var(--afl-text);">${isInsuff ? '—' : failPct + '%'}</td>` +
    `<td style="font-size:11px;color:var(--afl-subtext);">${sig}</td>` +
    `<td style="font-size:11px;color:var(--afl-text);" title="${_flEsc(action)}">${isInsuff ? '—' : _flEsc(actionShort)}</td>` +
    `<td style="text-align:center;font-size:12px;color:var(--afl-text);">${s.totalRuns}</td>` +
    `<td><button class="btn btn-xs btn-outline" onclick="event.stopPropagation();flakinessOpenDrawer('${_flEsc(s.stepId)}')">Details</button></td>` +
    `</tr>`;
}

// ── Drawer ────────────────────────────────────────────────────────────────────

function flakinessOpenDrawer(stepId) {
  if (!_flakinessReport) return;
  const s = (_flakinessReport.stepRecords || []).find(r => r.stepId === stepId);
  if (!s) return;

  const drawer  = document.getElementById('flakiness-drawer');
  const overlay = document.getElementById('flakiness-drawer-overlay');
  const title   = document.getElementById('flakiness-drawer-title');
  const body    = document.getElementById('flakiness-drawer-body');
  if (!drawer || !body) return;

  title.textContent = s.stepName || s.stepId;

  const pct      = Math.round((s.flakinessScore || 0) * 100);
  const failPct  = Math.round((s.failRate || 0) * 100);
  const altPct   = Math.round((s.alternationIndex || 0) * 100);
  const status   = _flakinessStatus(s);
  const isInsuff = s.totalRuns < 3;
  const barColor = status === 'critical' ? 'var(--afl-danger)' : status === 'unstable' ? 'var(--afl-warn)' : 'var(--afl-pass)';
  const action   = _flakinessGetSuggestedAction(s);
  const hint     = _flakinessGetActionHint(s);
  const sig      = s.dominantSignature;

  body.innerHTML =
    // Score header
    `<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">` +
    `${_flakinessStatusBadge(status, isInsuff)}` +
    `<span style="font-size:22px;font-weight:700;color:${barColor}">${pct}%</span>` +
    `<span style="font-size:12px;color:var(--afl-subtext);">flakiness score</span>` +
    `</div>` +

    // Stats grid
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">` +
    _drawerStat('Total Runs',  s.totalRuns,                       'var(--afl-brand)') +
    _drawerStat('Passed',      s.passedRuns,                      'var(--afl-pass)') +
    _drawerStat('Failed',      s.failedRuns,                      'var(--afl-danger)') +
    _drawerStat('Fail Rate',   failPct + '%',                     'var(--afl-danger)') +
    _drawerStat('Alternation', altPct + '%',                      'var(--afl-warn)', 'How often pass/fail alternates') +
    _drawerStat('Retries',     s.retryStats?.retryCount || 0,     'var(--afl-info)') +
    `</div>` +

    // Retry recovery
    (s.retryStats?.retryCount > 0 ? `
    <div style="background:var(--afl-section-bg);border:1px solid var(--afl-border);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:var(--afl-text);">
      <span style="color:var(--afl-subtext);">Retry recovery: </span>
      ${s.retryStats.recoveredAfterRetry
        ? `<span style="color:var(--afl-pass);font-weight:600;">✓ Recovered after retry</span> — retrying helps`
        : `<span style="color:var(--afl-danger);font-weight:600;">✗ Did not recover</span> — retrying did not fix it`}
    </div>` : '') +

    // Failure type
    `<div style="margin-bottom:16px;">` +
    `<div style="font-size:11px;font-weight:600;color:var(--afl-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Failure Type</div>` +
    `<div style="font-size:13px;color:var(--afl-text);font-weight:500;">${_flakinessSignatureLabel(sig)}</div>` +
    (sig?.httpStatus    ? `<div style="font-size:11px;color:var(--afl-subtext);margin-top:2px;">HTTP ${sig.httpStatus}</div>` : '') +
    (sig?.transportError ? `<div style="font-size:11px;color:var(--afl-subtext);margin-top:2px;">${_flEsc(sig.transportError)}</div>` : '') +
    (sig?.assertionField ? `<div style="font-size:11px;color:var(--afl-subtext);margin-top:2px;">Field: ${_flEsc(sig.assertionField)}</div>` : '') +
    `</div>` +

    // Suggested action
    `<div style="background:var(--afl-section-bg);border:1px solid var(--afl-border);border-left:3px solid var(--afl-warn);border-radius:6px;padding:14px;margin-bottom:16px;">` +
    `<div style="font-size:11px;font-weight:600;color:var(--afl-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">💡 Suggested Action</div>` +
    `<div style="font-size:13px;color:var(--afl-warn);font-weight:600;margin-bottom:6px;">${_flEsc(action)}</div>` +
    `<div style="font-size:12px;color:var(--afl-subtext);line-height:1.6;">${_flEsc(hint)}</div>` +
    `</div>` +

    // Timestamps
    `<div style="font-size:11px;color:var(--afl-subtext);">` +
    (s.lastFailedAt ? `<div style="margin-bottom:3px;">Last failed: <span style="color:var(--afl-danger)">${new Date(s.lastFailedAt).toLocaleString()}</span></div>` : '') +
    (s.lastPassedAt ? `<div>Last passed: <span style="color:var(--afl-pass)">${new Date(s.lastPassedAt).toLocaleString()}</span></div>` : '') +
    `</div>` +

    // Link to Suggest Tests
    (!isInsuff ? `
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--afl-border);">
      <div style="font-size:11px;color:var(--afl-muted);margin-bottom:8px;">Want to prevent this in future runs?</div>
      <button class="btn btn-sm btn-outline" onclick="flakinessCloseDrawer();showTab('api-collections')">
        → Open API Collections → Suggest Tests
      </button>
    </div>` : '');

  drawer.style.display  = '';
  overlay.style.display = '';
}

function flakinessCloseDrawer() {
  const drawer  = document.getElementById('flakiness-drawer');
  const overlay = document.getElementById('flakiness-drawer-overlay');
  if (drawer)  drawer.style.display  = 'none';
  if (overlay) overlay.style.display = 'none';
}

function _drawerStat(label, value, color, title) {
  return `<div style="background:var(--afl-card-bg);border:1px solid var(--afl-border);border-radius:6px;padding:10px 12px;${title ? 'cursor:help' : ''}" ${title ? `title="${_flEsc(title)}"` : ''}>` +
    `<div style="font-size:18px;font-weight:700;color:${color}">${value}</div>` +
    `<div style="font-size:11px;color:var(--afl-subtext);margin-top:2px;">${label}</div>` +
    `</div>`;
}

// ── Deterministic Action Engine ───────────────────────────────────────────────

function _flakinessGetSuggestedAction(s) {
  const sig      = s.dominantSignature;
  const failPct  = (s.failRate || 0) * 100;
  const flakePct = (s.flakinessScore || 0) * 100;
  const cat      = sig?.category;
  const code     = sig?.httpStatus;

  if (cat === 'http_status' || cat === 'timeout') {
    if (code === 504 || code === 408 || cat === 'timeout') return 'Increase timeout on this request';
    if (code === 401) return 'Check auth token — may be expired';
    if (code === 403) return 'Review role/permissions for this environment';
    if (code === 404) return 'Verify endpoint URL in this environment';
    if (code === 405) return 'Verify HTTP method is correct';
    if (code === 429) return 'Add retry with backoff — rate limit hit';
    if (code === 500) return 'Add retry with backoff — server error';
    if (code === 502 || code === 503) return 'Downstream instability — add retry with backoff';
  }
  if (cat === 'network') {
    if (sig?.transportError === 'ECONNREFUSED') return 'Check environment URL — service unreachable';
    if (sig?.transportError === 'ETIMEDOUT')    return 'Increase timeout — connection timed out';
    return 'Check network connectivity to target environment';
  }
  if (cat === 'auth')                   return 'Review Token Lifecycle — add Token Lifecycle tests';
  if (cat === 'dependency_propagation') return 'Fix the upstream request that this one depends on';
  if (cat === 'assertion') {
    if (sig?.assertionField?.startsWith('body'))   return 'Review baseline — response body may have changed';
    if (sig?.assertionField?.startsWith('header')) return 'Check response headers — add Content-Type tests';
    if (sig?.assertionField?.startsWith('status')) return 'Expected status mismatch — review Contract tests';
    return 'Review assertion rules — add Contract tests';
  }

  if (failPct > 70 && flakePct < 30)  return 'Consistent failure — request is broken, not flaky';
  if (failPct < 20 && flakePct > 60)  return 'Intermittent — add 1–2 retries with delay';
  if (s.alternationIndex > 0.7)        return 'High alternation — add Idempotency tests';
  if (s.retryStats?.retryCount > 5)    return 'Too many retries — check Boundary/Edge conditions';

  return 'Review recent run history for recurring pattern';
}

function _flakinessGetActionHint(s) {
  const sig     = s.dominantSignature;
  const cat     = sig?.category;
  const code    = sig?.httpStatus;
  const failPct = (s.failRate || 0) * 100;

  if (cat === 'timeout' || code === 408 || code === 504)
    return 'Go to API Collections → edit this request → Settings tab → increase Timeout value. Also consider adding 1 retry.';
  if (code === 401 || code === 403 || cat === 'auth')
    return 'Check the environment credentials in API Environments. Use "Suggest Tests → Token Lifecycle" to add token expiry test cases.';
  if (code === 429)
    return 'Add a retry with 2–5 second delay. Use "Suggest Tests → Boundary" to add rate limit test cases.';
  if (cat === 'network')
    return 'Verify the base URL in your API Environment matches the running service. Check if the service is up in this environment.';
  if (cat === 'dependency_propagation')
    return 'Look at the request that runs before this one in the collection. That request is failing and causing this one to be skipped or fail too.';
  if (cat === 'assertion')
    return 'Open API Collections → edit this request → Rules tab → review your assertions. Use "Suggest Tests → Contract" to add schema checks.';
  if (failPct > 70)
    return 'This request fails consistently — it is likely broken, not flaky. Fix the underlying issue before adding retries.';
  if (s.alternationIndex > 0.7)
    return 'The request alternates between pass and fail. Use "Suggest Tests → Idempotency" to verify the API behaves consistently on repeated calls.';

  return 'Open API Collections → run the collection a few more times → then Recompute to get a clearer picture.';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _flakinessStatus(s) {
  if (s.totalRuns < 3) return 'insufficient';
  const pct = (s.flakinessScore || 0) * 100;
  if (pct >= 61) return 'critical';
  if (pct >= 31) return 'unstable';
  return 'stable';
}

function _flakinessStatusBadge(status, isInsuff) {
  if (isInsuff || status === 'insufficient')
    return '<span style="font-size:10px;color:var(--afl-insuff-text);background:var(--afl-insuff-bg);border-radius:4px;padding:2px 8px;">Insufficient</span>';
  if (status === 'critical')
    return '<span style="font-size:10px;color:var(--afl-critical-text);background:var(--afl-critical-bg);border-radius:4px;padding:2px 8px;font-weight:600;">⚡ Critical</span>';
  if (status === 'unstable')
    return '<span style="font-size:10px;color:var(--afl-unstable-text);background:var(--afl-unstable-bg);border-radius:4px;padding:2px 8px;font-weight:600;">⚠ Unstable</span>';
  return '<span style="font-size:10px;color:var(--afl-stable-text);background:var(--afl-stable-bg);border-radius:4px;padding:2px 8px;">✓ Stable</span>';
}

function _flakinessSignatureLabel(sig) {
  if (!sig) return '—';
  const labels = {
    assertion:             '📋 Assertion failed',
    http_status:           '🌐 HTTP ' + (sig.httpStatus || 'error'),
    timeout:               '⏱ Timeout',
    network:               '🔌 Network error',
    auth:                  '🔑 Auth failure',
    dependency_propagation:'🔗 Dependency failure',
    unknown:               '❓ Unknown'
  };
  return labels[sig.category] || _flEsc(sig.category);
}

function _flakinessShowState(state) {
  const ids = {
    empty:   'flakiness-empty',
    loading: 'flakiness-loading',
    table:   'flakiness-table-wrap'
  };
  Object.values(ids).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = document.getElementById(ids[state]);
  if (target) target.style.display = '';

  const showMeta = state === 'table';
  const tabs = document.getElementById('flakiness-filter-tabs');
  const bar  = document.getElementById('flakiness-summary-bar');
  if (tabs) tabs.style.display = showMeta ? '' : 'none';
  if (bar)  bar.style.display  = showMeta ? '' : 'none';
}

function _flAlert(type, msg) {
  const el = document.getElementById('flakiness-alert');
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}" style="margin-bottom:10px;">${_flEsc(msg)}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 5000);
}

function _flEsc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
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
// 29-worker-health.js — Execution Health dashboard: real-time view of all active + recent runs.
// Polls /api/execution-health every 5s while tab visible.

let _execHealthTimer = null;
let _execHealthAllRecent = [];
let _execHealthPage = 0;          // 0-indexed, matches scripts/collections convention
let _execHealthPageSize = 25;

function workerHealthInit(panel) {
  execHealthRefresh();
  _execHealthStartPolling();
}

function _execHealthStartPolling() {
  _execHealthStopPolling();
  _execHealthTimer = setInterval(execHealthRefresh, 5000);
}

function _execHealthStopPolling() {
  if (_execHealthTimer) { clearInterval(_execHealthTimer); _execHealthTimer = null; }
}

async function execHealthRefresh() {
  try {
    var res = await fetch('/api/execution-health');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    _execHealthAllRecent = data.recent || [];
    _execHealthRender(data.active || [], _execHealthAllRecent);
  } catch (e) { /* silent — keep last render */ }
}

function execHealthApplyFilter() {
  _execHealthPage = 0;
  _execHealthRenderRecent(_execHealthAllRecent);
}

function execHealthResetFilter() {
  var n = document.getElementById('exec-health-filter-name');
  var t = document.getElementById('exec-health-filter-type');
  var s = document.getElementById('exec-health-filter-status');
  if (n) n.value = '';
  if (t) t.value = '';
  if (s) s.value = '';
  _execHealthPageSize = 25;
  _execHealthPage = 0;
  _execHealthRenderRecent(_execHealthAllRecent);
}

function _execHealthSetPageSize(n) {
  _execHealthPageSize = n;
  _execHealthPage = 0;
  _execHealthRenderRecent(_execHealthAllRecent);
}

function _execHealthPageGo(delta) {
  _execHealthPage += delta;
  _execHealthRenderRecent(_execHealthAllRecent);
}

function _execHealthRender(active, recent) {
  _execHealthRenderStats(active, recent);
  _execHealthRenderActive(active);
  _execHealthRenderRecent(recent);
}

function _execHealthRenderStats(active, recent) {
  var el = document.getElementById('exec-health-stats');
  if (!el) return;
  var completed = recent.filter(function(r) { return r.status !== 'running'; });
  var passed = completed.filter(function(r) { return r.status === 'passed'; }).length;
  var failed = completed.filter(function(r) { return r.status === 'failed' || r.status === 'error'; }).length;
  var passRate = completed.length > 0 ? Math.round((passed / completed.length) * 100) : 0;
  el.innerHTML = [
    _execStatCard(active.length, 'Active', '#3b82f6'),
    _execStatCard(passed, 'Passed', '#10b981'),
    _execStatCard(failed, 'Failed', '#ef4444'),
    _execStatCard(completed.length > 0 ? passRate + '%' : '—', 'Pass Rate', passRate >= 80 ? '#10b981' : passRate >= 60 ? '#f59e0b' : '#ef4444'),
  ].join('');
}

function _execStatCard(value, label, color) {
  return '<div style="background:var(--card-bg,#1e1e2e);border:1px solid var(--border,#2d2d3f);border-radius:8px;padding:14px 20px;min-width:110px;text-align:center;">'
    + '<div style="font-size:24px;font-weight:700;color:' + color + '">' + escHtml(String(value)) + '</div>'
    + '<div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-top:4px;">' + escHtml(label) + '</div>'
    + '</div>';
}

function _execHealthRenderActive(active) {
  var tbody = document.getElementById('exec-health-active-tbody');
  if (!tbody) return;
  var dot = document.getElementById('exec-health-live-dot');
  var lbl = document.getElementById('exec-health-live-label');
  if (dot && lbl) {
    dot.style.background = active.length > 0 ? '#10b981' : '#6b7280';
    lbl.textContent = active.length > 0 ? active.length + ' running' : 'Idle';
  }
  if (!active.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px;">No active runs</td></tr>';
    return;
  }
  var now = Date.now();
  var TD = 'padding:8px 12px;border-bottom:1px solid var(--border,#2d2d3f);vertical-align:middle;';
  tbody.innerHTML = active.map(function(r) {
    var elapsed = _execHealthElapsed(r.startedAt, now);
    var progress = r.total > 0 ? Math.round(((r.passed + r.failed) / r.total) * 100) : 0;
    var passRate = (r.passed + r.failed) > 0 ? Math.round((r.passed / (r.passed + r.failed)) * 100) : null;
    return '<tr onmouseover="this.style.background=\'var(--row-hover,rgba(255,255,255,.03))\'" onmouseout="this.style.background=\'\'">'
      + '<td style="' + TD + 'font-family:monospace;font-size:11px;color:var(--text-muted);white-space:nowrap;">' + escHtml(r.runId.slice(0, 8)) + '…</td>'
      + '<td style="' + TD + '">' + _execTypeBadge(r.type) + '</td>'
      + '<td style="' + TD + 'max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</td>'
      + '<td style="' + TD + '">' + _execStatusBadge('running') + '</td>'
      + '<td style="' + TD + 'min-width:140px;">' + _execProgressBar(progress, r.passed, r.failed, r.total) + '</td>'
      + '<td style="' + TD + '">' + (passRate !== null ? _execPassRateBadge(passRate) : '<span style="color:var(--text-muted);font-size:12px;">—</span>') + '</td>'
      + '<td style="' + TD + 'font-size:12px;white-space:nowrap;">' + escHtml(elapsed) + '</td>'
      + '</tr>';
  }).join('');
}

function _execHealthRenderRecent(recent) {
  var tbody = document.getElementById('exec-health-recent-tbody');
  var tfoot = document.getElementById('exec-health-tfoot');
  var countEl = document.getElementById('exec-health-count-label');
  if (!tbody) return;

  // Apply filters
  var nameF   = (document.getElementById('exec-health-filter-name')?.value || '').toLowerCase();
  var typeF   = document.getElementById('exec-health-filter-type')?.value || '';
  var statusF = document.getElementById('exec-health-filter-status')?.value || '';

  var filtered = recent.filter(function(r) {
    if (nameF   && !(r.name || '').toLowerCase().includes(nameF)) return false;
    if (typeF   && r.type !== typeF)   return false;
    if (statusF && r.status !== statusF) return false;
    return true;
  });

  var total = filtered.length;
  var totalPages = Math.max(1, Math.ceil(total / _execHealthPageSize));
  if (_execHealthPage >= totalPages) _execHealthPage = totalPages - 1;
  if (_execHealthPage < 0) _execHealthPage = 0;

  var start = _execHealthPage * _execHealthPageSize;
  var end   = Math.min(start + _execHealthPageSize, total);
  var page  = filtered.slice(start, end);

  if (countEl) countEl.textContent = total > 0 ? '(' + total + ' result' + (total !== 1 ? 's' : '') + ')' : '';

  if (!page.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:20px;font-size:12px;">'
      + (nameF || typeF || statusF ? 'No results match the current filters.' : 'No recent runs') + '</td></tr>';
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  var TD2 = 'padding:8px 12px;border-bottom:1px solid var(--border,#2d2d3f);vertical-align:middle;';
  tbody.innerHTML = page.map(function(r) {
    var passRate = r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
    var duration = r.completedAt ? _execHealthDuration(r.startedAt, r.completedAt) : '—';
    return '<tr onmouseover="this.style.background=\'var(--row-hover,rgba(255,255,255,.03))\'" onmouseout="this.style.background=\'\'">'
      + '<td style="' + TD2 + 'font-family:monospace;font-size:11px;color:var(--text-muted);white-space:nowrap;">' + escHtml(r.runId.slice(0, 8)) + '…</td>'
      + '<td style="' + TD2 + '">' + _execTypeBadge(r.type) + '</td>'
      + '<td style="' + TD2 + 'max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escHtml(r.name) + '">' + escHtml(r.name) + '</td>'
      + '<td style="' + TD2 + '">' + _execStatusBadge(r.status) + '</td>'
      + '<td style="' + TD2 + 'font-size:12px;color:#10b981;text-align:center;">' + r.passed + '</td>'
      + '<td style="' + TD2 + 'font-size:12px;color:#ef4444;text-align:center;">' + r.failed + '</td>'
      + '<td style="' + TD2 + 'font-size:12px;text-align:center;">' + r.total + '</td>'
      + '<td style="' + TD2 + '">' + _execPassRateBadge(passRate) + '</td>'
      + '<td style="' + TD2 + 'font-size:11px;white-space:nowrap;color:var(--text-muted);">' + escHtml(formatDate(r.startedAt)) + '</td>'
      + '<td style="' + TD2 + 'font-size:12px;white-space:nowrap;color:var(--text-muted);">' + escHtml(duration) + '</td>'
      + '</tr>';
  }).join('');

  // Pagination in tfoot — exact same pattern as scripts + api-collections pages
  if (tfoot) {
    var rppOpts = [10, 25, 50, 100].map(function(n) {
      return '<option value="' + n + '"' + (_execHealthPageSize === n ? ' selected' : '') + '>' + n + '</option>';
    }).join('');
    var pageInfo = '<span style="font-size:12px;color:var(--text-muted)">' + (start + 1) + '–' + end + ' of ' + total + '</span>';
    var navBtns = totalPages > 1
      ? '<button class="tbl-btn" onclick="_execHealthPageGo(-1)" ' + (_execHealthPage === 0 ? 'disabled' : '') + '>← Prev</button>'
        + '<span style="font-size:12px;color:var(--text-muted)">Page ' + (_execHealthPage + 1) + ' / ' + totalPages + ' &nbsp;(' + (start + 1) + '–' + end + ' of ' + total + ')</span>'
        + '<button class="tbl-btn" onclick="_execHealthPageGo(1)" ' + (_execHealthPage >= totalPages - 1 ? 'disabled' : '') + '>Next →</button>'
      : pageInfo;
    tfoot.innerHTML = '<tr><td colspan="10" style="padding:6px 4px"><div class="lt-pagination">'
      + '<label style="font-size:12px;color:var(--text-muted)">Rows per page: '
      + '<select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto" onchange="_execHealthSetPageSize(+this.value)">' + rppOpts + '</select>'
      + '</label>'
      + navBtns
      + '</div></td></tr>';
  }
}

function _execTypeBadge(type) {
  var map = { 'ui-test': ['#7c3aed', 'UI Test'], 'api-collection': ['#2563eb', 'API Collection'], 'api-suite': ['#0891b2', 'API Suite'] };
  var entry = map[type] || ['#6b7280', type];
  return '<span style="font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600;background:' + entry[0] + '22;color:' + entry[0] + '">' + escHtml(entry[1]) + '</span>';
}

function _execStatusBadge(status) {
  var map = { running: ['#3b82f6', '● Running'], passed: ['#10b981', '✓ Passed'], failed: ['#ef4444', '✗ Failed'], error: ['#f59e0b', '⚠ Error'] };
  var entry = map[status] || ['#6b7280', status];
  return '<span style="font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;background:' + entry[0] + '22;color:' + entry[0] + '">' + escHtml(entry[1]) + '</span>';
}

function _execPassRateBadge(rate) {
  var color = rate >= 80 ? '#10b981' : rate >= 60 ? '#f59e0b' : '#ef4444';
  return '<span style="font-size:11px;font-weight:600;color:' + color + '">' + rate + '%</span>';
}

function _execProgressBar(pct, passed, failed, total) {
  if (total === 0) return '<span style="font-size:11px;color:var(--text-muted);">—</span>';
  return '<div style="height:6px;background:var(--border,#2d2d3f);border-radius:3px;overflow:hidden;margin-bottom:3px;">'
    + '<div style="height:100%;width:' + pct + '%;background:#10b981;border-radius:3px;transition:width .3s;"></div></div>'
    + '<div style="font-size:10px;color:var(--text-muted);">' + (passed + failed) + ' / ' + total + '</div>';
}

function _execHealthElapsed(startedAt, nowMs) {
  var s = Math.floor((nowMs - new Date(startedAt).getTime()) / 1000);
  if (isNaN(s) || s < 0) return '—';
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}

function _execHealthDuration(startedAt, completedAt) {
  return _execHealthElapsed(startedAt, new Date(completedAt).getTime());
}

document.addEventListener('visibilitychange', function() {
  if (document.hidden) { _execHealthStopPolling(); }
  else {
    var panel = document.getElementById('panel-worker-health');
    if (panel && panel.classList.contains('active')) { execHealthRefresh(); _execHealthStartPolling(); }
  }
});
// OLD: Entire plugin ecosystem module commented out 2026-05-30.
// Concluded: no user value — auth-provider use case covered by existing pre-request hooks;
// custom-assertion use case replaced by native array operators + domain assertion library.
// src/api-plugins/ folder kept on disk. Re-enable by uncommenting server.ts import+route,
// index.html tab+panel, 08-tab-switch.js trigger, and this file.
/* ══════════════════════════════════════════════════════════════════════════════
// API PLUGINS MODULE — Plugin Ecosystem page
// ══════════════════════════════════════════════════════════════════════════════

let _apiPluginsList = [];

async function apiPluginsLoad() {
  const tbody = document.getElementById('api-plugins-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Loading…</td></tr>';
  try {
    const res = await fetch('/api/plugins');
    if (res.status === 401) { window.location.href = '/login?reason=expired'; return; }
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444">Failed to load plugins.</td></tr>'; return; }
    _apiPluginsList = await res.json();
    if (!Array.isArray(_apiPluginsList)) _apiPluginsList = [];
    _apiPluginsRenderList();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444">Error loading plugins.</td></tr>';
  }
  _apiPluginsLoadExamples();
}

function apiPluginsFilter() {
  _apiPluginsRenderList();
}

function _apiPluginsRenderList() {
  const tbody = document.getElementById('api-plugins-tbody');
  if (!tbody) return;
  const q = (document.getElementById('api-plugins-search')?.value || '').toLowerCase();
  const filtered = q
    ? _apiPluginsList.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.id || '').toLowerCase().includes(q) ||
        (p.capabilities || []).some(c => c.toLowerCase().includes(q)))
    : _apiPluginsList;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">${q ? 'No plugins match the search.' : 'No plugins registered.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const statusBadge = p.status === 'enabled'
      ? '<span style="color:#22c55e;font-weight:600">Enabled</span>'
      : '<span style="color:#9ca3af">Disabled</span>';
    const caps = (p.capabilities || []).map(c => `<span class="badge">${escHtml(c)}</span>`).join(' ');
    const toggleBtn = p.status === 'enabled'
      ? `<button class="tbl-btn" onclick="apiPluginDisable('${escHtml(p.id)}')">Disable</button>`
      : `<button class="tbl-btn" onclick="apiPluginEnable('${escHtml(p.id)}')">Enable</button>`;
    return `<tr>
      <td>${escHtml(p.name || p.id)}</td>
      <td style="font-size:11px;color:var(--text-muted);font-family:monospace">${escHtml(p.id)}</td>
      <td>${escHtml(p.version || '—')}</td>
      <td>${caps || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${statusBadge}</td>
      <td>${toggleBtn}</td>
    </tr>`;
  }).join('');
}

async function apiPluginEnable(pluginId) {
  const res = await fetch('/api/plugins/' + encodeURIComponent(pluginId) + '/enable', { method: 'POST' });
  if (!res.ok) { modAlert('api-plugins-alert', 'error', 'Failed to enable plugin.'); return; }
  const plugin = _apiPluginsList.find(p => p.id === pluginId);
  if (plugin) plugin.status = 'enabled';
  _apiPluginsRenderList();
  modAlert('api-plugins-alert', 'success', 'Plugin enabled.');
}

async function apiPluginDisable(pluginId) {
  const res = await fetch('/api/plugins/' + encodeURIComponent(pluginId) + '/disable', { method: 'POST' });
  if (!res.ok) { modAlert('api-plugins-alert', 'error', 'Failed to disable plugin.'); return; }
  const plugin = _apiPluginsList.find(p => p.id === pluginId);
  if (plugin) plugin.status = 'disabled';
  _apiPluginsRenderList();
  modAlert('api-plugins-alert', 'success', 'Plugin disabled.');
}

async function _apiPluginsLoadExamples() {
  const tbody = document.getElementById('api-plugins-examples-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Loading…</td></tr>';
  try {
    const res = await fetch('/api/plugins/examples');
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="4" style="color:#ef4444">Examples unavailable.</td></tr>'; return; }
    const data = await res.json();
    const examples = Array.isArray(data) ? data : (data.examples || []);
    if (!examples.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No example plugins available.</td></tr>';
      return;
    }
    tbody.innerHTML = examples.map(ex => {
      const manifest = ex.manifest || ex;
      const caps = (manifest.capabilities || []).map(c => `<span class="badge">${escHtml(c)}</span>`).join(' ');
      const manifestStr = escHtml(JSON.stringify(manifest));
      return `<tr>
        <td>${escHtml(ex.name || ex.id)}</td>
        <td style="color:var(--text-muted);font-size:12px">${escHtml(ex.description || '—')}</td>
        <td>${caps || '<span style="color:var(--text-muted)">—</span>'}</td>
        <td><button class="tbl-btn" onclick="apiPluginRegisterExample('${manifestStr}')">Register</button></td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#ef4444">Error loading examples.</td></tr>';
  }
}

async function apiPluginRegisterExample(manifestJson) {
  let manifest;
  try { manifest = JSON.parse(manifestJson); } catch { return; }
  const res = await fetch('/api/plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    modAlert('api-plugins-alert', 'error', 'Register failed: ' + (body.error || res.status));
    return;
  }
  const registered = await res.json();
  _apiPluginsList.push(registered);
  _apiPluginsRenderList();
  modAlert('api-plugins-alert', 'success', 'Plugin "' + escHtml(registered.name || registered.id) + '" registered.');
}

function apiPluginsExport() {
  if (!_apiPluginsList.length) { showToast('error', 'No plugins to export.'); return; }
  downloadCSV('plugins.csv',
    ['Name', 'Plugin ID', 'Version', 'Capabilities', 'Status'],
    _apiPluginsList.map(p => [
      p.name || p.id, p.id, p.version || '',
      (p.capabilities || []).join('; '), p.status
    ])
  );
  showToast('success', 'Plugins exported to plugins.csv');
}
*/ // END OLD plugin ecosystem module
// ══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE DASHBOARD MODULE — profiling, cache stats, safeguards
// ══════════════════════════════════════════════════════════════════════════════

let _perfSpans = [];

async function perfLoad() {
  await Promise.all([_perfLoadSafeguards(), _perfLoadCacheStats(), _perfLoadProfile()]);
}

async function _perfLoadSafeguards() {
  const el = document.getElementById('perf-safeguards-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Checking…</div>';
  const res = await fetch('/api/performance/safeguards');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load safeguard status.</div>'; return; }
  const data = await res.json();
  const result = data.result || data;
  const violations = result.violations || [];
  if (result.healthy) {
    el.innerHTML = '<div style="color:#22c55e;font-weight:600">✓ All safeguard checks passed.</div>';
    return;
  }
  const sevColor = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444' };
  el.innerHTML = `<table class="data-table"><thead><tr><th>Code</th><th>Severity</th><th>Measured</th><th>Threshold</th><th>Note</th></tr></thead>
    <tbody>${violations.map(v => `<tr>
      <td style="font-size:12px">${escHtml(v.code)}</td>
      <td><span style="color:${sevColor[v.severity] || '#9ca3af'};font-weight:600">${escHtml(v.severity)}</span></td>
      <td>${v.measuredValue !== undefined ? escHtml(String(v.measuredValue)) : '—'}</td>
      <td>${v.threshold !== undefined ? escHtml(String(v.threshold)) : '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${escHtml(v.advisoryNote || v.message || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function _perfLoadCacheStats() {
  const el = document.getElementById('perf-cache-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/performance/cache/stats');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load cache stats.</div>'; return; }
  const data = await res.json();
  const s = data.stats || data;
  const hitRate = s.hitRate !== undefined ? (s.hitRate * 100).toFixed(1) + '%' : '—';
  el.innerHTML = `<div style="display:flex;gap:24px;flex-wrap:wrap">
    <div><div style="font-size:22px;font-weight:700;color:#22c55e">${escHtml(String(s.hits || 0))}</div><div style="font-size:12px;color:var(--text-muted)">Hits</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#f59e0b">${escHtml(String(s.misses || 0))}</div><div style="font-size:12px;color:var(--text-muted)">Misses</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#9ca3af">${escHtml(String(s.evictions || 0))}</div><div style="font-size:12px;color:var(--text-muted)">Evictions</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#3b82f6">${escHtml(hitRate)}</div><div style="font-size:12px;color:var(--text-muted)">Hit Rate</div></div>
  </div>`;
}

async function perfInvalidateCache() {
  const colIdEl = document.getElementById('perf-invalidate-col');
  const colId = colIdEl?.value?.trim();
  if (!colId) { modAlert('perf-dashboard-msg', 'error', 'Enter a Collection ID to invalidate.'); return; }
  const res = await fetch('/api/performance/cache/invalidate/' + encodeURIComponent(colId), { method: 'POST' });
  if (res.ok) {
    modAlert('perf-dashboard-msg', 'success', 'Cache invalidated for ' + escHtml(colId));
    _perfLoadCacheStats();
  } else {
    modAlert('perf-dashboard-msg', 'error', 'Cache invalidation failed.');
  }
}

async function _perfLoadProfile() {
  const el = document.getElementById('perf-profile-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/performance/profile');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load profiling data.</div>'; return; }
  const data = await res.json();
  const snapshot = data.snapshot || data;
  const spans = snapshot.recentSpans || [];
  _perfSpans = spans;
  if (!spans.length) { el.innerHTML = '<div style="color:var(--text-muted)">No profiling spans recorded yet.</div>'; return; }
  el.innerHTML = `<table class="data-table"><thead><tr><th>Phase</th><th>Label</th><th>Duration (ms)</th><th>Start</th></tr></thead>
    <tbody>${spans.slice(-20).reverse().map(sp => `<tr>
      <td style="font-size:12px">${escHtml(sp.phase || '—')}</td>
      <td style="font-size:12px">${escHtml(sp.label || '—')}</td>
      <td>${sp.durationMs !== undefined ? escHtml(String(sp.durationMs)) : '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${sp.startMs ? new Date(sp.startMs).toLocaleTimeString() : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

function perfExportSpans() {
  if (!_perfSpans.length) { showToast('error', 'No spans to export. Load the dashboard first.'); return; }
  downloadCSV('perf-spans.csv',
    ['Phase', 'Label', 'Duration (ms)', 'Start'],
    _perfSpans.map(sp => [
      sp.phase || '', sp.label || '',
      sp.durationMs !== undefined ? sp.durationMs : '',
      sp.startMs ? new Date(sp.startMs).toLocaleString() : ''
    ])
  );
  showToast('success', 'Performance spans exported to perf-spans.csv');
}
