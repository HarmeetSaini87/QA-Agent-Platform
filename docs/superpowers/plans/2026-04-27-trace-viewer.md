# Playwright Trace Viewer Embed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the official Playwright Trace Viewer inside execution reports via a full-screen modal so engineers can step through DOM snapshots, network, and console for failed tests without leaving the platform.

**Architecture:** A one-time setup script copies static viewer files from `node_modules/playwright-core` into `src/ui/public/trace-viewer/`. Two new Express routes serve the viewer (with SPA fallback) and stream trace zips via a secure `/api/trace/:runId/:testId` endpoint. The execution report gets a modal overlay and a HEAD preflight that reads `X-Error-Code` response headers to show precise error messages before loading the iframe.

**Tech Stack:** Node.js/TypeScript, Express.js, Playwright Trace Viewer (static files), Vanilla JS (execution-report.html)

---

## File Map

| File | Action | What changes |
|---|---|---|
| `scripts/copy-trace-viewer.js` | **Create** | One-time setup script — copies viewer from node_modules |
| `src/ui/public/trace-viewer/` | **Create** (output of script) | Committed static viewer files |
| `src/ui/server.ts` | **Modify** | Add `/trace-viewer/*` static+SPA routes, `GET/HEAD /api/trace/:runId/:testId` |
| `src/data/types.ts` | **Modify** | Add `traceMode` field to `RunRecord` interface |
| `src/ui/server.ts` | **Modify** | Set `traceMode` on RunRecord at run creation |
| `src/ui/public/execution-report.html` | **Modify** | Trace modal, updated trace button, expanded panel Trace section |
| `playwright.config.ts` | **Modify** | `trace: 'on'` → `trace: 'on-first-retry'` |
| `package.json` | **Modify** | Add `setup:trace-viewer` script |

---

## Task 1: Setup Script — Copy Viewer Files

**Files:**
- Create: `scripts/copy-trace-viewer.js`
- Modify: `package.json`

- [ ] **Step 1: Create the copy script**

Create `scripts/copy-trace-viewer.js` with this exact content:

```javascript
#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const SRC    = path.join(ROOT, 'node_modules', 'playwright-core', 'lib', 'vite', 'traceViewer');
const TARGET = path.join(ROOT, 'src', 'ui', 'public', 'trace-viewer');

// Read Playwright version for logging
let pwVersion = 'unknown';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', 'playwright-core', 'package.json'), 'utf-8'));
  pwVersion = pkg.version;
} catch (_) {}

// Verify source exists
if (!fs.existsSync(SRC)) {
  console.error(`[copy-trace-viewer] ERROR: Source not found: ${SRC}`);
  console.error(`[copy-trace-viewer] Playwright-core version: ${pwVersion}`);
  console.error('[copy-trace-viewer] Run: npm install playwright-core');
  process.exit(1);
}

// Clear target dir (idempotent)
fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

// Recursive copy helper (preserves timestamps)
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath, fs.constants.COPYFILE_FICLONE_FORCE);
      // Preserve timestamps
      const stat = fs.statSync(srcPath);
      fs.utimesSync(destPath, stat.atime, stat.mtime);
    }
  }
}

copyDir(SRC, TARGET);

// Count files copied
let count = 0;
function countFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) countFiles(path.join(dir, e.name));
    else count++;
  }
}
countFiles(TARGET);

console.log(`[copy-trace-viewer] ✓ Copied ${count} files from playwright-core@${pwVersion}`);
console.log(`[copy-trace-viewer] ✓ Target: ${TARGET}`);
```

- [ ] **Step 2: Add npm script to package.json**

In `package.json`, add to the `"scripts"` section:
```json
"setup:trace-viewer": "node scripts/copy-trace-viewer.js"
```

- [ ] **Step 3: Run the script**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
node scripts/copy-trace-viewer.js
```

Expected output:
```
[copy-trace-viewer] ✓ Copied N files from playwright-core@X.X.X
[copy-trace-viewer] ✓ Target: .../src/ui/public/trace-viewer
```

- [ ] **Step 4: Verify files were created**

```bash
ls src/ui/public/trace-viewer/
```

Expected: `index.html` present in the listing.

- [ ] **Step 5: Commit**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add scripts/copy-trace-viewer.js package.json src/ui/public/trace-viewer/
git commit -m "feat: add copy-trace-viewer setup script and commit static viewer files"
```

