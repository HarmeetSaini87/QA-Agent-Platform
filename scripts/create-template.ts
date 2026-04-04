/**
 * create-template.ts
 * Generates the standard TC Excel template with sample rows.
 * Run once: npx tsx scripts/create-template.ts
 * Output: requirements/TC_Template.xlsx
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const OUTPUT_PATH = path.resolve('requirements/TC_Template.xlsx');

// ── Column definitions ────────────────────────────────────────────────────────
// First 5 + last 3 are fixed. Steps 1-12 are in the middle.
// Any extra columns the QA adds become testData automatically.

const FIXED_LEFT  = ['TC ID', 'Title', 'Module', 'Priority', 'Preconditions'];
const STEP_COLS   = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}`);
const FIXED_RIGHT = ['Expected Result', 'Tags'];

// Example test-data columns (QA adds as many as needed for their form fields)
const TESTDATA_COLS = ['Username', 'Password', 'Gateway Name', 'Gateway Type', 'Record Name'];

const HEADERS = [...FIXED_LEFT, ...STEP_COLS, 'Expected Result', ...TESTDATA_COLS, 'Tags'];

// ── Sample rows ───────────────────────────────────────────────────────────────

const SAMPLE_ROWS = [
  {
    'TC ID':          'TC_001',
    'Title':          'Add and delete a Gateway Config record',
    'Module':         'Mediation Config - Gateway Type',
    'Priority':       'high',
    'Preconditions':  'User has admin credentials. Application is accessible.',
    'Step 1':         'Navigate to the application login page',
    'Step 2':         'Enter username and password, then click the Login button',
    'Step 3':         'Navigate to Mediation Config > Gateway Type (list page should open)',
    'Step 4':         'Click the Add or + button to open the new record form',
    'Step 5':         'Fill in the Gateway Name field',
    'Step 6':         'Select Gateway Type from the dropdown',
    'Step 7':         'Click the Save button',
    'Step 8':         'Click the Back button to return to the list page',
    'Step 9':         'Search for the newly added record by Gateway Name',
    'Step 10':        'Click the Delete (bin) icon on the row matching the record',
    'Step 11':        'Click Yes on the confirmation popup',
    'Step 12':        'Verify the record is no longer visible in the list, then logout',
    'Expected Result':'Record is successfully created and then deleted. Record does not appear in the list after deletion. User is logged out.',
    'Tags':           'smoke,regression',
    'Username':       'admin@company.com',
    'Password':       'Admin@1234',
    'Gateway Name':   'Auto-GW-TC001-01',
    'Gateway Type':   'HTTP',
    'Record Name':    'Auto-GW-TC001-01',
  },
  {
    'TC ID':          'TC_002',
    'Title':          'Verify login with invalid credentials',
    'Module':         'Authentication',
    'Priority':       'high',
    'Preconditions':  'Application login page is accessible.',
    'Step 1':         'Navigate to the application login page',
    'Step 2':         'Enter an invalid username and password',
    'Step 3':         'Click the Login button',
    'Step 4':         'Verify an error message is displayed',
    'Step 5':         'Verify the user remains on the login page',
    'Step 6':         '',
    'Step 7':         '',
    'Step 8':         '',
    'Step 9':         '',
    'Step 10':        '',
    'Step 11':        '',
    'Step 12':        '',
    'Expected Result':'An error message "Invalid credentials" is shown. User is not redirected to the dashboard.',
    'Tags':           'smoke,negative',
    'Username':       'invalid@company.com',
    'Password':       'WrongPass123',
    'Gateway Name':   '',
    'Gateway Type':   '',
    'Record Name':    '',
  },
  {
    'TC ID':          'TC_003',
    'Title':          'Upload a configuration file via the upload field',
    'Module':         'Mediation Config - Gateway Type',
    'Priority':       'medium',
    'Preconditions':  'User is logged in. A valid config file exists at test-data/sample-config.xml.',
    'Step 1':         'Navigate to Mediation Config > Gateway Type list page',
    'Step 2':         'Click Add button',
    'Step 3':         'Fill in the Gateway Name',
    'Step 4':         'Upload the config file using the file upload field',
    'Step 5':         'Click Save',
    'Step 6':         'Verify success message appears',
    'Step 7':         'Navigate back to list page and verify record exists',
    'Step 8':         '',
    'Step 9':         '',
    'Step 10':        '',
    'Step 11':        '',
    'Step 12':        '',
    'Expected Result':'Record is created with the uploaded file. File name appears in the record details.',
    'Tags':           'regression',
    'Username':       'admin@company.com',
    'Password':       'Admin@1234',
    'Gateway Name':   'Auto-GW-TC003-Upload',
    'Gateway Type':   'FILE',
    'Record Name':    'Auto-GW-TC003-Upload',
  },
];

// ── Style helpers ─────────────────────────────────────────────────────────────

function buildWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: Test Cases ────────────────────────────────────────────────────
  const tcWs = XLSX.utils.aoa_to_sheet([HEADERS]);

  // Append sample rows
  XLSX.utils.sheet_add_json(tcWs, SAMPLE_ROWS, {
    header: HEADERS,
    skipHeader: true,
    origin: 'A2',
  });

  // Column widths
  const colWidths: XLSX.ColInfo[] = [
    { wch: 10 },  // TC ID
    { wch: 40 },  // Title
    { wch: 30 },  // Module
    { wch: 10 },  // Priority
    { wch: 35 },  // Preconditions
    ...STEP_COLS.map(() => ({ wch: 45 })),
    { wch: 50 },  // Expected Result
    { wch: 25 },  // Username
    { wch: 20 },  // Password
    { wch: 25 },  // Gateway Name
    { wch: 20 },  // Gateway Type
    { wch: 25 },  // Record Name
    { wch: 25 },  // Tags
  ];
  tcWs['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, tcWs, 'Test Cases');

  // ── Sheet 2: Instructions ──────────────────────────────────────────────────
  const instructions = [
    ['QA Agent Platform — TC Template Instructions'],
    [''],
    ['REQUIRED COLUMNS (do not rename or delete these)'],
    ['Column',         'Required', 'Description'],
    ['TC ID',          'YES',      'Unique ID e.g. TC_001. Must be unique per row.'],
    ['Title',          'YES',      'Short descriptive name for the test case.'],
    ['Module',         'YES',      'Feature or module being tested.'],
    ['Priority',       'YES',      'high / medium / low'],
    ['Preconditions',  'NO',       'What must be true before this test runs.'],
    ['Step 1 – Step 12','YES',     'One plain English action per cell. Leave unused steps blank.'],
    ['Expected Result','YES',      'The final observable outcome after all steps.'],
    ['Tags',           'NO',       'Comma-separated: smoke,regression,negative etc.'],
    [''],
    ['TEST DATA COLUMNS (add as many as you need)'],
    ['Any column not in the list above is treated as test data for that row.'],
    ['Examples: Username, Password, Gateway Name, Gateway Type, Record Name, Email'],
    ['The column header becomes the field name in the test plan.'],
    [''],
    ['STEP WRITING GUIDE'],
    ['- Write steps in plain English. One action per cell.'],
    ['- Be specific: "Click the Save button" not just "Save"'],
    ['- For form fields: "Fill in the Gateway Name field" — the system uses the test data column.'],
    ['- For dropdowns: "Select HTTP from the Gateway Type dropdown"'],
    ['- For file uploads: "Upload the file using the config file upload button"'],
    ['- For verification: "Verify success message appears" or "Check that record is in the list"'],
    ['- Leave Step cells blank if not needed — do not write N/A or -'],
    [''],
    ['PRIORITY VALUES'],
    ['high   — P1/P0 tests, must run every sprint'],
    ['medium — Standard regression'],
    ['low    — Edge cases, run on release only'],
  ];

  const instrWs = XLSX.utils.aoa_to_sheet(instructions);
  instrWs['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions');

  return wb;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const dir = path.dirname(OUTPUT_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const wb = buildWorkbook();
XLSX.writeFile(wb, OUTPUT_PATH);

console.log(`✅ Template created: ${OUTPUT_PATH}`);
console.log(`   Sheets: "Test Cases" (${SAMPLE_ROWS.length} sample rows) + "Instructions"`);
console.log(`   Columns: ${HEADERS.length} total (${STEP_COLS.length} step columns + ${TESTDATA_COLS.length} test data columns)`);
