// ── Locator Health ────────────────────────────────────────────────────────────

async function locatorHealthLoad() {
  const pid = currentProjectId;
  if (!pid) return;
  try {
    const res = await fetch(`/api/locator-health?projectId=${encodeURIComponent(pid)}`);
    const data = await res.json();
    locatorHealthRender(data);
  } catch (e) {
    document.getElementById('locator-health-empty').style.display = '';
    document.getElementById('locator-health-empty').textContent = 'Failed to load: ' + e.message;
    document.getElementById('locator-health-table').style.display = 'none';
    document.getElementById('locator-health-summary').innerHTML = '';
  }
}

function locatorHealthRender(rows) {
  const summary = document.getElementById('locator-health-summary');
  const empty = document.getElementById('locator-health-empty');
  const table = document.getElementById('locator-health-table');
  const tbody = document.getElementById('locator-health-tbody');

  empty.style.display = 'none';
  table.style.display = '';

  if (!rows || rows.length === 0) {
    summary.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:20px">No healing events recorded for this project</td></tr>';
    return;
  }

  const totalHeals = rows.reduce((s, r) => s + r.healCount, 0);
  const autoCount = rows.filter(r => r.lastHealedBy === 'auto').length;
  const avgConf = rows.filter(r => r.avgConfidence != null).length
    ? Math.round(rows.filter(r => r.avgConfidence != null).reduce((s, r) => s + r.avgConfidence, 0) / rows.filter(r => r.avgConfidence != null).length)
    : '—';

  summary.innerHTML = `
    <div class="stat-card"><div class="stat-value">${rows.length}</div><div class="stat-label">Healed Locators</div></div>
    <div class="stat-card"><div class="stat-value">${totalHeals}</div><div class="stat-label">Total Heal Events</div></div>
    <div class="stat-card"><div class="stat-value">${autoCount}</div><div class="stat-label">Auto-Healed</div></div>
    <div class="stat-card"><div class="stat-value">${avgConf}%</div><div class="stat-label">Avg Confidence</div></div>
  `;

  tbody.innerHTML = rows.map(r => {
    const latest = r.recentEvents && r.recentEvents[0];
    const oldSel = latest?.oldSelector ? escHtml(latest.oldSelector.slice(0, 40)) + (latest.oldSelector.length > 40 ? '…' : '') : '—';
    const newSel = latest?.newSelector ? escHtml(latest.newSelector.slice(0, 40)) + (latest.newSelector.length > 40 ? '…' : '') : '—';
    const badge = r.lastHealedBy === 'auto'
      ? '<span class="badge badge-success">auto</span>'
      : r.lastHealedBy
        ? `<span class="badge badge-info">${escHtml(r.lastHealedBy)}</span>`
        : '—';
    const conf = r.avgConfidence != null ? `<span class="${r.avgConfidence >= 75 ? 'text-success' : 'text-warning'}">${r.avgConfidence}%</span>` : '—';
    const date = r.lastHealedAt ? new Date(r.lastHealedAt).toLocaleDateString() : '—';
    return `<tr>
      <td>${escHtml(r.name)}</td>
      <td><code style="font-size:11px">${escHtml((r.selector || '').slice(0, 50))}</code></td>
      <td style="text-align:center"><strong>${r.healCount}</strong></td>
      <td style="text-align:center">${conf}</td>
      <td>${date}</td>
      <td>${badge}</td>
      <td style="font-size:11px"><span style="color:var(--text-muted)">${oldSel}</span> → ${newSel}</td>
    </tr>`;
  }).join('');
}

