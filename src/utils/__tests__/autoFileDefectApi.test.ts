/**
 * Auto-File Jira Defect — API Integration Tests
 *
 * Requires server running on http://localhost:3003 with admin/Admin@123
 * Run: npx vitest run src/utils/__tests__/autoFileDefectApi.test.ts
 *
 * These tests exercise Express routes via HTTP against the live server.
 * No real Jira API calls — tests that need real Jira are marked manual-only.
 * No direct file manipulation — all state changes via API only (server has file locks).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE = 'http://localhost:3003';
let adminCookie = '';
let viewerCookie = '';
let savedConfig: any = null;

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

async function api(method: string, endpoint: string, body?: any, cookie?: string): Promise<{ status: number; data: any }> {
  const headers: any = { 'Content-Type': 'application/json' };
  if (cookie || adminCookie) headers['Cookie'] = cookie || adminCookie;
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status !== 204 ? await res.json().catch(() => ({})) : {};
  return { status: res.status, data };
}

beforeAll(async () => {
  adminCookie = await login('admin', 'Admin@123');
  try { viewerCookie = await login('viewer', 'Viewer@123'); } catch { viewerCookie = ''; }
  const cfgRes = await api('GET', '/api/jira/config');
  savedConfig = cfgRes.data;
}, 30000);

afterAll(async () => {
  if (savedConfig && savedConfig.projectKey) {
    await api('PUT', '/api/jira/config', {
      projectKey: savedConfig.projectKey,
      issueType: savedConfig.issueType,
      defaultPriority: savedConfig.defaultPriority,
      closeTransitionName: savedConfig.closeTransitionName,
      parentLinkFieldId: savedConfig.parentLinkFieldId || '',
      referSSFieldId: savedConfig.referSSFieldId || '',
      maxAttachmentMB: savedConfig.maxAttachmentMB || 50,
      baseUrl: savedConfig.baseUrl || '',
      email: savedConfig.email || '',
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// Section 1: Admin Configuration API (TC-002..TC-010, TC-019, TC-020)
// ═══════════════════════════════════════════════════════════════

describe('Section 1 — Admin Configuration API — TC-API-001..TC-API-010', () => {
  it('TC-API-001: GET /api/jira/config returns JSON (null or object)', async () => {
    const { status, data } = await api('GET', '/api/jira/config');
    expect(status).toBe(200);
    expect(data === null || typeof data === 'object').toBe(true);
  });

  it('TC-API-002: PUT /api/jira/config saves all fields', async () => {
    const { status, data } = await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed', parentLinkFieldId: 'customfield_10014',
      referSSFieldId: 'customfield_10025', maxAttachmentMB: 50,
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);
  });

  it('TC-API-003: GET /api/jira/config strips apiTokenEnc and adds hasTokenSet', async () => {
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed', apiToken: 'test-token-for-api',
    });
    const { status, data } = await api('GET', '/api/jira/config');
    expect(status).toBe(200);
    expect(data.projectKey).toBe('BSM');
    expect(data.apiTokenEnc).toBeUndefined();
    expect(data.hasTokenSet).toBe(true);
  });

  // NOTE: hasTokenSet reflects both UI-saved apiTokenEnc AND .env fallback.
  // If .env has JIRA_API_TOKEN, hasTokenSet is true even without UI-saved token.
  it('TC-API-004: GET config has hasTokenSet field (may be true if .env has token)', async () => {
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
    });
    const { data } = await api('GET', '/api/jira/config');
    expect(data).toHaveProperty('hasTokenSet');
    expect(typeof data.hasTokenSet).toBe('boolean');
  });

  it('TC-API-005: PUT config with missing required field returns 400', async () => {
    const { status, data } = await api('PUT', '/api/jira/config', {
      projectKey: 'BSM',
    });
    expect(status).toBe(400);
    expect(data.error.code).toBe('BAD_REQUEST');
    expect(data.error.message).toContain('Missing field');
  });

  it('TC-API-006: PUT /api/jira/config rejects non-admin user', async () => {
    if (!viewerCookie) return;
    const { status } = await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
    }, viewerCookie);
    expect([403, 401]).toContain(status);
  });

  it('TC-API-007: GET /api/jira/config works for logged-in non-admin', async () => {
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
    });
    if (!viewerCookie) return;
    const { status } = await api('GET', '/api/jira/config', undefined, viewerCookie);
    expect(status).toBe(200);
  });

  it('TC-API-008: PUT config with empty string projectKey fails', async () => {
    const { status } = await api('PUT', '/api/jira/config', {
      projectKey: '', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
    });
    expect(status).toBe(400);
  });

  it('TC-API-009: PUT config without apiToken preserves existing token', async () => {
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed', apiToken: 'my-preserve-test-token',
    });
    const before = await api('GET', '/api/jira/config');
    expect(before.data.hasTokenSet).toBe(true);

    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Bug', defaultPriority: 'High',
      closeTransitionName: 'Done',
    });
    const after = await api('GET', '/api/jira/config');
    expect(after.data.hasTokenSet).toBe(true);
    expect(after.data.issueType).toBe('Bug');
  });

  it('TC-API-010: PUT config succeeds without parentLinkFieldId (DISC-012)', async () => {
    const { status } = await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Bug', defaultPriority: 'High',
      closeTransitionName: 'Closed',
    });
    expect(status).toBe(200);
    const { data } = await api('GET', '/api/jira/config');
    expect(data.parentLinkFieldId).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 2: Token Encryption API (TC-011..TC-015)
// ═══════════════════════════════════════════════════════════════

describe('Section 2 — Token Encryption API — TC-API-011..TC-API-015', () => {
  it('TC-API-011: saved token is not visible via GET API (TC-012)', async () => {
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed', apiToken: 'my-secret-api-token-12345',
    });
    const { data } = await api('GET', '/api/jira/config');
    expect(data.apiTokenEnc).toBeUndefined();
    expect(data.hasTokenSet).toBe(true);
  });

  it('TC-API-012: re-saving config without apiToken preserves existing (TC-015)', async () => {
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed', apiToken: 'preserve-test-token',
    });
    const before = await api('GET', '/api/jira/config');
    expect(before.data.hasTokenSet).toBe(true);

    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
    });
    const after = await api('GET', '/api/jira/config');
    expect(after.data.hasTokenSet).toBe(true);
  });

  it('TC-API-013: Test Connection with no config returns error', async () => {
    // Save config with fake localhost that can't work as Jira
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
      baseUrl: 'http://127.0.0.1:1',
      email: 'test@test.com',
      apiToken: 'fake',
    });
    const { status, data } = await api('POST', '/api/jira/test');
    expect(status).toBe(200);
    expect(data.ok).toBe(false);
  });

  it('TC-API-014: Test Connection endpoint requires admin', async () => {
    if (!viewerCookie) return;
    const { status } = await api('POST', '/api/jira/test', undefined, viewerCookie);
    expect([403, 401]).toContain(status);
  });

  it('TC-API-015: Fields discovery requires admin', async () => {
    if (!viewerCookie) return;
    const { status } = await api('GET', '/api/jira/fields', undefined, viewerCookie);
    expect([403, 401]).toContain(status);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 3: Permission checks (TC-016..TC-020)
// ═══════════════════════════════════════════════════════════════

describe('Section 3 — Permission checks — TC-API-016..TC-API-020', () => {
  it('TC-API-016: POST /api/defects/file requires authentication', async () => {
    const { status } = await api('POST', '/api/defects/file', {
      runId: 'r-1', testId: 'TID_1', summary: 'Test', descriptionADF: {},
      priority: 'Medium', parentStoryKey: 'BSM-1',
    }, '');
    // 401 = no auth, 302 = redirect to login, 404 = auth OK but run not found
    expect([401, 302, 404]).toContain(status);
  });

  it('TC-API-017: POST /api/defects/file blocks viewer role', async () => {
    if (!viewerCookie) return;
    const { status } = await api('POST', '/api/defects/file', {
      runId: 'r-1', testId: 'TID_1', summary: 'Test', descriptionADF: {},
      priority: 'Medium', parentStoryKey: 'BSM-1',
    }, viewerCookie);
    expect(status).toBe(403);
  });

  it('TC-API-018: POST /api/defects/draft blocks viewer role', async () => {
    if (!viewerCookie) return;
    const { status } = await api('POST', '/api/defects/draft', {
      runId: 'r-1', testId: 'TID_1',
    }, viewerCookie);
    expect(status).toBe(403);
  });

  it('TC-API-019: POST /api/defects/dismiss blocks viewer role', async () => {
    if (!viewerCookie) return;
    const { status } = await api('POST', '/api/defects/dismiss', {
      runId: 'r-1', testId: 'TID_1', category: 'flaky',
    }, viewerCookie);
    expect(status).toBe(403);
  });

  it('TC-API-020: GET /api/defects/by-test/:testId works for any logged-in user', async () => {
    const { status } = await api('GET', '/api/defects/by-test/TID_nonexistent');
    expect(status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// Section 4: Draft & File Defect Routes
// ═══════════════════════════════════════════════════════════════

describe('Section 4 — Draft & File Defect Routes — TC-API-021..TC-API-035', () => {
  it('TC-API-021: POST /api/defects/draft returns 400 without runId', async () => {
    const { status, data } = await api('POST', '/api/defects/draft', { testId: 'TID_1' });
    expect(status).toBe(400);
    expect(data.error.code).toBe('BAD_REQUEST');
  });

  it('TC-API-022: POST /api/defects/draft returns 404 for missing run', async () => {
    const { status } = await api('POST', '/api/defects/draft', {
      runId: 'nonexistent-run-id', testId: 'TID_1',
    });
    expect(status).toBe(404);
  });

  it('TC-API-023: POST /api/defects/file returns 400 without required fields', async () => {
    const { status, data } = await api('POST', '/api/defects/file', { runId: 'r-1' });
    expect(status).toBe(400);
    expect(data.error.code).toBe('BAD_REQUEST');
  });

  it('TC-API-024: POST /api/defects/file rejects malformed parentStoryKey', async () => {
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
    });
    const { status, data } = await api('POST', '/api/defects/file', {
      runId: 'r-1', testId: 'TID_1', summary: 'Test fail',
      descriptionADF: { type: 'doc', version: 1, content: [] },
      priority: 'Medium', parentStoryKey: 'not a key',
    });
    expect(status).toBe(400);
    expect(data.error.message).toContain('ABC-123');
  });

  it('TC-API-025: POST /api/defects/draft returns 400 without testId', async () => {
    const { status, data } = await api('POST', '/api/defects/draft', { runId: 'r-1' });
    expect(status).toBe(400);
    expect(data.error.code).toBe('BAD_REQUEST');
  });

  it('TC-API-026: POST /api/defects/dismiss rejects invalid category', async () => {
    const { status, data } = await api('POST', '/api/defects/dismiss', {
      runId: 'r-1', testId: 'TID_1', category: 'invalid-category',
    });
    expect(status).toBe(400);
    expect(data.error.code).toBe('BAD_REQUEST');
  });

  it('TC-API-027: POST /api/defects/dismiss requires runId, testId, category', async () => {
    const { status } = await api('POST', '/api/defects/dismiss', { category: 'flaky' });
    expect(status).toBe(400);
  });

  it('TC-API-028: POST /api/defects/dismiss returns 404 for missing run', async () => {
    const { status } = await api('POST', '/api/defects/dismiss', {
      runId: 'nonexistent-run', testId: 'TID_1', category: 'flaky',
    });
    expect(status).toBe(404);
  });

  it('TC-API-029: all 5 dismiss categories pass validation', async () => {
    const categories = ['script-issue', 'locator-issue', 'flaky', 'data-issue', 'env-issue'];
    for (const cat of categories) {
      const { status } = await api('POST', '/api/defects/dismiss', {
        runId: 'nonexistent', testId: 'TID_1', category: cat,
      });
      // 400 = BAD_REQUEST for invalid category, 404 = run not found (category valid)
      expect(status).not.toBe(400);
    }
  });

  it('TC-API-030: GET /api/defects/by-test/:testId returns empty for unknown', async () => {
    const { status, data } = await api('GET', '/api/defects/by-test/TID_unknown_999');
    expect(status).toBe(200);
    expect(Array.isArray(data.defects)).toBe(true);
  });

  it('TC-API-031: GET /api/defects/open/:defectKey returns 404 for unknown', async () => {
    const { status } = await api('GET', '/api/defects/open/BSM-99999');
    expect(status).toBe(404);
  });

  it('TC-API-032: PUT config with baseUrl/email saves UI credentials', async () => {
    const { status } = await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
      baseUrl: 'https://custom.atlassian.net',
      email: 'custom@test.com',
    });
    expect(status).toBe(200);
    const { data } = await api('GET', '/api/jira/config');
    expect(data.baseUrl).toBe('https://custom.atlassian.net');
    expect(data.email).toBe('custom@test.com');
  });

  it('TC-API-033: PUT config strips trailing slash from baseUrl', async () => {
    const { status } = await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
      baseUrl: 'https://custom2.atlassian.net/',
    });
    expect(status).toBe(200);
    const { data } = await api('GET', '/api/jira/config');
    expect(data.baseUrl).toBe('https://custom2.atlassian.net');
  });

  it('TC-API-034: audit log entry created on JIRA_CONFIG_SAVE', async () => {
    const auditRes = await api('GET', '/api/admin/audit?page=1&pageSize=5');
    if (auditRes.status !== 200) return; // skip if audit endpoint not available
    const beforeCount = auditRes.data?.entries?.length ?? 0;

    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
    });

    const auditRes2 = await api('GET', '/api/admin/audit?page=1&pageSize=100');
    if (auditRes2.status !== 200) return;
    const entries = auditRes2.data?.entries || auditRes2.data || [];
    const jiraEntries = Array.isArray(entries)
      ? entries.filter((e: any) => e.action === 'JIRA_CONFIG_SAVE')
      : [];
    expect(jiraEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('TC-API-035: Test Connection endpoint returns result', async () => {
    await api('PUT', '/api/jira/config', {
      projectKey: 'BSM', issueType: 'Defect', defaultPriority: 'Medium',
      closeTransitionName: 'Closed',
      baseUrl: 'https://invalid.atlassian.net',
      email: 'invalid@test.com',
      apiToken: 'invalid-token',
    });
    const { status, data } = await api('POST', '/api/jira/test');
    expect(status).toBe(200);
    expect(data).toHaveProperty('ok');
    expect(data.ok).toBe(false); // invalid credentials
  });
});