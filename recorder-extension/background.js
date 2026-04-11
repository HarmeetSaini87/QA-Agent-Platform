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

    case 'POST_STEP': {
      // Content script cannot POST to HTTP platform from an HTTPS AUT page
      // (Mixed Content block). We proxy the request through the background
      // service worker which is not subject to mixed content restrictions.
      const { platformOrigin, token, payload } = msg;
      const body = Object.assign({ token }, payload);
      fetch(`${platformOrigin}/api/recorder/step`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      }).then(() => {
        // Update step count + badge
        chrome.storage.local.get(['recorderState'], r => {
          const state = r.recorderState;
          if (state) {
            state.stepCount = (state.stepCount || 0) + 1;
            chrome.storage.local.set({ recorderState: state });
            chrome.action.setBadgeText({ text: String(state.stepCount) });
            chrome.action.setBadgeBackgroundColor({ color: '#7c3aed' });
          }
        });
      }).catch(err => console.warn('[QA Recorder] POST_STEP failed:', err.message));
      break;
    }

    case 'STEP_CAPTURED': {
      // Legacy — kept for compatibility; actual counting now in POST_STEP
      chrome.storage.local.get(['recorderState'], r => {
        const state = r.recorderState;
        if (state) {
          state.stepCount = (state.stepCount || 0) + 1;
          chrome.storage.local.set({ recorderState: state });
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

// ── Re-inject content script on every page navigation while recording ────────
// When the AUT navigates (login redirect, SPA route, etc.) the content script
// context is destroyed. Re-inject automatically so recording continues.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  chrome.storage.local.get(['recorderState'], (r) => {
    const state = r.recorderState;
    if (!state?.active || state.tabId !== tabId) return;
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files:  ['content_script.js'],
    }).then(() => {
      // Notify all frames
      chrome.webNavigation?.getAllFrames({ tabId }, frames => {
        (frames || [{ frameId: 0 }]).forEach(frame => {
          chrome.tabs.sendMessage(tabId, { type: 'RECORDER_INIT', token: state.token, platformOrigin: state.platformOrigin }, { frameId: frame.frameId }).catch(() => {});
        });
      }) ?? chrome.tabs.sendMessage(tabId, { type: 'RECORDER_INIT', token: state.token, platformOrigin: state.platformOrigin }).catch(() => {});
    }).catch(() => {});
  });
});

// Clear badge when extension is installed/updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: '' });
  chrome.storage.local.set({ recorderState: null });
});
