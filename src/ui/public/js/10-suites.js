// TEST SUITE MODULE
// ══════════════════════════════════════════════════════════════════════════════

let allSuites = [];
let editingSuiteId = null;
let currentSuiteId = null;

// ── Suite Hooks state ─────────────────────────────────────────────────────────
let _hookBefore = []; // [{ keyword, locator, value, description }]
let _hookAfter = [];
let _hookFastMode = []; // login steps for Fast Mode beforeAll

// Keywords allowed in hooks (excludes CALL FUNCTION, GOTO, SET VARIABLE, DATE TOKEN, CALL API, file keywords)
const HOOK_EXCLUDED_KW = new Set([
  'CALL FUNCTION', 'GOTO', 'SET VARIABLE', 'DATE TOKEN', 'CALL API',
  'ASSERT FILE DOWNLOADED', 'ASSERT DOWNLOAD COUNT', 'READ EXCEL VALUE',
  'ASSERT EXCEL ROW COUNT', 'READ PDF TEXT',
]);

function _hookKeywords() {
  const all = [];
  for (const cat of (scriptKeywords.categories || [])) {
    for (const kw of (cat.keywords || [])) {
      if (!HOOK_EXCLUDED_KW.has(kw.key)) all.push(kw);
    }
  }
  return all;
}

function fastModeToggle() {
  const on = document.getElementById('sm-fast-mode')?.checked;
  const body = document.getElementById('sm-fast-mode-body');
  if (body) body.style.display = on ? '' : 'none';
}

function _hookRender(which) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  const listId = which === 'fastmode' ? 'hook-fastmode-list' : `hook-${which}-list`;
  const emptyId = which === 'fastmode' ? 'hook-fastmode-empty' : `hook-${which}-empty`;
  const listEl = document.getElementById(listId);
  const emptyEl = document.getElementById(emptyId);
  if (!listEl) return;

  // Remove all step rows (keep the empty placeholder)
  listEl.querySelectorAll('.hook-step-row').forEach(el => el.remove());

  if (arr.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const kws = _hookKeywords();
  arr.forEach((step, idx) => {
    const kw = kws.find(k => k.key === step.keyword) || null;
    const needLoc = kw ? kw.needsLocator : true;
    const needVal = kw ? kw.needsValue : true;
    const valHint = kw ? (kw.valueHint || '') : '';

    const row = document.createElement('div');
    row.className = 'hook-step-row';
    row.dataset.which = which;
    row.dataset.idx = idx;
    row.innerHTML = `
      <div class="hook-step-num">${idx + 1}</div>
      <select class="hook-kw-sel fm-input" style="flex:0 0 160px;font-size:12px" onchange="_hookKwChange('${which}',${idx},this)">
        ${kws.map(k => `<option value="${escHtml(k.key)}"${k.key === step.keyword ? ' selected' : ''}>${escHtml(k.label)}</option>`).join('')}
      </select>
      <input class="hook-loc-inp fm-input" style="flex:1;font-size:12px;${needLoc ? '' : 'opacity:.4'}" placeholder="Locator / selector"
             value="${escHtml(step.locator || '')}" ${needLoc ? '' : 'disabled'}
             oninput="_hookFieldChange('${which}',${idx},'locator',this.value)" />
      <input class="hook-val-inp fm-input" style="flex:1;font-size:12px;${needVal ? '' : 'opacity:.4'}" placeholder="${escHtml(valHint || 'Value')}"
             value="${escHtml(step.value || '')}" ${needVal ? '' : 'disabled'}
             oninput="_hookFieldChange('${which}',${idx},'value',this.value)" />
      <input class="hook-desc-inp fm-input" style="flex:1;font-size:12px" placeholder="Description (optional)"
             value="${escHtml(step.description || '')}"
             oninput="_hookFieldChange('${which}',${idx},'description',this.value)" />
      <button class="tbl-btn del" title="Remove step" onclick="_hookRemoveStep('${which}',${idx})">✕</button>
    `;
    listEl.appendChild(row);
  });
}

function hookAddStep(which) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  const kws = _hookKeywords();
  const first = kws[0];
  arr.push({ keyword: first?.key || 'CLICK', locator: '', value: '', description: '' });
  _hookRender(which);
}

function _hookRemoveStep(which, idx) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  arr.splice(idx, 1);
  _hookRender(which);
}

function _hookFieldChange(which, idx, field, val) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  if (arr[idx]) arr[idx][field] = val;
}

