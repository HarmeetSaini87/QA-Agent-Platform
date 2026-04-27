# Playwright Trace Viewer Embed — Design Spec

**Feature:** Trace Viewer Embed in Execution Reports
**Platform:** TestForge (qa-agent-platform)
**Author:** Harmeet Saini
**Version:** v1.0 — 2026-04-27
**Status:** Approved for implementation

---

## Overview

Embed the official Playwright Trace Viewer inside execution reports so engineers can step through DOM snapshots, network requests, and console output for failed tests — without leaving the platform and without downloading a zip file.

This is USP #3. It matches Cypress Test Replay feature parity and works in local, remote, and CI environments.

---

## Constraints

1. Works on local dev (`localhost:3003`) and remote machines (CI agents, cloud VMs) — iframe src built from `window.location.origin` at runtime.
2. Never expose raw file paths — all trace access goes through `/api/trace/:runId/:testId`.
3. Viewer files copied to `public/trace-viewer/` at setup time — never read from `node_modules` at runtime.
4. `trace: 'on-first-retry'` in `playwright.config.ts` — traces only captured on retried tests to control storage.
5. Reverse-proxy safe — `window.location.origin` gives the correct public URL automatically.

---

## Architecture

Three additive components. Nothing existing is modified in a breaking way.

```
scripts/copy-trace-viewer.js        — one-time setup, copies viewer to public/
src/ui/public/trace-viewer/         — committed static viewer files
server.ts                           — 2 new routes: /trace-viewer/* and /api/trace/:runId/:testId
execution-report.html               — additive: [View Trace] button + modal + expanded panel section
playwright.config.ts                — trace: 'on' → 'on-first-retry'
```

### Data Flow

```
User clicks [View Trace] in execution report
  → JS reads window.location.origin
  → Constructs: traceApiUrl = {origin}/api/trace/{runId}/{testId}
  → Constructs: iframeSrc = {origin}/trace-viewer/?trace={encodeURIComponent(traceApiUrl)}
  → Opens full-screen modal with loading spinner
  → iframe loads /trace-viewer/ (static HTML/JS — SPA with fallback)
  → Playwright viewer JS fetches traceApiUrl
  → server.ts /api/trace validates request, checks path safety, streams zip
  → Viewer renders DOM snapshots + network + console timeline
  → iframe onload fires → spinner hidden
```

---

## Component 1: Setup Script

**File:** `scripts/copy-trace-viewer.js`
**Run:** `npm run setup:trace-viewer` (also called in CI setup step)

Behaviour:
- Reads source from `node_modules/playwright-core/lib/vite/traceViewer/`
- Fails with clear message + Playwright version if source path not found
- Clears `src/ui/public/trace-viewer/` with `fs.rmSync(target, { recursive: true, force: true })`
- Copies all files recursively with timestamps
- Logs Playwright version from `node_modules/playwright-core/package.json`
- Idempotent — safe to re-run after Playwright upgrades

**`package.json` addition:**
```json
"setup:trace-viewer": "node scripts/copy-trace-viewer.js"
```

---

## Component 2: Server Routes

### Route A — Static Viewer with SPA Fallback

```typescript
const viewerDir = path.join(__dirname, 'public/trace-viewer');
app.use('/trace-viewer', express.static(viewerDir));
app.get('/trace-viewer/*', (_, res) =>
  res.sendFile(path.join(viewerDir, 'index.html')));
```

SPA fallback is required — Playwright viewer uses client-side routing and a direct hit to `/trace-viewer/?trace=...` would 404 without it.

### Route B — Secure Trace Stream

```
GET /api/trace/:runId/:testId
```

**Processing steps (in order):**

1. **Auth stub** — `canAccessTrace(req, runId)` — returns `true` in v1, structured for future auth. Returns `{ error: { code: 'FORBIDDEN', message: 'Access denied' } }` with status 404 (not 403) to prevent resource enumeration.

2. **Load run file** — read `data/results/run-{runId}.json`. If missing → 404 `RUN_NOT_FOUND`.

3. **Find test result** — locate result where `result.testId === testId`. If missing → 404 `TEST_NOT_FOUND`.

4. **Check tracePath** — if `result.tracePath` is empty/null → 404 `TRACE_NOT_FOUND`.

5. **Path safety guard:**
   ```typescript
   const baseDir = path.resolve(ARTIFACTS_DIR);
   const resolved = path.resolve(baseDir, result.tracePath);
   if (!resolved.startsWith(baseDir + path.sep))
     return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
   ```
   Uses `baseDir + path.sep` to prevent `/baseDirX` prefix false-match.

6. **File existence + size check:**
   - File missing → 404 `TRACE_MISSING_ON_DISK`
   - File > 50MB → 413 `{ error: { code: 'TRACE_TOO_LARGE', message: 'Trace too large to preview' } }`

7. **Audit log:**
   ```typescript
   logAudit({ action: 'trace_viewed', runId, testId, userId: req.user?.id, ip: req.ip, requestId, timestamp: new Date().toISOString() });
   ```

