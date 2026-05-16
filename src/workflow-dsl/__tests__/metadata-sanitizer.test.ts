import { describe, it, expect } from 'vitest';
import { stripExecutionMetadata } from '../metadata-sanitizer';
import type { WorkflowEnvelope } from '../../shared-core/contracts/workflow.contract';

function makeEnvelope(overrides: Partial<WorkflowEnvelope> = {}): WorkflowEnvelope {
  return {
    schemaVersion: '1.0',
    workflow: {
      id: 'test-id',
      name: 'Test',
      legacyNodes: [],
      nodes: [
        {
          nodeType: 'HTTP',
          step: {
            id: 's1',
            name: 'Step 1',
            request: { method: 'GET', url: '/test', bodyType: 'none' },
            assertions: [],
            extractVariables: [],
            execution: {},
            dependsOn: [],
            order: 0,
          },
          position: { x: 10, y: 20, locked: true },
          visualGroup: 'Auth',
          hierarchyPath: ['Root', 'Auth', 'Step 1'],
        },
      ],
    },
    execution: { mode: 'sequential', onFailure: 'stop', logLevel: 'standard' },
    metadata: {
      createdAt: '2026-05-16T00:00:00Z',
      source: 'postman',
      collectionId: 'test-id',
      metadataVersion: 1,
      metadataGeneratedAt: '2026-05-16T00:00:00Z',
      normalizationSource: 'postman',
      folderHierarchy: { id: 'root', name: 'Root', children: [], stepIds: [], depth: 0 },
      graphHints: {
        detectedEntities: ['pet'],
        operationEntityMap: {},
        suggestedGroups: ['pet'],
        edgeCount: 1,
        isHeuristic: true,
      },
      aiReadiness: {
        normalizedStepCount: 1,
        hasVariableBindings: false,
        hasDependencyHints: false,
        hasFolderHierarchy: true,
        readinessScore: 40,
      },
    },
    ...overrides,
  };
}

describe('stripExecutionMetadata', () => {
  it('removes position, visualGroup, hierarchyPath from all nodes', () => {
    const result = stripExecutionMetadata(makeEnvelope());
    const node = result.workflow.nodes![0];
    expect(node.position).toBeUndefined();
    expect(node.visualGroup).toBeUndefined();
    expect(node.hierarchyPath).toBeUndefined();
  });

  it('preserves metadataVersion and normalizationSource', () => {
    const result = stripExecutionMetadata(makeEnvelope());
    expect(result.metadata.metadataVersion).toBe(1);
    expect(result.metadata.normalizationSource).toBe('postman');
  });

  it('is immutable — original envelope unchanged', () => {
    const original = makeEnvelope();
    stripExecutionMetadata(original);
    expect(original.workflow.nodes![0].position).toEqual({ x: 10, y: 20, locked: true });
    expect(original.metadata.folderHierarchy).toBeDefined();
  });

  it('handles empty nodes array safely', () => {
    const env = makeEnvelope();
    env.workflow.nodes = [];
    const result = stripExecutionMetadata(env);
    expect(result.workflow.nodes).toEqual([]);
  });

  it('handles envelope with undefined metadata fields safely', () => {
    const env = makeEnvelope();
    delete (env.metadata as any).folderHierarchy;
    delete (env.metadata as any).graphHints;
    delete (env.metadata as any).aiReadiness;
    env.workflow.nodes = [];
    expect(() => stripExecutionMetadata(env)).not.toThrow();
  });
});
