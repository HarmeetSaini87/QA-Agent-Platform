// API RUN RESULTS MODULE
// ══════════════════════════════════════════════════════════════════════════════

let _apiRunsCollectionId = null;
let _apiRunsList = [];
let _apiRunsPollTimer = null;
let _apiRunsCurrentRunId = null;

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
    _apiRunsRenderList();
    if (focusRunId) {
      setTimeout(() => apiRunsViewDetail(focusRunId), 800);
    }
  } catch (e) {
    modAlert('api-runs-list-alert', 'error', 'Load failed: ' + e.message);
  }
}

function _apiRunsRenderList() {
  const tbody = document.getElementById('api-runs-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (_apiRunsList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No runs yet</td></tr>';
    return;
  }
  const hotspotSet = new Set(_apiRunsFlakinessReport ? (_apiRunsFlakinessReport.hotspots || []) : []);

  for (const run of _apiRunsList) {
    const passed  = run.stepResults?.filter(s => s.status === 'passed').length ?? 0;
    const failed  = run.stepResults?.filter(s => s.status === 'failed' || s.status === 'error').length ?? 0;
    const skipped = run.stepResults?.filter(s => s.status === 'skipped').length ?? 0;
    const total   = run.stepResults?.length ?? 0;
    const dur = run.startedAt && run.completedAt
      ? Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000) + 's'
      : '—';
    const badgeColor = run.status === 'passed' ? '#22c55e' : run.status === 'failed' ? '#ef4444' : run.status === 'running' ? '#3b82f6' : '#f59e0b';
    const badge = run.status === 'running'
      ? `<span class="badge" style="background:${badgeColor};color:#fff">⟳ running</span>`
      : `<span class="badge" style="background:${badgeColor};color:#fff">${run.status}</span>`;

    // Flaky indicator: mark run if any failed step is a known hotspot
    const hasFlaky = run.stepResults?.some(s => hotspotSet.has(s.stepId) && s.status !== 'passed');
    const flakyBadge = hasFlaky ? ' <span class="api-run-flaky-badge">⚡ flaky</span>' : '';

    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    if (hasFlaky) tr.classList.add('api-run-hotspot-row');
    tr.onclick = () => apiRunsViewDetail(run.id);
    tr.innerHTML = `
      <td>${badge}${flakyBadge}</td>
      <td style="font-size:12px">${run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</td>
      <td>${dur}</td>
      <td>${total}</td>
      <td><span style="color:#22c55e">${passed}✓</span> <span style="color:#ef4444">${failed}✗</span> <span style="color:#9ca3af">${skipped}⊘</span></td>
      <td><button class="tbl-btn" onclick="event.stopPropagation();apiRunsViewDetail('${run.id}')">View</button></td>`;
    tbody.appendChild(tr);
  }
}

