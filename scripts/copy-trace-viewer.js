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
} catch (e) { console.warn(`[copy-trace-viewer] Could not read playwright-core version: ${e.message}`); }

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
      try {
        fs.copyFileSync(srcPath, destPath, fs.constants.COPYFILE_FICLONE_FORCE);
      } catch (err) {
        if (err.code !== 'ENOTSUP') throw err;
        fs.copyFileSync(srcPath, destPath);
      }
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
