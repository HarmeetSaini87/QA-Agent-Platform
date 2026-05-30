/**
 * apiRunner.ts — Phase B Facade (FINAL STATE)
 *
 * Phase B Step 10: thin-facade consolidation complete.
 *
 * This file is the orchestration entrypoint and compatibility bridge.
 * All execution responsibilities are delegated to extracted engines:
 *
 *   playwright-api-adapter  -> HTTP transport, context lifecycle
 *   variable-engine         -> variable resolution
 *   assertion-engine        -> assertion normalisation
 *   workflow-engine         -> DAG build, wave dispatch, condition eval, teardown
 *   retry-engine            -> retry loop, backoff, idempotency
 *   execution-engine        -> single-node pipeline (pre/post-script, baseline, contract)
 *   artifact-engine         -> run result persistence, HAR, timeline
 *   contract-engine         -> OpenAPI schema validation
 *
 * What remains here:
 *   A. runCollection()        -- context init, engine wiring, Jira side-effect
 *   B. Compatibility re-exports -- CircularDependencyError, extractVarRefs, buildDAG,
 *                                  topoSort, getVariableEngine, getAssertionEngine
 *   C. Private bridge         -- executeStepWithRetry (wires retry-engine to execution-engine)
 *
 * Routes that import from here:
 *   src/ui/routes/api-testing.routes.ts  -> runCollection
 *   src/ui/routes/suites.routes.ts       -> runCollection
 *
 * DO NOT add business logic here. Business logic belongs in the extracted engines.
 */

// OLD: import vm from 'node:vm'; -- Phase B Step 7: vm now used only in execution-engine/
// OLD: import { getAdapter } -- Phase B Step 7: moved to execution-engine/node-executor.ts
// OLD: import Ajv -- Phase B Step 7: moved to execution-engine/contract.ts
// OLD: import { substituteVars, extractVariables } -- Phase B Step 7: moved to execution-engine/node-executor.ts
// OLD: import { evaluateAssertions } -- Phase B Step 7: moved to execution-engine/node-executor.ts
// OLD: import { normaliseAssertions } -- Phase B Step 7: moved to execution-engine/node-executor.ts
// OLD: import * as fs from 'fs'; -- Phase B Step 8: raw fs writes replaced by artifact-engine
// OLD: import * as path from 'path'; -- Phase B Step 8: path usage moved to artifact-engine
// OLD: import { snapshotContext, mergeStepLocals } -- Phase B Step 10: unused after orchestration delegation

// Phase B Step 8: ArtifactEngine extracts run persistence from runCollection().
import { getArtifactEngine, savePartialRunResult } from '../api-runtime/artifact-engine/engine';
import type {
  ApiCollection, ApiEnvironment, ApiTestStep,
  ApiCollectionRunResult, ApiStepResult,
} from '../data/types';
import type { VariableContext } from './apiVariables';
// Phase B Step 5: WorkflowEngine extracts orchestration loop from runCollection().
import { createWorkflowEngine } from '../api-runtime/workflow-engine/engine';
// Phase C Step 2: snapshot persistence hook
import { saveSnapshot } from '../storage-provider/execution-store';
// Phase B Step 6: RetryEngine extracts executeStepWithRetry loop.
import { executeWithRetry } from '../api-runtime/retry-engine/engine';
// Phase B Step 7: ExecutionEngine extracts executeStep node pipeline.
import { executeNode } from '../api-runtime/execution-engine/node-executor';
// Phase B: variable-engine wrapper available for Phase C consumers.
import { getVariableEngine as _getVariableEngine } from '../api-runtime/variable-engine/engine';
export { _getVariableEngine as getVariableEngine };
// Phase B: assertion-engine wrapper -- Phase C migration boundary for workflow-engine consumers.
import { getAssertionEngine as _getAssertionEngine } from '../api-runtime/assertion-engine/engine';
export { _getAssertionEngine as getAssertionEngine };
import { resolveAuthHeaders } from './apiAuth';
import { decryptSensitiveVars } from './apiSecrets';

