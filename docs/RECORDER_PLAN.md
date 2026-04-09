# QA Agent Platform — UI Recorder Feature
**Status:** Implementation Plan — Approved  
**Date:** 2026-04-09  
**Author:** QA Agent Platform Team

---

## Overview

The UI Recorder lets users record real browser interactions directly inside the Test Script editor. While the user clicks, fills, and navigates in the target application, steps appear live in the script editor — with locators auto-resolved from the Locator Repository and auto-added to it when new elements are found.

No installation required on user machines. Works from any browser on any machine that can reach the platform.

---

## Architecture

```
Test Script Editor (modules.js)
  → "Start Recording" button clicked
  → POST /api/recorder/start  { projectId, scriptId?, environmentId }
  ← { token, recorderUrl }

Platform opens new tab: <AUT url>?__qa_recorder=<token>
  → server intercepts request, injects recorder.js into AUT page response

recorder.js (runs in user's browser on their machine)
  → monkey-patches window.alert / confirm / prompt
  → attaches event listeners: click, change, input, submit
  → recursively injects into open shadow roots (MutationObserver)
  → injects into same-origin iframe contentDocuments
  → captures file input changes → UPLOAD keyword
  → for each action: POST /api/recorder/step { token, event }

Server (/api/recorder/step)
  → receives raw event (selector, value, eventType, url)
  → resolves selector against Locator Repository (exact match)
  → if no match → auto-creates new Locator Repository entry (smart name)
  → converts to ScriptStep shape
  → pushes step to script editor via SSE (same infra as debugger)

Test Script Editor (SSE client)
  → receives step → appends live to step list
  → user sees steps build up in real time

User clicks "Stop Recording"
  → POST /api/recorder/stop { token }
  → recorder.js tears down listeners
  → tab can be closed
  → all steps are in editor — user reviews, edits, saves
```

---

## What Gets Captured (Tier 1 Scope)

| Interaction | Keyword Generated | Notes |
|---|---|---|
| Click any element | CLICK | SVG: XPath selector used |
| Fill text input / textarea | FILL | Value captured |
| Select dropdown option | SELECT | Selected option value captured |
| Check / uncheck checkbox | CHECK / UNCHECK | — |
| Page navigation | GOTO | URL captured |
| `window.alert()` | ACCEPT_ALERT | Message captured as value |
| `window.confirm()` | ACCEPT_DIALOG | Message captured |
| `window.prompt()` | HANDLE_PROMPT | Message + input value |
| File input change | UPLOAD | Filename(s) captured |
| Open shadow DOM elements | (any above) | Recursive injection via MutationObserver |
| Same-origin iframes | (any above) | Listeners injected into contentDocument |

### Not in Tier 1 (Tier 2 — Chrome Extension, future)
- Cross-origin iframes
- `window.open()` popup windows
- Multi-tab flows

---

## Locator Resolution Strategy

When recorder captures a raw CSS selector, server runs this resolution pipeline:

### Step 1 — Exact match in Locator Repository
```
recorded selector: "#btnCreate"
→ scan locators.json (projectId filter)
→ find { name: "Add Button", selector: "#btnCreate" }
→ use: locatorId, locatorName, locatorType: "css", locator: "#btnCreate"
```
Zero user effort. Step uses the named locator.

### Step 2 — No match → Auto-create Locator Repository entry
Smart name generated from element attributes (priority order):

| Priority | Source | Example |
|---|---|---|
| 1 | `aria-label` | "Add Button" |
| 2 | `title` attribute | "Submit Form" |
| 3 | Inner text ≤ 30 chars | "Click Gateway Type" |
| 4 | `data-testid` | "btn-create" |
| 5 | `id` | "btnCreate" |
| 6 | `placeholder` | "Enter Username" |
| 7 | `tagName + role` | "Select (combobox)" |
| 8 | Fallback | "Element {n}" |

New Locator Repository entry created automatically:
```json
{
  "id": "<uuid>",
  "projectId": "<current>",
  "name": "Add Button",
  "selector": "#btnCreate",
  "locatorType": "css",
  "description": "Auto-captured by recorder",
  "component": ""
}
```

