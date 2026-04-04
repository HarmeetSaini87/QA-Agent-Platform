/**
 * excel-to-plan.ts
 * Converts an Excel or CSV test case file into a test-plan.json.
 *
 * Usage:
 *   npx tsx scripts/excel-to-plan.ts --file=requirements/TC_Template.xlsx
 *   npx tsx scripts/excel-to-plan.ts --file=requirements/my-tests.csv --out=test-plans/
 *
 * Output: test-plans/<filename>-plan.json
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { readExcelFile } from '../src/utils/excelReader';
import { buildTestPlan, writePlan } from '../src/utils/planWriter';
import { logger } from '../src/utils/logger';

dotenv.config();

// ── Argument parsing ──────────────────────────────────────────────────────────

function getArg(name: string): string | undefined {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=') : undefined;
}

const inputFile = getArg('file');
const outputDir = getArg('out') || './test-plans';

if (!inputFile) {
  console.error('❌ Error: --file argument is required');
  console.error('   Example: npx tsx scripts/excel-to-plan.ts --file=requirements/TC_Template.xlsx');
  process.exit(1);
}

const resolvedFile = path.resolve(inputFile);

// ── Run ───────────────────────────────────────────────────────────────────────

logger.info('━━━ Excel → Test Plan Converter ━━━');
logger.info(`Input : ${resolvedFile}`);
logger.info(`Output: ${path.resolve(outputDir)}`);

try {
  // Step 1: Read Excel file
  const doc = readExcelFile(resolvedFile);
  logger.info(`Read  : ${doc.rawRows?.length ?? 0} test case rows`);

  if (!doc.rawRows || doc.rawRows.length === 0) {
    logger.warn('No valid rows found. Check that the TC ID and Title columns are populated.');
    process.exit(1);
  }

  // Step 2: Print a preview table
  console.log('\nPreview of parsed test cases:');
  console.log('─'.repeat(70));
  console.log(
    'TC ID'.padEnd(12) +
    'Priority'.padEnd(10) +
    'Steps'.padEnd(8) +
    'Title'
  );
  console.log('─'.repeat(70));
  for (const row of doc.rawRows) {
    const stepCount = row.steps.filter(s => s.trim()).length;
    console.log(
      row.tcId.padEnd(12) +
      row.priority.padEnd(10) +
      String(stepCount).padEnd(8) +
      row.title.slice(0, 50)
    );
  }
  console.log('─'.repeat(70));

  // Step 3: Build plan
  const plan = buildTestPlan(doc);

  // Step 4: Write plan JSON
  const outputPath = writePlan(plan, path.resolve(outputDir));

  console.log(`\n✅ Plan written to: ${outputPath}`);
  console.log(`   Plan ID : ${plan.planId}`);
  console.log(`   Tests   : ${plan.testCases.length}`);
  console.log(`\nNext step: open the plan in your AI IDE and say:`);
  console.log(`  "Run the test plan at test-plans/${path.basename(outputPath)}"`);

} catch (err) {
  logger.error(`Failed: ${(err as Error).message}`);
  process.exit(1);
}
