// src/api-performance/optimization/overlay-differ.ts
// Phase E Step 1: Incremental overlay diff preparation for node-level batching.
// Pure function — no mutation of overlays. Prepares incremental rendering pipeline.

import type {
  AiGraphOverlayBundle,
  AiGraphAnnotation,
  AiOverlayBadge,
} from '../../api-intelligence/contracts/graph-overlay-ai.contracts';

export interface OverlayNodeDiff {
  readonly nodeId: string;
  readonly addedBadges: readonly AiOverlayBadge[];
  readonly removedBadges: readonly AiOverlayBadge[];
  readonly unchangedBadgeCount: number;
}

export interface OverlayDiff {
  readonly collectionId: string;
  readonly diffedAt: string;
  readonly nodesAdded: readonly string[];
  readonly nodesRemoved: readonly string[];
  readonly nodesChanged: readonly OverlayNodeDiff[];
  readonly totalChangedNodes: number;
  readonly isNoop: boolean;
}

export function diffOverlays(
  prev: AiGraphOverlayBundle | null,
  next: AiGraphOverlayBundle
): OverlayDiff {
  const prevAnnotations = prev?.annotations ?? [];
  const nextAnnotations = next.annotations;

  const prevByNode = new Map<string, AiGraphAnnotation>(
    prevAnnotations.map(a => [a.nodeId, a])
  );
  const nextByNode = new Map<string, AiGraphAnnotation>(
    nextAnnotations.map(a => [a.nodeId, a])
  );

  const nodesAdded: string[] = [];
  const nodesRemoved: string[] = [];
  const nodesChanged: OverlayNodeDiff[] = [];

  for (const nodeId of nextByNode.keys()) {
    if (!prevByNode.has(nodeId)) { nodesAdded.push(nodeId); continue; }

    const prevBadges = prevByNode.get(nodeId)!.badges;
    const nextBadges = nextByNode.get(nodeId)!.badges;
    const nodeDiff = _diffBadges(nodeId, prevBadges, nextBadges);
    if (nodeDiff.addedBadges.length > 0 || nodeDiff.removedBadges.length > 0) {
      nodesChanged.push(nodeDiff);
    }
  }

  for (const nodeId of prevByNode.keys()) {
    if (!nextByNode.has(nodeId)) nodesRemoved.push(nodeId);
  }

  const totalChangedNodes = nodesAdded.length + nodesRemoved.length + nodesChanged.length;

  return {
    collectionId: next.collectionId,
    diffedAt: new Date().toISOString(),
    nodesAdded,
    nodesRemoved,
    nodesChanged,
    totalChangedNodes,
    isNoop: totalChangedNodes === 0,
  };
}

function _diffBadges(
  nodeId: string,
  prevBadges: readonly AiOverlayBadge[],
  nextBadges: readonly AiOverlayBadge[]
): OverlayNodeDiff {
  const prevTypes = new Set(prevBadges.map(b => b.type));
  const nextTypes = new Set(nextBadges.map(b => b.type));

  const addedBadges = nextBadges.filter(b => !prevTypes.has(b.type));
  const removedBadges = prevBadges.filter(b => !nextTypes.has(b.type));
  const unchangedBadgeCount = nextBadges.filter(b => prevTypes.has(b.type)).length;

  return { nodeId, addedBadges, removedBadges, unchangedBadgeCount };
}
