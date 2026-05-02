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

async function auditLoad(page = 1) {
  auditPage = page;
  const res = await fetch(`/api/admin/audit?page=${page}&size=50`);
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
      <button class="tbl-btn" ${page <= 1 ? 'disabled' : ''} onclick="auditLoad(${page - 1})">← Prev</button>
      <span style="font-size:12px;color:var(--neutral-500)">Page ${page} / ${totalPages} &nbsp;(${data.total} entries)</span>
      <button class="tbl-btn" ${page >= totalPages ? 'disabled' : ''} onclick="auditLoad(${page + 1})">Next →</button>`;
  }
}

