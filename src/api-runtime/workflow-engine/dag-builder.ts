/**
 * dag-builder.ts
 * Live implementation — Phase B Step 5 extraction from apiRunner.ts.
 *
 * extractVarRefs, buildDAG, and topoSort moved here from src/utils/apiRunner.ts.
 * apiRunner.ts retains commented-out originals per CLAUDE.md comment-out rule.
 *
 * DEPENDENCY BOUNDARY:
 *   dag-builder.ts → shared-core/contracts  ✓
 *   dag-builder.ts → data/types             ✓
 *   dag-builder.ts → ui/ routes             ✗  never
 */

import type { IDagBuilder, DagGraph, DagNodeMeta, DependencyEdge } from '../../shared-core/contracts/dependency-graph.contract';
import type { ApiTestStep } from '../../data/types';

export { CircularDependencyError } from '../../shared-core/contracts/dependency-graph.contract';
export type { IDagBuilder, DagGraph };
import { CircularDependencyError } from '../../shared-core/contracts/dependency-graph.contract';

// NODE TYPE GUARD (Gate 3 — mandatory in ALL Phase B switch statements):
// Phase B DagBuilder handles HTTP nodes only. Any switch(node.nodeType) MUST include:
//
//   default:
//     throw new Error(`Unsupported nodeType: ${node.nodeType} — Phase B supports HTTP only`);
//
// Supported in Phase B: 'HTTP' only.
// Future (Phase C+): ASSERTION, EXTRACT, CONDITION, TRANSFORM, PARALLEL, CONTRACT, AI, LOOP.

// ── Variable reference scanner ────────────────────────────────────────────────

const VAR_REF_RE = /\{\{([^}]+)\}\}|\$\{([^}]+)\}/g;

/**
 * Scan a step for all variable references in URL, headers, and body.
 * Used to auto-derive implicit DAG edges (extraction producer → consumer).
 */
export function extractVarRefs(step: ApiTestStep): string[] {
  const refs: string[] = [];
  const scan = (s: string) => { for (const m of s.matchAll(VAR_REF_RE)) refs.push(m[1] ?? m[2]); };
  scan(step.request.url);
  if (step.request.headers) {
    const hdrs = step.request.headers;
    if (Array.isArray(hdrs)) {
      hdrs.forEach((h: { key?: string; value?: string }) => {
        if (h.value) scan(h.value);
        if (h.key) scan(h.key);
      });
    } else {
      Object.values(hdrs as Record<string, string>).forEach(scan);
    }
  }
  if (step.request.body && typeof step.request.body === 'string') scan(step.request.body);
  return refs;
}

// ── DAG construction ──────────────────────────────────────────────────────────

/**
 * Build adjacency map: stepId → Set<prerequisite stepIds>.
 * Edges come from three sources:
 *   1. step.dependsOn (explicit)
 *   2. variable refs that resolve to another step's extraction (implicit)
 *   3. group ordering: lower-order steps in same group are prerequisites
 */
export function buildAdjacency(steps: ApiTestStep[]): Map<string, Set<string>> {
  const extractionIndex = new Map<string, string>(); // varName → stepId
  for (const s of steps) {
    for (const e of s.extractVariables) extractionIndex.set(e.name, s.id);
  }

  const deps = new Map<string, Set<string>>();
  // INVARIANT: metadata fields (position, visualGroup, hierarchyPath) must never influence DAG construction. Read step.dependsOn only. See workflow.contract.ts.
  for (const s of steps) {
    const d = new Set(s.dependsOn ?? []);
    for (const ref of extractVarRefs(s)) {
      const producer = extractionIndex.get(ref);
      if (producer && producer !== s.id) d.add(producer);
    }
    // group ordering: steps in same group with lower order are prerequisites
    const sameGroup = steps.filter(
      x => x.group && x.group === s.group && x.id !== s.id && (x.order ?? 0) < (s.order ?? 0)
    );
    for (const g of sameGroup) d.add(g.id);
    deps.set(s.id, d);
  }
  return deps;
}

