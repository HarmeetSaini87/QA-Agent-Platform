let editingCdId = null;
let allCommonData = [];
let _cdPage = 0;
const CD_PAGE_SIZE = 10;

function _cdPopulateEnvDropdowns() {
  const proj = _currentProjectData();
  const envs = proj?.environments || [];
  const opts = envs.map(e => `<option value="${escHtml(e.name)}" data-url="${escHtml(e.url || '')}">${escHtml(e.name)}</option>`).join('');

  const filter = document.getElementById('cd-env-filter');
  if (filter) { filter.innerHTML = '<option value="">All Environments</option>' + opts; }

  const modal = document.getElementById('cd-env');
  if (modal) { modal.innerHTML = '<option value="">— Select Environment —</option>' + opts; }

  // clear URL hints on project switch
  const fu = document.getElementById('cd-env-filter-url');
  if (fu) fu.textContent = '';
  const mu = document.getElementById('cd-env-url');
  if (mu) mu.textContent = '';
}

function _cdShowEnvUrl(selectId, labelId) {
  const sel = document.getElementById(selectId);
  const lbl = document.getElementById(labelId);
  if (!sel || !lbl) return;
  const opt = sel.options[sel.selectedIndex];
  const url = opt?.dataset?.url || '';
  lbl.textContent = url || '';
}

async function cdLoad() {
  const tbody = document.getElementById('cd-tbody');
  if (!tbody) return;
  if (!currentProjectId) {
    allCommonData = [];
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:20px">Select a project first.</td></tr>';
    document.getElementById('cd-pagination').innerHTML = '';
    return;
  }
  const env = document.getElementById('cd-env-filter')?.value || '';
  const mod = document.getElementById('cd-module-filter')?.value || '';
  const qs = `?projectId=${encodeURIComponent(currentProjectId)}${env ? '&environment=' + encodeURIComponent(env) : ''}${mod ? '&moduleType=' + encodeURIComponent(mod) : ''}`;
  const res = await fetch(`/api/common-data${qs}`);
  allCommonData = await res.json();
  _cdPage = 0;
  cdRender();
}

function cdRender() {
  const tbody = document.getElementById('cd-tbody');
  const pgEl = document.getElementById('cd-pagination');
  if (!tbody) return;
  const list = allCommonData;
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:24px">No data entries yet. Click <strong>+ Add Common Data</strong> to create one.</td></tr>';
    if (pgEl) pgEl.innerHTML = '';
    return;
  }
  const totalPages = Math.max(1, Math.ceil(list.length / CD_PAGE_SIZE));
  if (_cdPage >= totalPages) _cdPage = totalPages - 1;
  const page = list.slice(_cdPage * CD_PAGE_SIZE, (_cdPage + 1) * CD_PAGE_SIZE);
  tbody.innerHTML = page.map(d => `
    <tr>
      <td title="${escHtml('\${' + d.dataName + '}')}" ><code style="background:var(--neutral-100);padding:2px 6px;border-radius:3px;font-size:12.5px">\${${escHtml(d.dataName)}}</code></td>
      <td>
        ${d.sensitive
      ? `<span class="cd-masked-wrap" data-id="${escHtml(d.id)}" style="display:inline-flex;align-items:center;gap:6px">
               <span class="cd-masked-dots" style="letter-spacing:2px;color:var(--neutral-400);font-size:13px">••••••••</span>
               <button class="tbl-btn cd-eye-btn" style="font-size:14px;padding:1px 5px;line-height:1;min-width:26px" title="Show value" onclick="cdToggleReveal(this)">👁</button>
             </span>`
      : `<span title="${escHtml(d.value)}">${escHtml(d.value)}</span>`}
      </td>
      <td><span class="badge badge-${(d.moduleType||'shared') === 'api' ? 'active' : (d.moduleType||'shared') === 'ui' ? 'medium' : 'neutral'}">${(d.moduleType||'shared') === 'api' ? 'API' : (d.moduleType||'shared') === 'ui' ? 'UI / Web' : 'Shared'}</span></td>
      <td><span class="badge badge-${d.environment === 'PROD' ? 'fail' : d.environment === 'UAT' ? 'medium' : 'active'}">${escHtml(d.environment)}</span></td>
      <td>${escHtml(d.createdBy || '—')}</td>
      <td>${formatDate(d.createdAt)}</td>
      <td>
        ${isViewer() ? '' : `<button class="tbl-btn" onclick="cdEdit('${escHtml(d.id)}')">Edit</button>`}
        ${isViewer() ? '' : `<button class="tbl-btn del" onclick="cdDelete('${escHtml(d.id)}','${escHtml(d.dataName)}')">Delete</button>`}
      </td>
    </tr>`).join('');
  if (pgEl) {
    const start = list.length ? _cdPage * CD_PAGE_SIZE + 1 : 0;
    const end = Math.min((_cdPage + 1) * CD_PAGE_SIZE, list.length);
    pgEl.innerHTML = totalPages <= 1 ? '' : `
      <button class="tbl-btn" onclick="_cdPageGo(-1)" ${_cdPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span>Page ${_cdPage + 1} / ${totalPages} &nbsp;(${start}–${end} of ${list.length})</span>
      <button class="tbl-btn" onclick="_cdPageGo(1)" ${_cdPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`;
  }
}

