import * as bcrypt from 'bcryptjs';

/**
 * PLAN.md "Sorted-owned rider fleet" — the client-held pickup-verification
 * code, same shape/discipline as identity.service.ts's password-reset code
 * (never store the raw value, bcrypt hash + expiry). Shared between
 * SortedFleetDeliveryService (generates the plaintext once, at assignment)
 * and DeliveryService/RiderService (hash it for storage, verify it later)
 * so neither duplicates the bcrypt rounds or TTL.
 */
const BCRYPT_ROUNDS = 12;
export const PICKUP_CODE_TTL_MS = 24 * 60 * 60 * 1000;

export function generateSixDigitCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashPickupCode(code: string): Promise<string> {
  return bcrypt.hash(code, BCRYPT_ROUNDS);
}

export function comparePickupCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}
