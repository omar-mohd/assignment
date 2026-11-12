// Lightweight auth: seeded users, scrypt password hashes, signed JWT in an httpOnly cookie.
// Deliberately not production identity (no signup, reset, SSO) — see ARCHITECTURE.md.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { HttpError } from './errors.js';

export const COOKIE_NAME = 'ajaia_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function signSession(user, secret) {
  return jwt.sign({ sub: user.id }, secret, { expiresIn: '7d' });
}

export function cookieOptions(isProd) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

// Attaches req.user or responds 401.
export function requireAuth(db, secret) {
  return async (req, _res, next) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) throw new HttpError(401, 'Not signed in');
    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch {
      throw new HttpError(401, 'Session expired, please sign in again');
    }
    const { rows } = await db.query('SELECT id, email, name FROM users WHERE id = $1', [payload.sub]);
    if (!rows[0]) throw new HttpError(401, 'Not signed in');
    req.user = rows[0];
    next();
  };
}
