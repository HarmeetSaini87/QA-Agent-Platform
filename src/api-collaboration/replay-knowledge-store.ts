// src/api-collaboration/replay-knowledge-store.ts
// Phase E Step 9: Replay annotations and RCA knowledge sharing. Never mutates replay data.

import type {
  IReplayKnowledgeStore,
  ReplayAnnotation,
  RcaKnowledgeEntry,
  KnowledgeEntryType,
} from './contracts/replay-knowledge.contracts';

export class ReplayKnowledgeStore implements IReplayKnowledgeStore {
  private readonly _annotations = new Map<string, ReplayAnnotation[]>();  // runId → annotations
  private readonly _entries = new Map<string, RcaKnowledgeEntry>();
  private readonly _entriesByCollection = new Map<string, string[]>();

  addAnnotation(annotation: ReplayAnnotation): void {
    const list = this._annotations.get(annotation.runId) ?? [];
    list.push(annotation);
    this._annotations.set(annotation.runId, list);
  }

  listAnnotations(runId: string): ReplayAnnotation[] {
    return (this._annotations.get(runId) ?? [])
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  addKnowledgeEntry(entry: RcaKnowledgeEntry): void {
    this._entries.set(entry.entryId, entry);
    const list = this._entriesByCollection.get(entry.collectionId) ?? [];
    if (!list.includes(entry.entryId)) list.push(entry.entryId);
    this._entriesByCollection.set(entry.collectionId, list);
  }

  getKnowledgeEntry(entryId: string): RcaKnowledgeEntry | null {
    return this._entries.get(entryId) ?? null;
  }

  listKnowledgeEntries(
    collectionId: string,
    filter?: { entryType?: KnowledgeEntryType },
  ): RcaKnowledgeEntry[] {
    const ids = this._entriesByCollection.get(collectionId) ?? [];
    let results = ids.map(id => this._entries.get(id)!).filter(Boolean);
    if (filter?.entryType) results = results.filter(e => e.entryType === filter.entryType);
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const globalReplayKnowledgeStore = new ReplayKnowledgeStore();
