// src/api-plugins/__tests__/sdk-access-layer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SdkAccessLayer } from '../sdk-access-layer';

// Mock the store — SDK tests must not touch real file system
vi.mock('../../data/store', () => ({
  findById: vi.fn(),
  API_COLLECTIONS: 'api-collections',
}));

import { findById } from '../../data/store';

const mockFindById = vi.mocked(findById);

describe('SdkAccessLayer', () => {
  let sdk: SdkAccessLayer;
  beforeEach(() => {
    sdk = new SdkAccessLayer();
    mockFindById.mockReset();
  });

  it('getWorkflowInfo: returns null for unknown collection', () => {
    mockFindById.mockReturnValue(undefined);
    expect(sdk.getWorkflowInfo('col-missing')).toBeNull();
  });

  it('getWorkflowInfo: returns SdkWorkflowInfo for known collection', () => {
    mockFindById.mockReturnValue({ id: 'col-1', steps: [{ id: 's1' }, { id: 's2' }] } as never);
    const info = sdk.getWorkflowInfo('col-1');
    expect(info?.collectionId).toBe('col-1');
    expect(info?.stepCount).toBe(2);
  });

  it('getReplaySummary: never exposes raw event payloads', () => {
    const summary = sdk.getReplaySummary('run-1');
    expect(summary?.deterministicGuarantee).toBe(true);
    expect(summary?.summary?.note).toContain('not exposed');
  });

  it('getAnalyticsSummary: returns stub with collectionId', () => {
    const analytics = sdk.getAnalyticsSummary('col-1');
    expect(analytics?.collectionId).toBe('col-1');
    expect(analytics?.avgPassRate).toBeUndefined();
  });

  it('getGraphSummary: returns null for unknown collection', () => {
    mockFindById.mockReturnValue(undefined);
    expect(sdk.getGraphSummary('col-missing')).toBeNull();
  });

  it('getGraphSummary: returns node count from steps', () => {
    mockFindById.mockReturnValue({ id: 'col-1', steps: [{ id: 's1' }] } as never);
    expect(sdk.getGraphSummary('col-1')?.nodeCount).toBe(1);
  });
});
