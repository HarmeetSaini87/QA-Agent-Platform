// src/api-collaboration/graph-collaboration-overlay-builder.ts
// Phase E Step 9: Graph collaboration overlays — review annotations, ownership. Graph read-only.

import type {
  IGraphCollaborationOverlayBuilder,
  GraphCollaborationOverlay,
  CollaborationMarker,
} from './contracts/graph-collaboration-overlay.contracts';

export class GraphCollaborationOverlayBuilder implements IGraphCollaborationOverlayBuilder {
  build(
    collectionId: string,
    input: {
      comments: Array<{ targetId: string; authorId: string; body: string; createdAt: string }>;
      ownershipClaims: Array<{ nodeId: string; ownerId: string; teamId?: string }>;
      knowledgeLinks: Array<{ nodeId: string; entryId: string; authorId: string }>;
    },
  ): GraphCollaborationOverlay {
    const generatedAt = new Date().toISOString();
    const markers: CollaborationMarker[] = [];

    for (const comment of input.comments) {
      markers.push({
        nodeId: comment.targetId,
        markerType: 'review-comment',
        authorId: comment.authorId,
        label: `Comment by ${comment.authorId}`,
        body: comment.body,
        createdAt: comment.createdAt,
      });
    }

    for (const ownership of input.ownershipClaims) {
      markers.push({
        nodeId: ownership.nodeId,
        markerType: 'ownership',
        authorId: ownership.ownerId,
        teamId: ownership.teamId,
        label: `Owner: ${ownership.ownerId}`,
        createdAt: generatedAt,
      });
    }

    for (const link of input.knowledgeLinks) {
      markers.push({
        nodeId: link.nodeId,
        markerType: 'knowledge-link',
        authorId: link.authorId,
        label: `Knowledge: ${link.entryId.slice(0, 8)}`,
        createdAt: generatedAt,
      });
    }

    const ownershipMap: Record<string, string> = {};
    for (const claim of input.ownershipClaims) {
      ownershipMap[claim.nodeId] = claim.ownerId;
    }

    return {
      collectionId,
      generatedAt,
      markers,
      ownershipMap,
      totalComments: input.comments.length,
      totalOwnershipClaims: input.ownershipClaims.length,
    };
  }
}

export const globalGraphCollaborationOverlayBuilder = new GraphCollaborationOverlayBuilder();