function _hookKwChange(which, idx, sel) {
  const arr = which === 'before' ? _hookBefore : which === 'after' ? _hookAfter : _hookFastMode;
  if (arr[idx]) arr[idx].keyword = sel.value;
  _hookRender(which); // re-render to update locator/value enabled state
}

function _hookInit(beforeSteps, afterSteps, fastModeOn, fastSteps) {
  _hookBefore = (beforeSteps || []).map(s => ({ keyword: s.keyword || 'CLICK', locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  _hookAfter = (afterSteps || []).map(s => ({ keyword: s.keyword || 'CLICK', locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  _hookFastMode = (fastSteps || []).map(s => ({ keyword: s.keyword || 'FILL', locator: s.locator || '', value: s.value || '', description: s.description || '' }));
  const chk = document.getElementById('sm-fast-mode');
  const body = document.getElementById('sm-fast-mode-body');
  if (chk) chk.checked = !!fastModeOn;
  if (body) body.style.display = fastModeOn ? '' : 'none';
  _hookRender('before');
  _hookRender('after');
  _hookRender('fastmode');
}

// ── Overlay Handlers state ────────────────────────────────────────────────────
let _overlayHandlers = []; // [{ type, action, text }]

function overlayAddHandler() {
  _overlayHandlers.push({ type: 'any', action: 'accept', text: '' });
  _overlayRender();
}

function _overlayRemove(idx) {
  _overlayHandlers.splice(idx, 1);
  _overlayRender();
}

function _overlayChange(idx, field, val) {
  if (_overlayHandlers[idx]) _overlayHandlers[idx][field] = val;
  if (field === 'action') _overlayRender(); // re-render to show/hide text field
}

function _overlayRender() {
  const listEl = document.getElementById('overlay-handler-list');
  const emptyEl = document.getElementById('overlay-handler-empty');
  if (!listEl) return;
  listEl.querySelectorAll('.overlay-row').forEach(el => el.remove());

  if (_overlayHandlers.length === 0) {
    if (emptyEl) emptyEl.style.display = '';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  _overlayHandlers.forEach((h, idx) => {
    const showText = h.action === 'accept' && h.type === 'prompt';
    const row = document.createElement('div');
    row.className = 'overlay-row hook-step-row';
    row.innerHTML = `
      <div class="hook-step-num">${idx + 1}</div>
      <select class="fm-input" style="flex:0 0 110px;font-size:12px" onchange="_overlayChange(${idx},'type',this.value)">
        <option value="any"     ${h.type === 'any' ? 'selected' : ''}>Any dialog</option>
        <option value="alert"   ${h.type === 'alert' ? 'selected' : ''}>alert()</option>
        <option value="confirm" ${h.type === 'confirm' ? 'selected' : ''}>confirm()</option>
        <option value="prompt"  ${h.type === 'prompt' ? 'selected' : ''}>prompt()</option>
      </select>
      <span style="font-size:12px;color:var(--neutral-500);flex:0 0 auto">&#8594;</span>
      <select class="fm-input" style="flex:0 0 100px;font-size:12px" onchange="_overlayChange(${idx},'action',this.value)">
        <option value="accept"  ${h.action === 'accept' ? 'selected' : ''}>Accept</option>
        <option value="dismiss" ${h.action === 'dismiss' ? 'selected' : ''}>Dismiss</option>
      </select>
      <input class="fm-input" style="flex:1;font-size:12px;display:${showText ? 'block' : 'none'}" placeholder="Prompt text (optional)"
             value="${escHtml(h.text || '')}" oninput="_overlayChange(${idx},'text',this.value)" />
      <button class="tbl-btn del" onclick="_overlayRemove(${idx})" title="Remove">✕</button>
    `;
    listEl.appendChild(row);
  });
}

function _overlayInit(handlers) {
  _overlayHandlers = (handlers || []).map(h => ({ type: h.type || 'any', action: h.action || 'accept', text: h.text || '' }));
  _overlayRender();
}

async function suiteLoad() {
  const emptyEl = document.getElementById('suite-list-empty');
  const listEl = document.getElementById('suite-list');
  if (!currentProjectId) {
    if (emptyEl) emptyEl.style.display = '';
    if (listEl) listEl.innerHTML = '';
    allSuites = [];
    return;
  }
  const res = await fetch(`/api/suites?projectId=${encodeURIComponent(currentProjectId)}`);
  allSuites = await res.json();
  suiteRender();
  execLoad(); // keep execution tab suite dropdown in sync
}

function suiteRender() {
  const q = (document.getElementById('suite-filter')?.value ?? '').toLowerCase();
  const listEl = document.getElementById('suite-list');
  const emptyEl = document.getElementById('suite-list-empty');
  if (!listEl) return;
  const filtered = allSuites.filter(s => !q || s.name.toLowerCase().includes(q));
  if (!currentProjectId) { emptyEl.style.display = ''; listEl.innerHTML = ''; return; }
  emptyEl.style.display = 'none';
  if (!filtered.length) { listEl.innerHTML = '<div class="builder-hint">No suites match the filter.</div>'; return; }
  listEl.innerHTML = filtered.map(s => `
    <div class="suite-card">
      <div class="suite-card-header">
        <div style="flex:1">
          <div class="suite-name">${escHtml(s.name)}</div>
          ${s.description ? `<div style="font-size:12.5px;color:var(--neutral-500);margin-top:3px">${escHtml(s.description)}</div>` : ''}
          <div class="suite-meta">${(s.scriptIds || []).length} script${(s.scriptIds || []).length !== 1 ? 's' : ''} · By ${escHtml(s.createdBy || '—')} · ${formatDate(s.createdAt)}</div>
        </div>
        <div style="flex-shrink:0;display:flex;gap:6px;align-items:center">
          ${isViewer() ? '' : `<button class="tbl-btn" onclick="suiteEditById('${escHtml(s.id)}')">Edit</button>`}
          ${isViewer() ? '' : `<button class="tbl-btn del" onclick="suiteDelete('${escHtml(s.id)}','${escHtml(s.name)}')">Delete</button>`}
        </div>
      </div>
    </div>`).join('');
}

function _populateEnvDropdown(selectedEnvId = '') {
  const sel = document.getElementById('sm-env');
  if (!sel) return;
  const project = allProjects.find(p => p.id === currentProjectId);
  const envs = project?.environments || [];
  sel.innerHTML = '<option value="">— Use project default (first environment) —</option>';
  envs.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.id;
    opt.textContent = `${e.name} — ${e.url}`;
    if (e.id === selectedEnvId) opt.selected = true;
    sel.appendChild(opt);
  });
}

// ── Suite Modal — state ───────────────────────────────────────────────────────
let _smSelectedIds = [];   // ordered list of selected script ids (Zone B)
let _smCheckedIds = new Set(); // checkboxes ticked in Zone A (for bulk-add)
let _smPage = 1;
let _smPageSize = 10;
let _smSortCol = 'tcid';
let _smSortDir = 'asc';  // 'asc' | 'desc'
let _smFiltered = [];   // filtered+sorted slice of allScripts for Zone A

// ── Helpers ───────────────────────────────────────────────────────────────────
function _smTcId(s) { return s.tcId || s.id || ''; }

function _smApplyFilter() {
  const qTcid = (document.getElementById('sm-filter-tcid')?.value ?? '').toLowerCase().trim();
  const qTitle = (document.getElementById('sm-filter-title')?.value ?? '').toLowerCase().trim();
  const qComp = (document.getElementById('sm-filter-component')?.value ?? '').toLowerCase().trim();
  const qTag = (document.getElementById('sm-filter-tag')?.value ?? '').toLowerCase().trim();
  let list = allScripts.filter(s => {
    if (qTcid && !(_smTcId(s)).toLowerCase().includes(qTcid)) return false;
    if (qTitle && !(s.title || '').toLowerCase().includes(qTitle)) return false;
    if (qComp && !(s.component || '').toLowerCase().includes(qComp)) return false;
    if (qTag && !(s.tag || '').toLowerCase().includes(qTag)) return false;
    return true;
  });
  // Sort
  list.sort((a, b) => {
    let va, vb;
    if (_smSortCol === 'tcid') { va = _smTcId(a); vb = _smTcId(b); }
    else if (_smSortCol === 'title') { va = a.title || ''; vb = b.title || ''; }
    else if (_smSortCol === 'component') { va = a.component || ''; vb = b.component || ''; }
    else { va = _smTcId(a); vb = _smTcId(b); }
    const cmp = va.localeCompare(vb, undefined, { numeric: true });
    return _smSortDir === 'asc' ? cmp : -cmp;
  });
  _smFiltered = list;
  _smPage = 1;  // reset to first page on filter/sort change
}

function _smRenderSortIndicators() {
  ['tcid', 'title', 'component'].forEach(col => {
    const el = document.getElementById(`sm-sort-${col}`);
    if (!el) return;
    if (col === _smSortCol) el.textContent = _smSortDir === 'asc' ? '▲' : '▼';
    else el.textContent = '';
  });
}

function _smRenderZoneA() {
  const el = document.getElementById('sm-script-list');
  if (!el) return;

  const totalPages = Math.max(1, Math.ceil(_smFiltered.length / _smPageSize));
  if (_smPage > totalPages) _smPage = totalPages;
  const start = (_smPage - 1) * _smPageSize;
  const page = _smFiltered.slice(start, start + _smPageSize);

  // Count label
  const countEl = document.getElementById('sm-script-count');
  if (countEl) countEl.textContent = `${_smFiltered.length} script${_smFiltered.length !== 1 ? 's' : ''}`;

  // Pagination controls
  const prevBtn = document.getElementById('sm-prev-btn');
  const nextBtn = document.getElementById('sm-next-btn');
  const pageLabel = document.getElementById('sm-page-label');
  if (prevBtn) prevBtn.disabled = _smPage <= 1;
  if (nextBtn) nextBtn.disabled = _smPage >= totalPages;
  if (pageLabel) pageLabel.textContent = `Page ${_smPage} of ${totalPages}`;

  if (!page.length) {
    el.innerHTML = `<div style="padding:12px 10px;color:var(--neutral-400);font-size:13px;text-align:center">${allScripts.length ? 'No scripts match the search.' : 'No scripts in this project yet.'}</div>`;
    _smUpdateBulkBar();
    return;
  }

  const selectedSet = new Set(_smSelectedIds);
  // Remove checked ids that are no longer on the current page (page changed / filter changed)
  const pageIds = new Set(page.map(s => s.id));
  _smCheckedIds = new Set([..._smCheckedIds].filter(id => pageIds.has(id)));

  el.innerHTML = page.map(s => {
    const already = selectedSet.has(s.id);
    const checked = _smCheckedIds.has(s.id);
    return `<div style="display:grid;grid-template-columns:32px 110px 1fr 130px 110px;align-items:center;border-bottom:1px solid var(--neutral-100);${already ? 'opacity:.45;' : ''}"
                 onmouseover="this.style.background='var(--brand-light)'" onmouseout="this.style.background=''">
      <div style="padding:7px 8px;display:flex;align-items:center;justify-content:center">
        <input type="checkbox" class="sm-row-chk" data-id="${escHtml(s.id)}"
               ${checked ? 'checked' : ''} ${already ? 'disabled' : ''}
               onchange="smRowCheckChange(this)" />
      </div>
      <div style="padding:7px 10px;font-size:12px;color:var(--neutral-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(_smTcId(s))}</div>
      <div style="padding:7px 10px;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.title)}">${escHtml(s.title)}</div>
      <div style="padding:7px 10px;font-size:12px;color:var(--neutral-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.component || '—')}</div>
      <div style="padding:7px 10px;font-size:12px;color:var(--neutral-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(s.tag || '—')}</div>
    </div>`;
  }).join('');

  // Sync select-all checkbox state
  const allChk = document.getElementById('sm-chk-all');
  if (allChk) {
    const available = page.filter(s => !selectedSet.has(s.id));
    const checkedCount = available.filter(s => _smCheckedIds.has(s.id)).length;
    allChk.checked = available.length > 0 && checkedCount === available.length;
    allChk.indeterminate = checkedCount > 0 && checkedCount < available.length;
  }
  _smUpdateBulkBar();
}

let _smbCheckedIds = new Set(); // checkboxes ticked in Zone B (for bulk-remove)

function _smbUpdateBulkBar() {
  const bars = document.querySelectorAll('.smb-bulk-bar');
  const countEls = document.querySelectorAll('.smb-bulk-count');
  const n = _smbCheckedIds.size;
  bars.forEach(bar => {
    bar.style.display = n > 0 ? 'flex' : 'none';
  });
  countEls.forEach(el => {
    el.textContent = n > 0 ? `${n} selected` : '';
  });
}

function smbRowCheckChange(chk) {
  const id = chk.dataset.id;
  if (chk.checked) _smbCheckedIds.add(id);
  else _smbCheckedIds.delete(id);
  // Sync select-all checkbox
  const allChk = document.getElementById('smb-chk-all');
  if (allChk) {
    const displayList = _smGetZoneBDisplayList();
    const n = displayList.length;
    const checkedCount = displayList.filter(item => _smbCheckedIds.has(item.id)).length;
    allChk.checked = n > 0 && checkedCount === n;
    allChk.indeterminate = checkedCount > 0 && checkedCount < n;
  }
  _smbUpdateBulkBar();
}

function smbToggleSelectAll() {
  const allChk = document.getElementById('smb-chk-all');
  const displayList = _smGetZoneBDisplayList();
  if (allChk?.checked) {
    displayList.forEach(item => _smbCheckedIds.add(item.id));
  } else {
    displayList.forEach(item => _smbCheckedIds.delete(item.id));
  }
  document.querySelectorAll('#sm-selected-list .smb-row-chk').forEach(chk => {
    chk.checked = _smbCheckedIds.has(chk.dataset.id);
  });
  _smbUpdateBulkBar();
}

function smbRemoveSelected() {
  if (!_smbCheckedIds.size) return;
  _smSelectedIds = _smSelectedIds.filter(id => !_smbCheckedIds.has(id));
  _smbCheckedIds.clear();
  _smRenderZoneA();  // re-enable Add buttons for removed scripts
  _smRenderZoneB();
}

function smbDeselectAll() {
  _smbCheckedIds.clear();
  document.querySelectorAll('#sm-selected-list .smb-row-chk').forEach(chk => { chk.checked = false; });
  const allChk = document.getElementById('smb-chk-all');
  if (allChk) { allChk.checked = false; allChk.indeterminate = false; }
  _smbUpdateBulkBar();
}

function _smGetZoneBDisplayList() {
  const searchInput = document.getElementById('smb-search')?.value.toLowerCase() || '';
  const scriptMap = Object.fromEntries(allScripts.map(s => [s.id, s]));
  return _smSelectedIds.map((id, idx) => ({ id, idx, s: scriptMap[id] })).filter(item => {
    if (!item.s) return false;
    if (!searchInput) return true;
    return item.s.title.toLowerCase().includes(searchInput) || 
           (item.s.tcid || '').toLowerCase().includes(searchInput) ||
           (item.s.tags || '').toLowerCase().includes(searchInput) ||
           (item.s.component || '').toLowerCase().includes(searchInput);
  });
}

function _smRenderZoneB() {
  const el = document.getElementById('sm-selected-list');
  const empty = document.getElementById('sm-selected-empty');
  const countEl = document.getElementById('sm-selected-count');
  if (!el) return;
  if (countEl) countEl.textContent = _smSelectedIds.length ? `(${_smSelectedIds.length})` : '';

  if (!_smSelectedIds.length) {
    _smbCheckedIds.clear();
    _smbUpdateBulkBar();
    if (empty) empty.style.display = '';
    [...el.children].forEach(c => { if (c.id !== 'sm-selected-empty') c.remove(); });
    return;
  }
  if (empty) empty.style.display = 'none';

  const displayList = _smGetZoneBDisplayList();
  const n = displayList.length;
  const checkedCount = displayList.filter(item => _smbCheckedIds.has(item.id)).length;

  if (n === 0) {
    el.innerHTML = `<div style="padding:12px 10px;color:var(--neutral-400);font-size:12px;text-align:center">No selected scripts match your filter.</div>`;
    _smbUpdateBulkBar();
    return;
  }

  el.innerHTML =
    // Select-all header row
    `<div id="sm-selected-empty" style="display:none"></div>
     <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;background:var(--neutral-50);border-bottom:1px solid var(--neutral-200);border-radius:4px 4px 0 0">
       <input type="checkbox" id="smb-chk-all" title="Select / deselect all"
              ${checkedCount === n && n > 0 ? 'checked' : ''}
              onchange="smbToggleSelectAll()" />
       <span style="font-size:11.5px;color:var(--neutral-500);flex:1">Select all</span>
     </div>` +
    displayList.map(({ id, idx, s }) => {
      const isFirst = idx === 0;
      const isLast = idx === _smSelectedIds.length - 1;
      const isChecked = _smbCheckedIds.has(id);
      return `<div draggable="true" ondragstart="smDragStart(event, ${idx})" ondragover="smDragOver(event)" ondragleave="smDragLeave(event)" ondrop="smDrop(event, ${idx})" ondragend="smDragEnd(event)" style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid var(--neutral-100);${isChecked ? 'background:var(--red-50,#fff1f2);' : ''}">
        <span style="cursor:grab;color:var(--neutral-400);user-select:none;font-size:14px;line-height:1;margin-right:2px" title="Drag to reorder">⋮⋮</span>
        <input type="checkbox" class="smb-row-chk" data-id="${escHtml(id)}"
               ${isChecked ? 'checked' : ''} onchange="smbRowCheckChange(this)" />
        <span style="font-size:12px;color:var(--neutral-400);min-width:22px;text-align:right">${idx + 1}</span>
        <span style="font-size:12px;color:var(--neutral-500);min-width:76px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(_smTcId(s))}</span>
        <span style="flex:1;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(s.title)}">${escHtml(s.title)}</span>
        <button class="tbl-btn" title="Move up"   ${isFirst ? 'disabled' : ''} onclick="smMoveScript(${idx},-1)">↑</button>
        <button class="tbl-btn" title="Move down" ${isLast ? 'disabled' : ''} onclick="smMoveScript(${idx}, 1)">↓</button>
        <button class="tbl-btn del" title="Remove" onclick="smRemoveScript('${escHtml(id)}')">×</button>
      </div>`;
    }).join('');

  // Set indeterminate state if partially selected
  const allChk = document.getElementById('smb-chk-all');
  if (allChk) {
    allChk.checked = checkedCount === n && n > 0;
    allChk.indeterminate = checkedCount > 0 && checkedCount < n;
  }
  _smbUpdateBulkBar();
}

function smAddScript(id) {
  if (_smSelectedIds.includes(id)) return;
  _smSelectedIds.push(id);
  _smCheckedIds.delete(id);
  _smRenderZoneA();
  _smRenderZoneB();
}

function smRowCheckChange(chk) {
  const id = chk.dataset.id;
  if (chk.checked) _smCheckedIds.add(id);
  else _smCheckedIds.delete(id);
  _smUpdateBulkBar();
  // sync select-all checkbox
  const selectedSet = new Set(_smSelectedIds);
  const start = (_smPage - 1) * _smPageSize;
  const page = _smFiltered.slice(start, start + _smPageSize);
  const available = page.filter(s => !selectedSet.has(s.id));
  const checkedCount = available.filter(s => _smCheckedIds.has(s.id)).length;
  const allChk = document.getElementById('sm-chk-all');
  if (allChk) {
    allChk.checked = available.length > 0 && checkedCount === available.length;
    allChk.indeterminate = checkedCount > 0 && checkedCount < available.length;
  }
}

function smToggleSelectAll() {
  const allChk = document.getElementById('sm-chk-all');
  const selectedSet = new Set(_smSelectedIds);
  const start = (_smPage - 1) * _smPageSize;
  const page = _smFiltered.slice(start, start + _smPageSize);
  const available = page.filter(s => !selectedSet.has(s.id));
  if (allChk?.checked) {
    available.forEach(s => _smCheckedIds.add(s.id));
  } else {
    available.forEach(s => _smCheckedIds.delete(s.id));
  }
  // Re-render checkboxes without rebuilding the full table
  document.querySelectorAll('#sm-script-list .sm-row-chk').forEach(chk => {
    const id = chk.dataset.id;
    if (!chk.disabled) chk.checked = _smCheckedIds.has(id);
  });
  _smUpdateBulkBar();
}

function smAddSelected() {
  const toAdd = [..._smCheckedIds].filter(id => !_smSelectedIds.includes(id));
  toAdd.forEach(id => _smSelectedIds.push(id));
  _smCheckedIds.clear();
  _smRenderZoneA();
  _smRenderZoneB();
}

function smDeselectAll() {
  _smCheckedIds.clear();
  document.querySelectorAll('#sm-script-list .sm-row-chk').forEach(chk => { if (!chk.disabled) chk.checked = false; });
  const allChk = document.getElementById('sm-chk-all');
  if (allChk) { allChk.checked = false; allChk.indeterminate = false; }
  _smUpdateBulkBar();
}

function _smUpdateBulkBar() {
  const bars = document.querySelectorAll('.sm-bulk-bar');
  const countEls = document.querySelectorAll('.sm-bulk-count');
  const n = _smCheckedIds.size;
  bars.forEach(bar => {
    bar.style.display = n > 0 ? 'flex' : 'none';
  });
  countEls.forEach(el => {
    el.textContent = n > 0 ? `${n} script${n !== 1 ? 's' : ''} selected` : '';
  });
}

function smRemoveScript(id) {
  _smSelectedIds = _smSelectedIds.filter(x => x !== id);
  _smbCheckedIds.delete(id);
  _smRenderZoneA();
  _smRenderZoneB();
}

function smMoveScript(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= _smSelectedIds.length) return;
  const arr = [..._smSelectedIds];
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  _smSelectedIds = arr;
  _smRenderZoneB();
}

let _smDragSourceIds = [];

function smDragStart(e, idx) {
  const draggedId = _smSelectedIds[idx];
  if (_smbCheckedIds.has(draggedId)) {
    // Drag all checked items
    _smDragSourceIds = _smSelectedIds.filter(id => _smbCheckedIds.has(id));
  } else {
    // Drag only this item
    _smDragSourceIds = [draggedId];
  }
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => e.target.style.opacity = '0.4', 0);
}

function smDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.style.borderTop = '2px solid var(--brand-500)';
}

function smDragLeave(e) {
  e.currentTarget.style.borderTop = '';
}

function smDragEnd(e) {
  e.target.style.opacity = '1';
  _smDragSourceIds = [];
}

function smDrop(e, dropIdx) {
  e.preventDefault();
  e.currentTarget.style.borderTop = '';
  
  if (!_smDragSourceIds.length) return;
  const targetId = _smSelectedIds[dropIdx];
  if (_smDragSourceIds.includes(targetId)) return;
  
  let arr = [..._smSelectedIds];
  arr = arr.filter(id => !_smDragSourceIds.includes(id));
  
  const newTargetIdx = arr.indexOf(targetId);
  arr.splice(newTargetIdx, 0, ..._smDragSourceIds);
  
  _smSelectedIds = arr;
  _smDragSourceIds = [];
  _smRenderZoneB();
}

function smSort(col) {
  if (_smSortCol === col) _smSortDir = _smSortDir === 'asc' ? 'desc' : 'asc';
  else { _smSortCol = col; _smSortDir = 'asc'; }
  _smApplyFilter();
  _smRenderSortIndicators();
  _smRenderZoneA();
}

function smScriptSearch() {
  _smApplyFilter();
  _smRenderZoneA();
}

function smPagePrev() { if (_smPage > 1) { _smPage--; _smRenderZoneA(); } }
function smPageNext() {
  const totalPages = Math.max(1, Math.ceil(_smFiltered.length / _smPageSize));
  if (_smPage < totalPages) { _smPage++; _smRenderZoneA(); }
}
function smPageSizeChange() {
  const sel = document.getElementById('sm-page-size');
  _smPageSize = parseInt(sel?.value || '10', 10);
  _smPage = 1;
  _smRenderZoneA();
}

// ── Open / Edit modal ─────────────────────────────────────────────────────────
function smClearFilters() {
  ['sm-filter-tcid', 'sm-filter-title', 'sm-filter-component', 'sm-filter-tag'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  smScriptSearch();
}

function _smInit(selectedIds) {
  _smSelectedIds = [...selectedIds];
  _smCheckedIds = new Set();
  _smbCheckedIds = new Set();
  _smPage = 1;
  _smPageSize = 10;
  _smSortCol = 'tcid';
  _smSortDir = 'asc';
  ['sm-filter-tcid', 'sm-filter-title', 'sm-filter-component', 'sm-filter-tag'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const pageSizeSel = document.getElementById('sm-page-size');
  if (pageSizeSel) pageSizeSel.value = '10';
  _smApplyFilter();
  _smRenderSortIndicators();
  _smRenderZoneA();
  _smRenderZoneB();
}

function suiteOpenModal(id = null) {
  editingSuiteId = id;
  currentSuiteId = null;
  modClearAlert('suite-modal-alert');
  document.getElementById('suite-modal-title').textContent = id ? 'Edit Test Suite' : 'New Test Suite';
  if (!id) {
    document.getElementById('sm-name').value = '';
    document.getElementById('sm-desc').value = '';
    document.getElementById('sm-retries').value = '0';
    // Hide schedules for new suites (no ID yet)
    const schedWrap = document.getElementById('sm-sched-wrap');
    if (schedWrap) schedWrap.style.display = 'none';
    _hookInit([], [], false, []);
    _overlayInit([]);
    // Reset preset to Custom and populate Intelligence tab defaults
    const presetEl = document.getElementById('flaky-preset');
    if (presetEl) presetEl.value = '';
    flakyApplyPreset();
  }
  _smInit(id ? (allSuites.find(x => x.id === id)?.scriptIds || []) : []);
  openModal('modal-suite');
}

async function suiteEditById(id) {
  const s = allSuites.find(x => x.id === id);
  if (!s) return;
  editingSuiteId = id;
  currentSuiteId = id;
  document.getElementById('suite-modal-title').textContent = 'Edit Test Suite';
  document.getElementById('sm-name').value = s.name;
  document.getElementById('sm-desc').value = s.description || '';
  document.getElementById('sm-retries').value = String(s.retries ?? 0);
  modClearAlert('suite-modal-alert');
  _smInit(s.scriptIds || []);
  _hookInit(s.beforeEachSteps || [], s.afterEachSteps || [], s.fastMode || false, s.fastModeSteps || []);
  _overlayInit(s.overlayHandlers || []);

  // Show and load schedules section (edit only)
  const schedWrap = document.getElementById('sm-sched-wrap');
  if (schedWrap) {
    schedWrap.style.display = '';
    // Populate sched-env from project environments
    const project = allProjects.find(p => p.id === currentProjectId);
    const schedEnvSel = document.getElementById('sched-env');
    if (schedEnvSel && project) {
      const envs = project.environments || [];
      schedEnvSel.innerHTML = '<option value="">— Select —</option>' +
        envs.map(e => `<option value="${escHtml(e.id)}"${e.id === s.environmentId ? ' selected' : ''}>${escHtml(e.name)}</option>`).join('');
    }
    schedFormHide();
    await schedLoad();
  }

  flakyConfigLoad(id, currentProjectId);
  openModal('modal-suite');
}

// Legacy alias kept so any other callers still work
// ── Suite Modal Tabs ──────────────────────────────────────────────────────────

function suiteTab(paneId, btn) {
  const modal = document.getElementById('modal-suite');
  if (!modal) return;
  modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  modal.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  const pane = document.getElementById(`sm-pane-${paneId}`);
  if (pane) pane.classList.add('active');
}

async function suiteSave() {
  modClearAlert('suite-modal-alert');
  const name = document.getElementById('sm-name').value.trim();
  if (!name) { modAlert('suite-modal-alert', 'error', 'Suite name is required'); return; }
  if (!currentProjectId) { modAlert('suite-modal-alert', 'error', 'Select a project first'); return; }
  const scriptIds = [..._smSelectedIds];   // Zone B order is authoritative
  const retries = parseInt(document.getElementById('sm-retries')?.value || '0', 10);

  const body = {
    projectId: currentProjectId, name,
    description: document.getElementById('sm-desc').value.trim(),
    scriptIds,
    retries: [0, 1, 2].includes(retries) ? retries : 0,
    beforeEachSteps: _hookBefore.map((s, i) => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    afterEachSteps: _hookAfter.map((s, i) => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    fastMode: !!(document.getElementById('sm-fast-mode')?.checked),
    fastModeSteps: _hookFastMode.map((s, i) => ({ order: i + 1, keyword: s.keyword, locator: s.locator, value: s.value, description: s.description })),
    overlayHandlers: _overlayHandlers.map(h => ({ type: h.type, action: h.action, text: h.text || '' })),
    // Unified Save: Include flakiness intelligence
    flakinessOverrides: {
      threshold: parseInt(document.getElementById('flaky-cfg-threshold').value) || 30,
      minRuns: parseInt(document.getElementById('flaky-cfg-minruns').value) || 5,
      quarantineBudget: parseInt(document.getElementById('flaky-cfg-budget').value) || 5,
      autoPromotePassRate: parseInt(document.getElementById('flaky-cfg-passrate').value) || 95
    }
  };
  const method = editingSuiteId ? 'PUT' : 'POST';
  const url = editingSuiteId ? `/api/suites/${editingSuiteId}` : '/api/suites';

  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error saving suite');

    // Unified Save: Sync local schedules if in edit mode
    if (editingSuiteId && typeof smLocalSchedules !== 'undefined' && smLocalSchedules.length > 0) {
      await _syncLocalSchedules(editingSuiteId);
    }

    suiteCloseModal();
    await suiteLoad();
  } catch (err) {
    modAlert('suite-modal-alert', 'error', 'Save failed: ' + err.message);
  }
}

/** Local schedule management for unified save */
let smLocalSchedules = [];
function schedSaveLocal() {
  const label = document.getElementById('sched-label').value.trim();
  const envId = document.getElementById('sched-env').value;
  const cron = document.getElementById('sched-cron').value.trim() || document.getElementById('sched-preset').value;
  if (!label || !envId || !cron) return modAlert('suite-modal-alert', 'error', 'All schedule fields required');
  smLocalSchedules.push({ label, environmentId: envId, cronExpression: cron });
  _renderLocalSchedules();
  schedFormHide();
}

async function _syncLocalSchedules(suiteId) {
  for (const s of smLocalSchedules) {
    await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...s, suiteId, projectId: currentProjectId, enabled: true })
    });
  }
  smLocalSchedules = [];
}

async function suiteDelete(id, name) {
  if (!confirm(`Delete suite "${name}"?`)) return;
  await fetch(`/api/suites/${id}`, { method: 'DELETE' });
  await suiteLoad();
}

function suiteCloseModal() { closeModal('modal-suite'); editingSuiteId = null; currentSuiteId = null; }

// suiteOpenDetail removed — suite detail overlay is no longer used.
// Schedules are now loaded inside the Edit Suite modal via _schedLoadForModal().

