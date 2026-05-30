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

