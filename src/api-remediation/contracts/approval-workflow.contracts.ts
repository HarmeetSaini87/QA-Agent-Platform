export type ApprovalDecision = 'approved' | 'rejected';

export interface ApprovalRequest {
  id: string;
  proposalId: string;
  collectionId: string;
  /** userId of whoever generated the proposals */
  requestedBy: string;
  requestedAt: string;
  status: 'pending' | 'decided';
  decision?: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: string;
  /** Optional reviewer comment — required on rejection via UI prompt */
  reviewComment?: string;
  /** True when the proposal was in pending-approval state at decision time */
  rollbackEligible: boolean;
  tenantId?: string;
}

export interface ApprovalsRegistry {
  _schemaVersion: 1;
  approvals: ApprovalRequest[];
}
