// ══════════════════════════════════════════════════════════════════════════════
// Tab switch integration — load data on first visit
// ══════════════════════════════════════════════════════════════════════════════

const _panelLoaded = new Set();

// Tabs where the project dropdown is irrelevant and should be hidden
const _HIDE_PROJ_DROPDOWN_TABS = new Set(['projects', 'admin', 'worker-health']);

function onModuleTabSwitch(tab) {
  if (tab === 'admin') usersLoad();
  if (tab === 'projects') projLoad();
  if (tab === 'locators') { locatorLoad(); proposalLoad(); }
  if (tab === 'functions') fnLoad();
  if (tab === 'commondata') cdLoad();
  if (tab === 'scripts') { scriptLoad(); _debugSessionsPollStart(); }
  if (tab === 'suites') suiteLoad();
  if (tab === 'execution') execLoad();
  if (tab === 'history') histLoad();
  if (tab === 'flaky') flakyLoad();
  if (tab === 'analytics') analyticsLoad();
  if (tab === 'visual') vrLoad();
  if (tab === 'locator-health') locatorHealthLoad();
  if (tab === 'api-envs') apiEnvLoad();
  if (tab === 'api-collections') apiColLoad();
  if (tab === 'api-runs') apiRunsLoad();
  if (tab === 'api-flakiness') flakinessPageInit();
  if (tab === 'api-suites') apiSuitesInit();
  if (tab === 'api-replay' && !_panelLoaded.has('api-replay')) { if (typeof apiReplayInit === 'function') apiReplayInit(); }
  if (tab === 'worker-health') { if (typeof workerHealthInit === 'function') { var _whPanel = document.getElementById('panel-worker-health'); if (_whPanel) workerHealthInit(_whPanel); } }
  if (tab === 'governance') { if (typeof governanceInit === 'function') { var _govPanel = document.getElementById('panel-governance'); if (_govPanel) governanceInit(_govPanel); } }
  // OLD: Plugin tab trigger removed — plugin ecosystem deactivated 2026-05-30
  // if (tab === 'api-plugins') { if (typeof apiPluginsLoad === 'function') apiPluginsLoad(); }
  if (tab === 'api-graph') { if (typeof graphEditorLoad === 'function') graphEditorLoad(); }
  if (tab === 'api-collab') { if (typeof collabLoad === 'function') collabLoad(); }
  if (tab === 'api-copilot') { if (typeof copilotLoad === 'function') copilotLoad(); }
  if (tab === 'perf-dashboard') { if (typeof perfLoad === 'function') perfLoad(); }
  if (tab === 'admin' && !_panelLoaded.has('admin')) adminSubTab('users', document.querySelector('.sub-tab'));
  _panelLoaded.add(tab);

  // Hide project dropdown on admin/project management tabs
  const projWidget = document.getElementById('global-project-select')?.closest('div');
  if (projWidget) projWidget.style.display = _HIDE_PROJ_DROPDOWN_TABS.has(tab) ? 'none' : '';
  const projLabel = projWidget?.previousElementSibling;
  if (projLabel) projLabel.style.display = _HIDE_PROJ_DROPDOWN_TABS.has(tab) ? 'none' : '';
}

// Hook wired in DOMContentLoaded (see bottom of file) after app.js sets its final switchTab

// ══════════════════════════════════════════════════════════════════════════════
// TC Builder: inject locator picker button into step selector fields
// ══════════════════════════════════════════════════════════════════════════════

