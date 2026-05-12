/**
 * assertion-engine/engine.ts
 * Phase B — LIVE IMPLEMENTATION.
 *
 * Wraps apiAssertions.ts under IAssertionEngine interface.
 * Also extracts the UI→engine field normalisation that was inline in apiRunner.ts.
 *
 * apiAssertions.ts STAYS IN PLACE — apiRunner.ts import unchanged.
 * Phase C consumers (workflow-engine) import from here, not from apiAssertions.ts.
 *
 * What moved here:
 *   evaluateAssertions()     → AssertionEngine.evaluate()          (was apiAssertions.ts)
 *   inline normalisation     → AssertionEngine.normalise()         (was apiRunner.ts ~lines 344-355)
 *   resolveField()           → AssertionEngine.resolveField()      (was apiAssertions.ts private)
 *
 * ASSERTION ORDERING RULE: assertions evaluate AFTER variable resolution and
 * extraction propagation — never before. The caller (apiRunner.ts / workflow-engine)
 * is responsible for this ordering. This engine just evaluates what it receives.
 */

import { evaluateAssertions } from '../../utils/apiAssertions';
import type {
  IAssertionEngine,
  AssertionBatch,
  AssertionBatchResult,
  AssertionFieldResolution,
  AssertionSeverity,
} from '../../shared-core/contracts/assertion.contract';
import type { ApiAssertion, ApiAssertionResult, ApiResponseSnapshot } from '../../data/types';
import { JSONPath } from 'jsonpath-plus';

// ── UI → engine field normalisation ──────────────────────────────────────────

/**
 * Normalise assertions from UI format to engine format.
 * UI stores { source, path } but apiAssertions.ts expects { field }.
 *
 * Mapping (extracted from apiRunner.ts ~lines 337-355):
 *   source=statusCode                  → field='status'
 *   source=responseTime                → field='responseTime'
 *   source=responseHeader + path='X'   → field='header.X'
 *   source=responseBody + path='$.x'   → field='$.x' (JSONPath)
 *   already has field                  → pass through unchanged
 *
 * Exported so it can be tested independently and used by workflow-engine.
 */
export function normaliseAssertions(assertions: ApiAssertion[]): ApiAssertion[] {
  type LooseAssertion = Record<string, unknown>;
  return assertions.map(a => {
    const la = a as unknown as LooseAssertion;
    if (la['field'] !== undefined) return a;  // already in engine format
    const src = (la['source'] as string) ?? '';
    const pth = (la['path'] as string) ?? '';
    let field: string;
    if (src === 'statusCode')          field = 'status';
    else if (src === 'responseTime')   field = 'responseTime';
    else if (src === 'responseHeader') field = `header.${pth}`;
    else                               field = pth || '$';
    return { ...a, field } as unknown as ApiAssertion;
  });
}

// ── Live implementation ───────────────────────────────────────────────────────

export class AssertionEngine implements IAssertionEngine {

  /**
   * Evaluate a batch of assertions against a response.
   * Normalises UI format → engine format before delegating to apiAssertions.ts.
   * Returns richer AssertionBatchResult with severity summary.
   */
  evaluate(batch: AssertionBatch): AssertionBatchResult {
    const normalised = normaliseAssertions(batch.assertions);
    const { results, stepStatus } = evaluateAssertions(normalised, batch.response);

    const summary: AssertionBatchResult['summary'] = {
      total: results.length,
      passed: results.filter(r => r.passed).length,
      failed: results.filter(r => !r.passed).length,
      bySeverity: {},
    };

    for (const r of results) {
      const sev = (batch.assertions[r.assertionIndex]?.severity ?? 'high') as AssertionSeverity;
      if (!summary.bySeverity[sev]) summary.bySeverity[sev] = { passed: 0, failed: 0 };
      if (r.passed) summary.bySeverity[sev]!.passed++;
      else summary.bySeverity[sev]!.failed++;
    }

    return {
      stepId: batch.stepId,
      stepName: batch.stepName,
      results,
      passed: stepStatus === 'passed',
      degraded: stepStatus === 'degraded',
      criticalFailure: stepStatus === 'failed',
      summary,
    };
  }

  /**
   * Resolve what value a field path produces — for debugging and Variable Explorer.
   * Extracted from apiAssertions.ts resolveField() (was private).
   */
  resolveField(field: string, response: ApiResponseSnapshot): AssertionFieldResolution {
    try {
      let resolvedValue: unknown;
      let source: AssertionFieldResolution['source'];

      if (field === 'status') {
        source = 'status';
        resolvedValue = response.status;
      } else if (field === 'responseTime') {
        source = 'responseTime';
        resolvedValue = response.durationMs;
      } else if (field.startsWith('header.')) {
        source = 'header';
        const name = field.slice(7).toLowerCase();
        const key = Object.keys(response.headers).find(k => k.toLowerCase() === name);
        resolvedValue = key ? response.headers[key] : undefined;
      } else {
        source = 'body';
        const path = field.startsWith('$') ? field : `$.${field}`;
        const results = JSONPath({ path, json: response.body as object });
        resolvedValue = results.length > 0 ? results[0] : undefined;
      }

      return { field, source, resolvedValue };
    } catch (e) {
      return {
        field,
        source: 'body',
        resolvedValue: undefined,
        resolutionError: e instanceof Error ? e.message : String(e),
      };
    }
  }
}

// ── Singleton accessor ────────────────────────────────────────────────────────

let _engine: IAssertionEngine = new AssertionEngine();

export function getAssertionEngine(): IAssertionEngine {
  return _engine;
}

export function setAssertionEngine(engine: IAssertionEngine): void {
  _engine = engine;
}

// ── Phase A stub (kept for import compat) ─────────────────────────────────────

export class AssertionEngineStub implements IAssertionEngine {
  evaluate(_batch: AssertionBatch): AssertionBatchResult {
    throw new Error('AssertionEngineStub: use AssertionEngine class instead');
  }
  resolveField(_field: string, _response: ApiResponseSnapshot): AssertionFieldResolution {
    throw new Error('AssertionEngineStub: use AssertionEngine class instead');
  }
}
