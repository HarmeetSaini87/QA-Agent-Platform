/**
 * execution-context.contract.ts
 * ExecutionContext — the live runtime context passed into every node execution.
 *
 * This is the single object that crosses the boundary between:
 *   execution-coordinator → api-runtime → playwright-api-adapter
 *
 * It is runtime-agnostic: no Playwright types, no Express types.
 * Playwright adapter receives it and extracts only what it needs.
 *
 * Scope hierarchy carried inside:
 *   global → project → environment → collection → workflow → request → runtime
 */

import type { VariableMap, RuntimeVariableState } from './variable.contract';
import type { WorkflowExecutionConfig, WorkflowNodeStatus } from './workflow.contract';

// ── Scope layers ──────────────────────────────────────────────────────────────

/**
 * VariableScopeLayers — the full layered variable context.
 * Resolver merges from left (lowest priority) to right (highest).
 */
export interface VariableScopeLayers {
  global:      VariableMap;
  project:     VariableMap;
  environment: VariableMap;
  collection:  VariableMap;
  workflow:    VariableMap;
  request:     VariableMap;   // step-level overrides
  runtime:     VariableMap;   // accumulated extraction results so far
}

// ── Execution context ─────────────────────────────────────────────────────────

/**
 * ExecutionContext — passed to every node at execution time.
 * Immutable from the node's perspective: node reads scopes, engine writes runtime layer.
 */
export interface ExecutionContext {
  /** Unique run identifier */
  runId: string;
  /** Collection/workflow being executed */
  collectionId: string;
  projectId?: string;
  environmentId: string;

  /** Full layered variable scopes — node resolves from this */
  scopes: VariableScopeLayers;

  /** Merged flat context at entry to this node — convenience shortcut */
  mergedContext: VariableMap;

  /** Execution config from WorkflowEnvelope */
  executionConfig: WorkflowExecutionConfig;

  /** Node IDs that have already completed — used by condition evaluator */
  completedNodeIds: ReadonlySet<string>;

  /** Latest variable snapshots — keyed by nodeId that produced them */
  variableHistory: ReadonlyMap<string, RuntimeVariableState>;

  /** ISO timestamp when this run started */
  runStartedAt: string;

  /** Current attempt number for this node (0 = first attempt) */
  attempt: number;
}

// ── Node execution result fed back into context ───────────────────────────────

/**
 * NodeExecutionOutput — what a node produces after execution.
 * The coordinator merges this back into ExecutionContext.scopes.runtime
 * before scheduling dependent nodes.
 */
export interface NodeExecutionOutput {
  nodeId: string;
  status: WorkflowNodeStatus;
  /** New runtime variables extracted by this node */
  extractedVariables: VariableMap;
  /** Variable state snapshot after this node */
  variableSnapshot: RuntimeVariableState;
  durationMs: number;
  error?: string;
}
