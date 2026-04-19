/**
 * content_script.js — QA Agent Recorder Extension v4
 *
 * Injected into the AUT tab when user starts recording.
 * Captures: click, fill (blur), select, check/uncheck, file upload,
 *           window.alert/confirm/prompt, open shadow DOM (recursive),
 *           same-origin iframes.
 *
 * Each captured action POSTed to platformOrigin/api/recorder/step.
 * Notifies background.js via chrome.runtime.sendMessage for badge update.
 *
 * v4 additions:
 *   CR1. Click filtering — isActionableClick() + isVisibleElement() prevent
 *        recording junk clicks on blank areas and layout containers.
 *   CR2. Locator overhaul — 11-step bestSelector() with strict uniqueness
 *        enforcement; countMatches() everywhere; buildRelativeXPath() never
 *        generates absolute /html/body/... paths; label[for] captured.
 *   CR3. Natural language smartName — label[for] awareness for label elements.
 *   P1.  Self-Healing Phase 1 — healingProfile, alternatives[], importanceScore,
 *        pageKey captured on every step.
 */
(function () {
  'use strict';

  // Guard: don't double-inject
  if (window.__qaRecorderActive) return;
  window.__qaRecorderActive = true;

  let _token          = null;
  let _platformOrigin = null;
  let _active         = false;
  let _lastClick      = { sel: '', ts: 0, stateHash: '' };
  const CLICK_DEBOUNCE_MS = 800;   // raised from 300ms — covers accidental double-clicks
  const FILL_MERGE_MS     = 600;   // inactivity window before FILL is emitted

  // ── CR2: Central dedup state ──────────────────────────────────────────────────
  let _lastEmitted = { eventType: '', selector: '', value: '', ts: 0 };
  let _pendingFill = null;  // { el, loc, value, timer } — buffered until typing stops

  // ── Self-init from chrome.storage (survives SSO redirects + race conditions) ─
  chrome.storage.local.get(['recorderState'], (result) => {
    const state = result.recorderState;
    if (state && state.active && state.token && state.platformOrigin) {
      _token          = state.token;
      _platformOrigin = state.platformOrigin;
      _active         = true;
      attachListeners();
      console.info('[QA Recorder] Active on', window.location.hostname);
      showToast('QA Recorder active — recording');
    }
  });

  // ── Listen for messages from background (start/stop while page is open) ──────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'RECORDER_INIT') {
      _token          = msg.token;
      _platformOrigin = msg.platformOrigin;
      _active         = true;
      attachListeners();
      console.info('[QA Recorder] Active — recording started on', window.location.hostname);
      showToast('QA Recorder active — recording started');
    }
    if (msg.type === 'RECORDER_STOP') {
      _active = false;
      window.__qaRecorderActive = false;
      detachListeners();
      console.info('[QA Recorder] Stopped.');
      showToast('QA Recorder stopped');
    }
  });

  // ── POST step to platform ─────────────────────────────────────────────────────
  // Route through background service worker to avoid Mixed Content blocks.
  // AUT may be HTTPS while platform is HTTP — browsers block direct HTTPS→HTTP
  // fetch. The extension background worker is not subject to this restriction.
  function postStep(payload) {
    if (!_active || !_token || !_platformOrigin) return;
    chrome.runtime.sendMessage({
      type: 'POST_STEP',
      platformOrigin: _platformOrigin,
      token: _token,
      payload,
    });
  }

  // ── Dynamic ID detection — never use generated IDs as locators ───────────────
  const DYNAMIC_ID_PATTERNS = [
    /^ember\d+$/i,
    /^mat-.+-\d+$/i,
    /^:\w+:$/,
    /^ng-.+-\d+$/i,
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,
    /^\d+$/,
    /^[a-z]+-\d{4,}$/i,
    /^__/,
  ];

  function isDynamicId(id) {
    if (!id) return true;
    return DYNAMIC_ID_PATTERNS.some(rx => rx.test(id));
  }

  // ── Interactive element sets ──────────────────────────────────────────────────
  const INTERACTIVE_TAGS  = new Set(['button', 'a', 'label', 'summary', 'details']);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'tab', 'checkbox', 'radio', 'switch', 'option', 'treeitem',
    'gridcell', 'columnheader', 'rowheader',
  ]);

  // Container tags — never themselves actionable unless they have interaction signals
  const CONTAINER_TAGS = new Set([
    'div', 'span', 'section', 'article', 'aside', 'header', 'footer',
    'nav', 'main', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
    'form', 'fieldset', 'figure', 'figcaption', 'blockquote',
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'i', 'em', 'strong', 'small', 'b', 'u', 's',
    'img', 'svg', 'path', 'g', 'circle', 'rect', 'polygon',
  ]);

  // ── CR1: Visibility guard ─────────────────────────────────────────────────────
  function isVisibleElement(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
      return true;
    } catch { return true; }
  }

  // ── CR1: Actionable click guard ───────────────────────────────────────────────
  function isActionableClick(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag  = (el.tagName || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    // Native interactive tags — always record
    if (INTERACTIVE_TAGS.has(tag)) return true;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;

    // Explicit ARIA roles
    if (INTERACTIVE_ROLES.has(role)) return true;

    // <a> with href
    if (tag === 'a' && el.getAttribute('href') != null) return true;

    // Container tags need an explicit interaction signal
    if (CONTAINER_TAGS.has(tag)) {
      if (el.hasAttribute('onclick') || el.hasAttribute('onmousedown')) return true;
      if (el.hasAttribute('data-testid') || el.hasAttribute('data-qa') || el.hasAttribute('data-cy')) return true;
      const tabindex = el.getAttribute('tabindex');
      if (tabindex !== null && tabindex !== '-1') return true;
      if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return true;
      if (
        el.hasAttribute('aria-expanded') ||
        el.hasAttribute('aria-pressed')  ||
        el.hasAttribute('aria-selected') ||
        el.hasAttribute('aria-checked')  ||
        el.hasAttribute('aria-haspopup')
      ) return true;
      try { if (window.getComputedStyle(el).cursor === 'pointer') return true; } catch {}
      return false;
    }

    // Any other tag — record if testid, role, or pointer cursor
    if (el.hasAttribute('data-testid') || el.hasAttribute('data-qa')) return true;
    if (INTERACTIVE_ROLES.has(role)) return true;
    try { if (window.getComputedStyle(el).cursor === 'pointer') return true; } catch {}
    return false;
  }

  // ── Associated label lookup ───────────────────────────────────────────────────
  function getAssociatedLabel(el) {
    if (el.id && !isDynamicId(el.id)) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) {
        const text = (lbl.innerText || lbl.textContent || '').trim().replace(/\s+/g, ' ').replace(/[*:]+$/, '').trim();
        if (text && text.length > 1 && text.length <= 60) return text;
      }
    }
    const parent = el.closest('label');
    if (parent) {
      const clone = parent.cloneNode(true);
      clone.querySelectorAll('input,select,textarea').forEach(n => n.remove());
      const text = (clone.innerText || clone.textContent || '').trim().replace(/\s+/g, ' ').replace(/[*:]+$/, '').trim();
      if (text && text.length > 1 && text.length <= 60) return text;
    }
    const lblId = el.getAttribute('aria-labelledby');
    if (lblId) {
      const lblEl = document.getElementById(lblId);
      if (lblEl) {
        const text = (lblEl.innerText || lblEl.textContent || '').trim().replace(/\s+/g, ' ');
        if (text && text.length > 1 && text.length <= 60) return text;
      }
    }
    return null;
  }

  // ── Uniqueness check ──────────────────────────────────────────────────────────
  function countMatches(selector, root) {
    try { return (root || document).querySelectorAll(selector).length; } catch { return 0; }
  }

  // ── Parent context qualifier — makes a non-unique selector unique ─────────────
  function addParentContext(baseCSS, el, maxClimb) {
    let parent = el.parentElement;
    let depth  = 0;
    while (parent && parent !== document.body && depth < maxClimb) {
      const ptag = parent.tagName.toLowerCase();
      if (parent.id && !isDynamicId(parent.id)) {
        const q = `#${parent.id} ${baseCSS}`;
        if (countMatches(q) === 1) return { sel: q, type: 'css' };
      }
      const pName = parent.getAttribute('name');
      if (pName) {
        const q = `${ptag}[name="${pName}"] ${baseCSS}`;
        if (countMatches(q) === 1) return { sel: q, type: 'css' };
      }
      const pTid = parent.getAttribute('data-testid');
      if (pTid) {
        const q = `[data-testid="${pTid}"] ${baseCSS}`;
        if (countMatches(q) === 1) return { sel: q, type: 'css' };
      }
      parent = parent.parentElement;
      depth++;
    }
    return null;
  }

  // ── Row-anchored XPath for table cells ───────────────────────────────────────
  function buildRowAnchoredXPath(el) {
    let row = el;
    while (row && row.tagName !== 'TR') row = row.parentElement;
    if (!row) return null;
    const cells = Array.from(row.querySelectorAll('td'));
    let anchor = null;
    for (const cell of cells) {
      if (cell.contains(el)) continue;
      const text = (cell.innerText || cell.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length <= 50 && !/^\d+$/.test(text)) { anchor = text; break; }
    }
    if (!anchor) return null;
    const tag = el.tagName.toLowerCase();
    const al  = el.getAttribute('aria-label');
    const nm  = el.getAttribute('name');
    const tid = el.getAttribute('data-testid');
    const innerSel = al  ? `*[@aria-label="${al}"]`   :
                     nm  ? `${tag}[@name="${nm}"]`     :
                     tid ? `*[@data-testid="${tid}"]`  : tag;
    return `//tr[td[normalize-space(.)="${anchor}"]]//${innerSel}`;
  }

  // ── CR2: Relative XPath — always attribute-based, never /html/body/... ────────
  function buildRelativeXPath(el) {
    const tag = el.tagName.toLowerCase();
    const xpUnique = (expr) => {
      try {
        const res = document.evaluate(`count(${expr})`, document, null, XPathResult.NUMBER_TYPE, null);
        return res.numberValue === 1;
      } catch { return false; }
    };

    // 1. Stable id
    if (el.id && !isDynamicId(el.id)) {
      const x = `//*[@id="${el.id}"]`;
      if (xpUnique(x)) return x;
    }
    // 2. name
    const nm = el.getAttribute('name');
    if (nm) {
      const x = `//${tag}[@name="${nm}"]`;
      if (xpUnique(x)) return x;
    }
    // 3. data-testid / data-qa / data-cy
    for (const attr of ['data-testid', 'data-qa', 'data-cy']) {
      const v = el.getAttribute(attr);
      if (v) { const x = `//*[@${attr}="${v}"]`; if (xpUnique(x)) return x; }
    }
    // 4. aria-label
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) {
      const x = `//*[@aria-label="${al.trim()}"]`;
      if (xpUnique(x)) return x;
    }
    // 5. for attribute (label elements)
    if (tag === 'label') {
      const forAttr = el.getAttribute('for');
      if (forAttr) { const x = `//label[@for="${forAttr}"]`; if (xpUnique(x)) return x; }
    }
    // 6. placeholder / title
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) { const x = `//${tag}[@placeholder="${ph.trim()}"]`; if (xpUnique(x)) return x; }
    const title = el.getAttribute('title');
    if (title && title.trim()) { const x = `//${tag}[@title="${title.trim()}"]`; if (xpUnique(x)) return x; }
    // 7. value attribute (buttons/inputs)
    const val = el.getAttribute('value');
    if (val && val.trim() && (tag === 'button' || tag === 'input')) {
      const x = `//${tag}[@value="${val.trim()}"]`; if (xpUnique(x)) return x;
    }
    // 8. Text content — uniqueness-verified; refined with parent anchor if ambiguous
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length >= 2 && text.length <= 60) {
      const xSimple = `//${tag}[normalize-space(.)="${text}"]`;
      if (xpUnique(xSimple)) return xSimple;
      // Not unique — try anchoring to nearest stable ancestor
      let anc = el.parentElement, ad = 0;
      while (anc && anc !== document.body && ad < 4) {
        if (anc.id && !isDynamicId(anc.id)) {
          const x = `//*[@id="${anc.id}"]//${tag}[normalize-space(.)="${text}"]`;
          if (xpUnique(x)) return x;
        }
        const ancName = anc.getAttribute('name');
        if (ancName) {
          const x = `//${anc.tagName.toLowerCase()}[@name="${ancName}"]//${tag}[normalize-space(.)="${text}"]`;
          if (xpUnique(x)) return x;
        }
        anc = anc.parentElement; ad++;
      }
    }
    // 9. Relative positional within nearest stable ancestor (last resort)
    let anchor = el.parentElement, ad2 = 0;
    while (anchor && anchor !== document.body && ad2 < 6) {
      if ((anchor.id && !isDynamicId(anchor.id)) || anchor.getAttribute('data-testid') || anchor.getAttribute('name')) {
        const ancId = anchor.id && !isDynamicId(anchor.id)
          ? `@id="${anchor.id}"`
          : anchor.getAttribute('data-testid')
            ? `@data-testid="${anchor.getAttribute('data-testid')}"`
            : `@name="${anchor.getAttribute('name')}"`;
        const siblings = Array.from(anchor.querySelectorAll(tag));
        const idx      = siblings.indexOf(el) + 1;
        const x        = idx > 0 ? `//*[${ancId}]//${tag}[${idx}]` : `//*[${ancId}]//${tag}`;
        if (xpUnique(x)) {
          console.warn('[QA Recorder] Relative positional XPath — add data-testid or id for stability:', x);
          return x;
        }
      }
      anchor = anchor.parentElement; ad2++;
    }
    // Absolute last resort — anchored chain from nearest stable node
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      const t    = node.nodeName.toLowerCase();
      const sibs = Array.from(node.parentElement?.children || []).filter(c => c.tagName === node.tagName);
      const pos  = sibs.indexOf(node) + 1;
      parts.unshift(sibs.length > 1 ? `${t}[${pos}]` : t);
      node = node.parentElement;
      if (node && node !== document.body && ((node.id && !isDynamicId(node.id)) || node.getAttribute('data-testid'))) {
        const anId = node.id && !isDynamicId(node.id)
          ? `@id="${node.id}"`
          : `@data-testid="${node.getAttribute('data-testid')}"`;
        parts.unshift(`//*[${anId}]`);
        console.warn('[QA Recorder] Anchored positional XPath:', parts.join('/'));
        return parts.join('/');
      }
    }
    console.warn('[QA Recorder] No stable locator — add data-testid, id, or aria-label');
    return '//' + parts.join('/');
  }

  // ── CR2: Master selector strategy ────────────────────────────────────────────
  //
  // Priority (CSS-first for direct stable attributes, semantic fallbacks after):
  //   1. data-testid / data-qa / data-cy   — explicit automation marker
  //   2. Stable id (#id)                   — direct, unique CSS (was working before)
  //   3. name attribute                    — stable form attribute
  //   4. aria-label                        — explicit accessibility label
  //   5. placeholder                       — stable form hint text
  //   6. for attribute on label            — label[for="X"] pattern
  //   7. Stable attribute CSS              — type+value, href, title, aria-controls
  //   8. Role + accessible name            — semantic fallback (text can change)
  //   9. Associated label text             — text-based fallback
  //  10. Row-anchored XPath               — table cells
  //  11. Relative XPath                   — last resort, never /html/body/...
  //
  // Rule: CSS with a direct stable attribute always beats semantic/text selectors.
  function bestSelector(el, root) {
    if (!el || el.nodeType !== 1) return { sel: '', type: 'css' };
    const r   = root || document;
    const tag = el.tagName.toLowerCase();

    // 1. data-* automation attributes — gold standard
    for (const attr of ['data-testid', 'data-qa', 'data-cy', 'data-id', 'data-automation']) {
      const v = el.getAttribute(attr);
      if (v && v.trim()) {
        if (attr === 'data-testid') return { sel: `[data-testid="${v.trim()}"]`, type: 'testid' };
        const css = `[${attr}="${v.trim()}"]`;
        if (countMatches(css, r) === 1) return { sel: css, type: 'css' };
      }
    }

    // 2. Stable id — uniqueness verified (e.g. #username, #submitBtn)
    if (el.id && !isDynamicId(el.id)) {
      const cssId = `#${el.id}`;
      if (countMatches(cssId, r) === 1) return { sel: cssId, type: 'css' };
      // ID not unique — qualify with tag
      const cssTagId = `${tag}#${el.id}`;
      if (countMatches(cssTagId, r) === 1) return { sel: cssTagId, type: 'css' };
    }

    // 3. name attribute — uniqueness verified
    const nm = el.getAttribute('name');
    if (nm) {
      const cssName = `${tag}[name="${nm}"]`;
      if (countMatches(cssName, r) === 1) return { sel: cssName, type: 'name' };
      const parentCtx = addParentContext(cssName, el, 3);
      if (parentCtx) return parentCtx;
    }

    // 4. aria-label — uniqueness verified via XPath count
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      try {
        const xAria = `//*[@aria-label="${ariaLabel.trim()}"]`;
        const cnt   = document.evaluate(`count(${xAria})`, document, null, XPathResult.NUMBER_TYPE, null);
        if (cnt.numberValue === 1) return { sel: xAria, type: 'xpath' };
        const xTagAria = `//${tag}[@aria-label="${ariaLabel.trim()}"]`;
        const cnt2     = document.evaluate(`count(${xTagAria})`, document, null, XPathResult.NUMBER_TYPE, null);
        if (cnt2.numberValue === 1) return { sel: xTagAria, type: 'xpath' };
      } catch {}
    }

    // 5. Placeholder
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return { sel: `placeholder:${ph.trim()}`, type: 'placeholder' };

    // 6. for attribute on label → label[for="X"]
    if (tag === 'label') {
      const forAttr = el.getAttribute('for');
      if (forAttr) {
        const cssFor = `label[for="${forAttr}"]`;
        if (countMatches(cssFor, r) === 1) return { sel: cssFor, type: 'css' };
      }
    }

    // 7. Stable attribute CSS (type+value, href, title, aria-controls)
    const elType = el.getAttribute('type');
    const elVal  = el.getAttribute('value');
    if (elType && elVal) {
      const css = `${tag}[type="${elType}"][value="${elVal}"]`;
      if (countMatches(css, r) === 1) return { sel: css, type: 'css' };
    }
    if (elType && (tag === 'input' || tag === 'button')) {
      const css = `${tag}[type="${elType}"]`;
      if (countMatches(css, r) === 1) return { sel: css, type: 'css' };
    }
    const href = el.getAttribute('href');
    if (tag === 'a' && href && !href.startsWith('#') && href.length <= 80) {
      const css = `a[href="${href}"]`;
      if (countMatches(css, r) === 1) return { sel: css, type: 'css' };
    }
    const titleAttr = el.getAttribute('title');
    if (titleAttr && titleAttr.trim()) {
      const css = `${tag}[title="${titleAttr.trim()}"]`;
      if (countMatches(css, r) === 1) return { sel: css, type: 'css' };
    }
    const ariaControls = el.getAttribute('aria-controls');
    if (ariaControls) {
      const css = `[aria-controls="${ariaControls}"]`;
      if (countMatches(css, r) === 1) return { sel: css, type: 'css' };
    }

    // 8. Role + accessible name — semantic fallback (only when no stable CSS found)
    const elRole = el.getAttribute('role') || (
      tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'select' ? 'combobox' : null
    );
    if (elRole) {
      const al = el.getAttribute('aria-label');
      if (al && al.trim()) return { sel: `role:${elRole}:${al.trim()}`, type: 'role' };
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length <= 60) return { sel: `role:${elRole}:${text}`, type: 'role' };
    }

    // 9. Associated label text — text-based fallback (only when no stable CSS found)
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const lbl = getAssociatedLabel(el);
      if (lbl) return { sel: `label:${lbl}`, type: 'label' };
    }

    // 10. Row-anchored XPath for table cells
    const rowXPath = buildRowAnchoredXPath(el);
    if (rowXPath) return { sel: rowXPath, type: 'xpath' };

    // 11. Relative XPath — always attribute-based, never /html/body/...
    return { sel: buildRelativeXPath(el), type: 'xpath' };
  }

  // ── P1: Self-Healing helpers ──────────────────────────────────────────────────

  function normalizePageKey(url) {
    try {
      const u = new URL(url);
      const path = u.pathname
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
        .replace(/\/\d+/g, '/:id');
      return u.hostname + path;
    } catch { return url; }
  }

  function computeImportanceScore(el) {
    if (!el || el.nodeType !== 1) return 0;
    let score = 50;
    const tid  = el.getAttribute('data-testid');
    const al   = el.getAttribute('aria-label');
    const role = el.getAttribute('role') ||
      (el.tagName.toLowerCase() === 'button' ? 'button' :
       el.tagName.toLowerCase() === 'a'      ? 'link'   : null);
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (tid)                                          score += 50;
    if (al && al.trim())                              score += 40;
    if (text && text.length >= 2 && text.length <= 60) score += 35;
    if (role)                                         score += 30;
    if (el.id && !isDynamicId(el.id))                 score += 25;
    else if (el.id && isDynamicId(el.id))             score -= 20;
    return Math.max(0, Math.min(100, score));
  }

  function buildHealingProfile(el) {
    if (!el || el.nodeType !== 1) return null;
    const parent   = el.parentElement;
    const siblings = parent ? Array.from(parent.children) : [];
    let depth = 0, node = el;
    while (node && node !== document.body) { depth++; node = node.parentElement; }
    const classes = Array.from(el.classList)
      .filter(c => c && c.length >= 2 && c.length <= 50 && !/^\d+$/.test(c) && !/[a-f0-9]{6,}/.test(c))
      .slice(0, 8);
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    const parentCls = parent && typeof parent.className === 'string'
      ? parent.className.split(/\s+/).filter(c => c && c.length >= 2 && c.length <= 40)[0] || null
      : null;
    return {
      tag:          el.tagName.toLowerCase(),
      text:         text && text.length <= 100 ? text : null,
      ariaLabel:    el.getAttribute('aria-label') || null,
      role:         el.getAttribute('role') || null,
      classes,
      placeholder:  el.getAttribute('placeholder') || null,
      testId:       el.getAttribute('data-testid') || null,
      parentTag:    parent ? parent.tagName.toLowerCase() : null,
      parentId:     (parent && parent.id && !isDynamicId(parent.id)) ? parent.id : null,
      parentClass:  parentCls,
      domDepth:     depth,
      siblingIndex: siblings.indexOf(el),
      capturedAt:   new Date().toISOString(),
      capturedFrom: 'recorder',
    };
  }

  function buildAlternatives(el, primarySel) {
    if (!el || el.nodeType !== 1) return [];
    const tag  = el.tagName.toLowerCase();
    const seen = new Set([primarySel]);
    const alts = [];
    function tryAdd(sel, type, confidence) {
      if (!sel || seen.has(sel)) return;
      seen.add(sel);
      alts.push({ selector: sel, selectorType: type, confidence });
    }
    const tid = el.getAttribute('data-testid');
    if (tid) tryAdd(`[data-testid="${tid}"]`, 'testid', 95);
    const elRole = el.getAttribute('role') ||
      (tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'select' ? 'combobox' : null);
    if (elRole) {
      const al   = el.getAttribute('aria-label');
      if (al && al.trim()) tryAdd(`role:${elRole}:${al.trim()}`, 'role', 85);
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length <= 60) tryAdd(`role:${elRole}:${text}`, 'role', 82);
    }
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const lbl = getAssociatedLabel(el);
      if (lbl) tryAdd(`label:${lbl}`, 'label', 80);
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) tryAdd(`//*[@aria-label="${ariaLabel.trim()}"]`, 'xpath', 75);
    if (tag === 'label') {
      const forAttr = el.getAttribute('for');
      if (forAttr && countMatches(`label[for="${forAttr}"]`) === 1) tryAdd(`label[for="${forAttr}"]`, 'css', 70);
    }
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) tryAdd(`placeholder:${ph.trim()}`, 'placeholder', 65);
    if (el.id && !isDynamicId(el.id) && countMatches(`#${el.id}`) === 1) tryAdd(`#${el.id}`, 'css', 60);
    const nm = el.getAttribute('name');
    if (nm && countMatches(`${tag}[name="${nm}"]`) === 1) tryAdd(`${tag}[name="${nm}"]`, 'name', 55);
    const xp = buildRelativeXPath(el);
    if (xp) tryAdd(xp, 'xpath', 40);
    return alts;
  }

  function buildStepMeta(el, primarySel) {
    if (!el || el.nodeType !== 1) return {};
    return {
      healingProfile:  buildHealingProfile(el),
      alternatives:    buildAlternatives(el, primarySel),
      importanceScore: computeImportanceScore(el),
      pageKey:         normalizePageKey(location.href),
    };
  }

  // ── CR3: Smart human-readable name ───────────────────────────────────────────
  function smartName(el) {
    if (!el) return '';
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length <= 60) return text;
    // For <label> elements: use the "for" attribute to derive the referenced field's name
    if (el.tagName.toLowerCase() === 'label') {
      const forAttr = el.getAttribute('for');
      if (forAttr) {
        const field = document.getElementById(forAttr);
        if (field) {
          const fieldAl = field.getAttribute('aria-label');
          if (fieldAl && fieldAl.trim()) return fieldAl.trim();
          const fieldPh = field.getAttribute('placeholder');
          if (fieldPh && fieldPh.trim()) return fieldPh.trim();
          const fieldNm = field.getAttribute('name');
          if (fieldNm) return fieldNm.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
        return forAttr.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      }
    }
    const lbl = getAssociatedLabel(el);
    if (lbl) return lbl;
    const tid = el.getAttribute('data-testid');
    if (tid) return tid.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (el.id && !isDynamicId(el.id)) return el.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim();
    const nm = el.getAttribute('name');
    if (nm) return nm.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const role = el.getAttribute('role');
    return `${el.tagName.toLowerCase()}${role ? ' (' + role + ')' : ''}`;
  }

  // ── CR3: Spinner / AJAX detection ────────────────────────────────────────────
  // Returns true if the page currently has a visible loading spinner or AJAX indicator.
  // Used to delay FILL emit — if user types and submits before spinner clears,
  // the FILL is still buffered and will emit when typing stops (via flushPendingFill).
  const SPINNER_SEL = [
    '[role="progressbar"]', '[aria-busy="true"]', '.fa-spin',
    'mat-spinner', 'mat-progress-spinner',
    '[class*="spinner"]', '[class*="skeleton"]', '[class*="shimmer"]',
    '[class*="loader"]:not([class*="preloader"])',
  ].join(',');

  function isPageLoading() {
    try {
      const spinners = document.querySelectorAll(SPINNER_SEL);
      for (const s of spinners) {
        const r = s.getBoundingClientRect();
        if (r.width >= 4 || r.height >= 4) return true;
      }
    } catch {}
    return false;
  }

  // ── CR2: Deduplication helpers ────────────────────────────────────────────────

  // Snapshot of element's interactive state — allows re-recording same element
  // when its state changes (accordion toggle, checkbox, tab selection, etc.)
  function elementStateHash(el) {
    return [
      el.getAttribute('aria-expanded'),
      el.getAttribute('aria-checked'),
      el.getAttribute('aria-selected'),
      el.getAttribute('aria-pressed'),
      el.checked,
      el.value,
    ].join('|');
  }

  // Central emit gate — blocks cross-event noise and exact duplicates
  function shouldEmit(eventType, selector, value) {
    const now  = Date.now();
    const last = _lastEmitted;
    // Block exact duplicate (same type + selector + value within 1s)
    if (last.eventType === eventType && last.selector === selector && last.value === value && now - last.ts < 1000) return false;
    // Block CLICK immediately after FILL on same element (FILL already implies interaction)
    if (eventType === 'CLICK' && last.eventType === 'FILL' && last.selector === selector && now - last.ts < 800) return false;
    // Block FILL with identical value on same selector (re-focused without changing)
    if (eventType === 'FILL' && last.eventType === 'FILL' && last.selector === selector && last.value === value) return false;
    return true;
  }

  function recordEmit(eventType, selector, value) {
    _lastEmitted = { eventType, selector, value, ts: Date.now() };
  }

  // Smart FILL merge — emit buffered fill (called when timer fires or focus moves away)
  // CR3: if page is still loading (spinner visible), reschedule and wait for idle.
  function flushPendingFill() {
    if (!_pendingFill) return;
    clearTimeout(_pendingFill.timer);
    const f = _pendingFill;

    // CR3: spinner guard — page is still loading, retry after 300ms
    if (isPageLoading()) {
      f.timer = setTimeout(flushPendingFill, 300);
      return;
    }

    _pendingFill = null;
    if (!shouldEmit('FILL', f.loc.sel, f.value)) return;
    recordEmit('FILL', f.loc.sel, f.value);
    postStep({
      eventType:    'FILL',
      selector:     f.loc.sel,
      selectorType: f.loc.type,
      value:        f.value,
      smartName:    smartName(f.el),
      tagName:      f.el.tagName.toLowerCase(),
      url:          location.href,
      ...buildStepMeta(f.el, f.loc.sel),
    });
  }

  // ── Event handlers ────────────────────────────────────────────────────────────
  function handleClick(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (el.type === 'file') return; // handled by change

    // CR1: reject invisible elements and non-actionable containers
    if (!isVisibleElement(el)) return;
    if (!isActionableClick(el)) return;

    const loc       = bestSelector(el);
    const now       = Date.now();
    const stateHash = elementStateHash(el);

    // CR2: flush any pending fill on a DIFFERENT element before recording click
    if (_pendingFill && _pendingFill.loc.sel !== loc.sel) flushPendingFill();

    // CR2: state-aware click dedup — allow re-recording if element state changed
    // (e.g. accordion toggle, checkbox, tab — same element but new state)
    if (loc.sel === _lastClick.sel && stateHash === _lastClick.stateHash && now - _lastClick.ts < CLICK_DEBOUNCE_MS) return;
    _lastClick = { sel: loc.sel, ts: now, stateHash };

    if (el.type === 'checkbox' || el.type === 'radio') {
      const evType = el.checked ? 'CHECK' : 'UNCHECK';
      if (!shouldEmit(evType, loc.sel, '')) return;
      recordEmit(evType, loc.sel, '');
      postStep({
        eventType:    evType,
        selector:     loc.sel,
        selectorType: loc.type,
        value:        '',
        smartName:    smartName(el),
        tagName:      el.tagName.toLowerCase(),
        url:          location.href,
        ...buildStepMeta(el, loc.sel),
      });
      return;
    }

    // CR2: cross-event dedup — suppress click if fill was just emitted on same element
    if (!shouldEmit('CLICK', loc.sel, '')) return;
    recordEmit('CLICK', loc.sel, '');
    postStep({
      eventType:    'CLICK',
      selector:     loc.sel,
      selectorType: loc.type,
      value:        '',
      smartName:    smartName(el),
      tagName:      el.tagName.toLowerCase(),
      url:          location.href,
      ...buildStepMeta(el, loc.sel),
    });
  }

  function handleChange(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const loc = bestSelector(el);

    // CR2: flush any pending fill before recording a change on a different element
    if (_pendingFill && _pendingFill.loc.sel !== loc.sel) flushPendingFill();

    if (el.type === 'file' && el.files?.length > 0) {
      const files = Array.from(el.files).map(f => f.name).join(', ');
      postStep({
        eventType:    'UPLOAD',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        files,
        smartName:    smartName(el),
        tagName:      el.tagName.toLowerCase(),
        url:          location.href,
        ...buildStepMeta(el, loc.sel),
      });
      return;
    }
    if (el.tagName === 'SELECT') {
      const val = el.options[el.selectedIndex]?.text || el.value;
      postStep({
        eventType:    'SELECT',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        val,
        smartName:    smartName(el),
        tagName:      'select',
        url:          location.href,
        ...buildStepMeta(el, loc.sel),
      });
    }
  }

  // CR2: Smart FILL merge — blur fires on both blur and focusout; buffer the emit
  // so that if the user briefly loses and re-gains focus on the same field
  // (common in React/Angular with synthetic events), only one FILL is recorded.
  // If the user moves to a different field, the pending fill is flushed first.
  function handleBlur(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const fillable = ['text', 'email', 'password', 'search', 'url', 'tel', 'number', ''];
    if (!((tag === 'input' && fillable.includes(type)) || tag === 'textarea')) return;
    if (!el.value && el.value !== '0') return;

    const loc   = bestSelector(el);
    const value = el.value;

    if (_pendingFill && _pendingFill.loc.sel === loc.sel) {
      // Same field blurred again — update value and reset merge timer
      clearTimeout(_pendingFill.timer);
      _pendingFill.value = value;
      _pendingFill.el    = el;
    } else {
      // Different field — flush any existing pending fill first
      flushPendingFill();
      _pendingFill = { el, loc, value };
    }

    // Schedule the actual emit after FILL_MERGE_MS of inactivity
    _pendingFill.timer = setTimeout(flushPendingFill, FILL_MERGE_MS);
  }

  // ── Attach / detach ──────────────────────────────────────────────────────────
  function attachToRoot(root) {
    root.addEventListener('click',    handleClick,  true);
    root.addEventListener('change',   handleChange, true);
    root.addEventListener('blur',     handleBlur,   true);
    root.addEventListener('focusout', handleBlur,   true);
  }
  function detachFromRoot(root) {
    root.removeEventListener('click',    handleClick,  true);
    root.removeEventListener('change',   handleChange, true);
    root.removeEventListener('blur',     handleBlur,   true);
    root.removeEventListener('focusout', handleBlur,   true);
  }

  // Shadow DOM
  function injectIntoShadowRoot(sr) {
    attachToRoot(sr);
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.shadowRoot) injectIntoShadowRoot(n.shadowRoot);
    }))).observe(sr, { childList: true, subtree: true });
  }

  // Same-origin iframes
  function injectIntoIframe(iframe) {
    try { const doc = iframe.contentDocument; if (doc) { attachToRoot(doc); scanShadow(doc); } } catch {}
  }

  function scanShadow(root) {
    root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) injectIntoShadowRoot(el.shadowRoot); });
  }

  let _domObserver = null;

  // ── Dialog interceptor ────────────────────────────────────────────────────────
  // Must patch window.alert/confirm/prompt in the PAGE's main world, not the
  // isolated world. Inline <script> injection is blocked by Chrome MV3 CSP.
  // Instead, ask background.js to inject the patcher via chrome.scripting
  // executeScript({ world: 'MAIN' }) — which is CSP-safe and executes in the
  // page's own JS context. The patcher fires custom DOM events (__qa_dialog)
  // which cross the isolated-world boundary because both worlds share the DOM.
  let _dialogInterceptorInjected = false;
  function injectDialogInterceptor() {
    if (_dialogInterceptorInjected) return;
    _dialogInterceptorInjected = true;
    chrome.runtime.sendMessage({ type: 'INJECT_DIALOG_PATCHER' });
  }

  function attachListeners() {
    attachToRoot(document);
    scanShadow(document);
    document.querySelectorAll('iframe').forEach(injectIntoIframe);

    _domObserver = new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (!n || n.nodeType !== 1) return;
        if (n.shadowRoot) injectIntoShadowRoot(n.shadowRoot);
        if (n.tagName === 'IFRAME') injectIntoIframe(n);
        if (n.querySelectorAll) {
          n.querySelectorAll('*').forEach(c => { if (c.shadowRoot) injectIntoShadowRoot(c.shadowRoot); });
          n.querySelectorAll('iframe').forEach(injectIntoIframe);
        }
      }));
    });
    _domObserver.observe(document.documentElement, { childList: true, subtree: true });

    // NOTE: SPA navigation (pushState / popstate) is intentionally NOT captured.
    // Navigation steps are auto-generated by the test engine (generateNavBlock).

    injectDialogInterceptor();
    document.addEventListener('__qa_dialog', (e) => {
      if (!_active) return;
      postStep({
        eventType:    e.detail.type,
        selector:     '',
        selectorType: 'css',
        value:        String(e.detail.value ?? ''),
        smartName:    e.detail.smartName || 'Dialog',
        tagName:      '',
        url:          location.href,
      });
    });
  }

  function detachListeners() {
    flushPendingFill();  // CR2: emit any buffered fill before stopping
    detachFromRoot(document);
    if (_domObserver) { _domObserver.disconnect(); _domObserver = null; }
  }

  // ── Toast notification ────────────────────────────────────────────────────────
  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#7c3aed;color:#fff;padding:10px 18px;border-radius:8px;font-family:sans-serif;font-size:13px;font-weight:600;z-index:2147483647;box-shadow:0 4px 20px rgba(0,0,0,.3);transition:opacity .4s';
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 2500);
  }
})();
