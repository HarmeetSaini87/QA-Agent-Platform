/**
 * failure-classifier.ts — FailureClassifier
 * Phase C Step 4: Failure Propagation & Recovery Evolution.
 *
 * WHAT THIS ADDS (Phase C Step 4 only):
 *   - Formal FailureClass taxonomy (7 classes)
 *   - Classification of FailureReason → FailureClass
 *   - Recovery eligibility derivation per failure class
 *   - Downstream impact metadata (which nodes are blocked by this failure)
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Retry semantics (retry-engine unchanged)
 *   - FailureReason values (contract unchanged)
 *   - DAG ordering logic (unchanged)
 *   - Any execution path in engine.ts
 *
 * Classification is pure + stateless — no I/O, no side effects.
 */

import type { FailureReason } from '../../shared-core/contracts/dependency-graph.contract';

// ── FailureClass taxonomy ─────────────────────────────────────────────────────

/**
 * Formal failure classification for enterprise lifecycle tracking.
 *
 * retryable          — transient failure; retry budget may recover it
 * terminal           — non-recoverable at this node; must fix before rerun
 * dependency-blocked — this node was never attempted; upstream failed
 * validation-failed  — assertion or contract check failed; data issue
 * transport-failed   — network/HTTP layer failure; infra issue
 * assertion-failed   — assertion evaluation failed; test logic issue
 * timeout-failed     — step exceeded timeoutMs; latency/infra issue
 */
export type FailureClass =
  | 'retryable'
  | 'terminal'
  | 'dependency-blocked'
  | 'validation-failed'
  | 'transport-failed'
  | 'assertion-failed'
  | 'timeout-failed';

/**
 * Recovery eligibility for a failed node.
 * Drives future selective-rerun engine.
 */
export type RecoveryEligibility =
  | 'eligible'           // can be rerun directly
  | 'eligible-with-deps' // can be rerun after fixing upstream failures
  | 'not-eligible'       // terminal failure; manual intervention required
  | 'skipped-recovery';  // was skipped (condition-false); rerun if condition changes

/**
 * Full failure classification result for one node.
 */
export interface NodeFailureClassification {
  nodeId: string;
  failureReason: FailureReason | undefined;
  failureClass: FailureClass;
  recoveryEligibility: RecoveryEligibility;
  /**
   * True if the failure is transient and a retry within budget could recover it.
   * Used by scheduler to decide whether to emit onNodeRetry vs onNodeFail terminal.
   */
  isRetryCandidate: boolean;
  /**
   * True if this failure has or will propagate to downstream nodes.
   * True when onFailure = 'stop' or 'skipDependents' and node has dependents.
   */
  hasPropagatedDownstream: boolean;
  /**
   * Node IDs directly blocked by this failure (first-order dependents).
   * Populated by engine when onFailure propagation occurs.
   */
  downstreamBlockedNodeIds: string[];
}

// ── FailureClassifier ─────────────────────────────────────────────────────────

export class FailureClassifier {
  /**
   * Classify a FailureReason into its FailureClass and recovery eligibility.
   * Pure function — no side effects.
   */
  classify(
    nodeId: string,
    failureReason: FailureReason | undefined,
    retryExhausted: boolean,
    downstreamBlockedNodeIds: string[] = [],
  ): NodeFailureClassification {
    const failureClass = this._toClass(failureReason, retryExhausted);
    const recoveryEligibility = this._toRecovery(failureClass);
    const isRetryCandidate = this._isRetryCandidate(failureReason, retryExhausted);

    return {
      nodeId,
      failureReason,
      failureClass,
      recoveryEligibility,
      isRetryCandidate,
      hasPropagatedDownstream: downstreamBlockedNodeIds.length > 0,
      downstreamBlockedNodeIds,
    };
  }

  /**
   * Classify a dependency-blocked node (never attempted — upstream failed/skipped).
   */
  classifyBlocked(nodeId: string, causedByNodeId: string): NodeFailureClassification {
    return {
      nodeId,
      failureReason: undefined,
      failureClass: 'dependency-blocked',
      recoveryEligibility: 'eligible-with-deps',
      isRetryCandidate: false,
      hasPropagatedDownstream: false,
      downstreamBlockedNodeIds: [],
    };
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _toClass(reason: FailureReason | undefined, retryExhausted: boolean): FailureClass {
    if (!reason) return 'terminal';
    switch (reason) {
      case 'http-error':           return retryExhausted ? 'terminal' : 'transport-failed';
      case 'timeout':              return retryExhausted ? 'terminal' : 'timeout-failed';
      case 'assertion-failure':    return 'assertion-failed';
      case 'contract-violation':   return 'validation-failed';
      case 'extraction-error':     return 'validation-failed';
      case 'script-error':         return 'terminal';
      case 'retry-exhausted':      return 'terminal';
    }
  }

  private _toRecovery(failureClass: FailureClass): RecoveryEligibility {
    switch (failureClass) {
      case 'retryable':            return 'eligible';
      case 'transport-failed':     return 'eligible';
      case 'timeout-failed':       return 'eligible';
      case 'assertion-failed':     return 'eligible';
      case 'validation-failed':    return 'eligible';
      case 'dependency-blocked':   return 'eligible-with-deps';
      case 'terminal':             return 'not-eligible';
    }
  }

  private _isRetryCandidate(reason: FailureReason | undefined, retryExhausted: boolean): boolean {
    if (retryExhausted) return false;
    if (!reason) return false;
    return reason === 'http-error' || reason === 'timeout' || reason === 'retry-exhausted';
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _classifier: FailureClassifier | null = null;

export function getFailureClassifier(): FailureClassifier {
  if (!_classifier) _classifier = new FailureClassifier();
  return _classifier;
}
