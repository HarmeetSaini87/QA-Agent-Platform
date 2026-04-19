# Debugger Improvements & Bug Fixes
**Date:** April 8, 2026  
**Status:** ✅ All issues resolved and tested

---

## Overview
This document tracks critical improvements made to the step-by-step debugger system, addressing four major issues:
1. Screenshot sync delays (20-40 seconds)
2. Orphaned Playwright processes
3. Modal UI styling
4. Process termination failures

---

## Issue 1: Screenshot Loading Delays (20-40 seconds)

### Root Cause
When the spec detected a new step, it would immediately broadcast the step data via WebSocket. However, the screenshot file hadn't been fully written to disk yet. The UI would attempt to fetch the image, receive 404s, and retry for 20-40 seconds until the file appeared.

### Solution
**File Existence Check Before Broadcast:**
- Added file existence verification in the Playwright spec before writing `pending.json`
- The spec now waits up to 5 seconds (polling every 50ms) for the screenshot file to exist on disk
- Only then does it signal the server via `pending.json`
- Server immediately broadcasts, and UI fetch succeeds on first try

### Changes Made
**File:** `src/utils/codegenGenerator.ts`
- **Step 0 (Navigation):** Added 5-second file existence check before writing pending.json (lines 578-579)
- **Regular Steps:** Modified `__debugPause()` function to wait for screenshot file before signaling server (line 537)

### Impact
- ✅ Screenshot appears immediately after step is detected
- ✅ No 404 retries or delays
- ✅ Network latency no longer impacts screenshot delivery
- ✅ UI button and screenshot now perfectly synchronized

---

## Issue 2: Orphaned Playwright Processes

### Root Cause
When users abandoned a debug session (hard refresh, tab close, navigate away, logout), the Playwright browser process would keep running indefinitely. It would wait at the 30-minute `__debugPause` timeout, consuming memory and holding a browser instance.

**Failure modes covered:**
- Hard refresh (Ctrl+R)
- Tab close / window close
- Navigate to different URL
- Browser logout
- Network loss / disconnect
- Browser crash

### Solution
**3-Part Orphan Cleanup System:**

#### Part 1: Beforeunload Beacon
- **File:** `src/ui/public/modules.js` (debugStart function)
- **Mechanism:** `window.beforeunload` listener sends `navigator.sendBeacon()` to `/api/debug/stop`
- **Advantage:** Fires even on hard refresh, tab close, navigate away (network-agnostic)
- **Code:** Attached when debugger overlay opens, sends session stop on page unload

#### Part 2: Enhanced Close Button
- **File:** `src/ui/public/modules.js` (debugClose function)
- **Change:** Added `_debugStopHeartbeat()` call before sending stop request
- **Purpose:** Ensures heartbeat polling is stopped, preventing false "alive" signals
- **Safety:** Uses existing `/api/debug/continue` endpoint (no new failure points)

#### Part 3: Server-Side Heartbeat Timeout
- **Files:** `src/ui/server.ts`
- **Mechanism:** 
  - Client pings `/api/debug/heartbeat/:sessionId` every 10 seconds
  - Server tracks `lastHeartbeat` timestamp on DebugSession
  - Monitor loop (every 10 seconds) checks all sessions
  - If no heartbeat for 30 seconds → kills process with SIGTERM
- **Fallback:** Catches cases where beacon/close button fail (network loss, crash)

### Changes Made

**Server-Side:**
1. **DebugSession Interface** (line 101): Added `lastHeartbeat: number` field
2. **POST /api/debug/heartbeat/:id** (lines 1454-1461): New endpoint to update heartbeat timestamp
3. **Session Initialization** (line 1351): Set `lastHeartbeat: Date.now()` on creation
4. **Heartbeat Monitor Loop** (lines 1738-1753): 10-second interval checking for 30-second timeout

**UI-Side:**
1. **Global Variables** (line 2868): Added `let _debugHeartbeatTimer`
2. **debugStart()** (lines 2960-2971): 
   - Attach beforeunload beacon listener
   - Call `_debugStartHeartbeat()` to begin polling
3. **Heartbeat Functions** (lines 2985-3002):
   - `_debugStartHeartbeat()` - starts 10-second polling
   - `_debugStopHeartbeat()` - clears interval
   - `_debugSendHeartbeat()` - posts to heartbeat endpoint
4. **debugClose()** (line 3106): Added `_debugStopHeartbeat()` call

