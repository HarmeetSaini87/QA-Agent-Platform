/**
 * recorder.js — QA Agent Platform UI Recorder (v3)
 * Injected into AUT tab when __qa_recorder=<token> is present.
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
  let _lastClick    = { sel: '', ts: 0 };
  let _lastActionTs = 0;   // timestamp of last emitted step (for toast window)
  const DEBOUNCE_MS = 300;

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
  const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio', 'switch']);

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

  // ── Uniqueness check ──────────────────────────────────────────────────────────
  function isUnique(selector, root) {
    try {
      return (root || document).querySelectorAll(selector).length === 1;
    } catch { return false; }
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

  // ── Semantic XPath builder ────────────────────────────────────────────────────
  function semanticXPath(el) {
    const tag = el.tagName.toLowerCase();
    if (el.id && !isDynamicId(el.id)) return `//*[@id="${el.id}"]`;

    const al = el.getAttribute('aria-label');
    if (al) return `//*[@aria-label="${al}"]`;

    const nm = el.getAttribute('name');
    if (nm) return `//${tag}[@name="${nm}"]`;

    const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length >= 2 && text.length <= 50) {
      return `//${tag}[normalize-space(.)="${text}"]`;
    }

    const ph = el.getAttribute('placeholder');
    if (ph) return `//${tag}[@placeholder="${ph}"]`;

    const title = el.getAttribute('title');
    if (title) return `//${tag}[@title="${title}"]`;

    const tid = el.getAttribute('data-testid');
    if (tid) return `//*[@data-testid="${tid}"]`;

    // Last resort — positional (fragile, logged)
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body) {
      let idx = 1;
      let sib = node.previousSibling;
      while (sib) { if (sib.nodeType === 1 && sib.nodeName === node.nodeName) idx++; sib = sib.previousSibling; }
      const t = node.nodeName.toLowerCase();
      parts.unshift(idx > 1 ? `${t}[${idx}]` : t);
      node = node.parentNode;
    }
    console.warn('[QA Recorder] Positional XPath used — consider adding data-testid or aria-label to this element');
    return '/' + parts.join('/');
  }

  // ── Master selector strategy ──────────────────────────────────────────────────
  function bestSelector(el, root) {
    if (!el || el.nodeType !== 1) return { sel: '', type: 'css' };
    const r   = root || document;
    const tag = el.tagName.toLowerCase();

    // [I] Row-anchored XPath for table cells
    const rowXPath = buildRowAnchoredXPath(el);
    if (rowXPath) return { sel: rowXPath, type: 'xpath' };

    // 1. data-testid — most stable
    const tid = el.getAttribute('data-testid');
    if (tid) return { sel: `[data-testid="${tid}"]`, type: 'testid' };

    // 2. Role + accessible name → getByRole
    const elRole = el.getAttribute('role') || (
      tag === 'button' ? 'button' :
      tag === 'a'      ? 'link'   :
      tag === 'select' ? 'combobox' : null
    );
    if (elRole) {
      const al   = el.getAttribute('aria-label');
      if (al && al.trim()) return { sel: `role:${elRole}:${al.trim()}`, type: 'role' };
      const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
      if (text && text.length >= 2 && text.length <= 60) return { sel: `role:${elRole}:${text}`, type: 'role' };
    }

    // 3. Associated label → getByLabel (best for form inputs)
    if (tag === 'input' || tag === 'select' || tag === 'textarea') {
      const lbl = getAssociatedLabel(el);
      if (lbl) return { sel: `label:${lbl}`, type: 'label' };
    }

    // 4. aria-label → XPath
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return { sel: `//*[@aria-label="${ariaLabel.trim()}"]`, type: 'xpath' };

    // 5. Placeholder → getByPlaceholder
    const ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return { sel: `placeholder:${ph.trim()}`, type: 'placeholder' };

    // 6. Stable ID
    if (el.id && !isDynamicId(el.id)) {
      const cssId = `#${el.id}`;
      if (isUnique(cssId, r)) return { sel: cssId, type: 'css' };
    }

    // 7. name attribute (uniqueness verified)
    const nm = el.getAttribute('name');
    if (nm) {
      const cssName = `${tag}[name="${nm}"]`;
      if (isUnique(cssName, r)) return { sel: cssName, type: 'name' };
    }

    // 8. Semantic XPath
    return { sel: semanticXPath(el), type: 'xpath' };
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

  // ── [G] FILL dedup + [B] React/Angular value tracking ────────────────────────
  const _lastFillEmitted = new Map(); // selector → last emitted value
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
      const loc     = bestSelector(trigger || raw);
      postStep({
        eventType:    'SELECT',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        optionText,
        smartName:    smartName(trigger || raw),
        tagName:      'select',
        url:          cleanUrl(window.location.href),
      });
      return;
    }

    const el = resolveInteractive(raw);

    // Suppress CLICK on elements handled by other events
    if (isFillable(el))                          return;
    if (isDateInput(el))                         return;
    if ((el.type || '').toLowerCase() === 'file') return;
    if (el.tagName.toLowerCase() === 'select')   return;

    // Debounce
    const loc = bestSelector(el);
    const now  = Date.now();
    if (loc.sel === _lastClick.sel && now - _lastClick.ts < DEBOUNCE_MS) return;
    _lastClick = { sel: loc.sel, ts: now };

    const type = (el.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      postStep({
        eventType:    el.checked ? 'CHECK' : 'UNCHECK',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        '',
        smartName:    smartName(el),
        tagName:      el.tagName.toLowerCase(),
        url:          cleanUrl(window.location.href),
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
      url:          cleanUrl(window.location.href),
    });
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
      });
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
      });
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
      });
    }
  }

  // ── BLUR handler — FILL capture ───────────────────────────────────────────────
  function handleBlur(e) {
    const el = e.target;
    if (!el || el.nodeType !== 1) return;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (isDateInput(el)) return;

    if ((tag === 'input' && FILLABLE_INPUT_TYPES.has(type)) || tag === 'textarea' || el.getAttribute('contenteditable') === 'true') {
      const loc = bestSelector(el);

      // [B] Use input-tracked value as fallback (React may clear el.value before blur fires)
      const value = el.value || _lastInputValue.get(loc.sel) || '';
      _lastInputValue.delete(loc.sel);

      if (!value && value !== '0') return;

      // [G] Dedup — skip if same selector+value was just emitted
      if (_lastFillEmitted.get(loc.sel) === value) return;
      _lastFillEmitted.set(loc.sel, value);

      // [E] Password masking — never store raw passwords
      const emitValue = isPasswordField(el) ? '{{env.PASSWORD}}' : value;

      postStep({
        eventType:    'FILL',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        emitValue,
        smartName:    smartName(el),
        tagName:      tag,
        url:          cleanUrl(window.location.href),
      });
    }
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
      const loc = bestSelector(el);
      postStep({
        eventType:    'ASSERT_VISIBLE',
        selector:     loc.sel,
        selectorType: loc.type,
        value:        text,
        smartName:    text.substring(0, 60),
        tagName:      el.tagName.toLowerCase(),
        url:          cleanUrl(window.location.href),
      });
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

  history.pushState = function (...args) {
    _origPush(...args);
    postStep({ eventType: 'GOTO', selector: '', selectorType: 'css', value: cleanUrl(window.location.href), smartName: '', tagName: '', url: cleanUrl(window.location.href) });
  };
  history.replaceState = function (...args) {
    _origReplace(...args);
    // replaceState is often internal router (Angular) — skip to reduce noise
  };

  window.addEventListener('popstate', () => {
    postStep({ eventType: 'GOTO', selector: '', selectorType: 'css', value: cleanUrl(window.location.href), smartName: '', tagName: '', url: cleanUrl(window.location.href) });
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
