// src/api-security/contracts/compliance-audit.contracts.ts
// Phase E Step 4: Immutable compliance audit export contracts.

export type AuditExportFormat = 'json' | 'csv' | 'ndjson';

export interface ComplianceTraceRecord {
  readonly traceId: string;
  readonly eventType: 'execution' | 'remediation' | 'approval' | 'secret-scan' | 'env-access';
  readonly actorId: string;
  readonly resourceId: string;
  readonly resourceType: string;
  readonly outcome: 'allowed' | 'denied' | 'advisory';
  readonly timestamp: string;
  readonly metadata: Record<string, unknown>;
}

export interface ComplianceAuditExport {
  readonly exportedAt: string;
  readonly format: AuditExportFormat;
  readonly recordCount: number;
  readonly records: ComplianceTraceRecord[];
  /** SHA-256 hash of serialised records for tamper evidence. */
  readonly integrityHash: string;
}

export interface IComplianceAuditExporter {
  /** Build an immutable export snapshot of all compliance traces. */
  export(format: AuditExportFormat): ComplianceAuditExport;
  /** Verify the integrityHash of an existing export. */
  verify(exported: ComplianceAuditExport): boolean;
  /** Append a new trace record (append-only; no update/delete). */
  append(record: Omit<ComplianceTraceRecord, 'traceId'>): ComplianceTraceRecord;
}
