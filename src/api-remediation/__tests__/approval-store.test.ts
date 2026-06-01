import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadApprovalsRegistry,
  upsertApproval,
  findApprovalByProposalId,
  listApprovalsByCollection,
} from '../approval-store';
import type { ApprovalRequest } from '../contracts/approval-workflow.contracts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-store-test-'));
  process.env.DATA_DIR = tmpDir;
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeApproval(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    id: 'appr-1',
    proposalId: 'prop-1',
    collectionId: 'col-1',
    requestedBy: 'user-1',
    requestedAt: '2026-05-22T00:00:00Z',
    status: 'pending',
    rollbackEligible: true,
    ...overrides,
  };
}

describe('approval-store', () => {
  it('loadApprovalsRegistry returns empty registry when file absent', () => {
    const reg = loadApprovalsRegistry();
    expect(reg._schemaVersion).toBe(1);
    expect(reg.approvals).toEqual([]);
  });

  it('upsertApproval persists and retrieves the record', () => {
    upsertApproval(makeApproval());
    const reg = loadApprovalsRegistry();
    expect(reg.approvals).toHaveLength(1);
    expect(reg.approvals[0].id).toBe('appr-1');
  });

  it('findApprovalByProposalId returns pending approval by proposalId', () => {
    upsertApproval(makeApproval());
    const result = findApprovalByProposalId('prop-1');
    expect(result).not.toBeNull();
    expect(result!.proposalId).toBe('prop-1');
  });

  it('listApprovalsByCollection filters by collectionId', () => {
    upsertApproval(makeApproval({ id: 'a1', collectionId: 'col-1' }));
    upsertApproval(makeApproval({ id: 'a2', collectionId: 'col-2', proposalId: 'prop-2' }));
    const result = listApprovalsByCollection('col-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });
});
