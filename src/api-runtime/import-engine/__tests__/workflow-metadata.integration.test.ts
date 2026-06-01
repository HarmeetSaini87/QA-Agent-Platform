/**
 * workflow-metadata.integration.test.ts
 * Phase D Step 4 — Integration tests for hybrid workflow metadata & graph readiness.
 *
 * Covers:
 *  - Postman full pipeline metadata (normalizationSource, metadataVersion, folderHierarchy, aiReadiness)
 *  - Postman golden snapshot contract
 *  - Legacy adapter provenance fields
 *  - Legacy golden snapshot contract
 *  - JSON round-trip serialization
 *  - Execution ignorance (validateCompatibility identical with/without metadata)
 *  - Partial metadata tolerance (graphHints only)
 *  - Unknown/future metadata fields tolerance
 *  - Deep hierarchy stress (6-level nesting → FOLDER_DEPTH_EXCEEDED warning)
 */

import { describe, it, expect } from 'vitest';
import { importFromPostman } from '../postman-workflow-mapper';
import { importFromOpenApi } from '../openapi-parser';
import { collectionToWorkflow } from '../../../workflow-dsl/legacy-adapter';
import { stripExecutionMetadata } from '../../../workflow-dsl/metadata-sanitizer';
import { validateCompatibility } from '../compatibility-validator';
import type { PostmanImportOptions, ImportOptions, ImportResult } from '../contracts';
import type { ApiCollection } from '../../../data/types';
import postmanSnapshot from './fixtures/postman-metadata-snapshot.json';
import legacySnapshot from './fixtures/legacy-metadata-snapshot.json';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const POSTMAN_COLLECTION = JSON.stringify({
  info: {
    name: 'Integration Test Collection',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    _postman_id: 'int-col-001',
  },
  item: [
    {
      name: 'Auth',
      item: [
        {
          name: 'POST /token',
          request: {
            method: 'POST',
            url: { raw: 'https://api.test.com/token' },
            header: [],
            body: { mode: 'raw', raw: '{}' },
          },
        },
      ],
    },
    {
      name: 'GET /users',
      request: {
        method: 'GET',
        url: { raw: 'https://api.test.com/users' },
        header: [],
      },
    },
  ],
});

const POSTMAN_OPTS: PostmanImportOptions = { environmentId: 'env-int', projectId: 'proj-int' };

const OPENAPI_SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  servers: [{ url: 'https://api.test.com' }],
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        tags: ['items'],
        summary: 'List items',
        responses: { '200': { description: 'OK' } },
      },
    },
  },
});

const OPENAPI_OPTS: ImportOptions = { environmentId: 'env-int', projectId: 'proj-int' };

// ApiCollection shape from src/data/types.ts — required fields only (projectId is optional there)
const LEGACY_COLLECTION: ApiCollection = {
  id: 'legacy-col-001',
  name: 'Legacy Collection',
  environmentId: 'env-int',
  steps: [],
  variables: [],
  onFailure: 'stop',
  executionMode: 'sequential',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Postman import — full pipeline metadata', () => {
  it('produces WorkflowEnvelope with correct hierarchy and metadata', () => {
    const result = importFromPostman(POSTMAN_COLLECTION, POSTMAN_OPTS);
    expect(result.envelope.metadata.normalizationSource).toBe('postman');
    expect(result.envelope.metadata.metadataVersion).toBe(1);
    expect(result.envelope.metadata.folderHierarchy).toBeDefined();
    expect(result.envelope.metadata.aiReadiness).toBeDefined();
    expect(result.envelope.workflow.nodes?.length).toBeGreaterThan(0);
  });

  it('matches postman snapshot contract', () => {
    const result = importFromPostman(POSTMAN_COLLECTION, POSTMAN_OPTS);
    expect(result.envelope.metadata.normalizationSource).toBe(postmanSnapshot.expectedNormalizationSource);
    expect(result.envelope.metadata.metadataVersion).toBe(postmanSnapshot.expectedMetadataVersion);
    if (postmanSnapshot.expectedFolderHierarchyDefined) {
      expect(result.envelope.metadata.folderHierarchy).toBeDefined();
    }
    if (postmanSnapshot.expectedAiReadinessDefined) {
      expect(result.envelope.metadata.aiReadiness).toBeDefined();
    }
  });
});

