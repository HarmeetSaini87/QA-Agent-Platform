/**
 * scheduler-state.ts â€” SchedulerStateTracker
 * Phase C Step 1: explicit node lifecycle state machine and transition tracking.
 *
 * Wraps WorkflowRunState.nodeStatuses with structured NodeExecutionRecord entries.
 * The WorkflowEngine writes transitions here; the tracker is read-only to callers.
 *
 * WHAT THIS ADDS (Phase C Step 1 only):
 *   - Explicit pending â†’ blocked â†’ running â†’ retrying â†’ completed/failed/skipped transitions
 *   - Per-node startedAt / completedAt timestamps
 *   - SkipReason and FailureReason categorisation
 *   - RetryState per node
 *   - Live ExecutionSnapshot generation (for replay/debugger hooks)
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - DAG ordering logic (topoSort unchanged)
 *   - Retry semantics (retry-engine unchanged)
 *   - Variable propagation (apiVariables unchanged)
 *   - Assertion evaluation (unchanged)
 *   - ApiCollectionRunResult shape (unchanged â€” callers unaffected)
 *
 * TRANSITION MAP:
 *
 *   pending â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–º skipped (condition-false / manually-skipped)
 *       â”‚                                                   â”‚
 *       â–¼                                                   â–¼
 *   blocked â”€â”€â”€ all deps complete â”€â”€â–º pending â”€â”€â–º running â”€â–º completed
 *                                                    â”‚   â””â”€â”€â–º failed
 *                                                    â”‚         â”‚
 *                                                    â”‚    (within budget)
 *                                                    â–¼
 *                                                 retrying â”€â”€â–º running (next attempt)
 *                                                           â””â”€â”€â–º failed (exhausted)
 *
 *   skipped (dependency-failed / dependency-skipped): transition from pending only
 */

import type { WorkflowNodeStatus } from '../../shared-core/contracts/workflow.contract';
import type {
  NodeExecutionRecord,
  RetryState,
  SkipReason,
  FailureReason,
  ExecutionSnapshot,
  DagGraph,
} from '../../shared-core/contracts/dependency-graph.contract';
import type { ConcurrencyReadinessReport } from './parallel-eligibility';
import type { RetryHistoryEntry, FailurePropagationRecord } from './failure-propagation';
import type { FailureClass, RecoveryEligibility } from './failure-classifier';
import { createEmptyFailurePropagationRecord } from './failure-propagation';
import type { VariableMap } from '../../shared-core/contracts/variable.contract';

export type { NodeExecutionRecord, RetryState, SkipReason, FailureReason };

