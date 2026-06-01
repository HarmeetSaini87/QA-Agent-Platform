import { describe, it, expect } from 'vitest';
import { adaptPostmanImport } from '../import-engine-adapter';
import { collectionToWorkflow } from '../../../workflow-dsl/legacy-adapter';

const multiStepPM = JSON.stringify({
  info: { name: 'WorkflowTest', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: 'Step 1',
      request: { method: 'POST', url: { raw: 'https://api.example.com/items', host: ['api','example','com'], path: ['items'] }, body: { mode: 'raw', raw: '{"name":"test"}' } }
    },
    {
      name: 'Step 2',
      request: { method: 'GET', url: { raw: 'https://api.example.com/items/{{itemId}}', host: ['api','example','com'], path: ['items','{{itemId}}'] } }
    }
  ]
});

describe('WorkflowEnvelope compatibility', () => {
  it('adapted postman collection converts to WorkflowEnvelope without error', () => {
    const { collection } = adaptPostmanImport(multiStepPM, 'env-1');
    expect(() => collectionToWorkflow(collection)).not.toThrow();
  });

  it('WorkflowEnvelope has nodes for each step', () => {
    const { collection } = adaptPostmanImport(multiStepPM, 'env-1');
    const envelope = collectionToWorkflow(collection);
    expect(envelope.workflow.legacyNodes.length).toBe(collection.steps.length);
  });

  it('WorkflowEnvelope preserves step IDs', () => {
    const { collection } = adaptPostmanImport(multiStepPM, 'env-1');
    const envelope = collectionToWorkflow(collection);
    const envelopeIds = new Set(envelope.workflow.legacyNodes.map(n => n.id));
    for (const step of collection.steps) {
      expect(envelopeIds.has(step.id)).toBe(true);
    }
  });

  it('lazy variable reference preserved in step URL', () => {
    const { collection } = adaptPostmanImport(multiStepPM, 'env-1');
    const step2 = collection.steps.find(s => s.name === 'Step 2');
    expect(step2?.request.url).toContain('{{itemId}}');
  });
});
