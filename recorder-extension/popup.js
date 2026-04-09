/**
 * popup.js — QA Agent Recorder Extension Popup
 *
 * Handles:
 *  - Loading saved platform URL + project/env from chrome.storage
 *  - Fetching projects + environments from the platform API
 *  - Starting / stopping a recording session
 *  - Live step counter (polls background state every second)
 */

const $ = id => document.getElementById(id);

let _projects   = [];
let _pollTimer  = null;

// ── On load ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Restore saved platform URL
  const saved = await getStorage(['platformUrl', 'lastProjectId', 'lastEnvId']);
  if (saved.platformUrl) {
    $('platform-url').value = saved.platformUrl;
    $('saved-platform-hint').textContent = 'Saved: ' + saved.platformUrl;
    $('open-platform').href   = saved.platformUrl;
    $('open-platform').style.display = 'inline';
    await loadProjects(saved.platformUrl, saved.lastProjectId, saved.lastEnvId);
  }

  // Check if already recording
  const state = await getState();
  if (state?.active) {
    showRecordingUI(state);
    startPoll();
  }

  // Events
  $('platform-url').addEventListener('blur', onPlatformUrlBlur);
  $('project-select').addEventListener('change', onProjectChange);
  $('btn-start').addEventListener('click', onStartClick);
  $('btn-stop').addEventListener('click', onStopClick);
  $('clear-settings').addEventListener('click', onClearSettings);
  $('open-platform').addEventListener('click', e => {
    e.preventDefault();
    const url = $('platform-url').value.trim();
    if (url) chrome.tabs.create({ url });
  });
});

// ── Platform URL blur — load projects ────────────────────────────────────────
async function onPlatformUrlBlur() {
  const url = $('platform-url').value.trim().replace(/\/$/, '');
  if (!url) return;
  chrome.storage.local.set({ platformUrl: url });
  $('saved-platform-hint').textContent = 'Saved: ' + url;
  $('open-platform').href = url;
  $('open-platform').style.display = 'inline';
  await loadProjects(url);
}

// ── Load projects from platform API ──────────────────────────────────────────
async function loadProjects(platformUrl, selectProjectId, selectEnvId) {
  showAlert('');
  $('project-select').innerHTML = '<option value="">Loading…</option>';
  $('env-select').innerHTML     = '<option value="">—</option>';
  $('btn-start').disabled = true;

  try {
    const res = await fetch(`${platformUrl}/api/projects`, { credentials: 'include' });
    if (res.status === 401) { showAlert('Not logged in to the platform. Open the platform, log in, then retry.'); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _projects = await res.json();

    if (!_projects.length) {
      $('project-select').innerHTML = '<option value="">No projects found</option>';
      return;
    }

    $('project-select').innerHTML = '<option value="">— select project —</option>'
      + _projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

    if (selectProjectId) {
      $('project-select').value = selectProjectId;
      await loadEnvs(selectProjectId, selectEnvId);
    }
  } catch (e) {
    showAlert('Cannot reach platform: ' + e.message + '. Make sure the platform is running and you are on the same network.');
  }
}

// ── Project changed — populate environments ───────────────────────────────────
async function onProjectChange() {
  const pid = $('project-select').value;
  await loadEnvs(pid);
  chrome.storage.local.set({ lastProjectId: pid });
}

async function loadEnvs(projectId, selectEnvId) {
  $('env-select').innerHTML = '<option value="">—</option>';
  $('btn-start').disabled = true;
  if (!projectId) return;

  const project = _projects.find(p => p.id === projectId);
  if (!project?.environments?.length) {
    $('env-select').innerHTML = '<option value="">No environments configured</option>';
    return;
  }

  $('env-select').innerHTML = project.environments
    .map(e => `<option value="${e.id}">${escHtml(e.name)} — ${escHtml(e.url)}</option>`)
    .join('');

  if (selectEnvId) $('env-select').value = selectEnvId;
  $('btn-start').disabled = false;
}

$('env-select') && $('env-select').addEventListener('change', () => {
  $('btn-start').disabled = !$('env-select').value;
  chrome.storage.local.set({ lastEnvId: $('env-select').value });
});

// ── Start recording ───────────────────────────────────────────────────────────
async function onStartClick() {
  const platformUrl = $('platform-url').value.trim().replace(/\/$/, '');
  const projectId   = $('project-select').value;
  const envId       = $('env-select').value;
  if (!platformUrl || !projectId || !envId) { showAlert('Please fill in all fields.'); return; }

  const project = _projects.find(p => p.id === projectId);
  const env     = project?.environments?.find(e => e.id === envId);
  if (!env) { showAlert('Environment not found.'); return; }

  showAlert('');
  $('btn-start').disabled = true;
  $('btn-start').textContent = 'Starting…';

  // Get current active tab
  const tabRes = await sendMessage({ type: 'GET_CURRENT_TAB' });
  const tab = tabRes?.tab;
  if (!tab) { showAlert('Could not get current tab.'); resetStartBtn(); return; }

  // Create recording session on platform
  let token;
  try {
    const res = await fetch(`${platformUrl}/api/recorder/start`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ projectId, autUrl: env.url }),
      credentials: 'include',
    });
    if (res.status === 401) { showAlert('Not logged in to platform. Log in and try again.'); resetStartBtn(); return; }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    token = data.token;
  } catch (e) {
    showAlert('Failed to start session: ' + e.message);
    resetStartBtn();
    return;
  }

  // Tell background to inject content script into current tab
  const injectRes = await sendMessage({ type: 'START_RECORDING', token, platformOrigin: platformUrl, projectId, tabId: tab.id });
  if (!injectRes?.success) {
    showAlert('Failed to inject recorder: ' + (injectRes?.error || 'unknown error'));
    resetStartBtn();
    return;
  }

  chrome.storage.local.set({ lastProjectId: projectId, lastEnvId: envId });
  showRecordingUI({ token, platformOrigin: platformUrl, projectId, tabId: tab.id, active: true, stepCount: 0 });
  startPoll();
}

