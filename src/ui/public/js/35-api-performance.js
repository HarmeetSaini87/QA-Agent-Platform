// ══════════════════════════════════════════════════════════════════════════════
// PERFORMANCE DASHBOARD MODULE — profiling, cache stats, safeguards
// ══════════════════════════════════════════════════════════════════════════════

let _perfSpans = [];

async function perfLoad() {
  await Promise.all([_perfLoadSafeguards(), _perfLoadCacheStats(), _perfLoadProfile()]);
}

async function _perfLoadSafeguards() {
  const el = document.getElementById('perf-safeguards-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Checking…</div>';
  const res = await fetch('/api/performance/safeguards');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load safeguard status.</div>'; return; }
  const data = await res.json();
  const result = data.result || data;
  const violations = result.violations || [];
  if (result.healthy) {
    el.innerHTML = '<div style="color:#22c55e;font-weight:600">✓ All safeguard checks passed.</div>';
    return;
  }
  const sevColor = { info: '#3b82f6', warning: '#f59e0b', critical: '#ef4444' };
  el.innerHTML = `<table class="data-table"><thead><tr><th>Code</th><th>Severity</th><th>Measured</th><th>Threshold</th><th>Note</th></tr></thead>
    <tbody>${violations.map(v => `<tr>
      <td style="font-size:12px">${escHtml(v.code)}</td>
      <td><span style="color:${sevColor[v.severity] || '#9ca3af'};font-weight:600">${escHtml(v.severity)}</span></td>
      <td>${v.measuredValue !== undefined ? escHtml(String(v.measuredValue)) : '—'}</td>
      <td>${v.threshold !== undefined ? escHtml(String(v.threshold)) : '—'}</td>
      <td style="font-size:12px;color:var(--text-muted)">${escHtml(v.advisoryNote || v.message || '—')}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function _perfLoadCacheStats() {
  const el = document.getElementById('perf-cache-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/performance/cache/stats');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load cache stats.</div>'; return; }
  const data = await res.json();
  const s = data.stats || data;
  const hitRate = s.hitRate !== undefined ? (s.hitRate * 100).toFixed(1) + '%' : '—';
  el.innerHTML = `<div style="display:flex;gap:24px;flex-wrap:wrap">
    <div><div style="font-size:22px;font-weight:700;color:#22c55e">${escHtml(String(s.hits || 0))}</div><div style="font-size:12px;color:var(--text-muted)">Hits</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#f59e0b">${escHtml(String(s.misses || 0))}</div><div style="font-size:12px;color:var(--text-muted)">Misses</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#9ca3af">${escHtml(String(s.evictions || 0))}</div><div style="font-size:12px;color:var(--text-muted)">Evictions</div></div>
    <div><div style="font-size:22px;font-weight:700;color:#3b82f6">${escHtml(hitRate)}</div><div style="font-size:12px;color:var(--text-muted)">Hit Rate</div></div>
  </div>`;
}

async function perfInvalidateCache() {
  const colIdEl = document.getElementById('perf-invalidate-col');
  const colId = colIdEl?.value?.trim();
  if (!colId) { modAlert('perf-dashboard-msg', 'error', 'Enter a Collection ID to invalidate.'); return; }
  const res = await fetch('/api/performance/cache/invalidate/' + encodeURIComponent(colId), { method: 'POST' });
  if (res.ok) {
    modAlert('perf-dashboard-msg', 'success', 'Cache invalidated for ' + escHtml(colId));
    _perfLoadCacheStats();
  } else {
    modAlert('perf-dashboard-msg', 'error', 'Cache invalidation failed.');
  }
}

async function _perfLoadProfile() {
  const el = document.getElementById('perf-profile-result');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/performance/profile');
  if (!res.ok) { el.innerHTML = '<div style="color:#ef4444">Failed to load profiling data.</div>'; return; }
  const data = await res.json();
  const snapshot = data.snapshot || data;
  const spans = snapshot.recentSpans || [];
  _perfSpans = spans;
  if (!spans.length) { el.innerHTML = '<div style="color:var(--text-muted)">No profiling spans recorded yet.</div>'; return; }
  el.innerHTML = `<table class="data-table"><thead><tr><th>Phase</th><th>Label</th><th>Duration (ms)</th><th>Start</th></tr></thead>
    <tbody>${spans.slice(-20).reverse().map(sp => `<tr>
      <td style="font-size:12px">${escHtml(sp.phase || '—')}</td>
      <td style="font-size:12px">${escHtml(sp.label || '—')}</td>
      <td>${sp.durationMs !== undefined ? escHtml(String(sp.durationMs)) : '—'}</td>
      <td style="font-size:11px;color:var(--text-muted)">${sp.startMs ? new Date(sp.startMs).toLocaleTimeString() : '—'}</td>
    </tr>`).join('')}</tbody></table>`;
}

function perfExportSpans() {
  if (!_perfSpans.length) { showToast('error', 'No spans to export. Load the dashboard first.'); return; }
  downloadCSV('perf-spans.csv',
    ['Phase', 'Label', 'Duration (ms)', 'Start'],
    _perfSpans.map(sp => [
      sp.phase || '', sp.label || '',
      sp.durationMs !== undefined ? sp.durationMs : '',
      sp.startMs ? new Date(sp.startMs).toLocaleString() : ''
    ])
  );
  showToast('success', 'Performance spans exported to perf-spans.csv');
}
