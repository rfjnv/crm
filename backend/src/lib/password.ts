import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { config } from './config';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcrypt.saltRounds);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Hash refresh token with SHA-256 for DB storage */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
