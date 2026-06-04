import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('nlRawPrompt', () => {
  it('is exported as a function', async () => {
    const mod = await import('../nlProvider');
    expect(typeof mod.nlRawPrompt).toBe('function');
  });

  it('throws for unknown provider', async () => {
    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'unknown-xyz', apiKey: 'k', model: 'm' } as any;
    await expect(nlRawPrompt(cfg, 'hello')).rejects.toThrow('unsupported provider');
  });

  it('extracts text from OpenAI-compatible response', async () => {
    const globalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hello from OpenAI' } }] }),
    }) as any;

    // Re-import to pick up mocked fetch in module scope
    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini' } as any;
    const result = await nlRawPrompt(cfg, 'test prompt');
    expect(result).toBe('Hello from OpenAI');

    global.fetch = globalFetch;
  });

  it('extracts text from Gemini response', async () => {
    const globalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'Hello from Gemini' }] } }],
      }),
    }) as any;

    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'gemini', apiKey: 'test-key', model: 'gemini-1.5-flash' } as any;
    const result = await nlRawPrompt(cfg, 'test prompt');
    expect(result).toBe('Hello from Gemini');

    global.fetch = globalFetch;
  });

  it('extracts text from Ollama response', async () => {
    const globalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: 'Hello from Ollama' } }),
    }) as any;

    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'ollama', model: 'qwen2.5:0.5b' } as any;
    const result = await nlRawPrompt(cfg, 'test prompt');
    expect(result).toBe('Hello from Ollama');

    global.fetch = globalFetch;
  });

  it('extracts text from Groq response', async () => {
    const globalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hello from Groq' } }] }),
    }) as any;

    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'groq', apiKey: 'gsk_test', model: 'llama-3.1-8b-instant' } as any;
    const result = await nlRawPrompt(cfg, 'test prompt');
    expect(result).toBe('Hello from Groq');

    global.fetch = globalFetch;
  });

  it('extracts text from compatible provider response', async () => {
    const globalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Hello from Compatible' } }] }),
    }) as any;

    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'compatible', apiKey: 'key', model: 'custom-model', baseUrl: 'https://my-endpoint.com' } as any;
    const result = await nlRawPrompt(cfg, 'test prompt');
    expect(result).toBe('Hello from Compatible');

    global.fetch = globalFetch;
  });

  it('throws when compatible provider has no baseUrl', async () => {
    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'compatible', apiKey: 'key', model: 'custom-model' } as any;
    await expect(nlRawPrompt(cfg, 'test prompt')).rejects.toThrow('baseUrl is required');
  });

  it('returns empty string when response has no content', async () => {
    const globalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    }) as any;

    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'openai', apiKey: 'test-key', model: 'gpt-4o-mini' } as any;
    const result = await nlRawPrompt(cfg, 'test prompt');
    expect(result).toBe('');

    global.fetch = globalFetch;
  });

  it('throws on HTTP error response', async () => {
    const globalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    }) as any;

    const { nlRawPrompt } = await import('../nlProvider');
    const cfg = { provider: 'openai', apiKey: 'bad-key', model: 'gpt-4o-mini' } as any;
    await expect(nlRawPrompt(cfg, 'test prompt')).rejects.toThrow('401');

    global.fetch = globalFetch;
  });
});
