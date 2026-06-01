// src/api-persistence/__tests__/persistence-registry.test.ts
import { describe, it, expect } from 'vitest';
import { globalPersistenceRegistry } from '../persistence-registry';

describe('PersistenceRegistry', () => {
  it('backend is json by default', () => {
    expect(globalPersistenceRegistry.backend).toBe('json');
  });

  it('health returns healthy=true for JSON backend', () => {
    const h = globalPersistenceRegistry.health();
    expect(h.healthy).toBe(true);
    expect(h.backend).toBe('json');
    expect(h.checkedAt).toBeTruthy();
  });

  it('snapshot lists all expected repositories', () => {
    const s = globalPersistenceRegistry.snapshot();
    expect(s.registeredRepositories).toContain('collections');
    expect(s.registeredRepositories).toContain('runs');
    expect(s.registeredRepositories).toContain('replay');
    expect(s.registeredRepositories).toContain('flakiness');
    expect(s.registeredRepositories).toContain('audit');
    expect(s.registeredRepositories).toContain('remediation');
  });

  it('all repository instances are defined', () => {
    expect(globalPersistenceRegistry.collections).toBeDefined();
    expect(globalPersistenceRegistry.runs).toBeDefined();
    expect(globalPersistenceRegistry.replay).toBeDefined();
    expect(globalPersistenceRegistry.flakiness).toBeDefined();
    expect(globalPersistenceRegistry.audit).toBeDefined();
    expect(globalPersistenceRegistry.remediation).toBeDefined();
  });
});
