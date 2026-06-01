// src/api-persistence/__tests__/json-storage-provider.test.ts
// Tests that the JsonStorageProvider capability flags are correct and matches expected contract.
import { describe, it, expect } from 'vitest';
import { JsonStorageProvider } from '../providers/json-storage-provider';

describe('JsonStorageProvider capabilities', () => {
  const provider = new JsonStorageProvider();

  it('reports json backend', () => {
    expect(provider.capabilities.backend).toBe('json');
  });

  it('supportsAtomicWrite = true', () => {
    expect(provider.capabilities.supportsAtomicWrite).toBe(true);
  });

  it('supportsTransactions = false (JSON is single-file, no transactions)', () => {
    expect(provider.capabilities.supportsTransactions).toBe(false);
  });

  it('supports atomic file write + read cycle', () => {
    const os = require('os') as typeof import('os');
    const path = require('path') as typeof import('path');
    const tmp = path.join(os.tmpdir(), `provider-test-${Date.now()}.json`);
    provider.atomicWriteFile(tmp, '{"ok":true}');
    const content = provider.readFile(tmp);
    expect(content).toBe('{"ok":true}');
    expect(provider.fileExists(tmp)).toBe(true);
    require('fs').unlinkSync(tmp);
  });

  it('readFile returns null for non-existent path', () => {
    expect(provider.readFile('/nonexistent/path/abc.json')).toBeNull();
  });
});
