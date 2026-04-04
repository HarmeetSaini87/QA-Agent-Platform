/**
 * generate-plan.ts
 * Unified CLI for all 3 test plan input paths.
 *
 * Usage:
 *   npm run generate-plan -- --excel=requirements/TC_Template.xlsx
 *   npm run generate-plan -- --jira=PROJ-123
 *   npm run generate-plan -- --prd=requirements/my-prd.pdf
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  orchestrateFromExcel,
  orchestrateFromJira,
  orchestrateFromPrd,
  OrchestrateResult,
} from '../src/utils/planOrchestrator';
import { logger } from '../src/utils/logger';

dotenv.config();

// ── Args ──────────────────────────────────────────────────────────────────────

const excelArg = process.argv.find(a => a.startsWith('--excel='))?.split('=').slice(1).join('=');
const jiraArg  = process.argv.find(a => a.startsWith('--jira='))?.split('=').slice(1).join('=');
const prdArg   = process.argv.find(a => a.startsWith('--prd='))?.split('=').slice(1).join('=');

if (!excelArg && !jiraArg && !prdArg) {
  console.error('❌  Provide one of:');
  console.error('    --excel=requirements/TC_Template.xlsx');
  console.error('    --jira=PROJ-123');
  console.error('    --prd=requirements/my-prd.pdf');
  process.exit(1);
}

// ── Run ───────────────────────────────────────────────────────────────────────

function printResult(result: OrchestrateResult) {
  const { plan, planPath, requirementDocPath, summary } = result;

  console.log('\n' + '═'.repeat(62));
  console.log('✅  Plan Generated');
  console.log('─'.repeat(62));
  console.log(`Source        : ${plan.source} (${summary.sourceRef})`);
  console.log(`Plan ID       : ${plan.planId}`);
  console.log(`Plan file     : ${planPath}`);
  if (requirementDocPath) {
    console.log(`Req doc       : ${requirementDocPath}`);
  }
  console.log(`Test cases    : ${summary.testCaseCount}`);
  console.log(`Total steps   : ${summary.totalSteps}`);
  console.log(`AI skeleton   : ${summary.isAISkeleton ? 'Yes — AI enriches steps during execution' : 'No — full steps from Excel'}`);

  if (summary.imageFilePaths.length > 0) {
    console.log(`Images (${summary.imageFilePaths.length})   : AI will inspect visually`);
    summary.imageFilePaths.forEach(p => console.log(`    • ${p}`));
  }

  if (summary.warnings.length > 0) {
    console.log(`\n⚠  Warnings:`);
    summary.warnings.forEach(w => console.log(`   • ${w}`));
  }

  // Print test case table
  console.log('\nTest cases:');
  console.log('─'.repeat(62));
  console.log('ID'.padEnd(18) + 'Priority'.padEnd(10) + 'Steps'.padEnd(7) + 'Title');
  console.log('─'.repeat(62));
  for (const tc of plan.testCases) {
    const stepCount = tc.steps.filter(s => s.stepNumber > 0).length;
    console.log(
      tc.id.padEnd(18) +
      tc.priority.padEnd(10) +
      String(stepCount).padEnd(7) +
      tc.title.slice(0, 40)
    );
  }
  console.log('─'.repeat(62));

  console.log('\nNext step — open your AI IDE and say:');
  if (summary.isAISkeleton) {
    console.log(`  "Read the plan at ${path.basename(planPath)} and the requirement doc,`);
    console.log(`   then generate detailed test steps and run the tests."`);
  } else {
    console.log(`  "Run the test plan at test-plans/${path.basename(planPath)}"`);
  }
  console.log('═'.repeat(62) + '\n');
}

async function run() {
  logger.info('━━━ QA Agent Platform — Generate Plan ━━━');

  try {
    let result: OrchestrateResult;

    if (excelArg) {
      result = await orchestrateFromExcel(path.resolve(excelArg));
    } else if (jiraArg) {
      result = await orchestrateFromJira(jiraArg);
    } else {
      result = await orchestrateFromPrd(path.resolve(prdArg!));
    }

    printResult(result);

  } catch (err) {
    logger.error((err as Error).message);
    process.exit(1);
  }
}

run();