function _cdPageGo(delta) { _cdPage += delta; cdRender(); }

function cdOpenModal(id = null) {
  editingCdId = id;
  modClearAlert('cd-modal-alert');
  document.getElementById('cd-modal-title').textContent = id ? 'Edit Common Data' : 'Add Common Data';
  if (!id) {
    document.getElementById('cd-name').value = '';
    document.getElementById('cd-value').value = '';
    document.getElementById('cd-env').value = '';
    const mu = document.getElementById('cd-env-url'); if (mu) mu.textContent = '';
    const modEl = document.getElementById('cd-module');
    if (modEl) modEl.value = 'shared';
    const sensEl = document.getElementById('cd-sensitive');
    if (sensEl) sensEl.checked = false;
  }
  openModal('modal-common-data');
}

async function cdEdit(id) {
  const env = document.getElementById('cd-env-filter')?.value || '';
  const qs = `?projectId=${encodeURIComponent(currentProjectId)}${env ? '&environment=' + encodeURIComponent(env) : ''}`;
  const res = await fetch(`/api/common-data${qs}`);
  const list = await res.json();
  const d = list.find(x => x.id === id);
  if (!d) return;
  editingCdId = id;
  document.getElementById('cd-modal-title').textContent = 'Edit Common Data';
  document.getElementById('cd-name').value = d.dataName;
  // Sensitive values show placeholder — user must re-type to change, or leave to keep existing
  document.getElementById('cd-value').value = d.sensitive ? '' : d.value;
  document.getElementById('cd-value').placeholder = d.sensitive ? 'Leave blank to keep existing value' : '';
  document.getElementById('cd-env').value = d.environment;
  _cdShowEnvUrl('cd-env', 'cd-env-url');
  const modEl = document.getElementById('cd-module');
  if (modEl) modEl.value = d.moduleType || 'shared';
  const sensEl = document.getElementById('cd-sensitive');
  if (sensEl) sensEl.checked = !!d.sensitive;
  modClearAlert('cd-modal-alert');
  openModal('modal-common-data');
}

