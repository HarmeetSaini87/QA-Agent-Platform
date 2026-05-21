/* 30-governance.js — Governance tab: tenant card, audit log, policy list */

function governanceInit(panel) {
  panel.innerHTML = [
    '<h2 style="margin-bottom:16px;">&#x1F3DB;&#xFE0F; Enterprise Governance</h2>',
    '<h4>Tenant Context</h4>',
    '<div id="governance-tenant-card"><span class="text-muted">Loading...</span></div>',
    '<h4 style="margin-top:24px;">Audit Log <span id="governance-audit-count" class="text-muted" style="font-size:0.8em;"></span></h4>',
    '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">',
    '  <input id="governance-audit-action-filter" type="text" placeholder="Filter by action..." style="padding:4px 8px;border:1px solid var(--border-color,#334155);background:var(--bg-secondary,#0f172a);color:inherit;border-radius:4px;width:200px;" />',
    '  <input id="governance-audit-rid-filter" type="text" placeholder="Filter by resource ID..." style="padding:4px 8px;border:1px solid var(--border-color,#334155);background:var(--bg-secondary,#0f172a);color:inherit;border-radius:4px;width:200px;" />',
    '  <button onclick="governanceAuditFilter()" style="padding:4px 12px;border-radius:4px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;cursor:pointer;">Filter</button>',
    '  <button onclick="governanceLoadAuditLog()" style="padding:4px 12px;border-radius:4px;border:1px solid #475569;background:#1e293b;color:#e2e8f0;cursor:pointer;">Reset</button>',
    '</div>',
    '<div style="overflow-x:auto;">',
    '  <table style="width:100%;border-collapse:collapse;">',
    '    <thead><tr style="font-size:0.8em;color:var(--text-muted);">',
    '      <th style="padding:6px 8px;text-align:left;">Time</th>',
    '      <th style="padding:6px 8px;text-align:left;">User</th>',
    '      <th style="padding:6px 8px;text-align:left;">Action</th>',
    '      <th style="padding:6px 8px;text-align:left;">Resource Type</th>',
    '      <th style="padding:6px 8px;text-align:left;">Resource ID</th>',
    '      <th style="padding:6px 8px;text-align:left;">Details</th>',
    '    </tr></thead>',
    '    <tbody id="governance-audit-tbody"><tr><td colspan="6" style="color:var(--text-muted);padding:8px;">Select Governance tab to load.</td></tr></tbody>',
    '  </table>',
    '</div>',
    '<h4 style="margin-top:28px;">Governance Policies</h4>',
    '<div id="governance-policies-list"><span class="text-muted">Loading...</span></div>',
    '<h4 style="margin-top:24px;">Register New Policy</h4>',
    '<form id="governance-policy-form" style="max-width:480px;" onsubmit="governanceSubmitPolicy(event)">',
    '  <div style="margin-bottom:8px;"><label style="display:block;font-size:0.85em;margin-bottom:2px;">Policy ID</label>',
    '    <input id="gov-policy-id" type="text" required placeholder="e.g. prod-gate" style="width:100%;padding:4px 8px;background:var(--bg-secondary,#0f172a);border:1px solid var(--border-color,#334155);color:inherit;border-radius:4px;" /></div>',
    '  <div style="margin-bottom:8px;"><label style="display:block;font-size:0.85em;margin-bottom:2px;">Name</label>',
    '    <input id="gov-policy-name" type="text" required placeholder="e.g. Production Execution Gate" style="width:100%;padding:4px 8px;background:var(--bg-secondary,#0f172a);border:1px solid var(--border-color,#334155);color:inherit;border-radius:4px;" /></div>',
    '  <div style="margin-bottom:8px;"><label style="display:block;font-size:0.85em;margin-bottom:2px;">Allowed Roles <span style="color:var(--text-muted);">(comma-separated)</span></label>',
    '    <input id="gov-policy-roles" type="text" placeholder="admin,editor,tester" style="width:100%;padding:4px 8px;background:var(--bg-secondary,#0f172a);border:1px solid var(--border-color,#334155);color:inherit;border-radius:4px;" /></div>',
    '  <div style="margin-bottom:8px;"><label style="display:block;font-size:0.85em;margin-bottom:2px;">Restricted Env IDs <span style="color:var(--text-muted);">(comma-separated, blank = none)</span></label>',
    '    <input id="gov-policy-envs" type="text" placeholder="env-prod,env-uat" style="width:100%;padding:4px 8px;background:var(--bg-secondary,#0f172a);border:1px solid var(--border-color,#334155);color:inherit;border-radius:4px;" /></div>',
    '  <div style="margin-bottom:8px;display:flex;gap:16px;">',
    '    <label><input id="gov-policy-approval" type="checkbox" /> Requires Approval</label>',
    '    <label><input id="gov-policy-teardown" type="checkbox" /> Teardown Protected</label>',
    '  </div>',
    '  <button type="submit" style="padding:6px 16px;border-radius:4px;background:#2563eb;color:#fff;border:none;cursor:pointer;">Register Policy</button>',
    '  <span id="gov-policy-status" style="margin-left:12px;font-size:0.85em;color:var(--text-muted);"></span>',
    '</form>',
  ].join('\n');

  governanceLoad();
}

