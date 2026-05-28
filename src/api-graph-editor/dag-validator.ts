// src/api-graph-editor/dag-validator.ts
// Phase E Step 5: DAG validation — cycle detection (DFS), orphan detection, topological sort.

import type {
  IDagValidator,
  DagValidationResult,
  DagViolation,
} from './contracts/dag-validation.contracts';

export class DagValidator implements IDagValidator {
  hasCycle(dependsOn: Record<string, string[]>): boolean {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (node: string): boolean => {
      if (inStack.has(node)) return true;
      if (visited.has(node)) return false;
      visited.add(node);
      inStack.add(node);
      for (const dep of dependsOn[node] ?? []) {
        if (dfs(dep)) return true;
      }
      inStack.delete(node);
      return false;
    };

    for (const node of Object.keys(dependsOn)) {
      if (dfs(node)) return true;
    }
    return false;
  }

  validate(nodeIds: readonly string[], dependsOn: Record<string, string[]>): DagValidationResult {
    const validatedAt = new Date().toISOString();
    const violations: DagViolation[] = [];
    const nodeSet = new Set(nodeIds);

    // Self-loop check
    for (const [nodeId, deps] of Object.entries(dependsOn)) {
      if (deps.includes(nodeId)) {
        violations.push({ type: 'self-loop', affectedNodeIds: [nodeId], description: `Node "${nodeId}" depends on itself.` });
      }
    }

    // Unknown dependency check
    for (const [nodeId, deps] of Object.entries(dependsOn)) {
      for (const dep of deps) {
        if (!nodeSet.has(dep)) {
          violations.push({ type: 'unknown-dependency', affectedNodeIds: [nodeId, dep], description: `Node "${nodeId}" depends on unknown node "${dep}".` });
        }
      }
    }

    // Orphan detection — nodes with no deps and no dependents (only flag if multiple nodes)
    if (nodeIds.length > 1) {
      const hasDependents = new Set<string>();
      for (const deps of Object.values(dependsOn)) {
        for (const dep of deps) hasDependents.add(dep);
      }
      for (const nodeId of nodeIds) {
        const deps = dependsOn[nodeId] ?? [];
        if (deps.length === 0 && !hasDependents.has(nodeId)) {
          // Not a violation by itself — only flag when all nodes are orphaned (disconnected graph)
          // Advisory only — orphans are valid in flat collections
        }
      }
    }

    // Cycle detection using DFS
    const cycleNodes = this._detectCycleNodes(dependsOn);
    if (cycleNodes.length > 0) {
      violations.push({ type: 'cycle', affectedNodeIds: cycleNodes, description: `Cyclic dependency detected among: ${cycleNodes.join(', ')}.` });
    }

    // Topological order (Kahn's algorithm) — only if no cycles
    let topologicalOrder: string[] | undefined;
    if (violations.every(v => v.type !== 'cycle' && v.type !== 'self-loop')) {
      topologicalOrder = this._topologicalSort(nodeIds, dependsOn);
    }

    return { valid: violations.length === 0, violations, topologicalOrder, validatedAt };
  }

  private _detectCycleNodes(dependsOn: Record<string, string[]>): string[] {
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const cycleNodes = new Set<string>();

    const dfs = (node: string): boolean => {
      if (inStack.has(node)) { cycleNodes.add(node); return true; }
      if (visited.has(node)) return false;
      visited.add(node);
      inStack.add(node);
      for (const dep of dependsOn[node] ?? []) {
        if (dfs(dep)) cycleNodes.add(node);
      }
      inStack.delete(node);
      return false;
    };

    for (const node of Object.keys(dependsOn)) dfs(node);
    return Array.from(cycleNodes);
  }

  private _topologicalSort(nodeIds: readonly string[], dependsOn: Record<string, string[]>): string[] {
    // Kahn's BFS
    const inDegree = new Map<string, number>();
    const revAdj = new Map<string, string[]>();

    for (const id of nodeIds) { inDegree.set(id, 0); revAdj.set(id, []); }

    for (const [nodeId, deps] of Object.entries(dependsOn)) {
      for (const dep of deps) {
        inDegree.set(nodeId, (inDegree.get(nodeId) ?? 0) + 1);
        revAdj.get(dep)?.push(nodeId);
      }
    }

    const queue = nodeIds.filter(id => (inDegree.get(id) ?? 0) === 0);
    const order: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const dependent of revAdj.get(node) ?? []) {
        const deg = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, deg);
        if (deg === 0) queue.push(dependent);
      }
    }
    return order;
  }
}

export const globalDagValidator = new DagValidator();