async function cdSave() {
  modClearAlert('cd-modal-alert');
  const dataName = document.getElementById('cd-name').value.trim();
  const value = document.getElementById('cd-value').value.trim();
  const environment = document.getElementById('cd-env').value;
  const sensitive = !!(document.getElementById('cd-sensitive')?.checked);
  const moduleType = document.getElementById('cd-module')?.value || 'shared';
  if (!dataName) { modAlert('cd-modal-alert', 'error', 'Data Name is required'); return; }
  if (!environment) { modAlert('cd-modal-alert', 'error', 'Environment is required'); return; }
  if (!currentProjectId) { modAlert('cd-modal-alert', 'error', 'Select a project first'); return; }
  // On edit of sensitive entry: if value blank, omit it — server keeps existing encrypted value
  const body = {
    projectId: currentProjectId, dataName, environment, sensitive, moduleType,
    ...(value || !editingCdId ? { value } : {})
  };
  const method = editingCdId ? 'PUT' : 'POST';
  const url = editingCdId ? `/api/common-data/${editingCdId}` : '/api/common-data';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('cd-modal-alert', 'error', data.error || 'Error saving'); return; }
  cdCloseModal();
  await cdLoad();
}

async function cdToggleReveal(btn) {
  const wrap = btn.closest('.cd-masked-wrap');
  const dotsEl = wrap.querySelector('.cd-masked-dots');
  const plainEl = wrap.querySelector('.cd-plain-value');
  const id = wrap.dataset.id;

  // If already revealed — hide it
  if (plainEl) {
    plainEl.remove();
    dotsEl.style.display = '';
    btn.title = 'Show value';
    btn.textContent = '👁';
    clearTimeout(wrap._hideTimer);
    return;
  }

  // Fetch and reveal
  btn.disabled = true;
  const res = await fetch(`/api/common-data/${id}/reveal`);
  btn.disabled = false;
  if (!res.ok) { alert('Could not reveal value'); return; }
  const { value } = await res.json();

  dotsEl.style.display = 'none';
  btn.title = 'Hide value';
  btn.textContent = '🙈';

  const span = document.createElement('span');
  span.className = 'cd-plain-value';
  span.style.cssText = 'font-family:monospace;font-size:12px;background:var(--neutral-100);padding:2px 6px;border-radius:3px';
  span.textContent = value;
  wrap.insertBefore(span, btn);

  // Auto-hide after 15 seconds
  clearTimeout(wrap._hideTimer);
  wrap._hideTimer = setTimeout(() => {
    if (wrap.querySelector('.cd-plain-value')) cdToggleReveal(btn);
  }, 15000);
}

async function cdDelete(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  await fetch(`/api/common-data/${id}`, { method: 'DELETE' });
  await cdLoad();
}

function cdCloseModal() { closeModal('modal-common-data'); editingCdId = null; }

// ══════════════════════════════════════════════════════════════════════════════

let editingProjectId = null;

