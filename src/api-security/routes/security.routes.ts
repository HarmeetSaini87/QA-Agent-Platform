// src/api-security/routes/security.routes.ts
// Phase E Step 4: Security hardening REST endpoints.

import type { Express, Request, Response } from 'express';
import { globalSecretGovernanceEngine } from '../secret-governance-engine';
import { globalMaskingPolicy, DEFAULT_MASKING_CONFIG } from '../configurable-masking-policy';
import { globalComplianceAuditExporter } from '../compliance-audit-exporter';
import { globalEnvironmentSecurityGuard } from '../environment-security-guard';
import { globalWorkerSecurityBoundary } from '../worker-security-boundary';

export function registerSecurityRoutes(app: Express): void {

  // GET /api/security/masking-policy — return current masking config
  app.get('/api/security/masking-policy', (_req: Request, res: Response) => {
    res.json({
      config: globalMaskingPolicy.config,
      headerRuleCount: globalMaskingPolicy.config.headerRules.length,
      variableRuleCount: globalMaskingPolicy.config.variableRules.length,
      bodyFieldRuleCount: globalMaskingPolicy.config.bodyFieldRules.length,
    });
  });

  // POST /api/security/secret-scan — scan a flat record for secret violations
  app.post('/api/security/secret-scan', (req: Request, res: Response) => {
    const { record, layer } = req.body as { record?: Record<string, unknown>; layer?: string };
    if (!record || typeof record !== 'object') {
      res.status(400).json({ error: 'record (object) required' });
      return;
    }
    const validLayers = ['graph', 'replay', 'audit', 'ai', 'overlay'] as const;
    const resolvedLayer = (validLayers as readonly string[]).includes(layer ?? '')
      ? (layer as typeof validLayers[number])
      : 'audit';
    const violations = globalSecretGovernanceEngine.scanRecord(record, resolvedLayer);
    res.json({
      scannedAt: new Date().toISOString(),
      violations,
      violationCount: violations.length,
      clean: violations.length === 0,
    });
  });

  // POST /api/security/mask-headers — apply masking policy to headers
  app.post('/api/security/mask-headers', (req: Request, res: Response) => {
    const { headers } = req.body as { headers?: Record<string, string> };
    if (!headers || typeof headers !== 'object') {
      res.status(400).json({ error: 'headers (object) required' });
      return;
    }
    const result = globalMaskingPolicy.maskHeaders(headers);
    res.json(result);
  });

  // GET /api/security/compliance/audit-export — export compliance trace records
  app.get('/api/security/compliance/audit-export', (req: Request, res: Response) => {
    const format = (req.query['format'] as string) || 'json';
    const validFormats = ['json', 'csv', 'ndjson'] as const;
    const resolvedFormat = (validFormats as readonly string[]).includes(format)
      ? (format as typeof validFormats[number])
      : 'json';
    const exported = globalComplianceAuditExporter.export(resolvedFormat);
    res.json(exported);
  });

  // GET /api/security/environment/:envId/access — check access for a role
  app.get('/api/security/environment/:envId/access', (req: Request, res: Response) => {
    const { envId } = req.params as { envId: string };
    const role = (req.query['role'] as string) || 'viewer';
    const decision = globalEnvironmentSecurityGuard.checkAccess(envId, role);
    res.json(decision);
  });

  // GET /api/security/environment/policies — list all env security policies
  app.get('/api/security/environment/policies', (_req: Request, res: Response) => {
    res.json({ policies: globalEnvironmentSecurityGuard.listPolicies() });
  });

  // POST /api/security/environment/policies — register a new env policy
  app.post('/api/security/environment/policies', (req: Request, res: Response) => {
    const policy = req.body;
    if (!policy?.environmentId || !Array.isArray(policy.allowedRoles)) {
      res.status(400).json({ error: 'environmentId and allowedRoles required' });
      return;
    }
    globalEnvironmentSecurityGuard.registerPolicy({
      environmentId: policy.environmentId,
      isProduction: policy.isProduction ?? false,
      allowedRoles: policy.allowedRoles,
      approvalRequirement: policy.approvalRequirement ?? 'none',
      restrictSecretDecryption: policy.restrictSecretDecryption ?? false,
      blockReplaySynthesis: policy.blockReplaySynthesis ?? false,
    });
    res.status(201).json({ registered: true, environmentId: policy.environmentId });
  });

  // GET /api/security/workers/:workerId/snapshot — worker security snapshot
  app.get('/api/security/workers/:workerId/snapshot', (req: Request, res: Response) => {
    const { workerId } = req.params as { workerId: string };
    res.json(globalWorkerSecurityBoundary.snapshot(workerId));
  });

  // POST /api/security/workers/:workerId/force-cleanup — advisory force cleanup
  app.post('/api/security/workers/:workerId/force-cleanup', (req: Request, res: Response) => {
    const { workerId } = req.params as { workerId: string };
    const records = globalWorkerSecurityBoundary.forceCleanup(workerId);
    res.json({ workerId, cleaned: records.length, records });
  });
}
