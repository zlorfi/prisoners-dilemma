'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

/**
 * The session secret must survive restarts, otherwise every admin gets logged
 * out and — more importantly — every voter's device cookie becomes
 * unverifiable, which would let people vote twice. So if it is not supplied
 * via the environment we generate one and persist it next to the database.
 */
function resolveSessionSecret() {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.trim().length >= 16) return fromEnv.trim();

  const secretFile = path.join(dataDir, '.session-secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    /* falls through to generation */
  }

  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(secretFile, generated, { mode: 0o600 });
  return generated;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  dataDir,
  databaseFile: path.join(dataDir, 'dilemma.sqlite'),
  sessionSecret: resolveSessionSecret(),
  publicOrigin: (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, ''),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  nameReservationMinutes: int(process.env.NAME_RESERVATION_MINUTES, 45),
  adminSessionHours: 12,
  bootstrapAdmin: {
    username: (process.env.ADMIN_USERNAME || 'admin').trim(),
    password: process.env.ADMIN_PASSWORD || '',
  },
  cookies: {
    admin: 'pd_admin',
    voter: 'pd_voter',
    csrf: 'pd_csrf',
  },
};
