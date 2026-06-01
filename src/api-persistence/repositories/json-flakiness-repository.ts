// src/api-persistence/repositories/json-flakiness-repository.ts
// Phase E Step 2: JSON-backed IFlakinessRepository.
// Wraps api-flakiness/flakiness-store.ts — no behavior change.

import * as fs from 'fs';
import * as path from 'path';
import type { CollectionFlakinessReport } from '../../api-flakiness/contracts/flakiness.contracts';
import {
  loadReport,
  saveReport,
  listReportIds,
} from '../../api-flakiness/flakiness-store';
import type { IFlakinessRepository } from '../contracts/flakiness-repository.contracts';

export class JsonFlakinessRepository implements IFlakinessRepository {
  private _flakinessDir(): string {
    return path.join(path.resolve(process.env.DATA_DIR || 'data'), 'api-flakiness');
  }

  loadReport(collectionId: string): CollectionFlakinessReport | undefined {
    return loadReport(collectionId);
  }

  saveReport(report: CollectionFlakinessReport): void {
    saveReport(report);
  }

  listCollectionIds(): string[] {
    return listReportIds();
  }

  deleteReport(collectionId: string): boolean {
    const filePath = path.join(this._flakinessDir(), `${collectionId}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }
}
