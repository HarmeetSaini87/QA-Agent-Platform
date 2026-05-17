// src/workflow-graph/__tests__/graph-projection-snapshots.test.ts
import { describe, it, expect } from 'vitest';
import { buildGraphProjection } from '../projection/graph-projection-builder';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';
import postmanFixture from './fixtures/postman-envelope.json';
import openapiFixture from './fixtures/openapi-envelope.json';
import legacyFixture from './fixtures/legacy-envelope.json';

const FIXED_OPTS = { projectedAt: '2026-05-17T00:00:00.000Z' };

function toEnvelope(fixture: Record<string, unknown>): WorkflowEnvelope {
  const { _fixtureVersion: _, ...rest } = fixture;
  return rest as unknown as WorkflowEnvelope;
}

describe('GraphProjection golden snapshots', () => {
  it('Postman envelope snapshot', () => {
    const result = buildGraphProjection(toEnvelope(postmanFixture as Record<string, unknown>), FIXED_OPTS);
    expect(result).toMatchSnapshot();
  });

  it('OpenAPI envelope snapshot', () => {
    const result = buildGraphProjection(toEnvelope(openapiFixture as Record<string, unknown>), FIXED_OPTS);
    expect(result).toMatchSnapshot();
  });

  it('Legacy envelope snapshot', () => {
    const result = buildGraphProjection(toEnvelope(legacyFixture as Record<string, unknown>), FIXED_OPTS);
    expect(result).toMatchSnapshot();
    // Legacy must emit LEGACY_NODE_PROJECTION warning
    expect(result.warnings?.some(w => w.code === 'LEGACY_NODE_PROJECTION')).toBe(true);
  });
});
