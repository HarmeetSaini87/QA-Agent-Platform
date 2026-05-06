import { encryptValue, decryptValue } from '../ui/helpers/encryption';
import type { ApiVariable } from '../data/types';

export function encryptSensitiveVars(vars: ApiVariable[]): ApiVariable[] {
  return vars.map(v => v.sensitive ? { ...v, value: encryptValue(v.value) } : v);
}

export function decryptSensitiveVars(vars: ApiVariable[]): ApiVariable[] {
  return vars.map(v => v.sensitive ? { ...v, value: decryptValue(v.value) } : v);
}
