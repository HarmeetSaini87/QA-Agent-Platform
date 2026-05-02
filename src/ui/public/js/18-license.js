// ══════════════════════════════════════════════════════════════════════════════
// P1: LICENSE MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

async function licenseLoad() {
  try {
    const [licRes, machineRes, auditRes, sessionsRes] = await Promise.all([
      fetch('/api/admin/license'),
      fetch('/api/admin/license/machine'),
      fetch('/api/admin/license/audit'),
      fetch('/api/admin/license/sessions'),
    ]);
    const data = licRes.ok ? await licRes.json() : { activated: false };
    const machine = machineRes.ok ? await machineRes.json() : null;
    const audit = auditRes.ok ? await auditRes.json() : [];
    const sessData = sessionsRes.ok ? await sessionsRes.json() : { sessions: [], seatsUsed: 0 };

    // P3-05: Always populate Machine ID display (needed before activation)
    const machineDisplay = document.getElementById('lic-machineid-display');
    if (machineDisplay) {
      machineDisplay.textContent = machine
        ? (machine.currentMachineId ?? machine.currentMachineIdHint ?? '—')
        : '(unavailable)';
    }

    _renderLicensePanel(data, machine, audit, sessData.sessions ?? []);
  } catch (err) {
    console.error('[licenseLoad] error:', err);
    const machineDisplay = document.getElementById('lic-machineid-display');
    if (machineDisplay && machineDisplay.textContent === 'Loading…') {
      machineDisplay.textContent = '(error loading)';
    }
  }
}

// P3-05: Copy full Machine ID to clipboard
async function licenseCopyMachineId() {
  const el = document.getElementById('lic-machineid-display');
  const id = el?.textContent?.trim() ?? '';
  if (!id || id === 'Loading…') return;
  try {
    await navigator.clipboard.writeText(id);
    const btn = document.getElementById('lic-copy-machineid-btn');
    if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Machine ID'; }, 2000); }
  } catch {
    prompt('Copy this Machine ID and send it to your vendor:', id);
  }
}