// OLD: const DATA_DIR -- Phase B Step 8: moved to artifact-engine/run-store.ts
// OLD: const RUNS_DIR -- Phase B Step 8: moved to artifact-engine/run-store.ts
// OLD: const BASELINES_DIR -- Phase B Step 7: moved to execution-engine/baseline.ts
// OLD: const OA_SPECS_DIR -- Phase B Step 7: moved to execution-engine/contract.ts
// OLD: const _ajv = new Ajv() -- Phase B Step 7: moved to execution-engine/contract.ts

// == Errors ===================================================================
// OLD: local CircularDependencyError class -- Phase B Step 11: re-export from shared-core to avoid instanceof mismatch
export { CircularDependencyError } from '../shared-core/contracts/dependency-graph.contract';

// == Condition evaluation =====================================================
// OLD: inline evaluateCondition -- Phase B Step 5 moved to workflow-engine/condition-evaluator.ts
// function evaluateCondition(condition: string, variables: VariableContext): boolean {
//   try {
//     const sandbox = Object.freeze({ ...variables });
//     const ctx = vm.createContext(sandbox);
//     return !!vm.runInContext(condition, ctx, { timeout: 100 });
//   } catch { return false; }
// }
// OLD: local wrapper -- Phase B Step 10: unused (WorkflowEngine owns condition eval)
// function evaluateCondition(condition: string, variables: VariableContext): boolean {
//   return _getConditionEvaluator().evaluate(condition, variables);
// }

// == DAG construction =========================================================
// OLD: extractVarRefs, buildDAG, topoSort -- Phase B Step 5 moved to workflow-engine/dag-builder.ts
// Originals retained as comments per CLAUDE.md comment-out rule.
// Remove on explicit "clean up" instruction.
//
// const VAR_REF_RE = /\{\{([^}]+)\}\}|\$\{([^}]+)\}/g;
// export function extractVarRefs(step: ApiTestStep): string[] { ... }
// export function buildDAG(steps: ApiTestStep[]): Map<string, Set<string>> { ... }
// export function topoSort(steps: ApiTestStep[], deps: Map<string, Set<string>>): ApiTestStep[][] { ... }

// @deprecated -- use workflow-engine/dag-builder directly. Re-exported for existing test callers.
export { extractVarRefs, buildAdjacency as buildDAG, topoSort } from '../api-runtime/workflow-engine/dag-builder';

// == Rate limiter =============================================================
// OLD: makeRateLimiter -- Phase B Step 10: unused (WorkflowEngine owns rate limiting)
// function makeRateLimiter(rps: number) {
//   const intervalMs = 1000 / rps;
//   let lastFire = 0;
//   return async function throttle() {
//     const now = Date.now();
//     const wait = intervalMs - (now - lastFire);
//     if (wait > 0) await new Promise(r => setTimeout(r, wait));
//     lastFire = Date.now();
//   };
// }

// == Baseline diff, contract, script ==========================================
// OLD: deepJsonDiff, diffBaseline, loadBaseline, saveBaseline, checkContractDrift,
//      runScript, executeStep -- Phase B Step 7 moved to execution-engine/.
// Retained as comments per CLAUDE.md rule. Remove on explicit "clean up" instruction.
//
// function deepJsonDiff(...) { ... }
// function diffBaseline(...) { ... }
// function loadBaseline(...) { ... }
// function saveBaseline(...) { ... }
// function checkContractDrift(...) { ... }
// function runScript(...) { ... }
// async function executeStep(...) { ... }
//
// All of the above now live in execution-engine/node-executor.ts (executeNode).

// == Chunk helper =============================================================
// OLD: runChunked -- Phase B Step 10: unused (WorkflowEngine handles concurrency)
// async function runChunked<I, O>(items: I[], concurrency: number, fn: (item: I) => Promise<O>): Promise<O[]> {
//   const results: O[] = [];
//   for (let i = 0; i < items.length; i += concurrency) {
//     const chunk = items.slice(i, i + concurrency);
//     results.push(...await Promise.all(chunk.map(fn)));
//   }
//   return results;
// }

