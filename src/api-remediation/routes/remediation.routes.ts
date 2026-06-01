// src/api-remediation/routes/remediation.routes.ts

import { Router, Request, Response, Express } from 'express';
import { requireAuth } from '../../auth/middleware';
import { requirePermission } from '../../api-governance/rbac.middleware';
import { logApiAudit } from '../../api-governance/audit.helper';
import { getTenantContext } from '../../api-governance/tenant.helper';
import { readAll, API_COLLECTIONS } from '../../data/store';
import type { ApiCollection } from '../../data/types';
import { buildRecommendationBundle } from '../../api-intelligence/recommendation-service';
import { buildRemediationProposals } from '../engines/proposal-engine';
import {
  upsertProposal,
  findProposalById,
  listProposalsByCollection,
} from '../proposal-store';
import {
  loadApprovalsRegistry,
  upsertApproval,
  listApprovalsByCollection,
} from '../approval-store';
import type { ApprovalRequest } from '../contracts/approval-workflow.contracts';
import { loadRunsForCollection, getReport } from '../../api-flakiness/flakiness-service';
import { globalRemediationPolicyRegistry } from '../remediation-policy-registry';

const router = Router();
const ADVISORY = 'Remediation proposals are advisory and approval-gated. AI must not apply proposals automatically. Human approval required before any remediation action.';

function genApprovalId(): string {
  return `appr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// POST /api/remediation/collections/:collectionId/proposals
// Generates proposals from latest recommendations and persists them.
router.post(
  '/collections/:collectionId/proposals',
  requireAuth,
  requirePermission('api:propose-remediation'),
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.params;
      const collection = readAll<ApiCollection>(API_COLLECTIONS).find(c => c.id === collectionId);
      if (!collection) return res.status(404).json({ error: 'Collection not found' });

      const recentRuns = loadRunsForCollection(collectionId).slice(0, 20);
      let flakinessReport = null;
      try { flakinessReport = getReport(collectionId); } catch { /* degrade */ }

      const role = (req.session as any)?.role ?? 'viewer';
      const policyCheck = globalRemediationPolicyRegistry.checkPropose(role, 100);
      if (!policyCheck.canPropose) {
        return res.status(403).json({ error: policyCheck.reason ?? 'Proposal generation blocked by policy' });
      }

      const recBundle = buildRecommendationBundle({ collection, recentRuns, flakinessReport });
      const bundle = buildRemediationProposals(
        recBundle.recommendations,
        collection.steps,
        collectionId,
        req.query.runId as string | undefined,
      );

      const requestedBy = req.session?.userId ?? 'unknown';
      for (const proposal of bundle.proposals) {
        upsertProposal({ ...proposal, requestedBy });
      }

      logApiAudit('api:remediation:proposed', collectionId, req, {
        details: `${bundle.proposals.length} proposals generated`,
        tenantId: getTenantContext(req)?.tenantId,
      });
      res.json({ ...bundle, proposals: bundle.proposals.map(p => ({ ...p, requestedBy })) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/remediation/collections/:collectionId/proposals
router.get(
  '/collections/:collectionId/proposals',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.params;
      const proposals = listProposalsByCollection(collectionId);
      res.json({ collectionId, proposals, advisoryNote: ADVISORY });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /api/remediation/proposals/:proposalId/approve
router.post(
  '/proposals/:proposalId/approve',
  requireAuth,
  requirePermission('api:approve-remediation'),
  async (req: Request, res: Response) => {
    try {
      const { proposalId } = req.params;
      const proposal = findProposalById(proposalId);
      if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
      if (proposal.status !== 'pending-approval') {
        return res.status(409).json({ error: `Proposal is already '${proposal.status}'` });
      }

      const updated = { ...proposal, status: 'approved' as const };
      upsertProposal(updated);

      const record: ApprovalRequest = {
        id: genApprovalId(),
        proposalId,
        collectionId: proposal.collectionId,
        requestedBy: proposal.requestedBy ?? 'unknown',
        requestedAt: proposal.createdAt,
        status: 'decided',
        decision: 'approved',
        decidedBy: req.session?.userId ?? 'unknown',
        decidedAt: new Date().toISOString(),
        reviewComment: req.body?.reviewComment,
        rollbackEligible: true,
        tenantId: proposal.tenantId,
      };
      upsertApproval(record);

      logApiAudit('api:remediation:approved', proposal.collectionId, req, {
        details: `proposal ${proposalId}`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// POST /api/remediation/proposals/:proposalId/reject
router.post(
  '/proposals/:proposalId/reject',
  requireAuth,
  requirePermission('api:approve-remediation'),
  async (req: Request, res: Response) => {
    try {
      const { proposalId } = req.params;
      const proposal = findProposalById(proposalId);
      if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
      if (proposal.status !== 'pending-approval') {
        return res.status(409).json({ error: `Proposal is already '${proposal.status}'` });
      }

      const updated = { ...proposal, status: 'rejected' as const };
      upsertProposal(updated);

      const record: ApprovalRequest = {
        id: genApprovalId(),
        proposalId,
        collectionId: proposal.collectionId,
        requestedBy: proposal.requestedBy ?? 'unknown',
        requestedAt: proposal.createdAt,
        status: 'decided',
        decision: 'rejected',
        decidedBy: req.session?.userId ?? 'unknown',
        decidedAt: new Date().toISOString(),
        reviewComment: req.body?.reviewComment,
        rollbackEligible: false,
        tenantId: proposal.tenantId,
      };
      upsertApproval(record);

      logApiAudit('api:remediation:rejected', proposal.collectionId, req, {
        details: `proposal ${proposalId}`,
      });
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

// GET /api/remediation/approvals?collectionId=X  — audit trail
router.get(
  '/approvals',
  requireAuth,
  requirePermission('api:view-audit'),
  async (req: Request, res: Response) => {
    try {
      const { collectionId } = req.query as { collectionId?: string };
      const approvals = collectionId
        ? listApprovalsByCollection(collectionId)
        : loadApprovalsRegistry().approvals;
      res.json({ approvals });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

export function registerRemediationRoutes(app: Express): void {
  app.use('/api/remediation', router);
}