---

## Task 2: Server — Static Viewer Route + SPA Fallback

**Files:**
- Modify: `src/ui/server.ts` (add two routes near line 2590, after the `/test-artifacts/*` route)

**Context:** `server.ts` uses `path`, `fs`, `express` already imported. `config.paths.testResults` is the base artifacts dir. Routes use `requireAuth` middleware from line 48.

- [ ] **Step 1: Find the insertion point in server.ts**

```bash
grep -n "test-artifacts\|trace-viewer\|viewerDir" src/ui/server.ts
```

Expected: see `/test-artifacts/*` route around line 2591. Insert the new viewer routes immediately BEFORE the `/test-artifacts/*` route.

- [ ] **Step 2: Add static viewer route with SPA fallback**

In `src/ui/server.ts`, immediately before the line `app.get('/test-artifacts/*', requireAuth,`, add:

```typescript
// ── Playwright Trace Viewer (static SPA) ──────────────────────────────────────
// Serves the copied viewer files. SPA fallback required — viewer uses client-side routing.
const traceViewerDir = path.join(__dirname, 'public/trace-viewer');
app.use('/trace-viewer', requireAuth, express.static(traceViewerDir));
app.get('/trace-viewer/*', requireAuth, (_req: Request, res: Response) => {
  res.sendFile(path.join(traceViewerDir, 'index.html'));
});

```

