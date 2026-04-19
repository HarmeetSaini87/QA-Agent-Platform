/**
 * crypto.ts — password hashing helpers
 */

import * as bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Basic password strength: min 8 chars, 1 upper, 1 lower, 1 digit, 1 special */
export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8)              return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password))          return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password))          return 'Password must contain a lowercase letter';
  if (!/\d/.test(password))             return 'Password must contain a digit';
  if (!/[!@#$%^&*()_+\-=\[\]{};':",.<>?]/.test(password))
                                        return 'Password must contain a special character';
  return null;
}
