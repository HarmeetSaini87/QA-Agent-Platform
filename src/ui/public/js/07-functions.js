
let allFunctions = [];
let editingFnId = null;
let _fnPage = 0;
const FN_PAGE_SIZE = 10;

async function fnLoad() {
  const url = currentProjectId
    ? `/api/functions?projectId=${encodeURIComponent(currentProjectId)}`
    : '/api/functions';
  const res = await fetch(url);
  allFunctions = await res.json();
  fnRender();
}

function fnRender() {
  const tbody = document.getElementById('fn-tbody');
  const pgEl = document.getElementById('fn-pagination');
  if (!tbody) return;
  const q = (document.getElementById('fn-search')?.value || '').toLowerCase();
  const filtered = allFunctions.filter(f =>
    !q || f.name.toLowerCase().includes(q) || (f.identifier || '').toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q)
  );
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:24px">
      ${allFunctions.length ? 'No functions match the search.' : 'No functions yet. Click <strong>+ New Function</strong> to create one.'}</td></tr>`;
    if (pgEl) pgEl.innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / FN_PAGE_SIZE));
  if (_fnPage >= totalPages) _fnPage = totalPages - 1;
  const page = filtered.slice(_fnPage * FN_PAGE_SIZE, (_fnPage + 1) * FN_PAGE_SIZE);
  tbody.innerHTML = page.map(f => `
    <tr>
      <td style="font-weight:600" title="${escHtml(f.name)}">${escHtml(f.name)}</td>
      <td><code style="background:var(--neutral-100);padding:2px 7px;border-radius:4px;font-size:12.5px">${escHtml(f.identifier || '—')}</code></td>
      <td title="${escHtml(f.description || '')}" style="color:var(--neutral-500);font-size:12.5px">${escHtml(f.description || '—')}</td>
      <td style="text-align:center">${f.steps.length}</td>
      <td>${escHtml(f.createdBy || '—')}</td>
      <td>${formatDate(f.createdAt)}</td>
      <td>
        ${isViewer() ? '' : `<button class="tbl-btn" onclick="fnEdit('${escHtml(f.id)}')">Edit</button>`}
        ${isViewer() ? '' : `<button class="tbl-btn del" onclick="fnDelete('${escHtml(f.id)}','${escHtml(f.name)}')">Delete</button>`}
      </td>
    </tr>`).join('');
  if (pgEl) {
    const start = filtered.length ? _fnPage * FN_PAGE_SIZE + 1 : 0;
    const end = Math.min((_fnPage + 1) * FN_PAGE_SIZE, filtered.length);
    pgEl.innerHTML = totalPages <= 1 ? '' : `
      <button class="tbl-btn" onclick="_fnPageGo(-1)" ${_fnPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span>Page ${_fnPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${filtered.length})</span>
      <button class="tbl-btn" onclick="_fnPageGo(1)" ${_fnPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`;
  }
}

function _fnPageGo(delta) { _fnPage += delta; fnRender(); }

async function fnOpenModal(id = null) {
  await keywordsLoad();
  editingFnId = id;
  modClearAlert('fn-modal-alert');
  document.getElementById('fn-modal-title').textContent = id ? 'Edit Function' : 'New Function';
  if (!id) {
    document.getElementById('fn-name').value = '';
    document.getElementById('fn-identifier').value = '';
    document.getElementById('fn-desc').value = '';
    document.getElementById('fn-steps-container').innerHTML = '';
    fnAddStep();
  }
  openModal('modal-function');
}

async function fnEdit(id) {
  await keywordsLoad();
  const fn = allFunctions.find(f => f.id === id);
  if (!fn) return;
  editingFnId = id;
  document.getElementById('fn-modal-title').textContent = 'Edit Function';
  document.getElementById('fn-name').value = fn.name;
  document.getElementById('fn-identifier').value = fn.identifier || '';
  document.getElementById('fn-desc').value = fn.description || '';
  const container = document.getElementById('fn-steps-container');
  container.innerHTML = '';
  (fn.steps || []).forEach(s => fnAddStep(s, true));
  fnReorderNums(); // one call after all steps inserted
  modClearAlert('fn-modal-alert');
  openModal('modal-function');
}

function fnAddStep(step = {}, _skipReorder = false) {
  const container = document.getElementById('fn-steps-container');
  const idx = container.querySelectorAll('.fn-step-card').length;

  const curKw = _seKwGet(step.keyword);
  const needsLoc = curKw ? curKw.needsLocator : true;
  const isAuto = curKw?.autoFromProject || false;
  const helpLbl = curKw?.helpLabel || '';
  const tipObj = curKw?.tooltip || null;
  const tipJson = (tipObj && (tipObj.what || tipObj.example || tipObj.tip)) ? JSON.stringify(tipObj) : '';

  const row = document.createElement('div');
  row.className = 'fn-step-card';
  row.innerHTML = `
    <div class="step-actions-top">
      <button type="button" class="step-action-btn step-del-icon" onclick="fnStepDelete(this)" title="Delete Step">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    </div>
    <div class="step-row-header">
      <span class="step-num">${idx + 1}</span>
      <select class="fm-select fn-step-kw-select" style="flex:1;font-size:12.5px" onchange="fnStepKwChange(this)">${_kwOptionsFnHtml}</select>
    </div>
    <div class="step-help-row"${helpLbl ? '' : ' style="display:none"'}>
      <span class="step-help-label">${escHtml(helpLbl)}</span>
      <span class="step-tooltip-trigger" data-tooltip-json="${escHtml(tipJson)}" onmouseenter="_kwTipShow(this)" onmouseleave="_kwTipHide()"${tipJson ? '' : ' style="display:none"'}>?</span>
    </div>
    <div class="fn-step-auto-badge"${isAuto ? '' : ' style="display:none"'}>
      <span class="auto-config-badge">&#x2699; Auto from Project Config — URL &amp; credentials fetched automatically</span>
    </div>
    <div class="step-row-fields">
      <div class="fn-step-locator"${needsLoc && !isAuto ? '' : ' style="display:none"'}>
        <div class="field" style="margin:0 0 6px 0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <label style="font-size:11px;margin:0">Locator Name</label>
            <span class="loc-repo-badge" style="display:none">From Repo</span>
            <button type="button" class="loc-unlock-btn" style="display:none" onclick="fnStepUnlockLoc(this)" title="Unlock to edit manually">&#x270E; Edit</button>
          </div>
          <div style="display:flex;gap:4px">
            <input class="fm-input fn-step-loc-name" style="flex:1;font-size:12px"
                   placeholder="e.g. LoginButton" value="${escHtml(step.locatorName ?? step.detail ?? '')}" />
            <button type="button" class="tbl-btn" style="padding:5px 8px;font-size:13px;flex-shrink:0"
                    onclick="fnStepPickLoc(this)" title="Pick from Locator Repo">&#x1F50D;</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:start">
          <div class="field" style="margin:0;flex-shrink:0;width:130px"><label style="font-size:11px">Locator Type</label>
            <select class="fm-select fn-step-loc-type" style="font-size:11.5px">${_locTypeOptsHtml}</select>
          </div>
          <div class="field" style="margin:0;flex:1"><label style="font-size:11px">Locator Value</label>
            <input class="fm-input fn-step-selector" style="font-size:12px;font-family:monospace"
                   placeholder="e.g. #btn-login" value="${escHtml(step.selector ?? '')}" />
          </div>
        </div>
      </div>
    </div>
    <div class="step-row-bottom">
      <input class="fm-input fn-step-desc" style="flex:1;font-size:12px" placeholder="Step description (optional)"
             value="${escHtml(step.description ?? step.detail ?? '')}" />
    </div>`;

  // Set keyword + locator type selections via JS
  row.querySelector('.fn-step-kw-select').value = step.keyword || '';
  row.querySelector('.fn-step-loc-type').value = step.locatorType || 'css';

  container.appendChild(row);
  fnStepKwChange(row.querySelector('.fn-step-kw-select'));
  if (!_skipReorder) fnReorderNums();
}

function fnStepKwChange(sel) {
  const row = sel.closest('.fn-step-card');
  const opt = sel.selectedOptions[0];
  const needsLoc = opt?.dataset.nl === 'true';
  const isAuto = opt?.dataset.auto === 'true';
  const helpText = opt?.dataset.help || '';
  const tipJson = opt?.dataset.tooltipJson || '';

  row.querySelector('.fn-step-locator').style.display = (needsLoc && !isAuto) ? '' : 'none';
  row.querySelector('.fn-step-auto-badge').style.display = isAuto ? '' : 'none';

  const helpRow = row.querySelector('.step-help-row');
  if (helpRow) {
    helpRow.style.display = helpText ? '' : 'none';
    const lbl = helpRow.querySelector('.step-help-label');
    if (lbl) lbl.textContent = helpText;
    const tip = helpRow.querySelector('.step-tooltip-trigger');
    if (tip) { tip.dataset.tooltipJson = tipJson; tip.style.display = tipJson ? '' : 'none'; }
  }

}

function fnStepPickLoc(btn) {
  const row = btn.closest('.fn-step-card');
  locatorPickerOpen((selector, selectorType, name) => {
    const nameInput = row.querySelector('.fn-step-loc-name');
    if (nameInput) nameInput.value = name || '';
    row.querySelector('.fn-step-selector').value = selector || '';
    const typeSelect = row.querySelector('.fn-step-loc-type');
    if (typeSelect && selectorType) typeSelect.value = selectorType;
    _fnStepLockLocator(row, true);
  });
}

function _fnStepLockLocator(row, locked) {
  const nameInput = row.querySelector('.fn-step-loc-name');
  const valInput = row.querySelector('.fn-step-selector');
  const typeSelect = row.querySelector('.fn-step-loc-type');
  const lockBadge = row.querySelector('.loc-repo-badge');
  const unlockBtn = row.querySelector('.loc-unlock-btn');
  if (nameInput) { nameInput.readOnly = locked; nameInput.classList.toggle('loc-locked', locked); }
  if (valInput) { valInput.readOnly = locked; valInput.classList.toggle('loc-locked', locked); }
  if (typeSelect) { typeSelect.disabled = locked; typeSelect.classList.toggle('loc-locked', locked); }
  if (lockBadge) lockBadge.style.display = locked ? '' : 'none';
  if (unlockBtn) unlockBtn.style.display = locked ? '' : 'none';
}

function fnStepUnlockLoc(btn) {
  const row = btn.closest('.fn-step-card');
  _fnStepLockLocator(row, false);
}

function fnStepDelete(btn) {
  btn.closest('.fn-step-card').remove();
  fnReorderNums();
}

function fnReorderNums() {
  document.querySelectorAll('#fn-steps-container .fn-step-card').forEach((row, i) => {
    const n = row.querySelector('.step-num');
    if (n) n.textContent = i + 1;
  });
}

async function fnSave() {
  modClearAlert('fn-modal-alert');
  const name = document.getElementById('fn-name').value.trim();
  const identifier = document.getElementById('fn-identifier').value.trim();
  if (!name) { modAlert('fn-modal-alert', 'error', 'Function name is required'); return; }
  if (!identifier) { modAlert('fn-modal-alert', 'error', 'Identifier is required'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) { modAlert('fn-modal-alert', 'error', 'Identifier must be alphanumeric and underscores only'); return; }

  const steps = [...document.querySelectorAll('#fn-steps-container .fn-step-card')].map((row, i) => {
    return {
      order: i + 1,
      keyword: row.querySelector('.fn-step-kw-select')?.value || '',
      locatorName: row.querySelector('.fn-step-loc-name')?.value?.trim() || null,
      locatorType: row.querySelector('.fn-step-loc-type')?.value || 'css',
      selector: row.querySelector('.fn-step-selector')?.value?.trim() || null,
      description: row.querySelector('.fn-step-desc')?.value?.trim() || '',
    };
  }).filter(s => s.keyword);

  if (!steps.length) { modAlert('fn-modal-alert', 'error', 'At least one step is required'); return; }

  const body = { name, identifier, description: document.getElementById('fn-desc').value.trim(), steps, projectId: currentProjectId || null };
  const method = editingFnId ? 'PUT' : 'POST';
  const url = editingFnId ? `/api/functions/${editingFnId}` : '/api/functions';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('fn-modal-alert', 'error', data.error || 'Error'); return; }

  // Close modal + refresh list immediately — don't wait for locator sync
  const stepsForSync = steps.map(s => ({
    locatorName: s.locatorName,
    locator: s.selector,
    locatorType: s.locatorType,
    description: s.description,
  }));
  _syncFailedLocators.clear();
  fnCloseModal();
  await fnLoad();

  // Background locator sync — surfaces failures as banner
  _syncLocatorsToRepo(stepsForSync).then(failed => {
    if (failed.length) {
      _syncFailedLocators = new Set(failed);
      _showSyncFailBanner(failed, 'function');
    }
  }).catch(() => { });
}

async function fnDelete(id, name) {
  if (!confirm(`Delete function "${name}"?`)) return;
  await fetch(`/api/functions/${id}`, { method: 'DELETE' });
  await fnLoad();
}

function fnCloseModal() { closeModal('modal-function'); editingFnId = null; }

