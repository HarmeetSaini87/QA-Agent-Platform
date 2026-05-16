// src/workflow-graph/projection/cluster-builder.ts
import type { WorkflowNormalizationSource } from '../../shared-core/contracts/workflow.contract';
import type { GraphClusterProjection, VisualNode } from '../contracts/graph.contracts';

function resolveClusterSource(
  normalizationSource: WorkflowNormalizationSource | undefined
): 'folder' | 'tag' {
  return normalizationSource === 'openapi' ? 'tag' : 'folder';
}

export function buildClusters(
  nodes: readonly VisualNode[],
  suggestedGroups: string[] | undefined,
  normalizationSource: WorkflowNormalizationSource | undefined
): GraphClusterProjection[] {
  const clusterMap = new Map<string, { label: string; nodeIds: string[]; source: 'folder' | 'tag' | 'hint' }>();
  const primarySource = resolveClusterSource(normalizationSource);

  // Group by visualGroup
  for (const node of nodes) {
    if (!node.visualGroup) continue;
    const key = `${primarySource}:${node.visualGroup}`;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, { label: node.visualGroup, nodeIds: [], source: primarySource });
    }
    clusterMap.get(key)!.nodeIds.push(node.id);
  }

  // Append hint clusters from suggestedGroups — never merge with folder/tag
  for (const group of suggestedGroups ?? []) {
    const key = `hint:${group}`;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, { label: group, nodeIds: [], source: 'hint' });
    }
  }

  const clusters: GraphClusterProjection[] = Array.from(clusterMap.entries()).map(
    ([clusterId, { label, nodeIds, source }]) => ({
      clusterId,
      label,
      nodeIds,
      source,
    })
  );

  // Sort by clusterId for determinism
  clusters.sort((a, b) => a.clusterId.localeCompare(b.clusterId));

  return clusters;
}
