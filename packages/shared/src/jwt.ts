import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { AuthToken, UserRole } from './types.js';

const JWT_SECRET = process.env.JWT_SECRET || 'truckmafia-dev-secret-change-in-production';

export function signToken(payload: AuthToken): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

export function verifyToken(token: string): AuthToken | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthToken;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function comparePassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function extractToken(authHeader?: string): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export function authFromHeader(authHeader?: string): AuthToken | null {
  const token = extractToken(authHeader);
  if (!token) return null;
  return verifyToken(token);
}

export function requireRole(auth: AuthToken | null, ...roles: UserRole[]): AuthToken {
  if (!auth) throw new Error('Unauthorized');
  if (roles.length > 0 && !roles.includes(auth.role)) throw new Error('Forbidden');
  return auth;
}