// ── Stop recording ────────────────────────────────────────────────────────────
async function onStopClick() {
  stopPoll();
  const state = await getState();

  // Tell content script to stop + clear background state
  await sendMessage({ type: 'STOP_RECORDING' });

  // Tell platform to stop session
  if (state?.token && state?.platformOrigin) {
    fetch(`${state.platformOrigin}/api/recorder/stop`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token: state.token }),
      credentials: 'include',
    }).catch(() => {});
  }

  chrome.action.setBadgeText({ text: '' });
  showIdleUI();
}

// ── Poll background for step count ───────────────────────────────────────────
function startPoll() {
  stopPoll();
  _pollTimer = setInterval(async () => {
    const state = await getState();
    if (!state?.active) { stopPoll(); showIdleUI(); return; }
    const badge = $('steps-badge');
    if (badge) {
      const n = state.stepCount || 0;
      badge.textContent = n + ' step' + (n === 1 ? '' : 's');
      badge.style.display = 'inline';
    }
    const dot = $('status-dot');
    if (dot) dot.className = 'dot active';
    const txt = $('status-text');
    if (txt) txt.textContent = 'Recording…';
  }, 1000);
}

function stopPoll() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

// ── UI state helpers ──────────────────────────────────────────────────────────
function showRecordingUI(state) {
  $('form-section').style.display  = 'none';
  $('stop-section').style.display  = 'block';
  $('status-dot').className        = 'dot active';
  $('status-text').textContent     = 'Recording…';
  $('steps-badge').style.display   = 'inline';
  $('steps-badge').textContent     = (state.stepCount || 0) + ' steps';
}

function showIdleUI() {
  $('form-section').style.display  = 'block';
  $('stop-section').style.display  = 'none';
  $('status-dot').className        = 'dot';
  $('status-text').textContent     = 'Not recording';
  $('steps-badge').style.display   = 'none';
  $('btn-start').disabled          = !$('env-select').value;
  $('btn-start').textContent       = '⬤ Start Recording';
}

function resetStartBtn() {
  $('btn-start').disabled    = false;
  $('btn-start').textContent = '⬤ Start Recording';
}

// ── Clear settings ────────────────────────────────────────────────────────────
async function onClearSettings() {
  chrome.storage.local.clear();
  $('platform-url').value         = '';
  $('saved-platform-hint').textContent = '';
  $('project-select').innerHTML   = '<option value="">— enter platform URL first —</option>';
  $('env-select').innerHTML       = '<option value="">— select project first —</option>';
  $('btn-start').disabled         = true;
  $('open-platform').style.display = 'none';
  _projects = [];
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function showAlert(msg) {
  const el = $('alert');
  if (!el) return;
  el.textContent    = msg;
  el.style.display  = msg ? 'block' : 'none';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getState() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, r => resolve(r?.state || null));
  });
}

function sendMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, r => resolve(r || null));
  });
}

function getStorage(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}
