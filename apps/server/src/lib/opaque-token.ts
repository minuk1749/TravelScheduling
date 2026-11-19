import { createHash, randomBytes } from 'node:crypto';

/** 256-bit random capability, base64url (43 characters). Only its hash is stored. */
export const newOpaqueToken = (): string => randomBytes(32).toString('base64url');
export const isOpaqueToken = (value: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(value);
/** SHA-256 hex; share links and mobile sessions store this instead of the token. */
export const hashOpaqueToken = (token: string): string => createHash('sha256').update(token).digest('hex');
