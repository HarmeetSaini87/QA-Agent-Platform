/**
 * content_script.js — QA Agent Recorder Extension
 *
 * Injected into the AUT tab when user starts recording.
 * Captures: click, fill (blur), select, check/uncheck, file upload,
 *           SPA navigation, window.alert/confirm/prompt,
 *           open shadow DOM (recursive), same-origin iframes.
 *
 * Each captured action POSTed to platformOrigin/api/recorder/step.
 * Notifies background.js via chrome.runtime.sendMessage for badge update.
 */
(function () {
  'use strict';

  // Guard: don't double-inject
  if (window.__qaRecorderActive) return;
  window.__qaRecorderActive = true;

  let _token          = null;
  let _platformOrigin = null;
  let _active         = false;
  let _lastClick      = { sel: '', ts: 0 };
  const DEBOUNCE_MS   = 300;

  // ── Self-init from chrome.storage (survives SSO redirects + race conditions) ─
  // Don't rely on message passing — read session state directly from storage.
  // This fires on every page load including SSO redirects, so recording
  // resumes automatically after any navigation.
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

  // ── Also listen for messages from background (start/stop while page is open) ─
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

  // ── Selector derivation ───────────────────────────────────────────────────────
  function bestSelector(el) {
    if (!el || el.nodeType !== 1) return { sel: '', type: 'css' };
    const tid = el.getAttribute('data-testid');
    if (tid) return { sel: `[data-testid="${tid}"]`, type: 'testid' };
    if (el.id) return { sel: '#' + el.id, type: 'css' };
    const al = el.getAttribute('aria-label');
    if (al) return { sel: `[aria-label="${al}"]`, type: 'css' };
    const nm = el.getAttribute('name');
    if (nm) return { sel: `[name="${nm}"]`, type: 'css' };
    const ph = el.getAttribute('placeholder');
    if (ph) return { sel: `[placeholder="${ph}"]`, type: 'css' };
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

  function smartName(el) {
    if (!el) return '';
    const al = el.getAttribute('aria-label');
    if (al?.trim()) return al.trim();
    const title = el.getAttribute('title');
    if (title?.trim()) return title.trim();
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length <= 40) return text;
    const tid = el.getAttribute('data-testid');
    if (tid) return tid.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (el.id) return el.id.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const ph = el.getAttribute('placeholder');
    if (ph?.trim()) return ph.trim();
    const nm = el.getAttribute('name');
    if (nm) return nm.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const role = el.getAttribute('role');
    return `${el.tagName.toLowerCase()}${role ? ' (' + role + ')' : ''}`;
  }

  // ── POST step to platform ────────────────────────────────────────────────────
  function postStep(payload) {
    if (!_active || !_token || !_platformOrigin) return;
    const body = Object.assign({ token: _token }, payload);
    fetch(`${_platformOrigin}/api/recorder/step`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    }).then(() => {
      chrome.runtime.sendMessage({ type: 'STEP_CAPTURED' });
    }).catch(err => console.warn('[QA Recorder] POST failed:', err));
  }

  // ── Event handlers ────────────────────────────────────────────────────────────
  function handleClick(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    if (el.type === 'file') return; // handled by change

    const loc = bestSelector(el);
    const now = Date.now();
    if (loc.sel === _lastClick.sel && now - _lastClick.ts < DEBOUNCE_MS) return;
    _lastClick = { sel: loc.sel, ts: now };

    if (el.type === 'checkbox' || el.type === 'radio') {
      postStep({ eventType: el.checked ? 'CHECK' : 'UNCHECK', selector: loc.sel, selectorType: loc.type, value: '', smartName: smartName(el), tagName: el.tagName.toLowerCase(), url: location.href });
      return;
    }
    postStep({ eventType: 'CLICK', selector: loc.sel, selectorType: loc.type, value: '', smartName: smartName(el), tagName: el.tagName.toLowerCase(), url: location.href });
  }

  function handleChange(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const loc = bestSelector(el);

    if (el.type === 'file' && el.files?.length > 0) {
      const files = Array.from(el.files).map(f => f.name).join(', ');
      postStep({ eventType: 'UPLOAD', selector: loc.sel, selectorType: loc.type, value: files, smartName: smartName(el), tagName: el.tagName.toLowerCase(), url: location.href });
      return;
    }
    if (el.tagName === 'SELECT') {
      const val = el.options[el.selectedIndex]?.text || el.value;
      postStep({ eventType: 'SELECT', selector: loc.sel, selectorType: loc.type, value: val, smartName: smartName(el), tagName: 'select', url: location.href });
    }
  }

  // Dedupe FILL — blur + focusout both fire; suppress second within 100ms
  let _lastFill = { sel: '', ts: 0 };

  function handleBlur(e) {
    if (!_active) return;
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const fillable = ['text', 'email', 'password', 'search', 'url', 'tel', 'number', ''];
    if ((tag === 'input' && fillable.includes(type)) || tag === 'textarea') {
      if (!el.value && el.value !== '0') return;
      const loc = bestSelector(el);
      const now = Date.now();
      if (loc.sel === _lastFill.sel && now - _lastFill.ts < 100) return; // dedupe blur+focusout
      _lastFill = { sel: loc.sel, ts: now };
      postStep({ eventType: 'FILL', selector: loc.sel, selectorType: loc.type, value: el.value, smartName: smartName(el), tagName: tag, url: location.href });
    }
  }

  // ── Attach / detach ──────────────────────────────────────────────────────────
  function attachToRoot(root) {
    root.addEventListener('click',    handleClick,  true);
    root.addEventListener('change',   handleChange, true);
    root.addEventListener('blur',     handleBlur,   true);
    root.addEventListener('focusout', handleBlur,   true); // bubbles — catches Angular Material inputs
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
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => { if (n.shadowRoot) injectIntoShadowRoot(n.shadowRoot); }))).observe(sr, { childList: true, subtree: true });
  }

  // Same-origin iframes
  function injectIntoIframe(iframe) {
    try { const doc = iframe.contentDocument; if (doc) { attachToRoot(doc); scanShadow(doc); } } catch {}
  }

  function scanShadow(root) { root.querySelectorAll('*').forEach(el => { if (el.shadowRoot) injectIntoShadowRoot(el.shadowRoot); }); }

  let _domObserver = null;

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

    // SPA navigation
    const _origPush = history.pushState.bind(history);
    history.pushState = function (...args) {
      _origPush(...args);
      postStep({ eventType: 'GOTO', selector: '', selectorType: 'css', value: location.href, smartName: '', tagName: '', url: location.href });
    };
    window.addEventListener('popstate', () => {
      postStep({ eventType: 'GOTO', selector: '', selectorType: 'css', value: location.href, smartName: '', tagName: '', url: location.href });
    });

    // Browser dialogs
    const _origAlert = window.alert.bind(window);
    const _origConfirm = window.confirm.bind(window);
    const _origPrompt = window.prompt.bind(window);
    window.alert   = m => { postStep({ eventType: 'ACCEPT_ALERT',  selector: '', selectorType: 'css', value: String(m ?? ''), smartName: 'Alert Dialog',   tagName: '', url: location.href }); _origAlert(m); };
    window.confirm = m => { postStep({ eventType: 'ACCEPT_DIALOG', selector: '', selectorType: 'css', value: String(m ?? ''), smartName: 'Confirm Dialog', tagName: '', url: location.href }); return _origConfirm(m); };
    window.prompt  = (m, d) => { const r = _origPrompt(m, d); postStep({ eventType: 'HANDLE_PROMPT', selector: '', selectorType: 'css', value: r ?? '', smartName: 'Prompt Dialog', tagName: '', url: location.href }); return r; };
  }

  function detachListeners() {
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
