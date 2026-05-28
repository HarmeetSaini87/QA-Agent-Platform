// src/api-security/secret-governance-engine.ts
// Phase E Step 4: Secret governance — classification + leak scan. Advisory only, never mutates.

import type {
  ISecretGovernancePolicy,
  SecretClassification,
  SecretLeakViolation,
} from './contracts/secret-governance.contracts';

const CLASSIFICATION_PATTERNS: Array<{ re: RegExp; classification: SecretClassification }> = [
  { re: /(?:^|[_-])(?:api[_-]?key|apikey)(?:[_-]|$)/i, classification: 'api-key' },
  { re: /(?:^|[_-])(?:auth[_-]?token|access[_-]?token|bearer)(?:[_-]|$)/i, classification: 'auth-token' },
  { re: /(?:^|[_-])(?:oauth|refresh[_-]?token|id[_-]?token)(?:[_-]|$)/i, classification: 'oauth-token' },
  { re: /(?:^|[_-])(?:password|passwd|pwd)(?:[_-]|$)/i, classification: 'password' },
  { re: /(?:^|[_-])(?:secret|private[_-]?key|client[_-]?secret)(?:[_-]|$)/i, classification: 'env-secret' },
  { re: /(?:^|[_-])(?:pii|ssn|dob|email|phone|address)(?:[_-]|$)/i, classification: 'pii' },
];

// Patterns that identify replay-sensitive keys (matching synthesizer's SECRET_KEY_RE)
const REPLAY_SENSITIVE_RE = /(?:token|secret|key|credential|auth|password|passwd)/i;

export class SecretGovernanceEngine implements ISecretGovernancePolicy {
  isSecret(key: string, _value?: unknown): boolean {
    return this.classify(key) !== null;
  }

  classify(key: string): SecretClassification | null {
    for (const { re, classification } of CLASSIFICATION_PATTERNS) {
      if (re.test(key)) return classification;
    }
    if (REPLAY_SENSITIVE_RE.test(key)) return 'replay-sensitive';
    return null;
  }

  scanRecord(
    record: Record<string, unknown>,
    layer: SecretLeakViolation['layer']
  ): SecretLeakViolation[] {
    const violations: SecretLeakViolation[] = [];
    const detectedAt = new Date().toISOString();

    for (const [key, value] of Object.entries(record)) {
      const classification = this.classify(key);
      if (!classification) continue;

      // Only flag if the value is non-empty and looks like real data (not already masked)
      const strVal = typeof value === 'string' ? value : String(value ?? '');
      if (!strVal || strVal === '***' || strVal === '[REDACTED]') continue;

      violations.push({
        field: key,
        classification,
        layer,
        detectedAt,
        advisoryNote: `Field "${key}" classified as "${classification}" may expose secrets in ${layer} layer.`,
      });
    }

    return violations;
  }
}

export const globalSecretGovernanceEngine = new SecretGovernanceEngine();