// Called by builderAddStep after rendering step content
function injectLocatorPickerBtn(stepRow) {
  const selectorInput = stepRow.querySelector('.step-selector');
  if (!selectorInput) return;
  if (stepRow.querySelector('.loc-pick-btn')) return; // already injected

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'loc-pick-btn tbl-btn';
  btn.title = 'Pick from Locator Repo';
  btn.textContent = '🔍';
  btn.style.cssText = 'padding:5px 7px;font-size:13px;margin-left:4px;flex-shrink:0';
  btn.onclick = () => {
    locatorPickerOpen((selector, type, name) => {
      selectorInput.value = selector;
      const typeEl = stepRow.querySelector('.step-fieldtype');
      // Map selectorType to fieldType roughly
      if (typeEl && type === 'css') { /* keep existing */ }
    });
  };
  selectorInput.parentElement?.appendChild(btn) || selectorInput.insertAdjacentElement('afterend', btn);
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJECT DROPDOWN + ISOLATION
// ══════════════════════════════════════════════════════════════════════════════

let allProjects = [];
let currentProjectId = '';

async function projDropdownLoad() {
  const res = await fetch('/api/projects');
  if (res.status === 401) { window.location.href = '/login?reason=expired'; return; }
  if (!res.ok) return;
  allProjects = await res.json();
  if (!Array.isArray(allProjects)) { allProjects = []; return; }
  const sel = document.getElementById('global-project-select');
  if (!sel) return;
  const active = allProjects.filter(p => p.isActive);
  sel.innerHTML = '<option value="">— Select Project —</option>' +
    active.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join('');
  if (active.length === 1) { sel.value = active[0].id; onProjectChange(); }
}

// Panels that require a project to be selected before any interaction
const PROJECT_SCOPED_TABS = new Set(['scripts', 'suites', 'locators', 'functions', 'commondata', 'history', 'flaky', 'analytics', 'visual', 'locator-health', 'api-envs', 'api-collections', 'api-runs', 'api-flakiness', 'api-suites']);

const _PROJ_BANNER_ID = 'proj-required-banner';

function _guardCheck(tab) {
  _removeProjBanner();
  if (!PROJECT_SCOPED_TABS.has(tab)) { _projDropdownNormal(); return; }
  if (!currentProjectId) { _showProjBanner(); _projDropdownPulse(); }
  else { _projDropdownNormal(); }
}

function _showProjBanner() {
  if (document.getElementById(_PROJ_BANNER_ID)) return;
  const panel = document.querySelector('.panel.active');
  if (!panel) return;
  const banner = document.createElement('div');
  banner.id = _PROJ_BANNER_ID;
  banner.className = 'proj-required-banner';
  banner.innerHTML = `<span>⚠️ Select a <strong>Project</strong> from the dropdown in the top bar before using this module.</span>`;
  panel.insertBefore(banner, panel.firstChild);
}

function _removeProjBanner() {
  document.getElementById(_PROJ_BANNER_ID)?.remove();
}

function _projDropdownPulse() {
  document.getElementById('global-project-select')?.classList.add('proj-select-required');
}

function _projDropdownNormal() {
  document.getElementById('global-project-select')?.classList.remove('proj-select-required');
}

function onProjectChange() {
  currentProjectId = document.getElementById('global-project-select')?.value || '';
  const activeTab = document.querySelector('.nav-item.active')?.dataset?.tab || '';
  _guardCheck(activeTab);
  _toggleModuleAddButtons(!!currentProjectId);
  _scriptPage = 0; _fnPage = 0; _cdPage = 0; _locPage = 0;
  scriptLoad();
  suiteLoad();
  locatorLoadScoped();
  fnLoad();
  _cdPopulateEnvDropdowns();
  cdLoad();
  histLoad();
  flakyLoad();
  analyticsLoad();
  vrLoad();
  locatorHealthLoad();
  execLoad();
  apiEnvLoad();
  apiColLoad();
  apiRunsLoad();
  if (typeof apiSuitesLoad === 'function') apiSuitesLoad();
}

function _toggleModuleAddButtons(enabled) {
  ['btn-new-script', 'btn-new-suite', 'btn-add-locator', 'btn-new-function', 'btn-add-cd', 'btn-new-api-env', 'btn-new-api-col'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !enabled;
  });
}

async function locatorLoadScoped() {
  if (!currentProjectId) { allLocators = []; locatorRender(); return; }
  const res = await fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}`);
  allLocators = await res.json();
  locatorRender();
}

// ══════════════════════════════════════════════════════════════════════════════
// KEYWORD REGISTRY
// ══════════════════════════════════════════════════════════════════════════════
