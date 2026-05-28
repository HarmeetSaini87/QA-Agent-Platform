// src/api-collaboration/organization-template-registry.ts
// Phase E Step 9: Governed template registry. Templates are advisory scaffolds — not runtime mutations.

import type {
  IOrganizationTemplateRegistry,
  WorkflowTemplate,
  TemplateCategory,
  TemplateVisibility,
  TemplateInstantiationResult,
} from './contracts/organization-template.contracts';

const ADVISORY = 'Template instantiation is advisory only. Caller must create the actual collection via the API.';

export class OrganizationTemplateRegistry implements IOrganizationTemplateRegistry {
  private readonly _templates = new Map<string, WorkflowTemplate>();

  register(template: WorkflowTemplate): void {
    this._templates.set(template.templateId, template);
  }

  get(templateId: string): WorkflowTemplate | null {
    return this._templates.get(templateId) ?? null;
  }

  list(filter?: { category?: TemplateCategory; tenantId?: string; visibility?: TemplateVisibility }): WorkflowTemplate[] {
    let results = Array.from(this._templates.values());
    if (filter?.category) results = results.filter(t => t.category === filter.category);
    if (filter?.tenantId) results = results.filter(t => !t.tenantId || t.tenantId === filter.tenantId);
    if (filter?.visibility) results = results.filter(t => t.visibility === filter.visibility);
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }

  instantiate(templateId: string, collectionId: string, actorId: string): TemplateInstantiationResult | null {
    const template = this._templates.get(templateId);
    if (!template) return null;
    return {
      templateId,
      collectionId,
      instantiatedAt: new Date().toISOString(),
      advisoryNote: `${ADVISORY} Template "${template.name}" (v${template.version}) scaffold provided for collection "${collectionId}" by actor "${actorId}".`,
    };
  }

  unregister(templateId: string): boolean {
    return this._templates.delete(templateId);
  }
}

export const globalOrganizationTemplateRegistry = new OrganizationTemplateRegistry();

// Built-in templates
globalOrganizationTemplateRegistry.register({
  templateId: 'builtin-rest-crud',
  name: 'REST CRUD Workflow',
  category: 'api-workflow',
  version: '1.0.0',
  authorId: 'system',
  visibility: 'organization',
  description: 'Standard CRUD API test workflow: create → read → update → delete with teardown.',
  tags: ['rest', 'crud', 'standard'],
  createdAt: new Date().toISOString(),
  stepScaffold: [
    { stepName: 'Create Resource', dependsOn: [] },
    { stepName: 'Read Resource', dependsOn: ['Create Resource'] },
    { stepName: 'Update Resource', dependsOn: ['Read Resource'] },
    { stepName: 'Delete Resource', dependsOn: ['Update Resource'], isTeardown: true },
  ],
  requiredRoles: ['admin', 'editor', 'tester'],
});
