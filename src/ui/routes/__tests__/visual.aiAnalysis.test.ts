import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the analyser module
vi.mock('../../../utils/vrtAiAnalyser', () => ({
  classifyDiff: vi.fn().mockResolvedValue({
    classifications: ['Content Change'],
    regions: 1,
    recommendation: 'review',
    recommendationReason: 'Content change detected',
    dimensionMismatch: false,
    stage: 'rule-based',
  }),
  enhanceWithAi: vi.fn().mockResolvedValue({
    classifications: ['Content Change'],
    regions: 1,
    recommendation: 'approve',
    recommendationReason: 'Minor content update',
    dimensionMismatch: false,
    narrative: 'The heading text changed slightly.',
    confidence: 87,
    suggestedAction: 'approve',
    model: 'claude-haiku-4-5',
    stage: 'ai-enhanced',
  }),
}));

// Mock auth middleware to pass through
vi.mock('../../../auth/middleware', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireEditor: (_req: any, _res: any, next: any) => next(),
  requireAuthOrApiKey: (_req: any, _res: any, next: any) => next(),
}));

// Mock visualRegression — getBaseline is what visual.routes.ts uses
vi.mock('../../../utils/visualRegression', () => ({
  getAllBaselines: vi.fn().mockReturnValue([]),
  getBaseline: vi.fn().mockReturnValue({
    id: 'test-baseline-id',
    testName: 'Login Test',
    locatorName: '#submit-btn',
    diffPct: 3.4,
    diffPixels: 1200,
    totalPixels: 35000,
    baselineWidth: 1280,
    baselineHeight: 720,
    actualWidth: 1280,
    actualHeight: 720,
    diffPath: 'data/baselines/test-baseline-id-diff.png',
    ignoreRegions: [],
    projectId: 'proj-1',
    hasDiff: true,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }),
  approveBaseline: vi.fn().mockReturnValue(true),
  deleteBaseline: vi.fn().mockReturnValue(true),
  baselineImagePath: vi.fn().mockReturnValue('/tmp/image.png'),
  compareScreenshot: vi.fn(),
  mergeVrtConfig: vi.fn().mockReturnValue({}),
  makeBaselineId: vi.fn().mockReturnValue('test-baseline-id'),
  getIgnoreRegions: vi.fn().mockReturnValue([]),
  addIgnoreRegion: vi.fn(),
  updateIgnoreRegion: vi.fn(),
  deleteIgnoreRegion: vi.fn(),
}));

// Mock other dependencies used by visual.routes.ts
vi.mock('../../../data/store', () => ({
  readAll: vi.fn().mockReturnValue([]),
  upsert: vi.fn(),
  findById: vi.fn(),
  LOCATORS: 'locators',
  PROJECTS: 'projects',
}));
vi.mock('../../../utils/healingEngine', () => ({
  scoreCandidates: vi.fn().mockReturnValue([]),
  T3_AUTO_THRESHOLD: 90,
}));
vi.mock('../../../utils/pageModelManager', () => ({
  upsertPageModel: vi.fn(),
  listPageModels: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../auth/audit', () => ({
  logAudit: vi.fn(),
}));
vi.mock('../../../ui/helpers/run-spawner', () => ({
  backfillScriptsAndFunctions: vi.fn(),
}));
vi.mock('../../../framework/config', () => ({
  config: { ui: { port: 3003 } },
}));
vi.mock('../../../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('POST /api/visual-baselines/:id/ai-analysis', () => {
  let app: express.Application;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Re-import the routes module fresh each test
    const { registerVisualRoutes } = await import('../visual.routes');
    app = express();
    app.use(express.json());
    registerVisualRoutes(app);
  });

  it('returns 200 with rule-based classification', async () => {
    const res = await request(app)
      .post('/api/visual-baselines/test-baseline-id/ai-analysis')
      .send({
        enhance: false,
        runContext: {
          testName: 'Login Test',
          locatorName: '#submit-btn',
          diffPct: 3.4,
          diffPixels: 1200,
          totalPixels: 35000,
          baselineWidth: 1280,
          baselineHeight: 720,
          actualWidth: 1280,
          actualHeight: 720,
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('rule-based');
    expect(res.body.classifications).toContain('Content Change');
    expect(res.body.recommendation).toBe('review');
  });

  it('returns 200 with ai-enhanced result when enhance=true', async () => {
    const res = await request(app)
      .post('/api/visual-baselines/test-baseline-id/ai-analysis')
      .send({
        enhance: true,
        runContext: {
          testName: 'Login Test',
          locatorName: '#submit-btn',
          diffPct: 3.4,
          diffPixels: 1200,
          totalPixels: 35000,
          baselineWidth: 1280,
          baselineHeight: 720,
          actualWidth: 1280,
          actualHeight: 720,
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.stage).toBe('ai-enhanced');
    expect(res.body.narrative).toBeTruthy();
    expect(res.body.confidence).toBe(87);
  });

  it('returns 422 when AI provider not configured (enhance=true)', async () => {
    const { enhanceWithAi } = await import('../../../utils/vrtAiAnalyser');
    (enhanceWithAi as any).mockRejectedValueOnce(new Error('No AI provider configured'));

    const res = await request(app)
      .post('/api/visual-baselines/test-baseline-id/ai-analysis')
      .send({
        enhance: true,
        runContext: {
          testName: 'Login Test',
          locatorName: '#submit-btn',
          diffPct: 3.4,
          diffPixels: 1200,
          totalPixels: 35000,
          baselineWidth: 1280,
          baselineHeight: 720,
          actualWidth: 1280,
          actualHeight: 720,
        },
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/No AI provider/i);
  });
});
