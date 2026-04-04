/**
 * pom.patcher.ts
 *
 * Batch POM patcher — reads all confirmed heal files from `results/heals/`
 * and applies every patch that has `confirmed: true` and `shouldPatch: true`.
 *
 * Used by:
 *   - scripts/heal-run.ts (post-run CLI)
 *   - Directly by BasePage when auto-patch mode is enabled
 *
 * Each heal file has the structure written by healer.agent.ts:
 *   {
 *     confirmed: boolean,
 *     heuristicResult: HealResponse,
 *     request: { ... }
 *   }
 */

import * as fs   from 'fs';
import * as path from 'path';
import { applyPatch } from './healer.agent';
import { logger } from '../utils/logger';

export interface PatchSummary {
  total:    number;
  applied:  number;
  skipped:  number;
  failed:   number;
  details:  PatchDetail[];
}

export interface PatchDetail {
  healFile:   string;
  pomFile:    string;
  selector:   string;
  healed:     string;
  result:     'applied' | 'skipped' | 'failed';
  reason?:    string;
}

/**
 * Scan `results/heals/` for confirmed heal files and apply patches.
 * Returns a summary of what happened.
 */
export function batchApplyPatches(healsDir = path.resolve('results', 'heals')): PatchSummary {
  const summary: PatchSummary = { total: 0, applied: 0, skipped: 0, failed: 0, details: [] };

  if (!fs.existsSync(healsDir)) {
    logger.info('Patcher: no heals directory found — nothing to patch');
    return summary;
  }

  const files = fs.readdirSync(healsDir).filter(f => f.endsWith('.json'));
  summary.total = files.length;

  for (const file of files) {
    const filePath = path.join(healsDir, file);
    let payload: any;

    try {
      payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (e) {
      logger.warn(`Patcher: failed to parse ${file}: ${(e as Error).message}`);
      summary.failed++;
      summary.details.push({ healFile: file, pomFile: '', selector: '', healed: '', result: 'failed', reason: 'JSON parse error' });
      continue;
    }

    const heal = payload.heuristicResult;
    const detail: PatchDetail = {
      healFile:  file,
      pomFile:   heal?.patchInstruction?.pomFile ?? '',
      selector:  heal?.originalSelector ?? '',
      healed:    heal?.healedSelector ?? '',
      result:    'skipped',
    };

    if (!payload.confirmed) {
      detail.reason = 'not confirmed — set confirmed:true in the heal file';
      summary.skipped++;
      summary.details.push(detail);
      continue;
    }

    if (!heal?.shouldPatch || !heal?.patchInstruction) {
      detail.reason = heal?.shouldPatch === false ? 'shouldPatch is false' : 'no patch instruction';
      summary.skipped++;
      summary.details.push(detail);
      continue;
    }

    const ok = applyPatch(heal.patchInstruction);
    if (ok) {
      detail.result = 'applied';
      summary.applied++;
      // Mark the heal file as patched so it isn't applied again
      payload.patched = true;
      payload.patchedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } else {
      detail.result = 'failed';
      detail.reason = 'line not found in POM file (may already be patched or file changed)';
      summary.failed++;
    }
    summary.details.push(detail);
  }

  return summary;
}