- [ ] **Step 3: Build and verify no TypeScript errors**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
npm run build 2>&1 | tail -20
```

Expected: build completes with 0 errors.

- [ ] **Step 4: Restart server and smoke-test**

```bash
netstat -ano | findstr :3003
# Note the PID, then:
taskkill //F //PID <pid>
npm run ui >> server.log 2>&1 &
sleep 4
curl -s http://localhost:3003/trace-viewer/ -o /dev/null -w "%{http_code}"
```

Expected: `200` (index.html served from static viewer).

- [ ] **Step 5: Commit**

```bash
git add src/ui/server.ts
git commit -m "feat: add /trace-viewer static route with SPA fallback"
```

---

## Task 3: Server — `GET/HEAD /api/trace/:runId/:testId` Route

**Files:**
- Modify: `src/ui/server.ts` (add route after the `/trace-viewer/*` SPA fallback, still before `/test-artifacts/*`)
- Modify: `src/data/types.ts` — add `traceMode` to `RunRecord` interface

**Context:**
- `config.paths.results` = run JSON files dir (e.g. `results/run-<id>.json`)
- `config.paths.testResults` = trace zip base dir (e.g. `test-results/`)
- `logAudit` signature: `{ userId, username, action, resourceType, resourceId, details, ip }`
- `requireAuthOrApiKey` already imported at line 48
- `uuidv4` already imported at line 22

- [ ] **Step 1: Add `traceMode` to RunRecord interface in types.ts**

In `src/data/types.ts`, the `RunRecord` interface is defined in `server.ts` (not types.ts — it's a local interface). Skip this step — `traceMode` will be added directly to the `RunRecord` interface in `server.ts` in Step 2.

- [ ] **Step 2: Add `traceMode` to the RunRecord interface in server.ts**

In `src/ui/server.ts`, find the `RunRecord` interface (line ~127). Add `traceMode` field:

```typescript
interface RunRecord {
  runId:           string;
  planPath:        string;
  planId:          string;
  startedAt:       string;
  finishedAt?:     string;
  status:          'queued' | 'running' | 'done' | 'failed';
  exitCode:        number | null;
  output:          string[];
  tests:           TestEvent[];
  passed:          number;
  failed:          number;
  total:           number;
  specPath?:       string;
  projectId?:      string;
  projectName?:    string;
  suiteId?:        string;
  suiteName?:      string;
  environmentId?:  string;
  environmentName?: string;
  executedBy?:     string;
  browsers?:       string[];
  healEvents?:     HealEvent[];
  traceMode?:      'on-first-retry' | 'off' | 'on';  // populated at run creation
}
```

- [ ] **Step 3: Verify where RunRecord is created and set traceMode**

```bash
grep -n "const record: RunRecord = {" src/ui/server.ts
```

Expected: two matches (around lines 3925 and 4586). For each match, open the block and add `traceMode: 'on-first-retry'` as a field. Both are suite run creation points.

At each `const record: RunRecord = {` block, add:
```typescript
traceMode: 'on-first-retry',
```

- [ ] **Step 4: Add the canAccessTrace stub + shared trace handler**

In `src/ui/server.ts`, immediately after the `/trace-viewer/*` SPA fallback route added in Task 2, add:

```typescript
// ── Secure trace stream: GET + HEAD /api/trace/:runId/:testId ────────────────
function canAccessTrace(_req: Request, _runId: string): boolean {
  // v1 stub — always allow. Wire in auth check here in v2.
  return true;
}

function handleTraceRequest(req: Request, res: Response, streamFile: boolean): void {
  const { runId, testId } = req.params;
  const requestId = uuidv4();

  // 1. Auth stub
  if (!canAccessTrace(req, runId)) {
    res.setHeader('X-Error-Code', 'FORBIDDEN');
    res.status(404).end();
    return;
  }

  // 2. Load run file
  const runFile = path.join(config.paths.results, `run-${runId}.json`);
  if (!fs.existsSync(runFile)) {
    res.setHeader('X-Error-Code', 'RUN_NOT_FOUND');
    res.status(404).json({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found' } });
    return;
  }

  let record: RunRecord;
  try {
    record = JSON.parse(fs.readFileSync(runFile, 'utf-8')) as RunRecord;
  } catch {
    res.setHeader('X-Error-Code', 'RUN_NOT_FOUND');
    res.status(404).json({ error: { code: 'RUN_NOT_FOUND', message: 'Run not found' } });
    return;
  }

  // 3. Find test result
  const ev = record.tests.find(t => t.testId === testId);
  if (!ev) {
    res.setHeader('X-Error-Code', 'TEST_NOT_FOUND');
    res.status(404).json({ error: { code: 'TEST_NOT_FOUND', message: 'Test not found in run' } });
    return;
  }

  // 4. Validate tracePath — non-empty, non-null, not absolute
  if (!ev.tracePath || path.isAbsolute(ev.tracePath)) {
    res.setHeader('X-Error-Code', 'TRACE_NOT_FOUND');
    res.status(404).json({ error: { code: 'TRACE_NOT_FOUND', message: 'Trace not found' } });
    return;
  }

  // 5. Path safety guard
  const baseDir  = path.resolve(config.paths.testResults);
  const resolved = path.resolve(baseDir, ev.tracePath);
  if (!resolved.startsWith(baseDir + path.sep)) {
    res.setHeader('X-Error-Code', 'BAD_REQUEST');
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request' } });
    return;
  }

  // 6. File existence + size check
  if (!fs.existsSync(resolved)) {
    res.setHeader('X-Error-Code', 'TRACE_MISSING_ON_DISK');
    res.status(404).json({ error: { code: 'TRACE_MISSING_ON_DISK', message: 'Trace artifact not found' } });
    return;
  }

  const MAX_TRACE_BYTES = 50 * 1024 * 1024; // 50 MB
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    res.setHeader('X-Error-Code', 'TRACE_MISSING_ON_DISK');
    res.status(404).json({ error: { code: 'TRACE_MISSING_ON_DISK', message: 'Trace artifact not found' } });
    return;
  }
  if (stat.size > MAX_TRACE_BYTES) {
    res.setHeader('X-Error-Code', 'TRACE_TOO_LARGE');
    res.status(413).json({ error: { code: 'TRACE_TOO_LARGE', message: 'Trace too large to preview' } });
    return;
  }

  // 7. Set shared headers
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'inline; filename="trace.zip"');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Request-Id', requestId);

  // 8. HEAD — return after headers only
  if (!streamFile) {
    res.end();
    return;
  }

  // 9. Audit log (GET only)
  logAudit({
    userId:       (req as any).session?.userId ?? null,
    username:     (req as any).session?.username ?? null,
    action:       'TRACE_VIEWED',
    resourceType: 'trace',
    resourceId:   `${runId}::${testId}`,
    details:      requestId,
    ip:           req.ip ?? null,
  });

  // 10. Stream
  const stream = fs.createReadStream(resolved);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: { code: 'TRACE_READ_FAILED', message: 'Failed to read trace' } });
    } else {
      res.destroy();
    }
  });
  req.on('close', () => stream.destroy());
  stream.pipe(res);
}

app.get('/api/trace/:runId/:testId',  requireAuthOrApiKey, (req: Request, res: Response) => handleTraceRequest(req, res, true));
app.head('/api/trace/:runId/:testId', requireAuthOrApiKey, (req: Request, res: Response) => handleTraceRequest(req, res, false));
```

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: 0 errors.

- [ ] **Step 6: Smoke-test the route**

Restart the server, then:

```bash
# Should 404 (no such run)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/api/trace/doesnotexist/TID_00000000
```

Expected: `404`

```bash
# HEAD should also 404 with X-Error-Code header
curl -s -I http://localhost:3003/api/trace/doesnotexist/TID_00000000 | grep -i "x-error-code"
```

Expected: `X-Error-Code: RUN_NOT_FOUND`

- [ ] **Step 7: Commit**

```bash
git add src/ui/server.ts
git commit -m "feat: add GET/HEAD /api/trace/:runId/:testId secure stream route"
```

---

## Task 4: Change playwright.config.ts trace mode

**Files:**
- Modify: `playwright.config.ts` (line ~28)

- [ ] **Step 1: Update trace setting**

In `playwright.config.ts`, change:
```typescript
trace: 'on',
```
to:
```typescript
trace: 'on-first-retry',
```

- [ ] **Step 2: Verify the change**

```bash
grep -n "trace:" playwright.config.ts
```

Expected: `trace: 'on-first-retry'`

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "feat: set trace on-first-retry to control storage"
```

---

## Task 5: Execution Report — Modal HTML + CSS

**Files:**
- Modify: `src/ui/public/execution-report.html`

**Context:** This file is vanilla JS + inline CSS. No build step needed — changes are live immediately. Existing trace button is at lines ~964–970. `buildDetailPanel` function is at line ~1000. `window._runId` holds the current run ID (set at line 638). The report data object `r` is available in `renderReport(r)` scope.

- [ ] **Step 1: Add modal HTML and CSS**

In `execution-report.html`, find the closing `</style>` tag of the inline `<style>` block (it's before the `</head>` tag). Just before `</style>`, add:

```css
    /* ── Trace Viewer Modal ─────────────────────────────────────────── */
    .trace-modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.75);
      z-index: 9999;
      display: flex; align-items: center; justify-content: center;
    }
    .trace-modal-overlay[hidden] { display: none !important; }
    .trace-modal-inner {
      width: 95vw; height: 92vh;
      background: #fff; border-radius: 8px;
      display: flex; flex-direction: column;
      overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .trace-modal-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 16px; background: #1e1e2e; color: #fff;
      font-size: 13px; font-weight: 500; flex-shrink: 0;
    }
    .trace-modal-header button {
      background: transparent; border: 1px solid rgba(255,255,255,0.3);
      color: #fff; padding: 4px 10px; border-radius: 4px;
      cursor: pointer; font-size: 12px;
    }
    .trace-modal-header button:hover { background: rgba(255,255,255,0.1); }
    #trace-iframe {
      flex: 1; width: 100%; border: none;
    }
    #trace-modal-loading, #trace-modal-error {
      flex: 1; display: flex; align-items: center; justify-content: center;
      font-size: 14px; color: #555;
    }
    #trace-modal-error { color: #b91c1c; flex-direction: column; gap: 8px; }
    .trace-det-section {
      margin-top: 8px; padding: 10px 12px;
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;
      font-size: 12px; color: #475569;
    }
    .trace-det-hint { color: #94a3b8; font-style: italic; margin-top: 4px; }
```

- [ ] **Step 2: Add modal DOM element before closing `</body>` tag**

Just before `</body>`, add:

```html
<!-- Trace Viewer Modal -->
<div id="trace-modal" class="trace-modal-overlay" hidden>
  <div class="trace-modal-inner">
    <div class="trace-modal-header">
      <span id="trace-modal-title">&#128249; Trace Viewer</span>
      <button onclick="closeTraceModal()">&#10005; Close</button>
    </div>
    <div id="trace-modal-loading">&#9203; Loading trace...</div>
    <div id="trace-modal-error" hidden></div>
    <iframe id="trace-iframe" src="" style="display:none"
            onload="onTraceIframeLoaded()"
            onerror="onTraceIframeError()"></iframe>
  </div>
</div>
```

- [ ] **Step 3: Add trace modal JS functions**

In the `<script>` section near the bottom of the file (after the existing `toggleStep` function, before `</script>`), add:

```javascript
// ── Trace Viewer Modal ────────────────────────────────────────────────────────
const ERROR_CODE_MESSAGES = {
  TRACE_NOT_FOUND:       'Trace not captured for this test.',
  TRACE_MISSING_ON_DISK: 'Trace artifact not found (may have expired).',
  TRACE_TOO_LARGE:       'Trace too large to preview (> 50 MB).',
  RUN_NOT_FOUND:         'Test result not found.',
  TEST_NOT_FOUND:        'Test result not found.',
};

async function openTraceViewer(runId, testId, testName) {
  const origin      = window.location.origin;
  const traceApiUrl = `${origin}/api/trace/${encodeURIComponent(runId)}/${encodeURIComponent(testId)}`;
  const iframeSrc   = `${origin}/trace-viewer/?trace=${encodeURIComponent(traceApiUrl)}`;

  // Show modal in loading state
  const modal   = document.getElementById('trace-modal');
  const loading = document.getElementById('trace-modal-loading');
  const errDiv  = document.getElementById('trace-modal-error');
  const iframe  = document.getElementById('trace-iframe');
  const title   = document.getElementById('trace-modal-title');

  title.textContent   = '\u{1F4F9} Trace: ' + (testName || testId);
  loading.style.display = 'flex';
  errDiv.hidden         = true;
  iframe.style.display  = 'none';
  iframe.src            = '';
  modal.hidden          = false;

  // HEAD preflight — reads X-Error-Code header
  try {
    const head = await fetch(traceApiUrl, { method: 'HEAD' });
    if (!head.ok) {
      const code = head.headers.get('X-Error-Code') || 'UNKNOWN';
      const msg  = ERROR_CODE_MESSAGES[code] || 'Failed to load trace.';
      loading.style.display = 'none';
      errDiv.hidden = false;
      errDiv.innerHTML = `<span>&#9888; ${esc(msg)}</span><span style="font-size:11px;color:#94a3b8">Error code: ${esc(code)}</span>`;
      return;
    }
  } catch (e) {
    loading.style.display = 'none';
    errDiv.hidden = false;
    errDiv.innerHTML = '<span>&#9888; Failed to reach trace endpoint.</span>';
    return;
  }

  // Preflight passed — load iframe
  iframe.src = iframeSrc;
}

function onTraceIframeLoaded() {
  document.getElementById('trace-modal-loading').style.display = 'none';
  document.getElementById('trace-iframe').style.display = 'block';
}

function onTraceIframeError() {
  const loading = document.getElementById('trace-modal-loading');
  const errDiv  = document.getElementById('trace-modal-error');
  const iframe  = document.getElementById('trace-iframe');
  loading.style.display = 'none';
  iframe.style.display  = 'none';
  errDiv.hidden = false;
  errDiv.innerHTML = '<span>&#9888; Failed to load trace viewer.</span>';
}

function closeTraceModal() {
  const modal  = document.getElementById('trace-modal');
  const iframe = document.getElementById('trace-iframe');
  iframe.src   = '';   // triggers req.on('close') on server → destroys stream
  modal.hidden = true;
}

// Escape key closes modal
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeTraceModal();
});
```

- [ ] **Step 4: Verify the modal appears in the HTML (no server restart needed — static file)**

Open `http://localhost:3003/execution-report.html?runId=<any>` in browser. The modal should not be visible by default. Check browser console for JS errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/public/execution-report.html
git commit -m "feat: add trace viewer modal HTML, CSS, and JS to execution report"
```

---

## Task 6: Execution Report — Update Table Trace Button + Expanded Panel

**Files:**
- Modify: `src/ui/public/execution-report.html`

**Context:** The existing trace button is at lines ~964–970. It currently shows a disabled button for tests without traces. Per spec: table shows button only when trace exists, no disabled button. The `buildDetailPanel` function at line ~1000 currently has a comment saying no trace section is needed — replace that comment with the actual Trace section.

The `renderReport(r)` function has access to the full `RunRecord` object `r`, and `r.runId` is available. Inside `buildTestRow`, the test object is `t` (a `TestEvent`). `window._runId` holds the run ID and is set before `renderReport` is called.

- [ ] **Step 1: Replace the trace button logic in the table row**

Find this block (lines ~963–970):

```javascript
  // ── Trace button — always shown; active when a path is captured ───────────
  const traceCell = t.tracePath
    ? `<a class="tc-btn tc-btn-tr" href="${artifactSrc(t.tracePath)}" download
          data-tpath="${esc(t.tracePath)}" onclick="event.stopPropagation()"
          title="Download trace ZIP">&#128229; Trace</a>`
    : `<button class="tc-btn tc-btn-tr tc-btn-inactive" disabled title="No trace captured">
         &#128229; Trace
       </button>`;
