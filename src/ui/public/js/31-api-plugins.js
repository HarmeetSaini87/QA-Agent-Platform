// ══════════════════════════════════════════════════════════════════════════════
// API PLUGINS MODULE — Plugin Ecosystem page
// ══════════════════════════════════════════════════════════════════════════════

let _apiPluginsList = [];

async function apiPluginsLoad() {
  const tbody = document.getElementById('api-plugins-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">Loading…</td></tr>';
  try {
    const res = await fetch('/api/plugins');
    if (res.status === 401) { window.location.href = '/login?reason=expired'; return; }
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444">Failed to load plugins.</td></tr>'; return; }
    _apiPluginsList = await res.json();
    if (!Array.isArray(_apiPluginsList)) _apiPluginsList = [];
    _apiPluginsRenderList();
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444">Error loading plugins.</td></tr>';
  }
  _apiPluginsLoadExamples();
}

function apiPluginsFilter() {
  _apiPluginsRenderList();
}

function _apiPluginsRenderList() {
  const tbody = document.getElementById('api-plugins-tbody');
  if (!tbody) return;
  const q = (document.getElementById('api-plugins-search')?.value || '').toLowerCase();
  const filtered = q
    ? _apiPluginsList.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.id || '').toLowerCase().includes(q) ||
        (p.capabilities || []).some(c => c.toLowerCase().includes(q)))
    : _apiPluginsList;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">${q ? 'No plugins match the search.' : 'No plugins registered.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(p => {
    const statusBadge = p.status === 'enabled'
      ? '<span style="color:#22c55e;font-weight:600">Enabled</span>'
      : '<span style="color:#9ca3af">Disabled</span>';
    const caps = (p.capabilities || []).map(c => `<span class="badge">${escHtml(c)}</span>`).join(' ');
    const toggleBtn = p.status === 'enabled'
      ? `<button class="tbl-btn" onclick="apiPluginDisable('${escHtml(p.id)}')">Disable</button>`
      : `<button class="tbl-btn" onclick="apiPluginEnable('${escHtml(p.id)}')">Enable</button>`;
    return `<tr>
      <td>${escHtml(p.name || p.id)}</td>
      <td style="font-size:11px;color:var(--text-muted);font-family:monospace">${escHtml(p.id)}</td>
      <td>${escHtml(p.version || '—')}</td>
      <td>${caps || '<span style="color:var(--text-muted)">—</span>'}</td>
      <td>${statusBadge}</td>
      <td>${toggleBtn}</td>
    </tr>`;
  }).join('');
}

async function apiPluginEnable(pluginId) {
  const res = await fetch('/api/plugins/' + encodeURIComponent(pluginId) + '/enable', { method: 'POST' });
  if (!res.ok) { modAlert('api-plugins-alert', 'error', 'Failed to enable plugin.'); return; }
  const plugin = _apiPluginsList.find(p => p.id === pluginId);
  if (plugin) plugin.status = 'enabled';
  _apiPluginsRenderList();
  modAlert('api-plugins-alert', 'success', 'Plugin enabled.');
}

async function apiPluginDisable(pluginId) {
  const res = await fetch('/api/plugins/' + encodeURIComponent(pluginId) + '/disable', { method: 'POST' });
  if (!res.ok) { modAlert('api-plugins-alert', 'error', 'Failed to disable plugin.'); return; }
  const plugin = _apiPluginsList.find(p => p.id === pluginId);
  if (plugin) plugin.status = 'disabled';
  _apiPluginsRenderList();
  modAlert('api-plugins-alert', 'success', 'Plugin disabled.');
}

async function _apiPluginsLoadExamples() {
  const tbody = document.getElementById('api-plugins-examples-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">Loading…</td></tr>';
  try {
    const res = await fetch('/api/plugins/examples');
    if (!res.ok) { tbody.innerHTML = '<tr><td colspan="4" style="color:#ef4444">Examples unavailable.</td></tr>'; return; }
    const data = await res.json();
    const examples = Array.isArray(data) ? data : (data.examples || []);
    if (!examples.length) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No example plugins available.</td></tr>';
      return;
    }
    tbody.innerHTML = examples.map(ex => {
      const manifest = ex.manifest || ex;
      const caps = (manifest.capabilities || []).map(c => `<span class="badge">${escHtml(c)}</span>`).join(' ');
      const manifestStr = escHtml(JSON.stringify(manifest));
      return `<tr>
        <td>${escHtml(ex.name || ex.id)}</td>
        <td style="color:var(--text-muted);font-size:12px">${escHtml(ex.description || '—')}</td>
        <td>${caps || '<span style="color:var(--text-muted)">—</span>'}</td>
        <td><button class="tbl-btn" onclick="apiPluginRegisterExample('${manifestStr}')">Register</button></td>
      </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:#ef4444">Error loading examples.</td></tr>';
  }
}

async function apiPluginRegisterExample(manifestJson) {
  let manifest;
  try { manifest = JSON.parse(manifestJson); } catch { return; }
  const res = await fetch('/api/plugins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest)
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    modAlert('api-plugins-alert', 'error', 'Register failed: ' + (body.error || res.status));
    return;
  }
  const registered = await res.json();
  _apiPluginsList.push(registered);
  _apiPluginsRenderList();
  modAlert('api-plugins-alert', 'success', 'Plugin "' + escHtml(registered.name || registered.id) + '" registered.');
}

function apiPluginsExport() {
  if (!_apiPluginsList.length) { showToast('error', 'No plugins to export.'); return; }
  downloadCSV('plugins.csv',
    ['Name', 'Plugin ID', 'Version', 'Capabilities', 'Status'],
    _apiPluginsList.map(p => [
      p.name || p.id, p.id, p.version || '',
      (p.capabilities || []).join('; '), p.status
    ])
  );
  showToast('success', 'Plugins exported to plugins.csv');
}
