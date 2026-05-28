// src/api-copilot/autonomous-preparation-engine.ts
// Phase E Step 10: Controlled autonomous preparation engine. APPROVAL-GATED — never auto-executes.

import { randomUUID } from 'crypto';
import {
  ApprovalBasedAutonomousAction,
  AutonomousActionType,
  IAutonomousPreparationEngine,
} from './contracts/autonomous-preparation.contracts';

const GOVERNANCE_NOTE =
  'Action is pending human review. No runtime mutation occurs until explicitly approved.';
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days

export class AutonomousPreparationEngine implements IAutonomousPreparationEngine {
  private readonly _pending = new Map<string, ApprovalBasedAutonomousAction[]>();

  propose(
    collectionId: string,
    actionType: AutonomousActionType,
    actorId: string,
    proposedChange: Record<string, unknown>,
    rationale: string,
    confidence: number
  ): ApprovalBasedAutonomousAction {
    const now = new Date();
    const action: ApprovalBasedAutonomousAction = {
      actionId: randomUUID(),
      actionType,
      collectionId,
      actorId,
      proposedChange,
      rationale,
      confidence,
      status: 'pending-human-review',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
      governanceNote: GOVERNANCE_NOTE,
    };
    const prev = this._pending.get(collectionId) ?? [];
    this._pending.set(collectionId, [...prev, action]);
    return action;
  }

  listPending(collectionId: string): ApprovalBasedAutonomousAction[] {
    return (this._pending.get(collectionId) ?? []).filter((a) => a.status === 'pending-human-review');
  }

  _reset(): void {
    this._pending.clear();
  }
}

export const globalAutonomousPreparationEngine = new AutonomousPreparationEngine();
