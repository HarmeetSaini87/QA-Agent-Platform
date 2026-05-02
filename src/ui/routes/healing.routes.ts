import express, { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { readAll, upsert, findById, LOCATORS } from '../../data/store';
import type { Locator, HealingProposal } from '../../data/types';
import { scoreCandidates, T3_AUTO_THRESHOLD } from '../../utils/healingEngine';
import type { DomCandidate } from '../../utils/healingEngine';
import { logger } from '../../utils/logger';
import { logAudit } from '../../auth/audit';
import { requireAuth, requireEditor } from '../../auth/middleware';
import { backfillScriptsAndFunctions } from '../helpers/run-spawner';
import { broadcast } from '../helpers/ws-broadcast';
import { config } from '../../framework/config';
import { runs } from '../helpers/state';
import { attachDefectInfo } from '../helpers/run-spawner';

export function registerHealingRoutes(app: express.Application): void {
  // T3 Similarity heal endpoint
  app.post('/api/heal', requireAuth, (req: Request, res: Response) => {
    const { locatorId, profile, candidates, stepOrder, keyword, runId } = req.body as { locatorId: string; profile: any; candidates: DomCandidate[]; stepOrder: number; keyword: string; runId: string };
    if (!locatorId || !profile || !candidates?.length) { res.status(400).json({ error: 'locatorId, profile and candidates are required' }); return; }
    const ranked = scoreCandidates(profile, candidates);
    if (!ranked.length || ranked[0].score < 1) { res.status(404).json({ error: 'No suitable candidate found' }); return; }
    const best = ranked[0];
    const locEntry = readAll<Locator>(LOCATORS).find(l => l.id === locatorId);
    const proposalId = uuidv4();
    const autoApply = best.score >= T3_AUTO_THRESHOLD;
    const proposal: HealingProposal = { id: proposalId, projectId: locEntry?.projectId ?? '', locatorId, locatorName: locEntry?.name ?? locatorId, scriptId: '', scriptTitle: '', stepOrder, oldSelector: locEntry?.selector ?? '', oldSelectorType: locEntry?.selectorType ?? 'css', newSelector: best.bestSelector, newSelectorType: best.bestType, confidence: best.score, healedAt: new Date().toISOString(), status: autoApply ? 'auto-applied' : 'pending-review' };
    const proposalsDir = path.resolve('data', 'proposals');
    try { fs.mkdirSync(proposalsDir, { recursive: true }); fs.writeFileSync(path.join(proposalsDir, `${proposalId}.json`), JSON.stringify(proposal, null, 2)); } catch (err) { logger.warn(`[heal] Failed to write proposal: ${(err as Error).message}`); }
    if (autoApply && locEntry) {
      const demoted = { selector: locEntry.selector, selectorType: locEntry.selectorType, confidence: 50 };
      const existingAlts = (locEntry.alternatives ?? []).filter((a: any) => a.selector !== best.bestSelector && a.selector !== locEntry.selector);
      upsert(LOCATORS, { ...locEntry, selector: best.bestSelector, selectorType: best.bestType as Locator['selectorType'], alternatives: [demoted, ...existingAlts].slice(0, 10), healingStats: { healCount: (locEntry.healingStats?.healCount ?? 0) + 1, lastHealedAt: new Date().toISOString(), lastHealedFrom: locEntry.selector, lastHealedBy: 'auto' }, updatedAt: new Date().toISOString() });
      backfillScriptsAndFunctions(locatorId, locEntry.name, best.bestSelector, best.bestType);
    }
    logger.info(`[heal] T3 locator=${locatorId} score=${best.score} auto=${autoApply} selector=${best.bestSelector}`);
    res.json({ selector: best.bestSelector, selectorType: best.bestType, score: best.score, autoApplied: autoApply, proposalId, breakdown: best.breakdown });
  });

  // Healing Proposals
  app.get('/api/proposals', requireAuth, (req: Request, res: Response) => {
    const { projectId, status } = req.query as { projectId?: string; status?: string };
    const proposalsDir = path.resolve('data', 'proposals');
    if (!fs.existsSync(proposalsDir)) { res.json([]); return; }
    const proposals: HealingProposal[] = [];
    for (const f of fs.readdirSync(proposalsDir)) { if (!f.endsWith('.json')) continue; try { proposals.push(JSON.parse(fs.readFileSync(path.join(proposalsDir, f), 'utf-8'))); } catch { /* skip */ } }
    let result = proposals;
    if (projectId) result = result.filter(p => p.projectId === projectId);
    if (status) result = result.filter(p => p.status === status);
    result.sort((a, b) => b.healedAt.localeCompare(a.healedAt));
    res.json(result);
  });

  app.post('/api/proposals/:id/review', requireAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const { action } = req.body as { action: 'approved' | 'approved-temporary' | 'rejected' };
    const user = req.session as any;
    if (!['approved', 'approved-temporary', 'rejected'].includes(action)) { res.status(400).json({ error: 'action must be approved, approved-temporary, or rejected' }); return; }
    const filePath = path.resolve('data', 'proposals', `${id}.json`);
    if (!fs.existsSync(filePath)) { res.status(404).json({ error: 'Proposal not found' }); return; }
    try {
      const proposal: HealingProposal = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      proposal.status = action; proposal.reviewedBy = user?.username ?? 'unknown'; proposal.reviewedAt = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(proposal, null, 2));
      const locEntry = readAll<Locator>(LOCATORS).find(l => l.id === proposal.locatorId);
      if (action === 'approved' && locEntry) {
        const demoted = { selector: locEntry.selector, selectorType: locEntry.selectorType, confidence: 50 };
        const existingAlts = (locEntry.alternatives ?? []).filter((a: any) => a.selector !== proposal.newSelector && a.selector !== locEntry.selector);
        upsert(LOCATORS, { ...locEntry, selector: proposal.newSelector, selectorType: proposal.newSelectorType as Locator['selectorType'], alternatives: [demoted, ...existingAlts].slice(0, 10), healingStats: { healCount: (locEntry.healingStats?.healCount ?? 0) + 1, lastHealedAt: proposal.reviewedAt!, lastHealedFrom: proposal.oldSelector, lastHealedBy: 'approved' }, updatedAt: new Date().toISOString() });
        backfillScriptsAndFunctions(locEntry.id, locEntry.name, proposal.newSelector, proposal.newSelectorType);
      } else if (action === 'approved-temporary' && locEntry) {
        const newAlt = { selector: proposal.newSelector, selectorType: proposal.newSelectorType, confidence: proposal.confidence };
        const existingAlts = (locEntry.alternatives ?? []).filter((a: any) => a.selector !== proposal.newSelector);
        upsert(LOCATORS, { ...locEntry, alternatives: [newAlt, ...existingAlts].slice(0, 10), healingStats: { healCount: (locEntry.healingStats?.healCount ?? 0) + 1, lastHealedAt: proposal.reviewedAt!, lastHealedFrom: proposal.oldSelector, lastHealedBy: 'approved' }, updatedAt: new Date().toISOString() });
      }
      res.json({ ok: true, proposal });
    } catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  // T4 Human Review Queue
  app.get('/api/debug/heal-pending', requireAuth, (req: Request, res: Response) => {
    const { runId } = req.query as { runId?: string };
    if (!runId) { res.json(null); return; }
    const healFile = path.join(config.paths.testResults, runId, 'pending-heal.json');
    if (!fs.existsSync(healFile)) { res.json(null); return; }
    try { res.json(JSON.parse(fs.readFileSync(healFile, 'utf-8'))); } catch { res.json(null); }
  });

  app.post('/api/debug/heal-respond', requireAuth, (req: Request, res: Response) => {
    const { runId, action, selector, selectorType, locatorId, stepOrder, keyword, oldSelector, oldSelectorType, score, projectId } = req.body as { runId: string; action: 'approve' | 'reject'; selector?: string; selectorType?: string; locatorId?: string; stepOrder?: number; keyword?: string; oldSelector?: string; oldSelectorType?: string; score?: number; projectId?: string };
    if (!runId || !action) { res.status(400).json({ error: 'runId and action required' }); return; }
    const responseFile = path.join(config.paths.testResults, runId, 'heal-response.json');
    const payload = { action, selector: selector || null, selectorType: selectorType || 'css' };
    try { fs.writeFileSync(responseFile, JSON.stringify(payload)); } catch (err) { res.status(500).json({ error: `Failed to write heal response: ${(err as Error).message}` }); return; }
    if (action === 'approve' && selector && locatorId) {
      const user = (req.session as any)?.username ?? 'unknown';
      const now = new Date().toISOString();
      const proposalId = uuidv4();
      const locEntry = readAll<Locator>(LOCATORS).find(l => l.id === locatorId);
      const proposal: HealingProposal = { id: proposalId, projectId: projectId ?? locEntry?.projectId ?? '', locatorId, locatorName: locEntry?.name ?? locatorId, scriptId: '', scriptTitle: '', stepOrder: stepOrder ?? 0, oldSelector: oldSelector ?? locEntry?.selector ?? '', oldSelectorType: oldSelectorType ?? locEntry?.selectorType ?? 'css', newSelector: selector, newSelectorType: selectorType ?? 'css', confidence: score ?? 0, healedAt: now, status: 'approved', reviewedBy: user, reviewedAt: now };
      const proposalsDir = path.resolve('data', 'proposals');
      try { fs.mkdirSync(proposalsDir, { recursive: true }); fs.writeFileSync(path.join(proposalsDir, `${proposalId}.json`), JSON.stringify(proposal, null, 2)); } catch (err) { logger.warn(`[heal-respond] Failed to write proposal: ${(err as Error).message}`); }
      if (locEntry) {
        const newAlt = { selector, selectorType: selectorType ?? 'css', confidence: score ?? 0 };
        const existing = locEntry.alternatives ?? [];
        const deduped = existing.filter((a: { selector: string }) => a.selector !== selector);
        deduped.unshift(newAlt);
        upsert(LOCATORS, { ...locEntry, alternatives: deduped.slice(0, 10), healingStats: { healCount: (locEntry.healingStats?.healCount ?? 0) + 1, lastHealedAt: now, lastHealedFrom: oldSelector ?? locEntry.selector, lastHealedBy: 'approved' } });
        logger.info(`[heal-respond] T4 approved locator=${locatorId} newSelector=${selector}`);
      }
    }
    res.json({ ok: true });
  });
}