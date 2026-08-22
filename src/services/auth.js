'use strict';

const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { hashPassword, verifyPassword, randomToken } = require('../lib/crypto');

const stmt = {
  countAdmins: db.prepare('SELECT COUNT(*) AS n FROM admins'),
  insertAdmin: db.prepare(
    'INSERT INTO admins (username, password_hash) VALUES (?, ?)',
  ),
  byUsername: db.prepare('SELECT * FROM admins WHERE username = ?'),
  createSession: db.prepare(`
    INSERT INTO admin_sessions (token, admin_id, expires_at)
    VALUES (?, ?, datetime('now', ?))
  `),
  findSession: db.prepare(`
    SELECT s.token, s.expires_at, a.id AS admin_id, a.username
    FROM admin_sessions s
    JOIN admins a ON a.id = s.admin_id
    WHERE s.token = ? AND s.expires_at > datetime('now')
  `),
  deleteSession: db.prepare('DELETE FROM admin_sessions WHERE token = ?'),
  purgeSessions: db.prepare(
    "DELETE FROM admin_sessions WHERE expires_at <= datetime('now')",
  ),
  updatePassword: db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?'),
  deleteSessionsForAdmin: db.prepare(
    'DELETE FROM admin_sessions WHERE admin_id = ?',
  ),
};

/**
 * Create the first admin on an empty database. If no password was supplied we
 * generate a strong one and print it once — better than shipping a default
 * credential that nobody ever changes.
 */
function bootstrapAdmin() {
  if (stmt.countAdmins.get().n > 0) return null;

  const username = config.bootstrapAdmin.username || 'admin';
  const supplied = config.bootstrapAdmin.password;
  const generated = supplied ? null : crypto.randomBytes(12).toString('base64url');
  const password = supplied || generated;

  stmt.insertAdmin.run(username, hashPassword(password));

  return { username, password, generated: !supplied };
}

function login(username, password) {
  const admin = stmt.byUsername.get(String(username ?? '').trim());

  // Always run a hash comparison so a missing user and a wrong password take
  // roughly the same time; avoids trivial username enumeration.
  const hash = admin
    ? admin.password_hash
    : 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';
  const ok = verifyPassword(String(password ?? ''), hash);
  if (!ok || !admin) return null;

  const token = randomToken(32);
  stmt.createSession.run(token, admin.id, `+${config.adminSessionHours} hours`);
  return { token, admin: { id: admin.id, username: admin.username } };
}

function resolveSession(token) {
  if (!token) return null;
  const row = stmt.findSession.get(token);
  if (!row) return null;
  return { token: row.token, id: row.admin_id, username: row.username };
}

function logout(token) {
  if (token) stmt.deleteSession.run(token);
}

function changePassword(adminId, newPassword) {
  stmt.updatePassword.run(hashPassword(newPassword), adminId);
  stmt.deleteSessionsForAdmin.run(adminId);
}

function purgeExpiredSessions() {
  stmt.purgeSessions.run();
}

module.exports = {
  bootstrapAdmin,
  changePassword,
  login,
  logout,
  purgeExpiredSessions,
  resolveSession,
};
