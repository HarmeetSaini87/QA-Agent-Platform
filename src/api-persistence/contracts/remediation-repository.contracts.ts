// src/api-persistence/contracts/remediation-repository.contracts.ts
// Phase E Step 2: Repository interface for remediation proposals and approval records.

import type { RemediationProposal } from '../../api-remediation/contracts/remediation-proposal.contracts';
import type { ApprovalRequest } from '../../api-remediation/contracts/approval-workflow.contracts';

export interface RemediationQueryOptions {
  collectionId?: string;
  status?: RemediationProposal['status'];
}

export interface IRemediationRepository {
  // Proposals
  findProposalById(id: string): RemediationProposal | null;
  listProposals(options?: RemediationQueryOptions): RemediationProposal[];
  saveProposal(proposal: RemediationProposal): void;

  // Approvals
  findApprovalByProposalId(proposalId: string): ApprovalRequest | null;
  listApprovals(): ApprovalRequest[];
  saveApproval(approval: ApprovalRequest): void;
}
