// ══════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════════════════════════════════════════

// NL provider metadata — loaded from server on settings open
let _nlProviders = [];

async function settingsLoad() {
  const res = await fetch('/api/admin/settings');
  const data = await res.json();
  document.getElementById('set-app-name').value = data.appName ?? '';
  document.getElementById('set-timeout').value = data.sessionTimeoutMinutes ?? 60;
  document.getElementById('set-max-logins').value = data.maxFailedLogins ?? 5;
  document.getElementById('set-allow-reg').checked = !!data.allowRegistration;

  // Load NL provider metadata then restore saved settings
  try {
    const pr = await fetch('/api/nl-providers');
    if (pr.ok) _nlProviders = await pr.json();
  } catch { }

  const provSel = document.getElementById('set-nl-provider');
  if (provSel && data.nlProvider) provSel.value = data.nlProvider;
  nlProviderChanged(data);  // pass saved data to pre-fill fields

  const maxRowsEl = document.getElementById('set-data-file-max-rows');
  if (maxRowsEl) maxRowsEl.value = data.dataFileMaxRows ?? 500;

  notifLoad(data.notifications ?? {});
  if (typeof jiraConfigLoad === 'function') jiraConfigLoad();
  if (typeof nlAliasLoad === 'function') nlAliasLoad();
}

async function settingsSave() {
  modClearAlert('settings-alert');
  const keyVal = document.getElementById('set-nl-key')?.value.trim();
  const customModel = document.getElementById('set-nl-model-custom')?.value.trim();
  const selectModel = document.getElementById('set-nl-model-select')?.value || '';
  const body = {
    appName: document.getElementById('set-app-name').value.trim(),
    sessionTimeoutMinutes: parseInt(document.getElementById('set-timeout').value) || 60,
    maxFailedLogins: parseInt(document.getElementById('set-max-logins').value) || 5,
    allowRegistration: document.getElementById('set-allow-reg').checked,
    dataFileMaxRows: parseInt(document.getElementById('set-data-file-max-rows')?.value) || 500,
    nlProvider: document.getElementById('set-nl-provider')?.value || '',
    nlModel: customModel || selectModel || '',
    nlBaseUrl: document.getElementById('set-nl-baseurl')?.value.trim() || '',
    ...(keyVal ? { nlApiKey: keyVal } : {}),
  };
  const res = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) {
    modAlert('settings-alert', 'success', 'Settings saved successfully');
    if (keyVal) {
      const el = document.getElementById('set-nl-key');
      if (el) { el.value = ''; el.placeholder = '●●●●●●●●●●●● (saved)'; }
      const hint = document.getElementById('nl-key-set-hint');
      if (hint) hint.style.display = '';
    }
    settingsLoad();
  } else {
    modAlert('settings-alert', 'error', data.error || 'Error saving settings');
  }
}

function toggleApiKeyVisibility() {
  const el = document.getElementById('set-nl-key');
  if (!el) return;
  el.type = el.type === 'password' ? 'text' : 'password';
}

function nlProviderChanged(savedData) {
  const provId = document.getElementById('set-nl-provider')?.value || '';
  const prov = _nlProviders.find(p => p.id === provId);

  const helpEl = document.getElementById('nl-help-text');
  const keyField = document.getElementById('nl-key-field');
  const urlField = document.getElementById('nl-url-field');
  const mdlField = document.getElementById('nl-model-field');
  const statusEl = document.getElementById('set-nl-status');

  if (!provId || !prov) {
    if (helpEl) { helpEl.style.display = 'none'; helpEl.textContent = ''; }
    if (keyField) keyField.style.display = 'none';
    if (urlField) urlField.style.display = 'none';
    if (mdlField) mdlField.style.display = 'none';
    if (statusEl) { statusEl.textContent = 'NL Suggestion disabled.'; statusEl.style.color = 'var(--neutral-400)'; }
    return;
  }

  // Help text
  if (helpEl) { helpEl.textContent = prov.helpText || ''; helpEl.style.display = ''; }

  // API Key field
  if (keyField) {
    keyField.style.display = prov.needsKey ? '' : 'none';
    const keyInput = document.getElementById('set-nl-key');
    if (keyInput && prov.keyPlaceholder) keyInput.placeholder = prov.keyPlaceholder;
    const hint = document.getElementById('nl-key-set-hint');
    if (hint) hint.style.display = (savedData?.nlApiKeySet && prov.needsKey) ? '' : 'none';
  }

  // Base URL field
  if (urlField) {
    urlField.style.display = prov.needsUrl ? '' : 'none';
    const urlInput = document.getElementById('set-nl-baseurl');
    if (urlInput) {
      if (prov.urlPlaceholder) urlInput.placeholder = prov.urlPlaceholder;
      if (savedData?.nlBaseUrl && !urlInput.value) urlInput.value = savedData.nlBaseUrl;
    }
  }

  // Model field
  if (mdlField) {
    mdlField.style.display = '';
    const sel = document.getElementById('set-nl-model-select');
    const customInput = document.getElementById('set-nl-model-custom');
    if (sel) {
      sel.innerHTML = prov.modelOptions.map(o =>
        `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`
      ).join('') || '<option value="">— type model name below —</option>';
      if (savedData?.nlModel) {
        const match = prov.modelOptions.find(o => o.value === savedData.nlModel);
        if (match) sel.value = savedData.nlModel;
        else if (customInput) customInput.value = savedData.nlModel;
      } else {
        sel.value = prov.defaultModel || (prov.modelOptions[0]?.value || '');
      }
    }
  }

  // Status
  if (statusEl) {
    const keyOk = !prov.needsKey || savedData?.nlApiKeySet;
    const urlOk = !prov.needsUrl || (savedData?.nlBaseUrl || provId === 'ollama');
    if (keyOk && urlOk) {
      statusEl.textContent = `✓ ${prov.label} configured — NL Suggestion active`;
      statusEl.style.color = '#4ec9b0';
    } else {
      statusEl.textContent = `Configure credentials above then Save Settings to activate.`;
      statusEl.style.color = 'var(--neutral-400)';
    }
  }
}

