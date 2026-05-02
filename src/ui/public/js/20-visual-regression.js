// ── Visual Regression ─────────────────────────────────────────────────────────

let _vrBaselines = [];

async function vrLoad() {
  const loading = document.getElementById('vr-loading');
  const empty = document.getElementById('vr-empty');
  const grid = document.getElementById('vr-grid');
  const summary = document.getElementById('vr-summary');
  if (!loading || !grid) return;

  if (!currentProjectId) {
    loading.style.display = 'block';
    loading.textContent = 'Select a project to view visual baselines.';
    empty.style.display = 'none';
    grid.style.display = 'none';
    return;
  }

  loading.style.display = 'block';
  loading.textContent = 'Loading baselines…';
  empty.style.display = 'none';
  grid.style.display = 'none';

  try {
    const res = await fetch(`/api/visual-baselines?projectId=${encodeURIComponent(currentProjectId)}`);
    const data = await res.json();
    _vrBaselines = Array.isArray(data) ? data : (data.baselines || []);
    vrFilter();
  } catch {
    loading.textContent = 'Error loading baselines.';
  }
}

function vrFilter() {
  const search = (document.getElementById('vr-search')?.value || '').toLowerCase();
  const status = document.getElementById('vr-status-filter')?.value || '';
  const loading = document.getElementById('vr-loading');
  const empty = document.getElementById('vr-empty');
  const grid = document.getElementById('vr-grid');
  const summary = document.getElementById('vr-summary');

  const filtered = _vrBaselines.filter(b => {
    const matchText = !search || b.testName?.toLowerCase().includes(search) || b.locatorName?.toLowerCase().includes(search);
    const matchStat = !status || b.status === status;
    return matchText && matchStat;
  });

  const approved = _vrBaselines.filter(b => b.status === 'approved').length;
  const pending = _vrBaselines.filter(b => b.status === 'pending-review').length;
  if (summary) {
    summary.innerHTML = `
      <span>Total: <strong>${_vrBaselines.length}</strong></span>
      <span style="color:#4ec9b0">Approved: <strong>${approved}</strong></span>
      ${pending ? `<span style="color:#f48771">Pending Review: <strong>${pending}</strong></span>` : ''}
    `;
  }

  loading.style.display = 'none';
  if (!filtered.length) {
    empty.style.display = 'block';
    grid.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = filtered.map(b => vrCard(b)).join('');
}

function vrCard(b) {
  const statusColor = b.status === 'approved' ? '#4ec9b0' : b.status === 'pending-review' ? '#f48771' : '#858585';
  const statusLabel = b.status === 'approved' ? 'Approved' : b.status === 'pending-review' ? 'Pending Review' : 'No Baseline';
  const diffPct = b.diffPct != null ? `${b.diffPct}% diff` : '';
  const lastRun = b.lastRunAt ? new Date(b.lastRunAt).toLocaleString() : 'Never';
  const imgBase = `/api/visual-baselines/${encodeURIComponent(b.id)}/image`;

  return `
    <div class="card" style="padding:0;overflow:hidden;border:1px solid var(--neutral-300)">
      <!-- Header -->
      <div style="padding:10px 14px;background:var(--neutral-100);border-bottom:1px solid var(--neutral-300);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
        <div>
          <div style="font-size:12.5px;font-weight:700;color:var(--neutral-800);max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(b.testName)}">${escHtml(b.testName)}</div>
          <div style="font-size:11.5px;color:var(--neutral-500);margin-top:2px">${escHtml(b.locatorName)}</div>
        </div>
        <span style="font-size:11px;font-weight:700;color:${statusColor};background:${statusColor}22;padding:2px 8px;border-radius:10px;white-space:nowrap">${statusLabel}${diffPct ? ' · ' + diffPct : ''}</span>
      </div>

      <!-- Image trio -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;background:#1e1e1e">
        ${vrThumb(imgBase + '?type=baseline', 'Baseline')}
        ${vrThumb(imgBase + '?type=actual', 'Actual')}
        ${b.status === 'pending-review' ? vrThumb(imgBase + '?type=diff', 'Diff') : `<div style="display:flex;align-items:center;justify-content:center;padding:10px;color:#555;font-size:11px">No diff</div>`}
      </div>

      <!-- Meta + actions -->
      <div style="padding:10px 14px">
        <div style="font-size:11.5px;color:var(--neutral-500);margin-bottom:10px">Last run: ${lastRun}${b.width ? ` · ${b.width}×${b.height}` : ''}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${(!isViewer() && b.status === 'pending-review') ? `<button class="btn btn-primary btn-sm" onclick="vrApprove('${b.id}')">&#10003; Approve</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="vrViewDiff('${b.id}')">&#128247; View Images</button>
          ${isViewer() ? '' : `<button class="btn btn-outline btn-sm" style="color:#f48771;border-color:#f48771" onclick="vrDelete('${b.id}', '${escHtml(b.testName)}')">&#128465; Delete</button>`}
        </div>
      </div>
    </div>
  `;
}

function vrThumb(src, label) {
  return `
    <div style="position:relative;cursor:pointer" onclick="window.open('${src}','_blank')">
      <img src="${src}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
           style="width:100%;height:100px;object-fit:contain;display:block;background:#1e1e1e">
      <div style="display:none;align-items:center;justify-content:center;height:100px;color:#555;font-size:11px">${label}: none</div>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;text-align:center;padding:2px">${label}</div>
    </div>`;
}

async function vrApprove(id) {
  if (!confirm('Approve this baseline? The current "actual" screenshot will become the new baseline.')) return;
  try {
    const res = await fetch(`/api/visual-baselines/${encodeURIComponent(id)}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedBy: currentUser?.username || 'ui' })
    });
    const d = await res.json();
    if (d.ok) { await vrLoad(); }
    else alert('Approve failed: ' + (d.error || 'unknown'));
  } catch (e) { alert('Approve failed: ' + e.message); }
}

