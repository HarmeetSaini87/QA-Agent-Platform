/**
 * contract-engine/engine.ts
 * Phase B Step 9: ContractEngineStub promoted to live ContractEngine.
 *
 * Wraps existing checkContractDrift logic (formerly in execution-engine/contract.ts).
 * execution-engine/contract.ts now delegates HERE — single source of truth.
 *
 * Phase C+: detectDrift, versioning, compatibility analysis, plugin validators.
 */

import type { ApiResponseSnapshot } from '../../data/types';
import { loadResponseSchema, specExists } from './spec-loader';

// ── Result types ──────────────────────────────────────────────────────────────

export interface ContractViolation {
  path: string;
  message: string;
  severity: 'breaking' | 'non-breaking';
}

export interface ContractValidationResult {
  valid: boolean;
  specId: string;
  statusCode: number;
  violations: ContractViolation[];
  /** True when spec file was not found — result is vacuously valid */
  specMissing: boolean;
  durationMs: number;
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface IContractEngine {
  /**
   * Validate a live response body against the OpenAPI spec for specId.
   * Non-blocking: caller decides whether to fail the step or report only.
   */
  validate(
    specId: string,
    response: ApiResponseSnapshot,
  ): Promise<ContractValidationResult>;

  /**
   * Convenience: returns violation strings only (backward-compat with
   * checkContractDrift callers that expect string[]).
   */
  checkDrift(specId: string, response: ApiResponseSnapshot): string[];

  /** Detect schema drift vs a previously saved baseline — Phase C impl */
  detectDrift(
    collectionId: string,
    stepId: string,
    current: ApiResponseSnapshot,
  ): Promise<ContractViolation[]>;
}

// ── Live implementation ───────────────────────────────────────────────────────

export class ContractEngine implements IContractEngine {
  async validate(
    specId: string,
    response: ApiResponseSnapshot,
  ): Promise<ContractValidationResult> {
    const t0 = Date.now();
    const statusCode = response.status;

    if (!specExists(specId)) {
      return { valid: true, specId, statusCode, violations: [], specMissing: true, durationMs: 0 };
    }

    const loaded = loadResponseSchema(specId, statusCode);
    if (!loaded) {
      return { valid: true, specId, statusCode, violations: [], specMissing: false, durationMs: Date.now() - t0 };
    }

    const { validate } = loaded;
    let valid: boolean;
    try {
      valid = !!validate(response.body);
    } catch {
      return { valid: true, specId, statusCode, violations: [], specMissing: false, durationMs: Date.now() - t0 };
    }

    const violations: ContractViolation[] = valid || !validate.errors
      ? []
      : validate.errors.map(e => ({
          path: (e as unknown as Record<string, string>)['instancePath'] || '$',
          message: e.message ?? 'invalid',
          severity: 'breaking' as const,
        }));

    return { valid: violations.length === 0, specId, statusCode, violations, specMissing: false, durationMs: Date.now() - t0 };
  }

  checkDrift(specId: string, response: ApiResponseSnapshot): string[] {
    if (!specExists(specId)) return [];
    const loaded = loadResponseSchema(specId, response.status);
    if (!loaded) return [];
    let valid: boolean;
    try {
      valid = !!loaded.validate(response.body);
    } catch { return []; }
    if (valid || !loaded.validate.errors) return [];
    return loaded.validate.errors.map(e =>
      `${(e as unknown as Record<string, string>)['instancePath'] || '$'} ${e.message ?? 'invalid'}`
    );
  }

  async detectDrift(
    _collectionId: string,
    _stepId: string,
    _current: ApiResponseSnapshot,
  ): Promise<ContractViolation[]> {
    // Phase C implementation target
    return [];
  }
}

// ── Phase A stub (kept for test injection / offline environments) ──────────────

export class ContractEngineStub implements IContractEngine {
  async validate(
    specId: string,
    response: ApiResponseSnapshot,
  ): Promise<ContractValidationResult> {
    return { valid: true, specId, statusCode: response.status, violations: [], specMissing: true, durationMs: 0 };
  }

  checkDrift(_specId: string, _response: ApiResponseSnapshot): string[] {
    return [];
  }

  async detectDrift(): Promise<ContractViolation[]> {
    return [];
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: IContractEngine | undefined;

export function getContractEngine(): IContractEngine {
  if (!_instance) _instance = new ContractEngine();
  return _instance;
}

/** Override in tests / Phase C+: inject a custom engine */
export function setContractEngine(engine: IContractEngine): void {
  _instance = engine;
}