function nlModelSelectChanged() {
  const sel = document.getElementById('set-nl-model-select');
  const custom = document.getElementById('set-nl-model-custom');
  if (sel?.value && custom) custom.value = '';
}

// ── Notification Settings ─────────────────────────────────────────────────────

function notifToggleSection(which, enabled) {
  const bodyEl = document.getElementById(`notif-${which}-body`);
  if (bodyEl) bodyEl.style.display = enabled ? '' : 'none';
}

function notifLoad(n) {
  const g = (id, def) => { const el = document.getElementById(id); if (el) el[el.type === 'checkbox' ? 'checked' : 'value'] = (n[def[0]] !== undefined ? n[def[0]] : def[1]); };
  // Trigger rules
  const onF = document.getElementById('notif-on-failure'); if (onF) onF.checked = n.notifyOnFailure !== false;
  const onS = document.getElementById('notif-on-success'); if (onS) onS.checked = !!n.notifyOnSuccess;
  const onA = document.getElementById('notif-on-always'); if (onA) onA.checked = !!n.notifyOnAlways;
  // Email
  const emailEn = document.getElementById('notif-email-enabled'); if (emailEn) { emailEn.checked = !!n.emailEnabled; notifToggleSection('email', !!n.emailEnabled); }
  document.getElementById('notif-smtp-host').value = n.smtpHost ?? '';
  document.getElementById('notif-smtp-port').value = n.smtpPort ?? 587;
  document.getElementById('notif-smtp-user').value = n.smtpUser ?? '';
  document.getElementById('notif-smtp-pass').value = n.smtpPass ?? '';
  document.getElementById('notif-email-from').value = n.emailFrom ?? '';
  document.getElementById('notif-email-to').value = n.emailTo ?? '';
  const secureEl = document.getElementById('notif-smtp-secure'); if (secureEl) secureEl.checked = !!n.smtpSecure;
  // Slack
  const slackEn = document.getElementById('notif-slack-enabled'); if (slackEn) { slackEn.checked = !!n.slackEnabled; notifToggleSection('slack', !!n.slackEnabled); }
  document.getElementById('notif-slack-webhook').value = n.slackWebhook ?? '';
  // Teams
  const teamsEn = document.getElementById('notif-teams-enabled'); if (teamsEn) { teamsEn.checked = !!n.teamsEnabled; notifToggleSection('teams', !!n.teamsEnabled); }
  document.getElementById('notif-teams-webhook').value = n.teamsWebhook ?? '';
}

function notifCollect() {
  const v = id => document.getElementById(id)?.value ?? '';
  const c = id => document.getElementById(id)?.checked ?? false;
  return {
    notifyOnFailure: c('notif-on-failure'),
    notifyOnSuccess: c('notif-on-success'),
    notifyOnAlways: c('notif-on-always'),
    emailEnabled: c('notif-email-enabled'),
    smtpHost: v('notif-smtp-host').trim(),
    smtpPort: parseInt(v('notif-smtp-port')) || 587,
    smtpSecure: c('notif-smtp-secure'),
    smtpUser: v('notif-smtp-user').trim(),
    smtpPass: v('notif-smtp-pass'),
    emailFrom: v('notif-email-from').trim(),
    emailTo: v('notif-email-to').trim(),
    slackEnabled: c('notif-slack-enabled'),
    slackWebhook: v('notif-slack-webhook').trim(),
    teamsEnabled: c('notif-teams-enabled'),
    teamsWebhook: v('notif-teams-webhook').trim(),
  };
}

