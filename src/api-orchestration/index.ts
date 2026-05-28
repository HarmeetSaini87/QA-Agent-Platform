// src/api-orchestration/index.ts
// Phase E Step 3: Public API for distributed queue orchestration module.

export type {
  OrchestrationRequest,
  OrchestrationResult,
  OrchestrationQueueSnapshot,
  IQueueOrchestrator,
} from './contracts/queue-orchestrator.contracts';
export type {
  LeaseRenewalRequest,
  LeaseRenewalResult,
  StuckRunRecoveryRecord,
  ILeaseRenewer,
} from './contracts/lease-renewal.contracts';
export type {
  WorkerHeartbeat,
  HeartbeatRegistrySnapshot,
  IHeartbeatRegistry,
} from './contracts/worker-heartbeat.contracts';
export type {
  DispatchDecision,
  DispatchAffinityHints,
  IDispatchStrategy,
} from './contracts/dispatch-strategy.contracts';
export type {
  ReplayWorkerContribution,
  MergedReplayResult,
  IDistributedReplayCoordinator,
} from './contracts/distributed-replay-coordinator.contracts';
export type {
  IRedisExecutionQueue,
  IAzureServiceBusQueue,
  IKubernetesJobRunner,
} from './contracts/cloud-queue.contracts';

export {
  LocalQueueOrchestrator,
  getQueueOrchestratorSingleton,
  _resetQueueOrchestratorSingleton,
} from './queue-orchestrator';
export { InMemoryLeaseRenewer } from './lease-renewer';
export { InMemoryHeartbeatRegistry, globalHeartbeatRegistry } from './heartbeat-registry';
export { LocalDispatchStrategy, AffinityDispatchStrategy } from './local-dispatch-strategy';
export { SingleWorkerReplayCoordinator, globalReplayCoordinator } from './distributed-replay-coordinator';
export { NoOpRedisQueue, NoOpKubernetesJobRunner } from './contracts/cloud-queue.contracts';

export { registerOrchestrationRoutes } from './routes/orchestration.routes';
