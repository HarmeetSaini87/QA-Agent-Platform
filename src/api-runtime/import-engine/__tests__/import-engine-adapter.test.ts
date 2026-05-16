import { describe, it, expect } from 'vitest';
import { adaptPostmanImport, adaptOpenApiImport } from '../import-engine-adapter';

const minimalPostmanJson = JSON.stringify({
  info: { name: 'Test', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'GET users',
      request: { method: 'GET', url: { raw: 'https://api.example.com/users', host: ['api','example','com'], path: ['users'] } }
    }
  ]
});

const minimalOpenApiJson = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/users': {
      get: { operationId: 'getUsers', summary: 'Get users', responses: { '200': { description: 'ok' } } }
    }
  }
});

describe('adaptPostmanImport', () => {
  it('returns collection with steps', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
    expect(result.collection.steps.length).toBe(1);
    expect(result.collection.steps[0].name).toBe('GET users');
  });

  it('returns warnings array (may be empty)', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('returns compatibility report', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1');
    expect(typeof result.compatibility.compatible).toBe('boolean');
  });

  it('sets environmentId on collection', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-99');
    expect(result.collection.environmentId).toBe('env-99');
  });

  it('forwards projectId when provided', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1', { projectId: 'proj-42' });
    expect(result.collection.projectId).toBe('proj-42');
  });

  it('throws on invalid JSON', () => {
    expect(() => adaptPostmanImport('not json', 'env-1')).toThrow();
  });

  it('forwards collectionName when provided', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1', { collectionName: 'My Override' });
    expect(result.collection.name).toBe('My Override');
  });

  it('forwards executionMode when provided', () => {
    const result = adaptPostmanImport(minimalPostmanJson, 'env-1', { executionMode: 'parallel' });
    expect(result.collection.executionMode).toBe('parallel');
  });
});

describe('adaptOpenApiImport', () => {
  it('returns collection with steps', () => {
    const result = adaptOpenApiImport(minimalOpenApiJson, 'env-1');
    expect(result.collection.steps.length).toBe(1);
  });

  it('returns warnings array', () => {
    const result = adaptOpenApiImport(minimalOpenApiJson, 'env-1');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('returns compatibility report', () => {
    const result = adaptOpenApiImport(minimalOpenApiJson, 'env-1');
    expect(typeof result.compatibility.compatible).toBe('boolean');
  });

  it('throws on invalid JSON', () => {
    expect(() => adaptOpenApiImport('not json', 'env-1')).toThrow();
  });

  it('sets environmentId on collection', () => {
    const result = adaptOpenApiImport(minimalOpenApiJson, 'env-77');
    expect(result.collection.environmentId).toBe('env-77');
  });

  it('forwards projectId when provided', () => {
    const result = adaptOpenApiImport(minimalOpenApiJson, 'env-1', { projectId: 'proj-99' });
    expect(result.collection.projectId).toBe('proj-99');
  });
});
