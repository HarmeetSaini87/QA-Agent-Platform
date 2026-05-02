// ══════════════════════════════════════════════════════════════════════════════
// LOCATOR REPOSITORY
// ══════════════════════════════════════════════════════════════════════════════

let allLocators = [];
let selectedLocators = new Set();
let editingLocatorId = null;
let _locPage = 0;
const LOC_PAGE_SIZE = 10;

async function locatorLoad() {
  if (!currentProjectId) {
    allLocators = [];
    _locPage = 0;
    selectedLocators.clear();
    const tbody = document.getElementById('loc-tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">Select a project to view locators.</td></tr>';
    const pg = document.getElementById('loc-pagination');
    if (pg) pg.innerHTML = '';
    return;
  }
  const res = await fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}`);
  allLocators = await res.json();
  _locPage = 0;
  selectedLocators.clear();
  locatorRender();
}

function locatorRender() {
  const nameF = (document.getElementById('loc-filter-name')?.value ?? '').toLowerCase();
  const typeF = (document.getElementById('loc-filter-type')?.value ?? '').toLowerCase();

  const filtered = allLocators.filter(l =>
    (!nameF || l.name.toLowerCase().includes(nameF)) &&
    (!typeF || (l.selectorType || '').toLowerCase() === typeF)
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / LOC_PAGE_SIZE));
  if (_locPage >= totalPages) _locPage = totalPages - 1;

  const pageItems = filtered.slice(_locPage * LOC_PAGE_SIZE, (_locPage + 1) * LOC_PAGE_SIZE);

  const tbody = document.getElementById('loc-tbody');
  if (!tbody) return;

  tbody.innerHTML = pageItems.map(l => {
    const isAuto = (l.description || '').toLowerCase().includes('auto-captured');
    const autoTag = isAuto ? `<span class="badge" style="background:#7c3aed;color:#fff;font-size:10px;margin-left:4px">Auto</span>` : '';
    const truncSel = l.selector.length > 60 ? `<span title="${escHtml(l.selector)}">${escHtml(l.selector.substring(0, 60))}…</span>` : escHtml(l.selector);

    // ── Stability Badge (pill) ────────────────────────────────────────────────
    // Reflects PRIMARY locator health based on REAL test run history.
    // Colour = how many times the primary locator needed auto-repair during runs.
    let stabilityBadge = '';
    {
      const hs = l.healingStats;
      const healCount = hs?.healCount ?? 0;
      const lastHealed = hs?.lastHealedAt ? new Date(hs.lastHealedAt) : null;
      const daysSinceHeal = lastHealed ? Math.floor((Date.now() - lastHealed.getTime()) / 86400000) : null;
      const hasRunData = healCount > 0 || lastHealed != null;

      let bg, border, color, icon, lbl, tipLines;

      if (!hasRunData) {
        // Never run yet — show design-time selector quality as a hint
        const sc = l.importanceScore ?? null;
        bg = '#f3f4f6'; border = '#d1d5db'; color = '#6b7280'; icon = '⚪'; lbl = 'Not Run Yet';
        tipLines = [
          '📋 STABILITY BADGE — Not Run Yet',
          '',
          'This locator has never been used in a test run.',
          'There is no real evidence yet about how reliable it is.',
          '',
          sc != null
            ? `Selector Quality Score: ${sc}/100`
            : 'No quality score available (manually created locator).',
          sc != null && sc >= 80 ? '→ Well-anchored selector (has testid / aria-label / role).' : '',
          sc != null && sc >= 50 && sc < 80 ? '→ Average selector — some identifiers present.' : '',
          sc != null && sc < 50 ? '→ Weak selector — no stable identifiers. Consider adding data-testid to the element.' : '',
          '',
          'Run a test suite to get a real stability rating.',
        ].filter(x => x !== undefined);
      } else if (healCount === 0) {
        bg = '#dcfce7'; border = '#86efac'; color = '#15803d'; icon = '✔'; lbl = 'Stable';
        tipLines = [
          '🟢 STABILITY BADGE — Stable',
          '',
          'This locator has NEVER needed auto-repair across all test runs.',
          'The element is found reliably every time — no fixes were required.',
          '',
          'What this means for you:',
          '→ Safe to use. No action needed.',
          '→ If the app UI changes, this badge will degrade automatically.',
        ];
      } else if (healCount <= 2 && (daysSinceHeal === null || daysSinceHeal > 7)) {
        bg = '#fef9c3'; border = '#fde047'; color = '#a16207'; icon = '⚠'; lbl = `Healed ×${healCount}`;
        tipLines = [
          '🟡 STABILITY BADGE — Healed (Monitor)',
          '',
          `This locator needed auto-repair ${healCount} time${healCount > 1 ? 's' : ''} during test runs.`,
          `Last repaired: ${hs?.lastHealedAt?.slice(0, 10) ?? '—'}`,
          '',
          'What this means:',
          '→ The test kept running by using a fallback locator.',
          '→ The original locator may be drifting as the app UI changes.',
          '',
          'Recommended action:',
          '→ Open the Healing Proposals tab to review what changed.',
          '→ Consider promoting the fallback to primary if it is more stable.',
        ];
      } else {
        bg = '#fee2e2'; border = '#fca5a5'; color = '#b91c1c'; icon = '✖'; lbl = `Fragile ×${healCount}`;
        tipLines = [
          '🔴 STABILITY BADGE — Fragile (Action Required)',
          '',
          `This locator has broken and needed auto-repair ${healCount} time${healCount > 1 ? 's' : ''}.`,
          `Last repaired: ${hs?.lastHealedAt?.slice(0, 10) ?? '—'}`,
          '',
          'What this means:',
          '→ The primary locator keeps failing — the element has changed significantly.',
          '→ Tests are only passing because a fallback selector took over.',
          '→ This is a risk — if fallbacks also break, tests will fail.',
          '',
          'Recommended action:',
          '→ Go to Healing Proposals → Approve Permanent to fix the primary.',
          '→ Or open this locator (Edit) and update the selector manually.',
          '→ Ask the developer to add a data-testid attribute to the element.',
        ];
      }

      const tip = tipLines.join('\n');
      stabilityBadge = `<span title="${escHtml(tip)}"
        style="display:inline-flex;align-items:center;gap:3px;margin-left:6px;
               padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;
               background:${bg};border:1px solid ${border};color:${color};
               cursor:help;white-space:nowrap;letter-spacing:.2px">
        ${icon} ${lbl}
      </span>`;
    }

    // ── Fallbacks chip ────────────────────────────────────────────────────────
    const alts = l.alternatives || [];
    const altCount = alts.length;
    const altChip = altCount
      ? `<span onclick="locatorToggleAlts('${escHtml(l.id)}')"
           id="loc-alt-chip-${escHtml(l.id)}"
           title="${escHtml('FALLBACK LOCATORS — ' + altCount + ' backup selector' + (altCount > 1 ? 's' : '') + ' stored\n\nIf the primary locator above fails during a test run, the system automatically tries these backups in order from highest to lowest confidence.\n\nClick to expand and see each fallback selector and its confidence score.\nYou can also promote any fallback to become the new primary.')}"
           style="display:inline-flex;align-items:center;gap:3px;margin-left:5px;
                  padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;
                  background:#ede9fe;border:1px solid #c4b5fd;color:#6d28d9;
                  cursor:pointer;white-space:nowrap;user-select:none">
          ⛓ ${altCount} fallback${altCount > 1 ? 's' : ''}
        </span>`
      : '';

    // ── Inline fallbacks expansion rows ──────────────────────────────────────
    const altRows = alts.length ? alts
      .slice()
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
      .map((a, i) => {
        const conf = a.confidence ?? 0;
        // Confidence pill per fallback row
        const confBg = conf >= 80 ? '#dcfce7' : conf >= 60 ? '#fef9c3' : '#fee2e2';
        const confBorder = conf >= 80 ? '#86efac' : conf >= 60 ? '#fde047' : '#fca5a5';
        const confColor = conf >= 80 ? '#15803d' : conf >= 60 ? '#a16207' : '#b91c1c';
        const confLabel = conf >= 80 ? 'High' : conf >= 60 ? 'Medium' : 'Low';
        const confTip = [
          'CONFIDENCE SCORE — ' + conf + '/100 (' + confLabel + ')',
          '',
          'This score shows how reliable this BACKUP selector is expected to be.',
          'It is set at the time the recorder captures the element.',
          '',
          conf >= 80
            ? '✔ High confidence — uses a stable attribute like data-testid or aria-label.\n  Very unlikely to break if the app changes.'
            : conf >= 60
              ? '⚠ Medium confidence — uses a role, label or placeholder.\n  Fairly stable but could break if copy or layout changes.'
              : '✖ Low confidence — uses a structural path (XPath) or name attribute.\n  Will break if the page structure or element position changes.',
          '',
          'Higher score = tried first when primary locator fails.',
          'Lower score = last resort before the test reports a failure.',
        ].join('\n');

        const truncAlt = (a.selector || '').length > 70 ? escHtml((a.selector || '').substring(0, 70)) + '…' : escHtml(a.selector || '');
        const promoteBtn = isViewer() ? '' :
          `<button class="tbl-btn" style="font-size:10px;padding:1px 7px" onclick="locatorPromoteAlt('${escHtml(l.id)}',${i})" title="Set this as the primary locator — current primary moves to fallbacks">Set Primary</button>`;
        return `<tr id="loc-alt-row-${escHtml(l.id)}-${i}" style="display:none;background:var(--neutral-50)">
          <td></td>
          <td colspan="2" style="padding:4px 10px 4px 28px">
            <span style="font-size:10px;color:var(--neutral-400);margin-right:6px">#${i + 1}</span>
            <code style="font-size:11px">${truncAlt}</code>
          </td>
          <td><span class="badge badge-tester" style="font-size:10px">${escHtml(a.selectorType || 'css')}</span></td>
          <td>
            <span title="${escHtml(confTip)}"
              style="display:inline-flex;align-items:center;gap:3px;padding:1px 7px;border-radius:20px;
                     font-size:10px;font-weight:700;background:${confBg};border:1px solid ${confBorder};
                     color:${confColor};cursor:help;white-space:nowrap">
              ${conf}/100 · ${confLabel}
            </span>
          </td>
          <td>${promoteBtn}</td>
        </tr>`;
      }).join('') : '';

    const isChecked = selectedLocators.has(l.id) ? 'checked' : '';
    return `<tr>
      <td style="text-align:center"><input type="checkbox" class="loc-row-check" data-id="${escHtml(l.id)}" ${isChecked} onclick="locatorToggleSelection('${escHtml(l.id)}')"></td>
      <td><strong>${escHtml(l.name)}</strong>${autoTag}${stabilityBadge}${altChip}</td>
      <td><code style="font-size:11px">${truncSel}</code></td>
      <td><span class="badge badge-tester">${escHtml(l.selectorType)}</span></td>
      <td>${escHtml(l.description || '—')}</td>
      <td>
        ${isViewer() ? '' : `<button class="tbl-btn" onclick="locatorEdit('${escHtml(l.id)}')">Edit</button>`}
        ${isViewer() ? '' : `<button class="tbl-btn del" onclick="locatorDelete('${escHtml(l.id)}','${escHtml(l.name)}')">Del</button>`}
      </td>
    </tr>${altRows}`;
  }).join('');

  if (!pageItems.length) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--neutral-400);padding:20px">No locators found</td></tr>';

  // Update Select All checkbox state
  const selectAll = document.getElementById('loc-select-all');
  if (selectAll) {
    selectAll.style.visibility = isViewer() ? 'hidden' : 'visible';
    if (!isViewer()) {
      const allOnPageChecked = pageItems.length > 0 && pageItems.every(l => selectedLocators.has(l.id));
      selectAll.checked = allOnPageChecked;
    }
  }
  locatorUpdateSelectionUI();

  // Pagination controls
  const wrap = document.getElementById('loc-pagination');
  if (wrap) {
    const start = filtered.length ? _locPage * LOC_PAGE_SIZE + 1 : 0;
    const end = Math.min((_locPage + 1) * LOC_PAGE_SIZE, filtered.length);
    wrap.innerHTML = `
      <span style="font-size:13px;color:var(--neutral-500)">${start}–${end} of ${filtered.length}</span>
      <button class="tbl-btn" onclick="_locPageGo(-1)" ${_locPage === 0 ? 'disabled' : ''}>&#8592; Prev</button>
      <span style="font-size:13px">Page ${_locPage + 1} / ${totalPages}</span>
      <button class="tbl-btn" onclick="_locPageGo(1)" ${_locPage >= totalPages - 1 ? 'disabled' : ''}>Next &#8594;</button>`;
  }
}

