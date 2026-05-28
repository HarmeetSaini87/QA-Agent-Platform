// src/api-collaboration/workflow-version-store.ts
// Phase E Step 9: In-memory workflow version store with diff and rollback.

import { randomUUID } from 'crypto';
import type {
  IWorkflowVersionStore,
  WorkflowRevision,
  WorkflowRevisionDiff,
  WorkflowRevisionStatus,
} from './contracts/workflow-version.contracts';

export class WorkflowVersionStore implements IWorkflowVersionStore {
  private readonly _revisions = new Map<string, WorkflowRevision>();
  // collectionId → ordered revisionIds
  private readonly _byCollection = new Map<string, string[]>();

  saveRevision(revision: WorkflowRevision): void {
    this._revisions.set(revision.revisionId, revision);
    const list = this._byCollection.get(revision.collectionId) ?? [];
    if (!list.includes(revision.revisionId)) list.push(revision.revisionId);
    this._byCollection.set(revision.collectionId, list);
  }

  getRevision(revisionId: string): WorkflowRevision | null {
    return this._revisions.get(revisionId) ?? null;
  }

  listRevisions(collectionId: string): WorkflowRevision[] {
    const ids = this._byCollection.get(collectionId) ?? [];
    return ids.map(id => this._revisions.get(id)!).filter(Boolean)
      .sort((a, b) => b.revisionNumber - a.revisionNumber);
  }

  getLatestPublished(collectionId: string): WorkflowRevision | null {
    return this.listRevisions(collectionId).find(r => r.status === 'published') ?? null;
  }

  diff(fromRevisionId: string, toRevisionId: string): WorkflowRevisionDiff | null {
    const from = this._revisions.get(fromRevisionId);
    const to = this._revisions.get(toRevisionId);
    if (!from || !to) return null;

    const fromStepIds = new Set(from.stepSnapshot.map(s => s.stepId));
    const toStepIds = new Set(to.stepSnapshot.map(s => s.stepId));

    const stepsAdded = [...toStepIds].filter(id => !fromStepIds.has(id));
    const stepsRemoved = [...fromStepIds].filter(id => !toStepIds.has(id));

    const fromDepsMap = Object.fromEntries(from.stepSnapshot.map(s => [s.stepId, s.dependsOn]));
    const toDepsMap = Object.fromEntries(to.stepSnapshot.map(s => [s.stepId, s.dependsOn]));

    const dependenciesChanged: WorkflowRevisionDiff['dependenciesChanged'] = [];
    for (const stepId of toStepIds) {
      const before = fromDepsMap[stepId] ?? [];
      const after = toDepsMap[stepId] ?? [];
      const changed = before.length !== after.length || before.some((d, i) => d !== after[i]);
      if (changed) dependenciesChanged.push({ stepId, before, after });
    }

    return { fromRevisionId, toRevisionId, stepsAdded, stepsRemoved, dependenciesChanged, diffGeneratedAt: new Date().toISOString() };
  }

  rollback(collectionId: string, toRevisionId: string, actorId: string): WorkflowRevision | null {
    const target = this._revisions.get(toRevisionId);
    if (!target || target.collectionId !== collectionId) return null;

    // Create a new revision as a rollback copy
    const rollbackRevision: WorkflowRevision = {
      revisionId: randomUUID(),
      collectionId,
      revisionNumber: this.listRevisions(collectionId).length + 1,
      status: 'published' as WorkflowRevisionStatus,
      authorId: actorId,
      createdAt: new Date().toISOString(),
      publishedAt: new Date().toISOString(),
      description: `Rollback to revision ${target.revisionNumber} (${toRevisionId.slice(0, 8)})`,
      stepSnapshot: target.stepSnapshot,
      linkedRunIds: [],
      tenantId: target.tenantId,
    };
    this.saveRevision(rollbackRevision);
    return rollbackRevision;
  }
}

export const globalWorkflowVersionStore = new WorkflowVersionStore();
