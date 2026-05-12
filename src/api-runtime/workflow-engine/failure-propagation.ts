/**
 * failure-propagation.ts — FailurePropagationRecord + RetryHistoryEntry
 * Phase C Step 4: Failure Propagation & Recovery Evolution.
 *
 * WHAT THIS ADDS:
 *   - RetryHistoryEntry: per-attempt record (attempt#, status, error, duration)
 *   - FailurePropagationRecord: full failure chain for one run
 *     — root cause node, downstream blocked nodes, failure class, timeline
 *   - FailureTimeline: ordered sequence of failure transition events
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - executeWithRetry semantics (unchanged)
 *   - engine.ts execution order (unchanged)
 *   - Any DAG or variable logic
 *
 * Types are serialisable — safe for ExecutionSnapshot embedding.
 */

import type { FailureReason } from '../../shared-core/contracts/dependency-graph.contract';
import type { FailureClass, RecoveryEligibility } from './failure-classifier';

// ── Per-attempt history ───────────────────────────────────────────────────────

/**
 * One retry attempt record — captured by executeWithRetry per attempt.
 * Immutable after capture. Never overwrites — always appended.
 */
export interface RetryHistoryEntry {
  attempt: number;          // 0-based
  startedAt: string;        // ISO
  completedAt: string;      // ISO
  durationMs: number;
  httpStatus?: number;      // response status if available
  error?: string;           // transport error message if status='error'
  resultStatus: 'passed' | 'failed' | 'error' | 'skipped' | 'degraded';
  /** True if this attempt triggered a retry (not the final attempt) */
  retriedAfter: boolean;
}

// ── Failure propagation event ─────────────────────────────────────────────────

/**
 * One failure propagation event — when a node failure causes another node to skip.
 */
export interface FailurePropagationEvent {
  /** The node whose failure caused the propagation */
  causingNodeId: string;
  causingNodeName: string;
  /** The node that was blocked/skipped as a result */
  affectedNodeId: string;
  affectedNodeName: string;
  /** How the downstream node was affected */
  propagationType: 'dependency-skip' | 'abort-stop' | 'skipDependents';
  at: string;  // ISO
  waveIndex: number;
}

// ── Failure timeline ──────────────────────────────────────────────────────────

/**
 * Ordered sequence of failure-related transitions for one run.
 * Append-only — entries are never removed or modified.
 */
export interface FailureTimeline {
  /** All failure events in chronological order */
  events: FailureTimelineEvent[];
  /** IDs of nodes that failed terminally (no more retries) */
  terminalFailureNodeIds: string[];
  /** IDs of nodes that were blocked by upstream failures */
  propagatedSkipNodeIds: string[];
  /** Total retry attempts across all nodes */
  totalRetryAttempts: number;
}

export type FailureTimelineEvent =
  | { type: 'node-failed';      nodeId: string; reason: FailureReason; at: string; attempt: number; retriable: boolean }
  | { type: 'retry-scheduled';  nodeId: string; attempt: number; delayMs: number; at: string }
  | { type: 'retry-exhausted';  nodeId: string; totalAttempts: number; at: string }
  | { type: 'dep-blocked';      nodeId: string; causedBy: string; at: string }
  | { type: 'abort-triggered';  triggeredBy: string; affectedCount: number; at: string };

// ── Full propagation record for one run ───────────────────────────────────────

/**
 * FailurePropagationRecord — complete failure lifecycle for one collection run.
 * Stored in ExecutionSnapshot.failurePropagation.
 * Read by future rerun engine to reconstruct recovery targets.
 */
export interface FailurePropagationRecord {
  /** IDs of nodes that failed and exhausted all retries */
  rootFailureNodeIds: string[];
  /** Map nodeId → downstream nodes blocked by that failure */
  downstreamImpact: Record<string, string[]>;
  /** Map nodeId → failure class */
  failureClasses: Record<string, FailureClass>;
  /** Map nodeId → recovery eligibility */
  recoveryEligibility: Record<string, RecoveryEligibility>;
  /** Map nodeId → full retry history (all attempts) */
  retryHistory: Record<string, RetryHistoryEntry[]>;
  /** Ordered failure propagation events */
  propagationEvents: FailurePropagationEvent[];
  /** Failure timeline */
  timeline: FailureTimeline;
  /** ISO timestamp when this record was finalised */
  finalisedAt: string;
}

// ── RecoveryPlan (future rerun engine input) ──────────────────────────────────

/**
 * Minimal recovery plan derived from FailurePropagationRecord.
 * Prepared now; consumed by future Phase C Step 5+ rerun engine.
 * Never executed here — metadata only.
 */
export interface RecoveryPlan {
  /** Nodes to rerun (failed + their downstream-blocked nodes) */
  targetNodeIds: string[];
  /** Nodes to skip (completed — no rerun needed) */
  skipNodeIds: string[];
  /** Nodes that block recovery (terminal failures requiring manual fix) */
  blockingNodeIds: string[];
  /** Checkpoint snapshot ID to resume from (populated by future checkpoint engine) */
  fromCheckpointId?: string;
  /** ISO when plan was generated */
  generatedAt: string;
}

// ── Builder helpers ───────────────────────────────────────────────────────────

export function createEmptyFailurePropagationRecord(): FailurePropagationRecord {
  return {
    rootFailureNodeIds: [],
    downstreamImpact: {},
    failureClasses: {},
    recoveryEligibility: {},
    retryHistory: {},
    propagationEvents: [],
    timeline: {
      events: [],
      terminalFailureNodeIds: [],
      propagatedSkipNodeIds: [],
      totalRetryAttempts: 0,
    },
    finalisedAt: '',
  };
}

export function deriveRecoveryPlan(
  propagationRecord: FailurePropagationRecord,
  allNodeIds: string[],
): RecoveryPlan {
  const targetSet = new Set<string>();
  const blockingSet = new Set<string>();

  for (const nodeId of propagationRecord.rootFailureNodeIds) {
    const eligibility = propagationRecord.recoveryEligibility[nodeId];
    if (eligibility === 'not-eligible') {
      blockingSet.add(nodeId);
    } else {
      targetSet.add(nodeId);
    }
    // Add downstream blocked nodes as recovery targets (if their blocker is eligible)
    for (const downstream of (propagationRecord.downstreamImpact[nodeId] ?? [])) {
      if (!blockingSet.has(nodeId)) targetSet.add(downstream);
    }
  }

  // Nodes eligible-with-deps that depend on blocking nodes are also blocked
  for (const nodeId of targetSet) {
    const eligibility = propagationRecord.recoveryEligibility[nodeId];
    if (eligibility === 'eligible-with-deps') {
      // Check if any of its upstream blockers are terminal
      const impact = Object.entries(propagationRecord.downstreamImpact);
      for (const [upstreamId, downstreams] of impact) {
        if (downstreams.includes(nodeId) && blockingSet.has(upstreamId)) {
          targetSet.delete(nodeId);
          blockingSet.add(nodeId);
        }
      }
    }
  }

  const skipNodeIds = allNodeIds.filter(id => !targetSet.has(id) && !blockingSet.has(id));

  return {
    targetNodeIds: [...targetSet],
    skipNodeIds,
    blockingNodeIds: [...blockingSet],
    generatedAt: new Date().toISOString(),
  };
}
