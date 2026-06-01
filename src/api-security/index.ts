// src/api-security/index.ts
// Phase E Step 4: Security Hardening, Secret Governance & Compliance-Ready Execution Controls.

export * from './contracts/secret-governance.contracts';
export * from './contracts/masking-policy.contracts';
export * from './contracts/compliance-audit.contracts';
export * from './contracts/environment-security.contracts';
export * from './contracts/worker-security.contracts';
export * from './contracts/compliance-vault.contracts';

export { SecretGovernanceEngine, globalSecretGovernanceEngine } from './secret-governance-engine';
export {
  ConfigurableMaskingPolicy,
  DEFAULT_MASKING_CONFIG,
  globalMaskingPolicy,
} from './configurable-masking-policy';
export { ComplianceAuditExporter, globalComplianceAuditExporter } from './compliance-audit-exporter';
export { EnvironmentSecurityGuard, globalEnvironmentSecurityGuard } from './environment-security-guard';
export { WorkerSecurityBoundary, globalWorkerSecurityBoundary } from './worker-security-boundary';
export { registerSecurityRoutes } from './routes/security.routes';
