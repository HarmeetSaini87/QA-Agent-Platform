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