async function projLoad() {
  const url = currentUser?.role === 'admin' ? '/api/projects/all' : '/api/projects';
  const res = await fetch(url);
  const list = await res.json();
  const el = document.getElementById('proj-list');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="builder-hint">No projects yet. Click <strong>+ New Project</strong> to create one.</div>'; return; }

  el.innerHTML = list.map(p => {
    const envs = (p.environments || []);
    return `
    <div class="project-card">
      <div class="project-card-header">
        <div style="flex:1">
          <div class="project-name">${escHtml(p.name)}</div>
          ${p.description ? `<div style="font-size:12px;color:var(--neutral-500);margin-top:2px">${escHtml(p.description)}</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
            ${envs.map(e => `<span class="cred-chip" title="${escHtml(e.url)}">${escHtml(e.name)}: ${escHtml(e.url)}</span>`).join('')}
            ${!envs.length ? '<span style="font-size:12px;color:var(--neutral-400)">No environments configured</span>' : ''}
          </div>
          <div style="font-size:12px;color:var(--neutral-400);margin-top:4px">
            TC Prefix: <strong>${escHtml(p.tcIdPrefix || 'TC')}</strong> &nbsp;·&nbsp; Next ID: <strong>${escHtml(p.tcIdPrefix || 'TC')}-${String(p.tcIdCounter || 1).padStart(2, '0')}</strong>
          </div>
        </div>
        <div style="flex-shrink:0;display:flex;gap:6px;align-items:center">
          <span class="badge badge-${p.isActive ? 'active' : 'inactive'}">${p.isActive ? 'Active' : 'Inactive'}</span>
          <button class="tbl-btn" onclick="projEdit('${escHtml(p.id)}')">Edit</button>
          <button class="tbl-btn del" onclick="projDelete('${escHtml(p.id)}','${escHtml(p.name)}')">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function projOpenModal(id = null) {
  projTabSwitch('details');
  editingProjectId = id;
  modClearAlert('proj-modal-alert');
  document.getElementById('proj-modal-title').textContent = id ? 'Edit Project' : 'New Project';
  if (!id) {
    document.getElementById('pm-name').value = '';
    document.getElementById('pm-prefix').value = '';
    document.getElementById('pm-desc').value = '';
    document.getElementById('proj-envs').innerHTML = '';
  }
  openModal('modal-project');
}

async function projEdit(id) {
  const res = await fetch('/api/projects/all');
  const list = await res.json();
  const p = list.find(x => x.id === id);
  if (!p) return;
  editingProjectId = id;
  document.getElementById('proj-modal-title').textContent = 'Edit Project';
  document.getElementById('pm-name').value = p.name;
  document.getElementById('pm-prefix').value = p.tcIdPrefix || '';
  document.getElementById('pm-desc').value = p.description || '';
  const envsEl = document.getElementById('proj-envs');
  envsEl.innerHTML = '';
  (p.environments || []).forEach(e => projAddEnv(e.id, e.name, e.url));
  modClearAlert('proj-modal-alert');
  openModal('modal-project');
  projTabSwitch('details');
}

function projAddEnv(id = '', name = '', url = '') {
  const row = document.createElement('div');
  row.className = 'env-row';
  row.dataset.envId = id || ('env-' + Date.now());
  row.innerHTML = `
    <input class="fm-input env-name" placeholder="e.g. QA, DEV, UAT" value="${escHtml(name)}" style="width:130px" />
    <input class="fm-input env-url" placeholder="https://your-app-url.com" value="${escHtml(url)}" style="flex:1" />
    <button type="button" class="step-btn del" onclick="this.parentElement.remove()" title="Remove">✕</button>`;
  document.getElementById('proj-envs').appendChild(row);
}

async function projSave() {
  modClearAlert('proj-modal-alert');
  const name = document.getElementById('pm-name').value.trim();
  const prefix = document.getElementById('pm-prefix').value.trim().toUpperCase();
  if (!name) { modAlert('proj-modal-alert', 'error', 'Project name is required'); return; }
  if (!prefix) { modAlert('proj-modal-alert', 'error', 'TC ID Prefix is required'); return; }

  const environments = [...document.querySelectorAll('#proj-envs .env-row')].map(row => ({
    id: row.dataset.envId || ('env-' + Date.now() + Math.random()),
    name: row.querySelector('.env-name').value,
    url: row.querySelector('.env-url').value.trim(),
  })).filter(e => e.url);

  const body = {
    name, tcIdPrefix: prefix,
    description: document.getElementById('pm-desc').value.trim(),
    environments,
  };
  const method = editingProjectId ? 'PUT' : 'POST';
  const apiUrl = editingProjectId ? `/api/projects/${editingProjectId}` : '/api/projects';
  const res = await fetch(apiUrl, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('proj-modal-alert', 'error', data.error || 'Error'); return; }
  projCloseModal();
  await projLoad();
}

async function projDelete(id, name) {
  if (!confirm(`Delete project "${name}"?`)) return;
  await fetch(`/api/projects/${id}`, { method: 'DELETE' });
  await projLoad();
}

function projTabSwitch(tab) {
  ['details', 'environments', 'components'].forEach(t => {
    document.getElementById(`proj-tab-panel-${t}`).style.display = t === tab ? '' : 'none';
    document.getElementById(`proj-tab-${t}`).classList.toggle('proj-tab-active', t === tab);
  });
  if (tab === 'components') {
    const pid = editingProjectId;
    if (pid) compLoad(pid);
  }
  // Hide Save button on Components tab — components are saved individually
  const saveBtn = document.getElementById('proj-save-btn');
  if (saveBtn) saveBtn.style.display = tab === 'components' ? 'none' : '';
}

async function compLoad(projectId) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/components`);
  if (!res.ok) return;
  _compDefs = await res.json();

  // Auto-migration: if no components yet and scripts exist with component values, seed them
  const banner = document.getElementById('proj-comp-banner');
  if (_compDefs.length === 0) {
    const sRes = await fetch(`/api/scripts?projectId=${encodeURIComponent(projectId)}`);
    if (sRes.ok) {
      const scripts = await sRes.json();
      const distinct = [...new Set(scripts.map(s => (s.component || '').trim()).filter(Boolean))];
      if (distinct.length > 0) {
        for (const name of distinct) {
          const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/components`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
          });
          if (r.ok) { const d = await r.json(); _compDefs.push(d.comp); }
        }
        if (banner) {
          banner.innerHTML = `<div class="alert alert-info" style="font-size:12.5px">${distinct.length} component(s) imported from existing test scripts. <button class="tbl-btn" onclick="document.getElementById('proj-comp-banner').style.display='none'">Dismiss</button></div>`;
          banner.style.display = '';
        }
      }
    }
  }

  compRender();
}

