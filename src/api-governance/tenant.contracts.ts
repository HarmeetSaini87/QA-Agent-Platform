/**
 * tenant.contracts.ts — Multi-tenant isolation contracts.
 * All types are JSON-serialisable.
 * No storage redesign — tenantId is read from session only.
 */

export interface TenantContext {
  tenantId:      string;
  tenantName:    string;
  isolationMode: 'shared' | 'isolated';
}

export interface TenantIsolationPolicy {
  tenantId:               string;
  isolationMode:          'shared' | 'isolated';
  allowCrossProjectRead:  boolean;
  allowCrossProjectWrite: boolean;
  maxCollections?:        number;
  maxWorkers?:            number;
}

export const DEFAULT_TENANT_ISOLATION_POLICY: TenantIsolationPolicy = {
  tenantId:               'default',
  isolationMode:          'shared',
  allowCrossProjectRead:  true,
  allowCrossProjectWrite: true,
};
