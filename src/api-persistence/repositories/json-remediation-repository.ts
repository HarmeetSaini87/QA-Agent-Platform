// src/api-persistence/repositories/json-remediation-repository.ts
// Phase E Step 2: JSON-backed IRemediationRepository.
// Wraps api-remediation proposal-store + approval-store — no behavior change.

import type { RemediationProposal } from '../../api-remediation/contracts/remediation-proposal.contracts';
import type { ApprovalRequest } from '../../api-remediation/contracts/approval-workflow.contracts';
import {
  findProposalById,
  listProposalsByCollection,
  upsertProposal,
} from '../../api-remediation/proposal-store';
import {
  findApprovalByProposalId,
  loadApprovalsRegistry,
  upsertApproval,
} from '../../api-remediation/approval-store';
import type { IRemediationRepository, RemediationQueryOptions } from '../contracts/remediation-repository.contracts';

export class JsonRemediationRepository implements IRemediationRepository {
  findProposalById(id: string): RemediationProposal | null {
    return findProposalById(id);
  }

  listProposals(options?: RemediationQueryOptions): RemediationProposal[] {
    if (options?.collectionId) {
      let proposals = listProposalsByCollection(options.collectionId);
      if (options.status) proposals = proposals.filter(p => p.status === options.status);
      return proposals;
    }
    // All collections — read from proposal store directly
    const { loadAll } = _lazyLoadAll();
    let all = loadAll();
    if (options?.status) all = all.filter(p => p.status === options.status);
    return all;
  }

  saveProposal(proposal: RemediationProposal): void {
    upsertProposal(proposal);
  }

  findApprovalByProposalId(proposalId: string): ApprovalRequest | null {
    return findApprovalByProposalId(proposalId);
  }

  listApprovals(): ApprovalRequest[] {
    return loadApprovalsRegistry().approvals;
  }

  saveApproval(approval: ApprovalRequest): void {
    upsertApproval(approval);
  }
}

// Internal helper — reads all proposals across all collections by loading the full registry.
function _lazyLoadAll() {
  return {
    loadAll: (): RemediationProposal[] => {
      // proposal-store exposes no listAll — reach into the file directly via the store pattern
      // to avoid coupling. This is safe because the file format is stable.
      try {
        const fs = require('fs') as typeof import('fs');
        const path = require('path') as typeof import('path');
        const p = path.join(path.resolve(process.env.DATA_DIR || 'data'), 'remediation-proposals.json');
        if (!fs.existsSync(p)) return [];
        const reg = JSON.parse(fs.readFileSync(p, 'utf8')) as { proposals: RemediationProposal[] };
        return reg.proposals ?? [];
      } catch { return []; }
    },
  };
}
