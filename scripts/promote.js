#!/usr/bin/env node
/**
 * promote.js — Promote Dev → Prod
 *
 * Copies source files from qa-agent-platform-dev into qa-agent-platform (prod).
 * Run from inside the PROD project:  node scripts/promote.js
 *
 * What it does:
 *   1. Locate dev project sibling folder
 *   2. Build dev to confirm it compiles clean
 *   3. Show diff summary (changed files between dev/src and prod/src)
 *   4. Ask for confirmation
 *   5. Backup prod src/ with timestamp
 *   6. Copy src/, playwright.config.ts, tsconfig.json from dev → prod
 *   7. Detect package.json changes → prompt for npm install
 *   8. Build prod — auto-restore backup on failure
 */

'use strict';

const fs        = require('fs');
const path      = require('path');
const { execSync, spawnSync } = require('child_process');
const readline  = require('readline');

// ── Paths ──────────────────────────────────────────────────────────────────────
const PROD_ROOT = path.resolve(__dirname, '..');                     // this project
const DEV_ROOT  = path.resolve(PROD_ROOT, '..', 'qa-agent-platform-dev');

const FILES_TO_COPY  = ['playwright.config.ts', 'tsconfig.json'];
const DIRS_TO_COPY   = ['src'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function banner(msg) {
  console.log(`\n${'─'.repeat(60)}\n  ${msg}\n${'─'.repeat(60)}`);
}

function ok(msg)   { console.log(`  ✓ ${msg}`); }
function info(msg) { console.log(`  · ${msg}`); }
function warn(msg) { console.log(`  ⚠ ${msg}`); }
function fail(msg) { console.error(`  ✗ ${msg}`); }

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${question} `, answer => { rl.close(); resolve(answer.trim()); });
  });
}

function run(cmd, cwd, label) {
  info(`${label || cmd}`);
  const result = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}):\n${result.stderr || result.stdout || ''}`);
  }
  return result.stdout || '';
}

/** Recursively collect all files under dir, relative to dir */
function collectFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, base, out);
    else out.push(path.relative(base, full));
  }
  return out;
}

/** Copy a single file, creating parent dirs as needed */
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** Recursively copy a directory */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) { warn(`Source dir not found: ${src}`); return; }
  for (const rel of collectFiles(src)) {
    copyFile(path.join(src, rel), path.join(dest, rel));
  }
}

/** Recursively delete a directory */
function rmDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

/** Diff two directories — returns { added, changed, removed } as arrays of rel paths */
function diffDir(devDir, prodDir) {
  const devFiles  = new Set(collectFiles(devDir));
  const prodFiles = new Set(collectFiles(prodDir));

  const added   = [];
  const changed = [];
  const removed = [];

  for (const f of devFiles) {
    if (!prodFiles.has(f)) {
      added.push(f);
    } else {
      const dContent = fs.readFileSync(path.join(devDir,  f));
      const pContent = fs.readFileSync(path.join(prodDir, f));
      if (!dContent.equals(pContent)) changed.push(f);
    }
  }
  for (const f of prodFiles) {
    if (!devFiles.has(f)) removed.push(f);
  }

  return { added, changed, removed };
}

/** Compare two files — returns true if they differ */
function filesDiffer(a, b) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return fs.existsSync(a) !== fs.existsSync(b);
  return !fs.readFileSync(a).equals(fs.readFileSync(b));
}

/** Create a timestamped backup of prod src/ */
function backupProdSrc() {
  const ts     = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const bakDir = path.join(PROD_ROOT, `src.backup.${ts}`);
  copyDir(path.join(PROD_ROOT, 'src'), bakDir);
  return bakDir;
}

