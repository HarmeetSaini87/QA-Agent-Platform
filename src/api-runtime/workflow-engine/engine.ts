/**
 * engine.ts â€” WorkflowEngine
 * Phase B Step 5: orchestration loop extracted from apiRunner.ts runCollection().
 * Phase C Step 1: SchedulerStateTracker wired in â€” explicit node lifecycle transitions,
 *   retry/skip/transition hooks, ExecutionSnapshot generation.
 *
 * WorkflowEngine owns:
 *   - mode dispatch (sequential / parallel / auto DAG)
 *   - wave iteration loop
 *   - condition guard per step
 *   - skip/abort/fail propagation (onFailure: stop | continue | skipDependents)
 *   - teardown sequencing (always runs after test waves)
 *   - cross-wave variable merging
 *   - partial-write hook (injected â€” engine does not touch fs directly)
 *   - snapshot hooks (no-op by default)
 *   - Phase C Step 1: scheduler state tracking (lifecycle transitions, timestamps)
 *
 * WorkflowEngine does NOT own:
 *   - HTTP transport     â†’ PlaywrightApiAdapter (Phase B Step 1)
 *   - Variable resolution â†’ VariableEngine (Phase B Step 3)
 *   - Assertion evaluation â†’ AssertionEngine (Phase B Step 4)
 *   - Rate limiting       â†’ injected throttle function
 *   - Jira auto-file      â†’ post-run side effect stays in runCollection() wrapper
 *
 * EXECUTION SEMANTICS: UNCHANGED from Phase B.
 * All ordering, retry, variable propagation, assertion timing identical.
 * Phase C Step 1 adds observability only â€” no behavioral changes.
 */

import type {
  ApiCollection, ApiEnvironment, ApiTestStep,
  ApiCollectionRunResult, ApiStepResult,
} from '../../data/types';
import type { VariableContext } from '../../utils/apiVariables';
import { snapshotContext, mergeStepLocals } from '../../utils/apiVariables';
import { buildAdjacency, topoSort, DagBuilder } from './dag-builder';
import { getConditionEvaluator } from './condition-evaluator';
import { createWorkflowRunState } from './workflow-state';
import type { WorkflowSnapshotHook } from './snapshot-hooks';
import { NO_OP_HOOKS } from './snapshot-hooks';
// Phase C Step 2: sanitize snapshots before delivery to hook consumers
import { sanitizeSnapshot } from './snapshot-sanitizer';
// Phase C Step 3: parallel eligibility analysis (metadata only — no execution change)
import { getParallelEligibilityAnalyser } from './parallel-eligibility';
// Phase C Step 4: failure classification
import { getFailureClassifier } from './failure-classifier';
import type { VariableMap } from '../../shared-core/contracts/variable.contract';

// â”€â”€ Rate limiter (token bucket) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function makeRateLimiter(rps: number) {
  const intervalMs = 1000 / rps;
  let lastFire = 0;
  return async function throttle() {
    const now = Date.now();
    const wait = intervalMs - (now - lastFire);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastFire = Date.now();
  };
}

// â”€â”€ Chunk helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runChunked<I, O>(items: I[], concurrency: number, fn: (item: I) => Promise<O>): Promise<O[]> {
  const results: O[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...await Promise.all(chunk.map(fn)));
  }
  return results;
}

// â”€â”€ Hook fire helper â€” swallows errors so hooks never break execution â”€â”€â”€â”€â”€â”€â”€â”€â”€

function fireHook<K extends keyof WorkflowSnapshotHook>(
  hooks: WorkflowSnapshotHook,
  name: K,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: Parameters<NonNullable<WorkflowSnapshotHook[K]>> extends any[] ? Parameters<NonNullable<WorkflowSnapshotHook[K]>> : never[]
): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (hooks[name] as ((...a: any[]) => void) | undefined)?.(...args);
  } catch {
    // hooks must never break execution
  }
}

