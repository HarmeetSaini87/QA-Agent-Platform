/**
 * parallel-eligibility.ts — ParallelEligibilityAnalyser
 * Phase C Step 3: Controlled Parallel Execution Preparation.
 *
 * WHAT THIS ADDS (Phase C Step 3 only):
 *   - Parallel eligibility detection per node (dependency-safe, retry-safe, isolation-safe)
 *   - Dependency-safe batch grouping (same layer = same batch)
 *   - Variable mutation conflict detection (shared output names = potential conflict)
 *   - Concurrency readiness summary for the run
 *   - Future concurrency control hooks (interfaces only — no runtime scaling yet)
 *
 * WHAT THIS DOES NOT CHANGE:
 *   - Actual execution order (DAG wave loop in engine.ts unchanged)
 *   - maxConcurrency behaviour (runChunked call unchanged)
 *   - Retry semantics (retry-engine unchanged)
 *   - Variable propagation (apiVariables unchanged)
 *   - Any assertion, route, or collection schema
 *
 * CONCURRENCY PREPARATION ONLY — no worker pools, no distributed scheduling,
 * no aggressive parallel rollout. Metadata is computed and stored; execution
 * remains deterministic sequential-within-wave as today.
 *
 * ISOLATION LEVELS (metadata only, enforcement deferred to future Phase C Step 4):
 *   'none'     — no shared state risk detected; safe for future parallel execution
 *   'variable' — node reads/writes variables that overlap with sibling nodes
 *   'group'    — node is in a named group (group ordering must be preserved)
 *   'explicit' — node has explicit dependsOn edges (serialisation required)
 */

import type { DagGraph, DagNodeMeta } from '../../shared-core/contracts/dependency-graph.contract';
import type { ApiTestStep } from '../../data/types';
import { extractVarRefs } from './dag-builder';

// ── Eligibility types ─────────────────────────────────────────────────────────

/**
 * Isolation level hint for a node — how safe it is to run in parallel.
 * 'none' = safest (no shared state detected).
 * Enforcement is deferred to a future Phase C Step 4 executor.
 */
export type IsolationLevel = 'none' | 'variable' | 'group' | 'explicit';

/**
 * Parallel eligibility assessment for a single node.
 * Read-only metadata — does not change execution behaviour.
 */
export interface NodeParallelEligibility {
  nodeId: string;
  /** True if this node has zero DAG predecessors in its layer (layer === 0 or first in wave) */
  isRootNode: boolean;
  /** True if this node can run concurrently with all sibling nodes in the same layer */
  parallelEligible: boolean;
  /** DAG layer index — all nodes at same layer are wave-peers */
  layer: number;
  /** Strongest isolation constraint found for this node */
  isolationLevel: IsolationLevel;
  /**
   * Names of variables this node extracts (output surface).
   * Used for future conflict detection against sibling node inputs.
   */
  extractedVarNames: string[];
  /**
   * Names of variables this node consumes (input surface).
   * Used for future conflict detection — if sibling produces same name, ordering matters.
   */
  consumedVarNames: string[];
  /**
   * Sibling node IDs (same layer) that produce variables consumed by this node.
   * Non-empty means there is a within-layer variable ordering dependency.
   * For future conflict resolver — does not block execution today.
   */
  withinLayerConflictsWith: string[];
  /**
   * True if this node is safe to retry in parallel with other retrying nodes.
   * False if retry may mutate shared extracted variables that siblings depend on.
   */
  retrySafe: boolean;
}

/**
 * Batch of nodes that are dependency-safe to execute together.
 * Each batch corresponds to one DAG layer (wave).
 * Within a batch, execution today is runChunked (maxConcurrency-limited).
 * Future: these batches can be dispatched to a worker pool.
 */
export interface ConcurrencyBatch {
  batchIndex: number;
  /** DAG layer this batch corresponds to */
  layer: number;
  /** All node IDs in this batch (same dependency depth) */
  nodeIds: string[];
  /** Subset of nodeIds that are fully parallel-eligible (no within-layer conflicts) */
  eligibleNodeIds: string[];
  /** Subset of nodeIds with isolation constraints (variable/group/explicit) */
  constrainedNodeIds: string[];
  /** True if all nodes in batch are parallel-eligible */
  fullyParallelisable: boolean;
}

/**
 * Full concurrency readiness analysis for a run.
 * Attached to the ExecutionSnapshot as optional metadata.
 */
export interface ConcurrencyReadinessReport {
  /** Total nodes analysed */
  totalNodes: number;
  /** Nodes with parallelEligible === true */
  eligibleCount: number;
  /** Nodes with isolation constraints */
  constrainedCount: number;
  /** Per-batch analysis (one per DAG layer) */
  batches: ConcurrencyBatch[];
  /** Per-node eligibility records */
  nodeEligibility: Record<string, NodeParallelEligibility>;
  /**
   * True if the entire run could theoretically execute with full parallelism
   * (all nodes eligible, no within-layer conflicts).
   * For future scheduler optimisation hint only.
   */
  fullyParallelisable: boolean;
  /**
   * Conflict pairs: node IDs that share variable names within the same layer.
   * Each entry: [producerNodeId, consumerNodeId, varName].
   * For future conflict resolver — informational only today.
   */
  withinLayerConflicts: Array<[string, string, string]>;
  /** ISO timestamp when this analysis was computed */
  analysedAt: string;
}

