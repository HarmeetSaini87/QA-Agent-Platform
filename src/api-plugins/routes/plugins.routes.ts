// src/api-plugins/routes/plugins.routes.ts
// Phase E Step 8: Plugin ecosystem REST endpoints.

import type { Express, Request, Response } from 'express';
import { globalPluginRegistry } from '../plugin-registry';
import { globalHookRegistry, makeHookRegistration } from '../hook-registry';
import { globalPluginSecurityGuard } from '../plugin-security-guard';
import { globalSdkAccessLayer } from '../sdk-access-layer';
import type { PluginManifest, PluginCapability, PluginStatus } from '../contracts/plugin-manifest.contracts';
import type { HookType } from '../contracts/runtime-hooks.contracts';
import { CUSTOM_BEARER_AUTH_PLUGIN_ID, CUSTOM_BEARER_AUTH_USAGE, customBearerAuthManifest } from '../examples/custom-bearer-auth.plugin';
import { CUSTOM_JSON_ASSERTION_PLUGIN_ID, CUSTOM_JSON_ASSERTION_USAGE, customJsonAssertionManifest } from '../examples/custom-json-assertion.plugin';

export function registerPluginRoutes(app: Express): void {

  // GET /api/plugins — list plugins with optional filters
  app.get('/api/plugins', (req: Request, res: Response) => {
    const { capability, tenantId, status } = req.query as { capability?: string; tenantId?: string; status?: string };
    const plugins = globalPluginRegistry.list({
      ...(capability && { capability: capability as PluginCapability }),
      ...(tenantId && { tenantId }),
      ...(status && { status: status as PluginStatus }),
    });
    res.json({ plugins, count: plugins.length });
  });

  // POST /api/plugins — register a plugin
  app.post('/api/plugins', (req: Request, res: Response) => {
    const body = req.body as Partial<PluginManifest>;
    if (!body.pluginId || !body.name || !Array.isArray(body.capabilities)) {
      res.status(400).json({ error: 'pluginId, name, capabilities required' });
      return;
    }
    const manifest: PluginManifest = {
      pluginId: body.pluginId,
      name: body.name,
      version: body.version ?? '1.0.0',
      author: body.author ?? 'unknown',
      capabilities: body.capabilities as PluginCapability[],
      isolationTier: body.isolationTier ?? 'read-only',
      requiredRoles: body.requiredRoles ?? ['admin'],
      tenantId: body.tenantId,
      description: body.description ?? '',
      registeredAt: new Date().toISOString(),
    };
    const reg = globalPluginRegistry.register(manifest);
    res.status(201).json(reg);
  });

  // GET /api/plugins/:pluginId — get plugin details
  // GET /api/plugins/examples — MUST be before /:pluginId to avoid "examples" matching as pluginId
  app.get('/api/plugins/examples', (_req: Request, res: Response) => {
    res.json({
      examples: [
        {
          pluginId: CUSTOM_BEARER_AUTH_PLUGIN_ID,
          name: customBearerAuthManifest.name,
          description: customBearerAuthManifest.description,
          capabilities: customBearerAuthManifest.capabilities,
          manifest: customBearerAuthManifest,
          usage: CUSTOM_BEARER_AUTH_USAGE,
        },
        {
          pluginId: CUSTOM_JSON_ASSERTION_PLUGIN_ID,
          name: customJsonAssertionManifest.name,
          description: customJsonAssertionManifest.description,
          capabilities: customJsonAssertionManifest.capabilities,
          manifest: customJsonAssertionManifest,
          usage: CUSTOM_JSON_ASSERTION_USAGE,
        },
      ],
      note: 'Register examples via loadExamplePlugins() from src/api-plugins/index.ts. Never auto-registered.',
    });
  });

  // GET /api/plugins/sdk/workflow/:collectionId — MUST be before /:pluginId
  app.get('/api/plugins/sdk/workflow/:collectionId', (req: Request, res: Response) => {
    const { collectionId } = req.params as { collectionId: string };
    const info = globalSdkAccessLayer.getWorkflowInfo(collectionId);
    if (!info) { res.status(404).json({ error: 'Collection not found.' }); return; }
    res.json(info);
  });

  app.get('/api/plugins/:pluginId', (req: Request, res: Response) => {
    const { pluginId } = req.params as { pluginId: string };
    const reg = globalPluginRegistry.get(pluginId);
    if (!reg) { res.status(404).json({ error: 'Plugin not found.' }); return; }
    res.json(reg);
  });

  // POST /api/plugins/:pluginId/enable — enable a plugin
  app.post('/api/plugins/:pluginId/enable', (req: Request, res: Response) => {
    const { pluginId } = req.params as { pluginId: string };
    const ok = globalPluginRegistry.enable(pluginId);
    if (!ok) { res.status(404).json({ error: 'Plugin not found.' }); return; }
    res.json({ enabled: true, pluginId });
  });

  // POST /api/plugins/:pluginId/disable — disable a plugin
  app.post('/api/plugins/:pluginId/disable', (req: Request, res: Response) => {
    const { pluginId } = req.params as { pluginId: string };
    const { reason } = req.body as { reason?: string };
    const ok = globalPluginRegistry.disable(pluginId, reason);
    if (!ok) { res.status(404).json({ error: 'Plugin not found.' }); return; }
    res.json({ disabled: true, pluginId });
  });

  // POST /api/plugins/:pluginId/hooks — register a hook for a plugin
  app.post('/api/plugins/:pluginId/hooks', (req: Request, res: Response) => {
    const { pluginId } = req.params as { pluginId: string };
    const { hookType, priority } = req.body as { hookType?: string; priority?: number };
    if (!hookType) { res.status(400).json({ error: 'hookType required' }); return; }
    const reg = makeHookRegistration(pluginId, hookType as HookType, priority);
    globalHookRegistry.registerHook(reg);
    res.status(201).json(reg);
  });

  // GET /api/plugins/hooks/:hookType — list hooks of a given type
  app.get('/api/plugins/hooks/:hookType', (req: Request, res: Response) => {
    const { hookType } = req.params as { hookType: string };
    const hooks = globalHookRegistry.listHooks(hookType as HookType);
    res.json({ hookType, hooks, count: hooks.length });
  });

  // POST /api/plugins/:pluginId/check-permission — check plugin permission
  app.post('/api/plugins/:pluginId/check-permission', (req: Request, res: Response) => {
    const { pluginId } = req.params as { pluginId: string };
    const { actorRole, tenantId, capability } = req.body as { actorRole?: string; tenantId?: string; capability?: string };
    if (!actorRole || !capability) { res.status(400).json({ error: 'actorRole and capability required' }); return; }
    const context = globalPluginSecurityGuard.createContext(pluginId, actorRole, tenantId);
    const result = globalPluginSecurityGuard.checkPermission(context, capability);
    res.json(result);
  });

}
