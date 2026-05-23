// ══════════════════════════════════════════════════════════════════════════════
// COPILOT MODULE — AI guidance, flakiness/retry-storm/SLA predictions
// ══════════════════════════════════════════════════════════════════════════════

let _copilotColId = '';
let _copilotHistory = [];

async function copilotLoad() {
  const sel = document.getElementById('copilot-col-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Collection —</option>';
  const cols = (typeof allApiCollections !== 'undefined' && Array.isArray(allApiCollections) && allApiCollections.length)
    ? allApiCollections
    : await fetch('/api/api-collections').then(r => r.ok ? r.json() : []).catch(() => []);
  (Array.isArray(cols) ? cols : []).forEach(c => {
    sel.innerHTML += `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`;
  });
}

function copilotSelectCollection(colId) {
  _copilotColId = colId;
  const gr = document.getElementById('copilot-guidance-result');
  const pr = document.getElementById('copilot-predict-result');
  const hr = document.getElementById('copilot-history-result');
  if (gr) gr.innerHTML = '';
  if (pr) pr.innerHTML = '';
  if (hr) hr.innerHTML = '<div style="color:var(--text-muted)">Select a collection then switch to History tab.</div>';
}

function copilotTabSwitch(tab, btn) {
  document.querySelectorAll('[data-copilottab]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['guidance', 'predict', 'history'].forEach(t => {
    const el = document.getElementById('copilot-panel-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'history' && _copilotColId) copilotLoadHistory(_copilotColId);
}

// ─── GUIDANCE ────────────────────────────────────────────────────────────────

async function copilotSubmitGuide() {
  if (!_copilotColId) { modAlert('copilot-guidance-msg', 'error', 'Select a collection first.'); return; }
  const queryType = document.getElementById('copilot-query-type')?.value || 'workflow-guidance';
  const runIdEl = document.getElementById('copilot-run-id');
  const runId = runIdEl?.value?.trim() || undefined;
  const result = document.getElementById('copilot-guidance-result');
  if (!result) return;
  result.innerHTML = '<div style="color:var(--text-muted)">Asking Copilot…</div>';
  modAlert('copilot-guidance-msg', 'success', '');
  const res = await fetch('/api/copilot/guide', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queryType, collectionId: _copilotColId, runId, actorId: 'ui-user', context: {} })
  });
  if (!res.ok) { result.innerHTML = '<div style="color:#ef4444">Copilot request failed.</div>'; return; }
  const data = await res.json();
  _copilotRenderGuidance(data, result);
}

