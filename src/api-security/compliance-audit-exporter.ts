// src/api-security/compliance-audit-exporter.ts
// Phase E Step 4: Immutable compliance audit export with integrity hash.

import { createHash, randomUUID } from 'crypto';
import type {
  IComplianceAuditExporter,
  ComplianceAuditExport,
  ComplianceTraceRecord,
  AuditExportFormat,
} from './contracts/compliance-audit.contracts';

export class ComplianceAuditExporter implements IComplianceAuditExporter {
  /** Append-only in-memory store (export to JSON/CSV on demand). */
  private readonly _records: ComplianceTraceRecord[] = [];

  append(record: Omit<ComplianceTraceRecord, 'traceId'>): ComplianceTraceRecord {
    const full: ComplianceTraceRecord = { traceId: randomUUID(), ...record };
    this._records.push(full);
    return full;
  }

  export(format: AuditExportFormat): ComplianceAuditExport {
    const records = this._records.slice(); // immutable snapshot
    const serialised = JSON.stringify(records);
    const integrityHash = createHash('sha256').update(serialised).digest('hex');

    return {
      exportedAt: new Date().toISOString(),
      format,
      recordCount: records.length,
      records,
      integrityHash,
    };
  }

  verify(exported: ComplianceAuditExport): boolean {
    const serialised = JSON.stringify(exported.records);
    const hash = createHash('sha256').update(serialised).digest('hex');
    return hash === exported.integrityHash;
  }
}

export const globalComplianceAuditExporter = new ComplianceAuditExporter();