function compRender() {
  const el = document.getElementById('proj-comp-list');
  if (!el) return;
  if (!_compDefs.length) {
    el.innerHTML = '<div class="builder-hint">No components yet. Click + Add Component to create one.</div>';
    return;
  }
  el.innerHTML = _compDefs.map(c => `
    <div class="comp-row" data-comp-id="${escHtml(c.id)}">
      <span class="comp-row-name" id="comp-name-${escHtml(c.id)}">${escHtml(c.name)}</span>
      <button class="tbl-btn" onclick="compRenameStart('${escHtml(c.id)}')">Rename</button>
      <button class="tbl-btn del" onclick="compDeleteComp('${escHtml(c.id)}','${escHtml(c.name)}')">Delete</button>
    </div>
    <div class="subcomp-list" id="subcomp-list-${escHtml(c.id)}">
      ${c.subcomponents.map(s => `
        <div class="subcomp-row" data-sub-id="${escHtml(s.id)}">
          <span class="subcomp-name">\u00b7 ${escHtml(s.name)}</span>
          <button class="tbl-btn del" onclick="compDeleteSub('${escHtml(c.id)}','${escHtml(s.id)}')">✕</button>
        </div>`).join('')}
      <div style="margin-top:4px">
        <button class="tbl-btn" onclick="compAddSub('${escHtml(c.id)}')">+ Add Subcomponent</button>
      </div>
    </div>`).join('');
}

async function compAddComp() {
  const name = prompt('Component name:');
  if (!name?.trim()) return;
  const pid = editingProjectId;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
  });
  if (!res.ok) { alert('Failed to add component'); return; }
  const data = await res.json();
  _compDefs.push(data.comp);
  compRender();
}

function compRenameStart(compId) {
  const nameEl = document.getElementById(`comp-name-${compId}`);
  if (!nameEl) return;
  const current = nameEl.textContent;
  nameEl.outerHTML = `
    <input id="comp-rename-input-${escHtml(compId)}" class="fm-input" value="${escHtml(current)}" style="flex:1;margin-right:4px" />`;
  // Replace Rename button with Save/Cancel
  const row = document.querySelector(`[data-comp-id="${compId}"]`);
  row.querySelectorAll('button').forEach(b => b.style.display = 'none');
  const saveBtn = document.createElement('button');
  saveBtn.className = 'tbl-btn';
  saveBtn.textContent = 'Save';
  saveBtn.onclick = () => compRenameConfirm(compId);
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'tbl-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.onclick = () => compRender();
  row.appendChild(saveBtn);
  row.appendChild(cancelBtn);
}

