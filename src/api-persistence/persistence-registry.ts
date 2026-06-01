// src/api-persistence/persistence-registry.ts
// Phase E Step 2: Singleton registry providing all repository instances.
// Default: JSON backend. Future: swap to SQLite/Postgres by changing provider here only.

import { globalJsonStorageProvider } from './providers/json-storage-provider';
import { JsonCollectionRepository } from './repositories/json-collection-repository';
import { JsonApiRunRepository } from './repositories/json-run-repository';
import { JsonReplayRepository } from './repositories/json-replay-repository';
import { JsonFlakinessRepository } from './repositories/json-flakiness-repository';
import { JsonAuditRepository } from './repositories/json-audit-repository';
import { JsonRemediationRepository } from './repositories/json-remediation-repository';
import type { ICollectionRepository } from './contracts/collection-repository.contracts';
import type { IApiRunRepository } from './contracts/run-repository.contracts';
import type { IReplayRepository } from './contracts/replay-repository.contracts';
import type { IFlakinessRepository } from './contracts/flakiness-repository.contracts';
import type { IAuditRepository } from './contracts/audit-repository.contracts';
import type { IRemediationRepository } from './contracts/remediation-repository.contracts';
import type { PersistenceBackend, StorageProviderHealth } from './contracts/storage-provider.contracts';

export interface PersistenceRegistrySnapshot {
  readonly backend: PersistenceBackend;
  readonly health: StorageProviderHealth;
  readonly registeredRepositories: readonly string[];
}

class PersistenceRegistry {
  private readonly _provider = globalJsonStorageProvider;

  readonly collections: ICollectionRepository = new JsonCollectionRepository(this._provider);
  readonly runs: IApiRunRepository = new JsonApiRunRepository(this._provider);
  readonly replay: IReplayRepository = new JsonReplayRepository();
  readonly flakiness: IFlakinessRepository = new JsonFlakinessRepository();
  readonly audit: IAuditRepository = new JsonAuditRepository(this._provider);
  readonly remediation: IRemediationRepository = new JsonRemediationRepository();

  get backend(): PersistenceBackend {
    return this._provider.capabilities.backend;
  }

  health(): StorageProviderHealth {
    return {
      backend: this._provider.capabilities.backend,
      healthy: true,
      checkedAt: new Date().toISOString(),
    };
  }

  snapshot(): PersistenceRegistrySnapshot {
    return {
      backend: this.backend,
      health: this.health(),
      registeredRepositories: ['collections', 'runs', 'replay', 'flakiness', 'audit', 'remediation'],
    };
  }
}

export const globalPersistenceRegistry = new PersistenceRegistry();
