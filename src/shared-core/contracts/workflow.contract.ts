/**
 * workflow.contract.ts
 * Shared contracts for the WorkflowEnvelope DSL.
 *
 * INVARIANTS:
 *   - ApiTestStep[] is NEVER replaced — only wrapped.
 *   - Existing ApiCollection maps 1:1 via workflow-dsl/legacy-adapter.ts.
 *   - WorkflowNode is a strict superset of ApiTestStep — backward compatible.
 */

import type { ApiTestStep } from '../../data/types';

// ── Enums ─────────────────────────────────────────────────────────────────────

export type WorkflowExecutionMode = 'sequential' | 'dag' | 'parallel';

export type WorkflowSource = 'manual' | 'openapi' | 'postman' | 'curl' | 'ai';

/** Node lifecycle state machine — not present in current ApiStepResult */
export type WorkflowNodeStatus =
  | 'pending'    // not yet scheduled
  | 'blocked'    // waiting on dependsOn steps
  | 'running'    // currently executing
  | 'retrying'   // failed, within retry budget
  | 'completed'  // passed all assertions
  | 'failed'     // exhausted retries or critical assertion failure
  | 'skipped';   // condition evaluated false OR skipDependents propagation

// ── Execution config ──────────────────────────────────────────────────────────

export interface WorkflowExecutionConfig {
  mode: WorkflowExecutionMode;
  maxConcurrency?: number;
  timeoutMs?: number;
  onFailure?: 'stop' | 'continue' | 'skipDependents';
  logLevel?: 'minimal' | 'standard' | 'verbose';
  rateLimit?: { requestsPerSecond: number };
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export interface WorkflowMetadata {
  createdAt: string;
  source: WorkflowSource;
  collectionId: string;
  projectId?: string;
  tags?: string[];
  /** Bumped when envelope schema changes — enables migration detection */
  version?: string;
  /** Human description for AI-generated or imported workflows */
  description?: string;
}

// ── Contract config ───────────────────────────────────────────────────────────

export interface WorkflowContractConfig {
  openapiSpecId?: string;
  validateResponse?: boolean;
  baselineRunId?: string;
  /** Drift violations block execution (true) or report only (false, default) */
  strictContract?: boolean;
}

// ── WorkflowNode — superset of ApiTestStep ───────────────────────────────────

/**
 * WorkflowNode wraps ApiTestStep and adds DAG + node-type metadata.
 *
 * Phase A: step is always ApiTestStep, nodeType is always 'HTTP'.
 * Phase B+: execution-engine switches on nodeType; non-HTTP nodes
 *            carry a discriminated union payload instead of ApiTestStep.
 *
 * Backward compat rule: every existing ApiTestStep is a valid WorkflowNode
 * with nodeType='HTTP' and no additional fields required.
 */
export interface WorkflowNode {
  /** nodeType discriminates future non-HTTP node variants (Phase B+) */
  nodeType: 'HTTP' | 'ASSERTION' | 'EXTRACT' | 'CONDITION' | 'TRANSFORM' | 'PARALLEL' | 'CONTRACT' | 'AI' | 'LOOP';
  /** Underlying step — always present for HTTP nodes; Phase B+ may omit for synthetic nodes */
  step: ApiTestStep;
  /** Override dependsOn from step.dependsOn for explicit DAG annotation */
  dependsOn?: string[];
  /** DAG layer (0 = root, calculated by dag-builder) — read-only after build */
  layer?: number;
  /** Group label for UI display and parallel fan-out grouping */
  group?: string;
  /** Disable this node without removing it */
  disabled?: boolean;
}

// ── WorkflowEnvelope — top-level DSL model ───────────────────────────────────

/**
 * WorkflowEnvelope — thin wrapper around existing ApiTestStep[].
 *
 * Two valid shapes:
 *   legacyNodes  — ApiTestStep[] (existing collections, Phase A)
 *   nodes        — WorkflowNode[] (Phase B+, richer DAG metadata)
 *
 * Both are present as optional; legacy-adapter populates legacyNodes only.
 * Phase B extraction populates nodes and deprecates legacyNodes.
 */
export interface WorkflowEnvelope {
  schemaVersion: '1.0';
  workflow: {
    id: string;
    name: string;
    /** Phase A: existing ApiTestStep[] from ApiCollection.steps — unchanged */
    legacyNodes: ApiTestStep[];
    /** Phase B+: richer node model with explicit DAG metadata */
    nodes?: WorkflowNode[];
  };
  execution: WorkflowExecutionConfig;
  metadata: WorkflowMetadata;
  contracts?: WorkflowContractConfig;
}