// â”€â”€ SchedulerStateTracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class SchedulerStateTracker {
  private readonly _records = new Map<string, NodeExecutionRecord>();
  private _concurrencyReport?: ConcurrencyReadinessReport;
  private _failurePropagation: FailurePropagationRecord = createEmptyFailurePropagationRecord();

  /** Initialise all nodes as 'pending'. Call once after DAG is built. */
  initialise(nodeIds: string[], nodeNames: Map<string, string>): void {
    for (const id of nodeIds) {
      this._records.set(id, {
        nodeId: id,
        nodeName: nodeNames.get(id) ?? id,
        status: 'pending',
      });
    }
  }

  // INVARIANT: metadata fields (position, visualGroup, hierarchyPath) must never influence scheduler state transitions. See workflow.contract.ts.
  /** Transition node to 'blocked' â€” has unmet dependencies. */
  markBlocked(nodeId: string): void {
    this._transition(nodeId, 'blocked');
  }

  /** Transition node to 'running'. Records startedAt. */
  markRunning(nodeId: string, attempt = 0): void {
    const rec = this._get(nodeId);
    rec.status = 'running';
    rec.startedAt = new Date().toISOString();
    if (attempt > 0) {
      // Re-entering running from retrying â€” update retry state
      if (rec.retryState) rec.retryState.attempt = attempt;
    }
  }

  /** Transition node to 'retrying' â€” failed this attempt but budget remains. */
  markRetrying(nodeId: string, retryState: RetryState): void {
    const rec = this._get(nodeId);
    rec.status = 'retrying';
    rec.retryState = retryState;
  }

  /** Transition node to 'completed'. Records completedAt + durationMs. */
  markCompleted(nodeId: string): void {
    const rec = this._get(nodeId);
    rec.status = 'completed';
    rec.completedAt = new Date().toISOString();
    if (rec.startedAt) {
      rec.durationMs = new Date(rec.completedAt).getTime() - new Date(rec.startedAt).getTime();
    }
    // Phase C Step 2: completed nodes are not eligible for selective rerun
    rec.rerunEligible = false;
  }

  /** Transition node to 'failed'. Records reason + completedAt. */
  markFailed(nodeId: string, reason: FailureReason, error?: string): void {
    const rec = this._get(nodeId);
    rec.status = 'failed';
    rec.failureReason = reason;
    rec.completedAt = new Date().toISOString();
    if (error) rec.error = error;
    if (rec.startedAt) {
      rec.durationMs = new Date(rec.completedAt).getTime() - new Date(rec.startedAt).getTime();
    }
    // Phase C Step 2: failed nodes are eligible for selective rerun
    rec.rerunEligible = true;
    rec.rerunBlockedByNodeIds = [];  // populated by future rerun engine from DAG
  }

  /** Transition node to 'skipped'. Records reason. */
  markSkipped(nodeId: string, reason: SkipReason): void {
    const rec = this._get(nodeId);
    rec.status = 'skipped';
    rec.skipReason = reason;
    rec.completedAt = new Date().toISOString();
    rec.durationMs = 0;
    // Phase C Step 2: skipped nodes (dependency-failed, condition-false) are eligible for rerun
    rec.rerunEligible = true;
    rec.rerunBlockedByNodeIds = [];
  }

  /** Record variable state snapshot on node entry. Idempotent â€” only captures on first attempt. */
  recordVariablesBefore(nodeId: string, vars: VariableMap): void {
    const rec = this._get(nodeId);
    // Phase C Step 2: idempotency guard â€” do not overwrite on retry
    if (rec.variablesBefore) return;
    rec.variablesBefore = { ...vars };
  }

  /** Record variable state after extraction. */
  recordVariablesAfter(nodeId: string, vars: VariableMap): void {
    this._get(nodeId).variablesAfter = { ...vars };
  }

  /** Record contract violations for a node. */
  recordContractViolations(nodeId: string, violations: string[]): void {
    if (violations.length) this._get(nodeId).contractViolations = violations;
  }

  /** Record artifact references for replay reconstruction (Phase C Step 2). */
  recordArtifactRefs(nodeId: string, refs: NodeExecutionRecord['artifactRefs']): void {
    if (refs) this._get(nodeId).artifactRefs = refs;
  }

  /**
   * Phase C Step 3: stamp concurrency-readiness metadata onto a node record.
   * Called once after ParallelEligibilityAnalyser runs — no execution behaviour change.
   */
  recordConcurrencyMeta(
    nodeId: string,
    parallelEligible: boolean,
    isolationLevel: NodeExecutionRecord['isolationLevel'],
    concurrencyBatchId: number,
  ): void {
    const rec = this._get(nodeId);
    rec.parallelEligible = parallelEligible;
    rec.isolationLevel = isolationLevel;
    rec.concurrencyBatchId = concurrencyBatchId;
  }

  /**
   * Phase C Step 3: store full concurrency readiness report on this tracker.
   * Read by buildSnapshot() to embed in ExecutionSnapshot.
   */
  setConcurrencyReport(report: ConcurrencyReadinessReport): void {
    this._concurrencyReport = report;
  }

  /** Phase C Step 3: retrieve the stored concurrency readiness report. */
  getConcurrencyReport(): ConcurrencyReadinessReport | undefined {
    return this._concurrencyReport;
  }

  // ── Phase C Step 4: failure propagation tracking ──────────────────────────

  /** Append a retry attempt to a node's retry history. Immutable after capture -- never overwrites. */
  appendRetryHistoryEntry(nodeId: string, entry: RetryHistoryEntry): void {
    const rec = this._get(nodeId);
    if (!rec.retryHistory) rec.retryHistory = [];
    rec.retryHistory.push(entry);
    // Mirror in propagation record
    if (!this._failurePropagation.retryHistory[nodeId]) {
      this._failurePropagation.retryHistory[nodeId] = [];
    }
    this._failurePropagation.retryHistory[nodeId].push(entry);
    this._failurePropagation.timeline.totalRetryAttempts += entry.retriedAfter ? 1 : 0;
  }

  /** Record failure classification and recovery eligibility on a node. */
  recordFailureClassification(
    nodeId: string,
    failureClass: FailureClass,
    recoveryEligibility: RecoveryEligibility,
    downstreamBlockedNodeIds: string[] = [],
  ): void {
    const rec = this._get(nodeId);
    rec.failureClass = failureClass;
    rec.recoveryEligibility = recoveryEligibility;
    rec.propagatedSkipToNodeIds = downstreamBlockedNodeIds;

    // Mirror in propagation record
    this._failurePropagation.failureClasses[nodeId] = failureClass;
    this._failurePropagation.recoveryEligibility[nodeId] = recoveryEligibility;
    if (downstreamBlockedNodeIds.length > 0) {
      this._failurePropagation.downstreamImpact[nodeId] = downstreamBlockedNodeIds;
    }
    if (failureClass !== 'dependency-blocked') {
      if (!this._failurePropagation.rootFailureNodeIds.includes(nodeId)) {
        this._failurePropagation.rootFailureNodeIds.push(nodeId);
      }
      if (recoveryEligibility === 'not-eligible') {
        if (!this._failurePropagation.timeline.terminalFailureNodeIds.includes(nodeId)) {
          this._failurePropagation.timeline.terminalFailureNodeIds.push(nodeId);
        }
      }
    }
  }

  /** Record that a node was blocked due to upstream failure. */
  recordBlockedByFailure(nodeId: string, causedByNodeId: string): void {
    const rec = this._get(nodeId);
    if (!rec.blockedByNodeIds) rec.blockedByNodeIds = [];
    if (!rec.blockedByNodeIds.includes(causedByNodeId)) {
      rec.blockedByNodeIds.push(causedByNodeId);
    }
    if (!this._failurePropagation.timeline.propagatedSkipNodeIds.includes(nodeId)) {
      this._failurePropagation.timeline.propagatedSkipNodeIds.push(nodeId);
    }
  }

  /** Append a failure timeline event. */
  appendFailureTimelineEvent(
    event: FailurePropagationRecord['timeline']['events'][number],
  ): void {
    this._failurePropagation.timeline.events.push(event);
  }

  /** Finalise the failure propagation record (called at run end). */
  finaliseFailurePropagation(): FailurePropagationRecord {
    this._failurePropagation.finalisedAt = new Date().toISOString();
    return this._failurePropagation;
  }

  /** Read current failure propagation record. */
  getFailurePropagation(): FailurePropagationRecord {
    return this._failurePropagation;
  }

  /** Read current status for a node. */
  getStatus(nodeId: string): WorkflowNodeStatus {
    return this._records.get(nodeId)?.status ?? 'pending';
  }

  /** Read full record for a node (read-only copy). */
  getRecord(nodeId: string): Readonly<NodeExecutionRecord> | undefined {
    return this._records.get(nodeId);
  }

  /** All records â€” for snapshot generation. */
  allRecords(): ReadonlyMap<string, NodeExecutionRecord> {
    return this._records;
  }

  /**
   * Build a categorised node ID list for quick lookup.
   * Used by ExecutionSnapshot.
   */
  categorise(): {
    completed: string[];
    running: string[];
    pending: string[];
    blocked: string[];
    failed: string[];
    skipped: string[];
    retrying: string[];
  } {
    const out = {
      completed: [] as string[],
      running:   [] as string[],
      pending:   [] as string[],
      blocked:   [] as string[],
      failed:    [] as string[],
      skipped:   [] as string[],
      retrying:  [] as string[],
    };
    for (const [id, rec] of this._records) {
      (out[rec.status] ??= []).push(id);
    }
    return out;
  }

  /**
   * Build a full ExecutionSnapshot â€” serialisable, suitable for replay/debugger.
   * Only call when the hook consumer requests it (e.g. onWaveStart / onRunComplete).
   */
  buildSnapshot(
    runId: string,
    collectionId: string,
    projectId: string | undefined,
    graph: DagGraph,
    variableState: VariableMap,
    runStatus: ExecutionSnapshot['runStatus'],
  ): ExecutionSnapshot {
    const cat = this.categorise();
    const nodeRecords: Record<string, NodeExecutionRecord> = {};
    for (const [id, rec] of this._records) nodeRecords[id] = { ...rec };

    // DagGraph.nodes is Map<string, DagNodeMeta> â€” convert to plain object for snapshot
    const graphNodes: Record<string, import('../../shared-core/contracts/dependency-graph.contract').DagNodeMeta> = {};
    for (const [id, meta] of graph.nodes) graphNodes[id] = meta;

    return {
      runId,
      collectionId,
      projectId,
      capturedAt: new Date().toISOString(),
      graph: { ...graph, nodes: graphNodes },
      nodeRecords,
      completedNodeIds: cat.completed,
      runningNodeIds:   [...cat.running, ...cat.retrying],
      pendingNodeIds:   [...cat.pending, ...cat.blocked],
      blockedNodeIds:   cat.blocked,
      failedNodeIds:    cat.failed,
      skippedNodeIds:   cat.skipped,
      variableState:    { ...variableState },
      runStatus,
      // Phase C Step 3: embed concurrency readiness report if available
      ...(this._concurrencyReport ? { concurrencyReadiness: this._concurrencyReport } : {}),
      // Phase C Step 4: embed failure propagation if any failures occurred
      ...(this._failurePropagation.rootFailureNodeIds.length > 0 || this._failurePropagation.timeline.propagatedSkipNodeIds.length > 0
        ? { failurePropagation: this._failurePropagation }
        : {}),
    };
  }

  // â”€â”€ private â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private _get(nodeId: string): NodeExecutionRecord {
    let rec = this._records.get(nodeId);
    if (!rec) {
      // Defensive: create on-the-fly if engine calls transition before initialise
      rec = { nodeId, nodeName: nodeId, status: 'pending' };
      this._records.set(nodeId, rec);
    }
    return rec;
  }

  private _transition(nodeId: string, status: WorkflowNodeStatus): void {
    this._get(nodeId).status = status;
  }
}

