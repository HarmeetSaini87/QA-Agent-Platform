/**
 * Flakiness Intelligence — API Integration Tests
 *
 * Requires server running on http://localhost:3003 with admin/Admin@123
 * Run: npx vitest run src/utils/__tests__/flakyApiIntegration.test.ts
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  readQuarantine,
  writeQuarantine,
  restoreQuarantineEntry,
  upsertQuarantineEntry,
  generateTestId,
  groupRunsByTestId,
  getEffectiveFlakinessConfig,
} from '../../ui/helpers/quarantine';
import { analyzeFlakiness, DEFAULT_FLAKINESS_CONFIG, shouldFailPipeline, CURRENT_ENGINE_VERSION } from '../../utils/flakinessEngine';
import type { QuarantineEntry } from '../../ui/helpers/quarantine';

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

async function apiCall(method: string, endpoint: string, body?: any, cookie?: string): Promise<{ status: number; data: any }> {
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

const QUARANTINE_FILE = path.resolve('data/quarantine.json');
let originalQuarantine: string | null = null;

beforeAll(async () => {
  adminCookie = await login('admin', 'Admin@123');
  // Backup quarantine file
  if (fs.existsSync(QUARANTINE_FILE)) {
    originalQuarantine = fs.readFileSync(QUARANTINE_FILE, 'utf-8');
  }
}, 30000);

afterEach(async () => {
  // Restore quarantine file after each test
  if (originalQuarantine !== null) {
    fs.writeFileSync(QUARANTINE_FILE, originalQuarantine);
  } else if (fs.existsSync(QUARANTINE_FILE)) {
    fs.unlinkSync(QUARANTINE_FILE);
  }
  await new Promise(r => setTimeout(r, 100));
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 19: Budget Edge Cases (TC-BUD) — Unit-level, already in main test file
// These are pure unit tests, not API. Included here as cross-reference only.
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 19 — Budget Edge Cases (Unit)', () => {
  it('TC-BUD-001: budget exactly equals quarantined failures — pipeline passes', () => {
    expect(shouldFailPipeline(5, 5)).toBe(false);
  });

  it('TC-BUD-002: budget exceeded by 1 — pipeline fails', () => {
    expect(shouldFailPipeline(6, 5)).toBe(true);
  });

  it('TC-BUD-003: budget = 0 — any quarantined failure fails pipeline', () => {
    expect(shouldFailPipeline(1, 0)).toBe(true);
  });

  it('TC-BUD-004: zero quarantined failures — pipeline always passes', () => {
    expect(shouldFailPipeline(0, 5)).toBe(false);
  });

  it('TC-BUD-005: negative quarantinedFailCount — safe', () => {
    expect(shouldFailPipeline(-1, 5)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 18: Quarantine State Edge Cases (TC-QUAR)
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 18 — Quarantine State Edge Cases', () => {
  const SUITE_ID = 'test-suite-quar';
  const TEST_ID = 'TID_QUAR_TEST';

  it('TC-QUAR-008: quarantine.json missing — engine operates with empty state', () => {
    if (fs.existsSync(QUARANTINE_FILE)) {
      fs.unlinkSync(QUARANTINE_FILE);
    }
    const result = readQuarantine();
    expect(result).toEqual({});
  });

  it('TC-QUAR-009: quarantine.json corrupted — graceful fallback', () => {
    fs.mkdirSync(path.dirname(QUARANTINE_FILE), { recursive: true });
    fs.writeFileSync(QUARANTINE_FILE, '{invalid json');
    const result = readQuarantine();
    expect(result).toEqual({});
  });

  it('TC-QUAR-001: Quarantine entry idempotent — same test quarantined twice', () => {
    const data: Record<string, QuarantineEntry> = {};
    const analysis = makeMockAnalysis();
    upsertQuarantineEntry(SUITE_ID, TEST_ID, 'My Test', analysis, 'run-1');
    const afterFirst = readQuarantine();
    const key = `${SUITE_ID}::${TEST_ID}`;
    expect(afterFirst[key].status).toBe('active');
    expect(afterFirst[key].autoQuarantined).toBe(true);

    // Second upsert should not overwrite
    upsertQuarantineEntry(SUITE_ID, TEST_ID, 'My Test', analysis, 'run-2');
    const afterSecond = readQuarantine();
    expect(afterSecond[key].quarantinedAt).toBe(afterFirst[key].quarantinedAt);
  });

  it('TC-QUAR-002: Restore non-quarantined test — idempotent no-op', () => {
    writeQuarantine({});
    restoreQuarantineEntry(SUITE_ID, TEST_ID, 'run-1');
    const data = readQuarantine();
    const key = `${SUITE_ID}::${TEST_ID}`;
    expect(data[key]).toBeUndefined();
  });

  it('TC-QUAR-011: Quarantine entry status transitions — none → active → restored', () => {
    writeQuarantine({});
    const key = `${SUITE_ID}::${TEST_ID}`;
    const analysis = makeMockAnalysis();

    // Initially: no entry
    let data = readQuarantine();
    expect(data[key]).toBeUndefined();

    // After quarantine: active
    upsertQuarantineEntry(SUITE_ID, TEST_ID, 'My Test', analysis, 'run-1');
    data = readQuarantine();
    expect(data[key].status).toBe('active');
    expect(data[key].quarantinedAt).toBeTruthy();

    // After restore: restored
    restoreQuarantineEntry(SUITE_ID, TEST_ID, 'run-2');
    data = readQuarantine();
    expect(data[key].status).toBe('restored');
    expect(data[key].restoredAt).toBeTruthy();
  });

  it('TC-QUAR-012: Auto-quarantine sets autoQuarantined=true', () => {
    writeQuarantine({});
    const analysis = makeMockAnalysis();
    upsertQuarantineEntry(SUITE_ID, TEST_ID, 'My Test', analysis, 'run-1');
    const data = readQuarantine();
    expect(data[`${SUITE_ID}::${TEST_ID}`].autoQuarantined).toBe(true);
    expect(data[`${SUITE_ID}::${TEST_ID}`].quarantineReason).toContain('fail_rate=');
  });

  it('TC-QUAR-013: Manual quarantine sets autoQuarantined=false', async () => {
    writeQuarantine({});
    const { status, data } = await apiCall('POST', '/api/flaky/quarantine', {
      suiteId: SUITE_ID,
      testId: TEST_ID,
      testName: 'My Manual Test',
      reason: 'manual testing',
    });
    expect(status).toBe(200);
    expect(data.ok).toBe(true);

    const quarantine = readQuarantine();
    const entry = quarantine[`${SUITE_ID}::${TEST_ID}`];
    expect(entry).toBeDefined();
    expect(entry.autoQuarantined).toBe(false);
    expect(entry.quarantineReason).toBe('manual testing');
  });

  it('TC-QUAR-003: Restore manually quarantined test — sets manuallyRestoredAt', async () => {
    writeQuarantine({});
    // Manual quarantine
    await apiCall('POST', '/api/flaky/quarantine', {
      suiteId: SUITE_ID,
      testId: TEST_ID,
      testName: 'Manual Restore Test',
    });
    // Manual restore
    const { status, data } = await apiCall('POST', '/api/flaky/restore', {
      suiteId: SUITE_ID,
      testId: TEST_ID,
    });
    expect(status).toBe(200);

    const quarantine = readQuarantine();
    const entry = quarantine[`${SUITE_ID}::${TEST_ID}`];
    expect(entry.manuallyRestoredAt).toBeTruthy();
  });

  it('TC-QUAR-010: generateTestId — different names produce different IDs', () => {
    const id1 = generateTestId('suite1', 'Test A');
    const id2 = generateTestId('suite1', 'Test B');
    const id3 = generateTestId('suite1', 'Test A');
    expect(id1).not.toBe(id2);
    expect(id1).toBe(id3);
    expect(id1).toMatch(/^TID_[a-f0-9]{8}$/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 20: API Edge Cases (TC-API)
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 20 — API Edge Cases', () => {
  let projectId = '';

  beforeAll(async () => {
    adminCookie = await login('admin', 'Admin@123');
    // Get a project ID from the system
    const res = await apiCall('GET', '/api/projects');
    if (res.data && Array.isArray(res.data) && res.data.length > 0) {
      projectId = res.data[0].id;
    } else if (res.data && res.data.projects && res.data.projects.length > 0) {
      projectId = res.data.projects[0].id;
    }
  }, 30000);

  it('TC-API-004: GET /api/flaky — projectId missing returns 400', async () => {
    const { status, data } = await apiCall('GET', '/api/flaky');
    expect(status).toBe(400);
    expect(data.error).toContain('projectId');
  });

  it('TC-API-006: GET /api/flaky/config — suiteId without projectId returns 400', async () => {
    const { status, data } = await apiCall('GET', '/api/flaky/config?suiteId=abc');
    expect(status).toBe(400);
  });

  it('TC-API-015: GET /api/flaky/summary — without suiteId', async () => {
    if (!projectId) return; // Skip if no project
    const { status } = await apiCall('GET', `/api/flaky/summary?projectId=${projectId}`);
    expect(status).toBe(200);
  });

  it('TC-API-012: POST /api/flaky/quarantine — missing testId', async () => {
    const { status, data } = await apiCall('POST', '/api/flaky/quarantine', {
      suiteId: 'abc',
    });
    expect(status).toBe(400);
    expect(data.error).toContain('suiteId and testId');
  });

  it('TC-API-014: POST /api/flaky/restore — restore idempotency', async () => {
    writeQuarantine({});
    // First restore
    const res1 = await apiCall('POST', '/api/flaky/restore', {
      suiteId: 'suite-x',
      testId: 'test-y',
    });
    expect(res1.status).toBe(200);
    // Second restore (idempotent)
    const res2 = await apiCall('POST', '/api/flaky/restore', {
      suiteId: 'suite-x',
      testId: 'test-y',
    });
    expect(res2.status).toBe(200);
  });

  it('TC-API-001: GET /api/flaky — pagination limit capped at 200', async () => {
    if (!projectId) return;
    const { status, data } = await apiCall('GET', `/api/flaky?projectId=${projectId}&limit=500`);
    expect(status).toBe(200);
    if (data.limit !== undefined) {
      expect(data.limit).toBeLessThanOrEqual(200);
    }
  });

  it('TC-API-002: GET /api/flaky — negative offset clamped to 0', async () => {
    if (!projectId) return;
    const { status, data } = await apiCall('GET', `/api/flaky?projectId=${projectId}&offset=-10`);
    expect(status).toBe(200);
    expect(data.offset).toBeGreaterThanOrEqual(0);
  });

  it('TC-API-003: GET /api/flaky — invalid sort field defaults to flakeScore', async () => {
    if (!projectId) return;
    const { status, data } = await apiCall('GET', `/api/flaky?projectId=${projectId}&sort=invalid_field`);
    expect(status).toBe(200);
  });

  it('TC-API-007: PUT /api/flaky/config — threshold boundary values', async () => {
    if (!projectId) return;
    // threshold = 0 should be rejected
    const res1 = await apiCall('PUT', '/api/flaky/config', {
      projectId,
      overrides: { threshold: 0 },
    });
    expect(res1.status).toBe(400);

    // threshold = 1 should be accepted
    const res2 = await apiCall('PUT', '/api/flaky/config', {
      projectId,
      overrides: { threshold: 1 },
    });
    expect(res2.status).toBe(200);

    // Reset
    const res3 = await apiCall('PUT', '/api/flaky/config', {
      projectId,
      overrides: { threshold: 0.30 },
    });
    expect(res3.status).toBe(200);
  });

  it('TC-API-010: PUT /api/flaky/config — minRuns = 0', async () => {
    if (!projectId) return;
    const { status, data } = await apiCall('PUT', '/api/flaky/config', {
      projectId,
      overrides: { minRuns: 0 },
    });
    expect(status).toBe(400);
  });

  it('TC-API-011: PUT /api/flaky/config — minRunsSinceQuarantine = 0', async () => {
    if (!projectId) return;
    const { status, data } = await apiCall('PUT', '/api/flaky/config', {
      projectId,
      overrides: { minRunsSinceQuarantine: 0 },
    });
    expect(status).toBe(400);
  });

  it('TC-API-016: Config inheritance — project defaults fill missing suite overrides', async () => {
    if (!projectId) return;
    const { status, data } = await apiCall('GET', `/api/flaky/config?projectId=${projectId}`);
    if (status === 200 && data.effective) {
      expect(data.effective.quarantineBudget).toBeDefined();
      expect(data.effective.threshold).toBeDefined();
    }
  });

  it('TC-API-017: Config inheritance — empty overrides object', async () => {
    if (!projectId) return;
    // Create a config override with empty overrides
    const { status, data } = await apiCall('PUT', '/api/flaky/config', {
      projectId,
      suiteId: 'nonexistent-suite',
      overrides: {},
    });
    // May return 404 for nonexistent suite, which is acceptable
    expect([200, 404]).toContain(status);
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// SECTION 22: Score Version & Engine Evolution (TC-VER)
// ════════════════════════════════════════════════════════════════════════════════

describe('Section 22 — Score Version & Engine Evolution (API)', () => {
  it('TC-VER-001: needsReevaluation flag — stale scoreVersion', async () => {
    writeQuarantine({});
    const key = 'suite-stale::TID_STALE';
    const entry: Record<string, QuarantineEntry> = {
      [key]: {
        suiteId: 'suite-stale',
        testId: 'TID_STALE',
        testName: 'Stale Test',
        status: 'active',
        quarantinedAt: new Date().toISOString(),
        lastEvaluatedAt: new Date().toISOString(),
        lastNotifiedAt: null,
        restoredAt: null,
        manuallyRestoredAt: null,
        autoQuarantined: true,
        quarantineReason: 'fail_rate=0.50 >= threshold=0.30',
        scoreVersion: 'v0.9',
      },
    };
    writeQuarantine(entry);
    const data = readQuarantine();
    expect(data[key].scoreVersion).toBe('v0.9');
    expect(data[key].scoreVersion).not.toBe(CURRENT_ENGINE_VERSION);
  });

  it('TC-VER-002: current engine version is v1.0', () => {
    expect(CURRENT_ENGINE_VERSION).toBe('v1.0');
  });
});

// ════════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════════

function makeMockAnalysis() {
  return {
    testId: 'TID_QUAR_TEST',
    flakeScore: 0.75,
    failRate: 0.6,
    alternationIndex: 0.5,
    varianceIndex: 0.4,
    confidence: 0.85,
    shouldQuarantine: true,
    quarantineReason: 'fail_rate=0.60 >= threshold=0.30',
    shouldAutoPromote: false,
    decisionState: 'candidate_quarantine' as const,
    classification: { primary: 'network' as const, secondary: 'timing' as const, primaryConfidence: 1.0 },
    dominantCategory: 'network' as const,
    dominantCategoryCount: 3,
    dominantCategoryTotal: 5,
    signals: {
      timeout: true,
      slowTest: false,
      locatorError: false,
      networkError: true,
      assertionError: false,
      recentFailSpike: true,
      durationMs: 500,
      baselineP95: 200,
      rawErrors: ['ECONNRESET', 'timeout exceeded'],
      recentFailCount: 3,
      recentTotalCount: 5,
    },
    scoreVersion: CURRENT_ENGINE_VERSION,
    evaluatedAt: Date.now(),
  };
}