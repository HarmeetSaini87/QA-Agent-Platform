// ══════════════════════════════════════════════════════════════════════════════
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

