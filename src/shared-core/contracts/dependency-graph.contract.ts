/**
 * dependency-graph.contract.ts
 * Stable contracts for DAG dependency metadata, execution state, and retry model.
 *
 * These live in shared-core/ (not api-runtime/) because:
 *   - execution-coordinator uses these to track all active runs
 *   - storage-provider persists ExecutionSnapshot using these types
 *   - future debugger UI reads these types to render the graph view
 *
 * The api-runtime/workflow-engine/dag-builder.ts implements IDagBuilder
 * using these contracts as its output model.
 */

import type { ApiTestStep } from '../../data/types';
import type { WorkflowNodeStatus } from './workflow.contract';
import type { VariableMap } from './variable.contract';

// â”€â”€ Node dependency metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * DependencyEdge â€” a directed edge in the execution graph.
 * fromId must complete before toId can run.
 */
export interface DependencyEdge {
  fromId: string;   // prerequisite node
  toId:   string;   // dependent node
  /** If true, toId is skipped (not just blocked) when fromId fails */
  skipOnFailure?: boolean;
}

/**
 * DagNodeMeta â€” DAG metadata attached to a step.
 * Separate from ApiTestStep so the step type is not polluted.
 */
export interface DagNodeMeta {
  nodeId: string;
  /** IDs of steps that must complete before this node can start */
  dependsOn: string[];
  /** IDs of steps that depend on this node's completion */
  dependents: string[];
  /**
   * Execution layer (0 = root nodes with no dependencies).
   * All nodes in the same layer are eligible for parallel execution.
   * Calculated by dag-builder â€” treat as read-only after build.
   */
  layer: number;
  /** Group used for parallel fan-out â€” nodes in same group run together */
  group?: string;
  /** Condition expression evaluated at runtime â€” node skipped if false */
  condition?: string;
}

/**
 * DagGraph â€” the fully built dependency graph for one workflow execution.
 */
export interface DagGraph {
  /** All node metadata keyed by nodeId */
  nodes: Map<string, DagNodeMeta>;
  /** All directed edges in the graph */
  edges: DependencyEdge[];
  /** Nodes grouped by layer â€” layer[0] runs first */
  layers: string[][];
  /** Topologically sorted node IDs â€” single-threaded execution order */
  executionOrder: string[];
  /** True if graph contains a cycle (invalid â€” collector rejects it) */
  hasCycle: boolean;
  /** Cycle path if hasCycle is true */
  cyclePath?: string[];
}

// â”€â”€ Execution state enums â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Why a node was skipped â€” preserves diagnostic detail */
export type SkipReason =
  | 'condition-false'      // step.execution.condition evaluated to false
  | 'dependency-failed'    // a dependsOn node failed + onFailure=skipDependents
  | 'dependency-skipped'   // a dependsOn node was itself skipped
  | 'manually-skipped'     // user explicitly skipped via debugger
  | 'target-not-selected'; // targetNodeIds filter excluded this node (selective rerun)

/** Why a node failed */
export type FailureReason =
  | 'assertion-failure'    // one or more assertions failed at critical/high severity
  | 'http-error'           // network error or non-retriable HTTP error
  | 'timeout'              // step timed out
  | 'script-error'         // preScript/postScript threw
  | 'extraction-error'     // required variable extraction failed
  | 'contract-violation'   // strict contract mode, schema violation
  | 'retry-exhausted';     // maxRetries reached

// â”€â”€ Retry state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RetryState {
  attempt: number;          // 0-based current attempt
  maxRetries: number;
  delayMs: number;
  lastError?: string;
  lastAttemptAt?: string;
  /** HTTP status codes that triggered retries */
  retriedOnStatuses: number[];

  // Phase C Step 4: retry exhaustion metadata
  /** True if all retries have been exhausted (attempt === maxRetries and still failing) */
  exhausted?: boolean;
  /** ISO timestamp of first failure in retry sequence */
  firstFailedAt?: string;
  /** Total wall-clock time spent in retry sequence (sum of delays + execution times) */
  totalRetryDurationMs?: number;
}

