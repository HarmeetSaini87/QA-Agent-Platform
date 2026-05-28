// src/api-security/configurable-masking-policy.ts
// Phase E Step 4: Configurable masking policy — extends existing masking patterns.

import type {
  IMaskingPolicy,
  MaskingConfig,
  MaskingReport,
} from './contracts/masking-policy.contracts';

const DEFAULT_MASK = '***';

export const DEFAULT_MASKING_CONFIG: MaskingConfig = {
  maskToken: DEFAULT_MASK,
  headerRules: [
    {
      pattern: /^(authorization|x-api-key|x-auth-token|cookie|set-cookie|proxy-authorization)$/i,
      replacement: DEFAULT_MASK,
      description: 'Standard sensitive HTTP headers',
    },
    {
      pattern: /^(x-client-secret|x-access-token|x-refresh-token|x-id-token)$/i,
      replacement: DEFAULT_MASK,
      description: 'Extended auth headers',
    },
  ],
  variableRules: [
    {
      pattern: /(?:password|token|secret|key|credential|api[_-]?key|auth|passwd|oauth)/i,
      replacement: DEFAULT_MASK,
      description: 'Sensitive variable names',
    },
  ],
  bodyFieldRules: [
    {
      pattern: /^(password|passwd|secret|api_key|apiKey|access_token|refresh_token|client_secret)$/i,
      replacement: DEFAULT_MASK,
      description: 'Sensitive request/response body fields',
    },
  ],
  maskReplayPayloads: true,
  maskAiOverlays: true,
};

export class ConfigurableMaskingPolicy implements IMaskingPolicy {
  constructor(readonly config: MaskingConfig = DEFAULT_MASKING_CONFIG) {}

  maskHeaders(headers: Record<string, string>): { masked: Record<string, string>; report: MaskingReport } {
    const masked: Record<string, string> = {};
    const maskedHeaders: string[] = [];
    const appliedAt = new Date().toISOString();

    for (const [k, v] of Object.entries(headers)) {
      const rule = this.config.headerRules.find(r => r.pattern.test(k));
      if (rule) {
        masked[k] = rule.replacement;
        maskedHeaders.push(k);
      } else {
        masked[k] = v;
      }
    }

    return {
      masked,
      report: { appliedAt, maskedFields: [], maskedHeaders, totalMasked: maskedHeaders.length },
    };
  }

  maskVariables(vars: Record<string, unknown>): { masked: Record<string, unknown>; report: MaskingReport } {
    const masked: Record<string, unknown> = {};
    const maskedFields: string[] = [];
    const appliedAt = new Date().toISOString();

    for (const [k, v] of Object.entries(vars)) {
      const rule = this.config.variableRules.find(r => r.pattern.test(k));
      if (rule) {
        masked[k] = rule.replacement;
        maskedFields.push(k);
      } else {
        masked[k] = v;
      }
    }

    return {
      masked,
      report: { appliedAt, maskedFields, maskedHeaders: [], totalMasked: maskedFields.length },
    };
  }

  maskBodyFields(body: Record<string, unknown>): { masked: Record<string, unknown>; report: MaskingReport } {
    const masked: Record<string, unknown> = {};
    const maskedFields: string[] = [];
    const appliedAt = new Date().toISOString();

    for (const [k, v] of Object.entries(body)) {
      const rule = this.config.bodyFieldRules.find(r => r.pattern.test(k));
      if (rule) {
        masked[k] = rule.replacement;
        maskedFields.push(k);
      } else {
        masked[k] = v;
      }
    }

    return {
      masked,
      report: { appliedAt, maskedFields, maskedHeaders: [], totalMasked: maskedFields.length },
    };
  }

  mergeReports(...reports: MaskingReport[]): MaskingReport {
    const appliedAt = new Date().toISOString();
    const maskedFields = reports.flatMap(r => r.maskedFields);
    const maskedHeaders = reports.flatMap(r => r.maskedHeaders);
    return {
      appliedAt,
      maskedFields,
      maskedHeaders,
      totalMasked: maskedFields.length + maskedHeaders.length,
    };
  }
}

export const globalMaskingPolicy = new ConfigurableMaskingPolicy();
