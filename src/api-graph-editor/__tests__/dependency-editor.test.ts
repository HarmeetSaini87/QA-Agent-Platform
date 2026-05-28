// src/api-graph-editor/__tests__/dependency-editor.test.ts
import { describe, it, expect } from 'vitest';
import { DependencyEditor } from '../dependency-editor';
import type { DependencyEdit } from '../contracts/dependency-edit.contracts';

function makeEdit(from: string, to: string, op: 'add' | 'remove'): DependencyEdit {
  return {
    collectionId: 'col-1',
    fromStepId: from,
    toStepId: to,
    operation: op,
    editedBy: 'tester',
    editedAt: new Date().toISOString(),
  };
}

describe('DependencyEditor', () => {
  const editor = new DependencyEditor();

  it('add: applies new dependency', () => {
    const result = editor.applyEdit({ b: [] }, makeEdit('b', 'a', 'add'));
    expect(result.outcome).toBe('applied');
    expect(result.updatedDependsOn).toContain('a');
  });

  it('add: rejects duplicate', () => {
    const result = editor.applyEdit({ b: ['a'] }, makeEdit('b', 'a', 'add'));
    expect(result.outcome).toBe('rejected-duplicate');
  });

  it('add: rejects self-loop', () => {
    const result = editor.applyEdit({}, makeEdit('a', 'a', 'add'));
    expect(result.outcome).toBe('rejected-self-loop');
  });

  it('add: rejects cycle', () => {
    // a depends on b, b depends on c. Adding c → a would create a cycle.
    const result = editor.applyEdit({ a: ['b'], b: ['c'] }, makeEdit('c', 'a', 'add'));
    expect(result.outcome).toBe('rejected-cycle');
  });

  it('remove: removes existing dependency', () => {
    const result = editor.applyEdit({ b: ['a', 'c'] }, makeEdit('b', 'a', 'remove'));
    expect(result.outcome).toBe('applied');
    expect(result.updatedDependsOn).not.toContain('a');
    expect(result.updatedDependsOn).toContain('c');
  });

  it('remove: rejects unknown dependency', () => {
    const result = editor.applyEdit({ b: ['c'] }, makeEdit('b', 'phantom', 'remove'));
    expect(result.outcome).toBe('rejected-not-found');
  });

  it('dryRun: applies valid edits and collects rejections', () => {
    const { adjacency, rejectedEdits } = editor.dryRun(
      { b: ['a'] },
      [makeEdit('c', 'b', 'add'), makeEdit('a', 'a', 'add')],
    );
    expect(adjacency['c']).toContain('b');
    expect(rejectedEdits).toHaveLength(1);
    expect(rejectedEdits[0].outcome).toBe('rejected-self-loop');
  });
});
