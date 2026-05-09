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
  ]);
  const kwUpper = (keyword || '').toUpperCase().trim();
  const isPageLevel = PAGE_LEVEL_ASSERT_KW.has(kwUpper);

  const editPanel = document.createElement('div');
  editPanel.id = 'dbg-inline-edit';
  editPanel.style.cssText = 'margin-top:12px;background:#1e293b;border:1px solid #f59e0b;border-radius:8px;padding:14px 16px';
  editPanel.innerHTML = `
    <div style="font-size:12px;font-weight:700;color:#f59e0b;margin-bottom:10px;letter-spacing:0.5px">✎ EDIT &amp; RETRY — correct the step without stopping the session</div>
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

