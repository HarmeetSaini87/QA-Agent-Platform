/**
 * variable-engine/engine.ts
 * Phase B — LIVE IMPLEMENTATION.
 *
 * Wraps apiVariables.ts under IVariableEngine interface.
 * apiVariables.ts STAYS IN PLACE — apiRunner.ts imports are UNCHANGED.
 *
 * This module is the Phase B boundary layer. Phase C consumers (coordinator,
 * workflow-engine) import from here instead of from apiVariables.ts directly.
 *
 * LAZY RESOLUTION RULE (Gate 4 — mandatory):
 * Variables MUST be resolved at execution time (per-step), NOT pre-resolved at context build.
 *
 * CORRECT:   engine.substitute(template, context)  called inside executeStep per request
 * WRONG:     resolving all vars upfront then passing a pre-built flat map to the step
 *
 * Why this matters:
 *   - Chaining: step B extracts a variable → step C's template must see it → only works if
 *     resolution happens after step B's extractedVariables are merged into context
 *   - Dynamic values: {{$dynamic:uuid}}, {{$dynamic:timestamp}} generate new values each call —
 *     pre-resolving freezes them to a single value for all steps (wrong behavior)
 *   - Runtime extraction: extracted vars from step N appear in sharedContext before step N+1
 *     runs — only possible if substitution reads the live context at call time
 *
 * Variable scope hierarchy (MUST be preserved exactly):
 *   Global → Project → Environment → Collection → Workflow → Request → Runtime
 */

import {
  substituteVars,
  snapshotContext,
  mergeStepLocals,
  extractVariables,
  VariableConflictError,
  type VariableContext,
} from '../../utils/apiVariables';
import type {
  IVariableEngine,
  VariableMap,
  VariableResolutionResult,
  ScopedVariable,
  VariableExtractionSpec,
  VariableExtractionResult,
  RuntimeVariableState,
  VariableScope,
} from '../../shared-core/contracts/variable.contract';
import type { ApiVariableExtraction, ApiResponseSnapshot } from '../../data/types';

// Re-export for Phase C consumers who import from variable-engine
export { VariableConflictError };
export type { VariableContext };

// ── Live implementation — wraps apiVariables.ts ───────────────────────────────

export class VariableEngine implements IVariableEngine {

  /**
   * Resolve a flat VariableMap from ordered ScopedVariable list.
   * Scope order (lower = lower priority): global → project → environment →
   *   collection → workflow → request → runtime (runtime wins).
   * LAZY: call at wave start to produce snapshot — NOT at collection init.
   */
  resolve(scopes: ScopedVariable[]): VariableResolutionResult {
    const resolved: VariableMap = {};
    const sourceMap: Record<string, VariableScope> = {};
    const conflicts: VariableResolutionResult['conflicts'] = [];
    const unresolved: string[] = [];

    for (const sv of scopes) {
      const key = sv.key;
      if (Object.prototype.hasOwnProperty.call(resolved, key)) {
        conflicts.push({
          key,
          scopeA: sourceMap[key],
          scopeB: sv.scope,
          valueA: resolved[key],
          valueB: sv.value,
        });
      }
      resolved[key] = sv.value;
      sourceMap[key] = sv.scope;
    }

    // Detect unresolved template refs in values ({{missing}})
    for (const [, val] of Object.entries(resolved)) {
      const matches = val.matchAll(/\{\{([^}]+)\}\}|\$\{([^}]+)\}/g);
      for (const m of matches) {
        const ref = m[1] ?? m[2];
        if (ref && !ref.startsWith('$dynamic:') && !Object.prototype.hasOwnProperty.call(resolved, ref)) {
          if (!unresolved.includes(ref)) unresolved.push(ref);
        }
      }
    }

    return { resolved, unresolved, conflicts, sourceMap };
  }

  /**
   * Substitute {{var}} / ${var} templates.
   * LAZY: call per-field at execution time — NOT at context build time.
   * Delegates to apiVariables.substituteVars — unchanged behavior.
   */
  substitute(template: string, context: VariableMap): string {
    return substituteVars(template, context as VariableContext);
  }

  /**
   * Extract a single variable from a response snapshot.
   * Delegates to apiVariables.extractVariables — unchanged behavior.
   */
  extract(spec: VariableExtractionSpec, response: unknown): VariableExtractionResult {
    const apiResponse = response as ApiResponseSnapshot;
    const apiSpec: ApiVariableExtraction[] = [{
      name: spec.name,
      source: spec.source as ApiVariableExtraction['source'],
      path: spec.path ?? '',
      scope: 'step',   // default — extraction scope maps to step-level
    }];

    const extracted = extractVariables(apiSpec, apiResponse);
    const success = spec.name in extracted;

    return {
      spec,
      success,
      value: success ? extracted[spec.name] : undefined,
      error: success ? undefined : `No value found for ${spec.source}:${spec.path}`,
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * Snapshot context at wave boundary — returns immutable copy.
   * LAZY: call once per wave start, not once per collection run.
   * Delegates to apiVariables.snapshotContext.
   */
  snapshot(context: VariableMap, afterNodeId: string): RuntimeVariableState {
    const snap = snapshotContext(context as VariableContext) as VariableMap;
    return {
      capturedAt: new Date().toISOString(),
      afterNodeId,
      context: snap,
      extractedThisStep: [],
      changedKeys: [],
    };
  }

  /**
   * Merge overlay variables into base context.
   * policy='last-write-wins' matches current apiRunner.ts behavior.
   * Delegates to apiVariables.mergeStepLocals.
   */
  merge(
    base: VariableMap,
    overlay: VariableMap,
    policy: 'last-write-wins' | 'error-on-conflict' = 'last-write-wins'
  ): VariableMap {
    return mergeStepLocals(
      base as VariableContext,
      { '__overlay__': overlay as VariableContext },
      policy,
    ) as VariableMap;
  }
}

// ── Singleton accessor ────────────────────────────────────────────────────────

let _engine: IVariableEngine = new VariableEngine();

/** Returns the module-level variable engine singleton. */
export function getVariableEngine(): IVariableEngine {
  return _engine;
}

/** Replace engine — for testing or Phase C injection. */
export function setVariableEngine(engine: IVariableEngine): void {
  _engine = engine;
}

// ── Phase A stub (kept for import compat) ─────────────────────────────────────

export class VariableEngineStub implements IVariableEngine {
  resolve(_scopes: ScopedVariable[]): VariableResolutionResult {
    throw new Error('VariableEngineStub: use VariableEngine class instead');
  }
  substitute(_template: string, _context: VariableMap): string {
    throw new Error('VariableEngineStub: use VariableEngine class instead');
  }
  extract(_spec: VariableExtractionSpec, _response: unknown): VariableExtractionResult {
    throw new Error('VariableEngineStub: use VariableEngine class instead');
  }
  snapshot(context: VariableMap, afterNodeId: string): RuntimeVariableState {
    return {
      capturedAt: new Date().toISOString(),
      afterNodeId,
      context: { ...context },
      extractedThisStep: [],
      changedKeys: [],
    };
  }
  merge(base: VariableMap, overlay: VariableMap): VariableMap {
    return { ...base, ...overlay };
  }
}