function _copilotRenderGuidance(data, container) {
  const items = data.items || [];
  if (!items.length) { container.innerHTML = '<div style="color:var(--text-muted)">No guidance items returned.</div>'; return; }
  const sevColor = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444' };
  container.innerHTML = `
    <div class="advisory-banner" style="margin-bottom:10px">🤖 ${escHtml(data.governanceNote || 'Advisory only — review before acting.')}</div>
    <table class="data-table"><thead><tr><th>Severity</th><th>Title</th><th>Guidance</th><th>Confidence</th><th>Action Hint</th></tr></thead>
    <tbody>${items.map(it => `<tr>
      <td><span style="color:${sevColor[it.severity] || '#9ca3af'};font-weight:600">${escHtml(it.severity)}</span></td>
      <td>${escHtml(it.title)}</td>
      <td style="max-width:300px">${escHtml(it.body)}</td>
      <td>${escHtml(String(it.confidence))}%</td>
      <td style="font-size:12px;color:var(--text-muted)">${escHtml(it.actionHint || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function copilotLoadHistory(colId) {
  const container = document.getElementById('copilot-history-result');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/copilot/history/' + encodeURIComponent(colId));
  if (!res.ok) { container.innerHTML = '<div style="color:#ef4444">Failed to load history.</div>'; return; }
  const history = await res.json();
  _copilotHistory = Array.isArray(history) ? history : (history.items || []);
  _copilotRenderHistory();
}

function _copilotRenderHistory() {
  const container = document.getElementById('copilot-history-result');
  if (!container) return;
  const q = (document.getElementById('copilot-history-search')?.value || '').toLowerCase();
  const filtered = q ? _copilotHistory.filter(h => (h.queryType || '').toLowerCase().includes(q)) : _copilotHistory;
  if (!filtered.length) { container.innerHTML = `<div style="color:var(--text-muted)">${q ? 'No history matches filter.' : 'No guidance history yet.'}</div>`; return; }
  container.innerHTML = `<table class="data-table"><thead><tr><th>Query Type</th><th>Items</th><th>Generated At</th></tr></thead>
    <tbody>${filtered.map(h => `<tr>
      <td>${escHtml(h.queryType)}</td>
      <td>${escHtml(String((h.items || []).length))}</td>
      <td style="font-size:11px;color:var(--text-muted)">${h.generatedAt ? new Date(h.generatedAt).toLocaleString() : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

function copilotFilterHistory() { _copilotRenderHistory(); }

// ─── PREDICTIONS ─────────────────────────────────────────────────────────────

async function copilotPredictFlakiness() {
  if (!_copilotColId) { modAlert('copilot-predict-msg', 'error', 'Select a collection first.'); return; }
  const result = document.getElementById('copilot-predict-result');
  if (!result) return;
  result.innerHTML = '<div style="color:var(--text-muted)">Forecasting flakiness…</div>';
  const res = await fetch('/api/copilot/predict/flakiness', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId: _copilotColId })
  });
  if (!res.ok) { result.innerHTML = '<div style="color:#ef4444">Flakiness forecast failed.</div>'; return; }
  const data = await res.json();
  const forecasts = data.forecasts || [];
  if (!forecasts.length) { result.innerHTML = '<div style="color:var(--text-muted)">No flakiness forecasts available.</div>'; return; }
  result.innerHTML = `<h4 style="margin:0 0 8px">🧪 Flakiness Forecast</h4>
    <table class="data-table"><thead><tr><th>Step ID</th><th>Predicted Score</th><th>Confidence</th><th>Contributing Factors</th></tr></thead>
    <tbody>${forecasts.map(f => {
      const score = f.predictedFlakinessScore || 0;
      const col = score > 70 ? '#ef4444' : score > 40 ? '#f59e0b' : '#22c55e';
      return `<tr>
        <td style="font-size:12px">${escHtml(f.stepId)}</td>
        <td><span style="color:${col};font-weight:600">${escHtml(String(score))}%</span></td>
        <td>${escHtml(String(f.confidence))}%</td>
        <td style="font-size:12px;color:var(--text-muted)">${escHtml((f.contributingFactors || []).join(', ') || '—')}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

async function copilotPredictRetryStorm() {
  if (!_copilotColId) { modAlert('copilot-predict-msg', 'error', 'Select a collection first.'); return; }
  const result = document.getElementById('copilot-predict-result');
  if (!result) return;
  result.innerHTML = '<div style="color:var(--text-muted)">Forecasting retry storm…</div>';
  const res = await fetch('/api/copilot/predict/retry-storm', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId: _copilotColId })
  });
  if (!res.ok) { result.innerHTML = '<div style="color:#ef4444">Retry storm forecast failed.</div>'; return; }
  const f = await res.json();
  const riskColor = { low: '#22c55e', medium: '#f59e0b', high: '#ef4444' };
  result.innerHTML = `<h4 style="margin:0 0 8px">⚡ Retry Storm Forecast</h4>
    <div style="margin-bottom:8px">Risk: <strong style="color:${riskColor[f.stormRisk] || '#9ca3af'}">${escHtml(f.stormRisk || '—')}</strong>
      &nbsp;Predicted retry rate: <strong>${((f.predictedRetryRate || 0) * 100).toFixed(1)}%</strong>
      &nbsp;Confidence: ${escHtml(String(f.confidence || 0))}%</div>
    ${(f.affectedStepIds || []).length ? '<div style="font-size:12px;color:var(--text-muted)">Affected steps: ' + f.affectedStepIds.map(id => escHtml(id)).join(', ') + '</div>' : ''}`;
}

async function copilotPredictSlaBreach() {
  if (!_copilotColId) { modAlert('copilot-predict-msg', 'error', 'Select a collection first.'); return; }
  const slaMetricEl = document.getElementById('copilot-sla-metric');
  const slaValueEl = document.getElementById('copilot-sla-value');
  const slaMetric = slaMetricEl?.value?.trim();
  const currentValue = parseFloat(slaValueEl?.value || '0');
  if (!slaMetric) { modAlert('copilot-predict-msg', 'error', 'Enter SLA metric name.'); return; }
  const result = document.getElementById('copilot-predict-result');
  if (!result) return;
  result.innerHTML = '<div style="color:var(--text-muted)">Forecasting SLA breach…</div>';
  const res = await fetch('/api/copilot/predict/sla-breach', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId: _copilotColId, slaMetric, currentValue })
  });
  if (!res.ok) { result.innerHTML = '<div style="color:#ef4444">SLA breach forecast failed.</div>'; return; }
  const f = await res.json();
  const likelihood = ((f.breachLikelihood || 0) * 100).toFixed(1);
  const col = f.breachLikelihood > 0.7 ? '#ef4444' : f.breachLikelihood > 0.4 ? '#f59e0b' : '#22c55e';
  result.innerHTML = `<h4 style="margin:0 0 8px">SLA Breach Forecast — ${escHtml(slaMetric)}</h4>
    <div>Breach likelihood: <strong style="color:${col}">${likelihood}%</strong>
      &nbsp;Current value: ${escHtml(String(currentValue))}
      &nbsp;Forecasted value: ${f.forecastedValue !== undefined ? escHtml(String(f.forecastedValue)) : '—'}</div>`;
}

function copilotExportHistory() {
  if (!_copilotHistory.length) { showToast('error', 'No history to export.'); return; }
  downloadCSV('copilot-history.csv',
    ['Query Type', 'Items', 'Generated At'],
    _copilotHistory.map(h => [
      h.queryType,
      (h.items || []).length,
      h.generatedAt ? new Date(h.generatedAt).toLocaleString() : ''
    ])
  );
  showToast('success', 'Copilot history exported to copilot-history.csv');
}
