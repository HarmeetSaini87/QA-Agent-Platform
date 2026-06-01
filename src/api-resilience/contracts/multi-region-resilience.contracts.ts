export type RegionStatus = 'healthy' | 'degraded' | 'failover' | 'recovering' | 'offline';
export type ResiliencePolicyTier = 'local-only' | 'regional' | 'multi-region' | 'globally-governed';
export type ContinuityMode = 'active-active' | 'active-passive' | 'warm-standby' | 'cold-standby';

export interface RegionalOrchestrationNode {
  nodeId: string;
  regionId: string;
  orgId: string;
  status: RegionStatus;
  continuityMode: ContinuityMode;
  resilienceScore: number;
  primaryRegion: boolean;
  lastHeartbeatAt: string;
  governanceNote: string;
}

export interface OrchestrationFailoverRecord {
  failoverId: string;
  orgId: string;
  fromRegionId: string;
  toRegionId: string;
  triggerReason: string;
  isApproved: boolean;
  approvedBy?: string;
  failoverAt: string;
  isExplainable: true;
  governanceNote: string;
}

export interface RegionalResiliencePolicy {
  policyId: string;
  orgId?: string;
  primaryRegionId: string;
  failoverRegionIds: string[];
  continuityMode: ContinuityMode;
  minResilienceScore: number;
  requireApprovalForFailover: boolean;
  auditAllFailovers: boolean;
}

export interface MultiRegionResilienceSnapshot {
  orgId: string;
  totalNodes: number;
  healthyNodes: number;
  degradedNodes: number;
  failoverNodes: number;
  avgResilienceScore: number;
  snapshotAt: string;
  governanceNote: string;
}

export interface IMultiRegionResilienceRegistry {
  registerNode(node: Omit<RegionalOrchestrationNode, 'governanceNote'>): RegionalOrchestrationNode;
  updateNodeStatus(nodeId: string, status: RegionStatus): RegionalOrchestrationNode;
  getNode(nodeId: string): RegionalOrchestrationNode | null;
  listNodes(orgId: string, status?: RegionStatus): RegionalOrchestrationNode[];
  recordFailover(record: Omit<OrchestrationFailoverRecord, 'failoverId' | 'failoverAt' | 'governanceNote'>): OrchestrationFailoverRecord;
  listFailovers(orgId: string): OrchestrationFailoverRecord[];
  snapshot(orgId: string): MultiRegionResilienceSnapshot;
  registerPolicy(policy: RegionalResiliencePolicy): void;
  getPolicy(orgId?: string): RegionalResiliencePolicy;
}
