// src/workflow-graph/projection/hierarchy-flattener.ts
import type { FolderNode } from '../../shared-core/contracts/workflow.contract';
import type { HierarchyNode, HierarchyProjection } from '../contracts/graph.contracts';

export function flattenHierarchy(root: FolderNode | undefined): HierarchyProjection {
  if (!root) return { rootId: null, nodes: [] };

  const nodes: HierarchyNode[] = [];
  const visited = new Set<string>();

  function dfs(node: FolderNode, parentId?: string): void {
    if (visited.has(node.id)) return; // cycle guard
    visited.add(node.id);

    nodes.push({
      id: node.id,
      name: node.name,
      depth: node.depth,
      parentId,
      stepIds: node.stepIds,
    });

    for (const child of node.children) {
      dfs(child, node.id);
    }
  }

  dfs(root);

  // Sort by depth then id for determinism
  nodes.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));

  return { rootId: root.id, nodes };
}
