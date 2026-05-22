import * as fs from 'fs';
import * as path from 'path';
import type { RemediationProposal } from './contracts/remediation-proposal.contracts';

interface ProposalsRegistry {
  _schemaVersion: 1;
  proposals: RemediationProposal[];
}

function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || 'data');
}

function proposalsPath(): string {
  return path.join(dataDir(), 'remediation-proposals.json');
}

function atomicWrite(file: string, data: string): void {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data, 'utf8');
  fs.renameSync(tmp, file);
}

function load(): ProposalsRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(proposalsPath(), 'utf8')) as ProposalsRegistry;
    if (parsed._schemaVersion !== 1) throw new Error('schema mismatch');
    return parsed;
  } catch {
    return { _schemaVersion: 1, proposals: [] };
  }
}

function save(reg: ProposalsRegistry): void {
  atomicWrite(proposalsPath(), JSON.stringify(reg, null, 2));
}

export function upsertProposal(proposal: RemediationProposal): void {
  const reg = load();
  const idx = reg.proposals.findIndex(p => p.id === proposal.id);
  if (idx >= 0) reg.proposals[idx] = proposal;
  else reg.proposals.push(proposal);
  save(reg);
}

export function findProposalById(id: string): RemediationProposal | null {
  return load().proposals.find(p => p.id === id) ?? null;
}

export function listProposalsByCollection(collectionId: string): RemediationProposal[] {
  return load().proposals.filter(p => p.collectionId === collectionId);
}
