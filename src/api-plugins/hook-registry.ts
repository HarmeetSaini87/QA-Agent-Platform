// src/api-plugins/hook-registry.ts
// Phase E Step 8: Hook registry — priority-ordered, determinism-safe hook execution.
// Hooks annotate/enrich. They NEVER reorder execution, alter retries, or mutate DAG.

import { randomUUID } from 'crypto';
import type {
  IHookRegistry,
  HookRegistration,
  HookType,
} from './contracts/runtime-hooks.contracts';

const ADVISORY = 'Hooks are observational/enrichment only. Execution order, retries, and DAG are unaffected.';

export class HookRegistry implements IHookRegistry {
  private readonly _hooks = new Map<string, HookRegistration>();

  registerHook(registration: HookRegistration): void {
    this._hooks.set(registration.hookId, registration);
  }

  unregisterHook(hookId: string): boolean {
    return this._hooks.delete(hookId);
  }

  listHooks(hookType: HookType, pluginId?: string): HookRegistration[] {
    let hooks = Array.from(this._hooks.values()).filter(h => h.hookType === hookType);
    if (pluginId) hooks = hooks.filter(h => h.pluginId === pluginId);
    return hooks.sort((a, b) => a.priority - b.priority);
  }

  executeHooks<I, O>(
    hookType: HookType,
    input: I,
    executor: (hookId: string, input: I) => O | null,
  ): O[] {
    const ordered = this.listHooks(hookType);
    const results: O[] = [];
    for (const hook of ordered) {
      try {
        const result = executor(hook.hookId, input);
        if (result !== null && result !== undefined) results.push(result);
      } catch {
        // Hook failures are silent — never propagate to execution runtime
      }
    }
    return results;
  }

  readonly advisoryNote = ADVISORY;
}

export function makeHookRegistration(pluginId: string, hookType: HookType, priority = 50): HookRegistration {
  return {
    hookId: randomUUID(),
    pluginId,
    hookType,
    priority,
    registeredAt: new Date().toISOString(),
  };
}

export const globalHookRegistry = new HookRegistry();
