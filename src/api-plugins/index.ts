// src/api-plugins/index.ts
// Phase E Step 8: Enterprise Plugin Ecosystem, SDK Extensibility & Integration Marketplace Foundation.

export * from './contracts/plugin-manifest.contracts';
export * from './contracts/runtime-hooks.contracts';
export * from './contracts/plugin-isolation.contracts';
export * from './contracts/sdk-extension.contracts';
export * from './contracts/marketplace-readiness.contracts';

export { PluginRegistry, globalPluginRegistry } from './plugin-registry';
export { HookRegistry, makeHookRegistration, globalHookRegistry } from './hook-registry';
export { PluginSecurityGuard, globalPluginSecurityGuard } from './plugin-security-guard';
export { SdkAccessLayer, globalSdkAccessLayer } from './sdk-access-layer';
export { registerPluginRoutes } from './routes/plugins.routes';
