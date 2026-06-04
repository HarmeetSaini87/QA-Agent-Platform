import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('nlRawPrompt export', () => {
  it('is exported from nlProvider', async () => {
    const mod = await import('../nlProvider');
    expect(typeof mod.nlRawPrompt).toBe('function');
  });

  it('throws when provider is unknown', async () => {
    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'unknown-provider', apiKey: 'test', model: 'test-model' } as any;
    await expect(nlRawPrompt(cfg, 'hello')).rejects.toThrow();
  });
});
