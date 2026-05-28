// src/workflow-graph/projection/graph-projection-builder.ts
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';
import {
  PROJECTION_VERSION,
  MAX_GRAPH_NODE_COUNT,
  type GraphProjection,
  type VisualNode,
  type VisualEdge,
  type ProjectionMeta,
  type ProjectionWarning,
  type ProjectionStrategy,
  type VirtualizationReadiness,
} from '../contracts/graph.contracts';

// Phase E Step 1: Node count thresholds for rendering guidance.
const VIRTUALIZATION_WARNING_THRESHOLD = 100;
const VIRTUALIZATION_PAGE_SIZE_SMALL = 50;
const VIRTUALIZATION_PAGE_SIZE_LARGE = 25;
import { computeAutoLayout } from './auto-layout';
import { shimLegacyNodes } from './legacy-node-shim';
import { flattenHierarchy } from './hierarchy-flattener';
import { buildClusters } from './cluster-builder';

export interface BuildGraphProjectionOptions {
  projectedAt: string;
}

export function buildGraphProjection(
  envelope: WorkflowEnvelope,
  opts: BuildGraphProjectionOptions
): GraphProjection {
  const warnings: ProjectionWarning[] = [];
  const { workflow, metadata } = envelope;

  // Resolve nodes — prefer nodes[] over legacyNodes
  const rawNodes = workflow.nodes ?? shimLegacyNodes(workflow.legacyNodes);
  if (!workflow.nodes && workflow.legacyNodes.length > 0) {
    warnings.push({ code: 'LEGACY_NODE_PROJECTION', detail: `${workflow.legacyNodes.length} legacy steps shimmed` });
  }

  // Large graph warning
  if (rawNodes.length > MAX_GRAPH_NODE_COUNT) {
    warnings.push({ code: 'LARGE_GRAPH_WARNING', detail: `${rawNodes.length} nodes exceeds limit of ${MAX_GRAPH_NODE_COUNT}` });
  }

  // Build VisualNodes — assign layers by order (index as layer), compute positions
  const nodeIdSet = new Set<string>();
  const visualNodes: VisualNode[] = [];

  for (let i = 0; i < rawNodes.length; i++) {
    const node = rawNodes[i];
    const step = node.step;
    const id = step.id;
    nodeIdSet.add(id);

    const storedPos = node.position;
    const layer = node.layer ?? i;
    const indexWithinLayer = i;

    let position: VisualNode['position'];
    let isAutoPositioned: boolean;

    if (storedPos) {
      position = { x: storedPos.x, y: storedPos.y, locked: storedPos.locked };
      isAutoPositioned = false;
    } else {
      const auto = computeAutoLayout(layer, indexWithinLayer);
      position = { x: auto.x, y: auto.y };
      isAutoPositioned = true;
    }

    visualNodes.push({
      id,
      label: step.name ?? id,
      nodeType: node.nodeType,
      position,
      isAutoPositioned,
      layer,
      indexWithinLayer,
      group: node.group,
      visualGroup: node.visualGroup,
      hierarchyPath: node.hierarchyPath ? [...node.hierarchyPath] : undefined,
      disabled: node.disabled,
      status: undefined,
    });
  }

  // Build edges — depends_on edges first, then inferred
  const edgeSet = new Set<string>();
  const dependsOnEdges: VisualEdge[] = [];
  const inferredEdges: VisualEdge[] = [];

  for (const node of rawNodes) {
    const step = node.step;
    const target = step.id;
    const deps = node.dependsOn ?? step.dependsOn ?? [];

    for (const source of deps) {
      if (!nodeIdSet.has(source)) {
        warnings.push({ code: 'INFERRED_EDGE_DROPPED', detail: `Dangling ref: ${source} → ${target}` });
        continue;
      }
      const edgeId = `${source}:${target}:depends_on`;
      if (edgeSet.has(edgeId)) continue;
      edgeSet.add(edgeId);
      dependsOnEdges.push({ id: edgeId, source, target, edgeType: 'depends_on' });
    }
  }

  // Inferred sequential edges for nodes without explicit deps (sequential flow)
  for (let i = 1; i < rawNodes.length; i++) {
    const source = rawNodes[i - 1].step.id;
    const target = rawNodes[i].step.id;
    const hasDeps = (rawNodes[i].dependsOn ?? rawNodes[i].step.dependsOn ?? []).length > 0;
    if (hasDeps) continue; // already has explicit deps

    const dependsOnKey = `${source}:${target}:depends_on`;
    if (edgeSet.has(dependsOnKey)) continue;

    const edgeId = `${source}:${target}:inferred`;
    if (edgeSet.has(edgeId)) continue;
    edgeSet.add(edgeId);
    inferredEdges.push({ id: edgeId, source, target, edgeType: 'inferred', isHeuristic: true });
  }

  // depends_on edges come before inferred for same source:target
  const edges: VisualEdge[] = [...dependsOnEdges, ...inferredEdges];

  // Determine projectionStrategy
  const storedCount = visualNodes.filter(n => !n.isAutoPositioned).length;
  let projectionStrategy: ProjectionStrategy;
  if (storedCount === 0) {
    projectionStrategy = 'auto-layout';
  } else if (storedCount === visualNodes.length) {
    projectionStrategy = 'stored';
  } else {
    projectionStrategy = 'hybrid';
  }

  // Hierarchy
  const hierarchy = flattenHierarchy(metadata.folderHierarchy);

  // Clusters
  const clusters = buildClusters(
    visualNodes,
    metadata.graphHints?.suggestedGroups,
    metadata.normalizationSource
  );

  // Phase E Step 1: Compute virtualization readiness hints for large graph frontend rendering.
  const virtualizationReadiness: VirtualizationReadiness | undefined =
    visualNodes.length >= VIRTUALIZATION_WARNING_THRESHOLD
      ? {
          shouldVirtualize: true,
          recommendedPageSize: visualNodes.length >= MAX_GRAPH_NODE_COUNT
            ? VIRTUALIZATION_PAGE_SIZE_LARGE
            : VIRTUALIZATION_PAGE_SIZE_SMALL,
          collapseHierarchyByDefault: hierarchy.rootId !== null && visualNodes.length >= MAX_GRAPH_NODE_COUNT / 2,
        }
      : undefined;

  const meta: ProjectionMeta = {
    collectionId: workflow.id,
    projectedAt: opts.projectedAt,
    projectionVersion: PROJECTION_VERSION,
    projectionStrategy,
    metadataVersion: metadata.metadataVersion,
    normalizationSource: metadata.normalizationSource,
    isHeuristic: metadata.graphHints?.isHeuristic ?? false,
    nodeCount: visualNodes.length,
    edgeCount: edges.length,
    hasHierarchy: hierarchy.rootId !== null,
    hasAiReadiness: metadata.aiReadiness !== undefined,
    virtualizationReadiness,
  };

  return {
    nodes: visualNodes,
    edges,
    hierarchy,
    clusters,
    meta,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}