// == Step execution bridge (retry-engine -> execution-engine) =================
// Phase B Step 6+7: wires retry-engine to execution-engine.
// Phase B Step 10: executeStep() collapsed into this function (one less indirection).
// OLD: separate executeStep function -- Phase B Step 10: inlined below
// async function executeStep(step, context, authHeaders, timeoutMs, baseUrl) {
//   return executeNode(step, context, authHeaders, timeoutMs, baseUrl);
// }

async function executeStepWithRetry(
  step: ApiTestStep,
  context: VariableContext,
  authHeaders: Record<string, string>,
  baseUrl = ''
): Promise<ApiStepResult> {
  const timeout = step.execution?.timeoutMs ?? 30_000;
  return executeWithRetry(step, (s, _attempt) =>
    executeNode(s, context, authHeaders, timeout, baseUrl)
  );
}

// == Main entry ===============================================================

export async function runCollection(
  collection: ApiCollection,
  environment: ApiEnvironment,
  runId: string,
  inheritedContext?: Record<string, string>,
): Promise<ApiCollectionRunResult> {
  // Phase B Step 5: orchestration delegated to WorkflowEngine.
  // Phase B Step 10: this function = context init + engine wiring + Jira side-effect only.

  const teardownSteps = collection.steps.filter(s => s.execution?.teardown);

  // Build initial variable context from decrypted env vars + collection vars
  const decryptedEnvVars = decryptSensitiveVars(environment.variables ?? []);
  const initialContext: VariableContext = {};
  for (const v of decryptedEnvVars) initialContext[v.key] = v.value;
  for (const v of collection.variables ?? []) initialContext[v.key] = v.value;

  // Merge inherited context from suite lifecycle (beforeAll/beforeEach extracted variables)
  if (inheritedContext) {
    for (const [k, v] of Object.entries(inheritedContext)) initialContext[k] = v;
  }

  // Phase B Step 8: partial write delegated to artifact-engine
  // OLD: const writePartialToFs = (status, partial) => { fs.existsSync / mkdirSync / writeFileSync }
  const writePartialToFs = (status: ApiCollectionRunResult['status'], partial: ApiCollectionRunResult) => {
    savePartialRunResult(status, partial).catch(() => { /* non-fatal */ });
  };

  const engine = createWorkflowEngine({
    executeStep: (step, context, authHeaders, baseUrl) =>
      executeStepWithRetry(step, context, authHeaders, baseUrl),
    resolveAuth: (authConfig, context) =>
      resolveAuthHeaders(authConfig ?? { type: 'none' }, context),
    onPartialWrite: writePartialToFs,
    // Phase C Step 2: fire-and-forget snapshot persistence for replay/crash-recovery
    hooks: {
      onSchedulerSnapshot: (snapshot) => {
        // Non-blocking — snapshot loss is acceptable, execution failure is not
        saveSnapshot(snapshot);
      },
    },
  });

  const result = await engine.execute(collection, environment, runId, initialContext);

  // Phase B Step 8: final persist delegated to artifact-engine (masks sensitive headers/vars)
  // OLD: if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(...); fs.writeFileSync(...)
  await getArtifactEngine().saveRunResult(result);

  // Task 4.5: Jira auto-file defects for failed steps (post-run side effect -- not orchestration)
  if (collection.autoFileDefects) {
    const testStepResults = result.stepResults.filter(r => !teardownSteps.find(t => t.id === r.stepId));
    try {
      const { loadJiraConfig, loadDefectsRegistry, saveDefectsRegistry } = await import('./defectsStore');
      const { JiraClient } = await import('./jiraClient');
      const { buildApiDefectAdf } = await import('./adfBuilder');
      const cfg = loadJiraConfig();
      if (cfg?.projectKey) {
        let apiToken = '';
        if (cfg.apiTokenEnc) {
          const { jiraDecryptToken } = await import('../ui/helpers/jira-helpers');
          try { apiToken = jiraDecryptToken(cfg.apiTokenEnc); } catch { /* ignore */ }
        }
        const baseUrl = cfg.baseUrl ?? '';
        if (baseUrl) {
          const client = new JiraClient({ baseUrl, email: cfg.email ?? '', apiToken });
          const reg = loadDefectsRegistry();
          for (const step of testStepResults) {
            if (step.status !== 'failed') continue;
            const failMsg = step.error ?? (step.assertionResults.find(a => !a.passed)?.message ?? 'failed');
            const title = (`[API] ${step.request.method} ${step.request.url} -- ${failMsg}`).slice(0, 200);
            const existing = await client.searchOpenDefectByTestId(step.stepId, collection.id, cfg.projectKey).catch(() => null);
            if (!existing) {
              const adf = buildApiDefectAdf(step, collection, environment);
              const issue = await client.createIssue({
                projectKey: cfg.projectKey, issueType: 'Bug', summary: title, descriptionADF: adf, priority: 'High',
              }).catch(() => null);
              if (issue) {
                reg.defects.push({
                  defectKey: issue.key, jiraId: issue.id,
                  testId: step.stepId, testName: step.stepName,
                  suiteId: collection.id, suiteName: collection.name,
                  environmentId: environment.id, environmentName: environment.name,
                  projectId: cfg.projectKey, parentStoryKey: '',
                  status: 'open', createdAt: new Date().toISOString(), createdBy: 'api-runner',
                  filedFromRunId: runId, jiraUrl: issue.self,
                  attachments: {}, comments: [],
                });
                saveDefectsRegistry(reg);
              }
            }
          }
        }
      }
    } catch { /* non-fatal */ }
  }

  return result;
}

