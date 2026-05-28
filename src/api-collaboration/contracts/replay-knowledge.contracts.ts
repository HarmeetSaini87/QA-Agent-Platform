// src/api-collaboration/contracts/replay-knowledge.contracts.ts
// Phase E Step 9: Shared replay annotations and RCA knowledge. Never alters replay determinism.

export type KnowledgeEntryType =
  | 'rca-finding'
  | 'flakiness-note'
  | 'dependency-issue'
  | 'remediation-ref'
  | 'investigation-note';

export interface ReplayAnnotation {
  readonly annotationId: string;
  readonly runId: string;
  readonly collectionId: string;
  readonly authorId: string;
  readonly stepId?: string;
  readonly eventSeq?: number;
  readonly body: string;
  readonly createdAt: string;
  readonly tenantId?: string;
}

export interface RcaKnowledgeEntry {
  readonly entryId: string;
  readonly collectionId: string;
  readonly entryType: KnowledgeEntryType;
  readonly title: string;
  readonly body: string;
  readonly linkedRunIds: readonly string[];
  readonly linkedStepIds: readonly string[];
  readonly authorId: string;
  readonly createdAt: string;
  readonly tenantId?: string;
}

export interface IReplayKnowledgeStore {
  addAnnotation(annotation: ReplayAnnotation): void;
  listAnnotations(runId: string): ReplayAnnotation[];
  addKnowledgeEntry(entry: RcaKnowledgeEntry): void;
  getKnowledgeEntry(entryId: string): RcaKnowledgeEntry | null;
  listKnowledgeEntries(collectionId: string, filter?: { entryType?: KnowledgeEntryType }): RcaKnowledgeEntry[];
}
