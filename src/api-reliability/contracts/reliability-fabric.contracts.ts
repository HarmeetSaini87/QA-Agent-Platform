export type ReliabilityFabricStatus = 'active' | 'degraded' | 'stabilizing' | 'offline';
export type StabilizationGovernanceMode = 'advisory' | 'approval-gated' | 'supervised' | 'fully-governed';
export type AdaptiveRemediationStatus = 'proposed' | 'approved' | 'executing' | 'completed' | 'rolled-back';

export interface ReliabilityFabricNode {
  nodeId: string;
  orgId: string;
  collectionId: string;
  status: ReliabilityFabricStatus;
  governanceMode: StabilizationGovernanceMode;
  reliabilityScore: number;
  lastAssessedAt: string;
  governanceNote: string;
}

export interface StabilizationGovernanceRecord {
  recordId: string;
  collectionId: string;
  governanceMode: StabilizationGovernanceMode;
  stabilizationTarget: string;
  rationale: string;
  approvedBy?: string;
  createdAt: string;
  governanceNote: string;
}

export interface AdaptiveRemediationFabric {
  fabricId: string;
  collectionId: string;
  status: AdaptiveRemediationStatus;
  remediationActions: Array<{ field: string; currentValue: string; proposedValue: string; rationale: string }>;
  confidenceScore: number;
  isExplainable: true;
  requestedBy: string;
  createdAt: string;
  governanceNote: string;
}

export interface ReliabilityFabricSnapshot {
  orgId: string;
  totalNodes: number;
  activeNodes: number;
  degradedNodes: number;
  avgReliabilityScore: number;
  snapshotAt: string;
}

export interface IReliabilityFabricRegistry {
  registerNode(node: Omit<ReliabilityFabricNode, 'governanceNote'>): ReliabilityFabricNode;
  getNode(nodeId: string): ReliabilityFabricNode | null;
  listNodes(orgId: string, collectionId?: string): ReliabilityFabricNode[];
  snapshot(orgId: string): ReliabilityFabricSnapshot;
  recordGovernance(record: Omit<StabilizationGovernanceRecord, 'recordId' | 'createdAt' | 'governanceNote'>): StabilizationGovernanceRecord;
}
