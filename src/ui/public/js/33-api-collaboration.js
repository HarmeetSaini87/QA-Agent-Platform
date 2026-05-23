// ══════════════════════════════════════════════════════════════════════════════
// COLLABORATION MODULE — revisions, review comments, workflow templates
// ══════════════════════════════════════════════════════════════════════════════

let _collabColId = '';
let _collabRevisions = [];
let _collabActiveTab = 'revisions';

async function collabLoad() {
  const sel = document.getElementById('collab-col-select');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select Collection —</option>';
  const cols = (typeof allApiCollections !== 'undefined' && Array.isArray(allApiCollections) && allApiCollections.length)
    ? allApiCollections
    : await fetch('/api/api-collections').then(r => r.ok ? r.json() : []).catch(() => []);
  (Array.isArray(cols) ? cols : []).forEach(c => {
    sel.innerHTML += `<option value="${escHtml(c.id)}">${escHtml(c.name)}</option>`;
  });
  collabLoadTemplates();
}

async function collabSelectCollection(colId) {
  _collabColId = colId;
  if (!colId) return;
  if (_collabActiveTab === 'revisions') collabLoadRevisions(colId);
  if (_collabActiveTab === 'comments') collabLoadComments(colId);
}

function collabTabSwitch(tab, btn) {
  _collabActiveTab = tab;
  document.querySelectorAll('[data-collabtab]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  ['revisions', 'comments', 'templates'].forEach(t => {
    const el = document.getElementById('collab-panel-' + t);
    if (el) el.style.display = t === tab ? '' : 'none';
  });
  if (tab === 'revisions' && _collabColId) collabLoadRevisions(_collabColId);
  if (tab === 'comments' && _collabColId) collabLoadComments(_collabColId);
  if (tab === 'templates') collabLoadTemplates();
}

// ─── REVISIONS ───────────────────────────────────────────────────────────────

