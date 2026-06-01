/**
 * audit.contracts.ts — Typed API audit actions and extended audit entry.
 * Does NOT modify existing AuditEntry or logAudit in src/auth/audit.ts.
 * All extensions are additive.
 */

import { AuditEntry } from '../data/types';

export type ApiAuditAction =
  | 'api:collection:execute'
  | 'api:collection:view'
  | 'api:replay:access'
  | 'api:graph:access'
  | 'api:defect:filed'
  | 'api:healing:applied'
  | 'api:suite:execute'
  | 'api:teardown:execute'
  | 'api:environment:accessed'
  | 'api:variable:accessed'
  | 'api:intelligence:recommendations:generated'
  | 'api:intelligence:rca:accessed'
  | 'api:remediation:proposed'
  | 'api:remediation:approved'
  | 'api:remediation:rejected'
  | 'api:intelligence:negative-tests:generated'
  | 'api:intelligence:assertions:suggested'
  | 'api:intelligence:tests:generated';

export interface ExtendedAuditEntry extends AuditEntry {
  tenantId?:         string;
  correlationId?:    string;
  governanceAction?: ApiAuditAction;
}

export interface ApiAuditExtras {
  tenantId?:      string;
  correlationId?: string;
  details?:       string;
}