// â”€â”€ Per-node execution tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface NodeExecutionRecord {
  nodeId: string;
  nodeName: string;
  status: WorkflowNodeStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  retryState?: RetryState;
  skipReason?: SkipReason;
  failureReason?: FailureReason;
  /** Variable values at entry to this node */
  variablesBefore?: VariableMap;
  /** Variable values after extraction by this node */
  variablesAfter?: VariableMap;
  /** Contract violations reported (non-blocking unless strictContract) */
  contractViolations?: string[];
  error?: string;

  // â”€â”€ Phase C Step 2: replay-readiness metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** True if this node is eligible for selective rerun (failed or skipped) */
  rerunEligible?: boolean;
  /**
   * Dependency node IDs that must succeed before this node can be rerun.
   * Populated by the future rerun engine from DAG analysis â€” placeholder here.
   */
  rerunBlockedByNodeIds?: string[];
  /**
   * Opaque checkpoint reference for future checkpoint-based selective rerun.
   * Reserved â€” not populated until Phase C Step 3+.
   */
  checkpointId?: string;

  /** Artifact references for replay reconstruction â€” paths/IDs only, no inline binary */
  artifactRefs?: {
    harPath?: string;
    timelinePath?: string;
    runResultId?: string;
  };

  // Phase C Step 3: concurrency-readiness metadata
  /** True if static DAG analysis found this node eligible for parallel execution with wave siblings */
  parallelEligible?: boolean;
  /** Strongest isolation constraint detected for this node. Enforcement deferred to Phase C Step 4. */
  isolationLevel?: 'none' | 'variable' | 'group' | 'explicit';
  /** DAG layer (= batch index) this node belongs to */
  concurrencyBatchId?: number;

  // Phase C Step 4: failure lifecycle + recovery metadata
  /** Failure class -- formal taxonomy beyond FailureReason */
  failureClass?: import('../../api-runtime/workflow-engine/failure-classifier').FailureClass;
  /** Recovery eligibility -- drives future selective rerun engine */
  recoveryEligibility?: import('../../api-runtime/workflow-engine/failure-classifier').RecoveryEligibility;
  /** Per-attempt retry history -- appended by executeWithRetry, immutable after capture */
  retryHistory?: import('../../api-runtime/workflow-engine/failure-propagation').RetryHistoryEntry[];
  /** Node IDs whose failure directly caused this node to be skipped */
  blockedByNodeIds?: string[];
  /** Node IDs that were skipped because this node failed */
  propagatedSkipToNodeIds?: string[];
}

// â”€â”€ Execution snapshot â€” serializable run state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * ExecutionSnapshot â€” full serializable state of a run at a point in time.
 * Stored to disk by storage-provider/execution-store.ts for crash recovery
 * and selective rerun support (Phase C).
 */
export interface ExecutionSnapshot {
  runId: string;
  collectionId: string;
  projectId?: string;
  capturedAt: string;

  /** Full DAG as built for this run */
  graph: Omit<DagGraph, 'nodes'> & { nodes: Record<string, DagNodeMeta> };

  /** Per-node execution records keyed by nodeId */
  nodeRecords: Record<string, NodeExecutionRecord>;

  /** Categorised node ID lists for quick coordinator lookup */
  completedNodeIds: string[];
  runningNodeIds:   string[];
  pendingNodeIds:   string[];
  blockedNodeIds:   string[];
  failedNodeIds:    string[];
  skippedNodeIds:   string[];

  /** Full variable context at time of snapshot */
  variableState: VariableMap;

  /** Run-level status â€” derived from node statuses */
  runStatus: 'running' | 'completed' | 'failed' | 'cancelled';

  // Phase C Step 3: optional concurrency readiness report
  concurrencyReadiness?: import('../../api-runtime/workflow-engine/parallel-eligibility').ConcurrencyReadinessReport;

  // Phase C Step 4: failure propagation record
  /** Full failure lifecycle record -- populated when any node fails */
  failurePropagation?: import('../../api-runtime/workflow-engine/failure-propagation').FailurePropagationRecord;
}

// â”€â”€ DAG builder contract (moved here from api-runtime for stable sharing) â”€â”€â”€â”€â”€

export interface IDagBuilder {
  build(steps: ApiTestStep[]): DagGraph;
}

// â”€â”€ Errors â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string) {
    super(`Circular dependency detected: ${cycle}`);
    this.name = 'CircularDependencyError';
  }
}


