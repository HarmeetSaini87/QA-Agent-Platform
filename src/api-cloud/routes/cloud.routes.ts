// src/api-cloud/routes/cloud.routes.ts
// Phase E Step 6: Cloud-native readiness REST endpoints.

import type { Express, Request, Response } from 'express';
import { globalCloudWorkerRegistry } from '../cloud-worker-registry';
import { globalK8sManifestBuilder } from '../kubernetes-readiness-manifest';
import { globalElasticScalingAdvisor } from '../elastic-scaling-advisor';
import { globalResourceGovernanceRegistry } from '../resource-governance-registry';
import { LocalInProcessBroker } from '../contracts/cloud-queue-broker.contracts';

const _localBroker = new LocalInProcessBroker();

export function registerCloudRoutes(app: Express): void {

  // GET /api/cloud/workers — list active cloud workers
  app.get('/api/cloud/workers', (_req: Request, res: Response) => {
    res.json({
      workers: globalCloudWorkerRegistry.listActive(),
      snapshot: globalCloudWorkerRegistry.snapshot(),
    });
  });

  // POST /api/cloud/workers — register a cloud worker
  app.post('/api/cloud/workers', (req: Request, res: Response) => {
    const { workerId, provider, tenantId, collectionId, runId, resourceHints } = req.body as {
      workerId?: string;
      provider?: string;
      tenantId?: string;
      collectionId?: string;
      runId?: string;
      resourceHints?: { memoryMb?: number; cpuMillicores?: number };
    };

    if (!workerId || !provider) {
      res.status(400).json({ error: 'workerId and provider required' });
      return;
    }

    const spec = {
      workerId,
      provider: provider as 'local' | 'kubernetes',
      status: 'idle' as const,
      startedAt: new Date().toISOString(),
      ...(tenantId && { tenantId }),
      ...(collectionId && { collectionId }),
      ...(runId && { runId }),
      ...(resourceHints && { resourceHints }),
    };

    globalCloudWorkerRegistry.register(spec);
    res.status(201).json({ registered: true, workerId });
  });

  // POST /api/cloud/workers/:workerId/terminate — terminate a worker
  app.post('/api/cloud/workers/:workerId/terminate', (req: Request, res: Response) => {
    const { workerId } = req.params as { workerId: string };
    const { reason } = req.body as { reason?: string };
    const event = globalCloudWorkerRegistry.terminate(workerId, reason);
    res.json(event);
  });

  // POST /api/cloud/k8s/pod-spec — generate advisory K8s pod spec
  app.post('/api/cloud/k8s/pod-spec', (req: Request, res: Response) => {
    const context = req.body as {
      workerId?: string;
      collectionId?: string;
      runId?: string;
      tenantId?: string;
      leaseId?: string;
    };

    if (!context.workerId) {
      res.status(400).json({ error: 'workerId required' });
      return;
    }

    const spec = globalK8sManifestBuilder.buildPodSpec(context as { workerId: string });
    const validation = globalK8sManifestBuilder.validate(spec);
    res.json({ spec, validation });
  });

  // GET /api/cloud/scaling/policies — list scaling policies
  app.get('/api/cloud/scaling/policies', (_req: Request, res: Response) => {
    res.json({ policies: globalElasticScalingAdvisor.listPolicies() });
  });

  // POST /api/cloud/scaling/advise — get advisory scaling recommendation
  app.post('/api/cloud/scaling/advise', (req: Request, res: Response) => {
    const { policyId, currentWorkers, queueDepth } = req.body as {
      policyId?: string;
      currentWorkers?: number;
      queueDepth?: number;
    };

    if (policyId === undefined || currentWorkers === undefined || queueDepth === undefined) {
      res.status(400).json({ error: 'policyId, currentWorkers, queueDepth required' });
      return;
    }

    res.json(globalElasticScalingAdvisor.advise(policyId, currentWorkers, queueDepth));
  });

  // GET /api/cloud/resource-governance/budget — check quota budget
  app.get('/api/cloud/resource-governance/budget', (req: Request, res: Response) => {
    const policyId = (req.query['policyId'] as string) || 'default';
    const activeRuns = parseInt((req.query['activeRuns'] as string) || '0', 10);
    const queueDepth = parseInt((req.query['queueDepth'] as string) || '0', 10);
    res.json(globalResourceGovernanceRegistry.checkBudget(policyId, activeRuns, queueDepth));
  });

  // GET /api/cloud/resource-governance/policies — list resource policies
  app.get('/api/cloud/resource-governance/policies', (_req: Request, res: Response) => {
    res.json({ policies: globalResourceGovernanceRegistry.listPolicies() });
  });

  // GET /api/cloud/queue/stats — local broker stats (extensible to cloud brokers)
  app.get('/api/cloud/queue/stats', async (_req: Request, res: Response) => {
    const stats = await _localBroker.stats();
    res.json(stats);
  });
}