Step uses the new entry. User can edit the name/component in the Locator Repository later.

### Step 3 — SVG Elements
`querySelector` returns the SVG element. Since SVG has no text/id/aria in many cases, XPath is derived:
```
//*[name()='svg'][...] or //*[name()='path'][...]
```
Stored as `locatorType: "xpath"`.

---

## Selector Derivation Priority (recorder.js)

For each captured element, selector derived in this order:

```
1. data-testid          → [data-testid="value"]
2. id                   → #value
3. aria-label           → [aria-label="value"]
4. name attribute       → [name="value"]
5. placeholder          → [input[placeholder="value"]]
6. CSS class (unique)   → .specific-class (only if unique on page)
7. XPath                → //tagName[@attr="value"] (fallback, always unique)
```

XPath is always computed as the final fallback — guaranteed to uniquely identify the element. For SVG, XPath is always used.

---

## Recorder Injection Strategy

### Main Document
Injected at `DOMContentLoaded` via server-side script tag insertion. Monkey-patches and event listeners attach before any user interaction.

### Open Shadow DOM
```js
const shadowObserver = new MutationObserver((mutations) => {
  mutations.forEach(m => {
    m.addedNodes.forEach(node => {
      if (node.shadowRoot) injectIntoShadowRoot(node.shadowRoot);
    });
  });
});
shadowObserver.observe(document.documentElement, { childList: true, subtree: true });
```
Recursively attaches listeners to any shadow root discovered after load.

### Same-Origin Iframes
```js
document.querySelectorAll('iframe').forEach(injectIntoIframe);
// Also watch for dynamically added iframes
iframeObserver = new MutationObserver(...);
```
`injectIntoIframe` creates a `<script>` tag inside `iframe.contentDocument` if same origin. Cross-origin: silently skipped.

### Browser Dialogs
Monkey-patched at inject time, before any page scripts run:
```js
window.alert   = (msg) => { postStep('ACCEPT_ALERT',  '', msg);  };
window.confirm = (msg) => { postStep('ACCEPT_DIALOG', '', msg); return true; };
window.prompt  = (msg, def) => { postStep('HANDLE_PROMPT', '', def || ''); return def || ''; };
```

### File Inputs
```js
document.addEventListener('change', (e) => {
  if (e.target.type === 'file') {
    const files = [...e.target.files].map(f => f.name).join(', ');
    postStep('UPLOAD', selectorFor(e.target), files);
  }
}, true);
```
OS dialog is untouched — we capture the result after user selects file. In Playwright execution, UPLOAD maps to `page.setInputFiles()` which bypasses the OS dialog entirely.

---

## Data Flow — Step Shape

Each recorded step sent to server:

```json
{
  "token": "<session token>",
  "eventType": "click",
  "tagName": "button",
  "selector": "#btnCreate",
  "xpath": "//button[@id='btnCreate']",
  "value": "",
  "innerText": "Add",
  "ariaLabel": "Add",
  "dataTestId": "",
  "placeholder": "",
  "elementId": "btnCreate",
  "url": "https://app.billcall.com/gateway-types",
  "shadowPath": false,
  "iframeSrc": null
}
```

Server response: resolved `ScriptStep` shape pushed via SSE to the editor.

---

## New API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/recorder/start` | Start recording session, return token + AUT URL |
| `POST` | `/api/recorder/step` | Receive one recorded action from recorder.js |
| `POST` | `/api/recorder/stop` | Stop recording session, mark complete |
| `GET` | `/api/recorder/stream/:token` | SSE stream — pushes steps to editor in real time |
| `GET` | `/recorder.js` | Serves the recorder script (injected into AUT tab) |

---

## UI Changes

### Test Script Editor
- New **"Record"** button next to "Add Step" (disabled until project selected)
- While recording: button changes to **"Stop Recording"** (red), status badge "Recording..." shown
- Steps appear live in the step list as user interacts with the AUT
- On stop: badge clears, button resets, steps remain for review

