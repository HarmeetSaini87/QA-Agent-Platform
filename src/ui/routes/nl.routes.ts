import express, { Request, Response } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { readAll } from '../../data/store';
import type { Locator, NlSuggestResponse, SuggestedStep, NlConfig } from '../../data/types';
import { requireAuth, requireAdmin, requireAuthOrApiKey } from '../../auth/middleware';
import { nlSuggest, NL_PROVIDERS } from '../../utils/nlProvider';
import type { NlProviderConfig } from '../../utils/nlProvider';
import { splitSentences, ruleMatchSentence } from '../../utils/nlRuleEngine';
import { loadNlConfig, saveNlConfig, loadAliasMap, saveAliasMap, DEFAULT_NL_CONFIG } from '../../utils/nlStore';
import { _nlCache, NL_CACHE_TTL_MS, nlRateCheck, logNL, nlValidateStep } from '../helpers/nl-cache';

function _nlCryptoKey(): Buffer {
  const secret = process.env.SESSION_SECRET || 'qa-agent-platform-default-secret';
  return crypto.createHash('sha256').update('nl-token-key:' + secret).digest();
}

function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', _nlCryptoKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

function decryptToken(envelope: string): string {
  const [ivB64, tagB64, encB64] = envelope.split('.');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('Invalid encrypted token envelope');
  const decipher = crypto.createDecipheriv('aes-256-gcm', _nlCryptoKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}

export function registerNlRoutes(app: express.Application): void {
  app.post('/api/nl/suggest', requireAuthOrApiKey, async (req: Request, res: Response) => {
    const { text, projectId } = req.body as { text?: string; projectId?: string };
    if (!text || typeof text !== 'string') { res.status(400).json({ error: 'text is required' }); return; }
    if (text.length > 3000) { res.status(400).json({ error: 'text too long (max 3000 chars)' }); return; }
    const sessionId = ((req as any).session?.userId || (req as any).apiKeyId || 'anon') as string;
    if (!nlRateCheck(sessionId)) { res.status(429).set('Retry-After', '60').json({ error: 'Rate limit exceeded — try again in 60s' }); return; }
    const sentences = splitSentences(text);
    if (sentences.length === 0) { res.status(400).json({ error: 'No sentences detected in input' }); return; }
    if (sentences.length > 20) { res.status(400).json({ error: 'Too many sentences (max 20). Split into multiple requests.' }); return; }
    const kwRaw = JSON.parse(fs.readFileSync(path.resolve('src/data/keywords.json'), 'utf-8'));
    const kwArray: Array<{ key?: string; keyword?: string }> = Array.isArray(kwRaw) ? kwRaw : (kwRaw.categories || []).flatMap((cat: any) => Array.isArray(cat.keywords) ? cat.keywords : []);
    const allowedKeywords = kwArray.map((k: any) => k.key || k.keyword).filter(Boolean) as string[];
    const locators = readAll<Locator>('locators');
    const projectLocators = projectId ? locators.filter(l => !l.projectId || l.projectId === projectId) : locators;
    const locatorNames = projectLocators.map(l => l.name).filter(Boolean);
    const locVersion = crypto.createHash('sha256').update(locatorNames.slice().sort().join('|')).digest('hex').slice(0, 8);
    const kwVersion = crypto.createHash('sha256').update(allowedKeywords.slice().sort().join('|')).digest('hex').slice(0, 8);
    const cacheKey = crypto.createHash('sha256').update(text + '|' + locVersion + '|' + kwVersion).digest('hex');
    const cached = _nlCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) { res.json({ ...cached.result, meta: { ...cached.result.meta, cached: true } }); return; }
    const aliasMap = loadAliasMap();
    const cfg = loadNlConfig();
    const t0 = Date.now();
    const ruleSteps: SuggestedStep[] = sentences.map(s => ruleMatchSentence(s, allowedKeywords, locatorNames, aliasMap));
    const steps: SuggestedStep[] = [...ruleSteps];
    let providerLabel: string | undefined;
    let aiTimedOut = false;
    if (cfg.enabled && cfg.provider && cfg.apiKeyEncrypted) {
      let rawKey = '';
      try { rawKey = decryptToken(cfg.apiKeyEncrypted); } catch { /* key invalid */ }
      if (rawKey) {
        const aiCfg: NlProviderConfig = { provider: cfg.provider as any, apiKey: rawKey, model: cfg.model || undefined, baseUrl: cfg.baseUrl || undefined };
        const kwList = allowedKeywords.join(', ');
        const locList = locatorNames.join(', ');
        let limit: (fn: () => Promise<any>) => Promise<any>;
        try { const pLimit = require('p-limit'); const limiter = pLimit(3); limit = (fn) => limiter(fn); } catch { limit = (fn) => fn(); }
        const aiResults = await Promise.all(sentences.map((sentence, i) => limit(async () => { try { const result = await Promise.race([nlSuggest(aiCfg, sentence, kwList, locList), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), cfg.timeoutMs))]) as any; return { i, result, timedOut: false }; } catch (e: any) { if (e?.message === 'timeout') aiTimedOut = true; return { i, result: null, timedOut: true }; } })));
        providerLabel = `${cfg.provider}/${cfg.model}`;
        const threshold = cfg.confidenceThreshold ?? 0.5;
        for (const { i, result, timedOut } of aiResults) {
          if (timedOut || !result) continue;
          const ai = result; const rule = ruleSteps[i]; const aiOverride = (ai.confidence ?? 0) >= threshold && ai.keyword;
          steps[i] = { keyword: aiOverride && ai.keyword ? ai.keyword : rule.keyword, locatorName: aiOverride && ai.locatorName ? ai.locatorName : rule.locatorName, value: aiOverride && ai.value ? ai.value : rule.value, confidence: Math.max(rule.confidence, Math.min(1, Math.max(0, ai.confidence ?? 0))), confidenceBreakdown: aiOverride ? { verb: ai.confidence ?? 0, locator: ai.confidence ?? 0, value: ai.confidence ?? 0 } : rule.confidenceBreakdown, matched: aiOverride ? !!(ai.keyword) : rule.matched, source: aiOverride ? 'ai' : 'rule', originalSentence: sentences[i] };
        }
      }
    }
    const validated = steps.map(s => nlValidateStep(s, allowedKeywords, locatorNames));
    const durationMs = Date.now() - t0;
    const response: NlSuggestResponse = { version: 'v1', steps: validated, meta: { provider: providerLabel, durationMs, cached: false, aiTimedOut } };
    _nlCache.set(cacheKey, { result: response, expiresAt: Date.now() + NL_CACHE_TTL_MS });
    logNL({ ts: new Date().toISOString(), sentences, ruleSteps, steps: validated, durationMs, provider: providerLabel, aiTimedOut });
    res.json(response);
  });

  app.post('/api/nl-suggest', requireAuth, (_req: Request, res: Response) => { res.status(308).set('Location', '/api/nl/suggest').json({ error: 'Use POST /api/nl/suggest instead' }); });
  app.get('/api/nl/config', requireAdmin, (_req, res) => { const cfg = loadNlConfig(); res.json({ ...cfg, apiKeyEncrypted: undefined, apiKeySet: !!cfg.apiKeyEncrypted }); });
  app.put('/api/nl/config', requireAdmin, async (req: Request, res: Response) => {
    const body = req.body as Partial<NlConfig> & { apiKey?: string };
    const cur = loadNlConfig();
    if (body.confidenceThreshold !== undefined && (body.confidenceThreshold < 0 || body.confidenceThreshold > 1)) { res.status(400).json({ error: 'confidenceThreshold must be 0–1' }); return; }
    if (body.timeoutMs !== undefined && (body.timeoutMs < 500 || body.timeoutMs > 30_000)) { res.status(400).json({ error: 'timeoutMs must be 500–30000' }); return; }
    if (body.baseUrl) { try { new URL(body.baseUrl); } catch { res.status(400).json({ error: 'baseUrl is not a valid URL' }); return; } }
    const updated: NlConfig = { ...cur, enabled: body.enabled ?? cur.enabled, provider: body.provider ?? cur.provider, model: body.model ?? cur.model, baseUrl: body.baseUrl ?? cur.baseUrl, confidenceThreshold: body.confidenceThreshold ?? cur.confidenceThreshold, timeoutMs: body.timeoutMs ?? cur.timeoutMs, apiKeyEncrypted: body.apiKey ? encryptToken(body.apiKey) : cur.apiKeyEncrypted };
    saveNlConfig(updated); res.json({ ok: true });
  });

  app.post('/api/nl/test', requireAdmin, async (req: Request, res: Response) => {
    const cfg = loadNlConfig();
    if (!cfg.provider) { res.status(400).json({ error: 'No provider configured' }); return; }
    let rawKey = '';
    try { rawKey = decryptToken(cfg.apiKeyEncrypted); } catch { /* ignore */ }
    if (!rawKey && cfg.provider !== 'ollama') { res.status(400).json({ error: 'API key not set' }); return; }
    const aiCfg: NlProviderConfig = { provider: cfg.provider as any, apiKey: rawKey, model: cfg.model || undefined, baseUrl: cfg.baseUrl || undefined };
    const t0 = Date.now();
    try { const result = await Promise.race([nlSuggest(aiCfg, 'Click the login button', 'Click Element, Fill, Navigate To', 'loginBtn, usernameField'), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), cfg.timeoutMs))]) as any; res.json({ ok: true, latencyMs: Date.now() - t0, model: cfg.model, echo: result.keyword }); } catch (e: any) { res.status(502).json({ ok: false, error: e?.message || 'Provider error' }); }
  });

  app.get('/api/nl/aliases', requireAdmin, (_req, res) => { res.json(loadAliasMap()); });
  app.put('/api/nl/aliases', requireAdmin, (req: Request, res: Response) => { const body = req.body as Record<string, string[]>; if (typeof body !== 'object' || Array.isArray(body)) { res.status(400).json({ error: 'body must be an object' }); return; } saveAliasMap(body); res.json({ ok: true }); });
  app.get('/api/nl-providers', requireAdmin, (_req, res) => { res.json(NL_PROVIDERS); });
}