describe('Legacy adapter — provenance fields', () => {
  it('sets normalizationSource: legacy, display fields undefined', () => {
    const envelope = collectionToWorkflow(LEGACY_COLLECTION);
    expect(envelope.metadata.normalizationSource).toBe('legacy');
    expect(envelope.metadata.metadataVersion).toBe(1);
    expect(envelope.metadata.folderHierarchy).toBeUndefined();
    expect(envelope.metadata.graphHints).toBeUndefined();
    expect(envelope.metadata.aiReadiness).toBeUndefined();
  });

  it('matches legacy snapshot contract', () => {
    const envelope = collectionToWorkflow(LEGACY_COLLECTION);
    expect(envelope.metadata.normalizationSource).toBe(legacySnapshot.expectedNormalizationSource);
    expect(envelope.metadata.metadataVersion).toBe(legacySnapshot.expectedMetadataVersion);
    if (!legacySnapshot.expectedFolderHierarchyDefined) {
      expect(envelope.metadata.folderHierarchy).toBeUndefined();
    }
    if (!legacySnapshot.expectedGraphHintsDefined) {
      expect(envelope.metadata.graphHints).toBeUndefined();
    }
  });
});

describe('Snapshot serialization', () => {
  it('WorkflowEnvelope survives JSON round-trip with all metadata intact', () => {
    const result = importFromPostman(POSTMAN_COLLECTION, POSTMAN_OPTS);
    const serialized = JSON.stringify(result.envelope);
    const deserialized = JSON.parse(serialized);
    expect(deserialized.metadata.normalizationSource).toBe('postman');
    expect(deserialized.metadata.metadataVersion).toBe(1);
    expect(deserialized.metadata.folderHierarchy).toBeDefined();
    expect(deserialized.metadata.aiReadiness).toBeDefined();
    expect(deserialized.metadata.metadataGeneratedAt).toBeDefined();
  });
});

describe('Execution ignorance', () => {
  it('validateCompatibility result is identical with and without metadata', () => {
    const result = importFromPostman(POSTMAN_COLLECTION, POSTMAN_OPTS);
    const stripped = stripExecutionMetadata(result.envelope);
    const reportFull = validateCompatibility(result);
    const reportStripped = validateCompatibility({ ...result, envelope: stripped });
    expect(reportFull.compatible).toBe(reportStripped.compatible);
    expect(reportFull.issues.length).toBe(reportStripped.issues.length);
    expect(reportFull.workflowEngineCompatible).toBe(reportStripped.workflowEngineCompatible);
  });
});

describe('Partial metadata tolerance', () => {
  it('envelope with only graphHints (no folderHierarchy, no aiReadiness) validates successfully', () => {
    const result = importFromOpenApi(OPENAPI_SPEC, OPENAPI_OPTS);
    delete result.envelope.metadata.folderHierarchy;
    delete result.envelope.metadata.aiReadiness;
    result.envelope.metadata.graphHints = {
      detectedEntities: ['item'],
      operationEntityMap: {},
      suggestedGroups: ['item'],
      edgeCount: 0,
      isHeuristic: true,
    };
    const report = validateCompatibility(result);
    expect(report.compatible).toBe(true);
  });
});

describe('Unknown metadata tolerance', () => {
  it('envelope with extra unknown metadata fields passes validateCompatibility', () => {
    const envelope = collectionToWorkflow(LEGACY_COLLECTION);
    (envelope.metadata as any).futureField = 'some-future-value';
    (envelope.metadata as any).experimentalHints = { x: 1 };
    const fakeResult: ImportResult = {
      collection: LEGACY_COLLECTION,
      envelope,
      authMetadata: { schemes: [], hasOperationLevelOverride: false, globalSchemeNames: [] },
      dependencyHints: { hints: [], detectedEntities: [], operationEntityMap: {} },
      warnings: [],
      format: 'unknown',
      endpointCount: 0,
      skippedCount: 0,
      sourceMetadata: { type: 'curl' },
    };
    const report = validateCompatibility(fakeResult);
    expect(report.compatible).toBe(true);
  });
});

describe('Deep hierarchy stress', () => {
  it('6-level folder nesting produces correct FolderNode depth and FOLDER_DEPTH_EXCEEDED warning', () => {
    const deep = JSON.stringify({
      info: {
        name: 'Deep Collection',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [{
        name: 'L1', item: [{
          name: 'L2', item: [{
            name: 'L3', item: [{
              name: 'L4', item: [{
                name: 'L5', item: [{
                  name: 'L6',
                  item: [{
                    name: 'Deep Request',
                    request: {
                      method: 'GET',
                      url: { raw: 'https://api.test.com/deep' },
                      header: [],
                    },
                  }],
                }],
              }],
            }],
          }],
        }],
      }],
    });

    const result = importFromPostman(deep, POSTMAN_OPTS);
    const deepNode = result.envelope.workflow.nodes?.find(n =>
      n.step.name.includes('Deep Request')
    );
    expect(deepNode).toBeDefined();
    expect(deepNode!.hierarchyPath).toBeDefined();
    expect(deepNode!.hierarchyPath!.length).toBeGreaterThanOrEqual(2);

    const depthWarning = result.warnings.find(w => w.code === 'FOLDER_DEPTH_EXCEEDED');
    expect(depthWarning).toBeDefined();
  });
});
