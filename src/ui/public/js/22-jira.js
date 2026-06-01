// ── Jira Integration admin panel ─────────────────────────────────────

async function jiraConfigLoad() {
  try {
    const r = await fetch('/api/jira/config');
    const cfg = await r.json();
    if (!cfg) {
      document.getElementById('jira-status-badge').textContent = 'Not configured';
      return;
    }
    // OLD: document.getElementById('jira-project-key').value = cfg.projectKey || '';
    // projectKey is now per-project (Admin → Project Management → Jira Project Key)
    document.getElementById('jira-issue-type').value = cfg.issueType || 'Defect';
    document.getElementById('jira-default-priority').value = cfg.defaultPriority || 'Medium';
    document.getElementById('jira-close-transition').value = cfg.closeTransitionName || 'Closed';
    document.getElementById('jira-max-attach-mb').value = cfg.maxAttachmentMB || 50;
    const baseUrlEl = document.getElementById('jira-base-url');
    if (baseUrlEl) baseUrlEl.value = cfg.baseUrl || '';
    const emailEl = document.getElementById('jira-creds-email');
    if (emailEl) emailEl.value = cfg.email || '';
    const tokenEl = document.getElementById('jira-creds-token');
    if (tokenEl) tokenEl.placeholder = cfg.hasTokenSet ? '(token set — leave blank to keep)' : 'Paste API token';
    if (cfg.parentLinkFieldId) {
      const sel = document.getElementById('jira-parent-field');
      sel.innerHTML = `<option value="${cfg.parentLinkFieldId}">${cfg.parentLinkFieldId} (saved)</option>`;
    }
    if (cfg.referSSFieldId) {
      const sel = document.getElementById('jira-refer-ss-field');
      sel.innerHTML = `<option value="${cfg.referSSFieldId}">${cfg.referSSFieldId} (saved)</option>`;
    }
    document.getElementById('jira-status-badge').textContent = '✓ Configured';
  } catch (e) {
    document.getElementById('jira-status-badge').textContent = 'Load failed';
  }
}

async function jiraTestConnection() {
  const msg = document.getElementById('jira-config-msg');
  msg.textContent = '⏳ Testing...'; msg.style.color = '';
  const r = await fetch('/api/jira/test', { method: 'POST' });
  const j = await r.json();
  if (j.ok) { msg.style.color = '#16a34a'; msg.textContent = `✓ Connected as ${j.user || 'unknown'}`; }
  else { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j.error || j?.error?.message || 'Connection failed'}`; }
}

async function jiraDiscoverFields() {
  const msg = document.getElementById('jira-config-msg');
  msg.textContent = '⏳ Discovering...'; msg.style.color = '';
  const r = await fetch('/api/jira/fields');
  const j = await r.json();
  if (!r.ok) { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j?.error?.message || 'Discovery failed'}`; return; }
  const fields = (j.fields || []).filter(f => f.custom);
  const opts = fields.map(f => `<option value="${f.id}">${f.name} (${f.id})</option>`).join('');
  document.getElementById('jira-parent-field').innerHTML = '<option value="">— pick parent field —</option>' + opts;
  document.getElementById('jira-refer-ss-field').innerHTML = '<option value="">— none —</option>' + opts;
  msg.style.color = '#16a34a'; msg.textContent = `✓ ${fields.length} custom fields loaded`;
}

async function jiraConfigSave() {
  const body = {
    // OLD: projectKey: document.getElementById('jira-project-key').value.trim(),
    // projectKey is now per-project — not sent in global config save
    issueType: document.getElementById('jira-issue-type').value.trim(),
    defaultPriority: document.getElementById('jira-default-priority').value,
    parentLinkFieldId: document.getElementById('jira-parent-field').value,
    referSSFieldId: document.getElementById('jira-refer-ss-field').value,
    closeTransitionName: document.getElementById('jira-close-transition').value.trim(),
    maxAttachmentMB: Number(document.getElementById('jira-max-attach-mb').value) || 50,
    baseUrl: (document.getElementById('jira-base-url')?.value || '').trim(),
    email: (document.getElementById('jira-creds-email')?.value || '').trim(),
    apiToken: (document.getElementById('jira-creds-token')?.value || ''),
  };
  const msg = document.getElementById('jira-config-msg');
  const r = await fetch('/api/jira/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.ok) {
    msg.style.color = '#16a34a'; msg.textContent = '✓ Saved';
    document.getElementById('jira-status-badge').textContent = '✓ Configured';
    const tokenEl = document.getElementById('jira-creds-token');
    if (tokenEl) { tokenEl.value = ''; tokenEl.placeholder = '(token set — leave blank to keep)'; }
  } else { msg.style.color = '#dc2626'; msg.textContent = `✗ ${j?.error?.message || 'Save failed'}`; }
}
