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
  for (const run of _apiRunsList) {
    const passed = run.stepResults?.filter(s => s.status === 'passed').length ?? 0;
    const failed = run.stepResults?.filter(s => s.status === 'failed' || s.status === 'error').length ?? 0;
    const skipped = run.stepResults?.filter(s => s.status === 'skipped').length ?? 0;
    const total = run.stepResults?.length ?? 0;
    const dur = run.startedAt && run.completedAt
      ? Math.round((new Date(run.completedAt) - new Date(run.startedAt)) / 1000) + 's'
      : '—';
    const badgeColor = run.status === 'passed' ? '#22c55e' : run.status === 'failed' ? '#ef4444' : run.status === 'running' ? '#3b82f6' : '#f59e0b';
    const badge = run.status === 'running'
      ? `<span class="badge" style="background:${badgeColor};color:#fff">⟳ running</span>`
      : `<span class="badge" style="background:${badgeColor};color:#fff">${run.status}</span>`;
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.onclick = () => apiRunsViewDetail(run.id);
    tr.innerHTML = `
      <td>${badge}</td>
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

function _apiRunsRenderDetail(run) {
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
}

function apiRunsTabSwitch(tab) {
  document.querySelectorAll('.api-run-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.api-run-tab-panel').forEach(p => p.style.display = p.dataset.tab === tab ? '' : 'none');
}