### Impact
- ✅ Hard refresh → Process killed within 30 seconds
- ✅ Tab close → Process killed within 30 seconds
- ✅ Network loss → Process killed within 30 seconds
- ✅ Browser crash → Process killed within 30 seconds
- ✅ No orphaned processes consuming memory/resources

---

## Issue 3: Modal UI Styling

### Root Cause
The debug environment selection modal was using `class="modal-box"` in HTML, but the CSS file did not define `.modal-box`. This left the modal without proper styling (transparent background, shadow, etc.).

### Solution
Added `.modal-box` CSS class definition matching `.modal` styling.

### Changes Made
**File:** `src/ui/public/styles_addon.css` (after line 127)
```css
.modal-box {
  background: #fff; border-radius: 12px; box-shadow: 0 24px 64px rgba(0,0,0,.2);
  width: 100%; display: flex; flex-direction: column; animation: slideUp .2s ease;
}
```

### Impact
- ✅ Modal now displays with white background
- ✅ Proper shadow and rounded corners
- ✅ Smooth slide-up animation
- ✅ Professional appearance

---

## Issue 4: Playwright Browser Not Terminating

### Root Cause
When the UI clicked "Close" or "Stop", the server called `process.kill('SIGTERM')` on the Playwright Node process (PID 6140). However, the Chrome browser is a **child process** of that Node process. When the parent dies, the child wasn't being terminated properly, leaving Chrome running indefinitely.

### Solution
Use Windows `taskkill /F /T /PID` which:
- `/F` = Force kill
- `/T` = Kill entire **process tree** (all children)
- This ensures Chrome and all descendants are terminated

### Changes Made
**File:** `src/ui/server.ts` (lines 1428-1436)

**Before:**
```typescript
if (process.platform === 'win32') {
  require('child_process').execSync(`taskkill /F /PID ${session.proc.pid}`);
}
```

**After:**
```typescript
if (process.platform === 'win32') {
  require('child_process').execSync(`taskkill /F /T /PID ${session.proc.pid}`, { stdio: 'pipe' });
  logger.info(`[debug:stop] Killed process tree for session...`);
}
```

### Impact
- ✅ Chrome closes immediately when stop is called
- ✅ No orphaned browser windows
- ✅ All child processes terminated
- ✅ Resources freed immediately

---

## Testing Checklist

- [x] Screenshot appears immediately after step detection (no delays)
- [x] Step button and screenshot are in sync
- [x] Hard refresh closes browser within 30 seconds
- [x] Tab close closes browser within 30 seconds
- [x] Close button closes browser immediately
- [x] Beacon sends stop signal on page unload
- [x] Heartbeat polling starts when overlay opens
- [x] Heartbeat polling stops when overlay closes
- [x] Modal displays with proper styling
- [x] Environment dropdown functional
- [x] Process tree termination works (Chrome closes)
- [x] No orphaned processes after 2 minutes

---

## Debugging & Monitoring

### Server Logs to Watch
```
[debug:stop] Killed process tree for session XXXXX (PID: YYYY)
[dbg:heartbeat] No heartbeat for XXms — killing orphaned session
[debugger] Heartbeat polling started for session XXXXX
[debugger] debugClose: Sending stop request for session XXXXX
```

### Client Console to Watch
```
[debugger] beforeunload: sent stop beacon for session XXXXX
[debugger] Heartbeat polling started for session XXXXX
[debugger] debugClose: Sending stop request for session XXXXX
[debugger] debugClose: Stop request completed (200)
[debugger] Image onload fired - screenshot ready to display
```

### Server Resource Cleanup
- Monitor for orphaned `chrome.exe` processes
- Check for memory leaks in Node process
- Verify Playwright cleanup on unexpected closes

---

## Files Modified Summary

| File | Lines | Change Type | Impact |
|------|-------|------------|--------|
| `src/utils/codegenGenerator.ts` | 537-539, 578-579 | File sync check | Screenshot sync |
| `src/ui/server.ts` | 101, 1351, 1428-1436, 1454-1461, 1738-1753 | Heartbeat system + kill tree | Orphan cleanup, process termination |
| `src/ui/public/modules.js` | 2868, 2960-2971, 2985-3002, 3106 | UI cleanup system | Beacon, polling, close handler |
| `src/ui/public/styles_addon.css` | 128-130 | Modal styling | UI fix |

---

## Performance Improvements

| Metric | Before | After |
|--------|--------|-------|
| Screenshot load time | 20-40 seconds | <2 seconds |
| Process cleanup time | Never (orphaned) | 30 seconds max |
| Browser termination | Fails silently | Immediate |
| Modal appearance | Broken styling | Professional |

---

