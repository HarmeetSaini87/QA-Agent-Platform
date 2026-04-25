# QA Agent Recorder — Chrome Extension Installation

## One-time Setup (30 seconds)

1. Open Chrome and go to: `chrome://extensions`
2. Enable **Developer Mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `recorder-extension` folder from this project
5. The **QA Agent Recorder** extension appears in your toolbar

Pin it: click the puzzle icon (Extensions) → click the pin next to QA Agent Recorder.

---

## How to Record a Test Script

1. Open the **QA Agent Platform** and navigate to a Test Script in the editor
2. Click the **⬤ Record** button in the editor toolbar → the Recorder panel opens
3. Click the **QA Agent Recorder** extension icon in Chrome toolbar
4. Enter the platform URL (e.g. `http://qa-launchpad.local:3000`) — saved for future use
5. Select your **Project** and **Environment**
6. Click **⬤ Start Recording**
7. Navigate to your app and interact — every click, fill, select streams live into the editor
8. Click **⏹ Stop Recording** when done
9. Review and save the script in the editor

---

## Updating the Extension

When the platform is updated, reload the extension:
1. Go to `chrome://extensions`
2. Find QA Agent Recorder → click the refresh icon (↻)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Steps not streaming into editor | Verify platform URL in extension popup matches exactly (include port, e.g. `:3003`) |
| Extension icon greyed out | Must be on a non-`chrome://` page for the extension to activate |
| "Project not found" in popup | Ensure you are logged into the platform and a project exists |
| Recorded steps have wrong locators | Check locator enrichment — run self-healing enrichment for the target page first |

---

## How It Works (Technical)

The extension injects a content script that intercepts DOM events (click, fill, select, etc.) and POSTs them to the platform's `/api/recorder/event` endpoint via `recorderParser.ts`. The platform converts each event into a platform step object and broadcasts it to the open script editor via WebSocket.

Events flow: `Chrome page → content script → POST /api/recorder/event → recorderParser.ts → WebSocket → recorder.js (editor panel)`
