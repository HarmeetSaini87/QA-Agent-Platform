// src/api-plugins/contracts/runtime-hooks.contracts.ts
// Phase E Step 8: Controlled runtime hooks — enrichment only, never alter execution order or retries.

export interface HookContext {
  readonly pluginId: string;
  readonly runId: string;
  readonly collectionId: string;
  readonly stepId: string;
  readonly tenantId?: string;
  readonly triggeredAt: string;
}

/** Before-request hook: may annotate context, never mutate request. */
export interface BeforeRequestHookInput {
  readonly context: HookContext;
  readonly requestUrl: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
}

export interface BeforeRequestHookOutput {
  readonly annotations: Record<string, unknown>;
  readonly advisoryNote?: string;
}

/** After-response hook: observes response, may enrich analytics/replay annotations. */
export interface AfterResponseHookInput {
  readonly context: HookContext;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly bodySnippet?: string;
}

export interface AfterResponseHookOutput {
  readonly annotations: Record<string, unknown>;
  readonly advisoryNote?: string;
}

/** Assertion hook: custom pass/fail evaluation. Supplements — never replaces — built-in assertions. */
export interface AssertionHookInput {
  readonly context: HookContext;
  readonly assertionType: string;
  readonly expected: unknown;
  readonly actual: unknown;
}

export interface AssertionHookOutput {
  readonly passed: boolean;
  readonly message: string;
  readonly advisoryNote?: string;
}

export type HookType = 'before-request' | 'after-response' | 'assertion' | 'replay-enricher' | 'analytics-enricher' | 'graph-overlay-enricher';

export interface HookRegistration {
  readonly hookId: string;
  readonly pluginId: string;
  readonly hookType: HookType;
  readonly priority: number;   // lower = runs first
  readonly registeredAt: string;
}

export interface IHookRegistry {
  registerHook(registration: HookRegistration): void;
  unregisterHook(hookId: string): boolean;
  listHooks(hookType: HookType, pluginId?: string): HookRegistration[];
  /** Execute all hooks of a type in priority order. Determinism-safe: hooks annotate, never reorder. */
  executeHooks<I, O>(hookType: HookType, input: I, executor: (hookId: string, input: I) => O | null): O[];
}
