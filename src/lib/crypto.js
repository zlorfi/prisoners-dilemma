'use strict';

const crypto = require('node:crypto');
const config = require('../config');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hash a password with scrypt. Format: scrypt$N$r$p$salt$hash (all base64). */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const { N, r, p, keylen } = SCRYPT_PARAMS;
  const derived = crypto.scryptSync(password, salt, keylen, { N, r, p });
  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** Constant-time password verification. Never throws on malformed input. */
function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function hmac(value) {
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(String(value))
    .digest('base64url');
}

/**
 * Sign a value so we can detect tampering when it comes back from a cookie.
 * We deliberately do not use a cookie-signing library: this keeps the
 * dependency surface small and the format obvious.
 */
function sign(value) {
  return `${value}.${hmac(value)}`;
}

function unsign(signed) {
  if (typeof signed !== 'string') return null;
  const index = signed.lastIndexOf('.');
  if (index <= 0) return null;
  const value = signed.slice(0, index);
  const mac = signed.slice(index + 1);
  const expected = hmac(value);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? value : null;
}

/** Pseudonymised IP, only used as a weak secondary signal in the admin view. */
function hashIp(ip) {
  if (!ip) return null;
  return crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`ip:${ip}`)
    .digest('hex')
    .slice(0, 32);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = {
  hashPassword,
  verifyPassword,
  randomToken,
  sign,
  unsign,
  hashIp,
  safeEqual,
};