// ── ParallelEligibilityAnalyser ───────────────────────────────────────────────

export class ParallelEligibilityAnalyser {
  /**
   * Analyse a DAG + steps for parallel eligibility.
   * Pure function — reads graph and steps, returns report. No side effects.
   * Call after dag-builder produces the DagGraph. Does not alter graph.
   */
  analyse(graph: DagGraph, steps: ApiTestStep[]): ConcurrencyReadinessReport {
    const analysedAt = new Date().toISOString();

    if (graph.nodes.size === 0) {
      return this._emptyReport(analysedAt);
    }

    // Index steps by ID for O(1) lookup
    const stepIndex = new Map<string, ApiTestStep>(steps.map(s => [s.id, s]));

    // Build extraction index: varName → nodeId (who produces it)
    const extractionProducer = new Map<string, string>();
    for (const s of steps) {
      for (const e of (s.extractVariables ?? [])) {
        extractionProducer.set(e.name, s.id);
      }
    }

    // Build per-node eligibility
    const nodeEligibility: Record<string, NodeParallelEligibility> = {};
    const withinLayerConflicts: Array<[string, string, string]> = [];

    // Group nodes by layer for sibling analysis
    const layerGroups = new Map<number, string[]>();
    for (const [id, meta] of graph.nodes) {
      const layer = meta.layer;
      if (!layerGroups.has(layer)) layerGroups.set(layer, []);
      layerGroups.get(layer)!.push(id);
    }

    for (const [nodeId, meta] of graph.nodes) {
      const step = stepIndex.get(nodeId);
      const extractedVarNames = step
        ? (step.extractVariables ?? []).map(e => e.name)
        : [];
      const consumedVarNames = step ? extractVarRefs(step) : [];

      const isolationLevel = this._computeIsolation(meta, step);

      // Within-layer conflict: sibling in same layer produces a var this node consumes
      const siblings = (layerGroups.get(meta.layer) ?? []).filter(id => id !== nodeId);
      const conflicts: string[] = [];
      for (const varName of consumedVarNames) {
        const producer = extractionProducer.get(varName);
        if (producer && siblings.includes(producer)) {
          conflicts.push(producer);
          withinLayerConflicts.push([producer, nodeId, varName]);
        }
      }

      const parallelEligible =
        isolationLevel === 'none' && conflicts.length === 0;

      // retrySafe: safe if node does not produce variables consumed by siblings in same layer
      const retrySafe = !extractedVarNames.some(name =>
        siblings.some(sibId => {
          const sib = stepIndex.get(sibId);
          return sib ? extractVarRefs(sib).includes(name) : false;
        })
      );

      nodeEligibility[nodeId] = {
        nodeId,
        isRootNode: meta.dependsOn.length === 0,
        parallelEligible,
        layer: meta.layer,
        isolationLevel,
        extractedVarNames,
        consumedVarNames,
        withinLayerConflictsWith: [...new Set(conflicts)],
        retrySafe,
      };
    }

    // Build batches (one per layer)
    const batches: ConcurrencyBatch[] = [];
    const sortedLayers = [...layerGroups.keys()].sort((a, b) => a - b);
    for (const layer of sortedLayers) {
      const nodeIds = layerGroups.get(layer)!;
      const eligibleNodeIds = nodeIds.filter(id => nodeEligibility[id]?.parallelEligible);
      const constrainedNodeIds = nodeIds.filter(id => !nodeEligibility[id]?.parallelEligible);
      batches.push({
        batchIndex: layer,
        layer,
        nodeIds,
        eligibleNodeIds,
        constrainedNodeIds,
        fullyParallelisable: constrainedNodeIds.length === 0,
      });
    }

    const allNodes = Object.values(nodeEligibility);
    const eligibleCount = allNodes.filter(n => n.parallelEligible).length;
    const constrainedCount = allNodes.filter(n => !n.parallelEligible).length;
    const fullyParallelisable =
      constrainedCount === 0 && withinLayerConflicts.length === 0;

    return {
      totalNodes: allNodes.length,
      eligibleCount,
      constrainedCount,
      batches,
      nodeEligibility,
      fullyParallelisable,
      withinLayerConflicts,
      analysedAt,
    };
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _computeIsolation(meta: DagNodeMeta, step?: ApiTestStep): IsolationLevel {
    // Explicit dependsOn edges = must run after those nodes
    if (meta.dependsOn.length > 0) return 'explicit';

    // Named group = group ordering must be preserved (lower order before higher)
    if (meta.group) return 'group';

    // Variable consumption from prior layers is already encoded in dependsOn by dag-builder.
    // If we reach here, no explicit ordering required — check for variable overlap at runtime.
    // For now: 'none' (no constraint detected from static analysis alone).
    // Future: inspect step.execution for write-side effects, auth mutations, etc.
    void step; // reserved for future analysis
    return 'none';
  }

  private _emptyReport(analysedAt: string): ConcurrencyReadinessReport {
    return {
      totalNodes: 0,
      eligibleCount: 0,
      constrainedCount: 0,
      batches: [],
      nodeEligibility: {},
      fullyParallelisable: true,
      withinLayerConflicts: [],
      analysedAt,
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _analyser: ParallelEligibilityAnalyser | null = null;

export function getParallelEligibilityAnalyser(): ParallelEligibilityAnalyser {
  if (!_analyser) _analyser = new ParallelEligibilityAnalyser();
  return _analyser;
}
