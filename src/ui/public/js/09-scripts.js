
let scriptKeywords = { categories: [], dynamicTokens: [] };

// ── Keyword option HTML caches — built once after keywordsLoad(), reused per step ──
let _kwOptionsScriptHtml = '';  // script steps: all kws except GOTO
let _kwOptionsFnHtml = '';  // fn steps: all kws except GOTO + CALL FUNCTION
let _locTypeOptsHtml = '';  // locator type options (same for both)

// Locators that failed to sync on last save — shown as step-level badges on re-open
let _syncFailedLocators = new Set();

function _buildKwCaches() {
  if (_kwOptionsScriptHtml) return; // already built
  _kwOptionsScriptHtml = scriptKeywords.categories.map(cat => {
    const opts = cat.keywords
      .filter(kw => kw.key !== 'GOTO')
      .map(kw =>
        `<option value="${escHtml(kw.key)}"` +
        ` data-nl="${kw.needsLocator}" data-nv="${kw.needsValue}" data-hint="${escHtml(kw.valueHint || '')}"` +
        ` data-help="${escHtml(kw.helpLabel || '')}" data-tooltip-json="${escHtml(JSON.stringify(kw.tooltip || {}))}"` +
        ` data-auto="${kw.autoFromProject ? 'true' : 'false'}"` +
        `>${escHtml(kw.label)}</option>`
      ).join('');
    return opts ? `<optgroup label="${escHtml(cat.name)}">${opts}</optgroup>` : '';
  }).join('');

  _kwOptionsFnHtml = scriptKeywords.categories.map(cat => {
    const opts = cat.keywords
      .filter(kw => kw.key !== 'GOTO' && kw.key !== 'CALL FUNCTION')
      .map(kw =>
        `<option value="${escHtml(kw.key)}"` +
        ` data-nl="${kw.needsLocator}" data-nv="${kw.needsValue}" data-hint="${escHtml(kw.valueHint || '')}"` +
        ` data-help="${escHtml(kw.helpLabel || '')}" data-tooltip-json="${escHtml(JSON.stringify(kw.tooltip || {}))}"` +
        ` data-auto="false"` +
        `>${escHtml(kw.label)}</option>`
      ).join('');
    return opts ? `<optgroup label="${escHtml(cat.name)}">${opts}</optgroup>` : '';
  }).join('');

  _locTypeOptsHtml = (scriptKeywords.locatorTypes || []).map(lt =>
    `<option value="${escHtml(lt.value)}">${escHtml(lt.label)}</option>`
  ).join('');
}

async function keywordsLoad() {
  if (scriptKeywords.categories.length) return;
  try {
    const res = await fetch('/api/keywords/playwright');
    if (res.ok) {
      scriptKeywords = await res.json();
      _buildKwCaches();
    }
  } catch { /* non-fatal */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST SCRIPT BUILDER
// ══════════════════════════════════════════════════════════════════════════════

let allScripts = [];
let editingScriptId = null;
let _compDefs = [];   // ComponentDef[] for current project in modal
let _seCompDefs = [];   // ComponentDef[] for current project, used in script editor
let _scriptPage = 0;
let SCRIPT_PAGE_SIZE = 10;

async function scriptLoad() {
  const emptyEl = document.getElementById('script-list-empty');
  const listEl = document.getElementById('script-list');
  if (!currentProjectId) {
    if (emptyEl) emptyEl.style.display = '';
    if (listEl) listEl.innerHTML = '';
    allScripts = [];
    return;
  }
  const res = await fetch(`/api/scripts?projectId=${encodeURIComponent(currentProjectId)}`);
  allScripts = await res.json();
  scriptRender();
  await seLoadComponents();
}

function scriptRender() {
  const qTitle = (document.getElementById('script-filter-title')?.value ?? '').toLowerCase();
  const qTag = (document.getElementById('script-filter-tag')?.value ?? '').toLowerCase();
  const qComp = (document.getElementById('script-filter-comp')?.value ?? '').toLowerCase();
  const qSubcomp = (document.getElementById('script-filter-subcomp')?.value ?? '').toLowerCase();
  const listEl = document.getElementById('script-list');
  const emptyEl = document.getElementById('script-list-empty');
  if (!listEl) return;
  if (!currentProjectId) { emptyEl.style.display = ''; listEl.innerHTML = ''; return; }
  emptyEl.style.display = 'none';
  const filtered = allScripts.filter(s => {
    if (qTitle && !s.title.toLowerCase().includes(qTitle)) return false;
    if (qTag && !(s.tags || []).some(t => t.toLowerCase().includes(qTag))) return false;
    if (qComp && !(s.component || '').toLowerCase().includes(qComp)) return false;
    if (qSubcomp && !(s.subcomponent || '').toLowerCase().includes(qSubcomp)) return false;
    return true;
  });
  if (!filtered.length) {
    listEl.innerHTML = '<div class="builder-hint">No scripts match the filter.</div>';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(filtered.length / SCRIPT_PAGE_SIZE));
  if (_scriptPage >= totalPages) _scriptPage = totalPages - 1;
  const page = filtered.slice(_scriptPage * SCRIPT_PAGE_SIZE, (_scriptPage + 1) * SCRIPT_PAGE_SIZE);
  const start = filtered.length ? _scriptPage * SCRIPT_PAGE_SIZE + 1 : 0;
  const end = Math.min((_scriptPage + 1) * SCRIPT_PAGE_SIZE, filtered.length);
  const rppOpts = [10,25,50,100,200,500].map(n => `<option value="${n}"${SCRIPT_PAGE_SIZE===n?' selected':''}>${n}</option>`).join('');
  const pgHtml = `
    <div class="lt-pagination">
      <label style="font-size:12px;color:var(--neutral-500)">Rows per page:
        <select class="fm-input" style="padding:2px 6px;font-size:12px;width:auto" onchange="_scriptSetPageSize(+this.value)">${rppOpts}</select>
      </label>
      ${totalPages <= 1 ? `<span style="font-size:12px;color:var(--neutral-500)">${start}–${end} of ${filtered.length}</span>` : `
      <button class="tbl-btn" onclick="_scriptPageGo(-1)" ${_scriptPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span>Page ${_scriptPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${filtered.length})</span>
      <button class="tbl-btn" onclick="_scriptPageGo(1)" ${_scriptPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`}
    </div>`;
  listEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 2px 8px;flex-wrap:wrap">
      <label style="display:flex;align-items:center;gap:5px;font-size:12.5px;cursor:pointer">
        <input type="checkbox" id="script-select-all" onchange="scriptSelectAll(this)" /> Select All
      </label>
      <span id="script-sel-count" style="font-size:12px;color:var(--neutral-500);font-weight:600"></span>
      <!-- Bulk action bar — hidden until ≥1 selected -->
      <div id="script-bulk-bar" style="display:none;display:none;align-items:center;gap:6px;flex-wrap:wrap">
        <button class="tbl-btn" style="background:#3b82f6;color:#fff;border-color:#3b82f6" onclick="scriptBulkAddToSuite()">&#10133; Add to Suite</button>
        <button class="tbl-btn" onclick="scriptBulkSetPriority()">&#9881; Set Priority</button>
        <button class="tbl-btn" onclick="scriptBulkSetTag()">&#127991; Set Tag</button>
        <button class="tbl-btn del" onclick="scriptDeleteSelected()">&#128465; Delete</button>
      </div>
    </div>
    <div class="lt-wrap">
      <div class="lt-body-wrap">
        <table class="data-table lt-fixed">
          <thead><tr>
            <th style="min-width:32px;width:32px"></th>
            <th style="min-width:86px">TC ID</th>
            <th style="min-width:200px">Title</th>
            <th style="min-width:130px">Component</th>
            <th style="min-width:130px">Subcomponent</th>
            <th style="min-width:130px">Tag</th>
            <th style="min-width:90px">Priority</th>
            <th style="min-width:100px">Created By</th>
            <th style="min-width:100px">Date</th>
            <th style="min-width:120px">Actions</th>
          </tr></thead>
          <tbody>
          ${page.map(s => `
            <tr class="script-tbl-row" data-id="${escHtml(s.id)}">
              <td><input type="checkbox" class="script-row-chk" value="${escHtml(s.id)}" onchange="scriptSelectionChanged()" /></td>
              <td><span style="font-family:monospace;font-weight:600;color:var(--primary);font-size:12.5px">${escHtml(s.tcId || '—')}</span></td>
              <td title="${escHtml(s.title)}"><div style="font-weight:500">${escHtml(s.title)}</div></td>
              <td title="${escHtml(s.component || '')}">${escHtml(s.component || '—')}</td>
              <td title="${escHtml(s.subcomponent || '')}">${escHtml(s.subcomponent || '—')}</td>
              <td>${(s.tags || []).length ? (s.tags || []).map(t => `<span class="badge badge-tester">${escHtml(t)}</span>`).join(' ') : '—'}</td>
              <td><span class="badge badge-${escHtml(s.priority)}">${escHtml(s.priority)}</span></td>
              <td style="font-size:12px">${escHtml(s.createdBy || '—')}</td>
              <td style="font-size:12px">${formatDate(s.createdAt)}</td>
              <td>
                <div style="display:flex;gap:4px">
                  ${isViewer() ? '' : `<button class="tbl-btn" onclick="scriptOpenEditor('${escHtml(s.id)}')">Edit</button>`}
                  <button class="tbl-btn dbg" onclick="debugOpen('${escHtml(s.id)}')">&#128027;</button>
                  ${isViewer() ? '' : `<button class="tbl-btn" onclick="scriptClone('${escHtml(s.id)}')" title="Clone script"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button>`}
                  ${isViewer() ? '' : `<button class="tbl-btn del" onclick="scriptDelete('${escHtml(s.id)}','${escHtml(s.title)}')">Del</button>`}
                </div>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    ${pgHtml}`;
  // Re-apply debug badges after DOM is rebuilt
  _debugApplyBadges();
}

function _scriptSubcompFilter() {
  const compVal = (document.getElementById('script-filter-comp')?.value ?? '').trim().toLowerCase();
  const subSel = document.getElementById('script-filter-subcomp');
  if (!subSel) return;
  subSel.innerHTML = '<option value="">All Subcomponents</option>';
  if (!compVal) {
    subSel.disabled = true;
    return;
  }
  const matching = _seCompDefs.filter(c => c.name.toLowerCase().includes(compVal));
  const allSubs = [...new Set(matching.flatMap(c => c.subcomponents.map(s => s.name)))].sort();
  if (!allSubs.length) { subSel.disabled = true; return; }
  subSel.disabled = false;
  allSubs.forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    subSel.appendChild(opt);
  });
}

function _scriptPageGo(delta) {
  _scriptPage += delta;
  scriptRender();
}

function _scriptSetPageSize(n) {
  SCRIPT_PAGE_SIZE = n;
  _scriptPage = 0;
  scriptRender();
}

function scriptSelectAll(chk) {
  document.querySelectorAll('.script-row-chk').forEach(c => c.checked = chk.checked);
  scriptSelectionChanged();
}

function scriptSelectionChanged() {
  const checked = [...document.querySelectorAll('.script-row-chk:checked')];
  const allChk = document.getElementById('script-select-all');
  const allBoxes = document.querySelectorAll('.script-row-chk');
  if (allChk) allChk.indeterminate = checked.length > 0 && checked.length < allBoxes.length;
  const bulkBar = document.getElementById('script-bulk-bar');
  const countEl = document.getElementById('script-sel-count');
  if (bulkBar) bulkBar.style.display = checked.length > 0 ? 'flex' : 'none';
  if (countEl) countEl.textContent = checked.length > 0 ? `${checked.length} selected` : '';
}

async function scriptDeleteSelected() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} script${ids.length > 1 ? 's' : ''}? This cannot be undone.`)) return;
  const res = await fetch('/api/scripts/bulk', {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Delete failed'); return; }
  await scriptLoad();
}

async function scriptBulkAddToSuite() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  const suites = allSuites.filter(s => s.projectId === currentProjectId);
  if (!suites.length) { alert('No suites in this project. Create a suite first.'); return; }
  const options = suites.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
  // Inline modal
  const existing = document.getElementById('bulk-suite-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'bulk-suite-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#1e2329;border-radius:10px;padding:28px 32px;min-width:340px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
      <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:16px">&#10133; Add ${ids.length} Script${ids.length > 1 ? 's' : ''} to Suite</div>
      <select id="bulk-suite-sel" class="fm-input" style="width:100%;margin-bottom:16px">
        <option value="">— Select a suite —</option>${options}
      </select>
      <div id="bulk-suite-alert" style="margin-bottom:10px;font-size:12.5px;color:#f48771;display:none"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-outline" onclick="document.getElementById('bulk-suite-modal').remove()">Cancel</button>
        <button class="btn btn-primary" onclick="scriptBulkAddToSuiteConfirm(${JSON.stringify(ids)})">Add to Suite</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function scriptBulkAddToSuiteConfirm(ids) {
  const suiteId = document.getElementById('bulk-suite-sel')?.value;
  const alertEl = document.getElementById('bulk-suite-alert');
  if (!suiteId) { alertEl.textContent = 'Select a suite first.'; alertEl.style.display = ''; return; }
  const res = await fetch('/api/scripts/bulk-suite', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, suiteId }),
  });
  const data = await res.json();
  if (!res.ok) { alertEl.textContent = data.error || 'Failed'; alertEl.style.display = ''; return; }
  document.getElementById('bulk-suite-modal')?.remove();
  const suiteName = allSuites.find(s => s.id === suiteId)?.name || suiteId;
  // Brief success toast
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#166534;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  toast.textContent = `✓ ${data.count} script${data.count !== 1 ? 's' : ''} added to "${suiteName}"`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
  await suiteLoad();
}

async function scriptBulkSetPriority() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  const priorities = ['low', 'medium', 'high', 'critical'];
  const choice = await _bulkPickModal(
    `&#9881; Set Priority for ${ids.length} Script${ids.length > 1 ? 's' : ''}`,
    'Priority', priorities.map(p => ({ value: p, label: p.charAt(0).toUpperCase() + p.slice(1) }))
  );
  if (!choice) return;
  const res = await fetch('/api/scripts/bulk', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, patch: { priority: choice } }),
  });
  if (!res.ok) { alert('Failed to update priority'); return; }
  _bulkToast(`✓ Priority set to "${choice}" for ${ids.length} script${ids.length > 1 ? 's' : ''}`);
  await scriptLoad();
}

async function scriptBulkSetTag() {
  const ids = [...document.querySelectorAll('.script-row-chk:checked')].map(c => c.value);
  if (!ids.length) return;
  const tag = await _bulkInputModal(`&#127991; Set Tag for ${ids.length} Script${ids.length > 1 ? 's' : ''}`, 'Tag value');
  if (tag === null) return;
  const res = await fetch('/api/scripts/bulk', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, patch: { tags: [tag.trim()] } }),
  });
  if (!res.ok) { alert('Failed to update tag'); return; }
  _bulkToast(`✓ Tag "${tag}" applied to ${ids.length} script${ids.length > 1 ? 's' : ''}`);
  await scriptLoad();
}