/** Restore backup over prod src/ */
function restoreBackup(bakDir) {
  warn('Restoring backup …');
  rmDir(path.join(PROD_ROOT, 'src'));
  fs.renameSync(bakDir, path.join(PROD_ROOT, 'src'));
  ok('Backup restored — prod is unchanged.');
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  banner('QA Agent Platform — Dev → Prod Promotion');

  // 1. Verify dev folder exists
  if (!fs.existsSync(DEV_ROOT)) {
    fail(`Dev project not found at: ${DEV_ROOT}`);
    fail('Create it first: copy prod folder → qa-agent-platform-dev, set its .env');
    process.exit(1);
  }
  ok(`Dev root  : ${DEV_ROOT}`);
  ok(`Prod root : ${PROD_ROOT}`);

  // 2. Build dev
  banner('Step 1 — Build dev (compile check)');
  try {
    run('npm run build', DEV_ROOT, 'npm run build (dev)');
    ok('Dev build succeeded.');
  } catch (e) {
    fail('Dev build FAILED — fix TypeScript errors in dev before promoting.');
    fail(e.message);
    process.exit(1);
  }

  // 3. Diff summary
  banner('Step 2 — Diff summary');

  const srcDiff = diffDir(path.join(DEV_ROOT, 'src'), path.join(PROD_ROOT, 'src'));
  let totalChanges = srcDiff.added.length + srcDiff.changed.length + srcDiff.removed.length;

  if (srcDiff.added.length)   { info(`Added   (${srcDiff.added.length}):`);   srcDiff.added.slice(0,20).forEach(f => console.log(`      + src/${f}`)); }
  if (srcDiff.changed.length) { info(`Changed (${srcDiff.changed.length}):`); srcDiff.changed.slice(0,20).forEach(f => console.log(`      ~ src/${f}`)); }
  if (srcDiff.removed.length) { info(`Removed (${srcDiff.removed.length}):`); srcDiff.removed.slice(0,20).forEach(f => console.log(`      - src/${f}`)); }

  for (const f of FILES_TO_COPY) {
    const devFile  = path.join(DEV_ROOT,  f);
    const prodFile = path.join(PROD_ROOT, f);
    if (filesDiffer(devFile, prodFile)) {
      info(`Changed : ${f}`);
      totalChanges++;
    }
  }

  const pkgChanged = filesDiffer(path.join(DEV_ROOT, 'package.json'), path.join(PROD_ROOT, 'package.json'));
  if (pkgChanged) {
    warn('package.json differs — npm install will be prompted after copy.');
    totalChanges++;
  }

  if (totalChanges === 0) {
    ok('No differences found — dev and prod are identical. Nothing to promote.');
    process.exit(0);
  }

  console.log(`\n  Total: ${totalChanges} change(s) to promote.`);

  // 4. Confirmation
  banner('Step 3 — Confirm promotion');
  const answer = await ask(`Promote ${totalChanges} change(s) from dev → prod? Type YES to continue:`);
  if (answer !== 'YES') {
    info('Promotion cancelled.');
    process.exit(0);
  }

  // 5. Backup prod src/
  banner('Step 4 — Backup prod src/');
  const bakDir = backupProdSrc();
  ok(`Backup created: ${path.basename(bakDir)}`);

  // 6. Copy files
  banner('Step 5 — Copy dev → prod');

  // Replace src/
  rmDir(path.join(PROD_ROOT, 'src'));
  copyDir(path.join(DEV_ROOT, 'src'), path.join(PROD_ROOT, 'src'));
  ok('src/ replaced');

  // Copy individual files
  for (const f of FILES_TO_COPY) {
    const devFile = path.join(DEV_ROOT, f);
    if (fs.existsSync(devFile)) {
      copyFile(devFile, path.join(PROD_ROOT, f));
      ok(`${f} copied`);
    }
  }

  // 7. package.json changes → npm install
  if (pkgChanged) {
    banner('Step 6 — package.json changed');
    info('Copying package.json …');
    copyFile(path.join(DEV_ROOT, 'package.json'), path.join(PROD_ROOT, 'package.json'));
    const npmAnswer = await ask('Run npm install in prod now? (yes/no):');
    if (npmAnswer.toLowerCase().startsWith('y')) {
      try {
        run('npm install', PROD_ROOT, 'npm install (prod)');
        ok('npm install completed.');
      } catch (e) {
        warn('npm install failed — you may need to run it manually.');
        warn(e.message);
      }
    } else {
      warn('Skipped. Remember to run npm install in prod before starting the server.');
    }
  }

  // 8. Build prod — restore backup on failure
  banner('Step 7 — Build prod');
  try {
    run('npm run build', PROD_ROOT, 'npm run build (prod)');
    ok('Prod build succeeded.');
  } catch (e) {
    fail('Prod build FAILED.');
    fail(e.message);
    restoreBackup(bakDir);
    fail('Promotion rolled back. Fix the issue in dev and try again.');
    process.exit(1);
  }

  // All done — clean up backup
  banner('Promotion complete');
  ok('All files copied and prod build verified.');

  const cleanAnswer = await ask('Delete backup folder? (yes/no):');
  if (cleanAnswer.toLowerCase().startsWith('y')) {
    rmDir(bakDir);
    ok('Backup deleted.');
  } else {
    info(`Backup kept at: ${bakDir}`);
  }

  console.log('\n  Prod is ready. Restart the prod server to apply changes.\n');
  console.log('    taskkill //F //PID <pid> && npm run ui\n');
}

main().catch(err => {
  fail(`Unexpected error: ${err.message}`);
  process.exit(1);
});
