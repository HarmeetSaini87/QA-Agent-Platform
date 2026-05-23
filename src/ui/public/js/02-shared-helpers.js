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
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob), download: filename
  });
  a.click();
  URL.revokeObjectURL(a.href);
}
