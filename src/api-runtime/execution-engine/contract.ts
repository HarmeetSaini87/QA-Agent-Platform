/**
 * contract.ts — execution-engine bridge
 * Phase B Step 7: extracted checkContractDrift from apiRunner.ts.
 * Phase B Step 9: AJV logic promoted to contract-engine/engine.ts.
 *                 This file is now a thin delegation bridge.
 *
 * Phase C: this file may be removed once all callers import from contract-engine directly.
 * Kept per CLAUDE.md comment-out rule — remove only on explicit "clean up" instruction.
 */

// OLD (Phase B Step 7 — AJV logic formerly here, now in contract-engine/spec-loader.ts):
// import * as fs from 'fs';
// import * as path from 'path';
// import Ajv from 'ajv';
// const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
// const OA_SPECS_DIR = path.join(DATA_DIR, 'openapi-specs');
// const _ajv = new Ajv();
// export function checkContractDrift(response: ApiResponseSnapshot, specId: string): string[] {
//   const specPath = path.join(OA_SPECS_DIR, `${specId}.json`);
//   ... AJV compile + validate loop per operation/status ...
// }

import type { ApiResponseSnapshot } from '../../data/types';
import { getContractEngine } from '../contract-engine/engine';

/**
 * Validate response body against OpenAPI spec for given specId.
 * Returns array of violation strings (empty = valid or spec not found).
 * Non-blocking: caller decides whether to fail step or report only.
 *
 * Delegates to ContractEngine.checkDrift() — single source of truth in contract-engine/.
 */
export function checkContractDrift(response: ApiResponseSnapshot, specId: string): string[] {
  return getContractEngine().checkDrift(specId, response);
}
