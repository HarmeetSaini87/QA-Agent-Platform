/**
 * generate-report.ts
 *
 * Usage:
 *   npx tsx scripts/generate-report.ts                   ← generates report for the latest run
 *   npx tsx scripts/generate-report.ts <runId>           ← specific run
 *   npx tsx scripts/generate-report.ts --all             ← regenerate reports for all runs
 *
 * Or via npm:
 *   npm run generate-report
 *   npm run generate-report -- <runId>
 *   npm run generate-report -- --all
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

import { generateHtmlReport } from '../src/reporter/html.reporter';
import { RunResult, TestPlan } from '../src/types/plan.types';

const RESULTS_DIR = path.resolve(process.env.RESULTS_DIR  ?? './results');
const PLANS_DIR   = path.resolve(process.env.TEST_PLANS_DIR ?? './test-plans');
const REPORTS_DIR = path.resolve(process.env.REPORTS_DIR  ?? './reports');
const JIRA_URL    = process.env.JIRA_BASE_URL ?? '';

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadRunResult(runId: string): RunResult | null {
  const file = path.join(RESULTS_DIR, `run-${runId}.json`);
  if (!fs.existsSync(file)) { console.error(`Run file not found: ${file}`); return null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as RunResult; }
  catch (e) { console.error(`Failed to parse ${file}:`, (e as Error).message); return null; }
}

function loadTestPlan(planId: string): TestPlan | undefined {
  if (!planId || planId === 'unknown') return undefined;
  const file = path.join(PLANS_DIR, `${planId}-plan.json`);
  if (!fs.existsSync(file)) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as TestPlan; }
  catch { return undefined; }
}

function listRunIds(): string[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .map(f => f.slice(4, -5))
    .sort()
    .reverse();
}

function buildReport(runId: string): boolean {
  const result = loadRunResult(runId);
  if (!result) return false;

  const plan      = loadTestPlan(result.planId);
  const outPath   = path.join(REPORTS_DIR, `${runId}.html`);

  generateHtmlReport({
    outputPath: outPath,
    runResult:  result,
    testPlan:   plan,
    jiraBaseUrl: JIRA_URL || undefined,
  });

  console.log(`✔  Report written → ${outPath}`);
  return true;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args[0] === '--all') {
  const ids = listRunIds();
  if (ids.length === 0) { console.log('No run files found in', RESULTS_DIR); process.exit(0); }
  let ok = 0;
  for (const id of ids) { if (buildReport(id)) ok++; }
  console.log(`\nGenerated ${ok} / ${ids.length} reports → ${REPORTS_DIR}`);

} else if (args[0]) {
  if (!buildReport(args[0])) process.exit(1);

} else {
  // Latest run
  const ids = listRunIds();
  if (ids.length === 0) {
    console.error('No run files found in', RESULTS_DIR);
    console.error('Run tests first: npm test');
    process.exit(1);
  }
  if (!buildReport(ids[0])) process.exit(1);
}