## Backward Compatibility
✅ All changes are backward compatible. No breaking changes to API contracts or data models.

---

---

# Round 2 — Debugger Speed & Intelligence Improvements
**Date:** April 8, 2026  
**Status:** ✅ All issues resolved and tested

---

## Overview
Second round of improvements focused on screenshot rendering speed, visual element highlighting, Common Function expansion in debug mode, and DOM-state-driven settle logic (replacing all static waits).

---

## Improvement 1: JPEG Screenshots + SSE Inline Delivery (5× faster rendering)

### Problem
PNG screenshots were large (300-800 KB). Server polled `pending.json` every 400ms. UI fetched screenshot via a separate HTTP request after receiving the step signal — adding one extra network round-trip.

### Solution
Three compounding changes:
1. **JPEG quality 80** — replaced all `type: 'png'` with `type: 'jpeg', quality: 80` → ~5× smaller files
2. **Server-Sent Events (SSE)** — replaced WebSocket for screenshot delivery. WebSocket was blocked by IIS reverse proxy on `qa-launchpad.local`. SSE uses plain HTTP — works through any proxy.
3. **Inline base64 in SSE payload** — server reads JPEG as base64 and embeds it directly in the SSE `debug:step` event. UI sets `img.src = data:image/jpeg;base64,...` directly — no separate HTTP fetch.
4. **100ms poller** — server `pending.json` poll reduced from 400ms → 100ms.

### Changes Made
**`src/utils/codegenGenerator.ts`:** All `page.screenshot()` calls → `type: 'jpeg', quality: 80`  
**`src/ui/server.ts`:** Added `debugSseClients` map, `sseSessionPush()`, `GET /api/debug/stream/:sessionId` SSE endpoint, poller interval 400ms → 100ms, base64 read + SSE push  
**`src/ui/public/modules.js`:** `_debugOpenSse()`, `_debugCloseSse()`, `_debugSetScreenshot()` fast-path for base64

### Impact
- ✅ Screenshot renders in <500ms from action (was 2-5s+ with WebSocket + HTTP fetch)
- ✅ Works through IIS reverse proxy (SSE vs WebSocket)
- ✅ No extra HTTP round-trip for image fetch

---

## Improvement 2: Color-Coded Element Highlighting

### Problem
Screenshots showed the full page with no visual indication of which element was about to be acted on.

### Solution
`__debugHighlight(page, locType, locVal, keyword)` injected before every screenshot. Uses Playwright's native locator API — works with all locator types (CSS, XPath, text, testid, role, label, placeholder). Color coded by action:

| Keyword | Colour | Hex |
|---------|--------|-----|
| CLICK | Red | `#ef4444` |
| FILL | Blue | `#3b82f6` |
| SELECT | Orange | `#f97316` |
| HOVER | Yellow | `#eab308` |
| ASSERT | Green | `#22c55e` |
| Other | Purple | `#8b5cf6` |

Previous highlight cleared before each new one via `[data-dbg-hl]` attribute tracking.

### Changes Made
**`src/utils/codegenGenerator.ts`:** Added `__debugHighlight()` helper function; called before every `page.screenshot()` in both regular and CALL FUNCTION sub-step blocks.

### Impact
- ✅ Target element instantly visible in every screenshot
- ✅ Color conveys action type at a glance
- ✅ Works with all locator types (CSS, XPath, text, role, etc.)
- ✅ No highlight artifacts — cleared before each step

---

## Improvement 3: Common Function Expansion in Debugger

### Problem
CALL FUNCTION steps executed as a single black-box block — no visibility into which sub-step was running, no per-sub-step screenshot or pause.

### Solution
When a step's keyword is `CALL FUNCTION`, the debug spec expands each child step into its own full debug block:
- `__debugHighlight` for the sub-step's locator
- Screenshot taken for the sub-step
- `__debugPause` with fractional step index (1.1, 1.2, 1.3 …)
- Sub-step action executed
- `__waitForPageSettle` after each sub-step

`fnStepValues` overrides (per-child-step value injections) are honoured — the same value resolution as suite runs.

### Changes Made
**`src/utils/codegenGenerator.ts`:** CALL FUNCTION branch in debug spec generation loop expanded to emit individual debug blocks per child step.

### Impact
- ✅ Full step-by-step visibility inside Common Functions
- ✅ Per-sub-step screenshot + pause + highlight
- ✅ Fractional step indices (1.1, 1.2 …) shown in UI step list
- ✅ Value overrides (fnStepValues) correctly applied

---

