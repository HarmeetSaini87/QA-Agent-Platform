/**
 * condition-evaluator.ts
 * Live implementation — Phase B Step 5 extraction from apiRunner.ts.
 *
 * evaluateCondition() moved here from src/utils/apiRunner.ts.
 * apiRunner.ts retains commented-out original per CLAUDE.md comment-out rule.
 *
 * vm sandbox boundary preserved exactly:
 *   - context is frozen — no mutation from user scripts
 *   - 100ms timeout prevents infinite loops
 *   - errors return false (safe default: skip step, not crash)
 */

import vm from 'node:vm';
import type { VariableMap } from '../../shared-core/contracts/variable.contract';

export interface IConditionEvaluator {
  /**
   * Evaluate a JS expression string against the variable context.
   * Returns false on any error — safe default (skip step rather than crash).
   */
  evaluate(condition: string, context: VariableMap): boolean;
}

// NODE TYPE GUARD (Gate 3):
// ConditionEvaluator evaluates JS expression strings — no nodeType awareness.
// The CALLER (WorkflowEngine) is responsible for the guard:
//
//   if (node.nodeType && node.nodeType !== 'HTTP') throw new Error(`Unsupported nodeType: ${node.nodeType}`);
//
// Never call evaluate() for non-HTTP nodes without first confirming node type.

// ── Live implementation ───────────────────────────────────────────────────────

export class ConditionEvaluator implements IConditionEvaluator {
  evaluate(condition: string, context: VariableMap): boolean {
    try {
      const sandbox = Object.freeze({ ...context });
      const ctx = vm.createContext(sandbox);
      return !!vm.runInContext(condition, ctx, { timeout: 100 });
    } catch {
      return false;
    }
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _evaluator: ConditionEvaluator | null = null;

export function getConditionEvaluator(): ConditionEvaluator {
  if (!_evaluator) _evaluator = new ConditionEvaluator();
  return _evaluator;
}
