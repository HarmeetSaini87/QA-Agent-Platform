// src/api-security/contracts/masking-policy.contracts.ts
// Phase E Step 4: Configurable masking policy contracts.

export interface MaskingRule {
  readonly pattern: RegExp;
  readonly replacement: string;
  readonly description: string;
}

export interface MaskingConfig {
  readonly maskToken: string;
  readonly headerRules: MaskingRule[];
  readonly variableRules: MaskingRule[];
  readonly bodyFieldRules: MaskingRule[];
  /** If true, mask values in replay event payloads. */
  readonly maskReplayPayloads: boolean;
  /** If true, mask values in AI overlay data. */
  readonly maskAiOverlays: boolean;
}

export interface MaskingReport {
  readonly appliedAt: string;
  readonly maskedFields: string[];
  readonly maskedHeaders: string[];
  readonly totalMasked: number;
}

export interface IMaskingPolicy {
  readonly config: MaskingConfig;
  maskHeaders(headers: Record<string, string>): { masked: Record<string, string>; report: MaskingReport };
  maskVariables(vars: Record<string, unknown>): { masked: Record<string, unknown>; report: MaskingReport };
  maskBodyFields(body: Record<string, unknown>): { masked: Record<string, unknown>; report: MaskingReport };
  /** Merge multiple reports into one summary. */
  mergeReports(...reports: MaskingReport[]): MaskingReport;
}
