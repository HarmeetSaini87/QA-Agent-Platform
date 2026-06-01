// src/api-remediation/__tests__/proposal-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { upsertProposal, findProposalById, listProposalsByCollection } from '../proposal-store';
import type { RemediationProposal } from '../contracts/remediation-proposal.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeProposal(overrides: Partial<RemediationProposal> = {}): RemediationProposal {
  return {
    id: 'prop-1',
    collectionId: 'col-1',
    type: 'retry-tuning',
    title: 'Reduce retries',
    rationale: 'Over-retrying',
    confidence: 85,
    diff: [],
    evidenceRefs: [],
    sourceRecommendationId: 'rec-1',
    basis: 'deterministic',
    status: 'pending-approval',
    createdAt: '2026-05-22T00:00:00Z',
    advisoryNote: 'advisory',
    ...overrides,
  };
}

describe('proposal-store', () => {
  it('returns null for findProposalById when file absent', () => {
    expect(findProposalById('prop-1')).toBeNull();
  });

  it('upsertProposal persists and retrieves by id', () => {
    upsertProposal(makeProposal());
    expect(findProposalById('prop-1')).not.toBeNull();
    expect(findProposalById('prop-1')!.type).toBe('retry-tuning');
  });

  it('upsertProposal updates existing record with same id', () => {
    upsertProposal(makeProposal());
    upsertProposal(makeProposal({ status: 'approved' }));
    expect(findProposalById('prop-1')!.status).toBe('approved');
  });

  it('listProposalsByCollection filters by collectionId', () => {
    upsertProposal(makeProposal({ id: 'p1', collectionId: 'col-1' }));
    upsertProposal(makeProposal({ id: 'p2', collectionId: 'col-2' }));
    const result = listProposalsByCollection('col-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('p1');
  });
});
