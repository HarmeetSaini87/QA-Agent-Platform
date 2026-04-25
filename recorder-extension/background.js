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

    case 'INJECT_DIALOG_PATCHER': {
      // Content script asks us to patch window.alert/confirm/prompt in the PAGE's
      // main world. We use chrome.scripting.executeScript({ world: 'MAIN' }) which
      // is CSP-safe — no inline script needed.
      const tabId   = sender.tab?.id;
      const frameId = sender.frameId ?? 0;
      if (!tabId) break;
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world:  'MAIN',
        func: () => {
          if (window.__qaDialogPatched) return;
          window.__qaDialogPatched = true;
          const _fire = (type, value, smartName) =>
            document.dispatchEvent(new CustomEvent('__qa_dialog', { detail: { type, value, smartName } }));
          const _alert   = window.alert.bind(window);
          const _confirm = window.confirm.bind(window);
          const _prompt  = window.prompt.bind(window);
          window.alert = function (msg) {
            _alert(msg);
            _fire('ACCEPT_ALERT', String(msg ?? ''), 'Alert Dialog');
          };
          window.confirm = function (msg) {
            const result = _confirm(msg);
            _fire(result ? 'ACCEPT_DIALOG' : 'DISMISS_DIALOG', String(msg ?? ''), 'Confirm Dialog');
            return result;
          };
          window.prompt = function (msg, def) {
            const result = _prompt(msg, def);
            if (result !== null) {
              _fire('HANDLE_PROMPT', String(result ?? ''), 'Prompt Dialog');
            } else {
              _fire('DISMISS_DIALOG', String(msg ?? ''), 'Prompt Dismissed');
            }
            return result;
          };
        },
      }).catch(err => console.warn('[QA Recorder] Dialog patcher injection failed:', err.message));
      break;
    }

    case 'INJECT_URL_PATCHER': {
      // Hook pushState/replaceState in the PAGE's main world so SPA navigations
      // fire a __qa_urlchange DOM event that the isolated content script can catch.
      const tabId   = sender.tab?.id;
      const frameId = sender.frameId ?? 0;
      if (!tabId) break;
      chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        world:  'MAIN',
        func: () => {
          if (window.__qaUrlPatched) return;
          window.__qaUrlPatched = true;
          const _fire = () =>
            document.dispatchEvent(new CustomEvent('__qa_urlchange'));
          const _push    = history.pushState.bind(history);
          const _replace = history.replaceState.bind(history);
          history.pushState = function (...args) {
            const r = _push(...args);
            _fire();
            return r;
          };
          history.replaceState = function (...args) {
            const r = _replace(...args);
            _fire();
            return r;
          };
        },
      }).catch(err => console.warn('[QA Recorder] URL patcher injection failed:', err.message));
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
