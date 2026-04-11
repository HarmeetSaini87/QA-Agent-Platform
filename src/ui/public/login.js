/* login.js — client-side logic for login & change-password flow */
'use strict';

// ── Helpers ────────────────────────────────────────────────────────────────

function showAlert(containerId, type, msg) {
  const el = document.getElementById(containerId);
  el.className = `login-alert ${type}`;
  el.textContent = msg;
  el.style.display = 'flex';
}

function hideAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.style.display = 'none';
}

function setFieldError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function clearErrors() {
  ['err-username','err-password','err-new-pw','err-confirm-pw'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  ['username','password','new-password','confirm-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('invalid');
  });
}

function togglePassword() {
  const pw  = document.getElementById('password');
  const ico = document.getElementById('eye-icon');
  if (pw.type === 'password') {
    pw.type = 'text';
    ico.innerHTML = `<path d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.091 1.091a4 4 0 00-5.557-5.556z"/><path d="M10.748 13.93l2.523 2.523a10.003 10.003 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L6.07 9.252a4 4 0 004.678 4.678z"/>`;
  } else {
    pw.type = 'password';
    ico.innerHTML = `<path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"/><path fill-rule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>`;
  }
}

// ── Password strength ──────────────────────────────────────────────────────

function checkPasswordStrength(pw) {
  let score = 0;
  if (pw.length >= 8)   score++;
  if (pw.length >= 12)  score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/\d/.test(pw))    score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const el = document.getElementById('pw-strength');
  if (!el) return;
  if (!pw) { el.textContent = ''; el.className = 'pw-strength'; return; }
  if (score <= 2) { el.textContent = '● Weak';   el.className = 'pw-strength weak'; }
  else if (score <= 4) { el.textContent = '●● Medium'; el.className = 'pw-strength medium'; }
  else { el.textContent = '●●● Strong';  el.className = 'pw-strength strong'; }
}

document.getElementById('new-password')?.addEventListener('input', e => {
  checkPasswordStrength(e.target.value);
});

// ── Login form ─────────────────────────────────────────────────────────────

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();
  hideAlert('login-alert');

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  let valid = true;

  if (!username) {
    setFieldError('err-username', 'Username is required');
    document.getElementById('username').classList.add('invalid');
    valid = false;
  }
  if (!password) {
    setFieldError('err-password', 'Password is required');
    document.getElementById('password').classList.add('invalid');
    valid = false;
  }
  if (!valid) return;

  const btn  = document.getElementById('btn-login');
  const txt  = document.getElementById('btn-text');
  const spin = document.getElementById('btn-spinner');
  btn.disabled = true;
  txt.style.display = 'none';
  spin.style.display = '';

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert('login-alert', 'error', data.error || 'Login failed');
      return;
    }

    if (data.forcePasswordChange) {
      showLoginForm(false);
      showChangePwForm(data.userId);
      return;
    }

    // Redirect
    const params = new URLSearchParams(window.location.search);
    window.location.href = params.get('next') || '/';

  } catch (err) {
    showAlert('login-alert', 'error', 'Network error — please try again');
  } finally {
    btn.disabled = false;
    txt.style.display = '';
    spin.style.display = 'none';
  }
});

// ── Change password form ───────────────────────────────────────────────────

let _pendingUserId = null;

function showChangePwForm(userId) {
  _pendingUserId = userId;
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('change-pw-form').style.display = '';
  document.getElementById('force-change-notice').style.display = 'flex';
  hideAlert('login-alert');
}

function showLoginForm(clearFields = true) {
  document.getElementById('login-form').style.display = '';
  document.getElementById('change-pw-form').style.display = 'none';
  document.getElementById('force-change-notice').style.display = 'none';
  hideAlert('change-alert');
  if (clearFields) {
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
  }
}

document.getElementById('change-pw-form').addEventListener('submit', async e => {
  e.preventDefault();
  clearErrors();
  hideAlert('change-alert');

  const newPw  = document.getElementById('new-password').value;
  const confPw = document.getElementById('confirm-password').value;
  let valid = true;

  if (!newPw) {
    setFieldError('err-new-pw', 'New password is required');
    document.getElementById('new-password').classList.add('invalid');
    valid = false;
  }
  if (newPw !== confPw) {
    setFieldError('err-confirm-pw', 'Passwords do not match');
    document.getElementById('confirm-password').classList.add('invalid');
    valid = false;
  }
  if (!valid) return;

  try {
    const res  = await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ userId: _pendingUserId, newPassword: newPw }),
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert('change-alert', 'error', data.error || 'Failed to set password');
      return;
    }

    // Auto-redirect after successful change
    const params = new URLSearchParams(window.location.search);
    window.location.href = params.get('next') || '/';

  } catch {
    showAlert('change-alert', 'error', 'Network error — please try again');
  }
});

// ── Keyboard: focus username on load ──────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('username')?.focus();

  // Show banner when redirected here due to session expiry
  const params = new URLSearchParams(window.location.search);
  if (params.get('reason') === 'expired') {
    showAlert('login-alert', 'info', 'Your session has expired. Please log in again.');
  }
});
