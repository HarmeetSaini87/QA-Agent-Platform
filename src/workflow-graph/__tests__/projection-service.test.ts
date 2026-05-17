// src/workflow-graph/__tests__/projection-service.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';

vi.mock('../service/workflow-envelope-adapter', () => ({
  getWorkflowEnvelope: vi.fn(),
}));

import { getProjection } from '../service/projection-service';
import { getWorkflowEnvelope } from '../service/workflow-envelope-adapter';

const mockGetEnvelope = vi.mocked(getWorkflowEnvelope);

function makeEnvelope(): WorkflowEnvelope {
  return {
    schemaVersion: '1.0',
    workflow: { id: 'col-test', name: 'Test', legacyNodes: [], nodes: [] },
    execution: { mode: 'sequential' },
    metadata: { createdAt: '2026-05-17T00:00:00.000Z', source: 'manual', collectionId: 'col-test' },
  };
}

describe('getProjection', () => {
  beforeEach(() => { mockGetEnvelope.mockReset(); });

  it('returns 404 when collection not found', () => {
    mockGetEnvelope.mockReturnValue(undefined);
    const result = getProjection('missing-id');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.code).toBe('COLLECTION_NOT_FOUND');
    }
  });

  it('returns projection when collection exists', () => {
    mockGetEnvelope.mockReturnValue(makeEnvelope());
    const result = getProjection('col-test');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.projection.meta.collectionId).toBe('col-test');
    }
  });

  it('returns 500 when adapter throws', () => {
    mockGetEnvelope.mockImplementation(() => { throw new Error('DB error'); });
    const result = getProjection('col-test');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.code).toBe('GRAPH_PROJECTION_FAILED');
    }
  });
});
