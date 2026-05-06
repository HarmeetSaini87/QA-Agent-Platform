#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, '..', 'src', 'ui', 'public', 'js');
const OUT_FILE = path.join(__dirname, '..', 'src', 'ui', 'public', 'modules.js');

const MANIFEST = [
  '00-header.js',
  '01-auth.js',
  '02-shared-helpers.js',
  '03-admin-users.js',
  '04-admin-settings.js',
  '05-projects.js',
  '06-locators.js',
  '07-functions.js',
  '08-tab-switch.js',
  '09-scripts.js',
  '10-suites.js',
  '11-execution.js',
  '12-flaky.js',
  '13-bootstrap.js',
  '14-run-history.js',
  '15-debugger.js',
  '16-recorder.js',
  '17-apikeys.js',
  '18-license.js',
  '19-analytics.js',
  '20-visual-regression.js',
  '21-locator-health.js',
  '22-jira.js',
  '23-api-envs.js',
  '24-api-collections.js',
  '25-api-runs.js',
];

function build() {
  const parts = [];
  for (const file of MANIFEST) {
    const filePath = path.join(SRC_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`Missing module: ${filePath}`);
      process.exit(1);
    }
    let content = fs.readFileSync(filePath, 'utf8');
    if (content.endsWith('\n')) content = content.slice(0, -1);
    parts.push(content);
  }
  const output = parts.join('\n') + '\n';
  fs.writeFileSync(OUT_FILE, output, 'utf8');
  const lines = output.split('\n').length;
  const kb = (Buffer.byteLength(output, 'utf8') / 1024).toFixed(1);
  console.log(`Built modules.js: ${lines} lines, ${kb} KB`);
}

function extract() {
  const srcPath = path.join(__dirname, '..', 'src', 'ui', 'public', 'modules.js.backup');
  if (!fs.existsSync(srcPath)) {
    console.error('modules.js.backup not found.');
    process.exit(1);
  }
  const full = fs.readFileSync(srcPath, 'utf8');
  // Remove trailing newline so split produces correct 1-indexed line count
  const trimmed = full.endsWith('\n') ? full.slice(0, -1) : full;
  const lines = trimmed.split('\n');

  // Line ranges are 1-indexed, inclusive. They must be contiguous (no gaps, no overlaps).
  // Each range covers lines start..end (both inclusive) from the original file.
  const ranges = [
    ['00-header.js',           1,    11],
    ['01-auth.js',            12,    69],
    ['02-shared-helpers.js',   70,   110],
    ['03-admin-users.js',     111,   229],
    ['04-admin-settings.js',  230,   455],
    ['05-projects.js',        456,   989],
    ['06-locators.js',       990,  1672],
    ['07-functions.js',      1673,  1951],
    ['08-tab-switch.js',     1952,  2106],
    ['09-scripts.js',        2107,  4100],
    ['10-suites.js',         4101,  4917],
    ['11-execution.js',      4918,  5567],
    ['12-flaky.js',          5568,  5953],
    ['13-bootstrap.js',      5954,  5981],
    ['14-run-history.js',    5982,  6458],
    ['15-debugger.js',       6459,  7280],
    ['16-recorder.js',       7281,  7839],
    ['17-apikeys.js',        7840,  8383],
    ['18-license.js',        8384,  8803],
    ['19-analytics.js',      8804,  8925],
    ['20-visual-regression.js', 8926, 9090],
    ['21-locator-health.js', 9091,  9158],
    ['22-jira.js',           9159,  9238],
  ];

  // Validate ranges cover all lines contiguously
  let expected = 1;
  for (const [, start, end] of ranges) {
    if (start !== expected) {
      console.error(`Gap or overlap at line ${expected}-${start}`);
      process.exit(1);
    }
    expected = end + 1;
  }
  if (expected - 1 !== lines.length) {
    console.error(`Range ends at ${expected - 1} but file has ${lines.length} lines`);
    process.exit(1);
  }

  if (!fs.existsSync(SRC_DIR)) fs.mkdirSync(SRC_DIR, { recursive: true });

  for (const [file, start, end] of ranges) {
    const content = lines.slice(start - 1, end).join('\n') + '\n';
    fs.writeFileSync(path.join(SRC_DIR, file), content, 'utf8');
    const len = content.split('\n').length - 1; // -1 for trailing newline
    console.log(`Extracted ${file}: lines ${start}-${end} (${len} lines)`);
  }
  console.log('\nExtraction complete. Run "node scripts/concat-modules.js build" to reassemble and verify.');
}

const cmd = process.argv[2] || 'build';
if (cmd === 'extract') extract();
else if (cmd === 'build') build();
else { console.log('Usage: node concat-modules.js [extract|build]'); process.exit(1); }