async function vrDelete(id, name) {
  if (!confirm(`Delete baseline for "${name}"?\n\nThe next test run will create a fresh baseline.`)) return;
  try {
    const res = await fetch(`/api/visual-baselines/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const d = await res.json();
    if (d.ok) { await vrLoad(); }
    else alert('Delete failed: ' + (d.error || 'unknown'));
  } catch (e) { alert('Delete failed: ' + e.message); }
}

function vrViewDiff(id) {
  const b = _vrBaselines.find(x => x.id === id);
  if (!b) return;
  const imgBase = `/api/visual-baselines/${encodeURIComponent(id)}/image`;
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Visual Diff — ${escHtml(b.testName)}</title>
  <style>body{margin:0;background:#1e1e1e;font-family:sans-serif;color:#ccc}
  .hdr{padding:16px;background:#252526;border-bottom:1px solid #333;display:flex;align-items:center;gap:16px}
  .hdr h2{margin:0;font-size:16px}.meta{font-size:12px;color:#888}
  .imgs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;height:calc(100vh - 70px)}
  .col{display:flex;flex-direction:column;border-right:1px solid #333}
  .col:last-child{border-right:none}
  .col-hdr{padding:8px 12px;font-size:12px;font-weight:700;background:#2d2d2d;text-align:center}
  .col img{width:100%;flex:1;object-fit:contain;background:#1a1a1a}
  </style></head><body>
  <div class="hdr"><h2>&#128247; Visual Diff</h2>
  <div class="meta">${escHtml(b.testName)} · ${escHtml(b.locatorName)}${b.diffPct != null ? ' · ' + b.diffPct + '% diff' : ''}</div></div>
  <div class="imgs">
  <div class="col"><div class="col-hdr">Baseline (approved)</div><img src="${imgBase}?type=baseline" onerror="this.alt='No baseline'"></div>
  <div class="col"><div class="col-hdr">Actual (last run)</div><img src="${imgBase}?type=actual" onerror="this.alt='No actual'"></div>
  <div class="col"><div class="col-hdr">Diff (red = changed)</div><img src="${imgBase}?type=diff" onerror="this.alt='No diff'"></div>
  </div></body></html>`);
  win.document.close();
}