8. **Stream response:**
   ```typescript
   res.setHeader('Content-Type', 'application/zip');
   res.setHeader('Content-Disposition', 'inline; filename="trace.zip"');
   res.setHeader('Cache-Control', 'private, max-age=300');
   res.setHeader('Accept-Ranges', 'bytes');
   res.setHeader('X-Content-Type-Options', 'nosniff');
   res.setHeader('X-Request-Id', requestId);

   const stream = fs.createReadStream(resolved);
   stream.on('error', () =>
     res.status(500).json({ error: { code: 'TRACE_READ_FAILED', message: 'Failed to read trace' } }));
   req.on('close', () => stream.destroy()); // prevent fd leak on modal close
   stream.pipe(res);
   ```

### Error Envelope (all errors use this shape)

```typescript
{ error: { code: string, message: string } }
```

| Condition | Status | code |
|---|---|---|
| Run file missing | 404 | `RUN_NOT_FOUND` |
| testId not in run | 404 | `TEST_NOT_FOUND` |
| tracePath empty | 404 | `TRACE_NOT_FOUND` |
| Zip deleted from disk | 404 | `TRACE_MISSING_ON_DISK` |
| Path traversal | 400 | `BAD_REQUEST` |
| Auth fails | 404 | (opaque — no leak) |
| File > 50MB | 413 | `TRACE_TOO_LARGE` |
| Read error | 500 | `TRACE_READ_FAILED` |

---

## Component 3: Execution Report UI

**File:** `src/ui/public/execution-report.html`
**Approach:** Additive only. Existing table structure, result rendering, and CSS untouched.

### Table Row

`[View Trace]` button rendered **only** when `ev.tracePath` is present and non-empty on the TestEvent. No disabled buttons in the table — zero noise for tests without traces.

### Expanded Detail Panel

Always renders a **Trace** section. Content depends on state:

| State | Display |
|---|---|
| Trace available | `[View Trace]` button |
| Passed on first run (retryIndex === 0, no tracePath) | "Not captured — test passed on first run" |
| Trace artifact deleted | "Trace artifact not found (may have expired)" |
| Tracing disabled (`traceMode: 'off'` in run metadata) | "Tracing not enabled for this run" |

`traceMode` field added to run metadata at generation time (`'on-first-retry'` or `'off'`) so the UI can differentiate "no retry happened" from "tracing was off".

### Preflight Before Opening Modal

Before loading the iframe, the UI does a `HEAD /api/trace/:runId/:testId`:
- 200 → open modal with iframe
- 404 → show inline error message in modal (reason from `error.code`)
- 413 → show "Trace too large to preview (> 50MB)" in modal
- Any other error → show generic "Failed to load trace"

This prevents the iframe from loading a JSON error body and showing a blank/broken viewer.

### Modal

```html
<div id="trace-modal" class="trace-modal-overlay" hidden>
  <div class="trace-modal-inner">
    <div class="trace-modal-header">
      <span id="trace-modal-title">Trace: [test name]</span>
      <button onclick="closeTraceModal()">✕ Close</button>
    </div>
    <div id="trace-modal-loading">Loading trace...</div>
    <div id="trace-modal-error" hidden></div>
    <iframe id="trace-iframe" src="" onload="onTraceLoaded()" onerror="onTraceError()"></iframe>
  </div>
</div>
```

- Overlay: `position:fixed; inset:0; background:rgba(0,0,0,0.7); z-index:9999`
- Inner: `width:95vw; height:92vh`
- Spinner shown until `onload` fires
- `onerror` → hide spinner, show "Failed to load trace viewer"
- Escape key closes modal
- Modal close destroys iframe src (stops fetch, releases fd on server via `req.on('close')`)

---

## `playwright.config.ts` Change

```typescript
// Before
trace: 'on',

// After
trace: 'on-first-retry',
```

Only retried tests generate traces. Tests that pass first time produce no zip — which is the correct signal (no trace = test was healthy enough to pass without retry).

---

## What Is NOT in v1

- Execution History tab — no trace links (can navigate to execution report which has them)
- Flaky Tests tab — no trace links
- Range request (206) — `Accept-Ranges: bytes` header advertised but 206 not implemented
- Auth enforcement — `canAccessTrace()` stub always returns true
- Webhook/email notifications
- ETag caching

---

## Manual Test Checklist

| # | Scenario | Expected |
|---|---|---|
| 1 | Test passes first run | No button in table. Expanded: "Not captured — passed on first run" |
| 2 | Test fails on retry | `[View Trace]` button in table. Modal opens. Viewer loads. |
| 3 | Delete trace zip manually | Preflight 404. Modal: "Trace artifact not found" |
| 4 | Trace > 50MB | Preflight 413. Modal: "Trace too large to preview (> 50MB)" |
| 5 | Remote machine | iframe src uses remote origin. Viewer loads correctly. |
| 6 | Behind reverse proxy / HTTPS | `window.location.origin` returns public URL. No mixed content. |
| 7 | Close modal mid-load | Server logs no fd leak. Stream destroyed. |
| 8 | 3 modals opened quickly | Server stable. No fd exhaustion. |
| 9 | Path traversal on `/api/trace` | 400. No path info in response body. |
| 10 | Tracing disabled in config | Expanded panel: "Tracing not enabled for this run" |
| 11 | Old run (pre-feature) | No tracePath on TestEvent → "Not captured" message |
| 12 | `setup:trace-viewer` re-run | Clears and re-copies. No stale files. Logs Playwright version. |
