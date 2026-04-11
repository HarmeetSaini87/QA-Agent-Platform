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
  // Priority: testid → stable ID → aria-label → name → placeholder →
  //           relative XPath (text / attr / ancestor-anchored) → absolute XPath

  // Returns true if the CSS selector matches exactly 1 element on the page
  function isUniqueCss(sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch { return false; }
  }

  // Returns true if the XPath expression matches exactly 1 element on the page
  function isUniqueXpath(expr) {
    try {
      return document.evaluate(expr, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength === 1;
    } catch { return false; }
  }

  // Detect auto-generated IDs (Angular Material, CDK, numeric, etc.) — not stable for selectors
  function isGenId(id) {
    return /^(mat-|cdk-|ng-|_ng|ember|react-|vue-)/.test(id) || /^\d/.test(id);
  }

  // Attempt to build a relative (non-positional) XPath that matches exactly 1 element.
  // Strategy order:
  //   A. //tag[normalize-space(.)="text"] — text match (best for links/buttons)
  //   B. //tag[@attr="val"] — single meaningful attribute
  //   C. //*[@id="stableAncestor"]//tag — anchor from nearest stable ancestor ID
  //   D. //*[@id="stableAncestor"]//tag[text] — ancestor + text for extra precision
  function relXpathOf(el) {
    const tag  = el.tagName.toLowerCase();
    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const safeText = (!text.includes('"') && !text.includes("'") && text.length > 0) ? text : null;

    // A. Text match — best for clickable elements (links, buttons, list items)
    const textTags = new Set(['a', 'button', 'span', 'li', 'td', 'option', 'label', 'h1', 'h2', 'h3', 'h4']);
    if (textTags.has(tag) && safeText) {
      const byText = `//${tag}[normalize-space(.)="${safeText}"]`;
      if (isUniqueXpath(byText)) return byText;
    }

    // B. Single meaningful attribute
    for (const attr of ['type', 'role', 'data-type', 'data-key', 'data-action', 'data-id', 'href']) {
      const val = el.getAttribute(attr);
      if (!val || val.length > 120 || val.startsWith('{')) continue;
      const byAttr = `//${tag}[@${attr}="${val}"]`;
      if (isUniqueXpath(byAttr)) return byAttr;
      // Attribute + text for extra precision
      if (safeText) {
        const byBoth = `//${tag}[@${attr}="${val}" and normalize-space(.)="${safeText}"]`;
        if (isUniqueXpath(byBoth)) return byBoth;
      }
    }

    // C & D. Walk up to find nearest stable ancestor with a non-generated ID
    let node = el.parentElement;
    let depth = 0;
    while (node && depth < 5) {
      const anId = node.id;
      if (anId && !isGenId(anId)) {
        // Anchor from this ancestor
        const rel = `//*[@id="${anId}"]//${tag}`;
        if (isUniqueXpath(rel)) return rel;
        // Anchor + text
        if (safeText) {
          const relText = `//*[@id="${anId}"]//${tag}[normalize-space(.)="${safeText}"]`;
          if (isUniqueXpath(relText)) return relText;
        }
        break; // one stable ancestor is enough — don't keep walking
      }
      node = node.parentElement;
      depth++;
    }

    return null; // nothing unique found — caller uses absolute XPath
  }

  // Absolute XPath — last resort, always unique but fragile (position-based)
  function xpathOf(el) {
    if (el.id && !isGenId(el.id)) return `//*[@id="${el.id}"]`;
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

  function bestSelector(el) {
    if (!el || el.nodeType !== 1) return { sel: '', type: 'css' };

    // 1. data-testid — intentionally set for testing, most stable
    const tid = el.getAttribute('data-testid');
    if (tid) {
      const sel = `[data-testid="${tid}"]`;
      if (isUniqueCss(sel)) return { sel, type: 'testid' };
    }

    // 2. Non-generated ID
    if (el.id && !isGenId(el.id)) {
      const sel = '#' + el.id;
      if (isUniqueCss(sel)) return { sel, type: 'css' };
    }

    // 3. aria-label — set for accessibility, stable
    const al = el.getAttribute('aria-label');
    if (al?.trim()) {
      const sel = `[aria-label="${al}"]`;
      if (isUniqueCss(sel)) return { sel, type: 'css' };
      // Combine with tag for precision if not unique alone
      const selTag = `${el.tagName.toLowerCase()}[aria-label="${al}"]`;
      if (isUniqueCss(selTag)) return { sel: selTag, type: 'css' };
    }

    // 4. name attribute
    const nm = el.getAttribute('name');
    if (nm) {
      const sel = `[name="${nm}"]`;
      if (isUniqueCss(sel)) return { sel, type: 'css' };
    }

    // 5. placeholder
    const ph = el.getAttribute('placeholder');
    if (ph) {
      const sel = `[placeholder="${ph}"]`;
      if (isUniqueCss(sel)) return { sel, type: 'css' };
    }

    // 6. Relative XPath — text-based, attribute-based, or ancestor-anchored
    const rel = relXpathOf(el);
    if (rel) return { sel: rel, type: 'xpath' };

    // 7. Absolute XPath — last resort (positional, fragile but always unique)
    return { sel: xpathOf(el), type: 'xpath' };
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

  // Inject dialog interceptor into the PAGE's main world via a <script> tag.
  // Patches window.alert/confirm/prompt so the page's own calls are captured.
  // After each dialog the result is posted back as a custom DOM event (__qa_dialog)
  // which the content script (isolated world) listens for above.
  let _dialogInterceptorInjected = false;
  function injectDialogInterceptor() {
    if (_dialogInterceptorInjected) return;
    _dialogInterceptorInjected = true;
    const script = document.createElement('script');
    script.textContent = `(function() {
      if (window.__qaDialogPatched) return;
      window.__qaDialogPatched = true;
      const _fire = (type, value, smartName) =>
        document.dispatchEvent(new CustomEvent('__qa_dialog', { detail: { type, value, smartName } }));
      const _alert   = window.alert.bind(window);
      const _confirm = window.confirm.bind(window);
      const _prompt  = window.prompt.bind(window);
      window.alert = function(msg) {
        _alert(msg);
        _fire('ACCEPT_ALERT', String(msg ?? ''), 'Alert Dialog');
      };
      window.confirm = function(msg) {
        const result = _confirm(msg);
        _fire(result ? 'ACCEPT_DIALOG' : 'DISMISS_DIALOG', String(msg ?? ''), 'Confirm Dialog');
        return result;
      };
      window.prompt = function(msg, def) {
        const result = _prompt(msg, def);
        if (result !== null) {
          _fire('HANDLE_PROMPT', String(result ?? ''), 'Prompt Dialog');
        } else {
          _fire('DISMISS_DIALOG', String(msg ?? ''), 'Prompt Dismissed');
        }
        return result;
      };
    })();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
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
    // Capturing every internal SPA route change produces redundant Reload/GOTO
    // steps — especially on SSO-heavy apps with multiple redirects and spinners.

    // Browser dialogs — must patch in the PAGE's main world, not the isolated world.
    // Content scripts run in an isolated JS context; patching window.confirm here
    // has no effect on the page's own calls. We inject a <script> tag into the DOM
    // (which executes in the main world) and communicate back via custom DOM events,
    // which cross the isolated-world boundary because both worlds share the same DOM.
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
