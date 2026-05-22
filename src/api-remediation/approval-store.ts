import * as fs from 'fs';
import * as path from 'path';
import type { ApprovalRequest, ApprovalsRegistry } from './contracts/approval-workflow.contracts';

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || 'data');
}

function approvalsPath(): string {
  return path.join(dataDir(), 'remediation-approvals.json');
}

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

export function loadApprovalsRegistry(): ApprovalsRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(approvalsPath(), 'utf8')) as ApprovalsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, approvals: [] };
  }
}

export function saveApprovalsRegistry(reg: ApprovalsRegistry): void {
  atomicWrite(approvalsPath(), JSON.stringify(reg, null, 2));
}

export function upsertApproval(approval: ApprovalRequest): void {
  const reg = loadApprovalsRegistry();
  const idx = reg.approvals.findIndex(a => a.id === approval.id);
  if (idx >= 0) reg.approvals[idx] = approval;
  else reg.approvals.push(approval);
  saveApprovalsRegistry(reg);
}

export function findApprovalByProposalId(proposalId: string): ApprovalRequest | null {
  return loadApprovalsRegistry().approvals.find(
    a => a.proposalId === proposalId && a.status === 'pending',
  ) ?? null;
}

export function listApprovalsByCollection(collectionId: string): ApprovalRequest[] {
  return loadApprovalsRegistry().approvals.filter(a => a.collectionId === collectionId);
}
