// src/api-collaboration/contracts/graph-collaboration-overlay.contracts.ts
// Phase E Step 9: Graph collaboration markers — review annotations, ownership, team visibility.
// Graph remains read-only. Markers are additive badge annotations only.

export type CollaborationMarkerType =
  | 'review-comment'
  | 'ownership'
  | 'investigation'
  | 'remediation-ref'
  | 'knowledge-link';

export interface CollaborationMarker {
  readonly nodeId: string;
  readonly markerType: CollaborationMarkerType;
  readonly authorId: string;
  readonly teamId?: string;
  readonly label: string;
  readonly body?: string;
  readonly createdAt: string;
  readonly tenantId?: string;
}

export interface GraphCollaborationOverlay {
  readonly collectionId: string;
  readonly generatedAt: string;
  readonly markers: readonly CollaborationMarker[];
  readonly ownershipMap: Record<string, string>;   // nodeId → ownerId
  readonly totalComments: number;
  readonly totalOwnershipClaims: number;
}

export interface IGraphCollaborationOverlayBuilder {
  build(collectionId: string, input: {
    comments: Array<{ targetId: string; authorId: string; body: string; createdAt: string }>;
    ownershipClaims: Array<{ nodeId: string; ownerId: string; teamId?: string }>;
    knowledgeLinks: Array<{ nodeId: string; entryId: string; authorId: string }>;
  }): GraphCollaborationOverlay;
}