// ── Locator sub-tab switching ─────────────────────────────────────────────────
function locSubTab(tab) {
  ['repo', 'proposals', 'heallog'].forEach(t => {
    const panel = document.getElementById(`loc-subpanel-${t}`);
    const btn = document.getElementById(`loc-subtab-${t}`);
    if (panel) panel.style.display = t === tab ? '' : 'none';
    if (btn) btn.classList.toggle('loc-subtab-active', t === tab);
  });
  if (tab === 'proposals') proposalLoad();
  if (tab === 'heallog') healLogLoad();
}

// ── Healing Proposals ─────────────────────────────────────────────────────────
let _allProposals = [];

async function proposalLoad() {
  if (!currentProjectId) return;
  try {
    const res = await fetch(`/api/proposals?projectId=${encodeURIComponent(currentProjectId)}`);
    _allProposals = await res.json();
    proposalRender();
    // Update pending count badge on the sub-tab
    const pending = _allProposals.filter(p => p.status === 'pending-review').length;
    const cntEl = document.getElementById('loc-proposal-count');
    if (cntEl) {
      cntEl.textContent = pending;
      cntEl.style.display = pending ? '' : 'none';
    }
  } catch { /* ignore */ }
}

function proposalRender() {
  const filterStatus = document.getElementById('loc-prop-filter')?.value ?? '';
  const tbody = document.getElementById('prop-tbody');
  if (!tbody) return;

  const items = filterStatus
    ? _allProposals.filter(p => p.status === filterStatus)
    : _allProposals;

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--neutral-400);padding:20px">No proposals found</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(p => {
    const statusBadge = {
      'auto-applied': `<span class="prop-badge prop-badge-auto">Auto Applied</span>`,
      'pending-review': `<span class="prop-badge prop-badge-pending">Pending Review</span>`,
      'approved': `<span class="prop-badge prop-badge-ok">Approved (Permanent)</span>`,
      'approved-temporary': `<span class="prop-badge" style="background:#d97706;color:#fff">Approved (Temp)</span>`,
      'rejected': `<span class="prop-badge prop-badge-reject">Rejected</span>`,
    }[p.status] || `<span class="prop-badge">${escHtml(p.status)}</span>`;

    const scoreColor = p.confidence >= 75 ? '#4ec9b0' : p.confidence >= 50 ? '#eab308' : '#f48771';
    const truncOld = (p.oldSelector?.length ?? 0) > 50 ? `<span title="${escHtml(p.oldSelector)}">${escHtml(p.oldSelector.substring(0, 50))}…</span>` : escHtml(p.oldSelector || '—');
    const truncNew = (p.newSelector?.length ?? 0) > 50 ? `<span title="${escHtml(p.newSelector)}">${escHtml(p.newSelector.substring(0, 50))}…</span>` : escHtml(p.newSelector || '—');
    const healedAt = p.healedAt ? new Date(p.healedAt).toLocaleString() : '—';
    const usedTag = p.usedInRun
      ? `<span title="This candidate was used to continue test execution during the run" style="font-size:10px;padding:1px 6px;border-radius:8px;background:#d97706;color:#fff;margin-left:4px">Used in run</span>`
      : '';

    const actionBtns = p.status === 'pending-review'
      ? `<div style="display:flex;flex-direction:column;gap:3px">
           <button class="tbl-btn" style="color:#4ec9b0;font-size:11px" onclick="proposalReview('${escHtml(p.id)}','approved')" title="Make this the permanent primary selector">✓ Approve Permanent</button>
           <button class="tbl-btn" style="color:#d97706;font-size:11px" onclick="proposalReview('${escHtml(p.id)}','approved-temporary')" title="Add to fallbacks only — primary selector unchanged">⬡ Approve Temporary</button>
           <button class="tbl-btn del" style="font-size:11px" onclick="proposalReview('${escHtml(p.id)}','rejected')">✗ Reject</button>
         </div>`
      : `<span style="font-size:11px;color:var(--neutral-500)">${escHtml(p.reviewedBy || '')} ${p.reviewedAt ? new Date(p.reviewedAt).toLocaleDateString() : ''}</span>`;

    return `<tr>
      <td><strong>${escHtml(p.locatorName || p.locatorId)}</strong>${usedTag}</td>
      <td><code style="font-size:11px">${truncOld}</code></td>
      <td><code style="font-size:11px;color:${scoreColor}">${truncNew}</code></td>
      <td style="text-align:center;font-weight:600;color:${scoreColor}">${p.confidence}</td>
      <td>${statusBadge}</td>
      <td style="font-size:11px">${healedAt}</td>
      <td>${actionBtns}</td>
    </tr>`;
  }).join('');
}

