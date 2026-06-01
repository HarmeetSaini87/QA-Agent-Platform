// src/api-plugins/contracts/marketplace-readiness.contracts.ts
// Phase E Step 8: Future marketplace / integration catalog extension points. Stubs only.

export interface MarketplacePluginListing {
  readonly listingId: string;
  readonly pluginId: string;
  readonly category: string;
  readonly publisher: string;
  readonly installCount: number;
  readonly verified: boolean;
}

export interface WorkflowPack {
  readonly packId: string;
  readonly name: string;
  readonly collectionTemplates: readonly string[];
  readonly description: string;
}

export interface IPluginMarketplace {
  /** Search the plugin catalog (stub). */
  search(query: string, category?: string): MarketplacePluginListing[];
  /** Install a plugin from the catalog (stub). */
  install(listingId: string, tenantId?: string): Promise<{ installed: boolean; pluginId?: string }>;
  /** List available workflow packs (stub). */
  listWorkflowPacks(): WorkflowPack[];
}

export class NoOpPluginMarketplace implements IPluginMarketplace {
  search(_query: string, _category?: string): MarketplacePluginListing[] { return []; }
  async install(_listingId: string, _tenantId?: string) { return { installed: false }; }
  listWorkflowPacks(): WorkflowPack[] { return []; }
}
