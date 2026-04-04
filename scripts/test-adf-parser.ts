/**
 * test-adf-parser.ts
 * Verifies the ADF → plain text converter and AC extractor
 * without needing a real Jira connection.
 *
 * Run: npx tsx scripts/test-adf-parser.ts
 */

import { adfToText, extractACFromDescription } from '../src/integrations/adf-to-text';
import { AdfDocument } from '../src/types/jira.types';

// ── Sample ADF — simulates a real Jira description ────────────────────────────

const sampleAdf: AdfDocument = {
  version: 1,
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Overview' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'As a ' },
        { type: 'text', text: 'system administrator', marks: [{ type: 'strong' }] },
        { type: 'text', text: ', I want to manage gateway configurations so that I can control routing behaviour.' },
      ],
    },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Acceptance Criteria' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Given I am on the Gateway Config list page, when I click Add, then the form opens.' }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Given I fill all required fields and click Save, then a success message appears and the record is in the list.' }],
          }],
        },
        {
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [{ type: 'text', text: 'Given a record exists, when I click Delete and confirm, then the record is removed from the list.' }],
          }],
        },
      ],
    },
  ],
};

// ── Run tests ─────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) {
    console.log(`  ✔ ${label}`);
    passed++;
  } else {
    console.error(`  ✘ ${label}`);
    failed++;
  }
}

console.log('\n━━━ ADF Parser Tests ━━━\n');

// Test 1: ADF → plain text conversion
console.log('Test 1: ADF to plain text');
const plainText = adfToText(sampleAdf);
assert('Output is a non-empty string', plainText.length > 0);
assert('Contains heading text "Overview"', plainText.includes('Overview'));
assert('Contains story text', plainText.includes('system administrator'));
assert('Contains AC heading', plainText.includes('Acceptance Criteria'));
assert('Contains bullet items', plainText.includes('Gateway Config'));
console.log('\n  Output preview:');
console.log('  ' + plainText.replace(/\n/g, '\n  ').slice(0, 300));

// Test 2: AC extraction from plain text
console.log('\nTest 2: AC extraction from description');
const { description, acceptanceCriteria } = extractACFromDescription(plainText);
assert('AC is extracted', acceptanceCriteria.length > 0);
assert('AC contains Given/When/Then', acceptanceCriteria.includes('Given'));
assert('Description still contains Overview', description.includes('Overview'));
assert('Description does not duplicate AC heading', !description.includes('Acceptance Criteria'));

// Test 3: Null/undefined handling
console.log('\nTest 3: Edge cases');
assert('null ADF returns empty string', adfToText(null) === '');
assert('undefined ADF returns empty string', adfToText(undefined) === '');
const emptyDoc: AdfDocument = { version: 1, type: 'doc', content: [] };
assert('Empty doc returns empty string', adfToText(emptyDoc) === '');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);
if (failed > 0) process.exit(1);