async function proposalReview(id, action) {
  const labels = {
    'approved': 'Approve as Permanent? The T3 candidate will become the new primary selector.',
    'approved-temporary': 'Approve as Temporary? The candidate will be added to the fallbacks list. Primary selector unchanged.',
    'rejected': 'Reject this proposal? The candidate will be discarded. Next run will re-trigger T3.',
  };
  if (!confirm(labels[action] || 'Confirm?')) return;
  try {
    const res = await fetch(`/api/proposals/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) { const e = await res.json(); alert(e.error || 'Review failed'); return; }
    await proposalLoad();
  } catch { alert('Network error'); }
}

function _locPageGo(delta) {
  _locPage += delta;
  locatorRender();
}

function locatorToggleSelection(id) {
  if (selectedLocators.has(id)) {
    selectedLocators.delete(id);
  } else {
    selectedLocators.add(id);
  }
  locatorRender();
}

function locatorSelectAll(el) {
  const nameF = (document.getElementById('loc-filter-name')?.value ?? '').toLowerCase();
  const typeF = (document.getElementById('loc-filter-type')?.value ?? '').toLowerCase();
  const filtered = allLocators.filter(l =>
    (!nameF || l.name.toLowerCase().includes(nameF)) &&
    (!typeF || (l.selectorType || '').toLowerCase() === typeF)
  );
  const pageItems = filtered.slice(_locPage * LOC_PAGE_SIZE, (_locPage + 1) * LOC_PAGE_SIZE);

  if (el.checked) {
    pageItems.forEach(l => selectedLocators.add(l.id));
  } else {
    pageItems.forEach(l => selectedLocators.delete(l.id));
  }
  locatorRender();
}

function locatorUpdateSelectionUI() {
  const btn = document.getElementById('loc-btn-delete-selected');
  if (btn) {
    btn.style.display = (selectedLocators.size > 0 && !isViewer()) ? '' : 'none';
    btn.textContent = `Delete Selected (${selectedLocators.size})`;
  }
}

async function locatorDeleteSelected() {
  if (isViewer()) return;
  if (!selectedLocators.size) return;
  if (!confirm(`Delete ${selectedLocators.size} selected locator(s)?`)) return;

  const ids = Array.from(selectedLocators);
  const res = await fetch('/api/locators/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids })
  });

  if (res.ok) {
    selectedLocators.clear();
    await locatorLoad();
  } else {
    const data = await res.json();
    alert(data.error || 'Failed to delete locators');
  }
}

function locatorOpenModal(id = null) {
  editingLocatorId = id;
  modClearAlert('loc-modal-alert');
  document.getElementById('loc-modal-title').textContent = id ? 'Edit Locator' : 'Add Locator';
  if (!id) {
    ['loc-name', 'loc-selector', 'loc-page', 'loc-desc'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('loc-type').value = 'css';
  }
  openModal('modal-locator');
}

async function locatorEdit(id) {
  const loc = allLocators.find(l => l.id === id);
  if (!loc) return;
  editingLocatorId = id;
  document.getElementById('loc-modal-title').textContent = 'Edit Locator';
  document.getElementById('loc-name').value = loc.name;
  document.getElementById('loc-selector').value = loc.selector;
  document.getElementById('loc-type').value = loc.selectorType;
  document.getElementById('loc-page').value = loc.pageModule || '';
  document.getElementById('loc-desc').value = loc.description || '';
  modClearAlert('loc-modal-alert');
  _locatorEditRenderAlts(loc);
  openModal('modal-locator');
}

function _locatorEditRenderAlts(loc) {
  const container = document.getElementById('loc-alts-section');
  if (!container) return;
  const alts = (loc.alternatives || []).slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  if (!alts.length) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  const tbody = document.getElementById('loc-alts-tbody');
  if (!tbody) return;
  tbody.innerHTML = alts.map((a, i) => {
    const confDot = (a.confidence ?? 0) >= 80 ? '🟢' : (a.confidence ?? 0) >= 60 ? '🟡' : '🔴';
    const truncSel = (a.selector || '').length > 55 ? escHtml((a.selector || '').substring(0, 55)) + '…' : escHtml(a.selector || '');
    return `<tr id="loc-edit-alt-row-${i}">
      <td style="font-size:11px;color:var(--neutral-400);padding:4px 6px">#${i + 1}</td>
      <td style="padding:4px 6px"><code style="font-size:11px" title="${escHtml(a.selector || '')}">${truncSel}</code></td>
      <td style="padding:4px 6px"><span class="badge badge-tester" style="font-size:10px">${escHtml(a.selectorType || 'css')}</span></td>
      <td style="padding:4px 6px;font-size:11px">${confDot} ${a.confidence ?? '—'}/100</td>
      <td style="padding:4px 6px">
        <button class="tbl-btn" style="font-size:10px;padding:1px 7px" onclick="_locEditPromoteAlt(${i})" title="Set as primary">Set Primary</button>
      </td>
    </tr>`;
  }).join('');
}

function _locEditPromoteAlt(altIdx) {
  const loc = allLocators.find(l => l.id === editingLocatorId);
  if (!loc) return;
  const alts = (loc.alternatives || []).slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const chosen = alts[altIdx];
  if (!chosen) return;
  // Swap into the form fields
  const curSel = document.getElementById('loc-selector').value.trim();
  const curType = document.getElementById('loc-type').value;
  document.getElementById('loc-selector').value = chosen.selector;
  document.getElementById('loc-type').value = chosen.selectorType;
  // Rebuild in-memory alternatives: demote current primary, remove chosen
  const demoted = { selector: curSel, selectorType: curType, confidence: 50 };
  const remaining = alts.filter((_, i) => i !== altIdx);
  // Store updated alts temporarily so _locatorEditRenderAlts re-renders correctly
  loc._editAlts = [demoted, ...remaining];
  _locatorEditRenderAlts({ ...loc, alternatives: loc._editAlts });
}

async function locatorSave() {
  modClearAlert('loc-modal-alert');
  const name = document.getElementById('loc-name').value.trim();
  const selector = document.getElementById('loc-selector').value.trim();
  if (!name || !selector) { modAlert('loc-modal-alert', 'error', 'Name and Selector are required'); return; }

  const body = {
    name, selector,
    selectorType: document.getElementById('loc-type').value,
    pageModule: document.getElementById('loc-page').value.trim(),
    description: document.getElementById('loc-desc').value.trim(),
    projectId: currentProjectId || null,
  };

  // If a "Set Primary" swap was performed in the modal, include the updated alternatives
  if (editingLocatorId) {
    const loc = allLocators.find(l => l.id === editingLocatorId);
    if (loc?._editAlts) {
      body.alternatives = loc._editAlts;
      delete loc._editAlts;
    }
  }

  const method = editingLocatorId ? 'PUT' : 'POST';
  const url = editingLocatorId ? `/api/locators/${editingLocatorId}` : '/api/locators';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { modAlert('loc-modal-alert', 'error', data.error || 'Error'); return; }
  locatorCloseModal();
  await locatorLoad();
}

async function locatorDelete(id, name) {
  if (!confirm(`Delete locator "${name}"?`)) return;
  try {
    const res = await fetch(`/api/locators/${id}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json();
      alert('Delete failed: ' + (data.error || res.statusText));
      return;
    }
    await locatorLoad();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

function locatorCloseModal() {
  // Clear any in-progress primary swap state
  if (editingLocatorId) {
    const loc = allLocators.find(l => l.id === editingLocatorId);
    if (loc) delete loc._editAlts;
  }
  const altsTbody = document.getElementById('loc-alts-tbody');
  if (altsTbody) altsTbody.innerHTML = '';
  const altsSection = document.getElementById('loc-alts-section');
  if (altsSection) altsSection.style.display = 'none';
  closeModal('modal-locator');
  editingLocatorId = null;
}

// ── Fallback locator expand / collapse ────────────────────────────────────────
const _locAltOpen = new Set(); // tracks which locator IDs have expanded fallbacks

function locatorToggleAlts(locId) {
  const loc = allLocators.find(l => l.id === locId);
  const alts = loc?.alternatives || [];
  const chip = document.getElementById(`loc-alt-chip-${locId}`);
  const isOpen = _locAltOpen.has(locId);
  alts.forEach((_, i) => {
    const row = document.getElementById(`loc-alt-row-${locId}-${i}`);
    if (row) row.style.display = isOpen ? 'none' : '';
  });
  if (chip) chip.textContent = isOpen ? `▶ ${alts.length} fallback${alts.length > 1 ? 's' : ''}` : `▼ ${alts.length} fallback${alts.length > 1 ? 's' : ''}`;
  isOpen ? _locAltOpen.delete(locId) : _locAltOpen.add(locId);
}

// ── Promote a fallback to primary ─────────────────────────────────────────────
// Swaps alternatives[altIdx] ↔ primary selector in the locator record.
// The demoted primary is inserted at the top of the alternatives list with the
// same selectorType and a confidence of 50 (unknown — was primary, not scored).
async function locatorPromoteAlt(locId, altIdx) {
  const loc = allLocators.find(l => l.id === locId);
  if (!loc) return;
  const alts = (loc.alternatives || []).slice().sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const chosen = alts[altIdx];
  if (!chosen) return;
  if (!confirm(`Set "${chosen.selector}" (${chosen.selectorType}) as the primary locator for "${loc.name}"?\n\nThe current primary will move to the fallbacks list.`)) return;

  // Build new alternatives: old primary demoted, chosen removed from list
  const demoted = { selector: loc.selector, selectorType: loc.selectorType, confidence: 50 };
  const remaining = alts.filter((_, i) => i !== altIdx);
  const newAlts = [demoted, ...remaining];

  const body = {
    selector: chosen.selector,
    selectorType: chosen.selectorType,
    alternatives: newAlts,
  };
  const res = await fetch(`/api/locators/${locId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    alert('Failed to update locator: ' + (d.error || res.statusText));
    return;
  }
  _locAltOpen.delete(locId); // collapse after swap so user sees fresh state
  await locatorLoad();
}

// ── Healing Report ────────────────────────────────────────────────────────────
let _healLog = [];

async function healLogLoad() {
  if (!currentProjectId) return;
  try {
    const res = await fetch(`/api/heal-log?projectId=${encodeURIComponent(currentProjectId)}&limit=500`);
    if (!res.ok) { _healLog = []; healLogRender(); return; }
    _healLog = await res.json();
  } catch { _healLog = []; }
  healLogRender();
  // Update count badge
  const countEl = document.getElementById('loc-heallog-count');
  if (countEl) {
    if (_healLog.length) { countEl.textContent = _healLog.length; countEl.style.display = ''; }
    else countEl.style.display = 'none';
  }
}

function healLogRender() {
  const tierF = (document.getElementById('heallog-filter-tier')?.value ?? '').toUpperCase();
  const rows = _healLog.filter(e => !tierF || (e.tier || '').toUpperCase() === tierF);
  const tbody = document.getElementById('heallog-tbody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = `<tr id="heallog-empty-row"><td colspan="11" style="text-align:center;color:var(--neutral-400);padding:32px;font-size:13px">No healing events recorded yet. Events appear here after a test run where a primary locator failed and a fallback was used.</td></tr>`;
    return;
  }

  const tierBadge = t => {
    const colours = { T2: '#2563eb', T3: '#7c3aed', T4: '#16a34a' };
    const bg = colours[t] || '#6b7280';
    return `<span style="font-size:10px;font-weight:700;padding:1px 7px;border-radius:10px;background:${bg};color:#fff">${escHtml(t || '—')}</span>`;
  };
  const confDot = c => c >= 80 ? '🟢' : c >= 60 ? '🟡' : '🔴';
  const shortId = id => id ? id.substring(0, 8) + '…' : '—';
  const truncSel = s => (s || '').length > 45 ? `<span title="${escHtml(s)}">${escHtml((s || '').substring(0, 45))}…</span>` : escHtml(s || '—');

  tbody.innerHTML = rows.map((e, i) => `<tr>
    <td style="color:var(--neutral-400);font-size:11px">${i + 1}</td>
    <td style="font-size:11px"><code title="${escHtml(e.runId || '')}">${shortId(e.runId)}</code></td>
    <td style="font-size:11px">${escHtml(e.suiteName || '—')}</td>
    <td style="font-size:11px">${escHtml(e.tcId || '—')}</td>
    <td style="font-size:11px;text-align:center">${e.stepOrder ?? '—'}</td>
    <td style="font-size:11px"><strong>${escHtml(e.locatorName || e.locatorId || '—')}</strong></td>
    <td style="font-size:11px"><code style="color:var(--red-600)">${truncSel(e.oldSelector)}</code> <span style="font-size:10px;color:var(--neutral-400)">${escHtml(e.oldSelectorType || '')}</span></td>
    <td style="font-size:11px"><code style="color:var(--green-700)">${truncSel(e.healed)}</code> <span style="font-size:10px;color:var(--neutral-400)">${escHtml(e.healedType || '')}</span></td>
    <td>${tierBadge(e.tier)}</td>
    <td style="font-size:11px">${confDot(e.confidence ?? 0)} ${e.confidence ?? '—'}</td>
    <td style="font-size:11px;color:var(--neutral-400)">${(e.at || '').slice(0, 16).replace('T', ' ')}</td>
  </tr>`).join('');
}

// ── Locator picker popup (called from TC Builder step selector field) ──────────

let _locatorPickerCallback = null;

async function locatorPickerOpen(callback) {
  if (!currentProjectId) { alert('Select a project first before picking a locator.'); return; }
  _locatorPickerCallback = callback;
  document.getElementById('loc-picker-search').value = '';
  // Always reload scoped locators so picker reflects current project
  const res = await fetch(`/api/locators?projectId=${encodeURIComponent(currentProjectId)}`);
  allLocators = await res.json();
  locatorPickerFilter();
  openModal('modal-locator-picker');
}

function locatorPickerClose() { closeModal('modal-locator-picker'); _locatorPickerCallback = null; }

function locatorPickerFilter() {
  const q = document.getElementById('loc-picker-search').value.toLowerCase();
  const el = document.getElementById('loc-picker-list');
  const filtered = allLocators.filter(l =>
    !q || l.name.toLowerCase().includes(q) || l.selector.toLowerCase().includes(q) || (l.pageModule || '').toLowerCase().includes(q)
  );
  el.innerHTML = filtered.map(l => `
    <div class="loc-pick-item" onclick="locatorPickerSelect('${escHtml(l.id)}')">
      <div class="loc-pick-name">${escHtml(l.name)}</div>
      <div class="loc-pick-sel">${escHtml(l.selector)}</div>
      ${l.pageModule ? `<div class="loc-pick-page">${escHtml(l.pageModule)}</div>` : ''}
    </div>`).join('');
  if (!filtered.length) el.innerHTML = '<div style="padding:12px;color:var(--neutral-400);font-size:13px">No locators found</div>';
}

function locatorPickerSelect(id) {
  const loc = allLocators.find(l => l.id === id);
  if (loc && _locatorPickerCallback) _locatorPickerCallback(loc.selector, loc.selectorType, loc.name);
  locatorPickerClose();
}

// ══════════════════════════════════════════════════════════════════════════════
// COMMON FUNCTIONS
// ══════════════════════════════════════════════════════════════════════════════
