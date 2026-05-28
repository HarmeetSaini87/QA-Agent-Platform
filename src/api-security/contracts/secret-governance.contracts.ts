// src/api-security/contracts/secret-governance.contracts.ts
// Phase E Step 4: Secret governance — classification, leak detection, policy enforcement.

export type SecretClassification =
  | 'api-key'
  | 'auth-token'
  | 'oauth-token'
  | 'password'
  | 'env-secret'
  | 'replay-sensitive'
  | 'pii';

export interface SecretLeakViolation {
  readonly field: string;
  readonly classification: SecretClassification;
  readonly layer: 'graph' | 'replay' | 'audit' | 'ai' | 'overlay';
  readonly detectedAt: string;
  readonly advisoryNote: string;
}

export interface SecretScanResult {
  readonly scannedAt: string;
  readonly violations: SecretLeakViolation[];
  readonly violationCount: number;
  readonly clean: boolean;
}

export interface ISecretGovernancePolicy {
  /**
   * Returns true if the key/value pair should be treated as secret.
   * Advisory only — never mutates data.
   */
  isSecret(key: string, value?: unknown): boolean;
  classify(key: string): SecretClassification | null;
  /** Scan a flat record for secret violations in a given layer. */
  scanRecord(record: Record<string, unknown>, layer: SecretLeakViolation['layer']): SecretLeakViolation[];
}