function governanceLoad() {
  governanceLoadTenantContext();
  governanceLoadAuditLog();
  governanceLoadPolicies();
}

function governanceLoadTenantContext() {
  var el = document.getElementById('governance-tenant-card');
  if (!el) return;

  fetch('/api/governance/tenant', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.singleTenant) {
        el.innerHTML = '<div class="governance-card"><span class="gov-policy-badge">Single-Tenant Mode</span><p style="margin:6px 0 0;color:var(--text-muted);font-size:0.85em;">No tenant isolation active. All users share a single environment.</p></div>';
      } else {
        var t = data.tenant;
        el.innerHTML = '<div class="governance-card">'
          + '<span class="gov-policy-badge gov-policy-badge--active">Multi-Tenant</span>'
          + '<p style="margin:6px 0 0;font-size:0.85em;"><strong>ID:</strong> ' + escHtml(t.tenantId)
          + ' &nbsp; <strong>Name:</strong> ' + escHtml(t.tenantName)
          + ' &nbsp; <strong>Mode:</strong> ' + escHtml(t.isolationMode) + '</p>'
          + '</div>';
      }
    })
    .catch(function(err) {
      var el2 = document.getElementById('governance-tenant-card');
      if (el2) el2.innerHTML = '<p style="color:#ef4444;">Failed to load tenant context: ' + escHtml(String(err)) + '</p>';
    });
}

function governanceLoadAuditLog(action, resourceId) {
  var tbody = document.getElementById('governance-audit-tbody');
  var countEl = document.getElementById('governance-audit-count');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);padding:8px;">Loading…</td></tr>';

  var url = '/api/governance/audit?limit=50';
  if (action)     url += '&action='     + encodeURIComponent(action);
  if (resourceId) url += '&resourceId=' + encodeURIComponent(resourceId);

  fetch(url, { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (countEl) countEl.textContent = data.total + ' entries';
      if (!data.entries || data.entries.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted);padding:8px;">No audit entries found.</td></tr>';
        return;
      }
      tbody.innerHTML = data.entries.map(function(e) {
        var ts = e.createdAt ? e.createdAt.replace('T', ' ').slice(0, 19) : '';
        return '<tr class="gov-audit-row">'
          + '<td>' + escHtml(ts) + '</td>'
          + '<td>' + escHtml(e.username || e.userId || '—') + '</td>'
          + '<td><span class="gov-audit-badge">' + escHtml(e.action) + '</span></td>'
          + '<td>' + escHtml(e.resourceType || '—') + '</td>'
          + '<td>' + escHtml(e.resourceId || '—') + '</td>'
          + '<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);">' + escHtml(e.details || '') + '</td>'
          + '</tr>';
      }).join('');
    })
    .catch(function(err) {
      tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444;padding:8px;">Error: ' + escHtml(String(err)) + '</td></tr>';
    });
}

