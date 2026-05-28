// src/api-cloud/index.ts
// Phase E Step 6: Cloud-Native Execution Platform, Kubernetes Readiness & Elastic Enterprise Scaling.

export * from './contracts/cloud-worker.contracts';
export * from './contracts/kubernetes-readiness.contracts';
export * from './contracts/elastic-scaling.contracts';
export * from './contracts/cloud-queue-broker.contracts';
export * from './contracts/resource-governance.contracts';
export * from './contracts/multi-cloud-extension.contracts';

export { CloudWorkerRegistry, globalCloudWorkerRegistry } from './cloud-worker-registry';
export { KubernetesReadinessManifestBuilder, globalK8sManifestBuilder } from './kubernetes-readiness-manifest';
export { ElasticScalingAdvisor, globalElasticScalingAdvisor } from './elastic-scaling-advisor';
export { ResourceGovernanceRegistry, globalResourceGovernanceRegistry } from './resource-governance-registry';
export { registerCloudRoutes } from './routes/cloud.routes';
