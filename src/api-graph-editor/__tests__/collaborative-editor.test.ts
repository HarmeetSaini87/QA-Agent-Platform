// src/api-graph-editor/__tests__/collaborative-editor.test.ts
import { describe, it, expect } from 'vitest';
import { NoOpCollaborativeGraphEditor, NoOpWorkflowTemplateRegistry } from '../contracts/collaborative-editor.contracts';

describe('NoOpCollaborativeGraphEditor', () => {
  const editor = new NoOpCollaborativeGraphEditor();

  it('startSession: returns a session with participants', () => {
    const session = editor.startSession('col-1', ['user-1', 'user-2']);
    expect(session.collectionId).toBe('col-1');
    expect(session.participants).toContain('user-1');
    expect(session.sessionId).toBe('noop');
  });

  it('broadcastEdit: no-op, does not throw', () => {
    expect(() => editor.broadcastEdit('s1', 'e1')).not.toThrow();
  });

  it('endSession: no-op, does not throw', () => {
    expect(() => editor.endSession('s1')).not.toThrow();
  });
});

describe('NoOpWorkflowTemplateRegistry', () => {
  const registry = new NoOpWorkflowTemplateRegistry();

  it('listTemplates: returns empty array', () => {
    expect(registry.listTemplates()).toEqual([]);
  });

  it('instantiate: returns empty object', () => {
    expect(registry.instantiate('tmpl-1', 'col-1')).toEqual({});
  });
});
