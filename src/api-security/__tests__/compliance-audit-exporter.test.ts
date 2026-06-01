// src/api-security/__tests__/compliance-audit-exporter.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ComplianceAuditExporter } from '../compliance-audit-exporter';

function makeTrace(type: 'execution' | 'remediation' = 'execution') {
  return {
    eventType: type,
    actorId: 'actor-1',
    resourceId: 'res-1',
    resourceType: 'collection',
    outcome: 'allowed' as const,
    timestamp: new Date().toISOString(),
    metadata: {},
  };
}

describe('ComplianceAuditExporter', () => {
  let exporter: ComplianceAuditExporter;
  beforeEach(() => { exporter = new ComplianceAuditExporter(); });

  it('append: assigns traceId', () => {
    const record = exporter.append(makeTrace());
    expect(record.traceId).toBeTruthy();
  });

  it('export: recordCount matches appended records', () => {
    exporter.append(makeTrace());
    exporter.append(makeTrace('remediation'));
    const exported = exporter.export('json');
    expect(exported.recordCount).toBe(2);
    expect(exported.format).toBe('json');
  });

  it('export: integrityHash is a 64-char hex string', () => {
    exporter.append(makeTrace());
    const exported = exporter.export('json');
    expect(exported.integrityHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verify: returns true for untampered export', () => {
    exporter.append(makeTrace());
    const exported = exporter.export('json');
    expect(exporter.verify(exported)).toBe(true);
  });

  it('verify: returns false if records were tampered', () => {
    exporter.append(makeTrace());
    const exported = exporter.export('json');
    const tampered = { ...exported, records: [...exported.records, { ...exported.records[0], traceId: 'tampered' }] };
    expect(exporter.verify(tampered)).toBe(false);
  });

  it('export: empty exporter exports zero records with valid hash', () => {
    const exported = exporter.export('json');
    expect(exported.recordCount).toBe(0);
    expect(exporter.verify(exported)).toBe(true);
  });
});
