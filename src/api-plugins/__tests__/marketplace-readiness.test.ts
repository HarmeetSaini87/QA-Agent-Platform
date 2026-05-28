// src/api-plugins/__tests__/marketplace-readiness.test.ts
import { describe, it, expect } from 'vitest';
import { NoOpPluginMarketplace } from '../contracts/marketplace-readiness.contracts';

describe('NoOpPluginMarketplace', () => {
  const marketplace = new NoOpPluginMarketplace();

  it('search: returns empty array', () => {
    expect(marketplace.search('assertion')).toEqual([]);
    expect(marketplace.search('auth', 'auth-provider')).toEqual([]);
  });

  it('install: returns installed=false', async () => {
    const result = await marketplace.install('listing-1', 'tenant-acme');
    expect(result.installed).toBe(false);
  });

  it('listWorkflowPacks: returns empty array', () => {
    expect(marketplace.listWorkflowPacks()).toEqual([]);
  });
});
