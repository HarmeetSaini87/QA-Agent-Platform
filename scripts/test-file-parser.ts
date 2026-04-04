/**
 * test-file-parser.ts
 * Creates sample files of each supported type, parses them,
 * and verifies the output — no real Jira connection needed.
 *
 * Run: npx tsx scripts/test-file-parser.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as XLSX from 'xlsx';
import { parseFile, parseFiles, combineIntoContext } from '../src/utils/fileParser';

const TMP = path.join(os.tmpdir(), 'qa-agent-parser-test');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✔ ${label}`);
    passed++;
  } else {
    console.error(`  ✘ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// ── Create sample files ───────────────────────────────────────────────────────

// Plain text
const txtPath = path.join(TMP, 'requirements.txt');
fs.writeFileSync(txtPath,
  'Feature: Gateway Configuration Management\n\n' +
  'Acceptance Criteria:\n' +
  '- User can add a new gateway config\n' +
  '- User can delete an existing record\n' +
  '- Confirmation dialog appears before deletion\n'
);

// Markdown
const mdPath = path.join(TMP, 'story.md');
fs.writeFileSync(mdPath,
  '## Story\nAs an admin, I want to manage gateway configs.\n\n' +
  '## Acceptance Criteria\n' +
  '- Given I am logged in, when I add a record, then it appears in the list.\n'
);

// CSV
const csvPath = path.join(TMP, 'test-cases.csv');
fs.writeFileSync(csvPath,
  'TC ID,Title,Priority,Step 1,Step 2,Expected Result\n' +
  'TC_001,Login test,high,Navigate to login page,Enter credentials,Dashboard visible\n' +
  'TC_002,Add record,medium,Click Add button,Fill form,Record appears in list\n'
);

// Excel (.xlsx)
const xlsxPath = path.join(TMP, 'test-cases.xlsx');
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([
  ['TC ID', 'Title', 'Priority', 'Step 1', 'Expected Result'],
  ['TC_001', 'Login flow', 'high', 'Navigate to /login', 'Dashboard visible'],
  ['TC_002', 'Add gateway', 'medium', 'Click Add button', 'Record in list'],
]);
XLSX.utils.book_append_sheet(wb, ws, 'Test Cases');
XLSX.writeFile(wb, xlsxPath);

// Image (PNG 1x1 pixel — just to test the image path handler)
const pngPath = path.join(TMP, 'screenshot.png');
// Minimal valid PNG: 1x1 transparent pixel
const pngBytes = Buffer.from(
  '89504e470d0a1a0a0000000d494844520000000100000001' +
  '0802000000907753de0000000c4944415408d7636860606000000006002' +
  'e98f0140000000049454e44ae426082', 'hex'
);
fs.writeFileSync(pngPath, pngBytes);

// ── Run tests ─────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n━━━ File Parser Tests ━━━\n');

  // Test 1: Plain text
  console.log('Test 1: Plain text (.txt)');
  const txt = await parseFile(txtPath);
  assert('No error', !txt.error);
  assert('Text extracted', txt.text.length > 0);
  assert('Contains "Gateway"', txt.text.includes('Gateway'));
  assert('Not flagged as image', !txt.isImage);

  // Test 2: Markdown
  console.log('\nTest 2: Markdown (.md)');
  const md = await parseFile(mdPath);
  assert('No error', !md.error);
  assert('Contains story text', md.text.includes('admin'));
  assert('Contains AC', md.text.includes('Acceptance Criteria'));

  // Test 3: CSV
  console.log('\nTest 3: CSV (.csv)');
  const csv = await parseFile(csvPath);
  assert('No error', !csv.error);
  assert('Text extracted', csv.text.length > 0);
  assert('Contains TC_001', csv.text.includes('TC_001'));
  assert('Contains headers', csv.text.includes('TC ID'));

  // Test 4: Excel
  console.log('\nTest 4: Excel (.xlsx)');
  const xl = await parseFile(xlsxPath);
  assert('No error', !xl.error);
  assert('Sheet count set', xl.sheetCount === 1);
  assert('Contains TC_001', xl.text.includes('TC_001'));
  assert('Contains sheet header', xl.text.includes('Test Cases'));

  // Test 5: Image
  console.log('\nTest 5: Image (.png)');
  const img = await parseFile(pngPath);
  assert('No error', !img.error, img.error ?? '');
  assert('Flagged as image', img.isImage);
  assert('Contains filename in text', img.text.includes('screenshot.png'));
  assert('Contains path', img.text.includes(TMP));

  // Test 6: Missing file
  console.log('\nTest 6: Missing file');
  const missing = await parseFile(path.join(TMP, 'nonexistent.pdf'));
  assert('Returns error gracefully', !!missing.error);
  assert('Text is empty', missing.text === '');

  // Test 7: Unsupported extension
  console.log('\nTest 7: Unsupported file type');
  const unknownPath = path.join(TMP, 'config.yaml');
  fs.writeFileSync(unknownPath, 'key: value\n');
  const unknown = await parseFile(unknownPath);
  assert('Returns error for unsupported type', !!unknown.error);

  // Test 8: combineIntoContext — multiple files
  console.log('\nTest 8: combineIntoContext (multiple files)');
  const allFiles = await parseFiles([txtPath, csvPath, xlsxPath, pngPath]);
  const ctx = combineIntoContext(allFiles);
  assert('fullText is non-empty', ctx.fullText.length > 0);
  assert('Image paths collected', ctx.imageFilePaths.length === 1);
  assert('No failed files', ctx.failedFiles.length === 0);
  assert('fullText contains all attachment headers', ctx.fullText.includes('=== ATTACHMENT:'));
  assert('fullText contains txt content', ctx.fullText.includes('Gateway Configuration'));
  assert('fullText contains csv content', ctx.fullText.includes('TC_001'));
  assert('fullText contains xlsx content', ctx.fullText.includes('Login flow'));

  console.log('\nContext preview (first 400 chars):');
  console.log('─'.repeat(60));
  console.log(ctx.fullText.slice(0, 400));

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log(`━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);

  // Cleanup
  fs.rmSync(TMP, { recursive: true, force: true });

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