### Locator Repository
- Auto-created entries tagged `"description": "Auto-captured by recorder"` — easy to identify and bulk-edit

### No other UI modules affected.

---

## New Files

| File | Purpose |
|---|---|
| `src/ui/public/recorder.js` | Injected into AUT tab — captures interactions, POSTs to server |
| `src/utils/recorderParser.ts` | Selector derivation, smart name generation, ScriptStep assembly |

## Modified Files

| File | Change |
|---|---|
| `src/ui/server.ts` | 4 new endpoints + SSE stream + AUT proxy injection |
| `src/ui/public/modules.js` | Record button, SSE client for live step insertion |
| `src/ui/public/index.html` | Record button HTML in script editor toolbar |

---

## Recorder Session Model

```typescript
interface RecorderSession {
  token: string;
  projectId: string;
  createdAt: number;
  active: boolean;
  steps: ScriptStep[];
  sseClients: Set<ServerResponse>;
}
```

Sessions stored in-memory (Map). Auto-expire after 30 minutes of inactivity.

---

## Keyword Mapping

| DOM Event / Source | Keyword |
|---|---|
| `click` on non-input | CLICK |
| `click` on checkbox | CHECK / UNCHECK (toggle based on checked state) |
| `input` / `change` on text, email, password, textarea | FILL |
| `change` on select | SELECT |
| `change` on file input | UPLOAD |
| `page.goto` (navigation detected) | GOTO |
| `window.alert` monkey-patch | ACCEPT_ALERT |
| `window.confirm` monkey-patch | ACCEPT_DIALOG |
| `window.prompt` monkey-patch | HANDLE_PROMPT |

---

## Implementation Order

1. **`recorder.js`** — event capture + POST to server (no UI yet, test with curl)
2. **`recorderParser.ts`** — selector derivation + smart name + ScriptStep assembly
3. **Server endpoints** — `/start`, `/step`, `/stop`, `/stream/:token`, `/recorder.js` serve
4. **AUT injection** — server injects recorder.js script tag when `__qa_recorder` param present
5. **SSE push** — steps pushed to editor via SSE stream
6. **UI — Record button + live step insertion** — modules.js + index.html
7. **Locator Repository auto-create** — resolver creates repo entries for unmatched selectors
8. **End-to-end test** — record a 5-step flow, verify steps + repo entries correct

---

## Open Questions / Decisions

| Question | Decision |
|---|---|
| AUT injection method | Server acts as proxy OR inject via query param redirect — query param preferred (simpler, no proxy needed) |
| Dedup fast clicks | 300ms debounce on CLICK to avoid double-capture on fast users |
| Record HOVER? | No — HOVER is rarely useful in automation; omit to reduce noise |
| Record scroll? | No — Playwright handles scroll automatically; omit |
| Step screenshot during record? | No — recorder is live capture only; screenshots come at debug/run time |
| Max session duration | 30 minutes inactivity timeout, 2 hour hard cap |

---

## Future (Tier 2 — Chrome Extension)

Builds on the same `/api/recorder/step` endpoint — only the capture layer changes.

- Cross-origin iframes (content script runs in every frame)
- `window.open()` popup tabs (extension has access to all tabs)
- Multi-tab recording flows
- Platform detects extension via `window.__qaAgentExtension` flag — shows "Enhanced Recording" badge when present

---

## Success Criteria

- [ ] Record a 5-step login flow → all steps appear in editor with correct keyword/locator/value
- [ ] Known locators (in repo) auto-resolve by name — not raw CSS
- [ ] Unknown locators auto-created in Locator Repository with smart name
- [ ] File upload captured — UPLOAD keyword + filename in value
- [ ] `window.alert` captured — ACCEPT_ALERT keyword
- [ ] Shadow DOM elements captured (if present in AUT)
- [ ] Same-origin iframes captured (if present in AUT)
- [ ] Stop recording → steps persist in editor → can save as script
- [ ] No duplicate steps from fast clicks (debounce working)
- [ ] Session auto-expires after inactivity
