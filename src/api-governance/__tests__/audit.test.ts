import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiAuditAction, ApiAuditExtras, ExtendedAuditEntry } from '../audit.contracts';
import { AuditEntry } from '../../data/types';

vi.mock('../../auth/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../../auth/getClientIp', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import { logAudit } from '../../auth/audit';
import { logApiAudit } from '../audit.helper';

function makeReq(overrides: Record<string, unknown> = {}): any {
  return {
    session: { userId: 'u1', username: 'alice', role: 'editor' },
    headers: {},
    ...overrides,
  };
}

describe('Extended Audit Model', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ApiAuditAction values are defined strings', () => {
    const actions: ApiAuditAction[] = [
      'api:collection:execute',
      'api:collection:view',
      'api:replay:access',
      'api:graph:access',
      'api:defect:filed',
      'api:healing:applied',
      'api:suite:execute',
      'api:teardown:execute',
      'api:environment:accessed',
      'api:variable:accessed',
    ];
    expect(actions.length).toBe(10);
    for (const a of actions) {
      expect(typeof a).toBe('string');
      expect(a.startsWith('api:')).toBe(true);
    }
  });

  it('logApiAudit calls logAudit with correct action and resourceId', () => {
    const req = makeReq();
    logApiAudit('api:collection:execute', 'col-123', req);
    expect(logAudit).toHaveBeenCalledOnce();
    const entry = (logAudit as any).mock.calls[0][0];
    expect(entry.action).toBe('api:collection:execute');
    expect(entry.resourceId).toBe('col-123');
    expect(entry.userId).toBe('u1');
  });

  it('logApiAudit embeds correlationId and tenantId in details JSON', () => {
    const req = makeReq();
    const extras: ApiAuditExtras = { correlationId: 'corr-99', tenantId: 'tenant-acme' };
    logApiAudit('api:suite:execute', 'suite-7', req, extras);
    const entry = (logAudit as any).mock.calls[0][0];
    const details = JSON.parse(entry.details);
    expect(details.correlationId).toBe('corr-99');
    expect(details.tenantId).toBe('tenant-acme');
    expect(details.governanceAction).toBe('api:suite:execute');
  });

  it('logApiAudit falls back to apiKeyName when session username absent', () => {
    const req = makeReq({ session: undefined, apiKeyName: 'ci-key' });
    logApiAudit('api:replay:access', 'run-55', req);
    const entry = (logAudit as any).mock.calls[0][0];
    expect(entry.username).toBe('ci-key');
    expect(entry.userId).toBeNull();
  });

  it('ExtendedAuditEntry is structurally compatible with AuditEntry', () => {
    const base: AuditEntry = {
      id: 'ae1',
      userId: 'u1',
      username: 'alice',
      action: 'api:collection:execute',
      resourceType: 'api-collection',
      resourceId: 'col-1',
      details: null,
      ip: '127.0.0.1',
      createdAt: new Date().toISOString(),
    };
    const extended: ExtendedAuditEntry = {
      ...base,
      tenantId: 'tenant-1',
      correlationId: 'corr-1',
      governanceAction: 'api:collection:execute',
    };
    expect(extended.tenantId).toBe('tenant-1');
    expect(extended.correlationId).toBe('corr-1');
    expect(extended.id).toBe('ae1');
  });

});
