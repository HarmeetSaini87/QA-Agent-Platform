/**
 * test-orchestrator.ts
 * Tests all 3 input paths through the plan orchestrator.
 * No real Jira connection needed — Jira path is tested via orchestrateFromRequirementDoc.
 *
 * Run: npx tsx scripts/test-orchestrator.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as XLSX from 'xlsx';
import * as dotenv from 'dotenv';
import {
  orchestrateFromExcel,
  orchestrateFromPrd,
  orchestrateFromRequirementDoc,
} from '../src/utils/planOrchestrator';
import { parseAcceptanceCriteria } from '../src/utils/acParser';
import { TestPlan } from '../src/types/plan.types';

dotenv.config();

const TMP = path.join(os.tmpdir(), 'qa-agent-orch-test');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ✔ ${label}`);
    passed++;
  } else {
    console.error(`  ✘ ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function assertPlan(label: string, plan: TestPlan, checks: {
  minTestCases?: number;
  source?: string;
  hasSteps?: boolean;
  hasTestData?: boolean;
}) {
  assert(`${label}: plan has planId`, !!plan.planId);
  assert(`${label}: plan has createdAt`, !!plan.createdAt);
  assert(`${label}: plan has appBaseURL`, plan.appBaseURL !== undefined);
  if (checks.minTestCases !== undefined) {
    assert(`${label}: at least ${checks.minTestCases} test case(s)`,
      plan.testCases.length >= checks.minTestCases,
      `got ${plan.testCases.length}`);
  }
  if (checks.source) {
    assert(`${label}: source = "${checks.source}"`, plan.source === checks.source);
  }
  if (checks.hasSteps) {
    const allHaveSteps = plan.testCases.every(tc => tc.steps.length > 0);
    assert(`${label}: all test cases have steps`, allHaveSteps);
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Excel file with 2 test cases
const xlsxPath = path.join(TMP, 'test-cases.xlsx');
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb,
  XLSX.utils.aoa_to_sheet([
    ['TC ID', 'Title', 'Module', 'Priority', 'Preconditions',
     'Step 1', 'Step 2', 'Step 3', 'Expected Result', 'Tags', 'Username', 'Password'],
    ['TC_001', 'Login and view dashboard', 'Auth', 'high', 'App is running',
     'Navigate to /login', 'Enter credentials and click Login', 'Verify dashboard visible',
     'Dashboard is shown', 'smoke', 'admin@test.com', 'Pass@123'],
    ['TC_002', 'Add gateway config', 'Gateway', 'medium', 'User is logged in',
     'Navigate to Gateway Config', 'Click Add', 'Fill form and save',
     'Record appears in list', 'regression', '', ''],
  ]),
  'Test Cases'
);
XLSX.writeFile(wb, xlsxPath);

// PRD text file
const prdPath = path.join(TMP, 'requirements.txt');
fs.writeFileSync(prdPath,
  'Feature: Gateway Configuration Management\n\n' +
  'As an administrator, I want to manage gateway configurations.\n\n' +
  'Acceptance Criteria:\n' +
  '- The admin can add a new gateway config with required fields\n' +
  '- The admin can delete a gateway config with confirmation\n' +
  '- A success message is shown after each action\n'
);

// RequirementDoc with BDD acceptance criteria
const bddDoc = {
  source: 'jira' as const,
  sourceRef: 'TEST-42',
  summary: 'Gateway Config CRUD',
  description: 'Manage gateway configurations from the admin panel.',
  acceptanceCriteria:
    'Given I am on the Gateway list page\n' +
    'When I click Add and fill the form\n' +
    'Then the new record appears in the list\n\n' +
    'Given a record exists in the list\n' +
    'When I click Delete and confirm\n' +
    'Then the record is removed from the list',
  attachmentTexts: [],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n━━━ Plan Orchestrator Tests ━━━\n');

  // ── AC Parser ─────────────────────────────────────────────────────────────

  console.log('Test 1: AC Parser — BDD format');
  const bddScenarios = parseAcceptanceCriteria(bddDoc.acceptanceCriteria);
  assert('Parsed 2 BDD scenarios', bddScenarios.length === 2, `got ${bddScenarios.length}`);
  assert('First scenario isBDD', bddScenarios[0].isBDD);
  assert('First scenario has given', !!bddScenarios[0].given);
  assert('First scenario has when', !!bddScenarios[0].when);
  assert('First scenario has then', !!bddScenarios[0].then);
  assert('First title is generated', bddScenarios[0].suggestedTitle.length > 0);

  console.log('\nTest 2: AC Parser — bullet list format');
  const bulletAC = '- User can add a new record\n- User can delete with confirmation\n- Success message is shown';
  const bulletScenarios = parseAcceptanceCriteria(bulletAC);
  assert('Parsed 3 bullet scenarios', bulletScenarios.length === 3, `got ${bulletScenarios.length}`);
  assert('Not flagged as BDD', !bulletScenarios[0].isBDD);
  assert('Title does not start with -', !bulletScenarios[0].suggestedTitle.startsWith('-'));

  console.log('\nTest 3: AC Parser — empty input');
  const emptyScenarios = parseAcceptanceCriteria('');
  assert('Returns empty array for empty AC', emptyScenarios.length === 0);

  // ── Path A: Excel ─────────────────────────────────────────────────────────

  console.log('\nTest 4: Path A — orchestrateFromExcel');
  const excelResult = await orchestrateFromExcel(xlsxPath);
  assertPlan('Excel', excelResult.plan, { minTestCases: 2, source: 'excel', hasSteps: true });
  assert('Excel: not AI skeleton', !excelResult.summary.isAISkeleton);
  assert('Excel: plan file written', fs.existsSync(excelResult.planPath));
  assert('Excel: TC_001 has testData', Object.keys(excelResult.plan.testCases[0].testData ?? {}).length > 0);
  assert('Excel: source is excel', excelResult.source === 'excel');

  // Verify TC_001 test data keys
  const tc001 = excelResult.plan.testCases[0];
  assert('Excel: TC_001 has Username', 'Username' in (tc001.testData ?? {}));
  assert('Excel: TC_001 has Password', 'Password' in (tc001.testData ?? {}));

  // ── Path B: Jira (via RequirementDoc — no live API needed) ───────────────

  console.log('\nTest 5: Path B — orchestrateFromRequirementDoc (Jira/BDD)');
  const jiraResult = await orchestrateFromRequirementDoc(bddDoc, []);
  assertPlan('Jira', jiraResult.plan, { minTestCases: 2, source: 'jira', hasSteps: true });
  assert('Jira: is AI skeleton', jiraResult.summary.isAISkeleton);
  assert('Jira: plan file written', fs.existsSync(jiraResult.planPath));
  assert('Jira: sourceStoryId set', jiraResult.plan.testCases[0].sourceStoryId === 'TEST-42');
  assert('Jira: AI_CONTEXT step injected', jiraResult.plan.testCases[0].steps[0].description.includes('[AI_CONTEXT]'));

  // ── Path C: PRD upload ────────────────────────────────────────────────────

  console.log('\nTest 6: Path C — orchestrateFromPrd');
  const prdResult = await orchestrateFromPrd(prdPath);
  assertPlan('PRD', prdResult.plan, { minTestCases: 1, source: 'prd-upload', hasSteps: true });
  assert('PRD: is AI skeleton', prdResult.summary.isAISkeleton);
  assert('PRD: plan file written', fs.existsSync(prdResult.planPath));
  assert('PRD: requirementDocPath saved', !!prdResult.requirementDocPath && fs.existsSync(prdResult.requirementDocPath));

  // ── Plan file structure validation ────────────────────────────────────────

  console.log('\nTest 7: Generated plan file is valid JSON with correct schema');
  const rawPlan = JSON.parse(fs.readFileSync(excelResult.planPath, 'utf-8')) as TestPlan;
  assert('Plan has planId', !!rawPlan.planId);
  assert('Plan has testCases array', Array.isArray(rawPlan.testCases));
  assert('Each TC has id', rawPlan.testCases.every(tc => !!tc.id));
  assert('Each TC has steps array', rawPlan.testCases.every(tc => Array.isArray(tc.steps)));
  assert('Each step has stepNumber', rawPlan.testCases.every(tc =>
    tc.steps.every(s => typeof s.stepNumber === 'number')
  ));
  assert('Each step has action', rawPlan.testCases.every(tc =>
    tc.steps.every(s => typeof s.action === 'string')
  ));
  assert('Each step has description', rawPlan.testCases.every(tc =>
    tc.steps.every(s => typeof s.description === 'string')
  ));

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(50));
  console.log(`━━━ Results: ${passed} passed, ${failed} failed ━━━\n`);

  // Cleanup test plans written during test
  fs.rmSync(TMP, { recursive: true, force: true });
  // Remove test plan files from test-plans/ dir
  for (const result of [excelResult, jiraResult, prdResult]) {
    if (fs.existsSync(result.planPath)) fs.unlinkSync(result.planPath);
    if (result.requirementDocPath && fs.existsSync(result.requirementDocPath)) {
      fs.unlinkSync(result.requirementDocPath);
    }
  }

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test runner error:', err.message);
  process.exit(1);
});