// â”€â”€ WorkflowEngine config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface WorkflowEngineConfig {
  executeStep: (
    step: ApiTestStep,
    context: VariableContext,
    authHeaders: Record<string, string>,
    baseUrl: string
  ) => Promise<ApiStepResult>;

  resolveAuth: (
    authConfig: ApiEnvironment['authConfig'],
    context: VariableContext
  ) => Promise<Record<string, string>>;

  onPartialWrite: (status: ApiCollectionRunResult['status'], result: Omit<ApiCollectionRunResult, 'status'> & { status: ApiCollectionRunResult['status'] }) => void;

  /** Optional snapshot hooks for replay/debugger/analytics */
  hooks?: WorkflowSnapshotHook;
}

// â”€â”€ WorkflowEngine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class WorkflowEngine {
  private readonly hooks: WorkflowSnapshotHook;

  constructor(private readonly config: WorkflowEngineConfig) {
    this.hooks = config.hooks ?? NO_OP_HOOKS;
  }

  async execute(
    collection: ApiCollection,
    environment: ApiEnvironment,
    runId: string,
    initialContext: VariableContext
  ): Promise<ApiCollectionRunResult> {
    const startedAt = new Date().toISOString();
    const { executeStep, resolveAuth, onPartialWrite } = this.config;
    const conditionEvaluator = getConditionEvaluator();

    const testSteps = collection.steps.filter(s => !s.execution?.teardown);
    const teardownSteps = collection.steps.filter(s => s.execution?.teardown);

    const state = createWorkflowRunState(initialContext);

    // INVARIANT: metadata fields (position, visualGroup, hierarchyPath) must never influence execution ordering. Read legacyNodes/step only. See workflow.contract.ts.
    // Build execution waves based on mode
    const mode = collection.executionMode ?? 'auto';
    const deps = buildAdjacency(testSteps);
    let waves: ApiTestStep[][];
    if (mode === 'sequential') {
      waves = testSteps.map(s => [s]);
    } else if (mode === 'parallel') {
      waves = [testSteps];
    } else {
      waves = topoSort(testSteps, deps);
    }

    // Phase C Step 1: build DagGraph for snapshot generation only if hook registered
    // Phase C Step 3: also build if concurrency analysis hook registered
    const needsDag = !!(this.hooks.onSchedulerSnapshot || this.hooks.onConcurrencyAnalysis);
    const dagGraph = needsDag ? new DagBuilder().build(testSteps) : null;

    const maxConcurrency = collection.maxConcurrency ?? 5;
    const rpsLimit = collection.rateLimit?.requestsPerSecond ?? 10;
    const throttle = makeRateLimiter(rpsLimit);

    // Phase C Step 1: initialise scheduler â€” all test node IDs start as pending
    const nodeNames = new Map(testSteps.map(s => [s.id, s.name]));
    state.scheduler.initialise(testSteps.map(s => s.id), nodeNames);
    // Phase C Step 3: run parallel eligibility analysis if hook registered (metadata only)
    if (dagGraph && this.hooks.onConcurrencyAnalysis) {
      const report = getParallelEligibilityAnalyser().analyse(dagGraph, testSteps);
      state.scheduler.setConcurrencyReport(report);
      for (const [nodeId, eligibility] of Object.entries(report.nodeEligibility)) {
        state.scheduler.recordConcurrencyMeta(
          nodeId,
          eligibility.parallelEligible,
          eligibility.isolationLevel,
          eligibility.layer,
        );
      }
      fireHook(this.hooks, 'onConcurrencyAnalysis', report);
    }

    // Nodes in waves > 0 have unmet deps at start â€” mark blocked
    for (let wi = 1; wi < waves.length; wi++) {
      for (const s of waves[wi]) {
        state.scheduler.markBlocked(s.id);
        state.nodeStatuses.set(s.id, 'blocked');
      }
    }

    const buildPartial = (status: ApiCollectionRunResult['status']): ApiCollectionRunResult => ({
      id: runId,
      collectionId: collection.id,
      projectId: collection.projectId,
      startedAt,
      completedAt: new Date().toISOString(),
      status,
      stepResults: state.stepResults,
      variableContext: state.sharedContext,
    });

    onPartialWrite('running', buildPartial('running'));

    // â”€â”€ Wave loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    for (const wave of waves) {
      const waveSteps = wave.filter(s => !state.abortedIds.has(s.id));

      // nodeType guard â€” Phase B/C handles HTTP nodes only
      for (const s of waveSteps) {
        const nodeType = (s as { nodeType?: string }).nodeType;
        if (nodeType && nodeType !== 'HTTP') {
          throw new Error(`WorkflowEngine: unsupported nodeType '${nodeType}' â€” Phase B supports HTTP only`);
        }
      }

      fireHook(this.hooks, 'onWaveStart', state.waveIndex, waveSteps.map(s => s.id));

      const ctx = snapshotContext(state.sharedContext);
      const stepLocals: Record<string, VariableContext> = {};

      const results = await runChunked(waveSteps, maxConcurrency, async (step) => {
        // Condition guard
        if (step.execution?.condition && !conditionEvaluator.evaluate(step.execution.condition, ctx)) {
          const skipped: ApiStepResult = {
            stepId: step.id,
            stepName: step.name,
            status: 'skipped' as const,
            request: step.request,
            assertionResults: [],
            extractedVariables: {},
            durationMs: 0,
          };

          // Phase C Step 1: transition â†’ skipped (condition-false)
          const prevStatus = state.scheduler.getStatus(step.id);
          state.scheduler.markSkipped(step.id, 'condition-false');
          state.nodeStatuses.set(step.id, 'skipped');
          fireHook(this.hooks, 'onNodeSkip', {
            nodeId: step.id,
            nodeName: step.name,
            reason: 'condition-false' as const,
            at: new Date().toISOString(),
            waveIndex: state.waveIndex,
          });
          fireHook(this.hooks, 'onNodeTransition', {
            nodeId: step.id,
            nodeName: step.name,
            from: prevStatus,
            to: 'skipped' as const,
            at: new Date().toISOString(),
            waveIndex: state.waveIndex,
          });
          fireHook(this.hooks, 'onNodeComplete', step.id, skipped);
          return skipped;
        }

        // Phase C Step 1: transition â†’ running
        const prevStatus = state.scheduler.getStatus(step.id);
        state.scheduler.markRunning(step.id, 0);
        state.nodeStatuses.set(step.id, 'running');
        state.scheduler.recordVariablesBefore(step.id, ctx as unknown as VariableMap);
        fireHook(this.hooks, 'onNodeTransition', {
          nodeId: step.id,
          nodeName: step.name,
          from: prevStatus,
          to: 'running' as const,
          at: new Date().toISOString(),
          attempt: 0,
          waveIndex: state.waveIndex,
        });

        const authHeaders = await resolveAuth(environment.authConfig ?? { type: 'none' }, ctx).catch(() => ({}));
        await throttle();

        fireHook(this.hooks, 'onNodeStart', step.id, 0);
        const nodeStartMs = Date.now();
        const nodeStartAt = new Date().toISOString();
        const result = await executeStep(step, ctx, authHeaders, environment.baseUrl ?? '');

        // Phase C Step 4: record terminal attempt as RetryHistoryEntry (final outcome only)
        // Full per-retry granularity requires onAttempt wiring in executeWithRetry (available via retry-engine API)
        state.scheduler.appendRetryHistoryEntry(step.id, {
          attempt: 0,
          startedAt: nodeStartAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - nodeStartMs,
          httpStatus: result.response?.status,
          error: result.error,
          resultStatus: result.status,
          retriedAfter: false,
        });

        // Healing proposal on 404 with openapiSpecId
        if (result.response?.status === 404 && step.request.openapiSpecId) {
          result.healingProposal = `URL ${step.request.url} returned 404 â€” check OpenAPI spec ${step.request.openapiSpecId} for correct path`;
        }

        stepLocals[step.id] = result.extractedVariables;

        // Phase C Step 1: transition based on result
        const isFailed = result.status === 'failed' || result.status === 'error';
        if (isFailed) {
          const failureReason = result.status === 'error' ? 'http-error' as const : 'assertion-failure' as const;
          state.scheduler.markFailed(step.id, failureReason, result.error);
          state.nodeStatuses.set(step.id, 'failed');
          // Phase C Step 2: capture any partially extracted vars even on failure
          if (result.extractedVariables && Object.keys(result.extractedVariables).length > 0) {
            state.scheduler.recordVariablesAfter(step.id, result.extractedVariables as unknown as VariableMap);
          }
          // Phase C Step 4: classify failure and record recovery metadata
          const retryHistory = state.scheduler.getRecord(step.id)?.retryHistory ?? [];
          const retryExhausted = retryHistory.length > 0 && !retryHistory[retryHistory.length - 1].retriedAfter;
          const classification = getFailureClassifier().classify(step.id, failureReason, retryExhausted);
          state.scheduler.recordFailureClassification(
            step.id, classification.failureClass, classification.recoveryEligibility,
          );
          state.scheduler.appendFailureTimelineEvent({
            type: 'node-failed',
            nodeId: step.id,
            reason: failureReason,
            at: new Date().toISOString(),
            attempt: retryHistory.length > 0 ? retryHistory[retryHistory.length - 1].attempt : 0,
            retriable: classification.isRetryCandidate,
          });
          fireHook(this.hooks, 'onNodeFail', {
            nodeId: step.id,
            nodeName: step.name,
            reason: failureReason,
            error: result.error,
            waveIndex: state.waveIndex,
          });
          fireHook(this.hooks, 'onNodeTransition', {
            nodeId: step.id,
            nodeName: step.name,
            from: 'running' as const,
            to: 'failed' as const,
            at: new Date().toISOString(),
            waveIndex: state.waveIndex,
          });
        } else {
          state.scheduler.markCompleted(step.id);
          state.nodeStatuses.set(step.id, 'completed');
          state.scheduler.recordVariablesAfter(step.id, result.extractedVariables as unknown as VariableMap);
          if (result.contractViolations?.length) {
            state.scheduler.recordContractViolations(step.id, result.contractViolations);
          }
          fireHook(this.hooks, 'onNodeTransition', {
            nodeId: step.id,
            nodeName: step.name,
            from: 'running' as const,
            to: 'completed' as const,
            at: new Date().toISOString(),
            waveIndex: state.waveIndex,
          });
        }

        fireHook(this.hooks, 'onNodeComplete', step.id, result);
        return result;
      });

      // Process results â€” fail/stop/skipDependents
      for (const result of results) {
        state.stepResults.push(result);
        if (result.status === 'failed' || result.status === 'error') {
          state.collectionFailed = true;
          const onFail =
            testSteps.find(s => s.id === result.stepId)?.execution?.onFailure ??
            collection.onFailure;

          if (onFail === 'stop') {
            const stopBlockedIds: string[] = [];
            for (const s of testSteps) {
              if (!state.stepResults.find(r => r.stepId === s.id)) {
                state.abortedIds.add(s.id);
                // Phase C Step 1: mark aborted nodes skipped with dependency-failed reason
                state.scheduler.markSkipped(s.id, 'dependency-failed');
                state.nodeStatuses.set(s.id, 'skipped');
                // Phase C Step 4: record blocked-by metadata
                state.scheduler.recordBlockedByFailure(s.id, result.stepId);
                state.scheduler.recordFailureClassification(
                  s.id, 'dependency-blocked', 'eligible-with-deps',
                );
                stopBlockedIds.push(s.id);
                fireHook(this.hooks, 'onNodeSkip', {
                  nodeId: s.id,
                  nodeName: s.name,
                  reason: 'dependency-failed' as const,
                  at: new Date().toISOString(),
                  waveIndex: state.waveIndex,
                  causedByNodeId: result.stepId,
                });
              }
            }
            // Phase C Step 4: update downstream impact on the triggering node
            if (stopBlockedIds.length > 0) {
              state.scheduler.recordFailureClassification(
                result.stepId,
                state.scheduler.getRecord(result.stepId)?.failureClass ?? 'terminal',
                state.scheduler.getRecord(result.stepId)?.recoveryEligibility ?? 'not-eligible',
                stopBlockedIds,
              );
              state.scheduler.appendFailureTimelineEvent({
                type: 'abort-triggered',
                triggeredBy: result.stepId,
                affectedCount: stopBlockedIds.length,
                at: new Date().toISOString(),
              });
            }
            break;
          } else if (onFail === 'skipDependents') {
            const markSkippedDeps = (id: string) => {
              for (const s of testSteps) {
                if (deps.get(s.id)?.has(id) && !state.abortedIds.has(s.id)) {
                  state.abortedIds.add(s.id);
                  state.scheduler.markSkipped(s.id, 'dependency-failed');
                  state.nodeStatuses.set(s.id, 'skipped');
                  // Phase C Step 4: record dependency propagation metadata
                  state.scheduler.recordBlockedByFailure(s.id, id);
                  state.scheduler.recordFailureClassification(
                    s.id, 'dependency-blocked', 'eligible-with-deps',
                  );
                  state.scheduler.appendFailureTimelineEvent({
                    type: 'dep-blocked',
                    nodeId: s.id,
                    causedBy: id,
                    at: new Date().toISOString(),
                  });
                  fireHook(this.hooks, 'onNodeSkip', {
                    nodeId: s.id,
                    nodeName: s.name,
                    reason: 'dependency-failed' as const,
                    at: new Date().toISOString(),
                    waveIndex: state.waveIndex,
                    causedByNodeId: id,
                  });
                  markSkippedDeps(s.id);
                }
              }
            };
            markSkippedDeps(result.stepId);
          }
        }
      }

      state.sharedContext = mergeStepLocals(state.sharedContext, stepLocals, 'last-write-wins');
      state.waveIndex++;
      onPartialWrite('running', buildPartial('running'));

      // Phase C Step 1/2: emit wave-end snapshot if hook registered (sanitized)
      if (this.hooks.onSchedulerSnapshot && dagGraph) {
        fireHook(this.hooks, 'onSchedulerSnapshot',
          sanitizeSnapshot(state.scheduler.buildSnapshot(
            runId, collection.id, collection.projectId, dagGraph,
            state.sharedContext as unknown as VariableMap, 'running',
          )),
        );
      }

      if (state.abortedIds.size > 0 && collection.onFailure === 'stop') break;
    }

    // â”€â”€ Teardown (always runs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    for (const step of teardownSteps) {
      const authHeaders = await resolveAuth(
        environment.authConfig ?? { type: 'none' },
        state.sharedContext
      ).catch(() => ({}));
      const result = await executeStep(step, state.sharedContext, authHeaders, environment.baseUrl ?? '');
      state.stepResults.push(result);
    }

    // â”€â”€ Final result â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    const finalStatus = state.collectionFailed ? 'failed' : 'passed';
    const finalResult = buildPartial(finalStatus);

    fireHook(this.hooks, 'onRunComplete', {
      runId,
      totalNodes: testSteps.length,
      passed: state.stepResults.filter(r => r.status === 'passed').length,
      failed: state.stepResults.filter(r => r.status === 'failed' || r.status === 'error').length,
      skipped: state.stepResults.filter(r => r.status === 'skipped').length,
      durationMs: Date.now() - new Date(startedAt).getTime(),
    });

    // Phase C Step 4: finalise failure propagation record and fire hook if any failures occurred
    const propagationRecord = state.scheduler.finaliseFailurePropagation();
    if (
      this.hooks.onFailurePropagation &&
      (propagationRecord.rootFailureNodeIds.length > 0 ||
       propagationRecord.timeline.propagatedSkipNodeIds.length > 0)
    ) {
      fireHook(this.hooks, 'onFailurePropagation', propagationRecord);
    }

    // Phase C Step 1/2: final snapshot (sanitized)
    if (this.hooks.onSchedulerSnapshot && dagGraph) {
      fireHook(this.hooks, 'onSchedulerSnapshot',
        sanitizeSnapshot(state.scheduler.buildSnapshot(
          runId, collection.id, collection.projectId, dagGraph,
          state.sharedContext as unknown as VariableMap,
          finalStatus === 'failed' ? 'failed' : 'completed',
        )),
      );
    }

    return finalResult;
  }
}

// â”€â”€ Factory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function createWorkflowEngine(config: WorkflowEngineConfig): WorkflowEngine {
  return new WorkflowEngine(config);
}

