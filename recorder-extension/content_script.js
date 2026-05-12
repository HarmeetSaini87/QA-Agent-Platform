/**
 * content_script.js — QA Agent Recorder Extension v5
 *
 * Injected into the AUT tab when user starts recording.
 * Captures: click, dblclick, contextmenu, fill (blur), select (incl. multi),
 *           check/uncheck, file upload, hover, drag & drop, keyboard shortcuts,
 *           contenteditable, window.alert/confirm/prompt,
 *           deep shadow DOM (recursive + attachShadow monkey-patch),
 *           same-origin iframes (nested, with frameId context tagging).
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
 *
 * v5 gap fixes:
 *   G1.  Iframe frame context — frameId/frameName/frameSrc tagged on every step
 *        from inside an iframe so codegenGenerator can wrap in frameLocator().
 *   G2.  Nested iframes — injectIntoIframe() now calls scanForIframes(doc)
 *        recursively so level-2+ iframes are injected.
 *   G3.  Deep shadow DOM — attachShadow monkey-patch in MAIN world catches
 *        dynamically created shadow roots on existing elements.
 *   G4.  Hover — mouseenter listener emits HOVER step for tooltip/menu triggers.
 *   G5.  Keyboard — keydown listener emits PRESS_KEY for Escape/Enter/Tab/F1-F12
 *        and common Ctrl/Meta shortcuts.
 *   G6.  contenteditable — FILL uses innerText instead of el.value for
 *        rich-text editors (Quill, ProseMirror, TipTap, Draft.js, etc.).
 *   G7.  Multi-select — SELECT step captures all selected option texts as array.
 *   G8.  Double-click — dblclick listener emits DBLCLICK step.
 *   G9.  Right-click — contextmenu listener emits RIGHT_CLICK step.
 *   G10. Drag & drop — mousedown+mousemove+mouseup sequence emits DRAG step.
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
  // Tracks the last SELECT change event target — suppresses the post-selection
  // browser-synthesised click that fires on the same <select> after value chosen
  let _lastSelectChange = { el: null, ts: 0 };
  const SELECT_CLICK_SUPPRESS_MS = 600;

  // ── CR2: Central dedup state ──────────────────────────────────────────────────
  let _lastEmitted = { eventType: '', selector: '', value: '', ts: 0 };
  let _pendingFill = null;  // { el, loc, value, timer } — buffered until typing stops

  // ── G1: Iframe context registry — maps document → frame descriptor ────────────
  // When events are captured inside an iframe, we tag every step with frameId/
  // frameName/frameSrc so codegenGenerator can wrap selectors in frameLocator().
  const _iframeContextMap = new WeakMap(); // document → { frameId, frameName, frameSrc }

  function _getFrameContext(doc) {
    if (doc === document) return null; // main frame — no wrapping needed
    return _iframeContextMap.get(doc) || null;
  }

  // ── G3: attachShadow monkey-patch request (main world) ────────────────────────
  // Ask background.js to inject the shadow root patcher in MAIN world so that
  // el.attachShadow() calls on existing elements are intercepted and we receive
  // a __qa_shadowroot custom event for each newly created shadow root.
  let _shadowPatcherInjected = false;
  function injectShadowPatcher() {
    if (_shadowPatcherInjected) return;
    _shadowPatcherInjected = true;
    chrome.runtime.sendMessage({ type: 'INJECT_SHADOW_PATCHER' });
  }

  // ── G10: Drag tracking state ──────────────────────────────────────────────────
  let _dragState = null; // { el, loc, startX, startY, moved, isCanvas, isRF, rfCtx }

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
  // G1: attach frameContext when step originates inside an iframe.
  function postStep(payload, sourceDoc) {
    if (!_active || !_token || !_platformOrigin) return;
    const frameCtx = _getFrameContext(sourceDoc || document);
    if (frameCtx) Object.assign(payload, { frameContext: frameCtx });
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
    'img',
    // SVG structural containers — actionable SVGs handled separately via isSvgActionable()
    'svg', 'g', 'defs', 'symbol', 'marker',
    // SVG shape primitives — not actionable unless they have data-testid/aria-label/title
    'path', 'circle', 'rect', 'polygon', 'polyline', 'line', 'ellipse',
  ]);

  // SVG tags that can be meaningfully actionable (icon buttons, text, use elements)
  const SVG_ACTIONABLE_TAGS = new Set(['text', 'tspan', 'use', 'image', 'foreignobject']);

  // G11: SVG actionability check — true if the SVG element should be recorded
  function isSvgActionable(el) {
    const tag = (el.tagName || '').toLowerCase();
    if (SVG_ACTIONABLE_TAGS.has(tag)) return true;
    if (el.hasAttribute('data-testid') || el.hasAttribute('aria-label')) return true;
    if (el.getAttribute('role')) return true;
    try { if (window.getComputedStyle(el).cursor === 'pointer') return true; } catch {}
    // Flow builder connector detection — SVG <path>/<line>/<polyline> that has
    // a stroke (visible line) and is inside a flow/graph/diagram container.
    if (['path', 'line', 'polyline', 'ellipse', 'circle', 'rect'].includes(tag)) {
      const stroke = el.getAttribute('stroke') || (el.style && el.style.stroke) || '';
      const hasStroke = stroke && stroke !== 'none' && stroke !== 'transparent';
      if (hasStroke) {
        // Check if inside a flow builder container (React Flow, JointJS, GoJS, Mermaid)
        const flowParent = el.closest && el.closest(
          '[class*="react-flow"],[class*="joint"],[class*="gojs"],[class*="mermaid"],' +
          '[class*="flow-graph"],[class*="diagram"],[class*="canvas-container"],' +
          '[data-testid*="flow"],[data-testid*="graph"],[data-testid*="canvas"]'
        );
        if (flowParent) return true;
        // Fallback: any stroked path with an id or data attribute is likely intentional
        if (el.id || el.getAttribute('data-id') || el.getAttribute('data-edge-id') ||
            el.getAttribute('data-link-id') || el.getAttribute('data-connector-id')) return true;
      }
    }
    return false;
  }

  // G11: Build a Playwright-compatible SVG locator
  // Priority: data-testid → connector ids → aria-label → title child → <use> href → ancestor
  function buildSvgLocator(el) {
    const tid = el.getAttribute('data-testid');
    if (tid) return { sel: `[data-testid="${tid}"]`, type: 'testid' };

    // Flow builder connector / edge identifiers (React Flow, JointJS, GoJS, draw.io)
    for (const attr of ['data-edge-id', 'data-link-id', 'data-connector-id', 'data-id', 'data-cell-id']) {
      const v = el.getAttribute(attr);
      if (v) return { sel: `[${attr}="${v}"]`, type: 'css' };
    }
    // Stable element id on connector path
    if (el.id && !isDynamicId(el.id)) return { sel: `#${el.id}`, type: 'css' };

    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return { sel: `//*[@aria-label="${al.trim()}"]`, type: 'xpath' };

    // SVG <title> child element — Playwright getByTitle / aria-label fallback
    const titleEl = el.querySelector && el.querySelector('title');
    if (titleEl) {
      const t = (titleEl.textContent || '').trim();
      if (t) return { sel: `svg[title="${t}"], [aria-label="${t}"]`, type: 'css' };
    }

    // <use href="#icon-name"> — extract icon id as semantic label
    if ((el.tagName || '').toLowerCase() === 'use') {
      const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
      if (href.startsWith('#')) {
        return { sel: `use[href="${href}"]`, type: 'css' };
      }
    }

    // Nearest SVG ancestor with a stable attribute
    let svgAncestor = el;
    while (svgAncestor && (svgAncestor.tagName || '').toUpperCase() !== 'SVG' && svgAncestor !== document.body) {
      svgAncestor = svgAncestor.parentElement;
    }
    if (svgAncestor && svgAncestor !== document.body) {
      const svgTid = svgAncestor.getAttribute('data-testid');
      if (svgTid) return { sel: `[data-testid="${svgTid}"]`, type: 'testid' };
      const svgAl = svgAncestor.getAttribute('aria-label');
      if (svgAl) return { sel: `//*[@aria-label="${svgAl}"]`, type: 'xpath' };
    }

    // Positional fallback — warn developer
    console.warn('[QA Recorder] SVG element lacks stable locator — add data-testid or aria-label');
    return { sel: buildRelativeXPath(el), type: 'xpath' };
  }

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

    // SVG elements — use dedicated SVG actionability check
    if (el.namespaceURI === 'http://www.w3.org/2000/svg' || SVG_ACTIONABLE_TAGS.has(tag)) {
      return isSvgActionable(el);
    }

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

    // G11: SVG elements — use dedicated SVG locator strategy before generic CSS
    if (el.namespaceURI === 'http://www.w3.org/2000/svg' || SVG_ACTIONABLE_TAGS.has(tag)) {
      return buildSvgLocator(el);
    }

    // 1. data-* automation attributes — gold standard
    for (const attr of ['data-testid', 'data-qa', 'data-cy', 'data-id', 'data-automation']) {
      const v = el.getAttribute(attr);
      if (v && v.trim()) {
        if (attr === 'data-testid') return { sel: `[data-testid="${v.trim()}"]`, type: 'testid' };
        const css = `[${attr}="${v.trim()}"]`;
        if (countMatches(css, r) === 1) return { sel: css, type: 'css' };
      }
    }

    // 2. Stable id — emit as type:'id' (raw value, no #) for Playwright getBy* parity
    if (el.id && !isDynamicId(el.id)) {
      const cssId = `#${el.id}`;
      if (countMatches(cssId, r) === 1) return { sel: el.id, type: 'id' };
      // ID not unique — qualify with tag as CSS fallback
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

    // 9b. nth / last — positional CSS when element is in a small, stable set
    // Only triggers when all earlier strategies failed (no stable id/name/label/role).
    // Format: "cssSelector:N" for nth, "cssSelector" for last — decoded by codegenGenerator.
    {
      const stableClasses = Array.from(el.classList).filter(c => !/\d{3,}|active|selected|hover|focus|open|show|hide/.test(c));
      const shortCss      = stableClasses.length ? `${tag}.${stableClasses[0]}` : tag;
      const siblings      = Array.from((r || document).querySelectorAll(shortCss));
      const total         = siblings.length;
      if (total >= 2 && total <= 20) {
        const idx = siblings.indexOf(el);
        if (idx !== -1) {
          if (idx === total - 1 && total <= 10) {
            return { sel: shortCss, type: 'last' };
          }
          if (idx <= 4) {
            return { sel: `${shortCss}:${idx}`, type: 'nth' };
          }
        }
      }
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

  // ── Toast / Validation / Flash message selectors ────────────────────────────
  // Covers: Toastr, SweetAlert2, Material Snackbar, Bootstrap Toast/Alert,
  //         Angular Material, Ant Design message, Semantic UI, inline validation errors.
  const TOAST_SEL = [
    // ARIA roles — framework-agnostic
    '[role="alert"]', '[role="status"]', '[role="log"]',
    // Common toast libraries
    '.toast', '.toast-message', '.toast-container .toast-body',
    '.toastr', '.ngx-toastr',
    '.mat-snack-bar-container', '.mat-simple-snackbar',
    '.swal2-popup .swal2-html-container', '.swal2-toast',
    '.ant-message-notice-content', '.ant-notification-notice-message',
    '.p-toast-message', '.p-toast-detail',   // PrimeNG
    '.iziToast-message',
    // Bootstrap alerts / toasts
    '.alert:not(.alert-dismissible .btn)', '.bs-toast',
    // Generic flash / notification patterns
    '[class*="notification"]:not([class*="icon"])',
    '[class*="flash-message"]', '[class*="flash-notice"]',
    '[class*="banner-message"]',
    '[data-notify]', '[data-alert]',
    // Modal / dialog content — capture text when dialog appears
    '[role="dialog"] .modal-body', '[role="dialog"] .dialog-content',
    '[role="alertdialog"]',
    '.modal.show .modal-body', '.modal.show .modal-title',
    '.mat-dialog-container .mat-dialog-content',
    '.p-dialog-content',                   // PrimeNG dialog
    '.cdk-overlay-container .mat-dialog-content',
    // Tooltip validation messages
    '[role="tooltip"]',
    '[class*="tooltip"]:not([class*="tooltip-arrow"]):not([class*="tooltip-inner"])',
    '.tippy-content',                       // Tippy.js
    '.p-tooltip-text',                      // PrimeNG tooltip
  ].join(',');

  const VALIDATION_SEL = [
    // ARIA invalid fields
    '[aria-invalid="true"]',
    // Common validation error patterns
    '.invalid-feedback', '.field-error', '.error-message',
    '.mat-error', '.mat-form-field-subscript-wrapper .mat-error',
    '.ant-form-item-explain-error',
    '.p-error',               // PrimeNG
    '.form-error', '.form__error',
    '[class*="validation-error"]', '[class*="error-text"]',
    '[class*="help-block"][class*="error"]',
    '.ng-invalid ~ .error', '.ng-touched.ng-invalid + span',
  ].join(',');

  // Dedup window for toast asserts — don't re-emit same text within 2s
  let _lastToastEmit = { text: '', ts: 0 };

  // Set of nodes already seen in this toast-detection pass (cleared per mutation batch)
  const _seenToastNodes = new WeakSet();

  // Debounce timer for mutation-triggered toast scan
  let _toastScanTimer = null;

  function _getVisibleText(el) {
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function _isToastVisible(el) {
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.05) return false;
      return true;
    } catch { return false; }
  }

  // Check whether el is a QA Recorder's own toast (purple overlay) — never capture these
  function _isRecorderOwnToast(el) {
    try {
      const style = window.getComputedStyle(el);
      return style.background.includes('124, 58, 237') ||   // rgb(124,58,237)
             style.backgroundColor.includes('124, 58, 237') ||
             (el.style.background && el.style.background.includes('#7c3aed'));
    } catch { return false; }
  }

  function _emitToastAssert(text, selector, selectorType) {
    const now = Date.now();
    if (_lastToastEmit.text === text && now - _lastToastEmit.ts < 2000) return; // deduplicate
    _lastToastEmit = { text, ts: now };
    if (!shouldEmit('ASSERT_TOAST', selector, text)) return;
    recordEmit('ASSERT_TOAST', selector, text);
    postStep({
      eventType:    'ASSERT_TOAST',
      selector,
      selectorType: selectorType || 'css',
      value:        text,
      smartName:    'Assert Toast Message',
      tagName:      '',
      url:          location.href,
    });
  }

  function _emitValidationAssert(text, selector, selectorType) {
    const now = Date.now();
    if (!shouldEmit('ASSERT_TEXT', selector, text)) return;
    recordEmit('ASSERT_TEXT', selector, text);
    postStep({
      eventType:    'ASSERT_TEXT',
      selector,
      selectorType: selectorType || 'css',
      value:        text,
      smartName:    'Assert Validation Message',
      tagName:      '',
      url:          location.href,
    });
  }

  // Scan for newly appeared toast/validation nodes and emit asserts
  function _scanForToastsAndValidation(addedNodes) {
    if (!_active) return;

    // 1. Check toast-role nodes added to DOM
    addedNodes.forEach(node => {
      if (!node || node.nodeType !== 1) return;
      if (_seenToastNodes.has(node)) return;

      // Match node itself or any descendant matching TOAST_SEL
      const candidates = [];
      if (node.matches && node.matches(TOAST_SEL)) candidates.push(node);
      if (node.querySelectorAll) {
        node.querySelectorAll(TOAST_SEL).forEach(c => candidates.push(c));
      }

      candidates.forEach(el => {
        if (_seenToastNodes.has(el)) return;
        // OLD: _seenToastNodes.add(el) before visibility check — permanently blocked re-show detection
        if (!_isToastVisible(el)) return;
        if (_isRecorderOwnToast(el)) return;

        const text = _getVisibleText(el);
        if (!text || text.length < 2) return;

        _seenToastNodes.add(el); // only mark seen after confirmed visible + has text
        const loc = bestSelector(el);
        _emitToastAssert(text, loc.sel, loc.type);
      });

      // Match inline validation errors
      const valCandidates = [];
      if (node.matches && node.matches(VALIDATION_SEL)) valCandidates.push(node);
      if (node.querySelectorAll) {
        node.querySelectorAll(VALIDATION_SEL).forEach(c => valCandidates.push(c));
      }
      valCandidates.forEach(el => {
        if (_seenToastNodes.has(el)) return;
        // OLD: _seenToastNodes.add(el) before visibility check — permanently blocked re-show detection
        if (!_isToastVisible(el)) return;

        const text = _getVisibleText(el);
        if (!text || text.length < 2) return;

        _seenToastNodes.add(el); // only mark seen after confirmed visible + has text
        const loc = bestSelector(el);
        _emitValidationAssert(text, loc.sel, loc.type);
      });
    });

    // 2. Also scan existing DOM for any toast that became visible (attribute mutation)
    // Debounced to avoid hammering on rapid attribute changes
    clearTimeout(_toastScanTimer);
    _toastScanTimer = setTimeout(() => {
      if (!_active) return;
      // Scan toasts
      document.querySelectorAll(TOAST_SEL).forEach(el => {
        if (_seenToastNodes.has(el)) return;
        if (!_isToastVisible(el)) return;
        if (_isRecorderOwnToast(el)) return;
        const text = _getVisibleText(el);
        if (!text || text.length < 2) return;
        _seenToastNodes.add(el);
        const loc = bestSelector(el);
        _emitToastAssert(text, loc.sel, loc.type);
      });
      // Scan validation errors — same toggle-visibility pattern as toasts
      document.querySelectorAll(VALIDATION_SEL).forEach(el => {
        if (_seenToastNodes.has(el)) return;
        if (!_isToastVisible(el)) return;
        const text = _getVisibleText(el);
        if (!text || text.length < 2) return;
        _seenToastNodes.add(el);
        const loc = bestSelector(el);
        _emitValidationAssert(text, loc.sel, loc.type);
      });
    }, 300);
  }

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

    // Toast/validation click interception — emit ASSERT_TOAST instead of CLICK
    // when user explicitly clicks on a toast/alert container.
    const toastAncestor = el.closest && (el.closest(TOAST_SEL));
    if (toastAncestor && !_isRecorderOwnToast(toastAncestor) && _isToastVisible(toastAncestor)) {
      const text = _getVisibleText(toastAncestor);
      if (text && text.length >= 2) {
        const loc2 = bestSelector(toastAncestor);
        _emitToastAssert(text, loc2.sel, loc2.type);
        e.stopPropagation();
        return;
      }
    }

    // Cross-origin iframe click — emit SWITCH_FRAME instead of CLICK
    // User clicking the iframe element itself signals intent to interact inside it.
    if (el.tagName === 'IFRAME' && _crossOriginIframes.has(el)) {
      _emitSwitchFrame(el);
      return;
    }
    // Also check if click landed on a cross-origin iframe via closest()
    const iframeAncestor = el.closest && el.closest('iframe');
    if (iframeAncestor && _crossOriginIframes.has(iframeAncestor)) {
      _emitSwitchFrame(iframeAncestor);
      return;
    }

    // Canvas click — capture pointer coordinates relative to canvas bounds
    if (el.tagName === 'CANVAS') {
      _emitCanvasClick(el, e);
      return;
    }

    // CR1: reject invisible elements and non-actionable containers
    if (!isVisibleElement(el)) return;
    if (!isActionableClick(el)) return;

    const loc       = bestSelector(el);
    const now       = Date.now();
    const stateHash = elementStateHash(el);

    // CR2: flush any pending fill on a DIFFERENT element before recording click
    if (_pendingFill && _pendingFill.loc.sel !== loc.sel) flushPendingFill();

    // Suppress post-selection click on <select> — browser fires a click on the
    // same SELECT element after the user picks a value; that click is junk (Step 3 duplicate).
    // The real selection is already captured by the change/SELECT event (Step 2).
    if (el.tagName === 'SELECT' && _lastSelectChange.el === el && now - _lastSelectChange.ts < SELECT_CLICK_SUPPRESS_MS) return;

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

    // ── G2: Post-submit / post-navigation landmark ASSERT VISIBLE ────────────
    // After clicking a submit/save/login button, wait briefly then look for a
    // newly visible landmark element (heading, main region, dashboard widget).
    // This converts the recorded flow into a real test case by verifying the
    // expected page/state actually appeared.
    const isSubmitLike = (
      el.type === 'submit' ||
      /\b(submit|save|login|sign.?in|confirm|continue|next|proceed|ok|apply|create|add|update|delete|remove|send|publish)\b/i
        .test((el.textContent || el.value || el.getAttribute('aria-label') || '').trim())
    );
    if (isSubmitLike) {
      setTimeout(() => {
        if (!_active) return;
        // Look for a visible heading or main landmark that isn't the current form
        const LANDMARK_SEL = 'h1, h2, [role="main"] h1, [role="main"] h2, .dashboard-title, .page-title, [data-testid*="heading"], [data-testid*="title"]';
        const candidates = Array.from(document.querySelectorAll(LANDMARK_SEL))
          .filter(n => {
            const rect = n.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && !n.closest('form');
          });
        if (candidates.length > 0) {
          const target = candidates[0];
          const text   = (target.textContent || '').trim().substring(0, 80);
          const lSel   = bestSelector(target);
          if (text && text.length >= 2 && shouldEmit('ASSERT_VISIBLE', lSel.sel, text)) {
            recordEmit('ASSERT_VISIBLE', lSel.sel, text);
            postStep({
              eventType:    'ASSERT_VISIBLE',
              selector:     lSel.sel,
              selectorType: lSel.type,
              value:        text,
              smartName:    `Assert visible: ${text.substring(0, 40)}`,
              tagName:      target.tagName.toLowerCase(),
              url:          location.href,
            });
          }
        }
      }, 800);
    }
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
      // G7: multi-select — capture all selected option texts as comma-separated string
      const selectedTexts = el.multiple
        ? Array.from(el.selectedOptions).map(o => o.text || o.value).join(', ')
        : (el.options[el.selectedIndex]?.text || el.value);
      // Mark this SELECT so handleClick suppresses the post-selection browser click
      _lastSelectChange = { el, ts: Date.now() };
      postStep({
        eventType:    'SELECT',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        selectedTexts,
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
  // G6: contenteditable — use innerText instead of el.value for rich-text editors.
  function handleBlur(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const isContentEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '';
    const fillable = ['text', 'email', 'password', 'search', 'url', 'tel', 'number', ''];
    if (!((tag === 'input' && fillable.includes(type)) || tag === 'textarea' || isContentEditable)) return;

    // G6: contenteditable uses innerText; inputs use .value
    const value = isContentEditable
      ? (el.innerText || el.textContent || '').trim()
      : el.value;
    if (!value && value !== '0') return;

    const loc = bestSelector(el);

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

  // ── G8: Double-click handler ──────────────────────────────────────────────────
  function handleDblClick(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (!isVisibleElement(el)) return;
    const loc = bestSelector(el);
    if (!shouldEmit('DBLCLICK', loc.sel, '')) return;
    recordEmit('DBLCLICK', loc.sel, '');
    postStep({
      eventType:    'DBLCLICK',
      selector:     loc.sel,
      selectorType: loc.type,
      value:        '',
      smartName:    smartName(el),
      tagName:      el.tagName.toLowerCase(),
      url:          location.href,
      ...buildStepMeta(el, loc.sel),
    });
  }

  // ── G9: Right-click (context menu) handler ───────────────────────────────────
  function handleContextMenu(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (!isVisibleElement(el) || !isActionableClick(el)) return;
    const loc = bestSelector(el);
    if (!shouldEmit('RIGHT_CLICK', loc.sel, '')) return;
    recordEmit('RIGHT_CLICK', loc.sel, '');
    postStep({
      eventType:    'RIGHT_CLICK',
      selector:     loc.sel,
      selectorType: loc.type,
      value:        '',
      smartName:    smartName(el),
      tagName:      el.tagName.toLowerCase(),
      url:          location.href,
      ...buildStepMeta(el, loc.sel),
    });
  }

  // ── G4: Hover handler ─────────────────────────────────────────────────────────
  // Only emit HOVER for elements that likely trigger UI changes (tooltips, menus).
  // Debounce: suppress rapid mouse-over noise — only emit after 400ms dwell.
  let _hoverTimer = null;
  let _hoverEl    = null;
  function handleMouseEnter(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (!isVisibleElement(el)) return;
    // Only hover on elements that have a hover-reveal signal
    const hasHoverSignal = (
      el.hasAttribute('title') ||
      el.hasAttribute('data-tooltip') ||
      el.hasAttribute('aria-describedby') ||
      el.hasAttribute('data-toggle') ||
      el.hasAttribute('data-bs-toggle') ||
      (el.getAttribute('role') === 'tooltip') ||
      el.matches && el.matches('[class*="tooltip"],[class*="dropdown-toggle"],[class*="has-submenu"]')
    );
    if (!hasHoverSignal) return;
    clearTimeout(_hoverTimer);
    _hoverEl    = el;
    _hoverTimer = setTimeout(() => {
      if (!_active || _hoverEl !== el) return;
      const loc = bestSelector(el);
      if (!shouldEmit('HOVER', loc.sel, '')) return;
      recordEmit('HOVER', loc.sel, '');
      postStep({
        eventType:    'HOVER',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        '',
        smartName:    smartName(el),
        tagName:      el.tagName.toLowerCase(),
        url:          location.href,
        ...buildStepMeta(el, loc.sel),
      });
    }, 400);
  }
  function handleMouseLeave() {
    clearTimeout(_hoverTimer);
    _hoverEl = null;
  }

  // ── G5: Keyboard handler ──────────────────────────────────────────────────────
  // Capture structural keys (Escape, Enter, Tab, F-keys) and common shortcuts.
  // Suppress plain printable-character keystrokes — those are captured via FILL.
  const KEY_CAPTURE = new Set([
    'Escape', 'Enter', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    'Delete', 'Backspace', 'Home', 'End', 'PageUp', 'PageDown',
    'F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12',
  ]);
  function handleKeyDown(e) {
    if (!_active) return;
    const el  = e.target;
    const key = e.key;
    // Ctrl/Meta + letter shortcut (e.g. Ctrl+A, Ctrl+S)
    const isShortcut = (e.ctrlKey || e.metaKey) && key.length === 1;
    if (!KEY_CAPTURE.has(key) && !isShortcut) return;
    // Suppress Enter/Tab on <input> — those just move focus; FILL captures the value
    if ((key === 'Enter' || key === 'Tab') && el && el.tagName === 'INPUT' && !el.getAttribute('role')) return;

    const modifiers = [
      e.ctrlKey  ? 'Control' : '',
      e.metaKey  ? 'Meta'    : '',
      e.altKey   ? 'Alt'     : '',
      e.shiftKey ? 'Shift'   : '',
    ].filter(Boolean);
    const chord = [...modifiers, key].join('+');
    const loc   = el && el.nodeType === 1 ? bestSelector(el) : { sel: 'body', type: 'css' };
    if (!shouldEmit('PRESS_KEY', chord, '')) return;
    recordEmit('PRESS_KEY', chord, '');
    postStep({
      eventType:    'PRESS_KEY',
      selector:     loc.sel,
      selectorType: loc.type,
      value:        chord,
      smartName:    `Press ${chord}`,
      tagName:      (el && el.tagName ? el.tagName.toLowerCase() : ''),
      url:          location.href,
    });
  }

  // ── React Flow Engine ─────────────────────────────────────────────────────────
  // Detects React Flow canvas context and converts screen↔flow coordinates.
  // React Flow applies transform: translate(tx,ty) scale(zoom) on .react-flow__viewport
  // All node positions are in FLOW SPACE — must normalize before storing.

  const RF_SELECTORS = {
    root:       '.react-flow',
    pane:       '.react-flow__pane',
    viewport:   '.react-flow__viewport',
    node:       '.react-flow__node',
    handle:     '.react-flow__handle',
    edge:       '.react-flow__edge',
    edgePath:   '.react-flow__edge-path',
    minimap:    '.react-flow__minimap',
    controls:   '.react-flow__controls',
  };

  // Parse "translate(tx, ty) scale(z)" or matrix(...) from viewport element
  function _rfParseTransform(viewport) {
    if (!viewport) return null;
    try {
      const raw = viewport.style.transform || getComputedStyle(viewport).transform || '';
      // translate(Xpx, Ypx) scale(Z)
      const t = raw.match(/translate\(\s*([-\d.]+)px,\s*([-\d.]+)px\)\s*scale\(([-\d.]+)\)/);
      if (t) return { tx: parseFloat(t[1]), ty: parseFloat(t[2]), zoom: parseFloat(t[3]) };
      // matrix(a,b,c,d,e,f) — CSS matrix: a=scale, e=translateX, f=translateY
      const m = raw.match(/matrix\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/);
      if (m) return { tx: parseFloat(m[5]), ty: parseFloat(m[6]), zoom: parseFloat(m[1]) };
    } catch {}
    return null;
  }

  // Screen pixel → React Flow flow-space coordinate
  function _rfScreenToFlow(screenX, screenY, rfRect, vp) {
    if (!vp) return { x: Math.round(screenX - rfRect.left), y: Math.round(screenY - rfRect.top) };
    const flowX = (screenX - rfRect.left - vp.tx) / vp.zoom;
    const flowY = (screenY - rfRect.top  - vp.ty) / vp.zoom;
    return { x: Math.round(flowX), y: Math.round(flowY) };
  }

  // Capture full React Flow context at event time
  function _rfGetContext() {
    const root     = document.querySelector(RF_SELECTORS.root);
    if (!root) return null;
    const viewport = root.querySelector(RF_SELECTORS.viewport);
    const vp       = _rfParseTransform(viewport);
    const rfRect   = root.getBoundingClientRect();
    return { root, viewport, vp, rfRect };
  }

  // Get stable node identifier: data-id → aria-label → text label → fallback
  function _rfNodeId(nodeEl) {
    if (!nodeEl) return null;
    return nodeEl.getAttribute('data-id') ||
           nodeEl.getAttribute('data-nodeid') ||
           nodeEl.getAttribute('data-testid') ||
           nodeEl.getAttribute('aria-label') ||
           (nodeEl.querySelector('.react-flow__node-label,label,[class*="label"],[class*="title"]')?.textContent || '').trim().substring(0, 60) ||
           nodeEl.id || null;
  }

  // Get handle position: 'source' or 'target' + side (top/right/bottom/left)
  function _rfHandleInfo(handleEl) {
    if (!handleEl) return null;
    const pos  = handleEl.getAttribute('data-handlepos') || handleEl.getAttribute('data-position') || '';
    const type = handleEl.getAttribute('data-handletype') || handleEl.getAttribute('data-type') ||
                 (handleEl.classList.contains('source') ? 'source' : handleEl.classList.contains('target') ? 'target' : '');
    const id   = handleEl.getAttribute('data-handleid') || handleEl.getAttribute('id') || '';
    return { type, position: pos, id };
  }

  // Classify drag action from element context
  function _rfClassifyAction(el, rfCtx) {
    if (!el || !rfCtx) return null;
    const node   = el.closest(RF_SELECTORS.node);
    const handle = el.closest(RF_SELECTORS.handle);
    const pane   = el.closest(RF_SELECTORS.pane);
    if (handle) return 'connectNodes';    // dragging from a handle = edge creation
    if (node)   return 'dragNode';        // dragging a node body
    if (pane)   return 'panCanvas';       // dragging blank pane = pan
    return null;
  }

  // HTML5 DnD — sidebar → canvas node drop
  let _rfDndNodeType = null; // captured from dragstart dataTransfer
  function _handleDragStart(e) {
    if (!_active) return;
    try {
      // React Flow convention: dataTransfer.getData('application/reactflow') = nodeType
      const nodeType = e.dataTransfer?.getData('application/reactflow') ||
                       e.dataTransfer?.getData('text/plain') || null;
      if (nodeType) _rfDndNodeType = nodeType;
    } catch {}
  }

  // ── G10: Drag & drop handlers ─────────────────────────────────────────────────
  const DRAG_THRESHOLD_PX = 10;

  function handleMouseDown(e) {
    if (!_active || e.button !== 0) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;

    const isCanvas = el.tagName === 'CANVAS';
    const rfCtx    = _rfGetContext();
    const isRF     = !!(rfCtx && el.closest(RF_SELECTORS.root));

    if (!isCanvas && !isRF && (!isVisibleElement(el) || !isActionableClick(el))) return;

    _dragState = {
      el,
      loc:    bestSelector(el),
      startX: e.clientX,
      startY: e.clientY,
      moved:  false,
      isCanvas,
      isRF,
      rfCtx,  // snapshot of viewport transform at mousedown time
    };
  }

  function handleMouseMove(e) {
    if (!_dragState) return;
    const dx = Math.abs(e.clientX - _dragState.startX);
    const dy = Math.abs(e.clientY - _dragState.startY);
    if (dx > DRAG_THRESHOLD_PX || dy > DRAG_THRESHOLD_PX) _dragState.moved = true;
  }

  function handleMouseUp(e) {
    if (!_dragState) return;
    const ds = _dragState;
    _dragState = null;
    if (!ds.moved) return;

    // ── React Flow semantic drag ──────────────────────────────────────────────
    if (ds.isRF && ds.rfCtx) {
      const { rfCtx } = ds;
      const action = _rfClassifyAction(ds.el, rfCtx);

      if (action === 'connectNodes') {
        // Edge creation: handle → handle drag
        const srcHandle = ds.el.closest(RF_SELECTORS.handle);
        const srcNode   = srcHandle?.closest(RF_SELECTORS.node);
        const tgtEl     = e.target;
        const tgtHandle = tgtEl?.closest(RF_SELECTORS.handle);
        const tgtNode   = tgtHandle?.closest(RF_SELECTORS.node) || tgtEl?.closest(RF_SELECTORS.node);

        const srcNodeId   = _rfNodeId(srcNode)   || 'unknown';
        const tgtNodeId   = _rfNodeId(tgtNode)   || 'unknown';
        const srcHandleInfo = _rfHandleInfo(srcHandle) || {};
        const tgtHandleInfo = _rfHandleInfo(tgtHandle) || {};

        const payload = {
          sourceNode:     srcNodeId,
          sourceHandle:   srcHandleInfo.type || 'source',
          sourcePosition: srcHandleInfo.position || '',
          targetNode:     tgtNodeId,
          targetHandle:   tgtHandleInfo.type || 'target',
          targetPosition: tgtHandleInfo.position || '',
          // Fallback flow coords if handles not found
          fromFlow: _rfScreenToFlow(ds.startX, ds.startY, rfCtx.rfRect, rfCtx.vp),
          toFlow:   _rfScreenToFlow(e.clientX, e.clientY, rfCtx.rfRect, rfCtx.vp),
          viewport: rfCtx.vp,
        };
        const key = `${srcNodeId}→${tgtNodeId}`;
        if (!shouldEmit('RF_CONNECT', key, '')) return;
        recordEmit('RF_CONNECT', key, '');
        postStep({
          eventType:    'RF_CONNECT',
          selector:     srcHandle ? bestSelector(srcHandle).sel : ds.loc.sel,
          selectorType: 'css',
          value:        JSON.stringify(payload),
          smartName:    `Connect "${srcNodeId}" → "${tgtNodeId}"`,
          tagName:      'div',
          url:          location.href,
          rfAction:     payload,
        });

      } else if (action === 'dragNode') {
        // Node reposition: record nodeId + flow-space target position
        const nodeEl  = ds.el.closest(RF_SELECTORS.node);
        const nodeId  = _rfNodeId(nodeEl) || 'unknown';
        const toFlow  = _rfScreenToFlow(e.clientX, e.clientY, rfCtx.rfRect, rfCtx.vp);
        const fromFlow = _rfScreenToFlow(ds.startX, ds.startY, rfCtx.rfRect, rfCtx.vp);

        const payload = {
          nodeId,
          fromFlow,
          toFlow,
          deltaFlow: { x: Math.round(toFlow.x - fromFlow.x), y: Math.round(toFlow.y - fromFlow.y) },
          viewport: rfCtx.vp,
        };
        const key = `${nodeId}:${toFlow.x},${toFlow.y}`;
        if (!shouldEmit('RF_NODE_DRAG', key, '')) return;
        recordEmit('RF_NODE_DRAG', key, '');
        postStep({
          eventType:    'RF_NODE_DRAG',
          selector:     nodeEl ? bestSelector(nodeEl).sel : ds.loc.sel,
          selectorType: 'css',
          value:        JSON.stringify(payload),
          smartName:    `Move node "${nodeId}" by (${payload.deltaFlow.x}, ${payload.deltaFlow.y})`,
          tagName:      'div',
          url:          location.href,
          rfAction:     payload,
          ...buildStepMeta(nodeEl || ds.el, nodeEl ? bestSelector(nodeEl).sel : ds.loc.sel),
        });

      } else if (action === 'panCanvas') {
        // Canvas pan: record viewport delta in screen px (pan is screen-space)
        const dx = Math.round(e.clientX - ds.startX);
        const dy = Math.round(e.clientY - ds.startY);
        const payload = { dx, dy, viewport: rfCtx.vp };
        if (!shouldEmit('RF_PAN', `${dx},${dy}`, '')) return;
        recordEmit('RF_PAN', `${dx},${dy}`, '');
        postStep({
          eventType:    'RF_PAN',
          selector:     RF_SELECTORS.pane,
          selectorType: 'css',
          value:        JSON.stringify(payload),
          smartName:    `Pan canvas (${dx > 0 ? '+' : ''}${dx}, ${dy > 0 ? '+' : ''}${dy})`,
          tagName:      'div',
          url:          location.href,
          rfAction:     payload,
        });
      }
      return;
    }

    // ── Raw canvas drag (non-ReactFlow) ──────────────────────────────────────
    if (ds.isCanvas) {
      const rect  = ds.el.getBoundingClientRect();
      const fromX = Math.round(ds.startX - rect.left);
      const fromY = Math.round(ds.startY - rect.top);
      const toX   = Math.round(e.clientX  - rect.left);
      const toY   = Math.round(e.clientY  - rect.top);
      const coords = JSON.stringify({ fromX, fromY, toX, toY });
      if (!shouldEmit('CANVAS_DRAG', ds.loc.sel, coords)) return;
      recordEmit('CANVAS_DRAG', ds.loc.sel, coords);
      postStep({
        eventType:    'CANVAS_DRAG',
        selector:     ds.loc.sel,
        selectorType: ds.loc.type,
        value:        coords,
        smartName:    `Canvas drag (${fromX},${fromY}) → (${toX},${toY})`,
        tagName:      'canvas',
        url:          location.href,
        canvasDrag:   { fromX, fromY, toX, toY },
        ...buildStepMeta(ds.el, ds.loc.sel),
      });
      return;
    }

    // ── Normal DOM drag ───────────────────────────────────────────────────────
    const dropEl = e.target;
    if (!dropEl || dropEl === ds.el || dropEl.nodeType !== 1) return;
    const toLoc = bestSelector(dropEl);
    if (!shouldEmit('DRAG', ds.loc.sel, toLoc.sel)) return;
    recordEmit('DRAG', ds.loc.sel, toLoc.sel);
    postStep({
      eventType:    'DRAG',
      selector:     ds.loc.sel,
      selectorType: ds.loc.type,
      value:        toLoc.sel,
      smartName:    `Drag ${smartName(ds.el)} → ${smartName(dropEl)}`,
      tagName:      ds.el.tagName.toLowerCase(),
      url:          location.href,
      toSelector:   toLoc.sel,
      toSelectorType: toLoc.type,
      ...buildStepMeta(ds.el, ds.loc.sel),
    });
  }

  // ── Canvas coordinate click ───────────────────────────────────────────────────
  // Captures click position relative to canvas top-left.
  // Playwright needs locator.click({ position: { x, y } }) for canvas UIs.
  function _emitCanvasClick(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const x    = Math.round(e.clientX - rect.left);
    const y    = Math.round(e.clientY - rect.top);
    const loc  = bestSelector(canvas);
    const key  = `${loc.sel}:${x},${y}`;
    if (!shouldEmit('CLICK_AT_COORDS', key, '')) return;
    recordEmit('CLICK_AT_COORDS', key, '');
    postStep({
      eventType:    'CLICK_AT_COORDS',
      selector:     loc.sel,
      selectorType: loc.type,
      value:        JSON.stringify({ x, y }),
      smartName:    `Click canvas at (${x}, ${y})`,
      tagName:      'canvas',
      url:          location.href,
      position:     { x, y },
      ...buildStepMeta(canvas, loc.sel),
    });
  }

  // ── Scroll capture ────────────────────────────────────────────────────────────
  // Debounced — emits SCROLL after 600ms of scroll inactivity.
  // Captures scrollLeft/scrollTop of the scrolled element (or window).
  let _scrollTimer   = null;
  let _scrollTarget  = null;
  let _scrollLastPos = { x: 0, y: 0 };

  function handleScroll(e) {
    if (!_active) return;
    const el   = e.target;
    const isWin = !el || el === document || el === document.documentElement || el === document.body;
    const scrollX = isWin ? window.scrollX : el.scrollLeft;
    const scrollY = isWin ? window.scrollY : el.scrollTop;

    // Suppress sub-pixel noise
    if (Math.abs(scrollX - _scrollLastPos.x) < 5 && Math.abs(scrollY - _scrollLastPos.y) < 5) return;
    _scrollLastPos = { x: scrollX, y: scrollY };
    _scrollTarget  = isWin ? null : el;

    clearTimeout(_scrollTimer);
    _scrollTimer = setTimeout(() => {
      if (!_active) return;
      const target = _scrollTarget;
      const sx     = isWin ? window.scrollX : (target ? target.scrollLeft : 0);
      const sy     = isWin ? window.scrollY : (target ? target.scrollTop  : 0);
      let loc = { sel: 'window', type: 'css' };
      if (target && target.nodeType === 1) loc = bestSelector(target);
      if (!shouldEmit('SCROLL', loc.sel, `${sx},${sy}`)) return;
      recordEmit('SCROLL', loc.sel, `${sx},${sy}`);
      postStep({
        eventType:    'SCROLL',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        JSON.stringify({ x: sx, y: sy }),
        smartName:    `Scroll to (${sx}, ${sy})`,
        tagName:      target ? (target.tagName || '').toLowerCase() : 'window',
        url:          location.href,
        scrollPosition: { x: sx, y: sy },
      });
    }, 600);
  }

  // ── Attach / detach ──────────────────────────────────────────────────────────
  // ── HTML5 DnD drop handler — sidebar → ReactFlow canvas node creation ────────
  function _handleDrop(e) {
    if (!_active) return;
    const rfCtx = _rfGetContext();
    if (!rfCtx) return;
    // Only fire if drop lands inside React Flow pane
    const pane = e.target?.closest(RF_SELECTORS.pane) || e.target?.closest(RF_SELECTORS.root);
    if (!pane) return;

    let nodeType = _rfDndNodeType;
    _rfDndNodeType = null;
    // Also try reading from event directly (same-origin DnD)
    try {
      nodeType = nodeType ||
        e.dataTransfer?.getData('application/reactflow') ||
        e.dataTransfer?.getData('text/plain') || 'unknown';
    } catch {}
    if (!nodeType) return;

    const dropFlow = _rfScreenToFlow(e.clientX, e.clientY, rfCtx.rfRect, rfCtx.vp);
    const payload  = { nodeType, dropFlow, viewport: rfCtx.vp };
    const key      = `${nodeType}:${dropFlow.x},${dropFlow.y}`;
    if (!shouldEmit('RF_DROP_NODE', key, '')) return;
    recordEmit('RF_DROP_NODE', key, '');
    postStep({
      eventType:    'RF_DROP_NODE',
      selector:     RF_SELECTORS.pane,
      selectorType: 'css',
      value:        JSON.stringify(payload),
      smartName:    `Drop node "${nodeType}" at flow (${dropFlow.x}, ${dropFlow.y})`,
      tagName:      'div',
      url:          location.href,
      rfAction:     payload,
    });
  }

  function attachToRoot(root) {
    root.addEventListener('click',       handleClick,       true);
    root.addEventListener('dblclick',    handleDblClick,    true);
    root.addEventListener('contextmenu', handleContextMenu, true);
    root.addEventListener('change',      handleChange,      true);
    root.addEventListener('blur',        handleBlur,        true);
    root.addEventListener('focusout',    handleBlur,        true);
    root.addEventListener('mouseenter',  handleMouseEnter,  true);
    root.addEventListener('mouseleave',  handleMouseLeave,  true);
    root.addEventListener('keydown',     handleKeyDown,     true);
    root.addEventListener('mousedown',   handleMouseDown,   true);
    root.addEventListener('mousemove',   handleMouseMove,   true);
    root.addEventListener('mouseup',     handleMouseUp,     true);
    root.addEventListener('dragstart',   _handleDragStart,  true);
    root.addEventListener('drop',        _handleDrop,       true);
    root.addEventListener('scroll',      handleScroll,      false);
  }
  function detachFromRoot(root) {
    root.removeEventListener('click',       handleClick,       true);
    root.removeEventListener('dblclick',    handleDblClick,    true);
    root.removeEventListener('contextmenu', handleContextMenu, true);
    root.removeEventListener('change',      handleChange,      true);
    root.removeEventListener('blur',        handleBlur,        true);
    root.removeEventListener('focusout',    handleBlur,        true);
    root.removeEventListener('mouseenter',  handleMouseEnter,  true);
    root.removeEventListener('mouseleave',  handleMouseLeave,  true);
    root.removeEventListener('keydown',     handleKeyDown,     true);
    root.removeEventListener('mousedown',   handleMouseDown,   true);
    root.removeEventListener('mousemove',   handleMouseMove,   true);
    root.removeEventListener('mouseup',     handleMouseUp,     true);
    root.removeEventListener('dragstart',   _handleDragStart,  true);
    root.removeEventListener('drop',        _handleDrop,       true);
    root.removeEventListener('scroll',      handleScroll,      false);
  }

  // ── G3: Deep shadow DOM — recursive injection ─────────────────────────────────
  // injectIntoShadowRoot scans shadow root for nested shadow roots recursively.
  function injectIntoShadowRoot(sr) {
    if (sr.__qaInjected) return;
    sr.__qaInjected = true;
    attachToRoot(sr);
    // Scan for already-existing nested shadow hosts
    sr.querySelectorAll('*').forEach(el => { if (el.shadowRoot) injectIntoShadowRoot(el.shadowRoot); });
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1) return;
      if (n.shadowRoot) injectIntoShadowRoot(n.shadowRoot);
      if (n.querySelectorAll) n.querySelectorAll('*').forEach(c => { if (c.shadowRoot) injectIntoShadowRoot(c.shadowRoot); });
    }))).observe(sr, { childList: true, subtree: true });
  }

  // ── G1+G2: Iframe injection with frame context tagging + nested recursion ─────
  // Registers the iframe's document in _iframeContextMap so any step emitted from
  // within carries frameId/frameName/frameSrc for Playwright frameLocator() wrapping.
  // Cross-origin iframes: cannot inject inside, but register the iframe element
  // itself so handleClick() can emit SWITCH_FRAME when user clicks on it.
  const _crossOriginIframes = new WeakSet(); // iframe elements that are cross-origin

  function injectIntoIframe(iframe) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) {
        // null doc = cross-origin — mark the element for SWITCH_FRAME emission
        _crossOriginIframes.add(iframe);
        return;
      }
      if (doc.__qaInjected) return;
      doc.__qaInjected = true;
      // Register frame context so steps from this document carry frame metadata
      _iframeContextMap.set(doc, {
        frameId:   iframe.id   || null,
        frameName: iframe.name || null,
        frameSrc:  (() => { try { return iframe.contentWindow.location.href; } catch { return iframe.src || null; } })(),
      });
      attachToRoot(doc);
      scanShadow(doc);
      // G2: recurse into nested iframes inside this iframe
      scanForIframes(doc);
    } catch {
      // cross-origin access denied — mark for SWITCH_FRAME
      _crossOriginIframes.add(iframe);
    }
  }

  // ── Cross-origin: emit SWITCH_FRAME when user clicks the iframe element ───────
  // Playwright handles cross-origin frames via page.frameLocator(selector).
  // We emit a SWITCH_FRAME step so codegen knows to wrap subsequent steps.
  function _emitSwitchFrame(iframe) {
    const loc  = bestSelector(iframe);
    const name = iframe.name || iframe.id || iframe.src || '';
    if (!shouldEmit('SWITCH_FRAME', loc.sel, name)) return;
    recordEmit('SWITCH_FRAME', loc.sel, name);
    postStep({
      eventType:    'SWITCH_FRAME',
      selector:     loc.sel,
      selectorType: loc.type,
      value:        name,
      smartName:    `Switch to frame: ${name || loc.sel}`,
      tagName:      'iframe',
      url:          location.href,
      frameContext: {
        frameId:   iframe.id   || null,
        frameName: iframe.name || null,
        frameSrc:  iframe.src  || null,
      },
    });
  }

  // G2: scan a document for all iframes and inject into each
  function scanForIframes(root) {
    root.querySelectorAll('iframe').forEach(injectIntoIframe);
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
    // Window-level scroll (page scroll) — does not bubble through document root
    window.addEventListener('scroll', handleScroll, { passive: true });
    injectShadowPatcher(); // G3: main-world attachShadow monkey-patch
    // Listen for dynamically created shadow roots reported by MAIN world patcher
    document.addEventListener('__qa_shadowroot', (e) => {
      const host = e.detail && e.detail.host;
      if (host && host.shadowRoot) injectIntoShadowRoot(host.shadowRoot);
    });

    const _allAddedNodes = [];
    _domObserver = new MutationObserver(muts => {
      _allAddedNodes.length = 0;
      let hasAttrMutation = false;
      muts.forEach(m => {
        if (m.type === 'childList') {
          m.addedNodes.forEach(n => {
            if (!n || n.nodeType !== 1) return;
            _allAddedNodes.push(n);
            if (n.shadowRoot) injectIntoShadowRoot(n.shadowRoot);
            if (n.tagName === 'IFRAME') injectIntoIframe(n);
            if (n.querySelectorAll) {
              n.querySelectorAll('*').forEach(c => { if (c.shadowRoot) injectIntoShadowRoot(c.shadowRoot); });
              n.querySelectorAll('iframe').forEach(injectIntoIframe);
            }
          });
        } else if (m.type === 'attributes') {
          // style/class/hidden changed on existing node — may be a toggle-visible toast
          // (e.g. div#MessageAlert toggling display:none → display:block)
          if (m.target && m.target.nodeType === 1) hasAttrMutation = true;
        }
      });
      // Toast/validation detection: run on new nodes OR attribute-triggered visibility changes
      if (_allAddedNodes.length > 0) _scanForToastsAndValidation(_allAddedNodes);
      else if (hasAttrMutation) _scanForToastsAndValidation([]);
    });
    _domObserver.observe(document.documentElement, { childList: true, subtree: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden'] });

    // ── G1: SPA URL-change → ASSERT URL ──────────────────────────────────────
    // Capture pushState / replaceState / popstate / hashchange and emit ASSERT_URL
    // so the recorded script verifies the app actually navigated to the right route.
    // Debounced 400ms to let the page settle before capturing the final URL.
    let _urlAssertTimer = null;
    let _lastAssertedUrl = location.href;
    function _onUrlChange() {
      if (!_active) return;
      clearTimeout(_urlAssertTimer);
      _urlAssertTimer = setTimeout(() => {
        const newUrl = location.href;
        if (newUrl === _lastAssertedUrl) return;
        _lastAssertedUrl = newUrl;
        // Emit a partial-path assert — strip origin, keep path+query for portability
        let partial = newUrl;
        // OLD: only captured pathname+search — hash-based routing (e.g. /#HomeMenu#Home) always gave "/"
        try { const u = new URL(newUrl); partial = u.pathname + (u.search || '') + (u.hash || ''); } catch {}
        if (!shouldEmit('ASSERT_URL', partial, partial)) return;
        recordEmit('ASSERT_URL', partial, partial);
        postStep({
          eventType:    'ASSERT_URL',
          selector:     '',
          selectorType: 'css',
          value:        partial,
          smartName:    `Assert URL: ${partial.substring(0, 60)}`,
          tagName:      '',
          url:          newUrl,
        });
      }, 400);
    }
    // Hook pushState / replaceState in MAIN world via the dialog patcher mechanism
    // (background.js already executes in MAIN world — we piggyback via a separate message)
    window.addEventListener('popstate',    _onUrlChange);
    window.addEventListener('hashchange',  _onUrlChange);
    // pushState/replaceState must be hooked in main world — request injection
    chrome.runtime.sendMessage({ type: 'INJECT_URL_PATCHER' });
    document.addEventListener('__qa_urlchange', _onUrlChange);

    injectDialogInterceptor();
    document.addEventListener('__qa_dialog', (e) => {
      if (!_active) return;
      const dlgText = String(e.detail.value ?? '').trim();
      // Auto-emit ASSERT_TEXT for the dialog message before the action step,
      // so the recorded flow verifies the correct message appeared.
      if (dlgText && dlgText.length >= 2 && shouldEmit('ASSERT_TEXT', 'dialog', dlgText)) {
        recordEmit('ASSERT_TEXT', 'dialog', dlgText);
        postStep({
          eventType:    'ASSERT_TEXT',
          selector:     'body',
          selectorType: 'css',
          value:        dlgText,
          smartName:    `Assert dialog: ${dlgText.substring(0, 40)}`,
          tagName:      '',
          url:          location.href,
        });
      }
      postStep({
        eventType:    e.detail.type,
        selector:     '',
        selectorType: 'css',
        value:        dlgText,
        smartName:    e.detail.smartName || 'Dialog',
        tagName:      '',
        url:          location.href,
      });
    });
  }

  function detachListeners() {
    flushPendingFill();  // CR2: emit any buffered fill before stopping
    detachFromRoot(document);
    window.removeEventListener('scroll', handleScroll, { passive: true });
    clearTimeout(_scrollTimer);
    clearTimeout(_hoverTimer);
    _dragState = null;
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