/**
 * Kahn's topological sort → execution waves.
 * Each wave contains steps that can run in parallel (no inter-wave dependencies).
 * Returns ApiTestStep[][] — same shape used by runCollection() wave loop.
 */
export function topoSort(steps: ApiTestStep[], deps: Map<string, Set<string>>): ApiTestStep[][] {
  // Build reverse-dep map and in-degree (number of unmet prerequisites per step)
  const revDeps = new Map<string, Set<string>>();
  for (const s of steps) revDeps.set(s.id, new Set());
  for (const [id, d] of deps) for (const dep of d) revDeps.get(dep)!.add(id);

  const deg = new Map<string, number>();
  for (const s of steps) deg.set(s.id, deps.get(s.id)!.size);

  const waves: ApiTestStep[][] = [];
  const remaining = new Set(steps.map(s => s.id));

  while (remaining.size > 0) {
    const wave = steps.filter(s => remaining.has(s.id) && deg.get(s.id) === 0);
    if (wave.length === 0) {
      const cycleNode = [...remaining][0];
      throw new CircularDependencyError(cycleNode);
    }
    waves.push(wave);
    for (const s of wave) {
      remaining.delete(s.id);
      for (const dependent of revDeps.get(s.id) ?? []) {
        deg.set(dependent, (deg.get(dependent) ?? 1) - 1);
      }
    }
  }
  return waves;
}

// ── IDagBuilder implementation ────────────────────────────────────────────────

export class DagBuilder implements IDagBuilder {
  build(steps: ApiTestStep[]): DagGraph {
    if (steps.length === 0) {
      return { nodes: new Map(), edges: [], layers: [], executionOrder: [], hasCycle: false };
    }

    // Phase B: HTTP nodes only guard
    for (const s of steps) {
      const nodeType = (s as { nodeType?: string }).nodeType;
      if (nodeType && nodeType !== 'HTTP') {
        throw new Error(`DagBuilder: unsupported nodeType '${nodeType}' — Phase B supports HTTP only`);
      }
    }

    const adjMap = buildAdjacency(steps);
    let waves: ApiTestStep[][];
    let hasCycle = false;
    let cyclePath: string[] | undefined;

    try {
      waves = topoSort(steps, adjMap);
    } catch (e: unknown) {
      hasCycle = true;
      cyclePath = e instanceof Error ? [e.message] : ['unknown cycle'];
      waves = [steps]; // fallback: treat all as one wave
    }

    // Build reverse-dep map for DagNodeMeta.dependents
    const dependentsMap = new Map<string, string[]>();
    for (const s of steps) dependentsMap.set(s.id, []);
    for (const [id, prereqs] of adjMap) {
      for (const prereq of prereqs) {
        dependentsMap.get(prereq)?.push(id);
      }
    }

    // Build DagNodeMeta for each step
    const nodes = new Map<string, DagNodeMeta>();
    const edges: DependencyEdge[] = [];

    for (let layerIdx = 0; layerIdx < waves.length; layerIdx++) {
      for (const s of waves[layerIdx]) {
        const prereqs = [...(adjMap.get(s.id) ?? [])];
        nodes.set(s.id, {
          nodeId: s.id,
          dependsOn: prereqs,
          dependents: dependentsMap.get(s.id) ?? [],
          layer: layerIdx,
          group: s.group,
          condition: s.execution?.condition,
        });
        for (const prereq of prereqs) {
          edges.push({ fromId: prereq, toId: s.id });
        }
      }
    }

    const layers = waves.map(w => w.map(s => s.id));
    const executionOrder = waves.flat().map(s => s.id);

    return { nodes, edges, layers, executionOrder, hasCycle, cyclePath };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _dagBuilder: DagBuilder | null = null;

export function getDagBuilder(): DagBuilder {
  if (!_dagBuilder) _dagBuilder = new DagBuilder();
  return _dagBuilder;
}