async function compRenameConfirm(compId) {
  const input = document.getElementById(`comp-rename-input-${compId}`);
  const newName = input?.value?.trim();
  if (!newName) { alert('Name cannot be empty'); return; }
  const pid = editingProjectId;
  const comp = _compDefs.find(c => c.id === compId);
  if (!comp) return;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components/${encodeURIComponent(compId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName, subcomponents: comp.subcomponents }),
  });
  if (!res.ok) { alert('Failed to rename'); return; }
  comp.name = newName;
  compRender();
}

async function compDeleteComp(compId, compName) {
  if (!confirm(`Remove component "${compName}"? Existing test scripts referencing it will keep their saved value.`)) return;
  const pid = editingProjectId;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components/${encodeURIComponent(compId)}`, { method: 'DELETE' });
  if (!res.ok) { alert('Failed to delete'); return; }
  _compDefs = _compDefs.filter(c => c.id !== compId);
  compRender();
}

async function compAddSub(compId) {
  const name = prompt('Subcomponent name:');
  if (!name?.trim()) return;
  const comp = _compDefs.find(c => c.id === compId);
  if (!comp) return;
  const newSub = { id: 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2), name: name.trim() };
  const updatedSubs = [...comp.subcomponents, newSub];
  const pid = editingProjectId;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components/${encodeURIComponent(compId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: comp.name, subcomponents: updatedSubs }),
  });
  if (!res.ok) { alert('Failed to add subcomponent'); return; }
  const data = await res.json();
  comp.subcomponents = data.comp.subcomponents;
  compRender();
}

async function compDeleteSub(compId, subId) {
  const comp = _compDefs.find(c => c.id === compId);
  if (!comp) return;
  const updatedSubs = comp.subcomponents.filter(s => s.id !== subId);
  const pid = editingProjectId;
  const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/components/${encodeURIComponent(compId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: comp.name, subcomponents: updatedSubs }),
  });
  if (!res.ok) { alert('Failed to delete subcomponent'); return; }
  const data = await res.json();
  comp.subcomponents = data.comp.subcomponents;
  compRender();
}

async function seLoadComponents() {
  if (!currentProjectId) { _seCompDefs = []; return; }
  const res = await fetch(`/api/projects/${encodeURIComponent(currentProjectId)}/components`);
  _seCompDefs = res.ok ? await res.json() : [];
}

function sePopulateComponent(currentValue) {
  const sel = document.getElementById('se-component');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Component —</option>';
  const knownNames = new Set(_seCompDefs.map(c => c.name));
  _seCompDefs.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.name;
    opt.textContent = c.name;
    sel.appendChild(opt);
  });
  if (currentValue && !knownNames.has(currentValue)) {
    const opt = document.createElement('option');
    opt.value = currentValue;
    opt.textContent = `${currentValue} (legacy)`;
    opt.disabled = true;
    opt.selected = true;
    sel.appendChild(opt);
  } else {
    sel.value = currentValue || '';
  }
  sePopulateSubcomponent(null);
}

function sePopulateSubcomponent(currentValue) {
  const compSel = document.getElementById('se-component');
  const subSel = document.getElementById('se-subcomponent');
  if (!subSel || !compSel) return;
  const selectedComp = _seCompDefs.find(c => c.name === compSel.value);
  subSel.innerHTML = '<option value="">— Select Subcomponent —</option>';
  if (!selectedComp || !selectedComp.subcomponents.length) {
    if (selectedComp) {
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.textContent = 'No subcomponents defined';
      subSel.appendChild(opt);
    }
    subSel.disabled = !selectedComp;
    return;
  }
  subSel.disabled = false;
  selectedComp.subcomponents.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name;
    opt.textContent = s.name;
    subSel.appendChild(opt);
  });
  if (currentValue) subSel.value = currentValue;
}

function seComponentChanged() {
  sePopulateSubcomponent(null);
}

function projCloseModal() { closeModal('modal-project'); editingProjectId = null; }

