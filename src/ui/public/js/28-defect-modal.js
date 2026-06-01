// Shared Defect-to-Jira modal — works for both UI-test and API-step failures.
// Usage:
//   openDefectModal(runId, testId)                          ← legacy positional (ui-test)
//   openDefectModal({ mode:'ui-test',  runId, contextId:testId })
//   openDefectModal({ mode:'api-step', runId, contextId:stepId, onSuccess:fn })

(function () {
  'use strict';

  function _dfxEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _dfxInjectModal() {
    if (document.getElementById('shared-defect-modal')) return;

    var style = document.createElement('style');
    style.textContent = [
      '.s-dfx-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9998;display:flex;align-items:center;justify-content:center}',
      '.s-dfx-overlay[hidden]{display:none!important}',
      '.s-dfx-inner{width:88vw;max-width:1200px;height:92vh;background:#fff;border-radius:8px;display:flex;flex-direction:column}',
      '.s-dfx-header{padding:14px 18px;border-bottom:1px solid #e5e7eb;font-weight:700;display:flex;align-items:center;justify-content:space-between}',
      '.s-dfx-header button{background:none;border:1px solid #d1d5db;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}',
      '.s-dfx-body{flex:1;overflow:auto;padding:16px 18px}',
      '.s-dfx-footer{padding:12px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap}',
      '.s-dfx-section{margin-bottom:14px}',
      '.s-dfx-section h4{margin:0 0 6px;font-size:12.5px;color:#374151}',
      '.s-dfx-section textarea,.s-dfx-section input,.s-dfx-section select{width:100%;box-sizing:border-box;padding:7px 10px;border:1px solid #d1d5db;border-radius:5px;font:inherit;font-size:13px}',
      '.s-dfx-section textarea{height:320px!important;min-height:200px!important;resize:vertical!important;font-family:ui-monospace,monospace;width:100%!important}',
      '.s-dfx-warn{padding:10px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;color:#9a3412;margin-bottom:14px}',
      '.s-dfx-error{padding:10px 14px;background:#fee2e2;border:1px solid #fca5a5;border-radius:6px;color:#7f1d1d;margin-bottom:14px}',
      '.s-dfx-ok{padding:10px 14px;background:#d1fae5;border:1px solid #6ee7b7;border-radius:6px;color:#065f46;margin-bottom:14px}',
      '.s-dfx-footer .s-btn{padding:6px 14px;border-radius:6px;font-size:12.5px;font-weight:600;border:1px solid #d1d5db;background:#fff;cursor:pointer}',
      '.s-dfx-footer .s-btn-primary{background:#16a34a;color:#fff;border-color:#16a34a}',
      '.s-dfx-footer .s-btn-primary:hover{background:#15803d}',
      '.s-dfx-footer .s-btn-primary[disabled]{background:#9ca3af;border-color:#9ca3af;cursor:not-allowed}',
    ].join('');
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div id="shared-defect-modal" class="s-dfx-overlay" hidden>' +
      '  <div class="s-dfx-inner">' +
      '    <div class="s-dfx-header">' +
      '      <span>&#128030; File Defect to Jira</span>' +
      '      <button onclick="closeDefectModal()">&#10005; Close</button>' +
      '    </div>' +
      '    <div class="s-dfx-body" id="s-dfx-body">Loading…</div>' +
      '    <div class="s-dfx-footer" id="s-dfx-footer"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(wrap.firstElementChild);
  }

  var _dfxDraft = null; // { mode, runId, contextId, draft, onSuccess }

  function closeDefectModal() {
    var m = document.getElementById('shared-defect-modal');
    if (m) m.hidden = true;
    _dfxDraft = null;
  }

  function _dfxAdfPreview(adf) {
    if (!adf || !adf.content) return '';
    var lines = [];
    for (var i = 0; i < adf.content.length; i++) {
      var node = adf.content[i];
      if (node.type === 'heading')
        lines.push('\n## ' + (node.content && node.content[0] && node.content[0].text || ''));
      else if (node.type === 'paragraph')
        lines.push((node.content || []).map(function (c) { return c.text || ''; }).join(''));
      else if (node.type === 'orderedList')
        (node.content || []).forEach(function (li, idx) {
          var txt = li.content && li.content[0] && li.content[0].content &&
            li.content[0].content[0] && li.content[0].content[0].text || '';
          lines.push((idx + 1) + '. ' + txt);
        });
      else if (node.type === 'codeBlock')
        lines.push('```\n' + (node.content && node.content[0] && node.content[0].text || '') + '\n```');
    }
    return lines.join('\n');
  }

  // Convert edited plain-text description back to minimal ADF so Jira renders it
  function _dfxTextToAdf(text) {
    var nodes = [];
    var lines = (text || '').split('\n');
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (line.indexOf('## ') === 0) {
        nodes.push({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: line.slice(3) }] });
        i++;
      } else if (line === '```') {
        var codeLines = [];
        i++;
        while (i < lines.length && lines[i] !== '```') { codeLines.push(lines[i]); i++; }
        nodes.push({ type: 'codeBlock', content: [{ type: 'text', text: codeLines.join('\n') }] });
        i++;
      } else if (line.trim() === '') {
        i++;
      } else {
        nodes.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
        i++;
      }
    }
    return { version: 1, type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph', content: [] }] };
  }

  async function _dfxApproveAndFile() {
    if (!_dfxDraft) return;
    var parent  = document.getElementById('s-dfx-parent').value.trim();
    var summary = document.getElementById('s-dfx-summary').value.trim();
    var msgEl   = document.getElementById('s-dfx-msg');
    if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(parent)) {
      msgEl.innerHTML = '<span style="color:#dc2626">User Story key must look like ABC-123</span>';
      return;
    }
    if (!summary) { msgEl.innerHTML = '<span style="color:#dc2626">Summary required</span>'; return; }
    var priority = document.getElementById('s-dfx-priority').value;
    msgEl.textContent = '⏳ Filing…';

    // If user edited the description textarea, convert their text to ADF; otherwise use original ADF
    var descEl = document.getElementById('s-dfx-desc');
    var originalPreview = _dfxAdfPreview(_dfxDraft.draft.descriptionADF);
    var descriptionADF = (descEl && descEl.value !== originalPreview)
      ? _dfxTextToAdf(descEl.value)
      : _dfxDraft.draft.descriptionADF;

    var body = {
      summary: summary,
      descriptionADF: descriptionADF,
      priority: priority,
      parentStoryKey: parent,
    };
    if (_dfxDraft.mode === 'ui-test') {
      body.runId  = _dfxDraft.runId;
      body.testId = _dfxDraft.contextId;
      var attachEls = document.querySelectorAll('.s-dfx-attach');
      body.attachKinds = Array.from(attachEls)
        .filter(function (c) { return c.checked && !c.disabled; })
        .map(function (c) { return c.dataset.kind; });
    } else {
      body.runId  = _dfxDraft.runId;
      body.stepId = _dfxDraft.contextId;
    }

    var endpoint = _dfxDraft.mode === 'ui-test' ? '/api/defects/file' : '/api/api-defects/file';
    var r = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var j = await r.json();

    if (r.ok) {
      msgEl.innerHTML = '<div class="s-dfx-ok">✓ Filed as <strong>' + _dfxEsc(j.defectKey) + '</strong>. ' +
        '<a href="' + _dfxEsc(j.jiraUrl) + '" target="_blank" rel="noopener">Open in Jira ↗</a></div>';
      var closeLabel = _dfxDraft.mode === 'ui-test' ? 'Close &amp; Refresh' : 'Close';
      var closeExtra = _dfxDraft.mode === 'ui-test' ? ';location.reload()' : '';
      document.getElementById('s-dfx-footer').innerHTML =
        '<button class="s-btn s-btn-primary" onclick="closeDefectModal()' + closeExtra + '">' + closeLabel + '</button>';
      if (_dfxDraft.onSuccess) _dfxDraft.onSuccess(j);
    } else if (r.status === 409) {
      var ex = j && j.error && j.error.details || {};
      msgEl.innerHTML = '<div class="s-dfx-warn">⚠ Already filed as <strong>' + _dfxEsc(ex.defectKey || '') + '</strong>.' +
        (ex.jiraUrl ? ' <a href="' + _dfxEsc(ex.jiraUrl) + '" target="_blank" rel="noopener">Open in Jira ↗</a>' : '') + '</div>';
    } else {
      var errMsg = j && j.error && j.error.message || 'File failed';
      var errDetail = j && j.error && j.error.details ? '\n' + JSON.stringify(j.error.details, null, 2) : '';
      msgEl.innerHTML = '<div class="s-dfx-error">✗ ' + _dfxEsc(errMsg) +
        (errDetail ? '<pre style="margin:6px 0 0;font-size:11px;white-space:pre-wrap;word-break:break-all">' + _dfxEsc(errDetail) + '</pre>' : '') + '</div>';
    }
  }

  async function dismissDefectFromModal() {
    if (!_dfxDraft || _dfxDraft.mode !== 'ui-test') return;
    var catEl = document.getElementById('s-dfx-dismiss-cat');
    var cat = catEl && catEl.value;
    if (!cat) { alert('Select a dismiss category first'); return; }
    var r = await fetch('/api/defects/dismiss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: _dfxDraft.runId, testId: _dfxDraft.contextId, category: cat }),
    });
    if (r.ok) { closeDefectModal(); location.reload(); }
    else { var j = await r.json(); alert('Dismiss failed: ' + (j && j.error && j.error.message || 'error')); }
  }

  async function commentOnExisting(defectKey) {
    if (!_dfxDraft) return;
    var r = await fetch('/api/defects/comment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId: _dfxDraft.runId, testId: _dfxDraft.contextId, defectKey: defectKey }),
    });
    var j = await r.json();
    var bodyEl = document.getElementById('s-dfx-body');
    if (r.ok) {
      bodyEl.innerHTML = '<div class="s-dfx-ok">✓ Comment added to <strong>' + _dfxEsc(defectKey) + '</strong>.</div>';
      document.getElementById('s-dfx-footer').innerHTML =
        '<button class="s-btn s-btn-primary" onclick="closeDefectModal();location.reload()">Close &amp; Refresh</button>';
    } else {
      bodyEl.innerHTML += '<div class="s-dfx-error">✗ ' + _dfxEsc((j && j.error && j.error.message) || 'Comment failed') + '</div>';
    }
  }

  async function openDefectModal(opts, legacyTestId) {
    // Legacy positional call: openDefectModal(runId, testId)
    if (typeof opts === 'string') {
      opts = { mode: 'ui-test', runId: opts, contextId: legacyTestId };
    }
    var mode      = opts.mode || 'ui-test';
    var runId     = opts.runId;
    var contextId = opts.contextId;
    var onSuccess = opts.onSuccess || null;

    _dfxInjectModal();

    var m    = document.getElementById('shared-defect-modal');
    var bodyEl = document.getElementById('s-dfx-body');
    var foot = document.getElementById('s-dfx-footer');
    m.hidden = false;
    bodyEl.innerHTML = '⏳ Loading draft…';
    foot.innerHTML = '';

    var draftEndpoint = mode === 'ui-test' ? '/api/defects/draft' : '/api/api-defects/draft';
    var draftBody = mode === 'ui-test'
      ? { runId: runId, testId: contextId }
      : { runId: runId, stepId: contextId };

    var draft;
    try {
      var draftRes = await fetch(draftEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftBody),
      });
      if (draftRes.status === 409) {
        var d409 = await draftRes.json();
        var ex409 = d409.error && d409.error.details || {};
        if (mode === 'ui-test' && ex409.defectKey) {
          bodyEl.innerHTML =
            '<div class="s-dfx-warn">⚠ Already filed as <strong>' + _dfxEsc(ex409.defectKey) + '</strong>' +
            (ex409.status ? ' (' + _dfxEsc(ex409.status) + ')' : '') + '.<br>' +
            '<a href="' + _dfxEsc(ex409.jiraUrl || '') + '" target="_blank" rel="noopener">Open in Jira ↗</a></div>' +
            '<p>You can add this run\'s failure as a comment on the existing ticket, or cancel.</p>';
          foot.innerHTML =
            '<button class="s-btn" onclick="closeDefectModal()">Cancel</button>' +
            '<button class="s-btn s-btn-primary" onclick="commentOnExisting(' + JSON.stringify(ex409.defectKey) + ')">Add as Comment</button>';
        } else {
          bodyEl.innerHTML =
            '<div class="s-dfx-warn">⚠ Already filed as <strong>' + _dfxEsc(ex409.defectKey || 'existing') + '</strong>.' +
            (ex409.jiraUrl ? ' <a href="' + _dfxEsc(ex409.jiraUrl) + '" target="_blank" rel="noopener">Open in Jira ↗</a>' : '') + '</div>';
          foot.innerHTML = '<button class="s-btn s-btn-primary" onclick="closeDefectModal()">Close</button>';
        }
        return;
      }
      if (!draftRes.ok) {
        var derr = await draftRes.json();
        throw new Error((derr.error && derr.error.message) || 'Draft failed');
      }
      draft = await draftRes.json();
    } catch (e) {
      bodyEl.innerHTML = '<div class="s-dfx-error">✗ ' + _dfxEsc(e.message) + '</div>';
      foot.innerHTML = '<button class="s-btn" onclick="closeDefectModal()">Close</button>';
      return;
    }

    _dfxDraft = { mode: mode, runId: runId, contextId: contextId, draft: draft, onSuccess: onSuccess };

    var isConfigured = mode === 'ui-test' ? !!draft.config : !!draft.isJiraConfigured;
    if (!isConfigured) {
      bodyEl.innerHTML = '<div class="s-dfx-error">✗ Jira not configured. Ask an admin to configure it in Admin → Notification Settings.</div>';
      foot.innerHTML = '<button class="s-btn" onclick="closeDefectModal()">Close</button>';
      return;
    }

    if (draft.existingDefect) {
      var d = draft.existingDefect;
      bodyEl.innerHTML =
        '<div class="s-dfx-warn">⚠ Already filed as <strong>' + _dfxEsc(d.defectKey) + '</strong> (' + _dfxEsc(d.status) + ').<br>' +
        '<a href="' + _dfxEsc(d.jiraUrl) + '" target="_blank" rel="noopener">Open in Jira ↗</a></div>' +
        (mode === 'ui-test'
          ? '<p>You can add this run\'s failure as a comment on the existing ticket, or cancel.</p>'
          : '<p style="font-size:13px;color:#374151;margin:0">This step already has an open defect.</p>');
      foot.innerHTML =
        '<button class="s-btn" onclick="closeDefectModal()">Cancel</button>' +
        (mode === 'ui-test'
          ? '<button class="s-btn s-btn-primary" onclick="commentOnExisting(' + JSON.stringify(d.defectKey) + ')">Add as Comment</button>'
          : '<button class="s-btn s-btn-primary" onclick="closeDefectModal()">Close</button>');
      return;
    }

    var cfg = draft.config || {};
    var projectKey = draft.jiraProjectKey || cfg.projectKey || '';
    var projectKeyHtml = projectKey
      ? '<div style="padding:6px 10px;background:#f0fdf4;border:1px solid #86efac;border-radius:5px;font-weight:700;color:#15803d;font-size:13px">' + _dfxEsc(projectKey) + '</div>'
      : '<div style="padding:6px 10px;background:#fef2f2;border:1px solid #fca5a5;border-radius:5px;color:#dc2626;font-size:12.5px">⚠ Jira Project Key not set for this project. Go to Admin → Project Management to configure it.</div>';

    var attachSection = '';
    if (mode === 'ui-test') {
      var attachRows = (draft.attachments || []).map(function (a) {
        var sizeMb = (a.sizeBytes / 1024 / 1024).toFixed(2);
        return '<label style="display:block;margin:4px 0"><input type="checkbox" class="s-dfx-attach" data-kind="' + _dfxEsc(a.kind) + '" ' +
          (a.tooLarge ? 'disabled' : 'checked') + '> ' + _dfxEsc(a.kind) + ' — ' + _dfxEsc(a.name) +
          ' (' + sizeMb + ' MB)' + (a.tooLarge ? '<span style="color:#dc2626"> — too large, will be skipped</span>' : '') + '</label>';
      }).join('');
      attachSection = '<div class="s-dfx-section"><h4>Attachments</h4>' + (attachRows || '<em>(no artifacts available)</em>') + '</div>';
    }

    bodyEl.innerHTML =
      '<div class="s-dfx-section"><h4>Jira Project</h4>' + projectKeyHtml + '</div>' +
      '<div class="s-dfx-section"><h4>Issue Type</h4><input type="text" value="' + _dfxEsc(cfg.issueType || 'Defect') + '" readonly></div>' +
      '<div class="s-dfx-section"><h4>Priority *</h4><select id="s-dfx-priority">' +
        ['Highest', 'High', 'Medium', 'Low', 'Lowest'].map(function (p) {
          return '<option' + (draft.suggestedPriority === p ? ' selected' : '') + '>' + p + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="s-dfx-section"><h4>User Story * (e.g. ' + _dfxEsc(projectKey || 'PROJ') + '-123)</h4>' +
        '<input id="s-dfx-parent" type="text" placeholder="' + _dfxEsc(projectKey || 'PROJ') + '-_____"></div>' +
      '<div class="s-dfx-section"><h4>Summary *</h4>' +
        '<input id="s-dfx-summary" type="text" value="' + _dfxEsc(draft.summary || '') + '" maxlength="255"></div>' +
      '<div class=”s-dfx-section”><h4>Description <span style=”font-size:11px;color:#6b7280;font-weight:400”>(editable — Jira renders as rich text)</span></h4>' +
        '<textarea id=”s-dfx-desc” style=”height:320px;min-height:200px;resize:vertical;width:100%;box-sizing:border-box;font-family:ui-monospace,monospace;font-size:13px;padding:7px 10px;border:1px solid #d1d5db;border-radius:5px”>' + _dfxEsc(_dfxAdfPreview(draft.descriptionADF)) + '</textarea>' +
        '<div style=”font-size:11px;color:#6b7280;margin-top:3px”>Edit freely. Changes are sent to Jira as plain-text ADF paragraphs.</div></div>' +
      attachSection +
      '<div id=”s-dfx-msg” style=”margin-top:8px;font-size:12.5px”></div>';

    foot.innerHTML =
      '<button class="s-btn" onclick="closeDefectModal()">Cancel</button>' +
      (mode === 'ui-test'
        ? '<select id="s-dfx-dismiss-cat" style="padding:6px 10px;border-radius:5px">' +
            '<option value="">Categorise Issue ▾</option>' +
            '<option value="aut-bug">AUT Bug</option>' +
            '<option value="script-issue">Script Issue</option>' +
            '<option value="locator-issue">Locator Issue</option>' +
            '<option value="flaky">Flaky</option>' +
            '<option value="data-issue">Data Issue</option>' +
            '<option value="env-issue">Env Issue</option>' +
          '</select><button class="s-btn" onclick="dismissDefectFromModal()">Dismiss</button>'
        : '') +
      (projectKey
        ? '<button class="s-btn s-btn-primary" onclick="_dfxApproveAndFile()">Approve &amp; File</button>'
        : '<button class="s-btn s-btn-primary" disabled title="Set Jira Project Key in Admin → Project Management first">Approve &amp; File</button>');
  }

  // Expose on window — accessible from inline onclick handlers in both pages
  window.openDefectModal        = openDefectModal;
  window.closeDefectModal       = closeDefectModal;
  window.commentOnExisting      = commentOnExisting;
  window.dismissDefectFromModal = dismissDefectFromModal;
  window._dfxApproveAndFile     = _dfxApproveAndFile;

}());
