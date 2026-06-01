/**
 * assertion.contract.ts
 * Contracts for the assertion engine.
 *
 * Mirrors existing ApiAssertion / ApiAssertionResult from types.ts.
 * Adds: AssertionOperator enum, severity model, batch result, field resolver model.
 * Existing ApiAssertion type is unchanged — these are additive contracts.
 */

import type { ApiAssertion, ApiAssertionResult, ApiResponseSnapshot } from '../../data/types';

// ── Operator enum ─────────────────────────────────────────────────────────────

/**
 * AssertionOperator — canonical enum for all supported operators.
 * Mirrors the string union on ApiAssertion.operator in data/types.ts.
 * Use this enum in new engine code; existing ApiAssertion.operator strings remain valid.
 */
export enum AssertionOperator {
  // Equality
  Equals            = 'equals',
  NotEquals         = 'notEquals',
  // String
  Contains          = 'contains',
  NotContains       = 'notContains',
  StartsWith        = 'startsWith',
  EndsWith          = 'endsWith',
  Matches           = 'matches',           // regex
  // Numeric comparison
  GreaterThan       = 'greaterThan',
  LessThan          = 'lessThan',
  GreaterThanOrEq   = 'greaterThanOrEqual',
  LessThanOrEq      = 'lessThanOrEqual',
  // Existence
  Exists            = 'exists',
  NotExists         = 'notExists',
  // Type / structure
  IsEmpty           = 'isEmpty',
  IsType            = 'isType',
  JsonSchemaValid   = 'jsonSchemaValid',
  // Array
  ArrayContains     = 'arrayContains',
  ArrayLength       = 'arrayLength',
}

// ── Severity ──────────────────────────────────────────────────────────────────

/**
 * AssertionSeverity — determines how a failure affects overall node status.
 *
 * critical/high → node status = 'failed', triggers onFailure policy
 * medium/low    → node status = 'degraded', execution continues
 * soft          → logged only, no status change
 */
export type AssertionSeverity = 'critical' | 'high' | 'medium' | 'low' | 'soft';

export const SEVERITY_BLOCKS_EXECUTION: Record<AssertionSeverity, boolean> = {
  critical: true,
  high:     true,
  medium:   false,
  low:      false,
  soft:     false,
};

// ── Field resolution model ────────────────────────────────────────────────────

/** How the assertion engine resolves a field path to an actual value */
export type AssertionFieldSource =
  | 'status'        // HTTP status code
  | 'responseTime'  // duration in ms
  | 'header'        // response header (prefix: 'header.<name>')
  | 'body'          // JSONPath into response body
  | 'bodyRaw';      // raw response body string

export interface AssertionFieldResolution {
  field: string;
  source: AssertionFieldSource;
  resolvedValue: unknown;
  resolutionError?: string;
}

// ── Assertion batch ───────────────────────────────────────────────────────────

export interface AssertionBatch {
  assertions: ApiAssertion[];
  response: ApiResponseSnapshot;
  stepId: string;
  stepName?: string;
}

export interface AssertionBatchResult {
  stepId: string;
  stepName?: string;
  results: ApiAssertionResult[];
  /** All assertions passed */
  passed: boolean;
  /** At least one failure but ALL failures are severity 'soft'|'low'|'medium' */
  degraded: boolean;
  /** At least one 'critical' or 'high' severity failure */
  criticalFailure: boolean;
  /** Counts by severity */
  summary: {
    total: number;
    passed: number;
    failed: number;
    bySeverity: Partial<Record<AssertionSeverity, { passed: number; failed: number }>>;
  };
}

// ── Engine contract ───────────────────────────────────────────────────────────

/** Contract for the assertion-engine module (Phase B implementation target) */
export interface IAssertionEngine {
  evaluate(batch: AssertionBatch): AssertionBatchResult;
  /** Resolve what value a field path produces against a response — for debugging */
  resolveField(field: string, response: ApiResponseSnapshot): AssertionFieldResolution;
}
