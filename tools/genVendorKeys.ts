#!/usr/bin/env npx tsx
/**
 * genVendorKeys.ts — One-time RSA-2048 vendor key pair generator (Phase 3)
 *
 * Run ONCE on the vendor's machine. Store vendor-private.pem in a secrets vault.
 * Embed vendor-public.pem (base64) into licenseManager.ts at build time.
 *
 * Usage:
 *   npx tsx tools/genVendorKeys.ts
 *   npx tsx tools/genVendorKeys.ts --out ./keys   (custom output directory)
 *
 * SECURITY:
 *   vendor-private.pem → NEVER commit to git. Store in HashiCorp Vault / AWS Secrets Manager.
 *   vendor-public.pem  → Safe to bundle in app — only used to VERIFY signatures, not create them.
 */

import * as crypto from 'crypto';
import * as fs     from 'fs';
import * as path   from 'path';

const outDir = (() => {
  const idx = process.argv.indexOf('--out');
  return idx !== -1 ? path.resolve(process.argv[idx + 1]) : path.resolve('.');
})();

fs.mkdirSync(outDir, { recursive: true });

console.log('\n=== QA Agent Platform — Vendor RSA Key Generator ===');
console.log('Generating RSA-2048 key pair...');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength:    2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const privPath = path.join(outDir, 'vendor-private.pem');
const pubPath  = path.join(outDir, 'vendor-public.pem');

fs.writeFileSync(privPath, privateKey,  { mode: 0o600 });
fs.writeFileSync(pubPath,  publicKey);

const pubB64 = Buffer.from(publicKey).toString('base64');

console.log(`\nPrivate key: ${privPath}  (mode 600 — DO NOT COMMIT)`);
console.log(`Public key:  ${pubPath}`);
console.log('\n── Embed this base64 in licenseManager.ts (VENDOR_PUBLIC_KEY_B64) ──────────');
console.log(pubB64);
console.log('──────────────────────────────────────────────────────────────────────────────');
console.log('\nNext steps:');
console.log('  1. Store vendor-private.pem in your secrets vault (Vault / AWS Secrets Manager)');
console.log('  2. Copy the base64 above into licenseManager.ts → VENDOR_PUBLIC_KEY_B64 const');
console.log('  3. Delete vendor-private.pem from this machine after storing it securely');
console.log('  4. Issue .lic files with: npx tsx tools/genLicense.ts --lic --privkey ./vendor-private.pem');
console.log('');
