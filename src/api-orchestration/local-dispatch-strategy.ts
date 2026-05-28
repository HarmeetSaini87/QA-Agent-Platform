// src/api-orchestration/local-dispatch-strategy.ts
// Phase E Step 3: Local (in-process) dispatch strategy — current default.
// Always routes to local worker. Future: swap for AffinityDispatchStrategy or CloudDispatchStrategy.

import type {
  IDispatchStrategy,
  DispatchDecision,
  DispatchAffinityHints,
} from './contracts/dispatch-strategy.contracts';
import type { OrchestrationRequest } from './contracts/queue-orchestrator.contracts';

export class LocalDispatchStrategy implements IDispatchStrategy {
  readonly strategyName = 'local';

  constructor(private readonly _localWorkerId: string) {}

  decide(request: OrchestrationRequest, hints?: DispatchAffinityHints): DispatchDecision {
    // Tenant safety: local strategy only handles requests without tenant routing requirements.
    // Future cloud strategy will route tenantId to isolated worker pools.
    if (hints?.tenantId && hints.tenantId !== 'default') {
      return {
        target: 'local',
        workerId: this._localWorkerId,
        reason: `Tenant ${hints.tenantId} — local fallback (no tenant-isolated worker pool configured)`,
        decidedAt: new Date().toISOString(),
      };
    }

    return {
      target: 'local',
      workerId: this._localWorkerId,
      reason: `Local dispatch — single-node default for collection ${request.collectionId}`,
      decidedAt: new Date().toISOString(),
    };
  }
}

/** Affinity dispatch stub — future env/capability-based routing. No-op today. */
export class AffinityDispatchStrategy implements IDispatchStrategy {
  readonly strategyName = 'affinity';

  constructor(
    private readonly _localWorkerId: string,
    private readonly _fallback: IDispatchStrategy
  ) {}

  decide(request: OrchestrationRequest, hints?: DispatchAffinityHints): DispatchDecision {
    // Phase E Step 3: affinity logic is a stub — falls through to local.
    // Future: match hints.preferEnvironmentId against worker capability registry.
    return this._fallback.decide(request, hints);
  }
}
