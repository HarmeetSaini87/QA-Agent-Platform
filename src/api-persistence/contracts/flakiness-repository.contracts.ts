// src/api-persistence/contracts/flakiness-repository.contracts.ts
// Phase E Step 2: Repository interface for flakiness analytics persistence.

import type { CollectionFlakinessReport } from '../../api-flakiness/contracts/flakiness.contracts';

export interface IFlakinessRepository {
  loadReport(collectionId: string): CollectionFlakinessReport | undefined;
  saveReport(report: CollectionFlakinessReport): void;
  listCollectionIds(): string[];
  deleteReport(collectionId: string): boolean;
}
