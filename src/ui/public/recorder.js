/**
 * recorder.js — QA Agent Platform UI Recorder (v4)
 * Injected into AUT tab when __qa_recorder=<token> is present.
 *
 * v4 additions over v3:
 * [Critical]
 *   K. Self-Healing Phase 1 — healingProfile, alternatives[], importanceScore, pageKey captured per step
 * [High]
 *   L. Click filtering — isActionableClick() + isVisibleElement() guards prevent recording
 *      junk clicks on blank areas, layout containers, decorative/invisible elements.
 *      Only records clicks on: native interactive tags, ARIA-role elements, containers
 *      with explicit interaction signals (onclick, data-testid, tabindex=0, aria-expanded,
 *      cursor:pointer, aria-label, aria-haspopup).
 *   M. Locator generation overhaul — bestSelector() rebuilt with strict uniqueness enforcement:
 *      • Priority: data-testid → role+name → label → aria-label → placeholder → id → name
 *        → label[for] → stable attribute CSS → row-anchored XPath → relative XPath
 *      • countMatches() verifies uniqueness before returning any CSS selector
 *      • addParentContext() qualifies non-unique selectors with stable ancestor
 *      • buildRelativeXPath() replaces semanticXPath() — never generates /html/body/...
 *        absolute paths; uses attribute anchors at every level; text XPath is uniqueness-checked
 *        and refined with parent context when ambiguous
 *      • Classes are never used as primary locators
 *      • label[for="X"] is correctly captured for checkbox/label patterns
 *
 * v3 additions over v2:
 * [Critical]
 *   A. Retry queue          — 3 attempts with exponential backoff on network failure
 *   B. React/Angular inputs — input event tracks value as blur fallback
 *   C. Custom dropdowns     — Select2, Bootstrap, ARIA listbox/option, Kendo, Ant Design
 *   D. Token stripped       — __qa_recorder removed from all captured GOTO URLs
 * [High]
 *   E. Password masking     — FILL value replaced with {{env.PASSWORD}}
 *   F. AUT recording badge  — fixed bottom-right indicator shows step count
 *   G. FILL dedup           — same locator+value not emitted twice consecutively
 *   H. Toast/flash capture  — MutationObserver → auto ASSERT VISIBLE after actions
 *   I. Row-anchored locator — table cell clicks use row-anchor XPath
 * [Medium]
 *   J. Session keepalive    — heartbeat every 5 minutes to prevent session expiry
 */
