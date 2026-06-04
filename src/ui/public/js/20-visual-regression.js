// ── Visual Regression ─────────────────────────────────────────────────────────

let _vrBaselines = [];

// Browser icon SVGs (inline, same as execution-report.html)
const VR_BROWSER_ICONS = {
  chromium: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#4285F4"/><circle cx="12" cy="12" r="4" fill="white"/><path d="M12 8 A4 4 0 0 1 19.46 10 L22 10 A10 10 0 0 0 2.54 10 L8 10 A4 4 0 0 1 12 8Z" fill="#EA4335"/><path d="M8 10 A4 4 0 0 0 12 16 L9 20.93 A10 10 0 0 1 2.54 10Z" fill="#34A853"/><path d="M12 16 A4 4 0 0 0 19.46 14 L22 14 A10 10 0 0 1 9 20.93Z" fill="#FBBC05"/></svg>`,
  firefox:  `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#FF6611"/><circle cx="12" cy="12" r="5" fill="#FFB830"/><circle cx="12" cy="12" r="2.5" fill="#FF6611"/></svg>`,
  webkit:   `<svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#006EAF"/><circle cx="12" cy="12" r="3" fill="white"/><line x1="12" y1="4" x2="12" y2="20" stroke="white" stroke-width="1.5"/><line x1="4" y1="12" x2="20" y2="12" stroke="white" stroke-width="1.5"/></svg>`,
};

function vrBrowserIcon(browser) {
  return VR_BROWSER_ICONS[(browser || 'chromium').toLowerCase()] || VR_BROWSER_ICONS.chromium;
}

async function vrLoad() {
  const loading = document.getElementById('vr-loading');
  const empty = document.getElementById('vr-empty');
  const grid = document.getElementById('vr-grid');
  const summary = document.getElementById('vr-summary');
  if (!loading || !grid || !empty) return;

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
  const search  = (document.getElementById('vr-search')?.value || '').toLowerCase();
  const status  = document.getElementById('vr-status-filter')?.value  || '';
  const browser = document.getElementById('vr-browser-filter')?.value || '';
  const loading = document.getElementById('vr-loading');
  const empty   = document.getElementById('vr-empty');
  const grid    = document.getElementById('vr-grid');
  const summary = document.getElementById('vr-summary');

  let filtered = _vrBaselines.filter(b => {
    const matchText    = !search  || b.testName?.toLowerCase().includes(search) || b.locatorName?.toLowerCase().includes(search);
    const matchStatus  = !status  || b.status === status;
    const bBrowser     = b.browser || '__legacy';
    const matchBrowser = !browser || bBrowser === browser;
    return matchText && matchStatus && matchBrowser;
  });

  const approved  = _vrBaselines.filter(b => b.status === 'approved').length;
  const pending   = _vrBaselines.filter(b => b.status === 'pending-review').length;
  const logicalSet = new Set(_vrBaselines.map(b => `${b.testName}||${b.locatorName}`));
  const browserEntries = _vrBaselines.filter(b => b.browser).length;
  if (summary) {
    summary.innerHTML = `
      <span>Logical baselines: <strong>${logicalSet.size}</strong></span>
      <span style="color:#4ec9b0">Approved: <strong>${approved}</strong></span>
      ${pending   ? `<span style="color:#f48771">Pending: <strong>${pending}</strong></span>` : ''}
      ${browserEntries ? `<span style="color:#818cf8">Browser-scoped: <strong>${browserEntries}</strong></span>` : ''}
    `;
  }

  loading.style.display = 'none';
  if (!filtered.length) {
    empty.style.display = 'block';
    grid.style.display  = 'none';
    return;
  }
  empty.style.display = 'none';
  grid.style.display  = 'grid';

  // Group by logical key (testName + locatorName)
  const groups = new Map();
  for (const b of filtered) {
    const key = `${b.testName}||${b.locatorName}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  grid.innerHTML = Array.from(groups.values()).map(entries => vrGroupedCard(entries)).join('');
  // Init sliders now that HTML is in the DOM
  vrSlidersInit(grid);
  // Show/hide bulk bar based on whether viewer mode
  const bulkBar = document.getElementById('vr-bulk-bar');
  if (bulkBar) bulkBar.style.display = isViewer() ? 'none' : 'flex';
  vrBulkBarUpdate();
}

function vrGroupedCard(entries) {
  const BROWSER_ORDER = { chromium: 0, firefox: 1, webkit: 2 };
  entries.sort((a, b) => {
    const oa = a.browser ? (BROWSER_ORDER[a.browser] ?? 9) : 99;
    const ob = b.browser ? (BROWSER_ORDER[b.browser] ?? 9) : 99;
    return oa - ob;
  });

  const rep = entries[0];
  // Stable unique ID for collapse/expand toggle
  // OLD: slicing to 40 chars caused ID collisions when all cards share the same long testName prefix
  // const groupId = 'vrg-' + btoa(encodeURIComponent(rep.testName + '||' + rep.locatorName)).replace(/[^a-z0-9]/gi, '').slice(0, 40);
  const groupId = 'vrg-' + btoa(encodeURIComponent(rep.projectId + '|' + rep.locatorName)).replace(/[^a-z0-9]/gi, '');
  const allIdsJson = escHtml(JSON.stringify(entries.map(e => e.id)));

  const approvedCount = entries.filter(e => e.status === 'approved').length;
  const pendingCount  = entries.filter(e => e.status === 'pending-review').length;
  const coverageBadge = entries.some(e => e.browser)
    ? `<span style="font-size:10px;background:#ede9fe;color:#4f46e5;padding:2px 7px;border-radius:10px;font-weight:700" title="Browser-scoped baselines">${approvedCount}/${entries.length} ✓</span>`
    : '';
  const ignoreTotal = entries.reduce((s, e) => s + (e.ignoreRegions?.length || 0), 0);
  const browserRows = entries.map(b => vrBrowserRow(b)).join('');
  const pendingBadge = pendingCount
    ? `<span style="font-size:11px;font-weight:700;color:#f48771;background:#f4877122;padding:2px 8px;border-radius:10px">${pendingCount} pending</span>`
    : '';
  const ignoreBadge = ignoreTotal
    ? `<span style="font-size:10px;background:#dcfce7;color:#166534;padding:2px 7px;border-radius:10px;">&#127919; ${ignoreTotal} region${ignoreTotal > 1 ? 's' : ''}</span>`
    : '';
  const browserCountBadge = entries.length > 1
    ? `<span style="font-size:10px;background:#f1f5f9;color:#64748b;padding:2px 7px;border-radius:10px">${entries.length} browser${entries.length > 1 ? 's' : ''}</span>`
    : '';

  return `
    <div class="card" style="padding:0;overflow:hidden;border:1px solid var(--neutral-300)">
      <!-- Group header — click to expand/collapse -->
      <div style="padding:10px 14px;background:var(--neutral-100);border-bottom:1px solid var(--neutral-300);display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none" onclick="vrToggleGroup('${groupId}')">
        ${isViewer() ? '' : `<input type="checkbox" class="vr-bulk-cb" data-ids='${allIdsJson}' onclick="event.stopPropagation();vrBulkBarUpdate()" style="margin:0;cursor:pointer;flex-shrink:0">`}
        <span id="${groupId}-arrow" style="font-size:11px;color:var(--neutral-400);flex-shrink:0">▶</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12.5px;font-weight:700;color:var(--neutral-800);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(rep.testName)}">${escHtml(rep.testName)}</div>
          <div style="font-size:11.5px;color:var(--neutral-500);margin-top:2px">${escHtml(rep.locatorName)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0" onclick="event.stopPropagation()">
          ${browserCountBadge}${coverageBadge}${pendingBadge}${ignoreBadge}
        </div>
      </div>
      <!-- Browser rows — hidden by default, expanded on click -->
      <div id="${groupId}-rows" style="display:none;padding:8px 14px;flex-direction:column;gap:8px">
        ${browserRows}
      </div>
    </div>
  `;
}

function vrToggleGroup(groupId) {
  const rows  = document.getElementById(groupId + '-rows');
  const arrow = document.getElementById(groupId + '-arrow');
  if (!rows) return;
  const opening = rows.style.display === 'none';
  rows.style.display  = opening ? 'flex' : 'none';
  if (arrow) arrow.textContent = opening ? '▼' : '▶';
  // Init any viewers that became visible (defensive — covers lazy-render edge cases)
  if (opening) vrSlidersInit(rows);
}

function vrBulkBarUpdate() {
  const cbs    = Array.from(document.querySelectorAll('.vr-bulk-cb'));
  const checked = cbs.filter(c => c.checked);
  const bar    = document.getElementById('vr-bulk-bar');
  const count  = document.getElementById('vr-bulk-count');
  const selAll = document.getElementById('vr-select-all');
  if (!bar) return;
  const totalIds = checked.flatMap(c => { try { return JSON.parse(c.dataset.ids); } catch { return []; } });
  bar.style.display = cbs.length ? 'flex' : 'none';
  if (count) count.textContent = checked.length ? `${totalIds.length} baseline${totalIds.length > 1 ? 's' : ''} selected` : 'None selected';
  if (selAll) selAll.checked = cbs.length > 0 && checked.length === cbs.length;
}

function vrSelectAll(checked) {
  document.querySelectorAll('.vr-bulk-cb').forEach(cb => { cb.checked = checked; });
  vrBulkBarUpdate();
}

function vrClearSelection() {
  document.querySelectorAll('.vr-bulk-cb').forEach(cb => { cb.checked = false; });
  vrBulkBarUpdate();
}

async function vrBulkDelete() {
  const checked = Array.from(document.querySelectorAll('.vr-bulk-cb:checked'));
  if (!checked.length) return;
  const ids = checked.flatMap(c => { try { return JSON.parse(c.dataset.ids); } catch { return []; } });
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} baseline${ids.length > 1 ? 's' : ''}? The next test run will create fresh baselines for each.`)) return;
  let failed = 0;
  for (const id of ids) {
    try {
      const res = await fetch(`/api/visual-baselines/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!d.ok && !d.success) failed++;
    } catch { failed++; }
  }
  if (failed) alert(`${failed} deletion${failed > 1 ? 's' : ''} failed. Refreshing…`);
  await vrLoad();
}

