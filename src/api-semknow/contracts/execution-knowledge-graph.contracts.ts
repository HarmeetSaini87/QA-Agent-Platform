export type KnowledgeNodeType =
  | 'orchestration-step'
  | 'dependency'
  | 'remediation-action'
  | 'retry-pattern'
  | 'sla-constraint'
  | 'environment-factor';

export type KnowledgeRelationType =
  | 'depends-on'
  | 'triggers'
  | 'remediates'
  | 'correlates-with'
  | 'constrains'
  | 'optimizes';

export interface ExecutionKnowledgeNode {
  nodeId: string;
  collectionId: string;
  nodeType: KnowledgeNodeType;
  semanticLabel: string;
  contextAttributes: Record<string, unknown>;
  confidence: number;
  isExplainable: true;
  createdAt: string;
  governanceNote: string;
}

export interface ExecutionKnowledgeEdge {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationType: KnowledgeRelationType;
  weight: number;
  reasoningSummary: string;
  isExplainable: true;
  createdAt: string;
}

export interface ExecutionKnowledgeGraphSnapshot {
  snapshotId: string;
  collectionId: string;
  totalNodes: number;
  totalEdges: number;
  nodeTypeBreakdown: Record<string, number>;
  dominantRelationType: KnowledgeRelationType | null;
  avgNodeConfidence: number;
  snapshotAt: string;
  governanceNote: string;
}

export interface IExecutionKnowledgeGraphRegistry {
  addNode(node: Omit<ExecutionKnowledgeNode, 'nodeId' | 'createdAt' | 'governanceNote'>): ExecutionKnowledgeNode;
  getNode(nodeId: string): ExecutionKnowledgeNode | null;
  listNodes(collectionId: string, nodeType?: KnowledgeNodeType): ExecutionKnowledgeNode[];
  addEdge(edge: Omit<ExecutionKnowledgeEdge, 'edgeId' | 'createdAt'>): ExecutionKnowledgeEdge;
  listEdges(collectionId: string, relationType?: KnowledgeRelationType): ExecutionKnowledgeEdge[];
  snapshot(collectionId: string): ExecutionKnowledgeGraphSnapshot;
}
