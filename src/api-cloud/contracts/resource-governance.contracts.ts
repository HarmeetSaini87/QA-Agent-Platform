// src/api-cloud/contracts/resource-governance.contracts.ts
// Phase E Step 6: Worker quota, tenant resource tracking, burst visibility. Advisory only.

export interface WorkerQuotaPolicy {
  readonly policyId: string;
  readonly tenantId?: string;
  readonly maxConcurrentRuns: number;
  readonly maxQueueDepth: number;
  readonly maxRetriesPerRun: number;
  readonly burstAllowancePercent: number;
}

export interface TenantResourceUsage {
  readonly tenantId: string;
  readonly sampledAt: string;
  readonly activeRunCount: number;
  readonly queuedRunCount: number;
  readonly totalRetriesTriggered: number;
  readonly workerCount: number;
}

export interface ResourceBudgetCheck {
  readonly tenantId?: string;
  readonly withinBudget: boolean;
  readonly activeRuns: number;
  readonly maxConcurrentRuns: number;
  readonly queueDepth: number;
  readonly maxQueueDepth: number;
  readonly advisoryNote: string;
  readonly checkedAt: string;
}

export interface IResourceGovernanceRegistry {
  registerPolicy(policy: WorkerQuotaPolicy): void;
  getPolicy(policyId: string): WorkerQuotaPolicy | null;
  /** Advisory budget check — never blocks execution, returns recommendation only. */
  checkBudget(policyId: string, currentActiveRuns: number, currentQueueDepth: number): ResourceBudgetCheck;
  recordUsage(usage: TenantResourceUsage): void;
  getUsage(tenantId: string): TenantResourceUsage | null;
  listPolicies(): WorkerQuotaPolicy[];
}
