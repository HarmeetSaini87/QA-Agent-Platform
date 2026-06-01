// src/api-plugins/__tests__/hook-registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { HookRegistry, makeHookRegistration } from '../hook-registry';

describe('HookRegistry', () => {
  let registry: HookRegistry;
  beforeEach(() => { registry = new HookRegistry(); });

  it('registerHook + listHooks: returns registered hooks', () => {
    registry.registerHook(makeHookRegistration('p1', 'before-request', 10));
    const hooks = registry.listHooks('before-request');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].pluginId).toBe('p1');
  });

  it('listHooks: sorted by priority ascending', () => {
    registry.registerHook(makeHookRegistration('p1', 'after-response', 50));
    registry.registerHook(makeHookRegistration('p2', 'after-response', 10));
    const hooks = registry.listHooks('after-response');
    expect(hooks[0].pluginId).toBe('p2');  // priority 10 first
  });

  it('listHooks: filters by pluginId', () => {
    registry.registerHook(makeHookRegistration('p1', 'assertion', 10));
    registry.registerHook(makeHookRegistration('p2', 'assertion', 20));
    expect(registry.listHooks('assertion', 'p1')).toHaveLength(1);
  });

  it('unregisterHook: removes hook', () => {
    const reg = makeHookRegistration('p1', 'replay-enricher', 10);
    registry.registerHook(reg);
    expect(registry.unregisterHook(reg.hookId)).toBe(true);
    expect(registry.listHooks('replay-enricher')).toHaveLength(0);
  });

  it('executeHooks: collects non-null results in priority order', () => {
    registry.registerHook(makeHookRegistration('p1', 'before-request', 20));
    registry.registerHook(makeHookRegistration('p2', 'before-request', 10));
    const results = registry.executeHooks('before-request', {}, (hookId) => ({ hookId }));
    expect(results).toHaveLength(2);
    // p2 (priority 10) should be first
    expect(results[0].hookId).toBe(registry.listHooks('before-request')[0].hookId);
  });

  it('executeHooks: hook failures are swallowed, other hooks still run', () => {
    registry.registerHook(makeHookRegistration('p1', 'analytics-enricher', 10));
    registry.registerHook(makeHookRegistration('p2', 'analytics-enricher', 20));
    const results = registry.executeHooks('analytics-enricher', {}, (hookId) => {
      if (hookId === registry.listHooks('analytics-enricher')[0].hookId) throw new Error('boom');
      return { ok: true };
    });
    expect(results).toHaveLength(1);
  });
});
