// src/api-cloud/contracts/kubernetes-readiness.contracts.ts
// Phase E Step 6: Kubernetes readiness contracts — pod metadata, labels, execution ownership.
// No K8s API coupling yet. Structures are K8s-compatible label/annotation maps.

export interface K8sPodLabels {
  readonly 'app.kubernetes.io/name': string;
  readonly 'app.kubernetes.io/component': string;
  readonly 'qa-platform/tenant-id'?: string;
  readonly 'qa-platform/collection-id'?: string;
  readonly 'qa-platform/run-id'?: string;
  readonly 'qa-platform/worker-id': string;
  readonly [key: string]: string | undefined;
}

export interface K8sPodAnnotations {
  readonly 'qa-platform/lease-id'?: string;
  readonly 'qa-platform/replay-owner'?: string;
  readonly 'qa-platform/teardown-owner'?: string;
  readonly 'qa-platform/orchestration-version': string;
  readonly [key: string]: string | undefined;
}

export interface K8sExecutionPodSpec {
  readonly podName: string;
  readonly namespace: string;
  readonly labels: K8sPodLabels;
  readonly annotations: K8sPodAnnotations;
  readonly generatedAt: string;
}

export interface IKubernetesReadinessManifestBuilder {
  /** Build a K8s-compatible pod spec from execution context. Advisory — not deployed by this function. */
  buildPodSpec(context: {
    workerId: string;
    collectionId?: string;
    runId?: string;
    tenantId?: string;
    leaseId?: string;
  }): K8sExecutionPodSpec;
  /** Validate a pod spec for required labels/annotations. */
  validate(spec: K8sExecutionPodSpec): { valid: boolean; missing: string[] };
}