async function notifSave() {
  modClearAlert('notif-alert');
  const body = { notifications: notifCollect() };
  const res = await fetch('/api/admin/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (res.ok) modAlert('notif-alert', 'success', 'Notification settings saved');
  else modAlert('notif-alert', 'error', data.error || 'Error saving');
}

async function notifTest() {
  modClearAlert('notif-alert');
  modAlert('notif-alert', 'info', 'Sending test notification…');
  const res = await fetch('/api/admin/settings/test-notification', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const data = await res.json();
  if (data.success) {
    modAlert('notif-alert', 'success', 'Test notification sent successfully to all enabled channels');
  } else {
    const errs = Object.entries(data.errors || {}).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('; ');
    modAlert('notif-alert', 'error', errs || data.error || 'Test notification failed — check server logs');
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PROJECTS
// ══════════════════════════════════════════════════════════════════════════════
// Common Data
// ══════════════════════════════════════════════════════════════════════════════


// ── NL Alias Map ──────────────────────────────────────────────────────────

let _nlAliasData = {};
let _nlAliasPage = 0;
const _NL_ALIAS_PAGE_SIZE = 20;
let _nlAliasSearch = '';

function _nlAliasFilteredEntries() {
  const q = _nlAliasSearch.toLowerCase().trim();
  const all = Object.entries(_nlAliasData);
  if (!q) return all;
  return all.filter(([loc, phrases]) =>
    loc.toLowerCase().includes(q) ||
    (Array.isArray(phrases) && phrases.some(p => p.toLowerCase().includes(q)))
  );
}

function _nlAliasRender() {
  const listEl = document.getElementById('nl-alias-list');
  const infoEl = document.getElementById('nl-alias-info');
  if (!listEl) return;

  const filtered = _nlAliasFilteredEntries();
  const total    = filtered.length;
  const pages    = Math.ceil(total / _NL_ALIAS_PAGE_SIZE) || 1;
  _nlAliasPage   = Math.min(_nlAliasPage, pages - 1);
  const slice    = filtered.slice(_nlAliasPage * _NL_ALIAS_PAGE_SIZE, (_nlAliasPage + 1) * _NL_ALIAS_PAGE_SIZE);

  if (infoEl) {
    const start = total ? _nlAliasPage * _NL_ALIAS_PAGE_SIZE + 1 : 0;
    const end   = Math.min((_nlAliasPage + 1) * _NL_ALIAS_PAGE_SIZE, total);
    infoEl.textContent = total ? `Showing ${start}–${end} of ${total}` : 'No matches.';
  }

  if (!total) {
    listEl.innerHTML = '<span style="font-size:12px;color:var(--neutral-500)">No aliases yet. Add a row below.</span>';
    _nlAliasPagRender(0, 0);
    return;
  }

  // find original key index for rename/update (search may reorder)
  listEl.innerHTML = slice.map(([loc, phrases]) => {
    const escapedLoc     = _escHtml(loc);
    const escapedPhrases = _escHtml(Array.isArray(phrases) ? phrases.join(', ') : '');
    return `
      <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:6px;align-items:center;margin-bottom:5px">
        <input class="fm-input" style="font-size:12px" value="${escapedLoc}"
          placeholder="Locator Name (exact)"
          data-orig="${escapedLoc}"
          onchange="nlAliasRenameKey(this.dataset.orig, this.value); this.dataset.orig=this.value" />
        <input class="fm-input" style="font-size:12px" value="${escapedPhrases}"
          placeholder="alias one, alias two, alias three"
          onchange="nlAliasUpdatePhrases('${escapedLoc}', this.value)" />
        <button class="btn btn-outline btn-sm" style="color:#f48771;border-color:#f48771;padding:2px 8px;min-width:28px"
          onclick="nlAliasDeleteRow('${escapedLoc}')">✕</button>
      </div>`;
  }).join('');

  _nlAliasPagRender(pages, _nlAliasPage);
}

function _nlAliasPagRender(pages, current) {
  const pagEl = document.getElementById('nl-alias-pagination');
  if (!pagEl) return;
  if (pages <= 1) { pagEl.innerHTML = ''; return; }
  pagEl.innerHTML = `
    <button class="btn btn-outline btn-sm" ${current === 0 ? 'disabled' : ''}
      onclick="_nlAliasPage=${current-1};_nlAliasRender()">&#8592; Prev</button>
    <span style="font-size:12px;color:var(--neutral-400)">Page ${current+1} / ${pages}</span>
    <button class="btn btn-outline btn-sm" ${current >= pages-1 ? 'disabled' : ''}
      onclick="_nlAliasPage=${current+1};_nlAliasRender()">Next &#8594;</button>`;
}

async function nlAliasLoad() {
  try {
    const res = await fetch('/api/nl/aliases');
    if (!res.ok) return;
    _nlAliasData = await res.json();
    _nlAliasPage = 0;
    _nlAliasRender();
  } catch { /* silently ignore */ }
}

function nlAliasSearch(q) {
  _nlAliasSearch = q;
  _nlAliasPage   = 0;
  _nlAliasRender();
}

function nlAliasRenameKey(oldKey, newKey) {
  newKey = newKey.trim();
  if (!newKey || newKey === oldKey || !Object.prototype.hasOwnProperty.call(_nlAliasData, oldKey)) return;
  const rebuilt = {};
  for (const [k, v] of Object.entries(_nlAliasData)) rebuilt[k === oldKey ? newKey : k] = v;
  _nlAliasData = rebuilt;
}

function nlAliasUpdatePhrases(key, raw) {
  if (!Object.prototype.hasOwnProperty.call(_nlAliasData, key)) return;
  _nlAliasData[key] = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
}

function nlAliasDeleteRow(key) {
  delete _nlAliasData[key];
  _nlAliasRender();
}

function nlAliasAddRow() {
  const locEl = document.getElementById('nl-alias-new-loc');
  const phEl  = document.getElementById('nl-alias-new-phrases');
  if (!locEl || !phEl) return;
  const loc     = locEl.value.trim();
  const phrases = phEl.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10);
  if (!loc) { locEl.focus(); return; }
  _nlAliasData[loc] = phrases;
  locEl.value       = '';
  phEl.value        = '';
  _nlAliasSearch    = '';
  _nlAliasPage      = 0;
  const searchEl = document.getElementById('nl-alias-search');
  if (searchEl) searchEl.value = '';
  _nlAliasRender();
}

async function nlAliasSave() {
  try {
    const res = await fetch('/api/nl/aliases', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_nlAliasData),
    });
    const data = await res.json();
    const resultEl = document.getElementById('nl-alias-test-result');
    if (resultEl) {
      resultEl.textContent = res.ok ? '✓ Saved' : ('✗ ' + (data.error || 'Error'));
      resultEl.style.color = res.ok ? '#4ec9b0' : '#f48771';
      setTimeout(() => { resultEl.textContent = ''; resultEl.style.color = ''; }, 2000);
    }
  } catch {
    const resultEl = document.getElementById('nl-alias-test-result');
    if (resultEl) { resultEl.textContent = '✗ Network error'; resultEl.style.color = '#f48771'; }
  }
}

function nlAliasTest() {
  const input = document.getElementById('nl-alias-test-input');
  const resultEl = document.getElementById('nl-alias-test-result');
  if (!input || !input.value.trim() || !resultEl) return;
  const phrase = input.value.trim().toLowerCase().replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim();
  // direct alias map lookup — check if phrase matches any alias for any locator
  let matched = null;
  for (const [loc, aliases] of Object.entries(_nlAliasData)) {
    if (!Array.isArray(aliases)) continue;
    for (const alias of aliases) {
      const normAlias = alias.toLowerCase().replace(/\b(the|a|an)\b/g, '').replace(/\s+/g, ' ').trim();
      if (normAlias === phrase) { matched = loc; break; }
    }
    if (matched) break;
  }
  try {
    if (matched) {
      resultEl.textContent = `→ ${matched}`;
      resultEl.style.color = '#4ec9b0';
    } else {
      resultEl.textContent = 'No match';
      resultEl.style.color = 'var(--neutral-500)';
    }
  } catch {
    resultEl.textContent = '✗ Network error';
    resultEl.style.color = '#f48771';
  }
}

// ── Server Restart (dev convenience — monitor auto-restores within 30s) ──────

async function adminRestartServer() {
  const btn = document.getElementById('btn-restart-server');
  if (!confirm('Restart the server? It will be unavailable for ~30 seconds while the monitor restores it.')) return;
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Restarting…'; }
  try {
    await fetch('/api/admin/restart-server', { method: 'POST' });
  } catch { /* expected — server dies mid-response */ }
  if (btn) btn.textContent = '✓ Restarting — page will reload';
  // Poll until server is back, then reload
  const poll = setInterval(async () => {
    try {
      const r = await fetch('/api/health');
      if (r.ok) { clearInterval(poll); window.location.reload(); }
    } catch { /* still down */ }
  }, 2000);
}
