// src/api-cloud/kubernetes-readiness-manifest.ts
// Phase E Step 6: Builds K8s-compatible pod metadata. Advisory — nothing is deployed by this module.

import type {
  IKubernetesReadinessManifestBuilder,
  K8sExecutionPodSpec,
} from './contracts/kubernetes-readiness.contracts';

const PLATFORM_VERSION = '1.0.0';
const REQUIRED_LABELS: Array<keyof K8sExecutionPodSpec['labels']> = [
  'app.kubernetes.io/name',
  'app.kubernetes.io/component',
  'qa-platform/worker-id',
];
const REQUIRED_ANNOTATIONS: Array<keyof K8sExecutionPodSpec['annotations']> = [
  'qa-platform/orchestration-version',
];

export class KubernetesReadinessManifestBuilder implements IKubernetesReadinessManifestBuilder {
  buildPodSpec(context: {
    workerId: string;
    collectionId?: string;
    runId?: string;
    tenantId?: string;
    leaseId?: string;
  }): K8sExecutionPodSpec {
    const podName = `qa-worker-${context.workerId.slice(0, 8)}`;
    const namespace = context.tenantId ? `qa-tenant-${context.tenantId}` : 'qa-platform';

    return {
      podName,
      namespace,
      labels: {
        'app.kubernetes.io/name': 'qa-agent-platform',
        'app.kubernetes.io/component': 'execution-worker',
        'qa-platform/worker-id': context.workerId,
        ...(context.tenantId && { 'qa-platform/tenant-id': context.tenantId }),
        ...(context.collectionId && { 'qa-platform/collection-id': context.collectionId }),
        ...(context.runId && { 'qa-platform/run-id': context.runId }),
      },
      annotations: {
        'qa-platform/orchestration-version': PLATFORM_VERSION,
        ...(context.leaseId && { 'qa-platform/lease-id': context.leaseId }),
        ...(context.runId && { 'qa-platform/replay-owner': context.workerId }),
        ...(context.runId && { 'qa-platform/teardown-owner': context.workerId }),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  validate(spec: K8sExecutionPodSpec): { valid: boolean; missing: string[] } {
    const missing: string[] = [];
    for (const key of REQUIRED_LABELS) {
      if (!spec.labels[key]) missing.push(`label:${key}`);
    }
    for (const key of REQUIRED_ANNOTATIONS) {
      if (!spec.annotations[key]) missing.push(`annotation:${key}`);
    }
    return { valid: missing.length === 0, missing };
  }
}

export const globalK8sManifestBuilder = new KubernetesReadinessManifestBuilder();