```

Replace with:

```javascript
  // ── Trace button — shown only when trace exists (no disabled clutter) ─────
  const traceCell = t.tracePath && t.testId
    ? `<button class="tc-btn tc-btn-tr"
              onclick="event.stopPropagation();openTraceViewer(${JSON.stringify(window._runId)},${JSON.stringify(t.testId)},${JSON.stringify(t.name)})"
              title="View trace in embedded viewer">&#128249; Trace</button>`
    : '';
```

- [ ] **Step 2: Update the table header colspan if traceCell was in its own `<td>`**

Verify the table still renders correctly by checking the `<td>` count matches the header column count. The trace button is inside a `<td>` regardless of whether it's empty — the `<td>` wrapper stays, only the button content changes. No colspan adjustment needed.

- [ ] **Step 3: Add Trace section to buildDetailPanel**

Find the comment in `buildDetailPanel` (line ~1074):

```javascript
  // Video & Trace are accessed via the row-level Play / Trace buttons.
  // No separate section needed in the expanded detail panel.
```

Replace that comment with:

```javascript
  // ── Trace section — always shown in expanded panel ────────────────────────
  {
    let traceContent;
    const runId = window._runId;
    if (t.tracePath && t.testId) {
      traceContent = `
        <button class="tc-btn tc-btn-tr" style="margin:0"
                onclick="openTraceViewer(${JSON.stringify(runId)},${JSON.stringify(t.testId)},${JSON.stringify(t.name)})"
                title="View trace in embedded viewer">&#128249; View Trace</button>`;
    } else if (t.traceMode === 'off') {
      traceContent = `<span style="color:var(--g500)">Tracing not enabled for this run.</span>`;
    } else if (!t.tracePath && (t.retryIndex === 0 || t.retryIndex == null)) {
      traceContent = `<span style="color:var(--g500)">Not captured — test passed on first run.</span>
        <div class="trace-det-hint">Traces are captured on retry only (trace: on-first-retry).</div>`;
    } else {
      traceContent = `<span style="color:var(--g500)">Trace artifact not found (may have expired).</span>`;
    }
    sections.push(`
      <div class="det-section collapsed">
        <div class="det-header" onclick="toggleDetSection(this)">
          <span class="det-arrow">&#9660;</span>
          &#128249; Trace
        </div>
        <div class="det-body">
          <div class="trace-det-section">${traceContent}</div>
        </div>
      </div>`);
  }
