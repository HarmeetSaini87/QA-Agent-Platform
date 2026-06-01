// src/api-security/contracts/compliance-vault.contracts.ts
// Phase E Step 4: Future enterprise secret vault extension points (SOC2, ISO, Azure Key Vault, HashiCorp Vault).

export interface ISecretVault {
  getSecret(secretId: string): Promise<string | null>;
  setSecret(secretId: string, value: string): Promise<void>;
  deleteSecret(secretId: string): Promise<void>;
  listSecretIds(): Promise<string[]>;
}

export interface IAzureKeyVaultProvider extends ISecretVault {
  readonly vaultUri: string;
  readonly clientId: string;
}

export interface IHashiCorpVaultProvider extends ISecretVault {
  readonly vaultAddr: string;
  readonly mountPath: string;
}

/** No-op stub — wired when a real vault is configured. */
export class NoOpSecretVault implements ISecretVault {
  async getSecret(_secretId: string): Promise<string | null> { return null; }
  async setSecret(_secretId: string, _value: string): Promise<void> { /* no-op */ }
  async deleteSecret(_secretId: string): Promise<void> { /* no-op */ }
  async listSecretIds(): Promise<string[]> { return []; }
}
