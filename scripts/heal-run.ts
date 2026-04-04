/**
 * heal-run.ts
 *
 * Post-run self-healing CLI.
 *
 * Usage:
 *   npx tsx scripts/heal-run.ts                  ← heal latest run
 *   npx tsx scripts/heal-run.ts <runId>           ← heal specific run
 *   npx tsx scripts/heal-run.ts --patch           ← apply all confirmed heal patches
 *   npx tsx scripts/heal-run.ts --patch --dry-run ← show what would be patched
 *
 * What it does
 * ────────────
 * 1. Reads the run result JSON from results/run-<id>.json
 * 2. For every failed step that has no heal event yet, attempts offline healing
 *    using the DOM snapshot stored in the step result (if available)
 * 3. Writes heal files to results/heals/
 * 4. Prints a summary table
 * 5. With --patch: calls batchApplyPatches() to update POM files
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

import { healSelector }     from '../src/agents/healer.agent';
import { batchApplyPatches } from '../src/agents/pom.patcher';
import { RunResult, StepResult, TestCaseResult } from '../src/types/plan.types';

const RESULTS_DIR = path.resolve(process.env.RESULTS_DIR ?? './results');

// ── Helpers ───────────────────────────────────────────────────────────────────

function listRunIds(): string[] {
  if (!fs.existsSync(RESULTS_DIR)) return [];
  return fs.readdirSync(RESULTS_DIR)
    .filter(f => f.startsWith('run-') && f.endsWith('.json'))
    .map(f => f.slice(4, -5))
    .sort()
    .reverse();
}

function loadRun(runId: string): RunResult | null {
  const file = path.join(RESULTS_DIR, `run-${runId}.json`);
  if (!fs.existsSync(file)) { console.error(`Not found: ${file}`); return null; }
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) as RunResult; }
  catch (e) { console.error('Parse error:', (e as Error).message); return null; }
}

// ── Main heal loop ────────────────────────────────────────────────────────────

async function healRun(runId: string): Promise<void> {
  const run = loadRun(runId);
  if (!run) process.exit(1);

  const failedSteps: Array<{ tc: TestCaseResult; step: StepResult }> = [];
  for (const tc of run.testResults) {
    for (const step of tc.steps) {
      if (step.status === 'fail' && !step.healEvent) {
        failedSteps.push({ tc, step });
      }
    }
  }

  if (failedSteps.length === 0) {
    console.log(`✔  No unhealed failed steps in run ${runId}`);
    return;
  }

  console.log(`\nRun: ${runId}  |  ${failedSteps.length} failed step(s) to analyse\n`);
  console.log('─'.repeat(72));

  let healed = 0;
  for (const { tc, step } of failedSteps) {
    // We need a DOM snapshot — it may be stored in the step or we skip
    const dom = (step as any).domSnapshot as string | undefined;
    if (!dom) {
      console.log(`  [${tc.testCaseId}] Step ${step.stepNumber}: no DOM snapshot — skipped`);
      continue;
    }

    const result = await healSelector({
      failedSelector:  (step as any).selector ?? step.description,
      stepDescription: step.description,
      stepAction:      (step as any).action ?? 'click',
      errorMessage:    step.errorMessage ?? 'unknown error',
      domSnapshot:     dom,
    });

    const icon = result.status === 'healed'  ? '✔' :
                 result.status === 'ambiguous' ? '?' : '✗';
    const conf = result.confidence.padEnd(6);

    console.log(
      `  ${icon} [${tc.testCaseId}] Step ${step.stepNumber} | ${conf} | ` +
      `"${result.originalSelector}" → "${result.healedSelector}"`
    );
    if (result.status !== 'failed') healed++;
  }

  console.log('─'.repeat(72));
  console.log(`\n  Healed: ${healed} / ${failedSteps.length} steps`);
  console.log(`  Heal files written → ${path.join(RESULTS_DIR, 'heals')}\n`);
  console.log('  To apply patches: npm run heal-run -- --patch\n');
}

// ── Patch mode ────────────────────────────────────────────────────────────────

function runPatch(dryRun: boolean): void {
  const healsDir = path.join(RESULTS_DIR, 'heals');

  if (dryRun) {
    console.log('\nDry-run mode — no files will be modified\n');
    if (!fs.existsSync(healsDir)) { console.log('No heals directory found.'); return; }
    const files = fs.readdirSync(healsDir).filter(f => f.endsWith('.json'));
    let confirmedCount = 0;
    for (const f of files) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(healsDir, f), 'utf-8'));
        if (p.confirmed && p.heuristicResult?.shouldPatch) {
          const h = p.heuristicResult;
          console.log(`  WOULD PATCH: ${path.basename(h.patchInstruction?.pomFile ?? '')} — "${h.originalSelector}" → "${h.healedSelector}"`);
          confirmedCount++;
        }
      } catch { /* skip */ }
    }
    if (confirmedCount === 0) console.log('  No confirmed patches found. Set confirmed:true in heal files.');
    return;
  }

  const summary = batchApplyPatches(healsDir);
  console.log(`\nPatch summary:`);
  console.log(`  Applied:  ${summary.applied}`);
  console.log(`  Skipped:  ${summary.skipped}`);
  console.log(`  Failed:   ${summary.failed}`);
  console.log(`  Total:    ${summary.total}\n`);

  for (const d of summary.details) {
    const icon = d.result === 'applied' ? '✔' : d.result === 'failed' ? '✗' : '·';
    console.log(`  ${icon} ${d.result.padEnd(8)} | ${path.basename(d.pomFile || '?')} | "${d.selector}" → "${d.healed}"${d.reason ? ` (${d.reason})` : ''}`);
  }
  console.log();
}

// ── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isPatch  = args.includes('--patch');
const isDryRun = args.includes('--dry-run');

if (isPatch) {
  runPatch(isDryRun);
} else {
  const runId = args.find(a => !a.startsWith('--')) ?? listRunIds()[0];
  if (!runId) {
    console.error('No run files found in', RESULTS_DIR);
    process.exit(1);
  }
  healRun(runId).catch(e => { console.error(e); process.exit(1); });
}
