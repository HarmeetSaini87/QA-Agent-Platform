// src/workflow-graph/contracts/graph.contracts.ts
import type {
  WorkflowNode,
  WorkflowNodeStatus,
  WorkflowNormalizationSource,
} from '../../shared-core/contracts/workflow.contract';

export const PROJECTION_VERSION = 1;
export const MAX_GRAPH_NODE_COUNT = 500;

export interface VisualNode {
  readonly id: string;
  readonly label: string;
  readonly nodeType: WorkflowNode['nodeType'];
  // Always populated — auto-layout fills this when no stored position exists.
  readonly position: {
    readonly x: number;
    readonly y: number;
    readonly locked?: boolean;
  };
  readonly isAutoPositioned?: boolean;
  readonly layer: number;
  /** Index of this node within its DAG layer — enables stable relayout and replay. */
  readonly indexWithinLayer: number;
  readonly group?: string;
  readonly visualGroup?: string;
  readonly hierarchyPath?: readonly string[];
  readonly disabled?: boolean;
  readonly status?: WorkflowNodeStatus;
}

export interface VisualEdge {
  readonly id: string; // `${source}:${target}:${edgeType}`
  readonly source: string;
  readonly target: string;
  readonly edgeType: 'depends_on' | 'inferred' | 'group';
  readonly isHeuristic?: boolean;
}

export interface HierarchyNode {
  readonly id: string;
  readonly name: string;
  readonly depth: number;
  readonly parentId?: string;
  readonly stepIds: readonly string[];
}

export interface HierarchyProjection {
  readonly rootId: string | null;
  readonly nodes: readonly HierarchyNode[];
}

export interface GraphClusterProjection {
  /**
   * Composite key: `${source}:${label}`.
   * @example "folder:Pets API" | "hint:CRUD" | "tag:pets"
   */
  readonly clusterId: string;
  readonly label: string;
  readonly nodeIds: readonly string[];
  readonly source: 'folder' | 'tag' | 'hint';
}

/** Phase E Step 1: Frontend rendering guidance for large graphs. Advisory — never alters projection data. */
export interface VirtualizationReadiness {
  /** True when node count exceeds the rendering warning threshold. */
  readonly shouldVirtualize: boolean;
  /** Suggested page size for deferred node rendering. */
  readonly recommendedPageSize: number;
  /** True when hierarchy collapse is recommended to reduce initial node count. */
  readonly collapseHierarchyByDefault: boolean;
}

export type ProjectionWarningCode =
  | 'LEGACY_NODE_PROJECTION'
  | 'MISSING_LAYER_FALLBACK'
  | 'INFERRED_EDGE_DROPPED'
  | 'LARGE_GRAPH_WARNING';

export interface ProjectionWarning {
  readonly code: ProjectionWarningCode;
  readonly detail?: string;
}

export type ProjectionStrategy = 'stored' | 'auto-layout' | 'hybrid';

export interface ProjectionMeta {
  readonly collectionId: string;
  readonly projectedAt: string;
  readonly projectionVersion: number;
  readonly projectionStrategy: ProjectionStrategy;
  readonly metadataVersion?: number;
  readonly normalizationSource?: WorkflowNormalizationSource;
  readonly isHeuristic: boolean;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly hasHierarchy: boolean;
  readonly hasAiReadiness: boolean;
  /** Phase E Step 1: Frontend rendering hints for large graph virtualization. Optional — absent for small graphs. */
  readonly virtualizationReadiness?: VirtualizationReadiness;
}

export interface GraphProjection {
  readonly nodes: readonly VisualNode[];
  readonly edges: readonly VisualEdge[];
  readonly hierarchy: HierarchyProjection;
  readonly clusters: readonly GraphClusterProjection[];
  readonly meta: ProjectionMeta;
  readonly warnings?: readonly ProjectionWarning[];
}