async function collabLoadRevisions(colId) {
  const tbody = document.getElementById('collab-revisions-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted)">Loading…</td></tr>';
  const res = await fetch('/api/collaboration/' + encodeURIComponent(colId) + '/revisions');
  if (!res.ok) { tbody.innerHTML = '<tr><td colspan="6" style="color:#ef4444">Failed to load revisions.</td></tr>'; return; }
  const data = await res.json();
  _collabRevisions = data.revisions || [];
  if (!_collabRevisions.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted)">No revisions yet.</td></tr>'; return; }
  _collabRenderRevisions();
}

function _collabRenderRevisions() {
  const tbody = document.getElementById('collab-revisions-tbody');
  if (!tbody) return;
  const q = (document.getElementById('collab-revisions-search')?.value || '').toLowerCase();
  const filtered = q
    ? _collabRevisions.filter(r =>
        (r.description || '').toLowerCase().includes(q) ||
        (r.authorId || '').toLowerCase().includes(q) ||
        (r.status || '').toLowerCase().includes(q))
    : _collabRevisions;
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">${q ? 'No revisions match the search.' : 'No revisions yet.'}</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(r => `<tr>
    <td>${escHtml(String(r.revisionNumber))}</td>
    <td><span class="badge">${escHtml(r.status)}</span></td>
    <td>${escHtml(r.authorId || '—')}</td>
    <td>${escHtml(r.description || '—')}</td>
    <td style="font-size:11px;color:var(--text-muted)">${r.createdAt ? new Date(r.createdAt).toLocaleString() : '—'}</td>
    <td>
      <button class="tbl-btn" onclick="collabRollback('${escHtml(r.revisionId)}')">Rollback</button>
      <button class="tbl-btn" onclick="collabShowDiff('${escHtml(r.revisionId)}')">Diff</button>
    </td>
  </tr>`).join('');
}

function collabFilterRevisions() { _collabRenderRevisions(); }

function collabCreateRevisionModal() {
  if (!_collabColId) { modAlert('collab-revisions-msg', 'error', 'Select a collection first.'); return; }
  const desc = prompt('Revision description (optional):');
  if (desc === null) return;
  collabCreateRevision(_collabColId, desc || '');
}

async function collabCreateRevision(colId, description) {
  const res = await fetch('/api/collaboration/' + encodeURIComponent(colId) + '/revisions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId: 'ui-user', description, stepSnapshot: [] })
  });
  if (!res.ok) { modAlert('collab-revisions-msg', 'error', 'Failed to create revision.'); return; }
  modAlert('collab-revisions-msg', 'success', 'Revision saved.');
  collabLoadRevisions(colId);
}

async function collabRollback(revisionId) {
  if (!_collabColId) return;
  if (!confirm('Roll back to this revision?')) return;
  const res = await fetch('/api/collaboration/' + encodeURIComponent(_collabColId) + '/revisions/rollback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toRevisionId: revisionId, actorId: 'ui-user' })
  });
  modAlert('collab-revisions-msg', res.ok ? 'success' : 'error', res.ok ? 'Rollback complete.' : 'Rollback failed.');
  if (res.ok) collabLoadRevisions(_collabColId);
}

async function collabShowDiff(revisionId) {
  if (!_collabColId || _collabRevisions.length < 2) { modAlert('collab-revisions-msg', 'error', 'Need at least 2 revisions to diff.'); return; }
  const other = _collabRevisions.find(r => r.revisionId !== revisionId);
  if (!other) return;
  const res = await fetch('/api/collaboration/' + encodeURIComponent(_collabColId) + '/revisions/diff', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fromRevisionId: other.revisionId, toRevisionId: revisionId })
  });
  if (!res.ok) { modAlert('collab-revisions-msg', 'error', 'Diff request failed.'); return; }
  const diff = await res.json();
  const added = (diff.stepsAdded || []).map(s => `+${escHtml(s.stepId)}`).join(', ') || 'none';
  const removed = (diff.stepsRemoved || []).map(s => `-${escHtml(s.stepId)}`).join(', ') || 'none';
  const deps = (diff.dependenciesChanged || []).length;
  modAlert('collab-revisions-msg', 'success', `Diff: Added: ${added} | Removed: ${removed} | Dependency changes: ${deps}`);
}

// ─── COMMENTS ────────────────────────────────────────────────────────────────

let _collabComments = [];

async function collabLoadComments(colId) {
  const list = document.getElementById('collab-comments-list');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/collaboration/' + encodeURIComponent(colId) + '/comments');
  if (!res.ok) { list.innerHTML = '<div style="color:#ef4444">Failed to load comments.</div>'; return; }
  _collabComments = await res.json();
  if (!Array.isArray(_collabComments)) _collabComments = [];
  _collabRenderComments();
}

function _collabRenderComments() {
  const list = document.getElementById('collab-comments-list');
  if (!list) return;
  const q = (document.getElementById('collab-comments-search')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('collab-comments-status-filter')?.value || '';
  const filtered = _collabComments.filter(c =>
    (!statusFilter || c.status === statusFilter) &&
    (!q || (c.body || '').toLowerCase().includes(q) || (c.authorId || '').toLowerCase().includes(q))
  );
  if (!filtered.length) { list.innerHTML = '<div style="color:var(--text-muted)">No comments match the filter.</div>'; return; }
  list.innerHTML = filtered.map(c => `
    <div style="border:1px solid var(--border);border-radius:6px;padding:10px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-weight:600">${escHtml(c.authorId || '—')}</span>
        <span style="font-size:11px;color:var(--text-muted)">${escHtml(c.targetType)}${c.targetId ? ':' + escHtml(c.targetId) : ''} · ${escHtml(c.status)}</span>
      </div>
      <div style="margin-bottom:6px">${escHtml(c.body)}</div>
      ${c.status === 'open' ? `<button class="tbl-btn" onclick="collabResolveComment('${escHtml(c.commentId)}')">Resolve</button>` : '<span style="color:#22c55e;font-size:12px">✓ Resolved</span>'}
    </div>`).join('');
}

function collabFilterComments() { _collabRenderComments(); }

async function collabAddComment() {
  if (!_collabColId) { modAlert('collab-comments-msg', 'error', 'Select a collection first.'); return; }
  const body = document.getElementById('collab-comment-body')?.value?.trim();
  if (!body) { modAlert('collab-comments-msg', 'error', 'Comment body is required.'); return; }
  const targetType = document.getElementById('collab-comment-target-type')?.value || 'collection';
  const targetId = document.getElementById('collab-comment-target-id')?.value?.trim() || _collabColId;
  const res = await fetch('/api/collaboration/' + encodeURIComponent(_collabColId) + '/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorId: 'ui-user', targetType, targetId, body })
  });
  if (!res.ok) { modAlert('collab-comments-msg', 'error', 'Failed to post comment.'); return; }
  const bodyEl = document.getElementById('collab-comment-body');
  if (bodyEl) bodyEl.value = '';
  modAlert('collab-comments-msg', 'success', 'Comment posted.');
  collabLoadComments(_collabColId);
}

async function collabResolveComment(commentId) {
  const res = await fetch('/api/collaboration/comments/' + encodeURIComponent(commentId) + '/resolve', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actorId: 'ui-user' })
  });
  if (res.ok && _collabColId) collabLoadComments(_collabColId);
}

// ─── TEMPLATES ───────────────────────────────────────────────────────────────

async function collabLoadTemplates() {
  const list = document.getElementById('collab-templates-list');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--text-muted)">Loading…</div>';
  const res = await fetch('/api/collaboration/templates');
  if (!res.ok) { list.innerHTML = '<div style="color:#ef4444">Failed to load templates.</div>'; return; }
  const templates = await res.json();
  if (!Array.isArray(templates) || !templates.length) { list.innerHTML = '<div style="color:var(--text-muted)">No templates available.</div>'; return; }
  list.innerHTML = templates.map(t => `
    <div style="border:1px solid var(--border);border-radius:6px;padding:12px;margin-bottom:10px">
      <div style="font-weight:600;margin-bottom:4px">${escHtml(t.name || t.templateId)}</div>
      <div style="color:var(--text-muted);font-size:12px;margin-bottom:6px">${escHtml(t.description || '')} <span class="badge">${escHtml(t.category || '')}</span></div>
      <div class="advisory-banner" style="margin-bottom:8px">ℹ️ Instantiate creates an advisory scaffold only. No collection is created automatically.</div>
      <button class="tbl-btn" onclick="collabInstantiateTemplate('${escHtml(t.templateId)}')">Instantiate</button>
    </div>`).join('');
}

async function collabInstantiateTemplate(templateId) {
  const res = await fetch('/api/collaboration/templates/' + encodeURIComponent(templateId) + '/instantiate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetCollectionId: _collabColId || undefined })
  });
  if (!res.ok) { modAlert('collab-revisions-msg', 'error', 'Instantiation failed.'); return; }
  const scaffold = await res.json();
  const summary = escHtml((scaffold.steps || scaffold.stepCount || JSON.stringify(scaffold)).toString().substring(0, 200));
  modAlert('collab-revisions-msg', 'success', 'Advisory scaffold returned. Steps: ' + summary);
}

function collabExportRevisions() {
  if (!_collabRevisions.length) { showToast('error', 'No revisions to export.'); return; }
  downloadCSV('revisions.csv',
    ['Revision #', 'Status', 'Author', 'Description', 'Created At'],
    _collabRevisions.map(r => [
      r.revisionNumber, r.status, r.authorId || '',
      r.description || '',
      r.createdAt ? new Date(r.createdAt).toLocaleString() : ''
    ])
  );
  showToast('success', 'Revisions exported to revisions.csv');
}
