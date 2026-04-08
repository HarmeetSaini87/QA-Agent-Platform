# Debugger Quick Reference Guide

## 🎯 What Works Now

### Screenshot Synchronization
- **Feature:** Step-by-step debugger with live screenshots
- **Behavior:** Screenshot loads in <2 seconds after step detected
- **Technical:** Spec waits for file to exist on disk before broadcasting
- **User sees:** Button and screenshot stay perfectly in sync

### Orphan Cleanup
- **Feature:** Automatic cleanup of abandoned debug sessions
- **Behavior:** Browser closes within 30 seconds if session abandoned
- **Triggers:**
  - Hard refresh (Ctrl+R)
  - Tab close
  - Navigate away
  - Network disconnect
  - Browser crash
- **Technical:** Combines beacon + heartbeat + timeout mechanisms

### Process Termination
- **Feature:** Browser closes immediately when Stop/Close clicked
- **Behavior:** Chrome window disappears instantly
- **Technical:** Uses `taskkill /F /T` to kill entire process tree

---

## 🐛 Common Issues & Diagnostics

### Issue: Browser Still Open After Close
**Symptom:** Clicked Close button, but Chrome window still visible

**Diagnosis Steps:**
1. Check server logs: `tail -20 server.log | grep debug:stop`
2. Look for: `[debug:stop] Killed process tree for session...`
3. If present → Process was killed → Browser should close in 5-10s
4. If absent → Close button click didn't reach server

**Fix:**
- Hard refresh browser (Ctrl+Shift+R)
- Try clicking Close again
- Check browser console for errors (F12 → Console)

### Issue: Screenshot Taking 20+ Seconds
**Symptom:** Step detected but screenshot takes forever to appear

**Diagnosis:**
1. Check browser console for `[debugger] Fetch response: 404`
2. Check server logs for screenshot file creation
3. Look for network latency (npm run ui log shows timing)

**Fix:**
- This should be fixed by file sync check
- If still happening, check disk I/O performance
- Verify Playwright is writing to E: drive, not C:

### Issue: WebSocket Connection Failed
**Symptom:** Console shows `websocket connection to 'ws://...' failed`

**Diagnosis:**
1. Check browser URL → should be `http://localhost:3000` OR `http://qa-launchpad.local`
2. Check server is listening: `curl http://localhost:3000`
3. Check if firewall blocking WebSocket

**Fix:**
- Hard refresh (Ctrl+Shift+R) to clear browser cache
- Verify server is running: `netstat -ano | findstr :3000`
- Check if reverse proxy (IIS) is configured properly

### Issue: Modal Not Displaying
**Symptom:** Click Debug → No environment modal appears

**Diagnosis:**
1. Check browser console for JavaScript errors
2. Check if modal HTML exists: inspect with F12 → Elements
3. Look for CSS styling missing

**Fix:**
- Hard refresh (Ctrl+Shift+R)
- If modal exists but no styling, browser cache issue
- Verify `.modal-box` CSS class exists in `styles_addon.css`

---

## 📋 Server Logs to Monitor

### Normal Startup
```
[2026-04-08 XX:XX:XX] info: QA Agent Platform UI → http://localhost:3000
[2026-04-08 XX:XX:XX] info: WebSocket → ws://localhost:3000/ws
```

### Debug Session Start
```
[generateDebugSpec] Wrote debug spec → E:\...\debug-XXXXXXXX.spec.ts
[dbg:XXXXXXXX] Running 1 test using 1 worker
[dbg:poller] Step 0 detected → broadcasting to UI
```

### Debug Session Stop (Healthy)
```
[debugger] debugClose: Sending stop request for session XXXXXXXX
[debug:stop] Killed process tree for session XXXXXXXX (PID: YYYY)
[debug:stop] Stopped session XXXXXXXX
[debug:continue] Wrote gate.json for XXXXXXXX with action 'stop'
```

### Heartbeat Cleanup (Fallback)
```
[dbg:heartbeat] No heartbeat for XXXXms — killing orphaned session XXXXXXXX
[debug:stop] Killed process group for session XXXXXXXX (PID: YYYY)
```

### Error Cases to Watch
```
[debug:stop] No process to kill for session XXXXXXXX (already dead?)
[debug:stop] FAILED to kill process for XXXXXXXX: Error message
```

---

## 🧪 Testing Checklist

**Before deploying changes:**
- [ ] Hard refresh browser works (Chrome closes within 30s)
- [ ] Tab close works (Chrome closes within 30s)  
- [ ] Click Close works (Chrome closes immediately)
- [ ] Screenshot appears in <2 seconds
- [ ] Button doesn't enable until screenshot visible
- [ ] Modal displays with styling
- [ ] No errors in browser console
- [ ] No errors in server logs
- [ ] No orphaned Chrome processes after test

---

## 🔧 Restart Server Procedure

```bash
# Build TypeScript
npm run build

# Find and kill existing server
netstat -ano | findstr :3000
taskkill /F /PID <PID>

# Start new server with logging to E: drive
cd e:/AI Agent/qa-agent-platform
npm run ui > server.log 2>&1 &

# Verify startup
curl http://localhost:3000
tail -5 server.log
```

---

## 📍 Key File Locations

| Purpose | File | Line Numbers |
|---------|------|--------------|
| Heartbeat endpoint | `src/ui/server.ts` | 1454-1461 |
| Process cleanup | `src/ui/server.ts` | 1424-1442 |
| Heartbeat monitor | `src/ui/server.ts` | 1738-1753 |
| Beforeunload beacon | `src/ui/public/modules.js` | 2960-2971 |
| Heartbeat polling | `src/ui/public/modules.js` | 2985-3002 |
| Close handler | `src/ui/public/modules.js` | 3104-3117 |
| Screenshot sync | `src/utils/codegenGenerator.ts` | 537-539, 578-579 |

---

## 🚨 Emergency Procedures

### Kill All Orphaned Browsers
```bash
taskkill /F /IM chrome.exe
taskkill /F /IM chromium.exe
```

### Clear All Debug Sessions
```bash
rm -rf debug-runs/*
rm -rf test-results/*
```

### Reset Server State
```bash
npm run build
taskkill /F /PID $(netstat -ano | findstr :3000 | awk '{print $NF}')
npm run ui > server.log 2>&1 &
sleep 3
curl http://localhost:3000
```

---

## 📞 Support

For issues not covered here, check:
1. [DEBUGGER_IMPROVEMENTS.md](DEBUGGER_IMPROVEMENTS.md) — Full technical details
2. [CHANGELOG_2026-04-08.md](../CHANGELOG_2026-04-08.md) — What changed and why
3. Server logs: `tail -100 server.log | grep -i "error\|fail\|debug"`
4. Browser console (F12) — JavaScript errors
5. Network tab (F12) — API/WebSocket failures