## Improvement 4: DOM-State Settle — MutationObserver + Spinner Detection

### Problem
Previous `__waitForPageSettle` used static `waitForLoadState('load')` + `waitForLoadState('networkidle')`. BillCall has background polling so `networkidle` never fires — each step added 15-30s of wait time. Replacing with a fixed shorter wait still caused spinner screenshots because:
- **Two-phase load pattern**: DOM settles briefly between navigation completing and data API call starting → screenshot captured during this gap
- **Navigation path**: `waitForLoadState('domcontentloaded')` fires before API-driven spinners appear

### Solution
Three-layer approach with zero static waits:

#### Layer 1 — MutationObserver (same-page actions)
Watches `document.documentElement` for any DOM change. After quiet period, checks for visible spinners before resolving:
- `INIT_MS = 200` — initial check for already-stable pages (fast for FILL/SELECT)
- `QUIET_MS = 300` — re-arm after any DOM mutation
- `SPINNER_MS = 500` — re-arm when spinner is still visible (handles two-phase load gap)
- `MAX_MS = 8000` — safety cap, always resolves

#### Layer 2 — Spinner detection (`hasVisibleSpinner`)
Checks element visibility using computed style + size guard:
```
[role="progressbar"], [aria-busy="true"], .fa-spin,
mat-spinner, mat-progress-spinner, mat-progress-bar,
[class*="spinner"], [class*="skeleton"], [class*="shimmer"],
[class*="spin"], [class*="loader"]
```
`offsetWidth/Height < 4` guard prevents false positives from hidden zero-size Angular elements.  
Excludes `[class*="loading"]` and `[class*="progress"]` — too broad, match normal Angular form/layout elements.

#### Layer 3 — Navigation catch path spinner check
When `page.evaluate` throws (URL-change navigation), the `.catch()` path now runs:
1. `waitForLoadState('domcontentloaded')` — page shell loaded
2. `waitForSelector('input, button')` — interactive elements present
3. `page.waitForFunction(hasVisibleSpinner === false, { timeout: 8s })` — no spinner

#### Final "DONE" pause
After all steps complete, the spec takes a final screenshot and calls `__debugPause(9999, 'DONE', ...)`. Browser stays open and paused — only closes when user clicks Continue or Stop in the debugger UI.

### Changes Made
**`src/utils/codegenGenerator.ts`:** Complete rewrite of `__waitForPageSettle()` + final DONE pause block added after step loop.

### Impact
- ✅ Zero static waits — all timing driven by DOM state
- ✅ Spinner screenshots eliminated (two-phase load handled)
- ✅ Navigation pages wait for data-loading spinner to clear
- ✅ FILL/SELECT steps resolve in ~200-300ms (no regression)
- ✅ Browser stays open after last step for final inspection

---

## Testing Checklist (Round 2)

- [x] JPEG screenshots render faster than PNG
- [x] SSE delivers screenshot inline (no HTTP fetch)
- [x] Screenshot renders in <500ms per step
- [x] Color highlight visible on target element in every screenshot
- [x] Highlight cleared between steps (no carry-over)
- [x] CALL FUNCTION shows sub-steps 1.1, 1.2 … with individual screenshots
- [x] FILL/SELECT steps resolve quickly (200-300ms, no spinner false-positives)
- [x] Navigation steps wait for API spinner to clear before screenshot
- [x] CLICK steps that open modals wait for modal spinner to clear
- [x] Browser stays open at final step — only closes on user action
- [x] 8s safety cap prevents infinite spinner wait

---

## Files Modified Summary (Round 2)

| File | Change |
|------|--------|
| `src/utils/codegenGenerator.ts` | JPEG screenshots, `__debugHighlight`, CALL FUNCTION expansion, `__waitForPageSettle` rewrite, DONE pause |
| `src/ui/server.ts` | SSE endpoint, `debugSseClients`, `sseSessionPush`, 100ms poller, base64 read |
| `src/ui/public/modules.js` | `_debugOpenSse`, `_debugCloseSse`, `_debugSetScreenshot` base64 fast-path |

---

## Future Improvements (Optional Backlog — Not Blocking)
- [ ] Add metrics/telemetry for cleanup success rate
- [ ] Implement graceful shutdown with retry logic
- [ ] Add admin UI to view active debug sessions and force-kill if needed
- [ ] Auto-cleanup for sessions older than 24 hours

---

## Status Summary (2026-04-19)
Both Round 1 and Round 2 are fully implemented and verified in `qa-agent-platform-dev`.  
All checklist items complete. Only the 4 optional backlog items above remain.