// ── Data-driven iteration wrapper ─────────────────────────────────────────────
// Runs `runCollection` once per data row, tagging each step result with
// iterationIndex + rowIdentifier, then merges into a single result.
export async function runCollectionWithDataFile(
  collection: ApiCollection,
  environment: ApiEnvironment,
  runId: string,
  dataRows: Record<string, string>[],
  dataFileId: string,
  dataFileName: string,
  stopOnFailure: boolean,
  inheritedContext?: Record<string, string>,
): Promise<ApiCollectionRunResult> {
  const allStepResults: ApiStepResult[] = [];
  const iterationSummary: ApiCollectionRunResult['iterationSummary'] = [];
  let anyFailed = false;

  // First column is used as row identifier
  const identifierKey = dataRows[0] ? Object.keys(dataRows[0])[0] : 'row';

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowContext: Record<string, string> = { ...inheritedContext, ...row };
    const iterRunId = `${runId}_iter${i}`;

    const iterResult = await runCollection(collection, environment, iterRunId, rowContext);

    const rowIdentifier = row[identifierKey] ?? String(i + 1);
    const tagged: ApiStepResult[] = iterResult.stepResults.map(s => ({
      ...s,
      iterationIndex: i,
      rowIdentifier,
    }));
    allStepResults.push(...tagged);

    const iterPassed = iterResult.status === 'passed';
    if (!iterPassed) anyFailed = true;

    const iterDuration = (iterResult as unknown as Record<string, unknown>).durationMs as number | undefined;
    iterationSummary!.push({
      index:        i,
      rowIdentifier,
      status:       iterResult.status === 'running' ? 'failed' : iterResult.status,
      durationMs:   iterDuration ?? 0,
    });

    if (stopOnFailure && !iterPassed) break;
  }

  const startedAt = new Date().toISOString();
  const base: ApiCollectionRunResult = {
    id:               runId,
    collectionId:     collection.id,
    projectId:        collection.projectId ?? '',
    startedAt,
    completedAt:      new Date().toISOString(),
    status:           anyFailed ? 'failed' : 'passed',
    stepResults:      allStepResults,
    variableContext:  {},
    iterationCount:   dataRows.length,
    dataFileId,
    dataFileName,
    iterationSummary,
  };

  await getArtifactEngine().saveRunResult(base);
  return base;
}

// OLD: inline orchestration loop (Phase B Step 5 -- moved to workflow-engine/engine.ts)
// Retained as reference per CLAUDE.md comment-out rule. Remove on explicit "clean up" instruction.
//
// async function _OLD_runCollection_orchestrationLoop(collection, environment, runId, ...) {
//   const mode = collection.executionMode ?? 'auto';
//   const deps = buildDAG(testSteps);
//   ...wave loop, skip/abort propagation, mergeStepLocals, writePartial...
//   ...teardown sequencing...
//   // All of the above now lives in workflow-engine/engine.ts WorkflowEngine.execute()
// }
