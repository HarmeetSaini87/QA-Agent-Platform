// src/api-collaboration/__tests__/graph-collaboration-overlay-builder.test.ts
import { describe, it, expect } from 'vitest';
import { GraphCollaborationOverlayBuilder } from '../graph-collaboration-overlay-builder';

describe('GraphCollaborationOverlayBuilder', () => {
  const builder = new GraphCollaborationOverlayBuilder();

  it('empty input: overlay with no markers', () => {
    const overlay = builder.build('col-1', { comments: [], ownershipClaims: [], knowledgeLinks: [] });
    expect(overlay.markers).toHaveLength(0);
    expect(overlay.totalComments).toBe(0);
    expect(overlay.totalOwnershipClaims).toBe(0);
  });

  it('review comment: produces review-comment marker', () => {
    const overlay = builder.build('col-1', {
      comments: [{ targetId: 's1', authorId: 'alice', body: 'Fix this', createdAt: new Date().toISOString() }],
      ownershipClaims: [], knowledgeLinks: [],
    });
    const marker = overlay.markers.find(m => m.nodeId === 's1');
    expect(marker?.markerType).toBe('review-comment');
    expect(marker?.authorId).toBe('alice');
  });

  it('ownership claim: populates ownershipMap', () => {
    const overlay = builder.build('col-1', {
      comments: [],
      ownershipClaims: [{ nodeId: 's1', ownerId: 'team-a', teamId: 'team-a' }],
      knowledgeLinks: [],
    });
    expect(overlay.ownershipMap['s1']).toBe('team-a');
    expect(overlay.markers.some(m => m.markerType === 'ownership')).toBe(true);
  });

  it('knowledge link: produces knowledge-link marker', () => {
    const overlay = builder.build('col-1', {
      comments: [],
      ownershipClaims: [],
      knowledgeLinks: [{ nodeId: 's2', entryId: 'entry-abc123', authorId: 'bob' }],
    });
    const marker = overlay.markers.find(m => m.nodeId === 's2');
    expect(marker?.markerType).toBe('knowledge-link');
    expect(marker?.label).toContain('entry-ab');
  });

  it('totalComments and totalOwnershipClaims counted correctly', () => {
    const overlay = builder.build('col-1', {
      comments: [
        { targetId: 's1', authorId: 'a', body: 'x', createdAt: new Date().toISOString() },
        { targetId: 's2', authorId: 'b', body: 'y', createdAt: new Date().toISOString() },
      ],
      ownershipClaims: [{ nodeId: 's1', ownerId: 'alice' }],
      knowledgeLinks: [],
    });
    expect(overlay.totalComments).toBe(2);
    expect(overlay.totalOwnershipClaims).toBe(1);
  });
});