function vrBrowserRow(b) {
  const statusColor = b.status === 'approved' ? '#4ec9b0' : b.status === 'pending-review' ? '#f48771' : '#858585';
  const statusLabel = b.status === 'approved' ? 'Approved' : b.status === 'pending-review' ? 'Pending' : 'No Baseline';
  const diffPct     = b.diffPct != null && b.diffPct > 0 ? ` · ${b.diffPct}%` : '';
  const browserLabel = b.browser
    ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--neutral-700)">${vrBrowserIcon(b.browser)} ${b.browser.charAt(0).toUpperCase() + b.browser.slice(1)}</span>`
    : `<span style="font-size:11px;color:#94a3b8;font-style:italic">Legacy (no browser)</span>`;
  const imgBase = `/api/visual-baselines/${encodeURIComponent(b.id)}/image`;
  // OLD: const hasDiff = b.diffPct > 0 || b.lastSavedPixels > 0;
  const hasDiff = (b.diffPct != null && b.diffPct > 0) || b.lastSavedPixels > 0;
  const lastRun = b.lastRunAt ? new Date(b.lastRunAt).toLocaleString() : 'Never run';

  return `
    <div style="border:1px solid var(--neutral-200);border-radius:8px;overflow:hidden">
      <div style="padding:6px 10px;background:#fafafa;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--neutral-200)">
        <div style="display:flex;align-items:center;gap:8px">
          ${browserLabel}
          <span style="font-size:11px;color:${statusColor};background:${statusColor}22;padding:1px 7px;border-radius:8px;font-weight:600">${statusLabel}${diffPct}</span>
          ${(b.ignoreRegions?.length) ? `<span style="font-size:10px;background:#dcfce7;color:#166534;padding:1px 6px;border-radius:8px">&#127919; ${b.ignoreRegions.length}</span>` : ''}
        </div>
        <div style="font-size:10.5px;color:var(--neutral-400)">${lastRun}${b.width ? ` · ${b.width}×${b.height}` : ''}</div>
      </div>
      <div style="background:#111">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0">${vrThumb(imgBase + '?type=baseline', 'Baseline')}${vrThumb(imgBase + '?type=actual', 'Actual')}${hasDiff ? vrThumb(imgBase + '?type=diff', b.lastSavedPixels > 0 ? 'Diff (Regions)' : 'Diff') : '<div style="display:flex;align-items:center;justify-content:center;height:70px;color:#555;font-size:10px">No diff</div>'}</div>
      </div>
      <div style="padding:6px 10px;display:flex;gap:6px;flex-wrap:wrap">
        ${(!isViewer() && b.status === 'pending-review') ? `<button class="btn btn-primary btn-sm" onclick="vrApprove('${escHtml(b.id)}')">&#10003; Approve</button>` : ''}
        <button class="btn btn-outline btn-sm" onclick="vrViewDiff('${escHtml(b.id)}')">&#128247; View</button>
        ${isViewer() ? '' : `<button class="btn btn-outline btn-sm" style="color:#f48771;border-color:#f48771" onclick="vrDelete('${escHtml(b.id)}', '${escHtml(b.testName)}')">&#128465;</button>`}
        <button class="btn btn-outline btn-sm" onclick="vrtOpenIgnoreEditor('${escHtml(b.id)}')" style="color:#4f46e5;border-color:#4f46e5;font-size:11px">&#127919; Regions${(b.ignoreRegions?.length) ? ` <span style="background:#22c55e;color:#fff;border-radius:8px;padding:0 4px;font-size:9px;margin-left:3px">${b.ignoreRegions.length}</span>` : ''}</button>
      </div>
    </div>
  `;
}

// Backward-compat alias — kept in case of any direct vrCard() calls elsewhere
function vrCard(b) { return vrGroupedCard([b]); }

function vrThumb(src, label) {
  return `
    <div style="position:relative;cursor:pointer" onclick="window.open('${src}','_blank')">
      <img src="${src}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
           style="width:100%;height:100px;object-fit:contain;display:block;background:#1e1e1e">
      <div style="display:none;align-items:center;justify-content:center;height:100px;color:#555;font-size:11px">${label}: none</div>
      <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.6);color:#fff;font-size:10px;text-align:center;padding:2px">${label}</div>
    </div>`;
}

// ── Multi-Mode Viewer Component ──────────────────────────────────────────────
// 4 modes: Slider (B+C hot-zone), Onion Skin, Blink/Flicker, Diff-only.

function vrSliderHtml(baseUrl, actualUrl, diffUrl) {
  if (!baseUrl || !actualUrl) return '';
  const mb = `style="padding:3px 10px;border:none;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.08);color:#94a3b8;transition:all .15s"`;
  const mbOn = `style="padding:3px 10px;border:none;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer;background:#334155;color:#f1f5f9"`;
  return `<div class="vr-viewer" data-diff="${diffUrl||''}" style="background:#111;display:block">
    <div style="display:flex;gap:4px;padding:5px 6px;background:#0d0d0d;border-bottom:1px solid #1e1e1e">
      <button class="vr-mb vr-mb-on" data-mode="slider" ${mbOn}>⟺ Slider</button>
      <button class="vr-mb" data-mode="onion"  ${mb}>👁 Onion</button>
      <button class="vr-mb" data-mode="blink"  ${mb}>💡 Blink</button>
      ${diffUrl ? `<button class="vr-mb" data-mode="diff" ${mb}>▣ Diff</button>` : ''}
    </div>
    <div class="vr-m vr-m-slider">
      <div class="vr-sl" style="position:relative;overflow:hidden;cursor:ew-resize;user-select:none">
        <img class="vr-sl-a" src="${actualUrl}"  draggable="false" alt="Actual"   style="display:block;width:100%;object-fit:contain;background:#111">
        <img class="vr-sl-b" src="${baseUrl}"    draggable="false" alt="Baseline" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;clip-path:inset(0 50% 0 0)">
        <div class="vr-sl-d" style="position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);pointer-events:none;background:rgba(255,255,255,.85);transition:background .1s,box-shadow .1s"></div>
        <div class="vr-sl-k" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:30px;height:30px;border-radius:50%;background:#fff;color:#333;box-shadow:0 2px 10px rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font-size:14px;pointer-events:none;transition:background .15s,box-shadow .15s">⟺</div>
        <div class="vr-sl-t" style="display:none;position:absolute;bottom:calc(50% + 20px);transform:translateX(-50%);background:#fff;border:1px solid #e2e8f0;color:#111;font-size:10px;padding:3px 10px;border-radius:6px;white-space:nowrap;pointer-events:none;font-weight:700;z-index:4;box-shadow:0 2px 8px rgba(0,0,0,.5)"></div>
        <span style="position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:space-between;pointer-events:none;padding:0 4px 2px">
          <span style="background:rgba(0,0,0,.35);color:rgba(255,255,255,.45);font-size:8px;padding:0 4px;border-radius:2px;font-weight:600;letter-spacing:.03em">B</span>
          <span style="background:rgba(0,0,0,.35);color:rgba(255,255,255,.45);font-size:8px;padding:0 4px;border-radius:2px;font-weight:600;letter-spacing:.03em">A</span>
        </span>
      </div>
      ${diffUrl ? `<div style="height:4px;background:#0a0a0a;position:relative;overflow:hidden">
        <canvas class="vr-ht-c" height="4" style="display:block;width:100%;height:4px"></canvas>
        <div class="vr-ht-n" style="position:absolute;top:0;bottom:0;width:2px;background:#fff;opacity:.5;transform:translateX(-50%);left:50%;pointer-events:none"></div>
      </div>` : ''}
    </div>
    <div class="vr-m vr-m-onion" style="display:none">
      <div style="position:relative;overflow:hidden">
        <img src="${actualUrl}"  draggable="false" alt="Actual"   style="display:block;width:100%;object-fit:contain;background:#111">
        <img class="vr-onion-bl" src="${baseUrl}" draggable="false" alt="Baseline" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.5">
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:#0d0d0d;border-top:1px solid #1e1e1e">
        <span style="font-size:10px;color:#555;white-space:nowrap">Baseline</span>
        <input type="range" class="vr-onion-r" min="0" max="100" value="50" style="flex:1;accent-color:#059669;height:3px;cursor:pointer">
        <span class="vr-onion-p" style="font-size:10px;color:#6ee7b7;font-weight:700;min-width:28px;text-align:right">50%</span>
      </div>
    </div>
    <div class="vr-m vr-m-blink" style="display:none">
      <div style="position:relative;overflow:hidden">
        <img class="vr-blink-a" src="${actualUrl}"  draggable="false" alt="Actual"   style="display:block;width:100%;object-fit:contain;background:#111">
        <img class="vr-blink-b" src="${baseUrl}"    draggable="false" alt="Baseline" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity 0s">
        <span class="vr-blink-lbl" style="position:absolute;top:6px;left:8px;background:rgba(0,0,0,.72);color:#fff;font-size:10px;padding:2px 7px;border-radius:3px;font-weight:600">Actual</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:#0d0d0d;border-top:1px solid #1e1e1e">
        <button class="vr-blink-btn" style="padding:3px 12px;background:#d9770622;color:#fbbf24;border:1px solid #d9770644;border-radius:5px;font-size:10px;font-weight:700;cursor:pointer">▶ Blink</button>
        <span style="font-size:10px;color:#444">Alternates baseline ↔ actual — eye catches the change</span>
      </div>
    </div>
    ${diffUrl ? `<div class="vr-m vr-m-diff" style="display:none">
      <img src="${diffUrl}" draggable="false" alt="Diff" style="display:block;width:100%;object-fit:contain;background:#111">
    </div>` : ''}
  </div>`;
}

function vrViewerInit(el) {
  if (el.dataset.vrReady) return;
  el.dataset.vrReady = '1';
  const diffUrl = el.dataset.diff || '';
  const mBtns  = el.querySelectorAll('.vr-mb');
  const mPanels= el.querySelectorAll('.vr-m');
  let blinkTimer = null;

  // ── Mode switch ──────────────────────────────────────────────────
  function applyModeStyles(btn, on) {
    if (on) { btn.style.background='#334155'; btn.style.color='#f1f5f9'; }
    else     { btn.style.background='rgba(255,255,255,.08)'; btn.style.color='#94a3b8'; }
  }
  function switchMode(m) {
    if (blinkTimer && m !== 'blink') stopBlink();
    mBtns.forEach(b => applyModeStyles(b, b.dataset.mode === m));
    mPanels.forEach(p => { p.style.display = p.classList.contains('vr-m-' + m) ? '' : 'none'; });
  }
  mBtns.forEach(b => b.addEventListener('click', e => { e.stopPropagation(); switchMode(b.dataset.mode); }));

  // ── Slider (B+C) ─────────────────────────────────────────────────
  const slFrame = el.querySelector('.vr-sl');
  const slBase  = el.querySelector('.vr-sl-b');
  const slDiv   = el.querySelector('.vr-sl-d');
  const slKnob  = el.querySelector('.vr-sl-k');
  const slTip   = el.querySelector('.vr-sl-t');
  const htNeedle= el.querySelector('.vr-ht-n');
  let zones = [], dragging = false;

  function inDiff(p) { return zones.some(z => p >= z.s && p <= z.e); }
  function setSlPos(pct) {
    pct = Math.max(0, Math.min(100, pct));
    slBase.style.clipPath = `inset(0 ${100-pct}% 0 0)`;
    slDiv.style.left = slKnob.style.left = pct + '%';
    if (htNeedle) htNeedle.style.left = pct + '%';
    const hot = inDiff(pct);
    slDiv.style.background   = hot ? '#ef4444' : 'rgba(255,255,255,.85)';
    slDiv.style.boxShadow    = hot ? '0 0 12px 4px rgba(239,68,68,.65)' : '';
    slKnob.style.background  = hot ? '#ef4444' : '#fff';
    slKnob.style.color       = hot ? '#fff' : '#333';
    slKnob.style.boxShadow   = hot ? '0 0 16px 5px rgba(239,68,68,.55)' : '0 2px 10px rgba(0,0,0,.6)';
    slKnob.textContent       = hot ? '⚡' : '⟺';
    if (slTip) {
      slTip.style.left    = pct + '%';
      slTip.style.display = (dragging && zones.length) ? 'block' : 'none';
      slTip.textContent   = hot ? '⚡ Diff here!' : `Baseline · ${Math.round(pct)}%`;
      Object.assign(slTip.style, hot
        ? { background:'#dc2626', borderColor:'#ef4444', color:'#fff' }
        : { background:'#fff', borderColor:'#e2e8f0', color:'#111' });
    }
  }
  function fromE(e) {
    const r  = slFrame.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    return ((cx - r.left) / r.width) * 100;
  }
  function onMove(e) { if (dragging) setSlPos(fromE(e)); }
  function onUp()    { dragging=false; if(slTip) slTip.style.display='none'; document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
  if (slFrame) {
    slFrame.addEventListener('mousedown', e => { dragging=true; setSlPos(fromE(e)); document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp); e.preventDefault(); });
    slFrame.addEventListener('touchstart', e => { dragging=true; setSlPos(fromE(e)); e.preventDefault(); }, {passive:false});
    slFrame.addEventListener('touchmove',  e => { if(dragging) setSlPos(fromE(e)); e.preventDefault(); }, {passive:false});
    slFrame.addEventListener('touchend',   () => { dragging=false; if(slTip) slTip.style.display='none'; });
  }
  setSlPos(50);

  // ── Canvas analysis — pixel-accurate B+C hot-zone ─────────────────
  if (diffUrl) {
    const img = new Image();
    img.onload = () => {
      try {
        const W = img.naturalWidth, H = img.naturalHeight;
        if (!W || !H) return;
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, W, H).data;
        const cols = new Float32Array(W);
        for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
          const i=(y*W+x)*4;
          if (px[i]>180 && px[i+1]<80 && px[i+2]<80) cols[x]++;
        }
        const THRESH = Math.max(1, H*0.005);
        const found=[]; let inZ=false, zS=0;
        for (let x=0;x<W;x++) {
          if (!inZ && cols[x]>THRESH) { inZ=true; zS=x; }
          if (inZ && cols[x]<=THRESH) { inZ=false; const pad=W*0.02; found.push({s:Math.max(0,(zS-pad)/W*100),e:Math.min(100,(x+pad)/W*100)}); }
        }
        if (inZ) found.push({s:Math.max(0,(zS-W*0.02)/W*100),e:100});
        if (found.length) { zones=found; drawHeatCols(el,cols,W); }
      } catch(e) { /* canvas blocked — no hot-zone, plain slider still works */ }
    };
    img.src = diffUrl;
  }

  function drawHeatCols(viewer, cols, W) {
    const canvas = viewer.querySelector('.vr-ht-c'); if(!canvas) return;
    canvas.width = Math.round((canvas.offsetWidth||300)*(window.devicePixelRatio||1));
    const ctx=canvas.getContext('2d'), cw=canvas.width;
    let maxV=0; for(let i=0;i<cols.length;i++) if(cols[i]>maxV) maxV=cols[i];
    for(let x=0;x<cw;x++){
      const v=maxV>0?cols[Math.floor((x/cw)*W)]/maxV:0;
      ctx.fillStyle=v>0.01?`rgba(239,68,68,${(0.25+v*0.75).toFixed(2)})`:'#0a0a0a';
      ctx.fillRect(x,0,1,4);
    }
  }

  // ── Onion skin ───────────────────────────────────────────────────
  const onionBl = el.querySelector('.vr-onion-bl');
  const onionR  = el.querySelector('.vr-onion-r');
  const onionP  = el.querySelector('.vr-onion-p');
  if (onionR) onionR.addEventListener('input', function() {
    if (onionBl) onionBl.style.opacity = this.value/100;
    if (onionP)  onionP.textContent = this.value+'%';
  });

  // ── Blink ────────────────────────────────────────────────────────
  const blinkBtn = el.querySelector('.vr-blink-btn');
  const blinkA   = el.querySelector('.vr-blink-a');
  const blinkB   = el.querySelector('.vr-blink-b');
  const blinkLbl = el.querySelector('.vr-blink-lbl');
  let   blinkState = false;

  // use opacity toggle — blinkA stays in flow so container height is stable
  function stopBlink() {
    if (!blinkTimer) return;
    clearInterval(blinkTimer); blinkTimer=null;
    if (blinkBtn) { blinkBtn.textContent='▶ Blink'; blinkBtn.style.background='#d9770622'; blinkBtn.style.color='#fbbf24'; }
    if (blinkA)   blinkA.style.opacity='1';
    if (blinkB)   blinkB.style.opacity='0';
    if (blinkLbl) blinkLbl.textContent='Actual';
    blinkState=false;
  }
  if (blinkBtn) blinkBtn.addEventListener('click', e => {
    e.stopPropagation();
    if (blinkTimer) { stopBlink(); return; }
    blinkBtn.textContent='⏹ Stop'; blinkBtn.style.background='#d97706'; blinkBtn.style.color='#fff';
    blinkTimer=setInterval(()=>{
      blinkState=!blinkState;
      if(blinkA)   blinkA.style.opacity   = blinkState?'0':'1';
      if(blinkB)   blinkB.style.opacity   = blinkState?'1':'0';
      if(blinkLbl) blinkLbl.textContent   = blinkState?'Baseline':'Actual';
    },400);
  });
}

// legacy alias kept so vrViewDiff popup (which still uses vrSliderInit) keeps working
function vrSliderInit(el) {
  const baseline = el.querySelector('.vr-slider-baseline') || el.querySelector('.baseline');
  const divider  = el.querySelector('.vr-slider-divider')  || el.querySelector('.divider');
  const knob     = el.querySelector('.vr-slider-knob')     || el.querySelector('.knob');
  const pctEl    = el.querySelector('.vr-slider-pct');
  if (!baseline || !divider || !knob) return;

  function setPos(pct) {
    pct = Math.max(0, Math.min(100, pct));
    const right = 100 - pct;
    baseline.style.clipPath = `inset(0 ${right}% 0 0)`;
    divider.style.left      = pct + '%';
    knob.style.left         = pct + '%';
    el.setAttribute('aria-valuenow', Math.round(pct));
    if (pctEl) {
      pctEl.style.left    = pct + '%';
      pctEl.textContent   = Math.round(pct) + '%';
    }
  }

  function pctFromEvent(e) {
    const rect = el.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }

  function curPct() {
    const m = baseline.style.clipPath.match(/inset\(0 ([\d.]+)% 0 0\)/);
    return m ? 100 - parseFloat(m[1]) : 50;
  }

  let dragging = false;

  function onMouseMove(e) { if (dragging) setPos(pctFromEvent(e)); }
  function onMouseUp()    { dragging = false; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); }
  function onTouchMove(e) { if (dragging) { setPos(pctFromEvent(e)); e.preventDefault(); } }
  function onTouchEnd()   { dragging = false; document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd); }

  el.addEventListener('mousedown', e => {
    dragging = true;
    setPos(pctFromEvent(e));
    e.preventDefault();
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });
  el.addEventListener('touchstart', e => {
    dragging = true;
    setPos(pctFromEvent(e));
    e.preventDefault();
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);
  }, { passive: false });
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { setPos(curPct() - 1); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setPos(curPct() + 1); e.preventDefault(); }
    if (e.key === 'Home')       { setPos(0);   e.preventDefault(); }
    if (e.key === 'End')        { setPos(100); e.preventDefault(); }
  });
  setPos(50); // initial 50/50 split
}

function vrSlidersInit(container) {
  (container || document).querySelectorAll('.vr-viewer:not([data-vr-ready])').forEach(el => vrViewerInit(el));
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
    if (d.ok || d.success) { await vrLoad(); }
    else alert('Delete failed: ' + (d.error || 'unknown'));
  } catch (e) { alert('Delete failed: ' + e.message); }
}

function vrViewDiff(id) {
  const b = _vrBaselines.find(x => x.id === id);
  if (!b) return;
  const imgBase   = `/api/visual-baselines/${encodeURIComponent(id)}/image`;
  const baseUrl   = imgBase + '?type=baseline';
  const actualUrl = imgBase + '?type=actual';
  const diffUrl   = imgBase + '?type=diff';
  const hasDiff   = b.diffPct > 0 || b.lastSavedPixels > 0;
  const win = window.open('', '_blank');
  // OLD: no null-check — crashes when popup is blocked
  if (!win) { alert('Popup blocked. Please allow popups for this page.'); return; }

  const diffPctStr = b.diffPct != null ? b.diffPct + '% diff' : '';

  win.document.write(`<!DOCTYPE html><html><head>
  <title>Visual Diff — ${escHtml(b.testName)}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0d0d0d;font-family:system-ui,sans-serif;color:#ccc;height:100vh;display:flex;flex-direction:column;overflow:hidden}
    .hdr{padding:10px 18px;background:#1a1a1a;border-bottom:1px solid #2a2a2a;display:flex;align-items:center;gap:12px;flex-shrink:0}
    .hdr h2{font-size:14px;color:#fff;font-weight:700}
    .meta{font-size:11px;color:#666}
    .badge{font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700}
    .badge-diff{background:#fee2e2;color:#b91c1c}.badge-ok{background:#dcfce7;color:#166534}
    .layout{display:grid;grid-template-columns:2fr 1fr;flex:1;min-height:0;overflow:hidden;gap:0}
    .left-panel{display:flex;flex-direction:column;border-right:1px solid #2a2a2a;overflow:hidden}
    .right-panel{display:flex;flex-direction:column;overflow:hidden}
    .panel-hdr{padding:6px 12px;font-size:11px;font-weight:700;background:#161616;border-bottom:1px solid #222;flex-shrink:0;color:#888;display:flex;align-items:center;gap:8px}
    .panel-body{flex:1;overflow:hidden;position:relative;background:#111}
    /* ── Mode bar ── */
    .vr-mb-bar{display:flex;gap:4px;padding:5px 8px;background:#0d0d0d;border-bottom:1px solid #1e1e1e;flex-shrink:0}
    .vr-mb{padding:4px 12px;border:none;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.07);color:#64748b;transition:all .15s}
    .vr-mb.on{background:#334155;color:#f1f5f9}
    /* ── Slider mode ── */
    .vr-sl{position:relative;overflow:hidden;cursor:ew-resize;user-select:none;width:100%;height:100%}
    .vr-sl-a{display:block;width:100%;height:100%;object-fit:contain;background:#111}
    .vr-sl-b{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;clip-path:inset(0 50% 0 0)}
    .vr-sl-d{position:absolute;top:0;bottom:0;left:50%;width:2px;transform:translateX(-50%);pointer-events:none;background:rgba(255,255,255,.85);transition:background .1s,box-shadow .1s}
    .vr-sl-k{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:36px;height:36px;border-radius:50%;background:#fff;color:#333;box-shadow:0 2px 12px rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;font-size:16px;pointer-events:none;transition:background .15s}
    .vr-sl-t{display:none;position:absolute;bottom:calc(50% + 22px);transform:translateX(-50%);background:#fff;border:1px solid #e2e8f0;color:#111;font-size:11px;padding:4px 12px;border-radius:6px;white-space:nowrap;pointer-events:none;font-weight:700;z-index:4;box-shadow:0 2px 8px rgba(0,0,0,.5)}
    .vr-ht-bar{height:4px;background:#0a0a0a;position:relative;overflow:hidden;flex-shrink:0}
    /* ── Onion mode ── */
    .vr-onion{position:relative;overflow:hidden;width:100%;height:100%}
    .vr-onion-a{display:block;width:100%;height:100%;object-fit:contain;background:#111}
    .vr-onion-bl{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.5}
    .vr-onion-bar{display:flex;align-items:center;gap:10px;padding:6px 12px;background:#0d0d0d;border-top:1px solid #1e1e1e;flex-shrink:0}
    /* ── Blink mode ── */
    .vr-blink-wrap{position:relative;overflow:hidden;width:100%;height:100%}
    .vr-blink-a{display:block;width:100%;height:100%;object-fit:contain;background:#111}
    .vr-blink-b{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;transition:opacity 0s}
    .vr-blink-lbl{position:absolute;top:8px;left:10px;background:rgba(0,0,0,.72);color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;font-weight:700}
    .vr-blink-bar{display:flex;align-items:center;gap:10px;padding:6px 12px;background:#0d0d0d;border-top:1px solid #1e1e1e;flex-shrink:0}
    /* ── Diff panel ── */
    .diff-img{width:100%;height:100%;object-fit:contain;background:#111;display:block}
    .no-diff{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:14px}
    .no-diff svg{opacity:.3}.no-diff span{font-size:13px;font-weight:600;color:#4caf50}
    .protect-box{padding:10px 12px;background:#0a1628;border-top:1px solid #1e293b;font-size:11px;flex-shrink:0}
  </style>
  </head><body>
  <div class="hdr">
    <h2>&#128247; Visual Diff</h2>
    <div class="meta">${escHtml(b.testName)} &middot; ${escHtml(b.locatorName)}${diffPctStr ? ' &middot; ' + diffPctStr : ''}</div>
    ${hasDiff ? '<span class="badge badge-diff">&#9889; Diff Detected</span>' : '<span class="badge badge-ok">&#10003; Pixel-Identical</span>'}
  </div>
  <div class="layout">
    <!-- Left: multi-mode viewer -->
    <div class="left-panel">
      <div class="vr-mb-bar">
        <button class="vr-mb on" data-mode="slider">&#8660; Slider</button>
        <button class="vr-mb" data-mode="onion">&#128065; Onion</button>
        <button class="vr-mb" data-mode="blink">&#128161; Blink</button>
      </div>
      <!-- Slider mode -->
      <div class="vr-m vr-m-slider" style="display:flex;flex-direction:column;flex:1;min-height:0">
        <div class="panel-body">
          <div class="vr-sl" id="vr-sl">
            <img class="vr-sl-a" src="${actualUrl}"  alt="Actual"   onerror="this.style.opacity='.2'">
            <img class="vr-sl-b" src="${baseUrl}"    alt="Baseline" onerror="this.style.opacity='.2'">
            <div class="vr-sl-d" id="vr-sl-d"></div>
            <div class="vr-sl-k" id="vr-sl-k">&#8660;</div>
            <div class="vr-sl-t" id="vr-sl-t"></div>
          </div>
        </div>
        ${hasDiff ? '<div class="vr-ht-bar"><canvas id="vr-ht-c" height="4" style="display:block;width:100%;height:4px"></canvas><div id="vr-ht-n" style="position:absolute;top:0;bottom:0;width:2px;background:#fff;opacity:.5;transform:translateX(-50%);left:50%;pointer-events:none"></div></div>' : ''}
      </div>
      <!-- Onion mode -->
      <div class="vr-m vr-m-onion" style="display:none;flex-direction:column;flex:1;min-height:0">
        <div class="panel-body">
          <div class="vr-onion">
            <img class="vr-onion-a"  src="${actualUrl}"  alt="Actual">
            <img class="vr-onion-bl" src="${baseUrl}"    alt="Baseline">
          </div>
        </div>
        <div class="vr-onion-bar">
          <span style="font-size:11px;color:#555;white-space:nowrap">Baseline opacity</span>
          <input type="range" id="vr-onion-r" min="0" max="100" value="50" style="flex:1;accent-color:#059669;height:3px;cursor:pointer">
          <span id="vr-onion-p" style="font-size:11px;color:#6ee7b7;font-weight:700;min-width:32px;text-align:right">50%</span>
        </div>
      </div>
      <!-- Blink mode -->
      <div class="vr-m vr-m-blink" style="display:none;flex-direction:column;flex:1;min-height:0">
        <div class="panel-body">
          <div class="vr-blink-wrap">
            <img class="vr-blink-a" src="${actualUrl}"  alt="Actual">
            <img class="vr-blink-b" src="${baseUrl}"    alt="Baseline">
            <span class="vr-blink-lbl">Actual</span>
          </div>
        </div>
        <div class="vr-blink-bar">
          <button id="vr-blink-btn" style="padding:4px 14px;background:#d9770622;color:#fbbf24;border:1px solid #d9770644;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer">&#9654; Blink</button>
          <span style="font-size:11px;color:#444">Alternates baseline &harr; actual — eye catches the change</span>
        </div>
      </div>
    </div>
    <!-- Right: diff image -->
    <div class="right-panel">
      <div class="panel-hdr">&#9889; Diff ${diffPctStr ? '&mdash; ' + diffPctStr : '(red = changed pixels)'}</div>
      <div class="panel-body" style="display:flex;flex-direction:column">
        ${hasDiff
          ? `<img class="diff-img" src="${diffUrl}" alt="Diff">`
          : `<div class="no-diff"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#4caf50" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12l3 3 5-5"/></svg><span>No Differences</span></div>`}
        ${b.lastSavedPixels > 0 ? `<div class="protect-box">
          <div style="font-weight:700;color:#22c55e">&#128737; ${b.totalRunsProtected||1} false positive${(b.totalRunsProtected||1)>1?'s':''} prevented</div>
          <div style="color:#64748b;margin-top:2px">${b.lastSavedPixels.toLocaleString()} pixels neutralised</div>
        </div>` : ''}
      </div>
    </div>
  </div>
  <\x73cript>
  (function(){
    // ── Mode switching ──
    var mBtns   = document.querySelectorAll('.vr-mb');
    var mPanels = document.querySelectorAll('.vr-m');
    var blinkTimer = null;
    function applyMb(btn, on){ btn.classList.toggle('on', on); }
    function switchMode(m){
      if(blinkTimer && m!=='blink') stopBlink();
      mBtns.forEach(function(b){ applyMb(b, b.dataset.mode===m); });
      mPanels.forEach(function(p){ p.style.display = p.classList.contains('vr-m-'+m)?'flex':'none'; });
    }
    mBtns.forEach(function(b){ b.addEventListener('click', function(){ switchMode(b.dataset.mode); }); });

    // ── Slider ──
    var slFrame = document.getElementById('vr-sl');
    var slBase  = slFrame && slFrame.querySelector('.vr-sl-b');
    var slDiv   = document.getElementById('vr-sl-d');
    var slKnob  = document.getElementById('vr-sl-k');
    var slTip   = document.getElementById('vr-sl-t');
    var htNeedle= document.getElementById('vr-ht-n');
    var zones=[], dragging=false;

    function inDiff(p){ return zones.some(function(z){return p>=z.s&&p<=z.e;}); }
    function setSlPos(pct){
      pct=Math.max(0,Math.min(100,pct));
      if(slBase)  slBase.style.clipPath='inset(0 '+(100-pct)+'% 0 0)';
      if(slDiv)   slDiv.style.left=pct+'%';
      if(slKnob)  slKnob.style.left=pct+'%';
      if(htNeedle)htNeedle.style.left=pct+'%';
      var hot=inDiff(pct);
      if(slDiv){  slDiv.style.background=hot?'#ef4444':'rgba(255,255,255,.85)'; slDiv.style.boxShadow=hot?'0 0 12px 4px rgba(239,68,68,.65)':''; }
      if(slKnob){ slKnob.style.background=hot?'#ef4444':'#fff'; slKnob.style.color=hot?'#fff':'#333'; slKnob.textContent=hot?'\\u26a1':'\\u21d4'; }
      if(slTip){
        slTip.style.left=pct+'%';
        slTip.style.display=(dragging&&zones.length)?'block':'none';
        slTip.textContent=hot?'\\u26a1 Diff here!':'Baseline \\xb7 '+Math.round(pct)+'%';
        slTip.style.background=hot?'#dc2626':'#fff';
        slTip.style.borderColor=hot?'#ef4444':'#e2e8f0';
        slTip.style.color=hot?'#fff':'#111';
      }
    }
    function fromE(e){ var r=slFrame.getBoundingClientRect(),cx=e.touches?e.touches[0].clientX:e.clientX; return((cx-r.left)/r.width)*100; }
    function onMove(e){ if(dragging)setSlPos(fromE(e)); }
    function onUp(){ dragging=false; if(slTip)slTip.style.display='none'; document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
    if(slFrame){
      slFrame.addEventListener('mousedown',function(e){dragging=true;setSlPos(fromE(e));document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp);e.preventDefault();});
      slFrame.addEventListener('touchstart',function(e){dragging=true;setSlPos(fromE(e));e.preventDefault();},{passive:false});
      slFrame.addEventListener('touchmove',function(e){if(dragging)setSlPos(fromE(e));e.preventDefault();},{passive:false});
      slFrame.addEventListener('touchend',function(){dragging=false;if(slTip)slTip.style.display='none';});
    }
    setSlPos(50);

    // B+C hot-zone analysis
    if('${hasDiff ? diffUrl : ''}'){
      var di=new Image();
      di.onload=function(){
        try{
          var W=di.naturalWidth,H=di.naturalHeight; if(!W||!H)return;
          var cv=document.createElement('canvas'); cv.width=W; cv.height=H;
          var ctx=cv.getContext('2d'); ctx.drawImage(di,0,0);
          var px=ctx.getImageData(0,0,W,H).data, cols=new Float32Array(W);
          for(var y=0;y<H;y++) for(var x=0;x<W;x++){var i=(y*W+x)*4; if(px[i]>180&&px[i+1]<80&&px[i+2]<80)cols[x]++;}
          var THRESH=Math.max(1,H*0.005),found=[],inZ=false,zS=0;
          for(var x=0;x<W;x++){
            if(!inZ&&cols[x]>THRESH){inZ=true;zS=x;}
            if(inZ&&cols[x]<=THRESH){inZ=false;var pad=W*0.02;found.push({s:Math.max(0,(zS-pad)/W*100),e:Math.min(100,(x+pad)/W*100)});}
          }
          if(inZ)found.push({s:Math.max(0,(zS-W*0.02)/W*100),e:100});
          if(found.length){
            zones=found;
            var canvas=document.getElementById('vr-ht-c'); if(!canvas)return;
            canvas.width=Math.round((canvas.offsetWidth||600)*(window.devicePixelRatio||1));
            var ctx2=canvas.getContext('2d'),cw=canvas.width,maxV=0;
            for(var i=0;i<cols.length;i++)if(cols[i]>maxV)maxV=cols[i];
            for(var x=0;x<cw;x++){var v=maxV>0?cols[Math.floor((x/cw)*W)]/maxV:0;ctx2.fillStyle=v>0.01?'rgba(239,68,68,'+(0.25+v*0.75).toFixed(2)+')':'#0a0a0a';ctx2.fillRect(x,0,1,4);}
          }
        }catch(e){}
      };
      di.src='${hasDiff ? diffUrl : ''}';
    }

    // ── Onion ──
    var onionBl=document.querySelector('.vr-onion-bl');
    var onionR=document.getElementById('vr-onion-r');
    var onionP=document.getElementById('vr-onion-p');
    if(onionR) onionR.addEventListener('input',function(){ if(onionBl)onionBl.style.opacity=this.value/100; if(onionP)onionP.textContent=this.value+'%'; });

    // ── Blink ──
    var blinkBtn=document.getElementById('vr-blink-btn');
    var blinkA=document.querySelector('.vr-blink-a');
    var blinkB=document.querySelector('.vr-blink-b');
    var blinkLbl=document.querySelector('.vr-blink-lbl');
    var blinkState=false;
    function stopBlink(){
      if(!blinkTimer)return;
      clearInterval(blinkTimer); blinkTimer=null;
      if(blinkBtn){blinkBtn.textContent='\\u25b6 Blink';blinkBtn.style.background='#d9770622';blinkBtn.style.color='#fbbf24';}
      if(blinkA)blinkA.style.opacity='1';
      if(blinkB)blinkB.style.opacity='0';
      if(blinkLbl)blinkLbl.textContent='Actual';
      blinkState=false;
    }
    if(blinkBtn) blinkBtn.addEventListener('click',function(){
      if(blinkTimer){stopBlink();return;}
      blinkBtn.textContent='\\u23f9 Stop'; blinkBtn.style.background='#d97706'; blinkBtn.style.color='#fff';
      blinkTimer=setInterval(function(){
        blinkState=!blinkState;
        if(blinkA)blinkA.style.opacity=blinkState?'0':'1';
        if(blinkB)blinkB.style.opacity=blinkState?'1':'0';
        if(blinkLbl)blinkLbl.textContent=blinkState?'Baseline':'Actual';
      },400);
    });
  })();
  </\x73cript>
  </body></html>`);
  win.document.close();
}

// ── Ignore Region Editor ────────────────────────────────────────────────────

const VRT_IGNORE_CATEGORIES = [
  { value: 'dynamic-data',  label: 'Dynamic Data',  color: '#22c55e', desc: 'Live counters, metrics, prices' },
  { value: 'temporal',      label: 'Timestamp',     color: '#3b82f6', desc: 'Clock, "2 mins ago", dates' },
  { value: 'advertisement', label: 'Advertisement', color: '#eab308', desc: 'Rotating banners, promo slots' },
  { value: 'user-specific', label: 'User Content',  color: '#a855f7', desc: 'Avatars, user names, role badges' },
  { value: 'animated',      label: 'Animated',      color: '#f97316', desc: 'Spinners, carousels, transitions' },
  { value: 'third-party',   label: 'Third Party',   color: '#94a3b8', desc: 'Chat widgets, maps, social feeds' },
];

let _vrtIgnoreBaselineId  = null;
let _vrtIgnoreRegions     = [];
let _vrtIgnoreDraw        = null;
let _vrtIgnoreScale       = 1;
let _vrtIgnorePending     = null;
let _vrtIgnoreEditId      = null;   // regionId being edited (null = new)
let _vrtIgnoreSelCategory = 'dynamic-data'; // currently selected category value

function vrtEnsureIgnoreModal() {
  if (document.getElementById('vrt-ignore-modal')) return;
  // Build category picker rows with color dot + label (native <select> can't show colored dots)
  const catPickerOptions = VRT_IGNORE_CATEGORIES.map(c =>
    `<div class="vrt-cat-opt" data-value="${c.value}" onclick="vrtSelectCategory('${c.value}')"
       style="display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border-radius:5px;font-size:12px;color:#cbd5e1;">
      <span style="width:10px;height:10px;min-width:10px;border-radius:50%;background:${c.color};display:inline-block;"></span>
      <span style="font-weight:600;color:#e2e8f0;">${c.label}</span>
      <span style="color:#64748b;font-size:11px;">— ${c.desc}</span>
    </div>`
  ).join('');

  document.body.insertAdjacentHTML('beforeend', `
    <div id="vrt-ignore-modal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);flex-direction:column;">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:#1e293b;color:#fff;flex-shrink:0;">
        <div>
          <span style="font-weight:700;font-size:15px;">&#127919; Ignore Regions Editor</span>
          <span id="vrt-ignore-modal-subtitle" style="font-size:12px;color:#94a3b8;margin-left:12px;"></span>
        </div>
        <button onclick="vrtCloseIgnoreEditor()" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;">&#10005;</button>
      </div>
      <div style="display:flex;flex:1;overflow:hidden;gap:0;">
        <div style="flex:1;overflow:auto;padding:20px;display:flex;align-items:flex-start;justify-content:center;background:#0f172a;">
          <div style="position:relative;display:inline-block;user-select:none;" id="vrt-ignore-img-wrap">
            <img id="vrt-ignore-img" style="display:block;max-width:100%;border:1px solid #334155;" />
            <canvas id="vrt-ignore-canvas" style="position:absolute;top:0;left:0;cursor:crosshair;"></canvas>
            <div id="vrt-draw-hint" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,229,255,0.9);color:#0f172a;padding:10px 18px;border-radius:8px;font-size:13px;font-weight:700;pointer-events:none;opacity:0;transition:opacity 0.3s;white-space:nowrap;">
              &#8592; Draw a rectangle on the image
            </div>
          </div>
        </div>
        <div style="width:360px;min-width:360px;background:#1e293b;display:flex;flex-direction:column;border-left:1px solid #334155;">
          <div style="padding:10px 16px;border-bottom:1px solid #334155;display:flex;align-items:center;justify-content:space-between;">
            <span style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">Ignore Regions <span id="vrt-ignore-count" style="color:#64748b;font-weight:400;"></span></span>
            <button onclick="vrtPromptNewRegion()" style="padding:4px 10px;background:#4f46e5;color:#fff;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;">+ Add Region</button>
          </div>
          <div id="vrt-ignore-region-list" style="flex:1;overflow-y:auto;padding:8px 0;"></div>
          <div id="vrt-ignore-add-form" style="display:none;padding:14px 16px;border-top:1px solid #334155;background:#0f172a;">
            <div id="vrt-ignore-form-title" style="font-size:12px;font-weight:700;color:#94a3b8;margin-bottom:10px;text-transform:uppercase;">New Region</div>
            <input id="vrt-ignore-name" placeholder="Name (e.g. Live Clock)" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;margin-bottom:8px;" />
            <!-- Custom category picker with color dots -->
            <div style="position:relative;margin-bottom:8px;">
              <div id="vrt-cat-trigger" onclick="vrtToggleCatDropdown()"
                style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;cursor:pointer;">
                <span id="vrt-cat-dot" style="width:10px;height:10px;min-width:10px;border-radius:50%;background:#22c55e;display:inline-block;"></span>
                <span id="vrt-cat-label">Dynamic Data — Live counters, metrics, prices</span>
                <span style="margin-left:auto;color:#64748b;">&#9660;</span>
              </div>
              <div id="vrt-cat-dropdown" style="display:none;position:absolute;bottom:100%;left:0;right:0;background:#0f172a;border:1px solid #334155;border-radius:6px;z-index:100;padding:4px;max-height:220px;overflow-y:auto;">
                ${catPickerOptions}
              </div>
            </div>
            <input id="vrt-ignore-selector" placeholder="CSS selector (optional, e.g. #live-clock)" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;margin-bottom:8px;" />
            <input id="vrt-ignore-reason" placeholder="Reason (optional)" style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#fff;font-size:13px;margin-bottom:10px;" />
            <div style="display:flex;gap:8px;">
              <button id="vrt-ignore-save-btn" onclick="vrtSaveIgnoreRegion()" style="flex:1;padding:8px;background:#4f46e5;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Save Region</button>
              <button onclick="vrtCancelIgnoreDraw()" style="padding:8px 12px;background:#334155;color:#94a3b8;border:none;border-radius:6px;font-size:13px;cursor:pointer;">Cancel</button>
            </div>
          </div>
          <div id="vrt-ignore-savings" style="padding:12px 16px;border-top:1px solid #334155;font-size:11px;color:#64748b;display:none;">
            <span id="vrt-ignore-savings-text"></span>
          </div>
        </div>
      </div>
    </div>
  `);
}

async function vrtOpenIgnoreEditor(baselineId) {
  vrtEnsureIgnoreModal();
  _vrtIgnoreBaselineId = baselineId;
  const [regions] = await Promise.all([
    fetch(`/api/visual-baselines/${encodeURIComponent(baselineId)}/ignore-regions`).then(r => r.json()),
  ]);
  _vrtIgnoreRegions = regions;
  const entry = _vrBaselines.find(b => b.id === baselineId);
  document.getElementById('vrt-ignore-modal-subtitle').textContent =
    entry ? `${entry.testName} · ${entry.locatorName}` : baselineId;
  document.getElementById('vrt-ignore-modal').style.display = 'flex';
  document.getElementById('vrt-ignore-add-form').style.display = 'none';
  const img = document.getElementById('vrt-ignore-img');
  img.onload = () => vrtIgnoreInitCanvas(img);
  img.src = `/api/visual-baselines/${encodeURIComponent(baselineId)}/image?type=baseline&_=${Date.now()}`;
  vrtRenderIgnoreRegionList();
  vrtUpdateIgnoreSavings(entry);
}

function vrtIgnoreInitCanvas(img) {
  const canvas = document.getElementById('vrt-ignore-canvas');
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.style.width  = img.offsetWidth  + 'px';
  canvas.style.height = img.offsetHeight + 'px';
  _vrtIgnoreScale = img.naturalWidth / img.offsetWidth;
  const wrap = document.getElementById('vrt-ignore-img-wrap');
  wrap.style.width  = img.offsetWidth  + 'px';
  wrap.style.height = img.offsetHeight + 'px';
  canvas.onmousedown = vrtIgnoreMouseDown;
  canvas.onmousemove = vrtIgnoreMouseMove;
  canvas.onmouseup   = vrtIgnoreMouseUp;
  vrtIgnoreRedrawCanvas();
}

function vrtIgnoreCanvasPos(e) {
  const canvas = document.getElementById('vrt-ignore-canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.round((e.clientX - rect.left) * _vrtIgnoreScale),
    y: Math.round((e.clientY - rect.top)  * _vrtIgnoreScale),
  };
}

function vrtIgnoreMouseDown(e) {
  const pos = vrtIgnoreCanvasPos(e);
  _vrtIgnoreDraw = { startX: pos.x, startY: pos.y, currentX: pos.x, currentY: pos.y };
}

function vrtIgnoreMouseMove(e) {
  if (!_vrtIgnoreDraw) return;
  const pos = vrtIgnoreCanvasPos(e);
  _vrtIgnoreDraw.currentX = pos.x;
  _vrtIgnoreDraw.currentY = pos.y;
  vrtIgnoreRedrawCanvas();
}

function vrtIgnoreMouseUp(e) {
  if (!_vrtIgnoreDraw) return;
  const pos = vrtIgnoreCanvasPos(e);
  const x = Math.min(_vrtIgnoreDraw.startX, pos.x);
  const y = Math.min(_vrtIgnoreDraw.startY, pos.y);
  const w = Math.abs(pos.x - _vrtIgnoreDraw.startX);
  const h = Math.abs(pos.y - _vrtIgnoreDraw.startY);
  _vrtIgnoreDraw = null;
  if (w < 10 || h < 10) { vrtIgnoreRedrawCanvas(); return; }
  _vrtIgnorePending = { x, y, width: w, height: h };
  _vrtIgnoreEditId  = null;
  document.getElementById('vrt-ignore-form-title').textContent = 'New Region';
  document.getElementById('vrt-ignore-save-btn').textContent   = 'Save Region';
  document.getElementById('vrt-ignore-add-form').style.display = 'block';
  document.getElementById('vrt-ignore-name').focus();
  vrtIgnoreRedrawCanvas();
}

function vrtIgnoreRedrawCanvas() {
  const canvas = document.getElementById('vrt-ignore-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const region of _vrtIgnoreRegions) {
    const cat   = VRT_IGNORE_CATEGORIES.find(c => c.value === region.category);
    const color = cat ? cat.color : '#94a3b8';
    vrtIgnoreDrawRegionOnCanvas(ctx, region.x, region.y, region.width, region.height, color, region.name);
  }
  if (_vrtIgnorePending) {
    vrtIgnoreDrawRegionOnCanvas(ctx, _vrtIgnorePending.x, _vrtIgnorePending.y, _vrtIgnorePending.width, _vrtIgnorePending.height, '#ffffff', '...');
  }
  if (_vrtIgnoreDraw) {
    const x = Math.min(_vrtIgnoreDraw.startX, _vrtIgnoreDraw.currentX);
    const y = Math.min(_vrtIgnoreDraw.startY, _vrtIgnoreDraw.currentY);
    const w = Math.abs(_vrtIgnoreDraw.currentX - _vrtIgnoreDraw.startX);
    const h = Math.abs(_vrtIgnoreDraw.currentY - _vrtIgnoreDraw.startY);
    ctx.save();
    // Bright cyan outline — highly visible on both light and dark backgrounds
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 4]);
    ctx.strokeRect(x, y, w, h);
    // Semi-transparent cyan fill so user can see what's being selected
    ctx.fillStyle = 'rgba(0, 229, 255, 0.12)';
    ctx.fillRect(x, y, w, h);
    // Corner size indicator
    if (w > 40 && h > 20) {
      ctx.setLineDash([]);
      ctx.font = 'bold 11px system-ui';
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(`${Math.round(w)}×${Math.round(h)}`, x + 4, y + h - 4);
    }
    ctx.restore();
  }
}

function vrtIgnoreDrawRegionOnCanvas(ctx, x, y, w, h, color, label) {
  ctx.save();
  const HATCH_STEP = 10;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  for (let i = -h; i < w + h; i += HATCH_STEP) {
    ctx.beginPath();
    ctx.moveTo(x + i, y);
    ctx.lineTo(x + i + h, y + h);
    ctx.stroke();
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.9;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
  if (label) {
    ctx.save();
    ctx.font = 'bold 11px system-ui';
    const textW = ctx.measureText(label).width;
    const pillW = textW + 10;
    const pillH = 18;
    const pillX = x + 4;
    const pillY = y + 4;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(pillX, pillY, pillW, pillH, 4);
    else ctx.rect(pillX, pillY, pillW, pillH);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.fillText(label, pillX + 5, pillY + 13);
    ctx.restore();
  }
}

// ── Category dropdown helpers ──────────────────────────────────────────────
function vrtToggleCatDropdown() {
  const dd = document.getElementById('vrt-cat-dropdown');
  if (dd) dd.style.display = dd.style.display === 'none' ? 'block' : 'none';
}

function vrtSelectCategory(value) {
  _vrtIgnoreSelCategory = value;
  const cat = VRT_IGNORE_CATEGORIES.find(c => c.value === value);
  if (!cat) return;
  const dot   = document.getElementById('vrt-cat-dot');
  const label = document.getElementById('vrt-cat-label');
  if (dot)   dot.style.background = cat.color;
  if (label) label.textContent = `${cat.label} — ${cat.desc}`;
  // Highlight selected row
  document.querySelectorAll('.vrt-cat-opt').forEach(el => {
    el.style.background = el.dataset.value === value ? '#1e3a5f' : 'transparent';
  });
  const dd = document.getElementById('vrt-cat-dropdown');
  if (dd) dd.style.display = 'none';
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const trigger = document.getElementById('vrt-cat-trigger');
  const dd      = document.getElementById('vrt-cat-dropdown');
  if (dd && trigger && !trigger.contains(e.target) && !dd.contains(e.target)) {
    dd.style.display = 'none';
  }
});

async function vrtSaveIgnoreRegion() {
  const name     = document.getElementById('vrt-ignore-name').value.trim();
  const category = _vrtIgnoreSelCategory;
  const selector = document.getElementById('vrt-ignore-selector').value.trim();
  const reason   = document.getElementById('vrt-ignore-reason').value.trim();
  if (!name) { alert('Please enter a name for this region.'); return; }

  const isEdit = !!_vrtIgnoreEditId;

  if (isEdit) {
    // PUT — update existing region (can edit any field including selector/reason)
    const res = await fetch(`/api/visual-baselines/${encodeURIComponent(_vrtIgnoreBaselineId)}/ignore-regions/${_vrtIgnoreEditId}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, ...(selector ? { selector } : {}), ...(reason ? { reason } : {}) }),
    });
    if (!res.ok) { alert('Failed to update region'); return; }
    const updated = await res.json();
    const idx = _vrtIgnoreRegions.findIndex(r => r.id === _vrtIgnoreEditId);
    if (idx >= 0) _vrtIgnoreRegions[idx] = updated;
    _vrtIgnoreEditId = null;
  } else {
    // POST — create new region
    if (!_vrtIgnorePending) return;
    const body = { name, category, ...(selector ? { selector } : {}), ...(reason ? { reason } : {}), ..._vrtIgnorePending };
    const res  = await fetch(`/api/visual-baselines/${encodeURIComponent(_vrtIgnoreBaselineId)}/ignore-regions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) { alert('Failed to save region'); return; }
    const saved = await res.json();
    _vrtIgnoreRegions.push(saved);
    _vrtIgnorePending = null;
  }

  document.getElementById('vrt-ignore-name').value     = '';
  document.getElementById('vrt-ignore-selector').value = '';
  document.getElementById('vrt-ignore-reason').value   = '';
  document.getElementById('vrt-ignore-add-form').style.display = 'none';
  vrtSelectCategory('dynamic-data');
  vrtRenderIgnoreRegionList();
  vrtIgnoreRedrawCanvas();
  vrLoad();
}

function vrtCancelIgnoreDraw() {
  _vrtIgnorePending = null;
  _vrtIgnoreEditId  = null;
  document.getElementById('vrt-ignore-add-form').style.display = 'none';
  vrtIgnoreRedrawCanvas();
}

function vrtPromptNewRegion() {
  // Close any open form, reset state, show instruction hint on canvas
  _vrtIgnorePending = null;
  _vrtIgnoreEditId  = null;
  document.getElementById('vrt-ignore-add-form').style.display = 'none';
  // Flash a hint overlay on the canvas area
  const hint = document.getElementById('vrt-draw-hint');
  if (hint) { hint.style.opacity = '1'; setTimeout(() => { hint.style.opacity = '0'; }, 2000); }
}

function vrtEditIgnoreRegion(regionId) {
  const region = _vrtIgnoreRegions.find(r => r.id === regionId);
  if (!region) return;
  _vrtIgnoreEditId  = regionId;
  _vrtIgnorePending = null; // not drawing a new rect — editing existing
  // Pre-fill form
  document.getElementById('vrt-ignore-name').value     = region.name;
  document.getElementById('vrt-ignore-selector').value = region.selector || '';
  document.getElementById('vrt-ignore-reason').value   = region.reason   || '';
  vrtSelectCategory(region.category);
  document.getElementById('vrt-ignore-form-title').textContent = 'Edit Region';
  document.getElementById('vrt-ignore-save-btn').textContent   = 'Update Region';
  document.getElementById('vrt-ignore-add-form').style.display = 'block';
  document.getElementById('vrt-ignore-name').focus();
}

function vrtCloseIgnoreEditor() {
  document.getElementById('vrt-ignore-modal').style.display = 'none';
  _vrtIgnoreBaselineId = null;
  _vrtIgnoreRegions    = [];
}

async function vrtDeleteIgnoreRegion(regionId) {
  if (!confirm('Delete this ignore region?')) return;
  await fetch(`/api/visual-baselines/${encodeURIComponent(_vrtIgnoreBaselineId)}/ignore-regions/${regionId}`, { method: 'DELETE' });
  _vrtIgnoreRegions = _vrtIgnoreRegions.filter(r => r.id !== regionId);
  vrtRenderIgnoreRegionList();
  vrtIgnoreRedrawCanvas();
  vrLoad();
}

function vrtRenderIgnoreRegionList() {
  const list  = document.getElementById('vrt-ignore-region-list');
  const count = document.getElementById('vrt-ignore-count');
  count.textContent = `(${_vrtIgnoreRegions.length})`;
  if (!_vrtIgnoreRegions.length) {
    list.innerHTML = `<div style="padding:24px 16px;text-align:center;color:#475569;font-size:13px;">
      No ignore regions defined.<br><span style="font-size:11px;color:#334155;">Draw a rectangle on the image to add one.</span>
    </div>`;
    return;
  }
  list.innerHTML = _vrtIgnoreRegions.map(r => {
    const cat   = VRT_IGNORE_CATEGORIES.find(c => c.value === r.category);
    const color = cat ? cat.color : '#94a3b8';
    const label = cat ? cat.label : r.category;
    return `<div style="padding:10px 14px;border-bottom:1px solid #1e293b;display:flex;align-items:flex-start;gap:10px;">
      <div style="width:12px;height:12px;min-width:12px;border-radius:2px;background:${color};margin-top:3px;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(r.name)}</div>
        <div style="font-size:11px;color:#64748b;margin-top:2px;">${label} · ${r.width}×${r.height}px @ (${r.x},${r.y})</div>
        ${r.selector ? `<div style="font-size:10px;color:#4f46e5;margin-top:2px;font-family:monospace;">${escHtml(r.selector)}</div>` : ''}
        ${r.reason   ? `<div style="font-size:10px;color:#475569;margin-top:2px;">${escHtml(r.reason)}</div>` : ''}
      </div>
      <button onclick="vrtEditIgnoreRegion('${r.id}')" style="background:none;border:none;color:#4f46e5;cursor:pointer;font-size:13px;padding:0 4px;" title="Edit">&#9998;</button>
      <button onclick="vrtDeleteIgnoreRegion('${r.id}')" style="background:none;border:none;color:#475569;cursor:pointer;font-size:14px;padding:0 4px;" title="Delete">&#128465;</button>
    </div>`;
  }).join('');
}

function vrtUpdateIgnoreSavings(entry) {
  const el = document.getElementById('vrt-ignore-savings');
  if (!el) return;
  if (entry && entry.ignoreRegions && entry.ignoreRegions.length > 0 && entry.diffPct != null) {
    el.style.display = 'block';
    document.getElementById('vrt-ignore-savings-text').textContent =
      `Last run: ${entry.diffPct}% diff detected. ${entry.ignoreRegions.length} region(s) active.`;
  } else {
    el.style.display = 'none';
  }
}

