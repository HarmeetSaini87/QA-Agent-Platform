// src/api-collaboration/__tests__/organization-template-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { OrganizationTemplateRegistry } from '../organization-template-registry';
import type { WorkflowTemplate } from '../contracts/organization-template.contracts';

function makeTemplate(id: string, category: WorkflowTemplate['category'] = 'api-workflow', visibility: WorkflowTemplate['visibility'] = 'organization'): WorkflowTemplate {
  return {
    templateId: id, name: `Template ${id}`, category, version: '1.0.0',
    authorId: 'system', visibility, description: 'Test template',
    tags: ['test'], createdAt: new Date().toISOString(),
    stepScaffold: [{ stepName: 'Create', dependsOn: [] }, { stepName: 'Delete', dependsOn: ['Create'], isTeardown: true }],
    requiredRoles: ['admin'],
  };
}

describe('OrganizationTemplateRegistry', () => {
  let registry: OrganizationTemplateRegistry;
  beforeEach(() => { registry = new OrganizationTemplateRegistry(); });

  it('register + get roundtrip', () => {
    registry.register(makeTemplate('t1'));
    expect(registry.get('t1')?.name).toBe('Template t1');
  });

  it('get: returns null for unknown template', () => {
    expect(registry.get('ghost')).toBeNull();
  });

  it('list: filters by category', () => {
    registry.register(makeTemplate('t1', 'api-workflow'));
    registry.register(makeTemplate('t2', 'suite-orchestration'));
    expect(registry.list({ category: 'api-workflow' }).map(t => t.templateId)).toContain('t1');
    expect(registry.list({ category: 'api-workflow' }).map(t => t.templateId)).not.toContain('t2');
  });

  it('list: filters by visibility', () => {
    registry.register(makeTemplate('t1', 'api-workflow', 'private'));
    registry.register(makeTemplate('t2', 'api-workflow', 'organization'));
    expect(registry.list({ visibility: 'private' }).map(t => t.templateId)).toContain('t1');
  });

  it('instantiate: returns advisory result', () => {
    registry.register(makeTemplate('t1'));
    const result = registry.instantiate('t1', 'col-99', 'alice');
    expect(result?.templateId).toBe('t1');
    expect(result?.advisoryNote).toContain('advisory');
  });

  it('instantiate: null for unknown template', () => {
    expect(registry.instantiate('ghost', 'col-1', 'alice')).toBeNull();
  });

  it('unregister: removes template', () => {
    registry.register(makeTemplate('t1'));
    expect(registry.unregister('t1')).toBe(true);
    expect(registry.get('t1')).toBeNull();
  });
});