```

- [ ] **Step 4: Add `traceMode` and `retryIndex` to TestEvent interface in server.ts**

The trace section uses `t.traceMode` (from RunRecord, not TestEvent) and `t.retryIndex`. The `traceMode` on `RunRecord` needs to be passed down to the report. The easiest approach: the execution report already gets the full `RunRecord` via `/api/run/:runId`. The `r.traceMode` field is on the record, not on individual TestEvents.

Update the `buildDetailPanel` call signature to pass `traceMode`:

Find `const detailHtml = buildDetailPanel(t, i, status);` and change to:

```javascript
  const detailHtml = buildDetailPanel(t, i, status, r.traceMode);
```

And update the `buildDetailPanel` function signature:

```javascript
function buildDetailPanel(t, i, status, traceMode) {
```

In the trace section inside `buildDetailPanel`, replace `t.traceMode` with `traceMode`:

```javascript
    } else if (traceMode === 'off') {
```

**Note:** The `renderReport(r)` function builds all rows, so `r` is in scope when the row builder is called. Verify by checking how `buildTestRow` is called — if `r` is not passed, you need to either pass it or use a closure.

Check how buildTestRow is invoked:
```bash
grep -n "buildTestRow\|buildDetailPanel" src/ui/public/execution-report.html | head -20
```

If `buildTestRow` does not receive `r`, add `traceMode` as a parameter to `buildTestRow` too and pass `r.traceMode` from `renderReport`.

- [ ] **Step 5: Reload the execution report and test**

No server restart needed (static file). Open a run report in the browser. For a test with a trace: `[Trace]` button visible in table. For a test without: no button. Expand the detail panel — Trace section always visible.

- [ ] **Step 6: Commit**

```bash
git add src/ui/public/execution-report.html
git commit -m "feat: update trace button to modal trigger, add Trace section to expanded panel"
```

---

## Task 7: Fix Print/Export — Disable Trace Button in Saved HTML

**Files:**
- Modify: `src/ui/public/execution-report.html`

**Context:** The execution report has a "Save as HTML" feature (line ~1349) that clones the DOM and strips interactive elements. The old trace button was an `<a>` tag that was handled. The new trace button is a `<button>` with an `onclick` — it needs to be disabled in the saved export.

- [ ] **Step 1: Find the export clone logic**

```bash
grep -n "clone\|tc-btn-tr\|querySelectorAll.*btn" src/ui/public/execution-report.html | head -20
```

- [ ] **Step 2: Update the export clone to disable trace buttons**

Find the block around line 1349 that handles `a.tc-btn-tr[data-tpath]`. Add handling for the new button trace elements. Look for:

```javascript
clone.querySelectorAll('a.tc-btn-tr[data-tpath]').forEach(a => {
  const sp = document.createElement('button');
  sp.className = 'tc-btn tc-btn-tr tc-btn-inactive'; sp.disabled = true;
```

Add after that block:

```javascript
clone.querySelectorAll('button.tc-btn-tr').forEach(btn => {
  btn.disabled = true;
  btn.removeAttribute('onclick');
  btn.classList.add('tc-btn-inactive');
  btn.title = 'Trace viewer not available in saved report';
});
```

- [ ] **Step 3: Verify export still works**

In the browser, click "Save as HTML" on a run report. Open the saved file locally (file:// URL). Verify trace buttons are disabled and no JS errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/public/execution-report.html
git commit -m "fix: disable trace buttons in saved HTML export"
```

---

## Task 8: Manual Testing + CLAUDE.md Update

**Files:**
- Read/verify: `src/ui/public/execution-report.html`, `src/ui/server.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run through the manual test checklist**

Trigger a suite run that has at least one retried test (so a trace is generated). Then verify each scenario:

| # | How to test | Expected |
|---|---|---|
| 1 | Check a passing first-run test | No `[Trace]` in table. Expanded: "Not captured — passed on first run" |
| 2 | Check a retried/failed test | `[Trace]` button in table. Click → modal opens → viewer loads |
| 3 | `rm test-results/<runId>/<dir>/trace.zip` manually | Click Trace → preflight 404 → modal: "Trace artifact not found" |
| 4 | Test path traversal: `curl -s http://localhost:3003/api/trace/../../etc/passwd/TID_x` | 400 or 404, no path in response |
| 5 | Test HEAD: `curl -s -I http://localhost:3003/api/trace/badrun/TID_x` | `X-Error-Code: RUN_NOT_FOUND` header |
| 6 | Close modal while trace loading | No error in server.log. `tail -5 server.log` shows clean output. |
| 7 | Run `npm run setup:trace-viewer` again | Script logs version, completes without error |

- [ ] **Step 2: Update CLAUDE.md — change Trace Viewer status**

In `CLAUDE.md`, find the `## TRACE VIEWER` section. Update `Status` line:

```
**Status:** COMPLETE — shipped 2026-04-27
```

Add to the doc pointers section:

```
> **📋 See [docs/superpowers/plans/2026-04-27-trace-viewer.md](docs/superpowers/plans/2026-04-27-trace-viewer.md) — Trace Viewer 8-task implementation plan. ALL TASKS COMPLETE (2026-04-27).**
```

Also add to the Superpowers Commands table:

```
| `implement trace viewer` or `execute the trace viewer plan` | Load `docs/superpowers/plans/2026-04-27-trace-viewer.md` — **ALREADY COMPLETE as of 2026-04-27** |
```

- [ ] **Step 3: Commit everything**

```bash
cd "e:/AI Agent/qa-agent-platform-dev"
git add CLAUDE.md
git commit -m "docs: mark trace viewer complete, update CLAUDE.md"
```

- [ ] **Step 4: Promote to prod**

Only when user explicitly says "promote" or "push to prod". Follow the standard promote procedure in CLAUDE.md.
