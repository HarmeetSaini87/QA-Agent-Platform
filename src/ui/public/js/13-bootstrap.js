// ══════════════════════════════════════════════════════════════════════════════
// Bootstrap on DOMContentLoaded
// ══════════════════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', async () => {
  // Load keyword registry early (non-blocking)
  keywordsLoad();

  await authBootstrap();

  // Wrap switchTab AFTER app.js has set its final version (runtime, not hoist-time)
  const _appSwitchTab = switchTab;
  switchTab = function (tab) {
    _appSwitchTab(tab);
    onModuleTabSwitch(tab);
    _guardCheck(tab);   // enforce project selection on every tab switch
    // Stop polling active debug sessions when leaving the scripts tab
    if (tab !== 'scripts') _debugSessionsPollStop();
  };

  // Re-bind nav-item clicks so new wrapper is used
  document.querySelectorAll('.nav-item').forEach(item =>
    item.addEventListener('click', () => switchTab(item.dataset.tab))
  );

  // Pre-load locators for the inline picker
  locatorLoad();
});
