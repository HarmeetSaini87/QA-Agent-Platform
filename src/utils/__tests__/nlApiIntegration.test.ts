/**
 * NL Keyword Suggestion — API Integration Tests
 *
 * Requires server running on http://localhost:3003 with admin/Admin@123
 * Run: npx vitest run src/utils/__tests__/nlApiIntegration.test.ts
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';

const BASE = 'http://localhost:3003';
let adminCookie = '';

async function login(user: string, pass: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!res.ok) throw new Error(`Login failed as ${user}: ${res.status}`);
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/qa-dev\.sid=[^;]+/);
  return match ? match[0] : '';
}

async function suggest(text: string, cookie?: string): Promise<{ status: number; data: any }> {
  const body: any = { text };
  const res = await fetch(`${BASE}/api/nl/suggest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie || adminCookie },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: res.status === 429 ? { error: 'rate limit' } : await res.json() };
}

beforeAll(async () => {
  adminCookie = await login('admin', 'Admin@123');
}, 30000);

// Small delay between tests to avoid rate limiting
afterEach(async () => {
  await new Promise(r => setTimeout(r, 200));
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 7: Admin — Provider Configuration
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 7 — Provider Configuration (API)', () => {
  it('TC-NL-ADM-001: GET /api/nl/config never returns raw API key', async () => {
    const res = await fetch(`${BASE}/api/nl/config`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.apiKey).toBeUndefined();
    expect(typeof data.apiKeySet).toBe('boolean');
  });

  it('TC-NL-ADM-005: non-admin cannot access config', async () => {
    const res = await fetch(`${BASE}/api/nl/config`);
    expect(res.status).toBe(401);
  });

  it('TC-NL-ADM-006: GET /api/nl-providers returns all 5 providers', async () => {
    const res = await fetch(`${BASE}/api/nl-providers`, {
      headers: { Cookie: adminCookie },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any[];
    const ids = data.map((p: any) => p.id);
    expect(ids).toContain('openai');
    expect(ids).toContain('anthropic');
    expect(ids).toContain('groq');
    expect(ids).toContain('gemini');
    expect(ids).toContain('ollama');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 8: Alias Map (API)
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 8 — Alias Map (API)', () => {
  it('TC-NL-ALI-003: alias map round-trip', async () => {
    const aliases = { 'btn-test-rt': ['test round trip button', 'sample round trip'] };
    const putRes = await fetch(`${BASE}/api/nl/aliases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify(aliases),
    });
    expect(putRes.status).toBe(200);
    const putData = await putRes.json() as any;
    expect(putData.ok).toBe(true);

    const getRes = await fetch(`${BASE}/api/nl/aliases`, {
      headers: { Cookie: adminCookie },
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json() as any;
    expect(getData['btn-test-rt']).toBeDefined();
  });

  it('TC-NL-ALI-004: unauthenticated cannot write aliases', async () => {
    const res = await fetch(`${BASE}/api/nl/aliases`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'btn-x': ['x'] }),
    });
    expect([401, 403]).toContain(res.status);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 9: Rate Limiting and Caching
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 9 — Rate Limiting and Caching (API)', () => {
  it('TC-NL-009-001: cache hit — identical request returns cached=true', async () => {
    await suggest('cache test add username');
    await new Promise(r => setTimeout(r, 300));
    const r2 = await suggest('cache test add username');
    if (r2.status === 429) { return; }
    expect(r2.status).toBe(200);
    expect(r2.data.meta?.cached).toBe(true);
  });

  it('TC-NL-009-004: rate limit enforced per session', async () => {
    const results: number[] = [];
    for (let i = 0; i < 15; i++) {
      const r = await suggest(`rate-test-unique-${Date.now()}-${i}`);
      results.push(r.status);
      await new Promise(r => setTimeout(r, 50));
    }
    expect(results.some(s => s === 429)).toBe(true);
  }, 60000);
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 10: Auth and Security (API)
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 10 — Auth and Security (API)', () => {
  it('TC-NL-SEC-001: unauthenticated request rejected', async () => {
    const res = await fetch(`${BASE}/api/nl/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'click button' }),
    });
    expect(res.status).toBe(401);
  });

  it('TC-NL-SEC-003: XSS in text — no crash', async () => {
    const r = await suggest('<script>alert(1)</script> click submit');
    if (r.status === 429) return;
    expect(r.status).toBe(200);
    expect(typeof r.data).toBe('object');
  });

  it('TC-NL-SEC-004: SQL injection in text — no server error', async () => {
    const r = await suggest("'; DROP TABLE users; -- click submit");
    if (r.status === 429) return;
    expect([200, 400]).toContain(r.status);
  });

  it('TC-NL-SEC-005: Unicode and emoji in text — no crash', async () => {
    const r = await suggest('click 🔐 the login button with ❤️');
    if (r.status === 429) return;
    expect(r.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 11: Input Validation (API)
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 11 — Input Validation (API)', () => {
  it('TC-NL-VAL-001: empty text rejected', async () => {
    const r = await suggest('');
    expect(r.status).toBe(400);
    expect(r.data.error).toMatch(/text is required/i);
  });

  it('TC-NL-VAL-002: missing text field rejected', async () => {
    const res = await fetch(`${BASE}/api/nl/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('TC-NL-VAL-003: text over 3000 characters rejected', async () => {
    const longText = 'a'.repeat(3001);
    const r = await suggest(longText);
    if (r.status === 429) return;
    expect(r.status).toBe(400);
  });

  it('TC-NL-VAL-005: single sentence under limit accepted', async () => {
    const mediumText = 'click ' + 'a'.repeat(2990);
    const r = await suggest(mediumText);
    if (r.status === 429) return;
    expect(r.status).toBe(200);
  });

  it('TC-NL-VAL-006: whitespace-only text rejected', async () => {
    const r = await suggest('   ');
    if (r.status === 429) return;
    expect(r.status).toBe(400);
  });
});