// Shared helpers for bulk modals
function _bulkPickModal(title, label, options) {
  return new Promise(resolve => {
    const existing = document.getElementById('bulk-pick-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'bulk-pick-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    const opts = options.map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`).join('');
    modal.innerHTML = `
      <div style="background:#1e2329;border-radius:10px;padding:28px 32px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:16px">${title}</div>
        <select id="bulk-pick-sel" class="fm-input" style="width:100%;margin-bottom:16px"><option value="">— Select ${escHtml(label)} —</option>${opts}</select>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-outline" onclick="document.getElementById('bulk-pick-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="
            const v=document.getElementById('bulk-pick-sel').value;
            if(!v)return;
            document.getElementById('bulk-pick-modal').remove();
            window.__bulkPickResolve(v);">Apply</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window.__bulkPickResolve = resolve;
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });
  });
}

function _bulkInputModal(title, placeholder) {
  return new Promise(resolve => {
    const existing = document.getElementById('bulk-input-modal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'bulk-input-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center';
    modal.innerHTML = `
      <div style="background:#1e2329;border-radius:10px;padding:28px 32px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,.5)">
        <div style="font-size:15px;font-weight:700;color:#f1f5f9;margin-bottom:16px">${title}</div>
        <input id="bulk-input-val" class="fm-input" placeholder="${escHtml(placeholder)}" style="width:100%;margin-bottom:16px" />
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn btn-outline" onclick="document.getElementById('bulk-input-modal').remove()">Cancel</button>
          <button class="btn btn-primary" onclick="
            const v=document.getElementById('bulk-input-val').value.trim();
            if(!v)return;
            document.getElementById('bulk-input-modal').remove();
            window.__bulkInputResolve(v);">Apply</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    window.__bulkInputResolve = resolve;
    modal.addEventListener('click', e => { if (e.target === modal) { modal.remove(); resolve(null); } });
    document.getElementById('bulk-input-val')?.focus();
  });
}

function _bulkToast(msg) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#166534;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

async function scriptOpenEditor(id = null) {
  await keywordsLoad();
  await seLoadComponents();
  if (!allFunctions.length) { try { await fnLoad(); } catch { } }
  editingScriptId = id;
  document.getElementById('script-editor-title').textContent = id ? 'Edit Script' : 'New Script';
  modClearAlert('script-editor-alert');
  document.getElementById('se-steps-container').innerHTML = '';
  document.getElementById('se-steps-hint').style.display = '';

  if (id) {
    const sc = allScripts.find(s => s.id === id);
    if (!sc) return;
    sePopulateComponent(sc.component || '');
    sePopulateSubcomponent(sc.subcomponent || null);
    document.getElementById('se-title').value = sc.title;
    document.getElementById('se-desc').value = sc.description || '';
    document.getElementById('se-priority').value = sc.priority;
    document.getElementById('se-tags').value = (sc.tags || []).join(', ');
    const mc = document.getElementById('se-metadata-card');
    if (mc) {
      mc.style.display = '';
      document.getElementById('se-meta-createdby').textContent = sc.createdBy || '—';
      document.getElementById('se-meta-createdat').textContent = formatDate(sc.createdAt);
      document.getElementById('se-meta-modifiedby').textContent = sc.modifiedBy || '—';
      document.getElementById('se-meta-modifiedat').textContent = formatDate(sc.modifiedAt);
    }
    (sc.steps || []).forEach(step => scriptAddStep(step, null, true));
    scriptReorderNums(); // one call after all steps inserted
  } else {
    sePopulateComponent('');
    sePopulateSubcomponent(null);
    document.getElementById('se-title').value = '';
    document.getElementById('se-desc').value = '';
    document.getElementById('se-priority').value = 'medium';
    document.getElementById('se-tags').value = '';
    const mc = document.getElementById('se-metadata-card');
    if (mc) mc.style.display = 'none';
    scriptAddStep();
  }
  document.getElementById('script-editor-overlay').style.display = 'flex';
}

function scriptEditorClose() {
  document.getElementById('script-editor-overlay').style.display = 'none';
  editingScriptId = null;
}

// ── Script Detail View ────────────────────────────────────────────────────────

let _detailScriptId = null;

async function scriptOpenDetail(id) {
  if (!id) return;
  _detailScriptId = id;
  // Reload fresh data in case it was edited
  const res = await fetch(`/api/scripts/${encodeURIComponent(id)}`);
  if (!res.ok) return;
  const sc = await res.json();

  document.getElementById('sd-title-header').textContent = `${sc.tcId || ''} — ${sc.title}`;
  document.getElementById('sd-tcid').textContent = sc.tcId || '—';
  document.getElementById('sd-component').textContent = sc.component || '—';
  document.getElementById('sd-priority').innerHTML = `<span class="badge badge-${escHtml(sc.priority)}">${escHtml(sc.priority)}</span>`;
  document.getElementById('sd-tags').innerHTML = (sc.tags || []).length
    ? (sc.tags || []).map(t => `<span class="badge badge-tester">${escHtml(t)}</span>`).join(' ')
    : '—';
  document.getElementById('sd-description').textContent = sc.description || '—';
  document.getElementById('sd-createdby').textContent = sc.createdBy || '—';
  document.getElementById('sd-createdat').textContent = formatDate(sc.createdAt);
  document.getElementById('sd-modifiedby').textContent = sc.modifiedBy || '—';
  document.getElementById('sd-modifiedat').textContent = formatDate(sc.modifiedAt);
  document.getElementById('sd-step-count').textContent = `(${(sc.steps || []).length} steps)`;

  // Build steps list with function expand/collapse
  const stepsEl = document.getElementById('sd-steps-list');
  stepsEl.innerHTML = _renderDetailSteps(sc.steps || []);

  document.getElementById('script-detail-overlay').style.display = 'flex';
}

function _renderDetailSteps(steps) {
  if (!steps.length) return '<div class="builder-hint">No steps defined.</div>';
  return steps.map((step, i) => {
    const isCall = step.keyword === 'CALL FUNCTION';
    const fn = isCall ? allFunctions.find(f => f.id === step.value || f.identifier === step.value) : null;
    const fnSteps = fn ? (fn.steps || []) : [];
    const expandId = `sd-fn-${i}`;
    return `
      <div class="sd-step-row ${isCall ? 'sd-step-fn' : ''}">
        <div class="sd-step-num">${i + 1}</div>
        <div class="sd-step-body">
          <div class="sd-step-head">
            <span class="sd-step-kw">${escHtml(step.keyword)}</span>
            ${step.description ? `<span class="sd-step-desc-txt">${escHtml(step.description)}</span>` : ''}
            ${isCall && fn ? `<button class="tbl-btn sd-fn-toggle" onclick="_sdToggleFn('${expandId}',this)" style="font-size:11px;padding:2px 7px">▶ ${escHtml(fn.name)}</button>` : ''}
            ${isCall && !fn ? `<span style="color:var(--neutral-400);font-size:12px">Function: ${escHtml(step.value || '—')}</span>` : ''}
          </div>
          ${!isCall && step.locator ? `<div class="sd-step-locator"><span class="sd-locator-type">${escHtml(step.locatorType || 'css')}</span> <code>${escHtml(step.locator)}</code></div>` : ''}
          ${!isCall && step.value ? `<div class="sd-step-value">Value: <code>${escHtml(step.value)}</code></div>` : ''}
          ${isCall && fn ? `
            <div class="sd-fn-steps" id="${expandId}" style="display:none">
              ${fnSteps.map((fs, fi) => `
                <div class="sd-child-step">
                  <div class="sd-step-num sd-child-num">${i + 1}.${fi + 1}</div>
                  <div class="sd-step-body">
                    <div class="sd-step-head">
                      <span class="sd-step-kw">${escHtml(fs.keyword)}</span>
                      ${fs.detail ? `<span class="sd-step-desc-txt">${escHtml(fs.detail)}</span>` : ''}
                    </div>
                    ${fs.selector ? `<div class="sd-step-locator"><code>${escHtml(fs.selector)}</code></div>` : ''}
                    ${fs.value ? `<div class="sd-step-value">Value: <code>${escHtml(fs.value)}</code></div>` : ''}
                  </div>
                </div>`).join('')}
            </div>` : ''}
        </div>
      </div>`;
  }).join('');
}

function _sdToggleFn(expandId, btn) {
  const el = document.getElementById(expandId);
  if (!el) return;
  const open = el.style.display !== 'none';
  el.style.display = open ? 'none' : '';
  btn.textContent = open ? `▶ ${btn.textContent.slice(2)}` : `▼ ${btn.textContent.slice(2)}`;
}

function scriptDetailClose() {
  document.getElementById('script-detail-overlay').style.display = 'none';
  _detailScriptId = null;
}

function scriptDetailEdit() {
  if (!_detailScriptId) return;
  scriptDetailClose();
  scriptOpenEditor(_detailScriptId);
}

// ── Keyword tooltip popup ────────────────────────────────────────────────────
let _kwTipPopup = null;

function _kwTipShow(trigger) {
  if (!_kwTipPopup) {
    _kwTipPopup = document.createElement('div');
    _kwTipPopup.id = 'kw-tooltip-popup';
    _kwTipPopup.className = 'kw-tooltip-popup';
    _kwTipPopup.innerHTML =
      `<div class="kw-tp-section kw-tp-what-wrap"><div class="kw-tp-label">What it does</div><div class="kw-tp-what"></div></div>` +
      `<div class="kw-tp-section kw-tp-example-wrap"><div class="kw-tp-label">Example</div><pre class="kw-tp-example"></pre></div>` +
      `<div class="kw-tp-section kw-tp-tip-wrap"><div class="kw-tp-label">Tip</div><div class="kw-tp-tip"></div></div>`;
    document.body.appendChild(_kwTipPopup);
  }
  const raw = trigger.dataset.tooltipJson || '';
  let tip = {};
  try { if (raw) tip = JSON.parse(raw); } catch (e) { }
  if (!tip.what && !tip.example && !tip.tip) return;

  _kwTipPopup.querySelector('.kw-tp-what').textContent = tip.what || '';
  _kwTipPopup.querySelector('.kw-tp-example').textContent = tip.example || '';
  _kwTipPopup.querySelector('.kw-tp-tip').textContent = tip.tip || '';
  _kwTipPopup.querySelector('.kw-tp-what-wrap').style.display = tip.what ? '' : 'none';
  _kwTipPopup.querySelector('.kw-tp-example-wrap').style.display = tip.example ? '' : 'none';
  _kwTipPopup.querySelector('.kw-tp-tip-wrap').style.display = tip.tip ? '' : 'none';

  _kwTipPopup.style.display = 'block';
  // position after layout so offsetWidth/Height are valid
  requestAnimationFrame(() => {
    const rect = trigger.getBoundingClientRect();
    const pw = _kwTipPopup.offsetWidth;
    const ph = _kwTipPopup.offsetHeight;
    let left = rect.right + 10;
    if (left + pw > window.innerWidth - 8) left = rect.left - pw - 10;
    let top = rect.top - 4;
    if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    _kwTipPopup.style.left = Math.max(8, left) + 'px';
    _kwTipPopup.style.top = Math.max(8, top) + 'px';
  });
}

function _kwTipHide() {
  if (_kwTipPopup) _kwTipPopup.style.display = 'none';
}

// ── Info-icon tooltip (position:fixed, viewport-clamped, scroll-safe) ────────
let _infoTipPopup = null;
let _infoTipHideTimer = null;

function _infoTipShow(trigger) {
  const text = trigger.dataset.tooltip || '';
  if (!text) return;
  clearTimeout(_infoTipHideTimer);
  if (!_infoTipPopup) {
    _infoTipPopup = document.createElement('div');
    _infoTipPopup.className = 'info-tip-popup';
    // keep visible while hovering the popup itself
    _infoTipPopup.addEventListener('mouseenter', () => clearTimeout(_infoTipHideTimer));
    _infoTipPopup.addEventListener('mouseleave', () => { _infoTipHideTimer = setTimeout(_infoTipHideNow, 120); });
    document.body.appendChild(_infoTipPopup);
  }
  _infoTipPopup.textContent = text;
  _infoTipPopup.style.display = 'block';
  requestAnimationFrame(() => {
    const rect = trigger.getBoundingClientRect();
    const pw = _infoTipPopup.offsetWidth;
    const ph = _infoTipPopup.offsetHeight;
    // prefer right of icon, fall back to left
    let left = rect.right + 10;
    if (left + pw > window.innerWidth - 8) left = rect.left - pw - 10;
    // prefer above icon, fall back to below, then clamp to viewport
    let top = rect.top - ph - 8;
    if (top < 8) top = rect.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    _infoTipPopup.style.left = Math.max(8, left) + 'px';
    _infoTipPopup.style.top = Math.max(8, top) + 'px';
  });
}
function _infoTipHideNow() {
  if (_infoTipPopup) _infoTipPopup.style.display = 'none';
}
function _infoTipHide() {
  clearTimeout(_infoTipHideTimer);
  _infoTipHideTimer = setTimeout(_infoTipHideNow, 120);
}

function _seKwGet(key) {
  for (const cat of scriptKeywords.categories) {
    const kw = cat.keywords.find(k => k.key === key);
    if (kw) return kw;
  }
  return null;
}

function scriptAddStep(step = {}, insertBeforeRow = null, _skipReorder = false) {
  const container = document.getElementById('se-steps-container');
  document.getElementById('se-steps-hint').style.display = 'none';
  const idx = container.querySelectorAll('.script-step-row').length;

  const valMode = step.valueMode || 'static';   // 'static' | 'dynamic' | 'commondata' | 'testdata'
  const isDyn = valMode === 'dynamic';
  const isCd = valMode === 'commondata';
  const isTd = valMode === 'testdata';
  const tokenOpts = (() => {
    let html = `<option value="">— choose token —</option>`;
    let currentGroup = null;
    for (const t of scriptKeywords.dynamicTokens) {
      const grp = t.group || '';
      if (grp && grp !== currentGroup) {
        if (currentGroup !== null) html += `</optgroup>`;
        html += `<optgroup label="${escHtml(grp)}">`;
        currentGroup = grp;
      }
      html += `<option value="${escHtml(t.token)}"${isDyn && step.value === t.token ? ' selected' : ''}>${escHtml(t.label)}</option>`;
    }
    if (currentGroup !== null) html += `</optgroup>`;
    return html;
  })();

  const curKw = _seKwGet(step.keyword);
  const needsLoc = curKw ? curKw.needsLocator : true;
  const needsVal = curKw ? curKw.needsValue : false;
  const isAuto = curKw?.autoFromProject || false;
  const isVisual = step.keyword === 'ASSERT VISUAL';
  const valHint = curKw?.valueHint || 'Value';
  const helpLbl = curKw?.helpLabel || '';
  const tipObj = curKw?.tooltip || null;
  const tipJson = (tipObj && (tipObj.what || tipObj.example || tipObj.tip)) ? JSON.stringify(tipObj) : '';

  const row = document.createElement('div');
  row.className = 'script-step-row';
  row.dataset.stepId = step.id || `new-${Date.now()}-${idx}`;
  row.innerHTML = `
    <div class="step-actions-top">
      <button type="button" class="step-action-btn" onclick="scriptStepMoveUp(this)" title="Move Up">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
      </button>
      <button type="button" class="step-action-btn" onclick="scriptStepMoveDown(this)" title="Move Down">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <button type="button" class="step-action-btn" onclick="scriptStepInsertBelow(this)" title="Insert Step Below">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </button>
      <button type="button" class="step-action-btn step-clone-icon" onclick="scriptStepClone(this)" title="Clone Step">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      </button>
      <button type="button" class="step-action-btn step-pin-icon${step.storeAs ? ' step-pin-active' : ''}${isTd ? ' step-pin-disabled' : ''}" onclick="scriptStepPinOpen(this)" title="${isTd ? 'Variable storage not allowed when Value Source is Test Data (Static)' : 'Save value as variable (📌 Pin)'}"${isTd ? ' disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 6 6 1-4.5 4 1 6L12 16l-5.5 3 1-6L3 9l6-1z"/></svg>
      </button>
      <button type="button" class="step-action-btn step-del-icon" onclick="scriptStepDelete(this)" title="Delete Step">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    </div>
    <div class="step-row-header">
      <span class="step-num">${idx + 1}</span>
      <select class="fm-select se-step-kw-select" style="flex:1;font-size:12.5px" onchange="scriptStepKwChange(this)">${_kwOptionsScriptHtml}</select>
      <label class="step-screenshot-lbl">
        <input type="checkbox" class="se-step-screenshot"${step.screenshot ? ' checked' : ''} /> Screenshot
      </label>
    </div>
    <div class="step-nl-row" style="display:flex;align-items:center;gap:6px;margin:4px 0 0 0">
      <span style="font-size:11px;color:var(--neutral-500);flex-shrink:0">&#10024; NL:</span>
      <input class="fm-input se-step-nl-input" type="text" placeholder="Describe this step in plain English…"
             style="flex:1;font-size:12px;padding:4px 8px"
             oninput="nlStepDebounce(this)" />
      <span class="se-step-nl-status" style="font-size:11px;color:var(--neutral-500);flex-shrink:0;min-width:60px;text-align:right"></span>
    </div>
    <div class="step-help-row"${helpLbl ? '' : ' style="display:none"'}>
      <span class="step-help-label">${escHtml(helpLbl)}</span>
      <span class="step-tooltip-trigger" data-tooltip-json="${escHtml(tipJson)}" onmouseenter="_kwTipShow(this)" onmouseleave="_kwTipHide()"${tipJson ? '' : ' style="display:none"'}>?</span>
    </div>
    <div class="step-pin-badge${(step.storeAs && !isTd) ? '' : ' step-pin-badge-hidden'}${step.storeScope === 'global' ? ' step-pin-badge-global' : ''}" data-store-as="${escHtml(isTd ? '' : (step.storeAs || ''))}" data-store-scope="${escHtml(step.storeScope || 'session')}" data-store-source="${escHtml(step.storeSource || 'text')}" data-store-attr="${escHtml(step.storeAttrName || '')}">
      <span class="pin-badge-label">${step.storeScope === 'global' ? '🌐' : '📌'} Saved as <code>{{var.${escHtml(step.storeAs || '')}}}</code><span class="pin-scope-tag">${step.storeScope === 'global' ? 'Global' : 'Session'}</span></span>
      <button type="button" class="pin-badge-clear" onclick="scriptStepPinClear(this)" title="Remove variable">✕</button>
    </div>
    <div class="se-step-auto-badge"${isAuto ? '' : ' style="display:none"'}>
      <span class="auto-config-badge">&#x2699; Auto from Project Config — URL &amp; credentials fetched automatically</span>
    </div>
    <div class="step-row-fields">
      ${isVisual ? `<div class="vrt-info-banner">
        <span class="vrt-info-icon">&#9432;</span>
        <span class="vrt-info-text"><strong>Visual Regression Mode:</strong>
          <span class="vrt-mode-el">&#128270; <strong>Element</strong> — fill the locator below to screenshot only that element (precise, component-level)</span> &nbsp;|&nbsp;
          <span class="vrt-mode-fp">&#128444; <strong>Full Page</strong> — leave locator blank to capture the entire visible viewport</span>
        </span>
      </div>` : ''}
      <div class="se-step-locator"${needsLoc && !isAuto ? '' : ' style="display:none"'}>
        <div class="field" style="margin:0 0 6px 0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
            <label style="font-size:11px;margin:0">Locator Name${isVisual ? ' <span style="font-size:10px;color:var(--g400);font-weight:400">(optional — blank = full page)</span>' : ''}</label>
            <span class="loc-repo-badge" style="display:none">From Repo</span>
            <button type="button" class="loc-unlock-btn" style="display:none" onclick="scriptStepUnlockLoc(this)" title="Unlock to edit manually">&#x270E; Edit</button>
          </div>
          <div style="display:flex;gap:4px">
            <input class="fm-input se-step-loc-name" style="flex:1;font-size:12px"
                   placeholder="e.g. LoginButton" value="${escHtml(step.locatorName ?? '')}" />
            <button type="button" class="tbl-btn" style="padding:5px 8px;font-size:13px;flex-shrink:0"
                    onclick="scriptStepPickLoc(this)" title="Pick from Locator Repo">&#x1F50D;</button>
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:start">
          <div class="field" style="margin:0;flex-shrink:0;width:130px"><label style="font-size:11px">Locator Type</label>
            <select class="fm-select se-step-loc-type" style="font-size:11.5px">${_locTypeOptsHtml}</select>
          </div>
          <div class="field" style="margin:0;flex:1"><label style="font-size:11px">Locator Value</label>
            <input class="fm-input se-step-selector" style="flex:1;font-size:12px;font-family:monospace"
                   placeholder="e.g. #btn-login" value="${escHtml(step.locator ?? '')}" />
          </div>
        </div>
      </div>
      ${isVisual ? `<div class="vrt-options-panel">
        <button type="button" class="vrt-options-toggle" onclick="vrtTogglePanel(this)">
          <span class="vrt-toggle-arrow">&#9654;</span> &#9881; VRT Options <span class="vrt-options-hint">— leave blank to use project defaults</span>
        </button>
        <div class="vrt-options-body" style="display:none">
          <div class="vrt-options-grid">
            <div class="vrt-field">
              <label>Threshold (0–100)</label>
              <input class="fm-input vrt-threshold" type="number" min="0" max="100" step="1"
                     placeholder="e.g. 20" value="${escHtml(String(step.vrtOptions?.threshold != null ? Math.round((step.vrtOptions.threshold)*100) : ''))}"
                     title="Color diff tolerance per pixel. 20 = allow 20% colour variance. Default: project setting." />
            </div>
            <div class="vrt-field">
              <label>Max Diff Pixels</label>
              <input class="fm-input vrt-maxDiffPixels" type="number" min="0" step="1"
                     placeholder="e.g. 200" value="${escHtml(String(step.vrtOptions?.maxDiffPixels ?? ''))}"
                     title="Hard cap on differing pixels. If set, overrides ratio check for this step." />
            </div>
            <div class="vrt-field">
              <label>Max Diff Pixel Ratio (0–100%)</label>
              <input class="fm-input vrt-maxDiffPixelRatio" type="number" min="0" max="100" step="1"
                     placeholder="e.g. 5" value="${escHtml(String(step.vrtOptions?.maxDiffPixelRatio != null ? Math.round((step.vrtOptions.maxDiffPixelRatio)*100) : ''))}"
                     title="Max % of total pixels allowed to differ. 5 = 5% of all pixels. Default: project setting." />
            </div>
            <div class="vrt-field">
              <label>Animations</label>
              <select class="fm-select vrt-animations" title="Freeze CSS animations before capture to prevent flaky diffs.">
                <option value="" ${!step.vrtOptions?.animations ? 'selected' : ''}>Project default</option>
                <option value="disabled" ${step.vrtOptions?.animations === 'disabled' ? 'selected' : ''}>Disabled (freeze)</option>
                <option value="allow"    ${step.vrtOptions?.animations === 'allow'    ? 'selected' : ''}>Allow (live)</option>
              </select>
            </div>
            <div class="vrt-field" style="grid-column:1/-1">
              <label>Mask Selectors <span style="font-weight:400;color:var(--g400)">(comma-separated CSS selectors — blanked before comparison)</span></label>
              <input class="fm-input vrt-mask" type="text"
                     placeholder="e.g. .timestamp, #live-counter, .user-avatar"
                     value="${escHtml((step.vrtOptions?.mask ?? []).join(', '))}"
                     title="These elements are hidden before the screenshot is taken. Use for timestamps, avatars, live counters." />
            </div>
            <div class="vrt-field">
              <label>Mask Color</label>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="color" class="vrt-maskColor-picker" value="${escHtml(step.vrtOptions?.maskColor ?? '#FF00FF')}" style="width:36px;height:28px;border:none;padding:0;cursor:pointer" />
                <input class="fm-input vrt-maskColor" type="text" style="font-family:monospace;font-size:12px"
                       placeholder="#FF00FF" value="${escHtml(step.vrtOptions?.maskColor ?? '')}"
                       title="CSS color used to paint over masked elements." />
              </div>
            </div>
            <div class="vrt-field" style="display:flex;align-items:center;gap:8px;padding-top:18px">
              <label style="margin:0">Omit Background</label>
              <input type="checkbox" class="vrt-omitBackground" ${step.vrtOptions?.omitBackground ? 'checked' : ''}
                     title="Transparent PNG — use for overlay components or elements without a solid background." />
              <span style="font-size:10px;color:var(--g400)">Transparent PNG</span>
            </div>
          </div>
          <div class="vrt-clip-row" style="${step.locator ? 'display:none' : ''}">
            <label style="font-size:11px;display:block;margin-bottom:4px">Clip Region <span style="font-weight:400;color:var(--g400)">(full-page mode only — pixel coordinates)</span></label>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="font-size:11px;color:var(--g500)">X</span><input class="fm-input vrt-clip-x" type="number" min="0" style="width:70px" placeholder="0" value="${step.vrtOptions?.clip?.x ?? ''}" />
              <span style="font-size:11px;color:var(--g500)">Y</span><input class="fm-input vrt-clip-y" type="number" min="0" style="width:70px" placeholder="0" value="${step.vrtOptions?.clip?.y ?? ''}" />
              <span style="font-size:11px;color:var(--g500)">W</span><input class="fm-input vrt-clip-w" type="number" min="1" style="width:70px" placeholder="1280" value="${step.vrtOptions?.clip?.width ?? ''}" />
              <span style="font-size:11px;color:var(--g500)">H</span><input class="fm-input vrt-clip-h" type="number" min="1" style="width:70px" placeholder="720" value="${step.vrtOptions?.clip?.height ?? ''}" />
              <span style="font-size:10px;color:var(--g400)">px</span>
            </div>
          </div>
        </div>
      </div>` : ''}
      <div class="se-step-value"${needsVal && !isAuto ? '' : ' style="display:none"'}>
        <div class="field" style="margin:0">
          <label style="font-size:11px">Value Source</label>
          <div class="value-toggle">
            <button type="button" class="value-toggle-btn${valMode === 'static' ? ' active' : ''}" onclick="scriptStepToggleVal(this,'static')">Static</button>
            <button type="button" class="value-toggle-btn${valMode === 'dynamic' ? ' active' : ''}" onclick="scriptStepToggleVal(this,'dynamic')">Dynamic</button>
            <button type="button" class="value-toggle-btn${isCd ? ' active' : ''}" onclick="scriptStepToggleVal(this,'commondata')">Common Data</button>
            <button type="button" class="value-toggle-btn value-toggle-td${isTd ? ' active' : ''}" onclick="scriptStepToggleVal(this,'testdata')" title="Placeholder — future Test Data dataset integration">Test Data (Static)</button>
            <button type="button" class="value-toggle-btn value-toggle-var${valMode === 'variable' ? ' active' : ''}" onclick="scriptStepToggleVal(this,'variable')" title="Use a pinned variable from an earlier step">📌 Variable</button>
          </div>
          <input class="fm-input se-step-val-static" style="font-size:12px${valMode !== 'static' ? ';display:none' : ''}"
                 placeholder="${escHtml(valHint)}" value="${escHtml(valMode === 'static' ? (step.value ?? '') : '')}" />
          <select class="fm-select se-step-val-dynamic" style="font-size:12.5px${valMode !== 'dynamic' ? ';display:none' : ''}">${tokenOpts}</select>
          <div class="se-step-val-cd" style="${isCd ? '' : 'display:none'}">
            <select class="fm-select se-step-cd-select" style="font-size:12.5px" onchange="scriptStepCdSelected(this)"
                    data-saved-cd="${escHtml(isCd && step.value ? step.value.replace(/^\$\{|\}$/g, '') : '')}">
              <option value="">— loading Common Data… —</option>
            </select>
            ${isCd && step.value ? `<div class="cd-token-preview">Reference: <code>${escHtml(step.value)}</code></div>` : '<div class="cd-token-preview" style="display:none"></div>'}
          </div>
          <div class="se-step-val-var" style="${valMode === 'variable' ? '' : 'display:none'}">
            <select class="fm-select se-step-var-select" style="font-size:12.5px" onchange="_varSelectChanged(this)">
              <option value="">— pick a variable —</option>
            </select>
            <div class="var-usage-hint" style="font-size:11px;color:var(--neutral-500);margin-top:4px;display:none">
              Use <code class="var-usage-token"></code> in any value field to reference this variable
            </div>
            <div class="var-no-vars-hint" style="font-size:11px;color:var(--neutral-400);margin-top:4px;display:none">
              No variables defined yet. Use the 📌 pin icon on an earlier FILL or TYPE step to create one.
            </div>
          </div>
          <div class="se-step-val-td" style="${isTd ? '' : 'display:none'}">
            <div class="td-frame">
              <div class="td-frame-header">
                <span style="font-size:11.5px;font-weight:700;color:var(--neutral-600)">Test Data</span>
                <button type="button" class="tbl-btn" style="font-size:11px;padding:2px 8px" onclick="scriptStepTdAddRow(this)">+ Add Row</button>
              </div>
              <table class="td-table">
                <thead><tr><th style="width:28px">#</th><th>Value <span style="color:var(--danger)">*</span></th><th style="width:32px"></th></tr></thead>
                <tbody class="td-tbody">
                  ${(step.testData || []).map((r, ri) => `
                    <tr class="td-row">
                      <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${ri + 1}</td>
                      <td><input class="fm-input td-val" style="font-size:12px;font-family:monospace" placeholder="value" value="${escHtml(r.value)}" /></td>
                      <td><button type="button" class="step-action-btn step-del-icon" onclick="scriptStepTdDelRow(this)" title="Delete row"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>
                    </tr>`).join('')}
                </tbody>
              </table>
              <div class="td-info-row">
                <span>&#x2139;&#xFE0F; Each row = one test execution. The step runs once per row using that row's value.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="se-step-fn-picker" style="display:none" data-saved-fn="${escHtml(step.value || '')}" data-fn-step-values="${escHtml(JSON.stringify(step.fnStepValues || []))}">
        <div class="field" style="margin:0"><label style="font-size:11px">Common Function</label>
          <div style="display:flex;gap:4px">
            <select class="fm-select se-step-fn-select" style="flex:1;font-size:12.5px" onchange="scriptStepFnSelected(this)">
              <option value="">— select function —</option>
            </select>
            <button type="button" class="tbl-btn" style="padding:5px 8px;font-size:11px;flex-shrink:0"
                    onclick="scriptStepRefreshFns(this)" title="Refresh function list">&#x21BB;</button>
          </div>
        </div>
        <div class="se-fn-expand-area" style="margin-top:6px;display:none"></div>
      </div>
      <!-- FILE CHOOSER upload widget -->
      <div class="se-filechooser-widget" style="display:none">
        <div class="fc-upload-area" style="${step.keyword === 'FILE CHOOSER' && step.value ? 'display:none' : ''}">
          <label class="fc-browse-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Browse &amp; Upload File
            <input type="file" class="fc-file-input" style="display:none" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.json,.xml,.zip" onchange="scriptStepFileChooserUpload(this)" />
          </label>
          <span class="fc-hint">File is uploaded to the server and used during test execution</span>
        </div>
        <div class="fc-file-info" style="${step.keyword === 'FILE CHOOSER' && step.value ? '' : 'display:none'}" data-server-path="${escHtml(step.value || '')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="fc-filename">${escHtml(step.value ? step.value.split('/').pop() : '')}</span>
          <span class="fc-server-path">${escHtml(step.value || '')}</span>
          <button type="button" class="fc-replace-btn" onclick="scriptStepFileChooserReplace(this)" title="Replace with a different file">
            Replace
            <input type="file" class="fc-file-input" style="display:none" accept=".xlsx,.xls,.csv,.pdf,.docx,.doc,.txt,.json,.xml,.zip" onchange="scriptStepFileChooserUpload(this)" />
          </button>
          <button type="button" class="fc-remove-btn" onclick="scriptStepFileChooserRemove(this)" title="Remove file">✕</button>
        </div>
        <div class="fc-uploading" style="display:none">
          <span class="fc-spinner"></span> Uploading…
        </div>
      </div>
      <!-- SET VARIABLE special fields -->
      <div class="se-setvar-fields" style="display:none">
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">
          <div class="field" style="margin:0;flex:1;min-width:140px">
            <label style="font-size:11px">Read From</label>
            <select class="fm-select se-setvar-source" style="font-size:12px" onchange="_setVarSourceChanged(this)" data-saved="${escHtml(step.storeSource || 'text')}">
              <option value="text"  ${(step.storeSource || 'text') === 'text' ? 'selected' : ''}>Text shown on page</option>
              <option value="value" ${step.storeSource === 'value' ? 'selected' : ''}>Value inside an input field</option>
              <option value="attr"  ${step.storeSource === 'attr' ? 'selected' : ''}>Element attribute</option>
              <option value="js"    ${step.storeSource === 'js' ? 'selected' : ''}>Run JavaScript (advanced)</option>
            </select>
          </div>
          <div class="field se-setvar-attr-wrap" style="margin:0;width:130px;${step.storeSource === 'attr' ? '' : 'display:none'}">
            <label style="font-size:11px">Attribute Name</label>
            <input class="fm-input se-setvar-attr" style="font-size:12px" placeholder="e.g. href" value="${escHtml(step.storeAttrName || '')}"/>
          </div>
          <div class="field" style="margin:0;flex:1;min-width:140px">
            <label style="font-size:11px">Save As (variable name)</label>
            <input class="fm-input se-setvar-name" style="font-size:12px;font-family:monospace"
                   placeholder="e.g. patientId" value="${escHtml(step.storeAs || '')}"
                   oninput="_setVarNameHint(this)" pattern="[A-Za-z0-9_]+" title="Letters, numbers and _ only"/>
          </div>
          <div class="field" style="margin:0;min-width:160px">
            <label style="font-size:11px">Scope</label>
            <div class="setvar-scope-toggle">
              <label class="setvar-scope-opt${(step.storeScope || 'session') === 'session' ? ' active' : ''}">
                <input type="radio" name="setvar-scope-${step.id || 'new'}" class="se-setvar-scope" value="session" ${(step.storeScope || 'session') === 'session' ? 'checked' : ''} onchange="_setVarScopeChanged(this)"/>
                📌 Session
              </label>
              <label class="setvar-scope-opt${step.storeScope === 'global' ? ' active' : ''}">
                <input type="radio" name="setvar-scope-${step.id || 'new'}" class="se-setvar-scope" value="global" ${step.storeScope === 'global' ? 'checked' : ''} onchange="_setVarScopeChanged(this)"/>
                🌐 Global
              </label>
            </div>
          </div>
        </div>
        <div class="setvar-hint" style="font-size:11px;color:var(--neutral-500);margin-top:5px;display:${step.storeAs ? 'block' : 'none'}">
          Use <code>{{var.${escHtml(step.storeAs || '')}}}</code> in any later step's value field
          <span class="setvar-scope-hint">${step.storeScope === 'global' ? ' — 🌐 visible across all scripts in this suite' : ' — 📌 visible only within this script'}</span>
        </div>
        <div class="se-setvar-js-wrap" style="${step.storeSource === 'js' ? 'margin-top:6px' : 'display:none'}">
          <label style="font-size:11px">JavaScript Expression</label>
          <input class="fm-input se-step-val-static" style="font-size:12px;font-family:monospace" placeholder="e.g. document.title" value="${escHtml(step.storeSource === 'js' ? (step.value || '') : '')}" />
        </div>
      </div>
    </div>
    <div class="step-row-bottom">
      <input class="fm-input se-step-desc" style="flex:1;font-size:12px" placeholder="Step description (optional)"
             value="${escHtml(step.description ?? '')}" />
    </div>`;

  // Set keyword + locator type selections via JS (avoids per-step option string rebuild)
  row.querySelector('.se-step-kw-select').value = step.keyword || '';
  row.querySelector('.se-step-loc-type').value = step.locatorType || 'css';

  // Sync-fail badge — shown when this step's locator failed to sync on last save
  if (step.locatorName && _syncFailedLocators.has(step.locatorName)) {
    const locField = row.querySelector('.se-step-locator .field');
    if (locField) {
      const badge = document.createElement('span');
      badge.className = 'sync-fail-step-badge';
      badge.title = `"${step.locatorName}" could not be saved to the Locator Repository. Open Locator Repository to add it manually.`;
      badge.textContent = '⚠ Repo sync failed';
      locField.appendChild(badge);
    }
  }

  if (insertBeforeRow) {
    container.insertBefore(row, insertBeforeRow);
  } else {
    container.appendChild(row);
  }
  scriptStepKwChange(row.querySelector('.se-step-kw-select'));
  if (!_skipReorder) scriptReorderNums();
  // If restoring a commondata step, pre-load CD options
  if (valMode === 'commondata') _loadCdOptions(row);
  // If restoring a variable step, pre-load variable options
  if (valMode === 'variable') {
    const varSel = row.querySelector('.se-step-var-select');
    if (varSel && step.value) varSel.dataset.savedVar = step.value;
    _loadVarOptions(row);
  }
}

// ── NL Keyword Suggestion ──────────────────────────────────────────────────────

let _nlTimer = null;

function nlStepDebounce(input) {
  const row = input.closest('.script-step-row');
  const statusEl = row?.querySelector('.se-step-nl-status');
  if (statusEl) statusEl.textContent = '…';
  clearTimeout(_nlTimer);
  const val = input.value.trim();
  if (!val) { if (statusEl) statusEl.textContent = ''; return; }
  _nlTimer = setTimeout(() => nlStepSuggest(input, row, statusEl), 600);
}

async function nlStepSuggest(input, row, statusEl) {
  if (statusEl) { statusEl.textContent = '⏳'; statusEl.style.color = 'var(--neutral-400)'; }
  try {
    const res = await fetch('/api/nl/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.value.trim(), projectId: currentProjectId || '' }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      if (statusEl) { statusEl.textContent = '✗'; statusEl.style.color = '#f48771'; statusEl.title = data.error || 'Error'; }
      return;
    }

    const step = Array.isArray(data.steps) ? data.steps[0] : data;

    // Auto-fill keyword
    if (step.keyword) {
      const kwSel = row.querySelector('.se-step-kw-select');
      if (kwSel) {
        const match = [...kwSel.options].find(o => o.value.toUpperCase() === step.keyword.toUpperCase());
        if (match) {
          kwSel.value = match.value;
          scriptStepKwChange(kwSel);
        }
      }
    }

    // Auto-fill locator name (always update — user changed NL text intentionally)
    if (step.locatorName) {
      const locInput = row.querySelector('.se-step-loc-name');
      if (locInput) {
        locInput.value = step.locatorName;
        // Try to resolve from locator repo
        _seResolveLocName(row, step.locatorName);
      }
    }

    // Auto-fill static value (always update when NL provides one)
    if (step.value !== undefined && step.value !== null) {
      const staticInput = row.querySelector('.se-step-val-static');
      if (staticInput) staticInput.value = step.value;
    }

    const pct = Math.round((step.confidence ?? data.confidence ?? 1) * 100);
    if (statusEl) {
      statusEl.textContent = `✓ ${pct}%`;
      statusEl.style.color = pct >= 80 ? '#4ec9b0' : pct >= 50 ? '#e9b96e' : '#f48771';
      statusEl.title = `Confidence: ${pct}%`;
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '✗'; statusEl.style.color = '#f48771'; statusEl.title = e.message; }
  }
}

// Resolve a locator name against the repo (same logic as locator picker)
function _seResolveLocName(row, name) {
  if (!currentProjectId || !name) return;
  fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}`)
    .then(r => r.json())
    .then(locs => {
      const match = locs.find(l => l.name?.toLowerCase() === name.toLowerCase());
      if (!match) return;
      const locNameEl = row.querySelector('.se-step-loc-name');
      const locTypeEl = row.querySelector('.se-step-loc-type');
      const locSelEl = row.querySelector('.se-step-selector');
      const repoEl = row.querySelector('.loc-repo-badge');
      const unlockEl = row.querySelector('.loc-unlock-btn');
      if (locNameEl) { locNameEl.value = match.name; locNameEl.readOnly = true; }
      if (locTypeEl) locTypeEl.value = match.selectorType || match.locatorType || 'css';
      if (locSelEl) { locSelEl.value = match.selector || ''; locSelEl.readOnly = true; }
      if (repoEl) repoEl.style.display = '';
      if (unlockEl) unlockEl.style.display = '';
      row.dataset.locatorId = match.id;
    }).catch(() => { });
}

// ── VRT project defaults cache + loader ───────────────────────────────────
let _vrtProjectCache = null;  // { projectId, config } — one entry, reset on project change

async function _vrtLoadProjectDefaults(projectId) {
  if (_vrtProjectCache && _vrtProjectCache.projectId === projectId) return _vrtProjectCache.config;
  try {
    const res = await fetch('/api/projects');
    if (!res.ok) return null;
    const list = await res.json();
    const proj = list.find(p => p.id === projectId);
    if (!proj) return null;
    _vrtProjectCache = { projectId, config: proj.vrtConfig || {} };
    return _vrtProjectCache.config;
  } catch { return null; }
}

// Apply project VRT defaults as placeholders + dropdown hints on a VRT panel
async function _vrtApplyProjectDefaults(panel, projectId) {
  const cfg = await _vrtLoadProjectDefaults(projectId);
  if (!cfg || !panel) return;

  const numPlaceholder = (sel, val, unit = '') => {
    const el = panel.querySelector(sel);
    if (el) el.placeholder = val != null ? `${val}${unit} (project default)` : 'blank = disabled';
  };
  const dropdownDefault = (sel, val, labelMap) => {
    const el = panel.querySelector(sel);
    if (!el) return;
    // Insert/update the "Project default" first option
    let defOpt = el.querySelector('option[value=""]');
    if (!defOpt) {
      defOpt = document.createElement('option');
      defOpt.value = '';
      el.prepend(defOpt);
    }
    defOpt.textContent = `Project default — ${labelMap[val] || val}`;
    // Only select it if no step-level value is already chosen
    if (!el.dataset.stepValue) el.value = '';
  };

  const t  = cfg.threshold         != null ? Math.round(cfg.threshold * 100)         : 20;
  const r  = cfg.maxDiffPixelRatio  != null ? Math.round(cfg.maxDiffPixelRatio * 100) : 5;
  const mx = cfg.maxDiffPixels      != null ? cfg.maxDiffPixels                       : null;
  const to = cfg.timeout            != null ? cfg.timeout                             : 5000;

  numPlaceholder('.vrt-threshold',        t,  '');
  numPlaceholder('.vrt-maxDiffPixelRatio', r,  '%');
  numPlaceholder('.vrt-maxDiffPixels',    mx);
  numPlaceholder('.vrt-timeout',          to, ' ms');

  dropdownDefault('.vrt-animations', cfg.animations || 'disabled', { disabled: 'Disabled (freeze)', allow: 'Allow (live)' });
  dropdownDefault('.vrt-scale',      cfg.scale      || 'css',      { css: 'CSS logical pixels',     device: 'Device HiDPI' });
  dropdownDefault('.vrt-caret',      cfg.caret      || 'hide',     { hide: 'Hide cursor',           initial: 'Show cursor' });

  // MaskColor — show picker row only when mask selectors has content
  _vrtToggleMaskColor(panel);
}

function _vrtToggleMaskColor(panel) {
  const maskInput = panel.querySelector('.vrt-mask');
  const colorRow  = panel.querySelector('.vrt-maskcolor-row');
  if (!maskInput || !colorRow) return;
  const hasMask = maskInput.value.trim().length > 0;
  colorRow.style.display = hasMask ? '' : 'none';
}

// ── VRT Options panel helpers ──────────────────────────────────────────────
function vrtTogglePanel(btn) {
  const body = btn.closest('.vrt-options-panel').querySelector('.vrt-options-body');
  const arrow = btn.querySelector('.vrt-toggle-arrow');
  const open = body.style.display === 'none';
  body.style.display = open ? 'block' : 'none';
  arrow.style.transform = open ? 'rotate(90deg)' : '';
}

function _seCollectVrtOptions(row) {
  const panel = row.querySelector('.vrt-options-panel');
  if (!panel) return undefined;
  const get = (sel) => panel.querySelector(sel);
  const numOrNull = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  const threshold        = numOrNull(get('.vrt-threshold')?.value);
  const maxDiffPixels    = numOrNull(get('.vrt-maxDiffPixels')?.value);
  const maxDiffPixelRatio = numOrNull(get('.vrt-maxDiffPixelRatio')?.value);
  const animations       = get('.vrt-animations')?.value || null;
  const maskRaw          = get('.vrt-mask')?.value?.trim() || '';
  const mask             = maskRaw ? maskRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const maskColor        = get('.vrt-maskColor')?.value?.trim() || null;
  const omitBackground   = get('.vrt-omitBackground')?.checked || false;
  const cx = numOrNull(get('.vrt-clip-x')?.value);
  const cy = numOrNull(get('.vrt-clip-y')?.value);
  const cw = numOrNull(get('.vrt-clip-w')?.value);
  const ch = numOrNull(get('.vrt-clip-h')?.value);
  const clip = (cx != null && cy != null && cw != null && ch != null)
    ? { x: cx, y: cy, width: cw, height: ch } : null;

  const opts = {};
  if (threshold != null)        opts.threshold        = threshold / 100;
  if (maxDiffPixels != null)    opts.maxDiffPixels    = maxDiffPixels;
  if (maxDiffPixelRatio != null) opts.maxDiffPixelRatio = maxDiffPixelRatio / 100;
  if (animations)               opts.animations       = animations;
  if (mask.length)              opts.mask             = mask;
  if (maskColor)                opts.maskColor        = maskColor;
  if (omitBackground)           opts.omitBackground   = true;
  if (clip)                     opts.clip             = clip;
  return Object.keys(opts).length ? opts : undefined;
}

function scriptStepKwChange(sel) {
  const row = sel.closest('.script-step-row');
  const opt = sel.selectedOptions[0];
  const kwKey = opt?.value || '';
  const needsLoc = opt?.dataset.nl === 'true';
  const needsVal = opt?.dataset.nv === 'true';
  const isAuto = opt?.dataset.auto === 'true';
  const isFnCall = kwKey === 'CALL FUNCTION';
  const hint = opt?.dataset.hint || 'Value';
  const helpText = opt?.dataset.help || '';
  const tipJson = opt?.dataset.tooltipJson || '';

  const isSetVar = kwKey === 'SET VARIABLE';
  const isFileChooser = kwKey === 'FILE CHOOSER';

  // GOTO auto-config: hide locator + value, show auto badge
  row.querySelector('.se-step-locator').style.display = (needsLoc && !isAuto && !isSetVar && !isFileChooser) ? '' : 'none';
  row.querySelector('.se-step-value').style.display = (needsVal && !isAuto && !isFnCall && !isSetVar && !isFileChooser) ? '' : 'none';
  row.querySelector('.se-step-auto-badge').style.display = isAuto ? '' : 'none';

  // FILE CHOOSER: show custom upload widget, show locator for the trigger button
  const fileChooserWidget = row.querySelector('.se-filechooser-widget');
  if (fileChooserWidget) {
    fileChooserWidget.style.display = isFileChooser ? '' : 'none';
    if (isFileChooser) {
      row.querySelector('.se-step-locator').style.display = '';
      _fileChooserWidgetInit(row);
    }
  }

  // SET VARIABLE: show special fields, show locator only when source needs it
  const setVarFields = row.querySelector('.se-setvar-fields');
  if (setVarFields) {
    setVarFields.style.display = isSetVar ? '' : 'none';
    if (isSetVar) {
      const src = row.querySelector('.se-setvar-source')?.value || 'text';
      const needsLocSV = src !== 'js';
      row.querySelector('.se-step-locator').style.display = needsLocSV ? '' : 'none';
    }
  }

  // CALL FUNCTION: show function picker, hide value
  const fnPicker = row.querySelector('.se-step-fn-picker');
  if (fnPicker) {
    fnPicker.style.display = isFnCall ? '' : 'none';
    if (isFnCall) _populateFnSelect(row);
  }

  // Help label + tooltip
  const helpRow = row.querySelector('.step-help-row');
  if (helpRow) {
    helpRow.style.display = helpText ? '' : 'none';
    const lbl = helpRow.querySelector('.step-help-label');
    if (lbl) lbl.textContent = helpText;
    const tip = helpRow.querySelector('.step-tooltip-trigger');
    if (tip) { tip.dataset.tooltipJson = tipJson; tip.style.display = tipJson ? '' : 'none'; }
  }

  const si = row.querySelector('.se-step-val-static');
  if (si) si.placeholder = hint;

  // ── VRT info banner + options panel — inject/remove on keyword change ──
  const isVisualKw = kwKey === 'ASSERT VISUAL';
  // Info banner
  let vrtBanner = row.querySelector('.vrt-info-banner');
  if (isVisualKw && !vrtBanner) {
    vrtBanner = document.createElement('div');
    vrtBanner.className = 'vrt-info-banner';
    vrtBanner.innerHTML = '<span class="vrt-info-icon">&#9432;</span>'
      + '<span class="vrt-info-text"><strong>Visual Regression Mode:</strong>'
      + ' <span class="vrt-mode-el">&#128270; <strong>Element</strong> — fill the locator to screenshot only that element</span>'
      + ' &nbsp;|&nbsp; <span class="vrt-mode-fp">&#128444; <strong>Full Page</strong> — leave locator blank to capture the entire viewport</span>'
      + '</span>';
    const locDiv = row.querySelector('.se-step-locator');
    if (locDiv) locDiv.before(vrtBanner);
  } else if (!isVisualKw && vrtBanner) {
    vrtBanner.remove();
  }
  // Locator label optional hint
  const locLabel = row.querySelector('.se-step-locator label');
  if (locLabel) {
    let optSpan = locLabel.querySelector('.vrt-loc-optional');
    if (isVisualKw && !optSpan) {
      optSpan = document.createElement('span');
      optSpan.className = 'vrt-loc-optional';
      optSpan.style.cssText = 'font-size:10px;color:var(--g400);font-weight:400';
      optSpan.textContent = ' (optional — blank = full page)';
      locLabel.appendChild(optSpan);
    } else if (!isVisualKw && optSpan) {
      optSpan.remove();
    }
  }
  // VRT Options panel
  let vrtPanel = row.querySelector('.vrt-options-panel');
  if (isVisualKw && !vrtPanel) {
    vrtPanel = document.createElement('div');
    vrtPanel.className = 'vrt-options-panel';
    vrtPanel.innerHTML = '<button type="button" class="vrt-options-toggle" onclick="vrtTogglePanel(this)">'
      + '<span class="vrt-toggle-arrow">&#9654;</span> &#9881; VRT Options'
      + ' <span class="vrt-options-hint">— leave blank to use project defaults</span></button>'
      + '<div class="vrt-options-body" style="display:none">'
      + '<div class="vrt-options-grid">'
      + '<div class="vrt-field"><label>Threshold (0–100)</label><input class="fm-input vrt-threshold" type="number" min="0" max="100" step="1" title="Color diff tolerance per pixel. 20 = allow 20% colour variance." /></div>'
      + '<div class="vrt-field"><label>Max Diff Pixels</label><input class="fm-input vrt-maxDiffPixels" type="number" min="0" step="1" title="Hard cap on differing pixels. Blank = no pixel cap." /></div>'
      + '<div class="vrt-field"><label>Max Diff Pixel Ratio (0–100%)</label><input class="fm-input vrt-maxDiffPixelRatio" type="number" min="0" max="100" step="1" title="Max % of total pixels allowed to differ." /></div>'
      + '<div class="vrt-field"><label>Animations</label><select class="fm-select vrt-animations"><option value="">Loading project default…</option><option value="disabled">Disabled (freeze)</option><option value="allow">Allow (live)</option></select></div>'
      + '<div class="vrt-field"><label>Scale</label><select class="fm-select vrt-scale"><option value="">Loading project default…</option><option value="css">CSS (device-independent)</option><option value="device">Device (physical pixels)</option></select></div>'
      + '<div class="vrt-field"><label>Caret</label><select class="fm-select vrt-caret"><option value="">Loading project default…</option><option value="hide">Hide</option><option value="initial">Initial</option></select></div>'
      + '<div class="vrt-field" style="grid-column:1/-1"><label>Mask Selectors <span style="font-weight:400;color:var(--g400)">(comma-separated CSS — blanked before comparison)</span></label>'
      + '<input class="fm-input vrt-mask" type="text" placeholder="e.g. .timestamp, #live-counter, .user-avatar" title="Elements hidden before screenshot — use for timestamps, avatars, live counters."'
      + ' oninput="_vrtToggleMaskColor(this.closest(\'.vrt-options-panel\'))" /></div>'
      + '<div class="vrt-maskcolor-row" style="display:none"><div class="vrt-field"><label>Mask Color</label><div style="display:flex;gap:6px;align-items:center">'
      + '<input type="color" class="vrt-maskColor-picker" value="#FF00FF" style="width:36px;height:28px;border:none;padding:0;cursor:pointer" oninput="this.nextElementSibling.value=this.value" />'
      + '<input class="fm-input vrt-maskColor" type="text" style="font-family:monospace;font-size:12px" placeholder="#FF00FF" oninput="this.previousElementSibling.value=this.value" /></div></div></div>'
      + '<div class="vrt-field" style="display:flex;align-items:center;gap:8px;padding-top:18px"><label style="margin:0">Omit Background</label>'
      + '<input type="checkbox" class="vrt-omitBackground" title="Transparent PNG for overlay components." />'
      + '<span style="font-size:10px;color:var(--g400)">Transparent PNG</span></div>'
      + '</div>'
      + '<div class="vrt-clip-row" style="display:none"><label style="font-size:11px;display:block;margin-bottom:4px">Clip Region <span style="font-weight:400;color:var(--g400)">(full-page mode only)</span></label>'
      + '<div style="display:flex;gap:8px;align-items:center">'
      + '<span style="font-size:11px;color:var(--g500)">X</span><input class="fm-input vrt-clip-x" type="number" min="0" style="width:70px" placeholder="0" />'
      + '<span style="font-size:11px;color:var(--g500)">Y</span><input class="fm-input vrt-clip-y" type="number" min="0" style="width:70px" placeholder="0" />'
      + '<span style="font-size:11px;color:var(--g500)">W</span><input class="fm-input vrt-clip-w" type="number" min="1" style="width:70px" placeholder="1280" />'
      + '<span style="font-size:11px;color:var(--g500)">H</span><input class="fm-input vrt-clip-h" type="number" min="1" style="width:70px" placeholder="720" />'
      + '<span style="font-size:10px;color:var(--g400)">px</span></div></div>'
      + '</div>';
    const valDiv = row.querySelector('.se-step-value');
    if (valDiv) valDiv.before(vrtPanel);
    // Load project-specific defaults as placeholders — isolated per project via currentProjectId global
    _vrtApplyProjectDefaults(vrtPanel, currentProjectId);
  } else if (!isVisualKw && vrtPanel) {
    vrtPanel.remove();
  }
  // Show/hide clip row based on whether locator is filled
  if (isVisualKw) {
    const locInput = row.querySelector('.se-step-selector');
    const clipRow = row.querySelector('.vrt-clip-row');
    if (locInput && clipRow) {
      locInput.addEventListener('input', () => {
        clipRow.style.display = locInput.value.trim() ? 'none' : '';
      }, { once: false });
      clipRow.style.display = locInput.value.trim() ? 'none' : '';
    }
  }
}

function _populateFnSelect(row) {
  const sel = row.querySelector('.se-step-fn-select');
  if (!sel) return;
  // Restore saved value: data-saved-fn on picker div (set at render time from step.value)
  const picker = row.querySelector('.se-step-fn-picker');
  const savedVal = picker?.dataset.savedFn || sel.value || '';
  sel.innerHTML = '<option value="">— select function —</option>' +
    allFunctions.map(f =>
      `<option value="${escHtml(f.name)}"${f.name === savedVal ? ' selected' : ''}>${escHtml(f.name)}</option>`
    ).join('');
  // Clear saved hint so future manual changes aren't overridden
  if (picker) picker.dataset.savedFn = '';
  // Render child steps for whichever function is now selected
  _renderFnExpandArea(row);
}

function scriptStepFnSelected(sel) {
  const row = sel.closest('.script-step-row');
  _renderFnExpandArea(row);
}

function _renderFnExpandArea(row) {
  const sel = row.querySelector('.se-step-fn-select');
  const expandEl = row.querySelector('.se-fn-expand-area');
  if (!sel || !expandEl) return;
  const fnName = sel.value;
  const fn = allFunctions.find(f => f.name === fnName);
  if (!fn || !(fn.steps || []).length) { expandEl.style.display = 'none'; expandEl.innerHTML = ''; return; }

  const picker = row.querySelector('.se-step-fn-picker');
  let savedVals = [];
  try { savedVals = JSON.parse(picker?.dataset.fnStepValues || '[]'); } catch { }

  const stepNum = row.querySelector('.step-num')?.textContent || '?';

  expandEl.style.display = '';
  expandEl.innerHTML = `
    <div class="fn-expand-header">
      <button type="button" class="tbl-btn fn-expand-toggle" onclick="_toggleFnExpand(this)" style="font-size:11px;padding:2px 8px">
        ▶ Show ${fn.steps.length} step${fn.steps.length > 1 ? 's' : ''} (${escHtml(fn.name)})
      </button>
    </div>
    <div class="fn-child-steps" style="display:none">
      ${fn.steps.map((fs, fi) => {
    const kwMeta = _seKwGet(fs.keyword);
    const needsVal = kwMeta ? kwMeta.needsValue : false;
    const valHint = kwMeta?.valueHint || 'Value';
    const saved = savedVals.find(v => v.fnStepIdx === fi) || {};
    const valMode = saved.valueMode || 'static';
    const isDyn = valMode === 'dynamic';
    const isCd = valMode === 'commondata';
    const isTd = valMode === 'testdata';
    const locDisplay = [fs.locatorName || fs.detail, fs.selector].filter(Boolean).join(' → ');
    const dynOpts = '<option value="">— choose token —</option>' +
      (scriptKeywords.dynamicTokens || []).map(t =>
        `<option value="${escHtml(t.token)}"${isDyn && saved.value === t.token ? ' selected' : ''}>${escHtml(t.label)}</option>`
      ).join('');
    const tdRows = (saved.testData || []).map((r, ri) => `
          <tr class="fn-cs-td-row">
            <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${ri + 1}</td>
            <td><input class="fm-input fn-cs-td-val" style="font-size:12px;font-family:monospace" placeholder="value" value="${escHtml(r.value || '')}" /></td>
            <td><button type="button" class="step-action-btn step-del-icon" onclick="fnCsTdDelRow(this)" title="Delete row"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>
          </tr>`).join('');
    return `
        <div class="fn-child-row" data-fn-step-idx="${fi}">
          <div class="fn-cs-header">
            <span class="fn-child-num">${stepNum}.${fi + 1}</span>
            <span class="fn-child-kw">${escHtml(fs.keyword)}</span>
            ${locDisplay ? `<span class="fn-cs-loc-info">${escHtml(locDisplay)}</span>` : ''}
          </div>
          ${needsVal ? `
          <div class="fn-cs-value">
            <div class="value-toggle" style="margin-bottom:6px">
              <button type="button" class="value-toggle-btn${valMode === 'static' ? ' active' : ''}" onclick="fnCsToggleVal(this,'static')">Static</button>
              <button type="button" class="value-toggle-btn${isDyn ? ' active' : ''}" onclick="fnCsToggleVal(this,'dynamic')">Dynamic</button>
              <button type="button" class="value-toggle-btn${isCd ? ' active' : ''}" onclick="fnCsToggleVal(this,'commondata')">Common Data</button>
              <button type="button" class="value-toggle-btn value-toggle-td${isTd ? ' active' : ''}" onclick="fnCsToggleVal(this,'testdata')">Test Data (Static)</button>
            </div>
            <input class="fm-input fn-cs-val-static" style="font-size:12px${valMode !== 'static' ? ';display:none' : ''}"
                   placeholder="${escHtml(valHint)}" value="${escHtml(valMode === 'static' ? (saved.value || '') : '')}" />
            <select class="fm-select fn-cs-val-dynamic" style="font-size:12.5px${!isDyn ? ';display:none' : ''}">${dynOpts}</select>
            <div class="fn-cs-val-cd" style="${isCd ? '' : 'display:none'}">
              <select class="fm-select fn-cs-cd-select" style="font-size:12.5px" onchange="fnCsCdSelected(this)"
                      data-saved-cd="${escHtml(isCd && saved.value ? saved.value.replace(/^\$\{|\}$/g, '') : '')}">
                <option value="">— loading Common Data… —</option>
              </select>
              ${isCd && saved.value
          ? `<div class="cd-token-preview">Reference: <code>${escHtml(saved.value)}</code></div>`
          : '<div class="cd-token-preview" style="display:none"></div>'}
            </div>
            <div class="fn-cs-val-td" style="${isTd ? '' : 'display:none'}">
              <div class="td-frame">
                <div class="td-frame-header">
                  <span style="font-size:11.5px;font-weight:700;color:var(--neutral-600)">Test Data</span>
                  <button type="button" class="tbl-btn" style="font-size:11px;padding:2px 8px" onclick="fnCsTdAddRow(this)">+ Add Row</button>
                </div>
                <table class="td-table">
                  <thead><tr><th style="width:28px">#</th><th>Value <span style="color:var(--danger)">*</span></th><th style="width:32px"></th></tr></thead>
                  <tbody class="fn-cs-td-tbody">${tdRows}</tbody>
                </table>
                <div class="td-info-row"><span>&#x2139;&#xFE0F; Each row = one test execution.</span></div>
              </div>
            </div>
          </div>` : ''}
        </div>`;
  }).join('')}
    </div>`;

  // Load CD options for any child step already set to commondata
  expandEl.querySelectorAll('.fn-child-row').forEach(childRow => {
    if (childRow.querySelector('.fn-cs-val-cd')) _loadFnCsOptions(childRow);
  });
}

function _toggleFnExpand(btn) {
  const childSteps = btn.closest('.se-fn-expand-area').querySelector('.fn-child-steps');
  if (!childSteps) return;
  const open = childSteps.style.display !== 'none';
  childSteps.style.display = open ? 'none' : '';
  btn.textContent = open
    ? btn.textContent.replace('▼', '▶')
    : btn.textContent.replace('▶', '▼');
}

// ── CALL FUNCTION child-step value helpers ────────────────────────────────────

function fnCsToggleVal(btn, mode) {
  const childRow = btn.closest('.fn-child-row');
  childRow.querySelectorAll('.value-toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  childRow.querySelector('.fn-cs-val-static')?.style && (childRow.querySelector('.fn-cs-val-static').style.display = mode === 'static' ? '' : 'none');
  childRow.querySelector('.fn-cs-val-dynamic')?.style && (childRow.querySelector('.fn-cs-val-dynamic').style.display = mode === 'dynamic' ? '' : 'none');
  childRow.querySelector('.fn-cs-val-cd')?.style && (childRow.querySelector('.fn-cs-val-cd').style.display = mode === 'commondata' ? '' : 'none');
  childRow.querySelector('.fn-cs-val-td')?.style && (childRow.querySelector('.fn-cs-val-td').style.display = mode === 'testdata' ? '' : 'none');
  if (mode === 'commondata') _loadFnCsOptions(childRow);
}

async function _loadFnCsOptions(childRow) {
  const sel = childRow.querySelector('.fn-cs-cd-select');
  if (!sel || !currentProjectId) return;
  const res = await fetch(`/api/common-data?projectId=${encodeURIComponent(currentProjectId)}`);
  if (!res.ok) return;
  const items = await res.json();
  const curVal = sel.dataset.savedCd || sel.value || '';
  sel.innerHTML = `<option value="">— select Common Data —</option>` +
    items.map(cd =>
      `<option value="${escHtml(cd.dataName)}" data-env="${escHtml(cd.environment)}"` +
      `${cd.dataName === curVal ? ' selected' : ''}>${escHtml(cd.dataName)}\u2002·\u2002${escHtml(cd.environment)}</option>`
    ).join('');
  sel.dataset.savedCd = '';
  _updateFnCsTokenPreview(childRow);
}

function fnCsCdSelected(sel) {
  _updateFnCsTokenPreview(sel.closest('.fn-child-row'));
}

function _updateFnCsTokenPreview(childRow) {
  const sel = childRow.querySelector('.fn-cs-cd-select');
  const preview = childRow.querySelector('.fn-cs-val-cd .cd-token-preview');
  if (!preview) return;
  const name = sel?.value || '';
  if (name) { preview.style.display = ''; preview.innerHTML = `Reference: <code>\${${escHtml(name)}}</code>`; }
  else preview.style.display = 'none';
}

function fnCsTdAddRow(btn) {
  const tbody = btn.closest('.td-frame').querySelector('.fn-cs-td-tbody');
  const rowNum = tbody.querySelectorAll('.fn-cs-td-row').length + 1;
  const tr = document.createElement('tr');
  tr.className = 'fn-cs-td-row';
  tr.innerHTML = `
    <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${rowNum}</td>
    <td><input class="fm-input fn-cs-td-val" style="font-size:12px;font-family:monospace" placeholder="value" /></td>
    <td><button type="button" class="step-action-btn step-del-icon" onclick="fnCsTdDelRow(this)" title="Delete row"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('.fn-cs-td-val').focus();
}

function fnCsTdDelRow(btn) {
  btn.closest('.fn-cs-td-row').remove();
  btn.closest('.fn-cs-td-tbody')?.querySelectorAll('.fn-cs-td-row').forEach((r, i) => {
    const numCell = r.querySelector('td:first-child');
    if (numCell) numCell.textContent = i + 1;
  });
}

function scriptStepRefreshFns(btn) {
  fnLoad().then(() => {
    const row = btn.closest('.script-step-row');
    _populateFnSelect(row);
  });
}

function scriptStepToggleVal(btn, mode) {
  const row = btn.closest('.script-step-row');
  row.querySelectorAll('.value-toggle-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  row.querySelector('.se-step-val-static')?.style && (row.querySelector('.se-step-val-static').style.display = mode === 'static' ? '' : 'none');
  row.querySelector('.se-step-val-dynamic')?.style && (row.querySelector('.se-step-val-dynamic').style.display = mode === 'dynamic' ? '' : 'none');
  row.querySelector('.se-step-val-cd')?.style && (row.querySelector('.se-step-val-cd').style.display = mode === 'commondata' ? '' : 'none');
  row.querySelector('.se-step-val-td')?.style && (row.querySelector('.se-step-val-td').style.display = mode === 'testdata' ? '' : 'none');
  row.querySelector('.se-step-val-var')?.style && (row.querySelector('.se-step-val-var').style.display = mode === 'variable' ? '' : 'none');
  if (mode === 'commondata') _loadCdOptions(row);
  if (mode === 'variable') _loadVarOptions(row);

  // Pin (Store As Variable) is not allowed when Value Source is Test Data (Static)
  const pinBtn = row.querySelector('.step-pin-icon');
  const pinBadge = row.querySelector('.step-pin-badge');
  if (mode === 'testdata') {
    // Disable pin button
    if (pinBtn) {
      pinBtn.disabled = true;
      pinBtn.classList.add('step-pin-disabled');
      pinBtn.title = 'Variable storage not allowed when Value Source is Test Data (Static)';
    }
    // Clear and hide any existing pin badge
    if (pinBadge) {
      pinBadge.dataset.storeAs = '';
      pinBadge.classList.add('step-pin-badge-hidden');
    }
  } else {
    // Re-enable pin button
    if (pinBtn) {
      pinBtn.disabled = false;
      pinBtn.classList.remove('step-pin-disabled');
      pinBtn.title = 'Save value as variable (📌 Pin)';
    }
    // Restore badge visibility if storeAs was previously set
    if (pinBadge && pinBadge.dataset.storeAs) {
      pinBadge.classList.remove('step-pin-badge-hidden');
    }
  }
}

// ── Variable tab helpers ───────────────────────────────────────────────────────

function _loadVarOptions(row) {
  const sel = row.querySelector('.se-step-var-select');
  if (!sel) return;
  const container = document.getElementById('se-steps-container');
  if (!container) return;
  const allRows = [...container.querySelectorAll('.script-step-row')];
  const thisIdx = allRows.indexOf(row);

  // Session vars — only from EARLIER steps in THIS script
  const sessionVars = [];
  for (let i = 0; i < thisIdx; i++) {
    const badge = allRows[i].querySelector('.step-pin-badge');
    if (badge && badge.dataset.storeAs && badge.dataset.storeScope !== 'global') {
      sessionVars.push(badge.dataset.storeAs);
    }
    const kw = allRows[i].querySelector('.se-step-kw-select')?.value || '';
    if (kw === 'SET VARIABLE') {
      const scope = allRows[i].querySelector('.se-setvar-scope:checked')?.value || 'session';
      if (scope !== 'global') {
        const n = allRows[i].querySelector('.se-setvar-name')?.value?.trim();
        if (n) sessionVars.push(n);
      }
    }
  }

  // Global vars — from ALL steps in ALL scripts (any index), storeScope === 'global'
  const globalVars = [];

  // 1. Scan DOM rows of the currently open editor (catches unsaved edits)
  allRows.forEach(r => {
    const badge = r.querySelector('.step-pin-badge');
    if (badge && badge.dataset.storeAs && badge.dataset.storeScope === 'global') {
      if (!globalVars.includes(badge.dataset.storeAs)) globalVars.push(badge.dataset.storeAs);
    }
    const kw = r.querySelector('.se-step-kw-select')?.value || '';
    if (kw === 'SET VARIABLE') {
      const scope = r.querySelector('.se-setvar-scope:checked')?.value || 'session';
      if (scope === 'global') {
        const n = r.querySelector('.se-setvar-name')?.value?.trim();
        if (n && !globalVars.includes(n)) globalVars.push(n);
      }
    }
  });

  // 2. Scan saved scripts in allScripts (catches global vars defined in other scripts)
  (allScripts || []).forEach(sc => {
    (sc.steps || []).forEach(step => {
      if (step.storeAs && step.storeScope === 'global') {
        if (!globalVars.includes(step.storeAs)) globalVars.push(step.storeAs);
      }
      if (step.keyword === 'SET VARIABLE' && step.storeScope === 'global' && step.storeAs) {
        if (!globalVars.includes(step.storeAs)) globalVars.push(step.storeAs);
      }
    });
  });

  const savedVal = sel.dataset.savedVar || sel.value || '';
  const noHint = row.querySelector('.var-no-vars-hint');
  const useHint = row.querySelector('.var-usage-hint');

  if (!sessionVars.length && !globalVars.length) {
    sel.innerHTML = '<option value="">— no variables yet —</option>';
    if (noHint) noHint.style.display = '';
    if (useHint) useHint.style.display = 'none';
    return;
  }
  if (noHint) noHint.style.display = 'none';

  let html = '<option value="">— pick a variable —</option>';
  if (sessionVars.length) {
    html += `<optgroup label="📌 This Script (session)">`;
    html += sessionVars.map(v => `<option value="${escHtml(v)}"${v === savedVal ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
    html += `</optgroup>`;
  }
  if (globalVars.length) {
    html += `<optgroup label="🌐 Suite — all scripts (global)">`;
    html += globalVars.map(v => `<option value="${escHtml(v)}"${v === savedVal ? ' selected' : ''}>${escHtml(v)}</option>`).join('');
    html += `</optgroup>`;
  }
  sel.innerHTML = html;
  sel.dataset.savedVar = '';
  _varSelectChanged(sel);
}

function _varSelectChanged(sel) {
  const row = sel.closest('.script-step-row');
  const hint = row?.querySelector('.var-usage-hint');
  const token = row?.querySelector('.var-usage-token');
  const v = sel.value;
  if (hint && token) {
    if (v) { token.textContent = `{{var.${v}}}`; hint.style.display = ''; }
    else { hint.style.display = 'none'; }
  }
}

// ── 📌 Pin icon handlers ───────────────────────────────────────────────────────

function scriptStepPinOpen(btn) {
  const row = btn.closest('.script-step-row');

  // Block pin when Value Source is Test Data (Static) — N rows would overwrite same variable unpredictably
  const isTestData = row.querySelector('.value-toggle-td.active') !== null;
  if (isTestData) {
    alert('Variable storage is not allowed when Value Source is "Test Data (Static)".\n\nReason: Test Data runs multiple rows — each row would overwrite the same variable, producing unpredictable results in later steps.');
    return;
  }

  const badge = row.querySelector('.step-pin-badge');
  const curName = badge?.dataset.storeAs || '';
  const curScope = badge?.dataset.storeScope || 'session';

  // Build inline modal
  const existing = document.getElementById('pin-modal-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pin-modal-overlay';
  overlay.innerHTML = `
    <div class="pin-modal-box">
      <div class="pin-modal-title">📌 Save Step Value as Variable</div>
      <div class="pin-modal-body">
        <label style="font-size:11px;font-weight:600">Variable Name</label>
        <input id="pin-modal-name" class="fm-input" style="font-size:13px;font-family:monospace;margin-top:4px"
               placeholder="e.g. patientId" value="${escHtml(curName)}" pattern="[A-Za-z0-9_]+" autocomplete="off"/>
        <div style="margin-top:10px">
          <label style="font-size:11px;font-weight:600;display:block;margin-bottom:6px">Scope</label>
          <div class="setvar-scope-toggle">
            <label class="setvar-scope-opt${curScope === 'session' ? ' active' : ''}">
              <input type="radio" name="pin-scope" value="session" ${curScope === 'session' ? 'checked' : ''}/> 📌 Session
              <span style="font-size:10px;display:block;color:var(--neutral-500);margin-top:2px">This script only</span>
            </label>
            <label class="setvar-scope-opt${curScope === 'global' ? ' active' : ''}">
              <input type="radio" name="pin-scope" value="global" ${curScope === 'global' ? 'checked' : ''}/> 🌐 Global
              <span style="font-size:10px;display:block;color:var(--neutral-500);margin-top:2px">All scripts in suite</span>
            </label>
          </div>
        </div>
      </div>
      <div class="pin-modal-actions">
        <button type="button" class="tbl-btn" id="pin-modal-cancel">Cancel</button>
        <button type="button" class="tbl-btn tbl-btn-primary" id="pin-modal-save">Save Variable</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Scope radio active style
  overlay.querySelectorAll('input[name="pin-scope"]').forEach(r => {
    r.addEventListener('change', () => {
      overlay.querySelectorAll('.setvar-scope-opt').forEach(l => l.classList.remove('active'));
      r.closest('.setvar-scope-opt')?.classList.add('active');
    });
  });

  document.getElementById('pin-modal-cancel').onclick = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('pin-modal-save').onclick = () => {
    const nameVal = document.getElementById('pin-modal-name').value.trim().replace(/[^A-Za-z0-9_]/g, '');
    const scopeVal = overlay.querySelector('input[name="pin-scope"]:checked')?.value || 'session';
    overlay.remove();
    if (!nameVal) { scriptStepPinClear(btn); return; }
    if (badge) {
      badge.dataset.storeAs = nameVal;
      badge.dataset.storeScope = scopeVal;
      const icon = scopeVal === 'global' ? '🌐' : '📌';
      const scopeTag = scopeVal === 'global' ? 'Global' : 'Session';
      badge.querySelector('.pin-badge-label').innerHTML =
        `${icon} Saved as <code>{{var.${escHtml(nameVal)}}}</code><span class="pin-scope-tag">${scopeTag}</span>`;
      badge.classList.remove('step-pin-badge-hidden');
      badge.classList.toggle('step-pin-badge-global', scopeVal === 'global');
    }
    btn.classList.add('step-pin-active');
    // Refresh all downstream steps currently in Variable mode so they pick up the new pin
    _refreshAllVarDropdowns();
  };

  // Focus the name input
  setTimeout(() => document.getElementById('pin-modal-name')?.focus(), 50);
}

function scriptStepPinClear(btn) {
  const row = btn.closest('.script-step-row');
  const badge = row.querySelector('.step-pin-badge');
  if (badge) {
    badge.dataset.storeAs = '';
    badge.dataset.storeScope = 'session';
    badge.classList.add('step-pin-badge-hidden');
    badge.classList.remove('step-pin-badge-global');
  }
  row.querySelector('.step-pin-icon')?.classList.remove('step-pin-active');
  // Refresh all downstream steps in Variable mode so they drop the cleared pin
  _refreshAllVarDropdowns();
}

// Refresh every step currently showing the Variable source panel — called after any pin change
function _refreshAllVarDropdowns() {
  document.querySelectorAll('#se-steps-container .script-step-row').forEach(r => {
    if (r.querySelector('.se-step-val-var') && r.querySelector('.se-step-val-var').style.display !== 'none') {
      _loadVarOptions(r);
    }
  });
}

// SET VARIABLE source change
function _setVarSourceChanged(sel) {
  const row = sel.closest('.script-step-row');
  const isAttr = sel.value === 'attr';
  const isJs = sel.value === 'js';
  const attrW = row.querySelector('.se-setvar-attr-wrap');
  const jsW = row.querySelector('.se-setvar-js-wrap');
  const locDiv = row.querySelector('.se-step-locator');
  if (attrW) attrW.style.display = isAttr ? '' : 'none';
  if (jsW) jsW.style.display = isJs ? '' : 'none';
  if (locDiv) locDiv.style.display = isJs ? 'none' : '';
}

function _setVarNameHint(inp) {
  const row = inp.closest('.script-step-row');
  const hint = row?.querySelector('.setvar-hint');
  const code = hint?.querySelector('code');
  if (!hint || !code) return;
  const v = inp.value.trim();
  if (v) { code.textContent = `{{var.${v}}}`; hint.style.display = 'block'; }
  else { hint.style.display = 'none'; }
}

function _setVarScopeChanged(radio) {
  const row = radio.closest('.script-step-row');
  const isGlobal = radio.value === 'global';
  // Update active style on scope labels
  row.querySelectorAll('.setvar-scope-opt').forEach(l => l.classList.remove('active'));
  radio.closest('.setvar-scope-opt')?.classList.add('active');
  // Update hint text
  const scopeHint = row.querySelector('.setvar-scope-hint');
  if (scopeHint) scopeHint.textContent = isGlobal
    ? ' — 🌐 visible across all scripts in this suite'
    : ' — 📌 visible only within this script';
}

// ── FILE CHOOSER widget ───────────────────────────────────────────────────────

function _fileChooserWidgetInit(row) {
  // Nothing to init — widget renders from step data at scriptAddStep time
}

async function scriptStepFileChooserUpload(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (!currentProjectId) { alert('Select a project first'); return; }

  const widget = input.closest('.se-filechooser-widget');
  const row = input.closest('.script-step-row');
  const uploadArea = widget.querySelector('.fc-upload-area');
  const fileInfo = widget.querySelector('.fc-file-info');
  const uploading = widget.querySelector('.fc-uploading');

  // Delete previous file from server if replacing
  const prevPath = fileInfo?.dataset.serverPath;
  if (prevPath) {
    const parts = prevPath.split('/');
    if (parts.length >= 3) {
      await fetch(`/api/test-files/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`, { method: 'DELETE' }).catch(() => { });
    }
  }

  // Show uploading state
  if (uploadArea) uploadArea.style.display = 'none';
  if (fileInfo) fileInfo.style.display = 'none';
  if (uploading) uploading.style.display = '';

  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/test-files/upload?projectId=${encodeURIComponent(currentProjectId)}`, { method: 'POST', body: fd });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();

    // Update widget to show file info
    if (fileInfo) {
      fileInfo.dataset.serverPath = data.serverPath;
      fileInfo.querySelector('.fc-filename').textContent = data.filename;
      fileInfo.querySelector('.fc-server-path').textContent = data.serverPath;
      fileInfo.style.display = '';
    }
    if (uploading) uploading.style.display = 'none';
    // Clear input so same file can be re-selected if needed
    input.value = '';
  } catch (err) {
    if (uploading) uploading.style.display = 'none';
    if (uploadArea) uploadArea.style.display = '';
    alert('Upload failed: ' + err.message);
  }
}

function scriptStepFileChooserReplace(btn) {
  // Trigger the hidden file input inside the replace button
  btn.querySelector('.fc-file-input')?.click();
}

async function scriptStepFileChooserRemove(btn) {
  if (!confirm('Remove this file from the server?')) return;
  const widget = btn.closest('.se-filechooser-widget');
  const fileInfo = widget.querySelector('.fc-file-info');
  const uploadArea = widget.querySelector('.fc-upload-area');
  const prevPath = fileInfo?.dataset.serverPath;

  if (prevPath) {
    const parts = prevPath.split('/');
    if (parts.length >= 3) {
      await fetch(`/api/test-files/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`, { method: 'DELETE' }).catch(() => { });
    }
  }
  if (fileInfo) { fileInfo.dataset.serverPath = ''; fileInfo.style.display = 'none'; }
  if (uploadArea) uploadArea.style.display = '';
}

// Populate Common Data dropdown for a step row
async function _loadCdOptions(row) {
  const sel = row.querySelector('.se-step-cd-select');
  if (!sel || !currentProjectId) return;
  const res = await fetch(`/api/common-data?projectId=${encodeURIComponent(currentProjectId)}`);
  if (!res.ok) return;
  const items = await res.json();
  const curVal = sel.dataset.savedCd || sel.value || '';
  sel.innerHTML = `<option value="">— select Common Data —</option>` +
    items.map(cd =>
      `<option value="${escHtml(cd.dataName)}" data-env="${escHtml(cd.environment)}"` +
      `${cd.dataName === curVal ? ' selected' : ''}>${escHtml(cd.dataName)}\u2002·\u2002${escHtml(cd.environment)}</option>`
    ).join('');
  sel.dataset.savedCd = '';
  // Update token preview
  _updateCdTokenPreview(row);
}

function scriptStepCdSelected(sel) {
  _updateCdTokenPreview(sel.closest('.script-step-row'));
}

function _updateCdTokenPreview(row) {
  const sel = row.querySelector('.se-step-cd-select');
  const preview = row.querySelector('.cd-token-preview');
  if (!preview) return;
  const name = sel?.value || '';
  if (name) {
    preview.style.display = '';
    preview.innerHTML = `Reference: <code>\${${escHtml(name)}}</code>`;
  } else {
    preview.style.display = 'none';
  }
}

// ── Test Data (Static) helpers ────────────────────────────────────────────

function scriptStepTdAddRow(btn) {
  const frame = btn.closest('.td-frame');
  const tbody = frame.querySelector('.td-tbody');
  const tr = document.createElement('tr');
  tr.className = 'td-row';
  const rowNum = frame.querySelectorAll('.td-row').length + 1;
  tr.innerHTML = `
    <td style="color:var(--neutral-400);font-size:11px;text-align:center;width:28px">${rowNum}</td>
    <td><input class="fm-input td-val" style="font-size:12px;font-family:monospace" placeholder="value" /></td>
    <td><button type="button" class="step-action-btn step-del-icon" onclick="scriptStepTdDelRow(this)" title="Delete row"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button></td>`;
  tbody.appendChild(tr);
  tr.querySelector('.td-val').focus();
}

function scriptStepTdDelRow(btn) {
  btn.closest('.td-row').remove();
  // Renumber remaining rows
  btn.closest('.td-tbody')?.querySelectorAll('.td-row').forEach((r, i) => {
    const numCell = r.querySelector('td:first-child');
    if (numCell) numCell.textContent = i + 1;
  });
}

// Collect and validate testData rows for all steps — returns error string or null
function _validateTestDataKeys(allRows) {
  const seen = new Map(); // key → stepIndex
  for (const { stepIdx, key } of allRows) {
    if (!key.trim()) return `Step ${stepIdx + 1}: Test Data key cannot be empty.`;
    if (seen.has(key.trim())) {
      return `Duplicate Test Data key "${key.trim()}" — found in step ${seen.get(key.trim()) + 1} and step ${stepIdx + 1}. Keys must be unique across the entire script.`;
    }
    seen.set(key.trim(), stepIdx);
  }
  return null;
}

function scriptStepPickLoc(btn) {
  const row = btn.closest('.script-step-row');
  locatorPickerOpen((selector, selectorType, name) => {
    const nameInput = row.querySelector('.se-step-loc-name');
    const valInput = row.querySelector('.se-step-selector');
    const typeSelect = row.querySelector('.se-step-loc-type');
    if (nameInput) nameInput.value = name || '';
    if (valInput) valInput.value = selector || '';
    if (typeSelect && selectorType) typeSelect.value = selectorType;
    // Lock fields as read-only (inherited from Locator Repo)
    _scriptStepLockLocator(row, true);
  });
}

function _scriptStepLockLocator(row, locked) {
  const nameInput = row.querySelector('.se-step-loc-name');
  const valInput = row.querySelector('.se-step-selector');
  const typeSelect = row.querySelector('.se-step-loc-type');
  const lockBadge = row.querySelector('.loc-repo-badge');
  const unlockBtn = row.querySelector('.loc-unlock-btn');
  if (nameInput) { nameInput.readOnly = locked; nameInput.classList.toggle('loc-locked', locked); }
  if (valInput) { valInput.readOnly = locked; valInput.classList.toggle('loc-locked', locked); }
  if (typeSelect) { typeSelect.disabled = locked; typeSelect.classList.toggle('loc-locked', locked); }
  if (lockBadge) lockBadge.style.display = locked ? '' : 'none';
  if (unlockBtn) unlockBtn.style.display = locked ? '' : 'none';
}

function scriptStepUnlockLoc(btn) {
  const row = btn.closest('.script-step-row');
  _scriptStepLockLocator(row, false);
}

function scriptStepDelete(btn) {
  btn.closest('.script-step-row').remove();
  scriptReorderNums();
  if (!document.querySelectorAll('#se-steps-container .script-step-row').length)
    document.getElementById('se-steps-hint').style.display = '';
}

function scriptStepMoveUp(btn) {
  const row = btn.closest('.script-step-row');
  const prev = row.previousElementSibling;
  if (prev && prev.classList.contains('script-step-row')) {
    row.parentElement.insertBefore(row, prev);
    scriptReorderNums();
  }
}

function scriptStepMoveDown(btn) {
  const row = btn.closest('.script-step-row');
  const next = row.nextElementSibling;
  if (next && next.classList.contains('script-step-row')) {
    row.parentElement.insertBefore(next, row);
    scriptReorderNums();
  }
}

function scriptStepInsertBelow(btn) {
  const row = btn.closest('.script-step-row');
  // nextSibling = insert after this row; null = append at end (last step)
  scriptAddStep({}, row.nextSibling);
}

function scriptStepClone(btn) {
  const row = btn.closest('.script-step-row');
  const activeTab = row.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
  const kw = row.querySelector('.se-step-kw-select')?.value || '';
  const isFnCall = kw === 'CALL FUNCTION';
  let valueMode, value, fnStepValues;
  if (isFnCall) {
    valueMode = 'static';
    value = row.querySelector('.se-step-fn-select')?.value || null;
    fnStepValues = [...(row.querySelectorAll('.fn-child-row') || [])]
      .filter(cr => cr.querySelector('.fn-cs-value'))
      .map(cr => {
        const fi = parseInt(cr.dataset.fnStepIdx);
        const activeCs = cr.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
        let csMode, csValue, csTestData = [];
        if (activeCs === 'Dynamic') {
          csMode = 'dynamic';
          csValue = cr.querySelector('.fn-cs-val-dynamic')?.value || null;
        } else if (activeCs === 'Common Data') {
          csMode = 'commondata';
          const cdName = cr.querySelector('.fn-cs-cd-select')?.value || '';
          csValue = cdName ? `\${${cdName}}` : null;
        } else if (activeCs === 'Test Data (Static)') {
          csMode = 'testdata';
          csValue = null;
          csTestData = [...(cr.querySelectorAll('.fn-cs-td-row') || [])].map(tr => ({
            value: tr.querySelector('.fn-cs-td-val')?.value?.trim() || '',
          })).filter(r => r.value);
        } else {
          csMode = 'static';
          csValue = cr.querySelector('.fn-cs-val-static')?.value?.trim() || null;
        }
        return { fnStepIdx: fi, valueMode: csMode, value: csValue, testData: csTestData };
      });
  } else if (activeTab === '📌 Variable') {
    valueMode = 'variable';
    value = row.querySelector('.se-step-var-select')?.value || null;
  } else if (activeTab === 'Dynamic') {
    valueMode = 'dynamic';
    value = row.querySelector('.se-step-val-dynamic')?.value || null;
  } else if (activeTab === 'Common Data') {
    valueMode = 'commondata';
    const cdName = row.querySelector('.se-step-cd-select')?.value || '';
    value = cdName ? `\${${cdName}}` : null;
  } else if (activeTab === 'Test Data (Static)') {
    valueMode = 'testdata';
    value = null;
  } else {
    valueMode = 'static';
    value = row.querySelector('.se-step-val-static')?.value?.trim() || null;
  }
  const testData = [...(row.querySelectorAll('.td-row') || [])].map(tr => ({
    value: tr.querySelector('.td-val')?.value?.trim() || '',
  })).filter(r => r.value);

  const badge = row.querySelector('.step-pin-badge');
  const clonedStep = {
    id: `clone-${Date.now()}`,
    keyword: kw,
    locatorName: row.querySelector('.se-step-loc-name')?.value?.trim() || null,
    locatorType: row.querySelector('.se-step-loc-type')?.value || 'css',
    locator: row.querySelector('.se-step-selector')?.value?.trim() || null,
    locatorId: row.dataset.locatorId || null,
    valueMode,
    value,
    testData,
    fnStepValues: fnStepValues || [],
    description: row.querySelector('.se-step-desc')?.value?.trim() || '',
    screenshot: row.querySelector('.se-step-screenshot')?.checked || false,
    storeAs: badge?.dataset.storeAs || undefined,
    storeScope: badge?.dataset.storeAs ? (badge.dataset.storeScope || 'session') : undefined,
    storeSource: row.querySelector('.se-setvar-source')?.value || undefined,
    storeAttrName: row.querySelector('.se-setvar-attr')?.value?.trim() || undefined,
  };
  scriptAddStep(clonedStep, row.nextSibling);
}

function scriptReorderNums() {
  document.querySelectorAll('#se-steps-container .script-step-row').forEach((row, i) => {
    const n = row.querySelector('.step-num');
    if (n) n.textContent = i + 1;
  });
}

async function scriptSave() {
  modClearAlert('script-editor-alert');
  const title = document.getElementById('se-title').value.trim();
  if (!title) { modAlert('script-editor-alert', 'error', 'Title is required'); return; }
  if (!currentProjectId) { modAlert('script-editor-alert', 'error', 'Select a project first'); return; }

  const steps = [...document.querySelectorAll('#se-steps-container .script-step-row')].map((row, i) => {
    const activeTab = row.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
    const kw = row.querySelector('.se-step-kw-select')?.value || '';
    const isFnCall = kw === 'CALL FUNCTION';
    const isFileChooser = kw === 'FILE CHOOSER';
    let valueMode, value, fnStepValues;
    if (isFileChooser) {
      valueMode = 'static';
      value = row.querySelector('.fc-file-info')?.dataset.serverPath || null;
    } else if (isFnCall) {
      valueMode = 'static';
      value = row.querySelector('.se-step-fn-select')?.value || null;
      fnStepValues = [...(row.querySelectorAll('.fn-child-row') || [])]
        .filter(cr => cr.querySelector('.fn-cs-value'))
        .map(cr => {
          const fi = parseInt(cr.dataset.fnStepIdx);
          const activeCs = cr.querySelector('.value-toggle-btn.active')?.textContent?.trim() || 'Static';
          let csMode, csValue, csTestData = [];
          if (activeCs === 'Dynamic') {
            csMode = 'dynamic';
            csValue = cr.querySelector('.fn-cs-val-dynamic')?.value || null;
          } else if (activeCs === 'Common Data') {
            csMode = 'commondata';
            const cdName = cr.querySelector('.fn-cs-cd-select')?.value || '';
            csValue = cdName ? `\${${cdName}}` : null;
          } else if (activeCs === 'Test Data (Static)') {
            csMode = 'testdata';
            csValue = null;
            csTestData = [...(cr.querySelectorAll('.fn-cs-td-row') || [])].map(tr => ({
              value: tr.querySelector('.fn-cs-td-val')?.value?.trim() || '',
            })).filter(r => r.value);
          } else {
            csMode = 'static';
            csValue = cr.querySelector('.fn-cs-val-static')?.value?.trim() || null;
          }
          return { fnStepIdx: fi, valueMode: csMode, value: csValue, testData: csTestData };
        });
    } else if (activeTab === '📌 Variable') {
      valueMode = 'variable';
      value = row.querySelector('.se-step-var-select')?.value || null;
    } else if (activeTab === 'Dynamic') {
      valueMode = 'dynamic';
      value = row.querySelector('.se-step-val-dynamic')?.value || null;
    } else if (activeTab === 'Common Data') {
      valueMode = 'commondata';
      const cdName = row.querySelector('.se-step-cd-select')?.value || '';
      value = cdName ? `\${${cdName}}` : null;
    } else if (activeTab === 'Test Data (Static)') {
      valueMode = 'testdata';
      value = null;
    } else {
      valueMode = 'static';
      value = row.querySelector('.se-step-val-static')?.value?.trim() || null;
    }

    // SET VARIABLE — override value with JS expression if source=js
    const isSetVar = kw === 'SET VARIABLE';
    const storeSource = isSetVar ? (row.querySelector('.se-setvar-source')?.value || 'text') : undefined;
    if (isSetVar && storeSource === 'js') {
      value = row.querySelector('.se-setvar-js-wrap .se-step-val-static')?.value?.trim() || null;
    }

    // Collect testData rows
    const testData = [...(row.querySelectorAll('.td-row') || [])].map(tr => ({
      value: tr.querySelector('.td-val')?.value?.trim() || '',
    })).filter(r => r.value);

    // 📌 Pin fields
    const badge = row.querySelector('.step-pin-badge');
    const storeAs = badge?.dataset.storeAs || undefined;
    const storeAttr = isSetVar ? (row.querySelector('.se-setvar-attr')?.value?.trim() || undefined) : undefined;
    const storeVarName = isSetVar ? (row.querySelector('.se-setvar-name')?.value?.trim() || undefined) : storeAs;

    return {
      id: row.dataset.stepId || `step-${i + 1}`,
      order: i + 1,
      keyword: kw,
      locatorName: row.querySelector('.se-step-loc-name')?.value?.trim() || null,
      locatorType: row.querySelector('.se-step-loc-type')?.value || 'css',
      locator: row.querySelector('.se-step-selector')?.value?.trim() || null,
      // OLD: locatorId: null,  // was always null — prevented T2 healing from finding alternatives
      locatorId: row.dataset.locatorId || null,
      valueMode,
      value,
      testData,
      fnStepValues: fnStepValues || [],
      description: row.querySelector('.se-step-desc')?.value?.trim() || '',
      screenshot: row.querySelector('.se-step-screenshot')?.checked || false,
      storeAs: isSetVar ? storeVarName : (storeAs || undefined),
      storeScope: isSetVar
        ? (row.querySelector('.se-setvar-scope:checked')?.value || 'session')
        : (storeAs ? (badge?.dataset.storeScope || 'session') : undefined),
      storeSource: isSetVar ? storeSource : undefined,
      storeAttrName: storeAttr || undefined,
      vrtOptions: kw === 'ASSERT VISUAL' ? _seCollectVrtOptions(row) : undefined,
    };
  });

  // Validate: each testdata step must have at least one value row
  const emptyTdStep = steps.findIndex(s => s.valueMode === 'testdata' && !(s.testData || []).length);
  if (emptyTdStep !== -1) { modAlert('script-editor-alert', 'error', `Step ${emptyTdStep + 1}: Test Data (Static) requires at least one value row.`); return; }

  const tags = document.getElementById('se-tags').value.split(',').map(t => t.trim()).filter(Boolean);
  const subcompVal = document.getElementById('se-subcomponent')?.value || '';
  const body = {
    projectId: currentProjectId, title,
    component: document.getElementById('se-component').value,
    subcomponent: subcompVal || undefined,
    description: document.getElementById('se-desc').value.trim(),
    tags, priority: document.getElementById('se-priority').value, steps,
  };
  const method = editingScriptId ? 'PUT' : 'POST';
  const url = editingScriptId ? `/api/scripts/${editingScriptId}` : '/api/scripts';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('script-editor-alert', 'error', data.error || 'Error saving script'); return; }

  // Close editor + refresh list immediately — don't wait for locator sync
  const stepsForSync = steps;
  const savedScriptId = editingScriptId || data.id; // capture before scriptEditorClose() nulls it
  _syncFailedLocators.clear();
  scriptEditorClose();
  await scriptLoad();

  // Background locator sync — surfaces failures as banner + step badges on re-open
  // Also patches locatorId back onto each step so T2 self-healing can find alternatives at codegen time
  _syncLocatorsToRepo(stepsForSync).then(({ failed, selectorToId }) => {
    if (failed.length) {
      _syncFailedLocators = new Set(failed);
      _showSyncFailBanner(failed, 'script');
    }
    // Patch locatorId back onto saved steps — only if any were resolved
    if (selectorToId.size > 0 && savedScriptId) {
      const patchedSteps = stepsForSync.map(s =>
        s.locator && selectorToId.has(s.locator)
          ? { ...s, locatorId: selectorToId.get(s.locator) }
          : s
      );
      const anyChanged = patchedSteps.some((s, i) => s.locatorId !== stepsForSync[i].locatorId);
      if (anyChanged) {
        fetch(`/api/scripts/${savedScriptId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ steps: patchedSteps }),
        }).catch(() => { });
      }
    }
  }).catch(() => { });
}

async function _syncLocatorsToRepo(steps) {
  if (!currentProjectId) return { failed: [], selectorToId: new Map() }; // never save unscoped locators
  const failed = [];
  // selector → locatorId — returned so caller can patch locatorId back onto steps
  const selectorToId = new Map();

  // Dedup: one entry per unique selector — prevents parallel duplicate creation
  const seen = new Map(); // selector -> step
  for (const step of steps) {
    if (step.locatorName && step.locator && !seen.has(step.locator)) {
      seen.set(step.locator, step);
    }
  }
  const uniqueSteps = Array.from(seen.values());

  // Fetch ALL locators for this project including draft=true (recorder-captured ones)
  // so we can promote them instead of creating bare duplicates
  let allWithDraft = [];
  try {
    const r = await fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}&includeDraft=true`);
    allWithDraft = r.ok ? await r.json() : [];
  } catch { allWithDraft = []; }

  // Sequential to avoid race conditions
  for (const step of uniqueSteps) {
    try {
      // Match by selector+selectorType (finds draft recorder-created locators with alternatives)
      // then fall back to name match
      const existing =
        allWithDraft.find(l => l.selector === step.locator && l.selectorType === step.locatorType) ||
        allWithDraft.find(l => l.name === step.locatorName);

      if (existing) {
        // Promote draft → live, preserving all alternatives and healingProfile
        const needsUpdate = existing.draft === true ||
          existing.selector !== step.locator ||
          existing.selectorType !== step.locatorType;
        if (needsUpdate) {
          const res = await fetch(`/api/locators/${existing.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ draft: false }),
          });
          if (!res.ok) failed.push(step.locatorName);
          else allWithDraft = allWithDraft.map(l => l.id === existing.id ? { ...l, draft: false } : l);
        }
        selectorToId.set(step.locator, existing.id);
      } else {
        // No recorder-captured locator exists — create bare one as fallback
        const res = await fetch('/api/locators', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: step.locatorName,
            selector: step.locator,
            selectorType: step.locatorType,
            projectId: currentProjectId || null,
            pageModule: '',
            description: `Auto-synced from step: ${step.description || ''}`.trim(),
          }),
        });
        if (!res.ok) {
          failed.push(step.locatorName);
        } else {
          const created = await res.clone().json().catch(() => null);
          if (created?.id) {
            allWithDraft = [...allWithDraft, created];
            selectorToId.set(step.locator, created.id);
          }
        }
      }
    } catch {
      failed.push(step.locatorName);
    }
  }

  try { await locatorLoadScoped(); } catch { /* non-fatal */ }
  return { failed, selectorToId };
}

function _showSyncFailBanner(failedNames, context) {
  // Remove any stale banner first
  document.getElementById('locator-sync-fail-banner')?.remove();

  const count = failedNames.length;
  const names = failedNames.map(n => `<strong>${escHtml(n)}</strong>`).join(', ');
  const subject = context === 'function' ? 'Function' : 'Script';
  const panelId = context === 'function' ? 'panel-functions' : 'panel-scripts';

  const banner = document.createElement('div');
  banner.id = 'locator-sync-fail-banner';
  banner.className = 'sync-fail-banner';
  banner.innerHTML = `
    <span class="sync-fail-icon">⚠</span>
    <span class="sync-fail-msg">
      ${subject} saved — <strong>${count}</strong> locator${count > 1 ? 's' : ''} failed to sync to Locator Repository: ${names}.
      Open the <strong>Locator Repository</strong> tab to add ${count > 1 ? 'them' : 'it'} manually,
      or re-open this ${subject.toLowerCase()} to see the affected step${count > 1 ? 's' : ''} highlighted.
    </span>
    <button class="sync-fail-close" onclick="this.closest('.sync-fail-banner').remove()" title="Dismiss">✕</button>`;

  const panel = document.getElementById(panelId);
  if (panel) panel.prepend(banner);
}

async function scriptClone(id) {
  const res  = await fetch(`/api/scripts/${id}/clone`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#991b1b;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
    toast.textContent = '✗ ' + (data.error || 'Clone failed');
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
    return;
  }
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#166534;color:#fff;padding:12px 20px;border-radius:8px;font-size:13px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.3)';
  toast.textContent = `✓ Cloned as ${data.tcId}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
  await scriptLoad();
}

async function scriptDelete(id, title) {
  if (!confirm(`Delete script "${title}"? This cannot be undone.`)) return;
  await fetch(`/api/scripts/${id}`, { method: 'DELETE' });
  await scriptLoad();
}

// ══════════════════════════════════════════════════════════════════════════════

// ── NL Bulk Suggest Panel ──────────────────────────────────────────────────

let _nlBulkResults = [];

async function nlSuggestSteps() {
  const input = document.getElementById('nl-input');
  const statusEl = document.getElementById('nl-status');
  const resultsEl = document.getElementById('nl-results');
  const noAiHint = document.getElementById('nl-no-ai-hint');
  const aiBadge = document.getElementById('nl-ai-badge');
  const ruleBadge = document.getElementById('nl-rule-badge');

  if (!input || !input.value.trim()) return;

  statusEl.textContent = '⏳ Thinking…';
  document.getElementById('nl-suggest-btn').disabled = true;
  resultsEl.innerHTML = '';
  _nlBulkResults = [];
  ['nl-apply-all-btn', 'nl-apply-matched-btn', 'nl-clear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

  try {
    const res = await fetch('/api/nl/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.value.trim(), projectId: currentProjectId || '' }),
    });
    const data = await res.json();

    if (!res.ok || data.error) {
      statusEl.textContent = '✗ ' + (data.error || 'Error');
      statusEl.style.color = '#f48771';
      return;
    }

    _nlBulkResults = data.steps || [];
    const hasAi = _nlBulkResults.some(s => s.source === 'ai');
    const hasMatched = _nlBulkResults.some(s => s.matched);

    if (aiBadge) aiBadge.style.display = hasAi ? '' : 'none';
    if (ruleBadge) ruleBadge.style.display = hasAi ? 'none' : '';
    if (noAiHint) noAiHint.style.display = (!hasAi && data.meta && !data.meta.provider) ? '' : 'none';

    statusEl.textContent = `${_nlBulkResults.length} step${_nlBulkResults.length !== 1 ? 's' : ''} suggested`;
    statusEl.style.color = '';

    resultsEl.innerHTML = _nlBulkResults.map((s, i) => `
      <div class="nl-result-row" style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border,#2a2b2e)">
        <input type="checkbox" id="nl-check-${i}" checked style="flex-shrink:0" />
        <span style="flex:1;font-size:12px;color:var(--text,#e0e0e0)">${_escHtml(s.originalSentence || '')}</span>
        <span style="font-size:11px;color:var(--neutral-500);white-space:nowrap">${_escHtml(s.keyword || '—')}</span>
        <span style="font-size:11px;color:${s.matched ? '#4ec9b0' : 'var(--neutral-500)'};white-space:nowrap">${s.matched ? '✓' : '?'}</span>
      </div>
    `).join('');

    ['nl-apply-all-btn', 'nl-clear'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = '';
    });
    if (hasMatched) {
      const mb = document.getElementById('nl-apply-matched-btn');
      if (mb) mb.style.display = '';
    }
  } catch (e) {
    statusEl.textContent = '✗ Network error';
    statusEl.style.color = '#f48771';
  } finally {
    document.getElementById('nl-suggest-btn').disabled = false;
  }
}

function nlApplyAll() {
  if (!_nlBulkResults.length) return;
  const container = document.getElementById('se-steps-container');
  _nlBulkResults.forEach(s => {
    scriptAddStep({ keyword: s.keyword || '', locatorName: s.locatorName || '', value: s.value || '' });
    if (s.locatorName) {
      const row = container.querySelector('.script-step-row:last-child');
      if (row) _seResolveLocName(row, s.locatorName);
    }
  });
  nlClearSuggestions();
}

function nlApplyMatched() {
  if (!_nlBulkResults.length) return;
  const container = document.getElementById('se-steps-container');
  _nlBulkResults
    .filter((s, i) => {
      const cb = document.getElementById('nl-check-' + i);
      return s.matched && (!cb || cb.checked);
    })
    .forEach(s => {
      scriptAddStep({ keyword: s.keyword || '', locatorName: s.locatorName || '', value: s.value || '' });
      if (s.locatorName) {
        const row = container.querySelector('.script-step-row:last-child');
        if (row) _seResolveLocName(row, s.locatorName);
      }
    });
  nlClearSuggestions();
}

function nlClearSuggestions() {
  _nlBulkResults = [];
  const resultsEl = document.getElementById('nl-results');
  if (resultsEl) resultsEl.innerHTML = '';
  const statusEl = document.getElementById('nl-status');
  if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
  ['nl-apply-all-btn', 'nl-apply-matched-btn', 'nl-clear'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const noAiHint = document.getElementById('nl-no-ai-hint');
  if (noAiHint) noAiHint.style.display = 'none';
}
