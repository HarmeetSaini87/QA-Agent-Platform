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

