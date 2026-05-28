// src/api-mesh/contracts/mesh-intelligence.contracts.ts
// Phase E Step 13: Enterprise intelligence mesh contracts. Governed propagation — WorkflowEnvelope authoritative.

export type MeshIntelligenceScope = 'local' | 'tenant' | 'federated' | 'global';
export type OrchestrationSignalType =
  | 'stabilization-propagation'
  | 'retry-optimization'
  | 'dependency-learning'
  | 'anomaly-propagation'
  | 'remediation-intelligence'
  | 'bottleneck-learning';

export interface MeshIntelligenceNode {
  readonly nodeId: string;
  readonly orgId: string;
  readonly tenantId?: string;
  readonly scope: MeshIntelligenceScope;
  readonly activeSignalTypes: readonly OrchestrationSignalType[];
  readonly registeredAt: string;
  readonly governanceNote: string;
}

export interface OrchestrationIntelligencePropagation {
  readonly propagationId: string;
  readonly signalType: OrchestrationSignalType;
  readonly sourceNodeId: string;
  readonly targetScope: MeshIntelligenceScope;
  readonly payload: Record<string, unknown>;   // anonymized signal — never raw execution data
  readonly confidence: number;                 // 0–100
  readonly propagatedAt: string;
  readonly advisoryNote: string;
}

export interface MeshIntelligenceSummary {
  readonly orgId: string;
  readonly scope: MeshIntelligenceScope;
  readonly totalNodes: number;
  readonly activePropagations: number;
  readonly dominantSignalType: OrchestrationSignalType | null;
  readonly generatedAt: string;
}

export interface IMeshIntelligenceRegistry {
  registerNode(node: MeshIntelligenceNode): void;
  getNode(nodeId: string): MeshIntelligenceNode | null;
  listNodes(orgId?: string, scope?: MeshIntelligenceScope): MeshIntelligenceNode[];
  publishPropagation(propagation: OrchestrationIntelligencePropagation): void;
  listPropagations(signalType?: OrchestrationSignalType): OrchestrationIntelligencePropagation[];
  summarize(orgId: string): MeshIntelligenceSummary;
}