function _renderLicensePanel(data, machine, audit, sessions) {
  const statusBlock = document.getElementById('lic-status-block');
  const activateBlock = document.getElementById('lic-activate-block');
  const alertEl = document.getElementById('license-alert');
  if (!statusBlock || !activateBlock) return;
  alertEl.innerHTML = '';

  const preActivateEl = document.getElementById('lic-machineid-preactivate');
  if (!data.activated) {
    statusBlock.style.display = 'none';
    activateBlock.style.display = '';
    if (preActivateEl) preActivateEl.style.display = '';
    return;
  }
  if (preActivateEl) preActivateEl.style.display = 'none';

  // Show status block
  statusBlock.style.display = '';

  // Auto-trial: show activate form alongside status so admin can enter key
  activateBlock.style.display = data.isAutoTrial ? '' : 'none';

  // Trial banner
  const existingBanner = document.getElementById('lic-trial-banner');
  if (existingBanner) existingBanner.remove();
  if (data.isAutoTrial) {
    const days = data.trialDaysLeft ?? 0;
    const urgent = days <= 3;
    const banner = document.createElement('div');
    banner.id = 'lic-trial-banner';
    banner.style.cssText = `margin-bottom:14px;padding:10px 14px;border-radius:6px;font-size:.82rem;display:flex;align-items:center;gap:10px;background:${urgent ? '#450a0a' : '#431407'};border:1px solid ${urgent ? '#dc2626' : '#ea580c'};color:${urgent ? '#fca5a5' : '#fdba74'}`;
    banner.innerHTML = `<span style="font-size:1.1rem">${urgent ? '🔴' : '🟠'}</span>
      <span><strong>${days} day${days !== 1 ? 's' : ''} left on your free trial.</strong>
      Enter a license key below to continue using the platform after the trial ends.</span>`;
    statusBlock.insertAdjacentElement('afterbegin', banner);
  }

  const tierBadge = document.getElementById('lic-tier-badge');
  tierBadge.textContent = data.isAutoTrial ? 'TRIAL (AUTO)' : data.tier.toUpperCase();
  tierBadge.className = `lic-badge lic-badge-${data.tier}`;

  document.getElementById('lic-org-name').textContent = data.orgName || data.orgId;

  const expiryChip = document.getElementById('lic-expiry-chip');
  if (data.expired) {
    expiryChip.textContent = 'EXPIRED';
    expiryChip.className = 'lic-chip lic-chip-red';
  } else if (data.daysLeft <= 14) {
    expiryChip.textContent = `Expires in ${data.daysLeft} days`;
    expiryChip.className = 'lic-chip lic-chip-amber';
  } else {
    expiryChip.textContent = `Expires ${new Date(data.expiresAt).toLocaleDateString()}`;
    expiryChip.className = 'lic-chip lic-chip-green';
  }

  const seatsChip = document.getElementById('lic-seats-chip');
  seatsChip.textContent = data.seats === -1
    ? 'Unlimited seats'
    : `${data.seatsUsed} / ${data.seats} seats`;
  seatsChip.className = 'lic-chip lic-chip-blue';

  const featList = document.getElementById('lic-features-list');
  const f = data.features || {};
  const ov = data.featureOverrides || {};   // P4-01: vendor-signed overrides
  const labels = {
    recorder: 'Recorder', debugger: 'Debugger', scheduler: 'Scheduler',
    sso: 'SSO', apiAccess: 'API Access', whiteLabel: 'White-label'
  };

  // Effective value = override (if present) else tier default
  featList.innerHTML = Object.entries(labels).map(([k, label]) => {
    const effective = k in ov ? ov[k] : f[k];
    const isOverride = k in ov;
    if (!effective) return '';
    const addOnBadge = isOverride && !f[k]
      ? ` <sup title="Granted by vendor add-on" style="color:var(--accent);font-size:.65rem;font-weight:700">+</sup>`
      : '';
    return `<span class="lic-feature-chip">${label}${addOnBadge}</span>`;
  }).join('');

  // P4-01: Show revoked features (tier has it, override removes it)
  const revokedEl = document.getElementById('lic-revoked-features');
  if (revokedEl) {
    const revoked = Object.entries(labels)
      .filter(([k]) => k in ov && ov[k] === false && f[k] === true)
      .map(([, label]) => `<span class="lic-feature-chip" style="text-decoration:line-through;opacity:.5">${label}</span>`);
    revokedEl.innerHTML = revoked.length
      ? `<div style="margin-top:6px;font-size:.72rem;color:var(--text-muted)">Revoked by vendor: ${revoked.join('')}</div>`
      : '';
  }

  // P1-EG-06: Machine binding status
  const machineEl = document.getElementById('lic-machine-block');
  if (machineEl && machine) {
    const bound = machine.boundMachineId;
    const match = machine.match;
    const matchBadge = match === true
      ? `<span class="lic-chip lic-chip-green" style="font-size:.72rem">Bound ✓</span>`
      : match === false
        ? `<span class="lic-chip lic-chip-red" style="font-size:.72rem">Mismatch ⚠</span>`
        : `<span class="lic-chip" style="font-size:.72rem">Unbound</span>`;
    machineEl.innerHTML = `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:6px">Machine Binding</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <code style="font-size:.78rem;color:var(--text-secondary)">${_escHtml(bound ? machine.boundMachineIdHint : machine.currentMachineIdHint)}</code>
          ${matchBadge}
          ${match === false ? `<button class="btn btn-outline btn-sm" onclick="licenseTransfer()" style="color:var(--warning)">Transfer to this machine</button>` : ''}
        </div>
        ${data.maxInstances && data.maxInstances !== -1 ? `<div style="font-size:.72rem;color:var(--text-muted);margin-top:4px">Max ${data.maxInstances} server instance${data.maxInstances === 1 ? '' : 's'} allowed</div>` : ''}
      </div>`;
  }

  // P2-02: Active Seat Dashboard
  const sessionsEl = document.getElementById('lic-sessions-block');
  if (sessionsEl) {
    const activeSessions = Array.isArray(sessions) ? sessions : [];
    const seatsUsed = data.seatsUsed ?? 0;
    const seatsTotal = data.seats === -1 ? '∞' : (data.seats ?? '—');
    const ratio = data.seatRatio ?? -1;
    const barPct = ratio === -1 ? 0 : Math.min(100, Math.round(ratio * 100));
    const barColor = ratio >= 0.9 ? '#ef4444' : ratio >= 0.8 ? '#f59e0b' : '#22c55e';

    sessionsEl.innerHTML = `
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="font-size:.78rem;color:var(--text-muted)">Active Sessions &mdash; ${seatsUsed} of ${seatsTotal} seats</div>
          <button class="btn btn-outline btn-sm" onclick="licenseLoad()" style="font-size:.72rem;padding:3px 8px">Refresh</button>
        </div>
        ${ratio !== -1 ? `
        <div style="height:6px;background:rgba(255,255,255,.08);border-radius:3px;margin-bottom:10px;overflow:hidden">
          <div style="height:100%;width:${barPct}%;background:${barColor};border-radius:3px;transition:width .3s"></div>
        </div>` : ''}
        ${activeSessions.length === 0
        ? `<div style="font-size:.78rem;color:var(--text-muted);padding:8px 0">No active sessions</div>`
        : `<table style="width:100%;font-size:.74rem;border-collapse:collapse">
              <thead><tr>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">User</th>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Role</th>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Logged in</th>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Last active</th>
                <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">IP</th>
                <th style="padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)"></th>
              </tr></thead>
              <tbody>
                ${activeSessions.map(s => `<tr>
                  <td style="padding:5px 6px;color:var(--text-secondary);font-weight:${s.isCurrent ? '600' : '400'}">${_escHtml(s.username || '—')}${s.isCurrent ? ' <span style="font-size:.68rem;color:#60a5fa">(you)</span>' : ''}</td>
                  <td style="padding:5px 6px"><span class="badge badge-${s.role || 'tester'}">${_escHtml(s.role || '—')}</span></td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${s.loginAt ? new Date(s.loginAt).toLocaleTimeString() : '—'}</td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${s.lastActivity ? new Date(s.lastActivity).toLocaleTimeString() : '—'}</td>
                  <td style="padding:5px 6px;color:var(--text-muted)">${_escHtml(s.ip || '—')}</td>
                  <td style="padding:5px 6px">
                    ${s.isCurrent ? '' : `<button class="tbl-btn del" onclick="licenseRevokeSession('${_escHtml(s.sessionId)}','${_escHtml(s.username || '')}')" title="Force logout">Revoke</button>`}
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>`}
      </div>`;
    sessionsEl.style.display = '';
  }

  // P3-11: License Audit Log
  const auditEl = document.getElementById('lic-audit-block');
  if (auditEl && Array.isArray(audit) && audit.length > 0) {
    const ACTION_LABELS = {
      LICENSE_ACTIVATED: '&#9989; Activated',
      LICENSE_DEACTIVATED: '&#128683; Deactivated',
      LICENSE_TRANSFERRED: '&#128260; Transferred',
      LICENSE_EXPIRED: '&#128308; Expired',
    };
    auditEl.innerHTML = `
      <details style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.07)">
        <summary style="cursor:pointer;font-size:.78rem;color:var(--text-muted);user-select:none">License Audit Log (${audit.length} events)</summary>
        <table style="width:100%;margin-top:8px;font-size:.74rem;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Time</th>
            <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Event</th>
            <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">User</th>
            <th style="text-align:left;color:var(--text-muted);padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.07)">Details</th>
          </tr></thead>
          <tbody>
            ${audit.map(e => `<tr>
              <td style="padding:4px 6px;color:var(--text-secondary)">${new Date(e.ts || e.timestamp || '').toLocaleString()}</td>
              <td style="padding:4px 6px">${ACTION_LABELS[e.action] || _escHtml(e.action)}</td>
              <td style="padding:4px 6px;color:var(--text-secondary)">${_escHtml(e.username || e.userId || '—')}</td>
              <td style="padding:4px 6px;color:var(--text-secondary)">${_escHtml(e.details || '')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </details>`;
    auditEl.style.display = '';
  } else if (auditEl) {
    auditEl.style.display = 'none';
  }
}

async function licenseActivate() {
  const key = (document.getElementById('lic-key-input').value || '').trim();
  const alert = document.getElementById('license-alert');
  if (!key) { alert.innerHTML = '<div class="alert alert-error">Enter a license key</div>'; return; }
  alert.innerHTML = '<div class="alert alert-info">Activating…</div>';
  const res = await fetch('/api/admin/license/activate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json();
  if (!res.ok) {
    alert.innerHTML = `<div class="alert alert-error">${escHtml(data.error)}</div>`;
    return;
  }
  alert.innerHTML = `<div class="alert alert-success">License activated — ${data.tier.toUpperCase()} tier for ${_escHtml(data.orgName)}</div>`;
  document.getElementById('lic-key-input').value = '';
  licenseLoad();
  licenseCheckBanner();
}

async function licenseActivateFile() {
  const fileInput = document.getElementById('lic-file-input');
  const file = fileInput.files[0];
  if (!file) return;
  const alert = document.getElementById('license-alert');
  alert.innerHTML = '<div class="alert alert-info">Uploading .lic file…</div>';
  const form = new FormData();
  form.append('licFile', file);
  const res = await fetch('/api/admin/license/activate', { method: 'POST', body: form });
  const data = await res.json();
  fileInput.value = '';
  if (!res.ok) {
    alert.innerHTML = `<div class="alert alert-error">${escHtml(data.error)}</div>`;
    return;
  }
  alert.innerHTML = `<div class="alert alert-success">License activated — ${data.tier.toUpperCase()} tier</div>`;
  licenseLoad();
  licenseCheckBanner();
}

// P2-02: Force-logout a session (frees a seat)
async function licenseRevokeSession(sessionId, username) {
  if (!confirm(`Force-logout ${username || 'this user'}? Their current work may be lost.`)) return;
  const res = await fetch(`/api/admin/license/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Failed to revoke session'); return; }
  licenseLoad();
}

// P3-07: Download seat audit report CSV
function licenseExportSeatReport() {
  const a = document.createElement('a');
  a.href = '/api/admin/license/seat-report';
  a.download = `seat-report-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function licenseDeactivate() {
  if (!confirm('Deactivate license? The platform will continue in dev mode.')) return;
  await fetch('/api/admin/license', { method: 'DELETE' });
  licenseLoad();
  licenseCheckBanner();
}

async function licenseTransfer() {
  if (!confirm('Transfer this license to the current machine?\n\nThis will re-bind the license to this machine\'s hardware fingerprint. The previous machine will no longer be able to use this license.')) return;
  const alert = document.getElementById('license-alert');
  alert.innerHTML = '<div class="alert alert-info">Transferring license…</div>';
  const res = await fetch('/api/admin/license/transfer', { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    alert.innerHTML = `<div class="alert alert-error">${escHtml(data.error)}</div>`;
    return;
  }
  alert.innerHTML = `<div class="alert alert-success">License transferred and bound to this machine.</div>`;
  licenseLoad();
}

// P1-09 / P3-09: Check license status — show banner + read-only mode (P1-10)
async function licenseCheckBanner() {
  const banner = document.getElementById('license-banner');
  if (!banner) return;
  try {
    const res = await fetch('/api/admin/license');
    if (!res.ok) { banner.style.display = 'none'; return; }
    const data = await res.json();
    if (!data.activated) { banner.style.display = 'none'; document.body.classList.remove('lic-readonly'); return; }

    // P2-04: 80% seat warning — shown to admin only
    if (data.seatRatio !== -1 && data.seatRatio >= 0.8 && !data.expired) {
      const pct = Math.round(data.seatRatio * 100);
      const used = data.seatsUsed, total = data.seats;
      document.getElementById('license-banner-seats')?.remove?.();
      const seatBanner = document.createElement('div');
      seatBanner.id = 'license-banner-seats';
      seatBanner.className = 'lic-warn';
      seatBanner.style.cssText = 'display:flex;margin-bottom:4px';
      seatBanner.innerHTML = `&#9888;&#65039; <strong>${used} of ${total} seats</strong> in use (${pct}%) &mdash; consider upgrading your license.`;
      banner.parentNode?.insertBefore(seatBanner, banner);
    } else {
      document.getElementById('license-banner-seats')?.remove?.();
    }

    if (data.expired) {
      banner.innerHTML = '&#128308; Your QA Agent Platform license has <strong>expired</strong>. Contact your vendor to renew.';
      banner.className = 'lic-error';
      banner.style.display = 'flex';
      document.body.classList.add('lic-readonly');  // P1-10
    } else if (data.isAutoTrial) {
      const days = data.trialDaysLeft ?? data.daysLeft;
      const urgent = days <= 3;
      banner.innerHTML = `${urgent ? '🔴' : '🟠'} <strong>Free Trial — ${days} day${days !== 1 ? 's' : ''} remaining.</strong> &nbsp;
        <a onclick="switchTab('admin');setTimeout(()=>adminSubTab('license',document.querySelector('.sub-tab:nth-child(4)')),100)" href="#"
           style="color:inherit;font-weight:600;text-decoration:underline">Activate your license key &rarr;</a>`;
      banner.className = urgent ? 'lic-error' : 'lic-warn';
      banner.style.display = 'flex';
      document.body.classList.remove('lic-readonly');
    } else if (data.tier === 'trial') {
      // Vendor-issued trial key
      banner.innerHTML = `&#128203; <strong>Trial License</strong> &mdash; expires in <strong>${data.daysLeft} day${data.daysLeft !== 1 ? 's' : ''}</strong>. <a href="mailto:sales@qa-agent.io" style="color:inherit;font-weight:600;margin-left:4px">Purchase a license &rarr;</a>`;
      banner.className = 'lic-info';
      banner.style.display = 'flex';
      document.body.classList.remove('lic-readonly');
    } else if (data.daysLeft <= 14) {
      banner.innerHTML = `&#9888;&#65039; License expires in <strong>${data.daysLeft} day${data.daysLeft !== 1 ? 's' : ''}</strong> &mdash; contact your vendor to renew.`;
      banner.className = 'lic-warn';
      banner.style.display = 'flex';
      document.body.classList.remove('lic-readonly');
    } else {
      banner.style.display = 'none';
      document.body.classList.remove('lic-readonly');
    }
  } catch {
    banner.style.display = 'none';
  }
}

// P3-10: Global 402 upgrade CTA handler — wrap fetch() calls that might hit feature gates
// Usage: const data = await fetchWithUpgradeCTA('/api/schedules', opts);
async function fetchWithUpgradeCTA(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    const upgradeTier = (body.upgrade || 'enterprise');
    const tierLabel = upgradeTier === 'team' ? 'Team' : 'Enterprise';
    const feature = body.feature || 'this feature';
    showUpgradeCTA(feature, tierLabel);
    return null;  // caller checks null to abort
  }
  return res;
}

function showUpgradeCTA(feature, tierLabel) {
  const existing = document.getElementById('upgrade-cta-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'upgrade-cta-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = `
    <div style="background:#1e2433;border:1px solid #3b4560;border-radius:8px;padding:32px;max-width:420px;text-align:center">
      <div style="font-size:32px;margin-bottom:12px">&#128274;</div>
      <h3 style="color:#e2e8f0;margin:0 0 8px">${_escHtml(feature.charAt(0).toUpperCase() + feature.slice(1))} not available</h3>
      <p style="color:#94a3b8;margin:0 0 20px">This feature requires the <strong style="color:#60a5fa">${_escHtml(tierLabel)}</strong> plan.</p>
      <p style="color:#64748b;font-size:13px;margin:0 0 24px">Contact your vendor to upgrade your license.</p>
      <button onclick="document.getElementById('upgrade-cta-modal').remove()"
        style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:10px 24px;cursor:pointer;font-size:14px">
        Got it
      </button>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

