/**
 * modules.js
 * Admin Panel, Projects, Locator Repo, Common Functions, Auth check/logout
 * Loaded after app.js in index.html
 */
'use strict';

function _escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

