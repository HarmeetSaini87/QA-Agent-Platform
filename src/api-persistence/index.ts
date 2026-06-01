// src/api-persistence/index.ts
// Phase E Step 2: Public API for the persistence abstraction module.

export type {
  PersistenceBackend,
  StorageProviderCapabilities,
  IStorageProvider,
  IAtomicStorageProvider,
  StorageProviderHealth,
} from './contracts/storage-provider.contracts';
export type { ICollectionRepository, CollectionQueryOptions } from './contracts/collection-repository.contracts';
export type { IApiRunRepository, RunQueryOptions, RunSummary } from './contracts/run-repository.contracts';
export type { IReplayRepository, ReplayQueryOptions, ReplayIndexEntry } from './contracts/replay-repository.contracts';
export type { IFlakinessRepository } from './contracts/flakiness-repository.contracts';
export type { IAuditRepository, AuditQueryOptions } from './contracts/audit-repository.contracts';
export type { IRemediationRepository, RemediationQueryOptions } from './contracts/remediation-repository.contracts';
export type {
  ISqlStorageProvider,
  ICloudStorageProvider,
  ITenantPartitionedProvider,
  IReplayArchiveTier,
} from './contracts/cloud-persistence.contracts';

export { globalJsonStorageProvider, JsonStorageProvider } from './providers/json-storage-provider';
export { JsonCollectionRepository } from './repositories/json-collection-repository';
export { JsonApiRunRepository } from './repositories/json-run-repository';
export { JsonReplayRepository } from './repositories/json-replay-repository';
export { JsonFlakinessRepository } from './repositories/json-flakiness-repository';
export { JsonAuditRepository } from './repositories/json-audit-repository';
export { JsonRemediationRepository } from './repositories/json-remediation-repository';

export { globalPersistenceRegistry } from './persistence-registry';
export type { PersistenceRegistrySnapshot } from './persistence-registry';
