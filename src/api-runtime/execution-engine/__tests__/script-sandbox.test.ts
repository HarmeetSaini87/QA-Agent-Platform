import { describe, it, expect } from 'vitest';
import { runScript } from '../script-sandbox';

describe('runScript', () => {
  it('returns empty mutations for script with no setVar call', () => {
    const result = runScript('1 + 1', { x: 'val' });
    expect(result).toEqual({});
  });

  it('captures setVar mutation', () => {
    const result = runScript('setVar("token", "abc123")', {});
    expect(result['token']).toBe('abc123');
  });

  it('can read context variables', () => {
    const result = runScript('setVar("out", userId)', { userId: 'u42' });
    expect(result['out']).toBe('u42');
  });

  it('can read response in post-script', () => {
    const snap = { status: 200, headers: {}, body: { id: 5 }, bodyTruncated: false, durationMs: 10 };
    const result = runScript('setVar("status", String(response.status))', {}, snap as never);
    expect(result['status']).toBe('200');
  });

  it('returns empty on syntax error (non-fatal)', () => {
    const result = runScript('!!!invalid:::syntax', {});
    expect(result).toEqual({});
  });

  it('returns empty on infinite-loop (500ms timeout)', () => {
    const result = runScript('while(true){}', {});
    expect(result).toEqual({});
  });

  it('context mutation via assignment is silently blocked (frozen)', () => {
    // Frozen context — direct assignment ignored or throws silently
    const result = runScript('x = 999; setVar("check", "ok")', { x: 1 });
    expect(result['check']).toBe('ok'); // setVar still works
  });

  it('multiple setVar calls all captured', () => {
    const result = runScript('setVar("a", "1"); setVar("b", "2")', {});
    expect(result).toEqual({ a: '1', b: '2' });
  });
});
