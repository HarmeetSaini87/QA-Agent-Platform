// src/api-collaboration/contracts/organization-template.contracts.ts
// Phase E Step 9: Reusable workflow templates. Templates are governed artifacts, not runtime mutations.

export type TemplateCategory =
  | 'api-workflow'
  | 'suite-orchestration'
  | 'replay-investigation'
  | 'governance-policy'
  | 'analytics-dashboard';

export type TemplateVisibility = 'private' | 'team' | 'organization';

export interface WorkflowTemplate {
  readonly templateId: string;
  readonly name: string;
  readonly category: TemplateCategory;
  readonly version: string;
  readonly authorId: string;
  readonly tenantId?: string;
  readonly visibility: TemplateVisibility;
  readonly description: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly publishedAt?: string;
  /** Advisory-only scaffold — not authoritative for execution. */
  readonly stepScaffold: Array<{ stepName: string; dependsOn: string[]; isTeardown?: boolean }>;
  readonly requiredRoles: readonly string[];
}

export interface TemplateInstantiationResult {
  readonly templateId: string;
  readonly collectionId: string;
  readonly instantiatedAt: string;
  readonly advisoryNote: string;
}

export interface IOrganizationTemplateRegistry {
  register(template: WorkflowTemplate): void;
  get(templateId: string): WorkflowTemplate | null;
  list(filter?: { category?: TemplateCategory; tenantId?: string; visibility?: TemplateVisibility }): WorkflowTemplate[];
  /** Returns a scaffold description for the user to instantiate — never creates collections directly. */
  instantiate(templateId: string, collectionId: string, actorId: string): TemplateInstantiationResult | null;
  unregister(templateId: string): boolean;
}
