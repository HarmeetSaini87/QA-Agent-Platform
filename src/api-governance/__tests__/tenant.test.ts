import { describe, it, expect } from 'vitest';
import {
  TenantContext,
  TenantIsolationPolicy,
  DEFAULT_TENANT_ISOLATION_POLICY,
} from '../tenant.contracts';
import { getTenantContext } from '../tenant.helper';

function makeReq(sessionOverrides: Record<string, unknown> = {}): any {
  return {
    session: {
      userId: 'u1',
      username: 'alice',
      role: 'admin',
      ...sessionOverrides,
    },
  };
}

describe('Multi-Tenant Isolation Contracts', () => {

  it('getTenantContext returns null when no tenantId on session (single-tenant)', () => {
    const req = makeReq();
    const ctx = getTenantContext(req);
    expect(ctx).toBeNull();
  });

  it('getTenantContext returns TenantContext when tenantId present', () => {
    const req = makeReq({ tenantId: 'acme', tenantName: 'ACME Corp' });
    const ctx = getTenantContext(req);
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('acme');
    expect(ctx!.tenantName).toBe('ACME Corp');
    expect(ctx!.isolationMode).toBe('shared');
  });

  it('getTenantContext defaults tenantName to tenantId when name absent', () => {
    const req = makeReq({ tenantId: 'beta-corp' });
    const ctx = getTenantContext(req);
    expect(ctx!.tenantName).toBe('beta-corp');
  });

  it('getTenantContext reads isolationMode from session', () => {
    const req = makeReq({ tenantId: 'corp-x', tenantIsolationMode: 'isolated' });
    const ctx = getTenantContext(req);
    expect(ctx!.isolationMode).toBe('isolated');
  });

  it('DEFAULT_TENANT_ISOLATION_POLICY is permissive shared mode', () => {
    const p: TenantIsolationPolicy = DEFAULT_TENANT_ISOLATION_POLICY;
    expect(p.isolationMode).toBe('shared');
    expect(p.allowCrossProjectRead).toBe(true);
    expect(p.allowCrossProjectWrite).toBe(true);
    expect(p.tenantId).toBe('default');
  });

});
