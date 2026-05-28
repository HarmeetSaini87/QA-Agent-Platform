// src/api-orchestration/contracts/dispatch-strategy.contracts.ts
// Phase E Step 3: Execution dispatch strategy contracts.
// Allows routing by environment affinity, tenant, or capability without
// changing execution semantics.

import type { OrchestrationRequest } from './queue-orchestrator.contracts';

export type DispatchTarget = 'local' | 'remote-worker' | 'cloud-worker';

export interface DispatchAffinityHints {
  /** Prefer a worker that already has this environment's secrets loaded. */
  preferEnvironmentId?: string;
  /** Tenant-safe routing — only workers in this tenant's pool. */
  tenantId?: string;
  /** Require workers with these capability tags. */
  requiredCapabilities?: readonly string[];
}

export interface DispatchDecision {
  readonly target: DispatchTarget;
  readonly workerId?: string;
  readonly reason: string;
  readonly decidedAt: string;
}

export interface IDispatchStrategy {
  readonly strategyName: string;
  /** Decide where to route an orchestration request. Pure function — no side effects. */
  decide(request: OrchestrationRequest, hints?: DispatchAffinityHints): DispatchDecision;
}
