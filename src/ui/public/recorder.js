/**
 * recorder.js — QA Agent Platform UI Recorder
 * Injected into the AUT tab when __qa_recorder=<token> is present in the URL.
 *
 * Captures: click, fill, select, check/uncheck, file upload, navigation,
 *           window.alert/confirm/prompt, open shadow DOM, same-origin iframes.
 *
 * Each captured action is POSTed to /api/recorder/step on the platform server.
 * The platform resolves locators against the Locator Repository and pushes
 * steps to the Test Script editor via SSE.
 *
 * Zero dependencies. Vanilla JS. ES2017 compatible.
 */
(function () {
  'use strict';

  // ── Bootstrap ─────────────────────────────────────────────────────────────────
  const params  = new URLSearchParams(window.location.search);
  const TOKEN   = params.get('__qa_recorder');
  if (!TOKEN) return; // guard: only run when recorder param is present

  // Platform origin — recorder.js is served from the platform, AUT is the current page.
  // API calls go back to the platform server (origin stored in the script URL or meta tag).
  // We inject __qa_recorder_origin as a global from the server before this script.
  const PLATFORM = window.__qa_recorder_origin || '';
  if (!PLATFORM) { console.warn('[QA Recorder] No __qa_recorder_origin set — cannot POST steps'); return; }

  let _active       = true;
  let _stepCounter  = 0;
  let _lastClick    = { sel: '', ts: 0 }; // debounce duplicate clicks
  const DEBOUNCE_MS = 300;

  console.info('[QA Recorder] Started — token:', TOKEN.slice(0, 8) + '…');

  // ── Selector derivation ───────────────────────────────────────────────────────
  // Priority: data-testid → id → aria-label → name → placeholder → XPath
  function bestSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    const tid = el.getAttribute('data-testid');
    if (tid) return { sel: `[data-testid="${tid}"]`, type: 'testid' };
    if (el.id) return { sel: '#' + el.id, type: 'css' };
    const al = el.getAttribute('aria-label');
    if (al) return { sel: `[aria-label="${al}"]`, type: 'css' };
    const nm = el.getAttribute('name');
    if (nm) return { sel: `[name="${nm}"]`, type: 'css' };
    const ph = el.getAttribute('placeholder');
    if (ph) return { sel: `[placeholder="${ph}"]`, type: 'css' };
    // XPath fallback — always unique
    return { sel: xpathOf(el), type: 'xpath' };
  }

  function xpathOf(el) {
    if (el.id) return `//*[@id="${el.id}"]`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let idx = 1;
      let sib = node.previousSibling;
      while (sib) { if (sib.nodeType === 1 && sib.nodeName === node.nodeName) idx++; sib = sib.previousSibling; }
      const tag = node.nodeName.toLowerCase();
      parts.unshift(idx > 1 ? `${tag}[${idx}]` : tag);
      node = node.parentNode;
    }
    return '/' + parts.join('/');
  }

  // ── Smart locator name ────────────────────────────────────────────────────────
  // Used by server to name auto-created Locator Repository entries.
  function smartName(el) {
    if (!el) return '';
    const al = el.getAttribute('aria-label');
    if (al && al.trim()) return al.trim();
    const title = el.getAttribute('title');
    if (title && title.trim()) return title.trim();
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length <= 40) return text;
    const tid = el.getAttribute('data-testid');
    if (tid) return tid.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (el.id) return el.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return ph.trim();
    const nm = el.getAttribute('name');
    if (nm) return nm.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const role = el.getAttribute('role');
    return `${el.tagName.toLowerCase()}${role ? ' (' + role + ')' : ''}`;
  }

  // ── POST step to platform ─────────────────────────────────────────────────────
  function postStep(payload) {
    if (!_active) return;
    _stepCounter++;
    const body = Object.assign({ token: TOKEN, stepNum: _stepCounter }, payload);
    fetch(`${PLATFORM}/api/recorder/step`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      credentials: 'include',
    }).catch(err => console.warn('[QA Recorder] POST failed:', err));
  }

  // ── Event handlers ────────────────────────────────────────────────────────────

  function handleClick(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;

    // Skip if this is a file input — handled by change event
    if (el.type === 'file') return;

    // Debounce: ignore same-element clicks within 300ms
    const loc = bestSelector(el);
    const now  = Date.now();
    if (loc.sel === _lastClick.sel && now - _lastClick.ts < DEBOUNCE_MS) return;
    _lastClick = { sel: loc.sel, ts: now };

    // Checkbox / radio — emit CHECK or UNCHECK
    if (el.type === 'checkbox' || el.type === 'radio') {
      postStep({
        eventType:   el.checked ? 'CHECK' : 'UNCHECK',
        selector:    loc.sel,
        selectorType: loc.type,
        value:       '',
        smartName:   smartName(el),
        tagName:     el.tagName.toLowerCase(),
        url:         window.location.href,
      });
      return;
    }

    postStep({
      eventType:    'CLICK',
      selector:     loc.sel,
      selectorType: loc.type,
      value:        '',
      smartName:    smartName(el),
      tagName:      el.tagName.toLowerCase(),
      url:          window.location.href,
    });
  }

  function handleChange(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const loc = bestSelector(el);

    // File upload
    if (el.type === 'file' && el.files && el.files.length > 0) {
      const files = Array.from(el.files).map(f => f.name).join(', ');
      postStep({
        eventType:    'UPLOAD',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        files,
        smartName:    smartName(el),
        tagName:      el.tagName.toLowerCase(),
        url:          window.location.href,
      });
      return;
    }

    // Select dropdown
    if (el.tagName === 'SELECT') {
      const val = el.options[el.selectedIndex] ? el.options[el.selectedIndex].text : el.value;
      postStep({
        eventType:    'SELECT',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        val,
        smartName:    smartName(el),
        tagName:      'select',
        url:          window.location.href,
      });
    }
  }

  // FILL — captured on blur (not every keystroke) to get final value
  function handleBlur(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const fillable = ['text', 'email', 'password', 'search', 'url', 'tel', 'number', ''];
    if ((tag === 'input' && fillable.includes(type)) || tag === 'textarea') {
      if (!el.value && el.value !== '0') return; // skip empty
      const loc = bestSelector(el);
      postStep({
        eventType:    'FILL',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        el.value,
        smartName:    smartName(el),
        tagName:      tag,
        url:          window.location.href,
      });
    }
  }

  // ── Attach listeners to a document/shadowRoot ─────────────────────────────────
  function attachToRoot(root) {
    root.addEventListener('click',  handleClick,  true);
    root.addEventListener('change', handleChange, true);
    root.addEventListener('blur',   handleBlur,   true);
  }

  // ── Shadow DOM — recursive injection ─────────────────────────────────────────
  function injectIntoShadowRoot(shadowRoot) {
    attachToRoot(shadowRoot);
    // Also watch for nested shadow roots
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
    } catch {
      // Cross-origin — silently skip
    }
  }

  function scanForIframes(root) {
    root.querySelectorAll('iframe').forEach(injectIntoIframe);
  }

  // ── Main document attachment ───────────────────────────────────────────────────
  attachToRoot(document);
  scanForShadowRoots(document);
  scanForIframes(document);

  // Watch for dynamically added shadow roots and iframes
  const domObserver = new MutationObserver(mutations => {
    mutations.forEach(m => {
      m.addedNodes.forEach(node => {
        if (!node || node.nodeType !== 1) return;
        if (node.shadowRoot) injectIntoShadowRoot(node.shadowRoot);
        if (node.tagName === 'IFRAME') injectIntoIframe(node);
        // Scan children too (batch DOM insert)
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

  // ── Navigation detection ───────────────────────────────────────────────────────
  // Capture pushState/replaceState calls (SPA navigation)
  const _origPush    = history.pushState.bind(history);
  const _origReplace = history.replaceState.bind(history);

  history.pushState = function (...args) {
    _origPush(...args);
    postStep({ eventType: 'GOTO', selector: '', selectorType: 'css', value: window.location.href, smartName: '', tagName: '', url: window.location.href });
  };
  history.replaceState = function (...args) {
    _origReplace(...args);
    // replaceState is often internal (Angular router) — skip to avoid noise
  };

  window.addEventListener('popstate', () => {
    postStep({ eventType: 'GOTO', selector: '', selectorType: 'css', value: window.location.href, smartName: '', tagName: '', url: window.location.href });
  });

  // ── Browser dialogs — monkey-patch ────────────────────────────────────────────
  const _origAlert   = window.alert.bind(window);
  const _origConfirm = window.confirm.bind(window);
  const _origPrompt  = window.prompt.bind(window);

  window.alert = function (msg) {
    postStep({ eventType: 'ACCEPT_ALERT', selector: '', selectorType: 'css', value: String(msg ?? ''), smartName: 'Alert Dialog', tagName: '', url: window.location.href });
    _origAlert(msg);
  };
  window.confirm = function (msg) {
    postStep({ eventType: 'ACCEPT_DIALOG', selector: '', selectorType: 'css', value: String(msg ?? ''), smartName: 'Confirm Dialog', tagName: '', url: window.location.href });
    return _origConfirm(msg);
  };
  window.prompt = function (msg, def) {
    const result = _origPrompt(msg, def);
    postStep({ eventType: 'HANDLE_PROMPT', selector: '', selectorType: 'css', value: result ?? '', smartName: 'Prompt Dialog', tagName: '', url: window.location.href });
    return result;
  };

  // ── Stop signal ───────────────────────────────────────────────────────────────
  // Server can set window.__qa_recorder_stop = true to teardown gracefully
  window.__qa_recorder_stop = false;
  const stopPoller = setInterval(() => {
    if (window.__qa_recorder_stop) {
      _active = false;
      clearInterval(stopPoller);
      domObserver.disconnect();
      console.info('[QA Recorder] Stopped.');
    }
  }, 1000);

  console.info('[QA Recorder] Listeners attached. Recording…');
})();
