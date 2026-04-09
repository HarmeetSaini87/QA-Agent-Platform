/**
 * background.js — QA Agent Recorder Extension Service Worker
 *
 * Manages recording session state across popup opens/closes.
 * The popup is ephemeral (closes when user clicks away) — state lives here.
 *
 * State stored in chrome.storage.local:
 *   { token, platformOrigin, projectId, active, stepCount, tabId }
 */

// ── Message handler from popup and content script ────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    case 'GET_STATE':
      chrome.storage.local.get(['recorderState'], r => {
        sendResponse({ state: r.recorderState || null });
      });
      return true; // async

    case 'START_RECORDING': {
      const { token, platformOrigin, projectId, tabId } = msg;
      const state = { token, platformOrigin, projectId, tabId, active: true, stepCount: 0 };
      chrome.storage.local.set({ recorderState: state }, () => {
        // Inject content script into the target tab — allFrames:true covers
        // cross-origin iframes, nested frames, and window.open() popups.
        chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files:  ['content_script.js'],
        }).then(() => {
          // Send init message to all frames in the tab (main + all iframes)
          chrome.webNavigation?.getAllFrames({ tabId }, frames => {
            (frames || [{ frameId: 0 }]).forEach(frame => {
              chrome.tabs.sendMessage(tabId, { type: 'RECORDER_INIT', token, platformOrigin }, { frameId: frame.frameId }).catch(() => {});
            });
          }) ?? chrome.tabs.sendMessage(tabId, { type: 'RECORDER_INIT', token, platformOrigin });
          sendResponse({ success: true });
        }).catch(err => {
          sendResponse({ success: false, error: err.message });
        });
      });
      return true;
    }

    case 'STOP_RECORDING': {
      chrome.storage.local.get(['recorderState'], r => {
        const state = r.recorderState;
        if (state?.tabId) {
          // Tell content script to stop
          chrome.tabs.sendMessage(state.tabId, { type: 'RECORDER_STOP' }).catch(() => {});
        }
        chrome.storage.local.set({ recorderState: null });
        sendResponse({ success: true });
      });
      return true;
    }

    case 'STEP_CAPTURED': {
      // Content script notifies background that a step was posted
      chrome.storage.local.get(['recorderState'], r => {
        const state = r.recorderState;
        if (state) {
          state.stepCount = (state.stepCount || 0) + 1;
          chrome.storage.local.set({ recorderState: state });
          // Update extension badge with step count
          chrome.action.setBadgeText({ text: String(state.stepCount) });
          chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
        }
      });
      break;
    }

    case 'GET_CURRENT_TAB':
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        sendResponse({ tab: tabs[0] || null });
      });
      return true;
  }
});

// Clear badge when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
  chrome.storage.local.set({ recorderState: null });
});