async function apiRunsViewDetail(runId) {
  _apiRunsCurrentRunId = runId;
  clearInterval(_apiRunsPollTimer);
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
  _execGraphReset(); // clear stale graph when new run loads
  const statusColor = run.status === 'passed' ? '#22c55e' : run.status === 'failed' ? '#ef4444' : run.status === 'running' ? '#3b82f6' : '#f59e0b';
  const dur = run.startedAt && run.completedAt
    ? Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000) + 's'
    : '—';

  document.getElementById('api-run-detail-summary').innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:12px;background:var(--surface-2);border-radius:8px;margin-bottom:12px">
      <span style="font-weight:700;font-size:16px;color:${statusColor}">${run.status.toUpperCase()}</span>
      <span>Duration: <strong>${dur}</strong></span>
      <span>Steps: <strong>${(run.stepResults ?? []).length}</strong></span>
      ${run.status === 'running' ? '<span class="badge badge-blue" style="animation:spin 1s linear infinite">⟳ Live</span>' : ''}
    </div>`;

  // Failure clustering (show when >1 failure)
  const failed = (run.stepResults ?? []).filter(s => s.status === 'failed' || s.status === 'error');
  const clusterEl = document.getElementById('api-run-clusters');
  if (clusterEl) {
    if (failed.length > 1) {
      const clusters = {};
      for (const s of failed) {
        const key = `${s.response?.status ?? 'error'}-${s.assertionResults?.find(a => !a.passed)?.field ?? s.error ?? 'unknown'}`;
        if (!clusters[key]) clusters[key] = { count: 0, label: `status ${s.response?.status ?? 'network error'}`, steps: [] };
        clusters[key].count++;
        clusters[key].steps.push(s.stepName);
      }
      const clusterHtml = Object.entries(clusters).map(([, c]) =>
        `<div style="padding:8px 12px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:6px;margin-bottom:6px;color:var(--text);font-size:13px">
           <span style="color:#ef4444;font-weight:700">${c.count} step${c.count > 1 ? 's' : ''} failed</span>
           <span style="color:var(--text-muted)"> → ${c.label}:</span>
           <span style="color:var(--text)"> ${c.steps.join(', ')}</span>
         </div>`
      ).join('');
      clusterEl.innerHTML = `<div style="margin-bottom:14px"><div style="font-weight:700;margin-bottom:8px;font-size:13px;letter-spacing:.05em">Failure Clusters:</div>${clusterHtml}</div>`;
    } else {
      clusterEl.innerHTML = '';
    }
  }

  // Step results table
  const stepTbody = document.getElementById('api-run-steps-tbody');
  if (!stepTbody) return;
  stepTbody.innerHTML = '';
  for (const step of run.stepResults ?? []) {
    const isTeardown = step.stepName?.includes('[teardown]') || false;
    const sc = step.status === 'passed' ? '#22c55e' : step.status === 'failed' || step.status === 'error' ? '#ef4444' : step.status === 'degraded' ? '#f59e0b' : '#9ca3af';
    const rowId = 'api-run-step-' + step.stepId;
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = () => _apiRunsToggleStepDetail(step.stepId, step);
    const contractBadge = (step.contractViolations?.length ?? 0) > 0
      ? `<span class="badge badge-red" style="font-size:10px;cursor:pointer" title="${escHtml(step.contractViolations.join('\n'))}">⚠ ${step.contractViolations.length} contract</span>`
      : '';
    const diffBadge = step.response?.baselineDiff &&
      (step.response.baselineDiff.statusChanged || step.response.baselineDiff.bodyDiff?.length || step.response.baselineDiff.headersAdded?.length || step.response.baselineDiff.headersRemoved?.length)
      ? '<span class="badge badge-yellow" style="font-size:10px">~ diff</span>' : '';
    tr.innerHTML = `
      <td>
        ${escHtml(step.stepName)}
        ${isTeardown ? '<span class="badge badge-grey" style="font-size:10px;margin-left:4px">teardown</span>' : ''}
        ${step.healingProposal ? '<span class="badge badge-yellow" title="' + escHtml(step.healingProposal) + '">💡 heal</span>' : ''}
        ${diffBadge} ${contractBadge}
      </td>
      <td><span style="color:${sc};font-weight:600">${step.status}</span></td>
      <td>${step.durationMs}ms</td>
      <td>${step.assertionResults?.filter(a => a.passed).length ?? 0}/${step.assertionResults?.length ?? 0}</td>
      <td><button class="tbl-btn" onclick="event.stopPropagation();_apiRunsToggleStepDetail('${step.stepId}', null)">▼</button></td>`;
    stepTbody.appendChild(tr);

    // Detail row (hidden by default)
    const detailTr = document.createElement('tr');
    detailTr.id = rowId;
    detailTr.style.display = 'none';
    detailTr.innerHTML = `<td colspan="5">${_buildStepDetailHtml(step)}</td>`;
    stepTbody.appendChild(detailTr);
  }

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
            : '<div style="color:var(--text-muted);font-size:12px;">Step passed — no defect to file.</div>'}
          <div id="jira-defect-ref-${step.stepId}" style="margin-top:6px;"></div>
          <div id="jira-heal-panel-${step.stepId}" style="margin-top:10px;"></div>
        </div>
      </div>
    </div>`;
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