function governanceAuditFilter() {
  var action     = (document.getElementById('governance-audit-action-filter')?.value || '').trim();
  var resourceId = (document.getElementById('governance-audit-rid-filter')?.value || '').trim();
  governanceLoadAuditLog(action || undefined, resourceId || undefined);
}

function governanceLoadPolicies() {
  var container = document.getElementById('governance-policies-list');
  if (!container) return;

  container.innerHTML = '<span style="color:var(--text-muted);">Loading…</span>';

  fetch('/api/governance/policies', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (!data.policies || data.policies.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85em;">No governance policies registered.</p>';
        return;
      }
      container.innerHTML = data.policies.map(function(p) {
        var badgeClass = p.requiresApproval ? 'gov-policy-badge--approval' : 'gov-policy-badge--active';
        return '<div class="gov-policy-row">'
          + '<span class="gov-policy-badge ' + badgeClass + '">' + escHtml(p.name) + '</span>'
          + ' <span style="color:var(--text-muted);font-size:0.78em;">[' + escHtml(p.policyId) + ']</span>'
          + '<ul style="margin:6px 0 0;padding-left:18px;font-size:0.82em;">'
          + '<li>Allowed roles: ' + p.allowedRoles.map(function(r) { return escHtml(r); }).join(', ') + '</li>'
          + '<li>Restricted envs: ' + (p.restrictedEnvironmentIds.length ? p.restrictedEnvironmentIds.map(function(e) { return escHtml(e); }).join(', ') : 'none') + '</li>'
          + '<li>Requires approval: ' + (p.requiresApproval ? 'Yes' : 'No') + '</li>'
          + '<li>Teardown protected: ' + (p.teardownProtected ? 'Yes' : 'No') + '</li>'
          + (p.maxRetries !== undefined ? '<li>Max retries: ' + p.maxRetries + '</li>' : '')
          + '</ul></div>';
      }).join('');
    })
    .catch(function(err) {
      container.innerHTML = '<p style="color:#ef4444;">Error: ' + escHtml(String(err)) + '</p>';
    });
}

function governanceSubmitPolicy(event) {
  event.preventDefault();
  var policyId   = (document.getElementById('gov-policy-id')?.value || '').trim();
  var name       = (document.getElementById('gov-policy-name')?.value || '').trim();
  var rolesRaw   = (document.getElementById('gov-policy-roles')?.value || '').trim();
  var envsRaw    = (document.getElementById('gov-policy-envs')?.value || '').trim();
  var approval   = document.getElementById('gov-policy-approval')?.checked || false;
  var teardown   = document.getElementById('gov-policy-teardown')?.checked || false;
  var statusEl   = document.getElementById('gov-policy-status');

  if (!policyId || !name) {
    if (statusEl) statusEl.textContent = 'Policy ID and Name are required.';
    return;
  }

  var payload = {
    policyId:                 policyId,
    name:                     name,
    requiresApproval:         approval,
    allowedRoles:             rolesRaw ? rolesRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : ['admin', 'editor', 'tester'],
    restrictedEnvironmentIds: envsRaw  ? envsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean)  : [],
    teardownProtected:        teardown,
  };

  fetch('/api/governance/policies', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify(payload),
  })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) {
        if (statusEl) statusEl.textContent = 'Error: ' + data.error;
        return;
      }
      if (statusEl) statusEl.textContent = 'Policy \'' + escHtml(data.policy.name) + '\' registered.';
      document.getElementById('governance-policy-form')?.reset();
      governanceLoadPolicies();
    })
    .catch(function(err) {
      if (statusEl) statusEl.textContent = 'Error: ' + String(err);
    });
}

if (typeof registerPageModule === 'function') {
  registerPageModule('governance', governanceInit);
}