(function () {
  'use strict';

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const TOKEN  = params.get('__qa_recorder');
  if (!TOKEN) return;

  const PLATFORM = window.__qa_recorder_origin || '';
  if (!PLATFORM) { console.warn('[QA Recorder] No __qa_recorder_origin set'); return; }

  let _active       = true;
  let _stepCounter  = 0;
  let _lastClick    = { sel: '', ts: 0, stateHash: '' };
  let _lastActionTs = 0;   // timestamp of last emitted step (for toast window)
  const CLICK_DEBOUNCE_MS = 800;   // raised from 300ms — covers accidental double-clicks
  const FILL_MERGE_MS     = 600;   // inactivity window before FILL is emitted

  // CR4: Submit-trigger keyword patterns — clicks on these auto-probe for URL change + toast
  const SUBMIT_TEXT_RX = /^(submit|save|login|sign\s*in|log\s*in|create|add|delete|confirm|update|apply|ok|yes|proceed|continue|finish|done|send|publish|activate|deactivate|enable|disable|approve|reject)$/i;

  // CR4: Extract path-only from URL (strips domain + query string) — environment-agnostic assertion
  function urlPath(href) {
    try {
      const u = new URL(href);
      return u.pathname;
    } catch { return href; }
  }

  // ── CR2: Central dedup state ──────────────────────────────────────────────────
  let _lastEmitted = { eventType: '', selector: '', value: '', ts: 0 };
  let _pendingFill = null;  // { el, loc, value, timer } — buffered until typing stops

  console.info('[QA Recorder] v3 started — token:', TOKEN.slice(0, 8) + '…');

  // ── [A] Retry queue ───────────────────────────────────────────────────────────
  const MAX_RETRIES = 3;

  function postStepWithRetry(body, attempt = 1) {
    fetch(`${PLATFORM}/api/recorder/step`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(body),
      credentials: 'include',
    }).catch(() => {
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 500; // 500ms → 1000ms → 2000ms
        setTimeout(() => postStepWithRetry(body, attempt + 1), delay);
      } else {
        console.warn('[QA Recorder] Step lost after', MAX_RETRIES, 'attempts:', body.eventType);
      }
    });
  }

  // ── Dynamic ID patterns — never use as selectors ──────────────────────────────
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

  // ── Fillable element check ────────────────────────────────────────────────────
  const FILLABLE_INPUT_TYPES = new Set(['text', 'email', 'password', 'search', 'url', 'tel', 'number', 'textarea', '']);

  function isFillable(el) {
    if (!el) return false;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    if (tag === 'input' && FILLABLE_INPUT_TYPES.has(type)) return true;
    return false;
  }

  function isPasswordField(el) {
    return el && el.tagName.toLowerCase() === 'input' && (el.type || '').toLowerCase() === 'password';
  }

  // ── Date input check ─────────────────────────────────────────────────────────
  function isDateInput(el) {
    const tag  = (el.tagName || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'input' && (type === 'date' || type === 'month' || type === 'datetime-local')) return true;
    if (tag === 'input' && (
      el.classList.contains('datepicker') ||
      el.hasAttribute('data-provide') ||
      el.hasAttribute('data-date-format') ||
      el.getAttribute('data-provide') === 'datepicker'
    )) return true;
    return false;
  }

  // ── [C] Custom dropdown detection ─────────────────────────────────────────────
  function isCustomDropdownOption(el) {
    if (!el) return false;
    const role = el.getAttribute('role');
    if (role === 'option' || role === 'menuitem') return true;
    const cls = typeof el.className === 'string' ? el.className : '';
    return /select2-results__option|chosen-result|k-item|mat-option|ant-select-item|v-list-item|dropdown-item/i.test(cls);
  }

  function findCustomDropdownTrigger(optionEl) {
    // Walk up from the option to find the listbox, then its associated trigger
    let node = optionEl.parentElement;
    let depth = 0;
    while (node && depth < 12) {
      const role = node.getAttribute('role');
      if (role === 'listbox' || role === 'combobox') {
        // aria-labelledby → find the trigger
        const lblBy = node.getAttribute('aria-labelledby');
        if (lblBy) {
          const trigger = document.getElementById(lblBy.split(' ')[0]);
          if (trigger) return trigger;
        }
        // aria-controls reverse lookup — find the element whose aria-controls points here
        if (node.id) {
          const ctrl = document.querySelector(`[aria-controls="${node.id}"]`);
          if (ctrl) return ctrl;
        }
        return node;
      }
      const cls = typeof node.className === 'string' ? node.className : '';
      if (/select2-container|chosen-container/i.test(cls)) {
        // Select2: the rendered selection span is the "trigger"
        const sel = node.querySelector('.select2-selection, .chosen-single');
        return sel || node;
      }
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  // ── Walk up to interactive ancestor ──────────────────────────────────────────
  const INTERACTIVE_TAGS  = new Set(['button', 'a', 'label', 'summary', 'details']);
  const INTERACTIVE_ROLES = new Set([
    'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
    'tab', 'checkbox', 'radio', 'switch', 'option', 'treeitem',
    'gridcell', 'columnheader', 'rowheader',
  ]);

  // Container tags that are never themselves actionable — only record if they have
  // explicit interaction signals (role, onclick, data-testid, tabindex, aria-label).
  const CONTAINER_TAGS = new Set([
    'div', 'span', 'section', 'article', 'aside', 'header', 'footer',
    'nav', 'main', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th',
    'form', 'fieldset', 'figure', 'figcaption', 'blockquote',
    'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'i', 'em', 'strong', 'small', 'b', 'u', 's',
    'img', 'svg', 'path', 'g', 'circle', 'rect', 'polygon',
  ]);

  function resolveInteractive(el) {
    let node = el, depth = 0;
    while (node && node !== document.body && depth < 5) {
      const tag  = (node.tagName || '').toLowerCase();
      const role = (node.getAttribute('role') || '').toLowerCase();
      if (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(role)) return node;
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return node;
      node = node.parentElement;
      depth++;
    }
    return el;
  }

  /**
   * Guard: returns true only if the resolved element is worth recording as a CLICK.
   *
   * Passes when element:
   *   1. Is a native interactive tag (button, a, input, select, textarea, label, summary, details)
   *   2. Has an explicit interactive role
   *   3. Is a container BUT has clear interaction signals:
   *      - onclick / onmousedown handler attribute
   *      - data-testid  (intentionally marked for automation)
   *      - tabindex="0" (keyboard-accessible custom widget)
   *      - aria-label or aria-labelledby (labelled interactive region)
   *      - aria-expanded / aria-pressed / aria-selected / aria-checked
   *      - cursor:pointer from computed style
   *
   * Rejects: plain container elements (div, section, span, p, h*, img, svg …)
   *          that have none of the above signals — these are layout/decoration only.
   */
  function isActionableClick(el) {
    if (!el || el.nodeType !== 1) return false;

    const tag  = (el.tagName || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    // Native interactive tags — always record
    if (INTERACTIVE_TAGS.has(tag)) return true;
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return true;

    // Explicit ARIA roles that imply click interaction
    if (INTERACTIVE_ROLES.has(role)) return true;

    // <a> with href — link
    if (tag === 'a' && el.getAttribute('href') != null) return true;

    // Container tags need an explicit interaction signal to be recorded
    if (CONTAINER_TAGS.has(tag)) {
      // onclick / onmousedown attribute (framework-rendered handlers are on the element)
      if (el.hasAttribute('onclick') || el.hasAttribute('onmousedown')) return true;
      // Automation marker — intentionally labelled for testing
      if (el.hasAttribute('data-testid') || el.hasAttribute('data-qa') || el.hasAttribute('data-cy')) return true;
      // Keyboard-accessible custom widget
      const tabindex = el.getAttribute('tabindex');
      if (tabindex !== null && tabindex !== '-1') return true;
      // Explicitly labelled interactive region
      if (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return true;
      // State-bearing ARIA attributes → toggle/accordion/disclosure
      if (
        el.hasAttribute('aria-expanded') ||
        el.hasAttribute('aria-pressed')  ||
        el.hasAttribute('aria-selected') ||
        el.hasAttribute('aria-checked')  ||
        el.hasAttribute('aria-haspopup')
      ) return true;
      // Cursor:pointer via computed style → framework likely wired a click handler
      try {
        if (window.getComputedStyle(el).cursor === 'pointer') return true;
      } catch {}
      // Nothing matched — junk container, skip
      return false;
    }

    // Any other non-container tag (canvas, video, audio, object, embed, etc.)
    // Record only if it has a testid, role, or pointer cursor
    if (el.hasAttribute('data-testid') || el.hasAttribute('data-qa')) return true;
    if (INTERACTIVE_ROLES.has(role)) return true;
    try { if (window.getComputedStyle(el).cursor === 'pointer') return true; } catch {}
    return false;
  }

  /**
   * Visibility guard: returns false for elements that are hidden or zero-size.
   * Prevents recording clicks on invisible overlay remnants.
   */
  function isVisibleElement(el) {
    try {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
      return true;
    } catch { return true; } // if we can't check, allow through
  }

  // ── Label lookup ──────────────────────────────────────────────────────────────
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

  // ── [I] Row-anchored table XPath ─────────────────────────────────────────────
  // When an element is inside <tr>, anchor XPath to a unique cell value in that row.
  // Result: //tr[td[normalize-space(.)="INV-001"]]//input[@name="amount"]
  function buildRowAnchoredXPath(el) {
    let row = el;
    while (row && row.tagName !== 'TR') row = row.parentElement;
    if (!row) return null;

    // Find a unique anchor cell — not the cell containing our element, not dates, not numbers alone
    const cells = Array.from(row.querySelectorAll('td'));
    let anchor = null;
    for (const cell of cells) {
      if (cell.contains(el)) continue;
      const text = (cell.innerText || cell.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length <= 50 && !/^\d+$/.test(text)) {
        anchor = text;
        break;
      }
    }
    if (!anchor) return null;

    // Build the sub-selector for the target element within the row
    const tag = el.tagName.toLowerCase();
    const al  = el.getAttribute('aria-label');
    const nm  = el.getAttribute('name');
    const tid = el.getAttribute('data-testid');
    const innerSel = al  ? `*[@aria-label="${al}"]`        :
                     nm  ? `${tag}[@name="${nm}"]`          :
                     tid ? `*[@data-testid="${tid}"]`       :
                     tag;

    return `//tr[td[normalize-space(.)="${anchor}"]]//${innerSel}`;
  }

  // ── Uniqueness check against document (or a scoped root) ────────────────────
  function countMatches(selector, root) {
    try { return (root || document).querySelectorAll(selector).length; } catch { return 0; }
  }

  // ── Build a contextual parent qualifier to make a selector unique ─────────────
  // Walks up ancestors until adding one makes the selector unique in the document.
  // Returns a CSS selector string like: #parentId > tag[attr="val"]
  // or null if no qualifying parent found within MAX_CLIMB levels.
  function addParentContext(baseCSS, el, maxClimb) {
    let parent = el.parentElement;
    let depth  = 0;
    while (parent && parent !== document.body && depth < maxClimb) {
      const ptag = parent.tagName.toLowerCase();
      // Prefer stable parent identifiers
      if (parent.id && !isDynamicId(parent.id)) {
        const qualified = `#${parent.id} ${baseCSS}`;
        if (countMatches(qualified) === 1) return { sel: qualified, type: 'css' };
      }
      const pName = parent.getAttribute('name');
      if (pName) {
        const qualified = `${ptag}[name="${pName}"] ${baseCSS}`;
        if (countMatches(qualified) === 1) return { sel: qualified, type: 'css' };
      }
      const pTid = parent.getAttribute('data-testid');
      if (pTid) {
        const qualified = `[data-testid="${pTid}"] ${baseCSS}`;
        if (countMatches(qualified) === 1) return { sel: qualified, type: 'css' };
      }
      parent = parent.parentElement;
      depth++;
    }
    return null;
  }

  // ── Relative XPath builder — always attribute-based, never absolute paths ─────
  //
  // Priority:
  //   1. id (stable)
  //   2. name
  //   3. data-testid
  //   4. aria-label
  //   5. placeholder / title
  //   6. text — uniqueness-checked; if not unique, refined with parent context
  //   7. for attribute on label → label[@for='X']
  //   8. Combined tag + stable attribute CSS (not classes)
  //   9. Relative positional within nearest stable ancestor (last resort, warns)
  //
  // NEVER generates /html/body/... absolute paths.
  function buildRelativeXPath(el, root) {
    const r   = root || document;
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
      if (v) {
        const x = `//*[@${attr}="${v}"]`;
        if (xpUnique(x)) return x;
      }
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
      if (forAttr) {
        const x = `//label[@for="${forAttr}"]`;
        if (xpUnique(x)) return x;
      }
    }

    // 6. placeholder / title
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) {
      const x = `//${tag}[@placeholder="${ph.trim()}"]`;
      if (xpUnique(x)) return x;
    }
    const title = el.getAttribute('title');
    if (title && title.trim()) {
      const x = `//${tag}[@title="${title.trim()}"]`;
      if (xpUnique(x)) return x;
    }

    // 7. value attribute (buttons / inputs)
    const val = el.getAttribute('value');
    if (val && val.trim() && (tag === 'button' || tag === 'input')) {
      const x = `//${tag}[@value="${val.trim()}"]`;
      if (xpUnique(x)) return x;
    }

    // 8. Text content — uniqueness-verified; refined with parent anchor if ambiguous
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length >= 2 && text.length <= 60) {
      const xSimple = `//${tag}[normalize-space(.)="${text}"]`;
      if (xpUnique(xSimple)) return xSimple;

      // Not unique — try anchoring to nearest stable ancestor
      let anc = el.parentElement;
      let ad  = 0;
      while (anc && anc !== document.body && ad < 4) {
        if (anc.id && !isDynamicId(anc.id)) {
          const x = `//*[@id="${anc.id}"]//${tag}[normalize-space(.)="${text}"]`;
          if (xpUnique(x)) return x;
        }
        const ancName = anc.getAttribute('name');
        if (ancName) {
          const ancTag = anc.tagName.toLowerCase();
          const x = `//${ancTag}[@name="${ancName}"]//${tag}[normalize-space(.)="${text}"]`;
          if (xpUnique(x)) return x;
        }
        anc = anc.parentElement;
        ad++;
      }
      // Still not unique — skip text-based, fall through to positional
    }

    // 9. Relative positional within nearest stable ancestor (last resort)
    // Builds: //*[@id="stableParent"]//tag[N]  — relative, NOT /html/body/...
    let anchor = el.parentElement;
    let ad2    = 0;
    while (anchor && anchor !== document.body && ad2 < 6) {
      if ((anchor.id && !isDynamicId(anchor.id)) ||
           anchor.getAttribute('data-testid') ||
           anchor.getAttribute('name')) {
        const ancId  = anchor.id && !isDynamicId(anchor.id) ? `@id="${anchor.id}"` :
                       anchor.getAttribute('data-testid')  ? `@data-testid="${anchor.getAttribute('data-testid')}"` :
                       `@name="${anchor.getAttribute('name')}"`;
        // Position of el within anchor
        const siblings = Array.from(anchor.querySelectorAll(tag));
        const idx      = siblings.indexOf(el) + 1;
        const x        = idx > 0
          ? `//*[${ancId}]//${tag}[${idx}]`
          : `//*[${ancId}]//${tag}`;
        if (xpUnique(x)) {
          console.warn('[QA Recorder] Relative positional XPath — add data-testid or id for stability:', x);
          return x;
        }
      }
      anchor = anchor.parentElement;
      ad2++;
    }

    // Absolute last resort — relative sibling index chain from body (never /html/body/...)
    // Only reached when the element has absolutely no stable attributes at any ancestor.
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      const t    = node.nodeName.toLowerCase();
      const sibs = Array.from(node.parentElement?.children || []).filter(c => c.tagName === node.tagName);
      const pos  = sibs.indexOf(node) + 1;
      parts.unshift(sibs.length > 1 ? `${t}[${pos}]` : t);
      node = node.parentElement;
      if (node && node !== document.body && (
        (node.id && !isDynamicId(node.id)) ||
        node.getAttribute('data-testid')
      )) {
        // Anchor here — stop climbing
        const anId = node.id && !isDynamicId(node.id)
          ? `@id="${node.id}"`
          : `@data-testid="${node.getAttribute('data-testid')}"`;
        parts.unshift(`//*[${anId}]`);
        console.warn('[QA Recorder] Anchored positional XPath — add stable attributes for reliability:', parts.join('/'));
        return parts.join('/');
      }
    }
    console.warn('[QA Recorder] No stable locator found — add data-testid, id, or aria-label to this element');
    return '//' + parts.join('/');
  }

  // ── Master selector strategy ──────────────────────────────────────────────────
  //
  // Priority (CSS-first for direct stable attributes, semantic fallbacks after):
  //   1. data-testid / data-qa / data-cy  — explicit automation marker
  //   2. Stable id (#id)                  — direct, unique CSS
  //   3. name attribute                   — stable form attribute
  //   4. aria-label                       — explicit accessibility label
  //   5. placeholder                      — stable form hint text
  //   6. for attribute on label           — label[for="X"] pattern
  //   7. Stable attribute CSS             — type+value, href, title, aria-controls
  //   8. Role + accessible name           — semantic fallback (text can change)
  //   9. Associated label text            — text-based fallback
  //  10. Row-anchored XPath              — table cells
  //  11. Relative XPath                  — last resort, never absolute
  //
  // Rule: CSS with a direct stable attribute always beats semantic/text selectors.
  // Classes are NEVER used as primary locators — they are styling artefacts.
  function bestSelector(el, root) {
    if (!el || el.nodeType !== 1) return { sel: '', type: 'css' };
    const r   = root || document;
    const tag = el.tagName.toLowerCase();

    // ── 1. data-* automation attributes ─────────────────────────────────────
    for (const attr of ['data-testid', 'data-qa', 'data-cy', 'data-id', 'data-automation']) {
      const v = el.getAttribute(attr);
      if (v && v.trim()) {
        if (attr === 'data-testid') return { sel: `[data-testid="${v.trim()}"]`, type: 'testid' };
        const css = `[${attr}="${v.trim()}"]`;
        if (countMatches(css, r) === 1) return { sel: css, type: 'css' };
      }
    }

    // ── 2. Stable id — uniqueness verified (e.g. #username, #submitBtn) ──────
    if (el.id && !isDynamicId(el.id)) {
      const cssId = `#${el.id}`;
      if (countMatches(cssId, r) === 1) return { sel: cssId, type: 'css' };
      const cssTagId = `${tag}#${el.id}`;
      if (countMatches(cssTagId, r) === 1) return { sel: cssTagId, type: 'css' };
    }

    // ── 3. name attribute — uniqueness verified ───────────────────────────────
    const nm = el.getAttribute('name');
    if (nm) {
      const cssName = `${tag}[name="${nm}"]`;
      if (countMatches(cssName, r) === 1) return { sel: cssName, type: 'name' };
      const parentCtx = addParentContext(cssName, el, 3);
      if (parentCtx) return parentCtx;
    }

    // ── 4. aria-label — uniqueness verified ───────────────────────────────────
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) {
      try {
        const xAria = `//*[@aria-label="${ariaLabel.trim()}"]`;
        const cnt = document.evaluate(`count(${xAria})`, document, null, XPathResult.NUMBER_TYPE, null);
        if (cnt.numberValue === 1) return { sel: xAria, type: 'xpath' };
        const xTagAria = `//${tag}[@aria-label="${ariaLabel.trim()}"]`;
        const cnt2 = document.evaluate(`count(${xTagAria})`, document, null, XPathResult.NUMBER_TYPE, null);
        if (cnt2.numberValue === 1) return { sel: xTagAria, type: 'xpath' };
      } catch {}
    }

    // ── 5. Placeholder ────────────────────────────────────────────────────────
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return { sel: `placeholder:${ph.trim()}`, type: 'placeholder' };

    // ── 6. for attribute on label → label[for="X"] ───────────────────────────
    if (tag === 'label') {
      const forAttr = el.getAttribute('for');
      if (forAttr) {
        const cssFor = `label[for="${forAttr}"]`;
        if (countMatches(cssFor, r) === 1) return { sel: cssFor, type: 'css' };
      }
    }

    // ── 7. Stable attribute CSS (not classes) — uniqueness verified ───────────
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

    // ── 8. Role + accessible name — semantic fallback only ────────────────────
    const elRole = el.getAttribute('role') || (
      tag === 'button'   ? 'button'   :
      tag === 'a'        ? 'link'     :
      tag === 'select'   ? 'combobox' :
      tag === 'checkbox' ? 'checkbox' : null
    );
    if (elRole) {
      const al = el.getAttribute('aria-label');
      if (al && al.trim()) return { sel: `role:${elRole}:${al.trim()}`, type: 'role' };
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length <= 60) return { sel: `role:${elRole}:${text}`, type: 'role' };
    }

    // ── 9. Associated label text — text-based fallback only ───────────────────
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const lbl = getAssociatedLabel(el);
      if (lbl) return { sel: `label:${lbl}`, type: 'label' };
    }

    // ── 10. Row-anchored XPath for table cells ────────────────────────────────
    const rowXPath = buildRowAnchoredXPath(el);
    if (rowXPath) return { sel: rowXPath, type: 'xpath' };

    // ── 11. Relative XPath — always attribute-based, never /html/body/... ─────
    return { sel: buildRelativeXPath(el, r), type: 'xpath' };
  }

  // ── [K] Self-Healing helpers (Phase 1) ───────────────────────────────────────

  /**
   * Normalise a page URL to a stable pattern key.
   * Replaces numeric segments and UUIDs with :id  e.g. /patients/123/records → /patients/:id/records
   */
  function normalizePageKey(url) {
    try {
      const u = new URL(url);
      const path = u.pathname
        .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
        .replace(/\/\d+/g, '/:id');
      return u.hostname + path;
    } catch { return url; }
  }

  /**
   * Compute element importance score (0–100).
   * Higher = more stable selector; lower = fragile/dynamic selector.
   */
  function computeImportanceScore(el) {
    if (!el || el.nodeType !== 1) return 0;
    let score = 50; // base
    const tid   = el.getAttribute('data-testid');
    const al    = el.getAttribute('aria-label');
    const role  = el.getAttribute('role') ||
      (el.tagName.toLowerCase() === 'button' ? 'button' :
       el.tagName.toLowerCase() === 'a'      ? 'link'   : null);
    const text  = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (tid)                                     score += 50;  // testid — gold standard
    if (al && al.trim())                         score += 40;  // aria-label
    if (text && text.length >= 2 && text.length <= 60) score += 35;  // visible text
    if (role)                                    score += 30;  // role
    if (el.id && !isDynamicId(el.id))            score += 25;  // stable static ID
    else if (el.id && isDynamicId(el.id))        score -= 20;  // generated ID penalty
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Capture a structural fingerprint of the element for similarity scoring.
   */
  function buildHealingProfile(el) {
    if (!el || el.nodeType !== 1) return null;
    const parent = el.parentElement;
    const siblings = parent ? Array.from(parent.children) : [];
    let depth = 0;
    let node = el;
    while (node && node !== document.body) { depth++; node = node.parentElement; }
    // Filter out obviously dynamic class tokens (long hash-like, pure numbers)
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

  /**
   * Build all alternative selectors for an element, excluding the primary one.
   * Each entry carries a confidence score (0–100).
   */
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

    // testid
    const tid = el.getAttribute('data-testid');
    if (tid) tryAdd(`[data-testid="${tid}"]`, 'testid', 95);

    // role + accessible name
    const elRole = el.getAttribute('role') ||
      (tag === 'button' ? 'button' : tag === 'a' ? 'link' : tag === 'select' ? 'combobox' : null);
    if (elRole) {
      const al   = el.getAttribute('aria-label');
      if (al && al.trim()) tryAdd(`role:${elRole}:${al.trim()}`, 'role', 85);
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length <= 60) tryAdd(`role:${elRole}:${text}`, 'role', 82);
    }

    // associated label
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const lbl = getAssociatedLabel(el);
      if (lbl) tryAdd(`label:${lbl}`, 'label', 80);
    }

    // aria-label xpath
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) tryAdd(`//*[@aria-label="${ariaLabel.trim()}"]`, 'xpath', 75);

    // placeholder
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) tryAdd(`placeholder:${ph.trim()}`, 'placeholder', 65);

    // stable id (uniqueness verified)
    if (el.id && !isDynamicId(el.id) && countMatches(`#${el.id}`) === 1) tryAdd(`#${el.id}`, 'css', 60);

    // name attr (uniqueness verified)
    const nm = el.getAttribute('name');
    if (nm && countMatches(`${tag}[name="${nm}"]`) === 1) tryAdd(`${tag}[name="${nm}"]`, 'name', 55);

    // label[for] on label elements
    if (tag === 'label') {
      const forAttr = el.getAttribute('for');
      if (forAttr && countMatches(`label[for="${forAttr}"]`) === 1) tryAdd(`label[for="${forAttr}"]`, 'css', 70);
    }

    // relative xpath (lower confidence — never absolute)
    const xp = buildRelativeXPath(el);
    if (xp) tryAdd(xp, 'xpath', 40);

    return alts;
  }

  /**
   * Build the healing metadata object to attach to every recorded step that has a DOM element.
   * Returns an object spread into the postStep payload.
   */
  function buildStepMeta(el, primarySel) {
    if (!el || el.nodeType !== 1) return {};
    return {
      healingProfile:  buildHealingProfile(el),
      alternatives:    buildAlternatives(el, primarySel),
      importanceScore: computeImportanceScore(el),
      pageKey:         normalizePageKey(window.location.href),
    };
  }

  // ── Smart human-readable name ─────────────────────────────────────────────────
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
        // Try the referenced field for a better name
        const field = document.getElementById(forAttr);
        if (field) {
          const fieldAl   = field.getAttribute('aria-label');
          if (fieldAl && fieldAl.trim()) return fieldAl.trim();
          const fieldPh   = field.getAttribute('placeholder');
          if (fieldPh && fieldPh.trim()) return fieldPh.trim();
          const fieldName = field.getAttribute('name');
          if (fieldName) return fieldName.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
        // Fall back to the for attribute value itself (e.g., "FlgEnable" → "Flg Enable")
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

  // ── [D] URL cleaner — strips recorder token ───────────────────────────────────
  function cleanUrl(url) {
    try {
      const u = new URL(url);
      u.searchParams.delete('__qa_recorder');
      return u.toString();
    } catch { return url; }
  }

  // ── [CR7] Element highlight + step overlay ────────────────────────────────────

  // Colour map per action type
  const CR7_COLOURS = {
    CLICK:        '#ef4444',   // red
    DBLCLICK:     '#f97316',   // orange
    FILL:         '#3b82f6',   // blue
    SELECT:       '#8b5cf6',   // purple
    CHECK:        '#10b981',   // green
    UNCHECK:      '#6b7280',   // grey
    HOVER:        '#facc15',   // yellow
    ASSERT_TOAST: '#22c55e',   // green
    ASSERT_URL:   '#06b6d4',   // cyan
    DEFAULT:      '#a855f7',   // purple
  };

  function cr7Colour(eventType) {
    return CR7_COLOURS[eventType] || CR7_COLOURS.DEFAULT;
  }

  // Inject shared keyframe styles once
  function cr7InjectStyles() {
    if (document.getElementById('__qa_cr7_styles')) return;
    const s = document.createElement('style');
    s.id = '__qa_cr7_styles';
    s.textContent = `
      @keyframes __qa_highlight_fade {
        0%   { opacity: 1; transform: scale(1.04); }
        70%  { opacity: 0.7; transform: scale(1); }
        100% { opacity: 0; transform: scale(1); }
      }
      @keyframes __qa_overlay_slide {
        0%   { opacity: 0; transform: translateX(-50%) translateY(-8px); }
        15%  { opacity: 1; transform: translateX(-50%) translateY(0); }
        75%  { opacity: 1; transform: translateX(-50%) translateY(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-6px); }
      }
    `;
    document.head.appendChild(s);
  }

  /**
   * Flash a coloured outline ring around an element for 1.2s.
   * Uses an absolutely-positioned div cloned to the element's bounding rect.
   */
  function cr7Highlight(el, eventType) {
    if (!el || !document.body) return;
    try {
      cr7InjectStyles();
      const rect  = el.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      const colour = cr7Colour(eventType);
      const ring   = document.createElement('div');
      ring.style.cssText = [
        'position:fixed',
        `top:${rect.top - 3}px`,
        `left:${rect.left - 3}px`,
        `width:${rect.width + 6}px`,
        `height:${rect.height + 6}px`,
        `border:3px solid ${colour}`,
        'border-radius:5px',
        'pointer-events:none',
        'z-index:2147483645',
        'box-sizing:border-box',
        `box-shadow:0 0 8px 2px ${colour}55`,
        'animation:__qa_highlight_fade 1.2s ease-out forwards',
      ].join(';');
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 1300);
    } catch { /* never crash recording */ }
  }

  /**
   * Show a brief step overlay card near the top of the viewport.
   * Displays: action badge + locator preview.
   * Auto-removes after 2s.
   */
  let _cr7OverlayTimer = null;
  let _cr7Overlay      = null;

  function cr7ShowOverlay(eventType, locatorPreview) {
    if (!document.body) return;
    try {
      cr7InjectStyles();
      // Reuse existing overlay (reset animation) rather than stacking multiple
      if (_cr7Overlay && document.body.contains(_cr7Overlay)) {
        _cr7Overlay.remove();
        clearTimeout(_cr7OverlayTimer);
      }

      const colour  = cr7Colour(eventType);
      const label   = eventType.replace(/_/g, ' ');
      const preview = locatorPreview
        ? (locatorPreview.length > 55 ? locatorPreview.slice(0, 52) + '…' : locatorPreview)
        : '';

      const el = document.createElement('div');
      el.id = '__qa_cr7_overlay';
      el.style.cssText = [
        'position:fixed',
        'top:14px',
        'left:50%',
        'transform:translateX(-50%)',
        'z-index:2147483646',
        'pointer-events:none',
        'display:flex',
        'align-items:center',
        'gap:10px',
        'background:rgba(15,15,20,0.92)',
        'border:1px solid rgba(255,255,255,0.12)',
        'border-radius:8px',
        'padding:9px 16px',
        'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'font-size:13px',
        'max-width:480px',
        'animation:__qa_overlay_slide 2.2s ease-in-out forwards',
      ].join(';');

      el.innerHTML =
        `<span style="background:${colour};color:#fff;font-weight:700;font-size:11px;padding:2px 8px;border-radius:4px;white-space:nowrap;letter-spacing:0.04em">${label}</span>` +
        (preview ? `<span style="color:#d4d4d4;font-size:12px;font-family:monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</span>` : '');

      document.body.appendChild(el);
      _cr7Overlay = el;
      _cr7OverlayTimer = setTimeout(() => { el.remove(); _cr7Overlay = null; }, 2300);
    } catch { /* never crash recording */ }
  }

  /**
   * Combined call: highlight element + show overlay.
   * Call after every postStep.
   */
  function cr7Feedback(el, eventType, locatorPreview) {
    if (el) cr7Highlight(el, eventType);
    cr7ShowOverlay(eventType, locatorPreview);
  }

  // ── [F] AUT recording badge ───────────────────────────────────────────────────
  let _badge = null, _badgeCount = null;

  function createBadge() {
    if (document.getElementById('__qa_rec_badge')) return;
    const style = document.createElement('style');
    style.textContent = '@keyframes __qa_blink{0%,100%{opacity:1}50%{opacity:0.3}}';
    document.head.appendChild(style);
    _badge = document.createElement('div');
    _badge.id = '__qa_rec_badge';
    _badge.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'z-index:2147483647',
      'background:#dc2626', 'color:#fff', 'font-family:monospace', 'font-size:13px',
      'font-weight:600', 'padding:7px 14px', 'border-radius:6px',
      'box-shadow:0 2px 12px rgba(0,0,0,0.35)', 'display:flex',
      'align-items:center', 'gap:8px', 'user-select:none', 'pointer-events:none',
    ].join(';');
    _badge.innerHTML = '<span style="animation:__qa_blink 1s infinite;display:inline-block">●</span>'
      + '<span>REC</span>'
      + '<span id="__qa_rec_count" style="background:rgba(255,255,255,0.25);border-radius:3px;padding:1px 6px">0</span>';
    document.body.appendChild(_badge);
    _badgeCount = document.getElementById('__qa_rec_count');
  }

  function updateBadge() { if (_badgeCount) _badgeCount.textContent = String(_stepCounter); }
  function removeBadge()  { if (_badge) _badge.remove(); }

  if (document.body) { createBadge(); }
  else { document.addEventListener('DOMContentLoaded', createBadge); }

  // ── CR3: Spinner / AJAX detection ────────────────────────────────────────────
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

  function shouldEmit(eventType, selector, value) {
    const now  = Date.now();
    const last = _lastEmitted;
    if (last.eventType === eventType && last.selector === selector && last.value === value && now - last.ts < 1000) return false;
    if (eventType === 'CLICK' && last.eventType === 'FILL' && last.selector === selector && now - last.ts < 800) return false;
    if (eventType === 'FILL' && last.eventType === 'FILL' && last.selector === selector && last.value === value) return false;
    return true;
  }

  function recordEmit(eventType, selector, value) {
    _lastEmitted  = { eventType, selector, value, ts: Date.now() };
    _lastActionTs = Date.now();  // keep toast window in sync
  }

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
    const emitValue = isPasswordField(f.el) ? '{{env.PASSWORD}}' : f.value;
    if (!shouldEmit('FILL', f.loc.sel, emitValue)) return;
    recordEmit('FILL', f.loc.sel, emitValue);
    postStep({
      eventType:    'FILL',
      selector:     f.loc.sel,
      selectorType: f.loc.type,
      value:        emitValue,
      smartName:    smartName(f.el),
      tagName:      f.el.tagName.toLowerCase(),
      url:          cleanUrl(window.location.href),
      ...buildStepMeta(f.el, f.loc.sel),
    });
    cr7Feedback(f.el, 'FILL', f.loc.sel);
  }

  // ── [G] React/Angular value tracking (kept for blur fallback) ─────────────────
  const _lastInputValue  = new Map(); // selector → value from last input event

  // ── POST step ─────────────────────────────────────────────────────────────────
  function postStep(payload) {
    if (!_active) return;
    _stepCounter++;
    _lastActionTs = Date.now();
    const body = Object.assign({ token: TOKEN, stepNum: _stepCounter }, payload);
    postStepWithRetry(body);
    updateBadge();
  }

  // ── CLICK handler ─────────────────────────────────────────────────────────────
  function handleClick(e) {
    const raw = e.target;
    if (!raw || raw.nodeType !== 1) return;

    // [C] Custom dropdown option → SELECT keyword
    if (isCustomDropdownOption(raw)) {
      const optionText = (raw.innerText || raw.textContent || '').trim().replace(/\s+/g, ' ');
      if (!optionText) return;
      const trigger = findCustomDropdownTrigger(raw);
      const triggerEl = trigger || raw;
      const loc     = bestSelector(triggerEl);
      postStep({
        eventType:    'SELECT',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        optionText,
        smartName:    smartName(triggerEl),
        tagName:      'select',
        url:          cleanUrl(window.location.href),
        ...buildStepMeta(triggerEl, loc.sel),
      });
      cr7Feedback(triggerEl, 'SELECT', loc.sel);
      return;
    }

    const el = resolveInteractive(raw);

    // Suppress CLICK on elements handled by other events
    if (isFillable(el))                          return;
    if (isDateInput(el))                         return;
    if ((el.type || '').toLowerCase() === 'file') return;
    if (el.tagName.toLowerCase() === 'select')   return;

    // [NEW] Reject invisible elements (zero-size / hidden)
    if (!isVisibleElement(el)) return;

    // [NEW] Reject non-actionable containers (blank space, layout divs, decorative elements)
    if (!isActionableClick(el)) return;

    const loc       = bestSelector(el);
    const now       = Date.now();
    const stateHash = elementStateHash(el);

    // CR2: flush pending fill on a different element before recording click
    if (_pendingFill && _pendingFill.loc.sel !== loc.sel) flushPendingFill();

    // CR2: state-aware dedup — allow re-record if element state changed
    if (loc.sel === _lastClick.sel && stateHash === _lastClick.stateHash && now - _lastClick.ts < CLICK_DEBOUNCE_MS) return;
    _lastClick = { sel: loc.sel, ts: now, stateHash };

    const type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
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
        url:          cleanUrl(window.location.href),
        ...buildStepMeta(el, loc.sel),
      });
      cr7Feedback(el, evType, loc.sel);
      return;
    }

    // CR2: cross-event dedup — suppress click if fill was just emitted on same element
    if (!shouldEmit('CLICK', loc.sel, '')) return;
    recordEmit('CLICK', loc.sel, '');

    const clickUrl = window.location.href;  // snapshot URL before click

    postStep({
      eventType:    'CLICK',
      selector:     loc.sel,
      selectorType: loc.type,
      value:        '',
      smartName:    smartName(el),
      tagName:      el.tagName.toLowerCase(),
      url:          cleanUrl(clickUrl),
      ...buildStepMeta(el, loc.sel),
    });
    cr7Feedback(el, 'CLICK', loc.sel);

    // CR4: after submit-type clicks, probe URL 1.5s later — if changed, emit ASSERT_URL
    // Only triggers for type=submit OR button text matching submit-action keywords
    const elType = (el.type || '').toLowerCase();
    const elText = (el.innerText || el.textContent || el.value || '').trim().replace(/\s+/g, ' ');
    const isSubmitType = elType === 'submit' || SUBMIT_TEXT_RX.test(elText);
    if (isSubmitType) {
      setTimeout(() => {
        if (!_active) return;
        const newUrl = window.location.href;
        // Only emit ASSERT_URL if full-page navigation occurred (pushState already handles SPA)
        if (newUrl !== clickUrl && !newUrl.startsWith(clickUrl.split('#')[0] + '#')) {
          emitAssertUrl();
        }
      }, 1500);
    }
  }

  // ── [B] INPUT handler — tracks React/Angular controlled values ────────────────
  function handleInput(e) {
    const el = e.target;
    if (!el || !isFillable(el) || isDateInput(el)) return;
    const loc = bestSelector(el);
    _lastInputValue.set(loc.sel, el.value);
  }

  // ── CHANGE handler — SELECT / FILE CHOOSER / DATE PICKER ─────────────────────
  function handleChange(e) {
    const el   = e.target;
    if (!el || el.nodeType !== 1) return;
    const loc  = bestSelector(el);

    // CR2: flush pending fill on different element before recording change
    if (_pendingFill && _pendingFill.loc.sel !== loc.sel) flushPendingFill();
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    // File input → FILE CHOOSER
    if (type === 'file' && el.files && el.files.length > 0) {
      const files = Array.from(el.files).map(f => f.name).join(', ');
      postStep({
        eventType:    'FILE_CHOOSER',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        files,
        smartName:    smartName(el),
        tagName:      tag,
        url:          cleanUrl(window.location.href),
        ...buildStepMeta(el, loc.sel),
      });
      cr7Feedback(el, 'FILE_CHOOSER', loc.sel);
      return;
    }

    // Date / datepicker → DATE PICKER
    if (isDateInput(el) && el.value) {
      postStep({
        eventType:    'DATE_PICKER',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        el.value,
        smartName:    smartName(el),
        tagName:      tag,
        url:          cleanUrl(window.location.href),
        ...buildStepMeta(el, loc.sel),
      });
      cr7Feedback(el, 'DATE_PICKER', loc.sel);
      return;
    }

    // Native select → SELECT
    if (tag === 'select') {
      const val = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value;
      postStep({
        eventType:    'SELECT',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        val,
        smartName:    smartName(el),
        tagName:      'select',
        url:          cleanUrl(window.location.href),
        ...buildStepMeta(el, loc.sel),
      });
      cr7Feedback(el, 'SELECT', loc.sel);
    }
  }

  // ── BLUR handler — CR2 Smart FILL merge ──────────────────────────────────────
  // Buffers the FILL for FILL_MERGE_MS after blur. If the user re-focuses the
  // same field within that window (React/Angular synthetic events, label clicks)
  // the timer resets and only one FILL is emitted when they truly leave the field.
  // [B] React/Angular: uses input-tracked value as fallback if el.value is cleared.
  function handleBlur(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (isDateInput(el)) return;
    if (!((tag === 'input' && FILLABLE_INPUT_TYPES.has(type)) || tag === 'textarea' || el.getAttribute('contenteditable') === 'true')) return;

    const loc = bestSelector(el);

    // [B] Use input-tracked value as fallback (React may clear el.value before blur)
    const value = el.value || _lastInputValue.get(loc.sel) || '';
    _lastInputValue.delete(loc.sel);

    if (!value && value !== '0') return;

    if (_pendingFill && _pendingFill.loc.sel === loc.sel) {
      // Same field — update value and reset merge timer
      clearTimeout(_pendingFill.timer);
      _pendingFill.value = value;
      _pendingFill.el    = el;
    } else {
      // Different field — flush existing pending fill first
      flushPendingFill();
      _pendingFill = { el, loc, value };
    }

    _pendingFill.timer = setTimeout(flushPendingFill, FILL_MERGE_MS);
  }

  // ── [H] Toast / Flash message observer ───────────────────────────────────────
  const TOAST_CLASS_RX   = /toast|snackbar|flash|noty|notyf|swal|toastr|izitoast/i;
  const TOAST_ID_RX      = /toast|snackbar|flash|alert|notification/i;
  const TOAST_EXCLUDE_RX = /modal|backdrop|overlay|spinner|loader|progress/i;
  const TOAST_WINDOW_MS  = 3000; // only capture toasts within 3s of last user action

  function isToastLike(el) {
    if (!el || el.nodeType !== 1) return false;
    const cls  = typeof el.className === 'string' ? el.className : '';
    const id   = el.id || '';
    const role = el.getAttribute('role') || '';
    if (TOAST_EXCLUDE_RX.test(cls) || TOAST_EXCLUDE_RX.test(id)) return false;
    if (role === 'alert' || role === 'status' || role === 'log') return true;
    return TOAST_CLASS_RX.test(cls) || TOAST_ID_RX.test(id);
  }

  function captureToast(el) {
    if (!_active) return;
    if (Date.now() - _lastActionTs > TOAST_WINDOW_MS) return;
    // Brief delay to let text render
    setTimeout(() => {
      if (!document.body.contains(el)) return;
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length < 2 || text.length > 200) return;
      // CR4: emit ASSERT_TOAST (waits + checks text) instead of plain ASSERT_VISIBLE
      postStep({
        eventType:    'ASSERT_TOAST',
        selector:     '',
        selectorType: 'css',
        value:        text,
        smartName:    text.substring(0, 60),
        tagName:      '',
        url:          cleanUrl(window.location.href),
      });
      cr7Feedback(el, 'ASSERT_TOAST', text.substring(0, 40));
    }, 120);
  }

  const toastObserver = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (isToastLike(node)) { captureToast(node); return; }
        // Check children — some frameworks wrap toast in a generic container
        if (node.querySelectorAll) {
          node.querySelectorAll('[role="alert"],[role="status"]').forEach(captureToast);
        }
      });
    });
  });

  // Start toast observer (body guaranteed present — recorder injected at DOMContentLoaded)
  toastObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // ── Attach listeners to a root ────────────────────────────────────────────────
  function attachToRoot(root) {
    root.addEventListener('click',  handleClick,  true);
    root.addEventListener('change', handleChange, true);
    root.addEventListener('blur',   handleBlur,   true);
    root.addEventListener('input',  handleInput,  true); // [B]
  }

  // ── Shadow DOM ────────────────────────────────────────────────────────────────
  function injectIntoShadowRoot(shadowRoot) {
    attachToRoot(shadowRoot);
    const obs = new MutationObserver(mutations => {
      mutations.forEach(m => {
        m.addedNodes.forEach(node => {
          if (node.shadowRoot) injectIntoShadowRoot(node.shadowRoot);
        });
      });
    });
    obs.observe(shadowRoot, { childList: true, subtree: true });
  }

  function scanForShadowRoots(root) {
    root.querySelectorAll('*').forEach(el => {
      if (el.shadowRoot) injectIntoShadowRoot(el.shadowRoot);
    });
  }

  // ── Same-origin iframes ───────────────────────────────────────────────────────
  function injectIntoIframe(iframe) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) return;
      attachToRoot(doc);
      scanForShadowRoots(doc);
    } catch { /* cross-origin — skip */ }
  }

  function scanForIframes(root) {
    root.querySelectorAll('iframe').forEach(injectIntoIframe);
  }

  // ── Main document ─────────────────────────────────────────────────────────────
  attachToRoot(document);
  scanForShadowRoots(document);
  scanForIframes(document);

  const domObserver = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (!node || node.nodeType !== 1) return;
        if (node.shadowRoot) injectIntoShadowRoot(node.shadowRoot);
        if (node.tagName === 'IFRAME') injectIntoIframe(node);
        if (node.querySelectorAll) {
          node.querySelectorAll('*').forEach(child => {
            if (child.shadowRoot) injectIntoShadowRoot(child.shadowRoot);
          });
          node.querySelectorAll('iframe').forEach(injectIntoIframe);
        }
      });
    });
  });
  domObserver.observe(document.documentElement, { childList: true, subtree: true });

  // ── [D] SPA navigation — token stripped from URLs ─────────────────────────────
  const _origPush    = history.pushState.bind(history);
  const _origReplace = history.replaceState.bind(history);

  // CR4: emit ASSERT_URL (path only) after SPA navigation — auto-inserted after GOTO
  function emitAssertUrl() {
    if (!_active) return;
    const path = urlPath(window.location.href);
    if (!path || path === '/') return;  // skip root — too generic
    postStep({
      eventType:    'ASSERT_URL',
      selector:     '',
      selectorType: 'css',
      value:        path,
      smartName:    `URL: ${path}`,
      tagName:      '',
      url:          cleanUrl(window.location.href),
    });
    cr7Feedback(null, 'ASSERT_URL', path);
  }

  history.pushState = function (...args) {
    _origPush(...args);
    postStep({ eventType: 'GOTO', selector: '', selectorType: 'css', value: cleanUrl(window.location.href), smartName: '', tagName: '', url: cleanUrl(window.location.href) });
    // CR4: auto-assert the URL the SPA navigated to (path only — environment-agnostic)
    setTimeout(emitAssertUrl, 100);
  };
  history.replaceState = function (...args) {
    _origReplace(...args);
    // replaceState is often internal router (Angular) — skip to reduce noise
  };

  window.addEventListener('popstate', () => {
    postStep({ eventType: 'GOTO', selector: '', selectorType: 'css', value: cleanUrl(window.location.href), smartName: '', tagName: '', url: cleanUrl(window.location.href) });
    // CR4: auto-assert URL after browser back/forward navigation
    setTimeout(emitAssertUrl, 100);
  });

  // ── Browser dialogs ───────────────────────────────────────────────────────────
  const _origAlert   = window.alert.bind(window);
  const _origConfirm = window.confirm.bind(window);
  const _origPrompt  = window.prompt.bind(window);

  window.alert = function (msg) {
    postStep({ eventType: 'ACCEPT_ALERT', selector: '', selectorType: 'css', value: String(msg ?? ''), smartName: 'Alert Dialog', tagName: '', url: cleanUrl(window.location.href) });
    _origAlert(msg);
  };
  window.confirm = function (msg) {
    postStep({ eventType: 'ACCEPT_DIALOG', selector: '', selectorType: 'css', value: String(msg ?? ''), smartName: 'Confirm Dialog', tagName: '', url: cleanUrl(window.location.href) });
    return _origConfirm(msg);
  };
  window.prompt = function (msg, def) {
    const result = _origPrompt(msg, def);
    postStep({ eventType: 'HANDLE_PROMPT', selector: '', selectorType: 'css', value: result ?? '', smartName: 'Prompt Dialog', tagName: '', url: cleanUrl(window.location.href) });
    return result;
  };

  // ── [J] Session keepalive — heartbeat every 5 minutes ────────────────────────
  const keepaliveInterval = setInterval(() => {
    if (!_active) return;
    fetch(`${PLATFORM}/api/recorder/heartbeat`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ token: TOKEN }),
      credentials: 'include',
    }).catch(() => {});
  }, 5 * 60 * 1000);

  // ── Stop signal ───────────────────────────────────────────────────────────────
  window.__qa_recorder_stop = false;
  const stopPoller = setInterval(() => {
    if (window.__qa_recorder_stop) {
      flushPendingFill();  // CR2: emit any buffered fill before stopping
      _active = false;
      clearInterval(stopPoller);
      clearInterval(keepaliveInterval);
      domObserver.disconnect();
      toastObserver.disconnect();
      removeBadge();
      console.info('[QA Recorder] Stopped.', _stepCounter, 'steps captured.');
    }
  }, 1000);

  console.info('[QA Recorder] v3 ready. Recording…');
})();