function _apiRunsRenderHar(run) {
  const harTbody = document.getElementById('api-run-har-tbody');
  if (!harTbody) return;
  harTbody.innerHTML = '';
  for (const step of run.stepResults ?? []) {
    if (!step.response) continue;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escHtml(step.stepName)}</td>
      <td><span class="badge badge-blue" style="font-size:11px">${step.request?.method ?? ''}</span></td>
      <td style="font-family:monospace;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis">${escHtml(step.request?.url ?? '')}</td>
      <td style="color:${step.response.status < 300 ? '#22c55e' : step.response.status < 500 ? '#f59e0b' : '#ef4444'}">${step.response.status}</td>
      <td>${step.response.durationMs}ms</td>`;
    harTbody.appendChild(tr);
  }
}

function _apiRunsStepTab(btn, containerId, tab) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('[data-steppanel]').forEach(p => p.style.display = p.dataset.steppanel === tab ? '' : 'none');
  btn.closest('div').querySelectorAll('[data-steptab]').forEach(b => b.classList.toggle('active', b.dataset.steptab === tab));
}

async function _apiRunsSetBaseline(stepId) {
  if (!confirm('Set current response as baseline for this step?')) return;
  // Trigger a "captureBaseline" re-run is complex — instead tell user to set captureBaseline:true on the step
  showToast('To capture a baseline: edit the step in the collection and enable "Capture Baseline", then run once. The baseline file will be saved automatically.', 'info');
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

async function _apiRunsFileDefect(runId, stepId) {
  var parentStoryKey = prompt('Enter parent story key (e.g. PROJ-123):');
  if (!parentStoryKey || !/^[A-Z][A-Z0-9]*-\d+$/.test(parentStoryKey.trim())) {
    if (parentStoryKey !== null) modAlert('api-runs-alert', 'error', 'Invalid story key format. Use ABC-123.');
    return;
  }

  var draft;
  try {
    var draftRes = await fetch('/api/api-defects/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: runId, stepId: stepId }),
    });
    if (draftRes.status === 409) {
      var d409 = await draftRes.json();
      modAlert('api-runs-alert', 'info', 'Defect already filed: ' + (d409.error && d409.error.details ? d409.error.details.defectKey : 'existing'));
      return;
    }
    if (!draftRes.ok) {
      var derr = await draftRes.json();
      throw new Error((derr.error && derr.error.message) || 'Draft failed');
    }
    draft = await draftRes.json();
  } catch (e) {
    modAlert('api-runs-alert', 'error', 'Draft error: ' + e.message);
    return;
  }

  try {
    var fileRes = await fetch('/api/api-defects/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        runId: runId,
        stepId: stepId,
        summary: draft.summary,
        descriptionADF: draft.descriptionADF,
        priority: draft.suggestedPriority,
        parentStoryKey: parentStoryKey.trim(),
      }),
    });
    if (fileRes.status === 409) {
      var f409 = await fileRes.json();
      modAlert('api-runs-alert', 'info', 'Defect already filed: ' + (f409.error && f409.error.details ? f409.error.details.defectKey : ''));
      return;
    }
    if (!fileRes.ok) {
      var ferr = await fileRes.json();
      throw new Error((ferr.error && ferr.error.message) || 'File failed');
    }
    var result = await fileRes.json();
    delete _apiRunsApiDefectCache[stepId];
    modAlert('api-runs-alert', 'success', 'Defect filed: ' + result.defectKey);
    var refEl = document.getElementById('jira-defect-ref-' + stepId);
    if (refEl) refEl.innerHTML = '<span class="api-defect-pill">🔗 <a href="' + escHtml(result.jiraUrl) + '" target="_blank">' + escHtml(result.defectKey) + '</a></span>';
  } catch (e) {
    modAlert('api-runs-alert', 'error', 'File error: ' + e.message);
  }
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
