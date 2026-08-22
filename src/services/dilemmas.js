'use strict';

const db = require('../db');
const config = require('../config');
const { generateSlug } = require('../lib/slug');
const { NAME_POOL, POOL_KEYS, nameKey, cleanName } = require('../lib/names');
const { hashIp } = require('../lib/crypto');
const { resolve } = require('../lib/resolution');
const events = require('../lib/events');

/* ------------------------------------------------------------------ *
 * Prepared statements
 * ------------------------------------------------------------------ */

const stmt = {
  insertDilemma: db.prepare(`
    INSERT INTO dilemmas (slug, title, description, created_by)
    VALUES (@slug, @title, @description, @createdBy)
  `),
  bySlug: db.prepare('SELECT * FROM dilemmas WHERE slug = ?'),
  byId: db.prepare('SELECT * FROM dilemmas WHERE id = ?'),
  maxId: db.prepare('SELECT MAX(id) AS id FROM dilemmas'),
  titleExists: db.prepare(
    'SELECT 1 FROM dilemmas WHERE title = ? COLLATE NOCASE',
  ),
  listAll: db.prepare(`
    SELECT d.*,
           COUNT(v.id)                                          AS total,
           SUM(CASE WHEN v.choice = 'silence' THEN 1 ELSE 0 END) AS silence,
           SUM(CASE WHEN v.choice = 'snitch'  THEN 1 ELSE 0 END) AS snitch,
           MAX(v.created_at)                                     AS last_vote_at
    FROM dilemmas d
    LEFT JOIN votes v ON v.dilemma_id = d.id
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `),
  tally: db.prepare(`
    SELECT COUNT(*)                                            AS total,
           SUM(CASE WHEN choice = 'silence' THEN 1 ELSE 0 END) AS silence,
           SUM(CASE WHEN choice = 'snitch'  THEN 1 ELSE 0 END) AS snitch,
           MAX(created_at)                                     AS last_vote_at
    FROM votes WHERE dilemma_id = ?
  `),
  votesFor: db.prepare(`
    SELECT id, display_name, choice, created_at
    FROM votes WHERE dilemma_id = ?
    ORDER BY created_at DESC, id DESC
  `),
  voteByToken: db.prepare(
    'SELECT * FROM votes WHERE dilemma_id = ? AND voter_token = ?',
  ),
  insertVote: db.prepare(`
    INSERT INTO votes
      (dilemma_id, voter_token, display_name, name_key, choice, ip_hash, user_agent)
    VALUES
      (@dilemmaId, @voterToken, @displayName, @nameKey, @choice, @ipHash, @userAgent)
  `),
  takenNameKeys: db.prepare('SELECT name_key FROM votes WHERE dilemma_id = ?'),
  nameTaken: db.prepare(
    'SELECT 1 FROM votes WHERE dilemma_id = ? AND name_key = ?',
  ),
  setStatus: db.prepare(
    'UPDATE dilemmas SET status = ?, closed_at = ? WHERE id = ?',
  ),
  deleteDilemma: db.prepare('DELETE FROM dilemmas WHERE id = ?'),
  resetVotes: db.prepare('DELETE FROM votes WHERE dilemma_id = ?'),
  clearReservations: db.prepare(
    'DELETE FROM name_reservations WHERE dilemma_id = ?',
  ),

  // --- reservations ---
  purgeExpired: db.prepare(
    "DELETE FROM name_reservations WHERE expires_at <= datetime('now')",
  ),
  reservationForVoter: db.prepare(`
    SELECT * FROM name_reservations
    WHERE dilemma_id = ? AND voter_token = ? AND expires_at > datetime('now')
  `),
  activeReservationKeys: db.prepare(`
    SELECT name_key FROM name_reservations
    WHERE dilemma_id = ? AND expires_at > datetime('now')
  `),
  reserve: db.prepare(`
    INSERT INTO name_reservations (dilemma_id, name_key, voter_token, expires_at)
    VALUES (@dilemmaId, @nameKey, @voterToken, datetime('now', @ttl))
    ON CONFLICT(dilemma_id, name_key) DO UPDATE SET
      voter_token = excluded.voter_token,
      expires_at  = excluded.expires_at
    WHERE name_reservations.voter_token = excluded.voter_token
       OR name_reservations.expires_at <= datetime('now')
  `),
  dropVoterReservations: db.prepare(
    'DELETE FROM name_reservations WHERE dilemma_id = ? AND voter_token = ?',
  ),
};

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

function getBySlug(slug) {
  return stmt.bySlug.get(slug) || null;
}

function getById(id) {
  return stmt.byId.get(id) || null;
}

function normaliseTally(row) {
  return {
    total: row?.total ?? 0,
    silence: row?.silence ?? 0,
    snitch: row?.snitch ?? 0,
    lastVoteAt: row?.last_vote_at ?? null,
  };
}

function getTally(dilemmaId) {
  return normaliseTally(stmt.tally.get(dilemmaId));
}

function listForAdmin() {
  return stmt.listAll.all().map((row) => ({
    ...row,
    total: row.total ?? 0,
    silence: row.silence ?? 0,
    snitch: row.snitch ?? 0,
  }));
}

function getVotes(dilemmaId) {
  return stmt.votesFor.all(dilemmaId);
}

function getVoteByToken(dilemmaId, voterToken) {
  return stmt.voteByToken.get(dilemmaId, voterToken) || null;
}

/**
 * Damage resolution for a dilemma, or null while it is still open.
 *
 * The card resolves once every opponent has chosen. There is no fixed player
 * count here, so closing the voting is what marks "all votes are in" — that
 * keeps the result from flickering between branches as people trickle in.
 */
function getResolution(dilemma) {
  if (!dilemma || dilemma.status !== 'closed') return null;
  const votes = getVotes(dilemma.id);
  // A closed room with nothing in it has no verdict to show. Without this a
  // freshly reset dilemma would render an empty "0 damage" result card.
  if (votes.length === 0) return null;
  return resolve(votes);
}

/** Everything an admin view or SSE payload needs, in one shot. */
function getSnapshot(dilemmaId) {
  const dilemma = getById(dilemmaId);
  return {
    tally: getTally(dilemmaId),
    votes: getVotes(dilemmaId),
    remainingNames: remainingNameCount(dilemmaId),
    resolution: getResolution(dilemma),
  };
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

function createDilemma({ title, description, createdBy }) {
  // Slugs are random; on the astronomically unlikely collision, just retry.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = generateSlug();
    try {
      const info = stmt.insertDilemma.run({
        slug,
        title: cleanTitle(title),
        description: cleanDescription(description),
        createdBy: createdBy ?? null,
      });
      return getById(info.lastInsertRowid);
    } catch (err) {
      if (err.code !== 'SQLITE_CONSTRAINT_UNIQUE') throw err;
    }
  }
  throw new Error('Could not allocate a unique slug');
}

function cleanTitle(title) {
  const value = String(title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return value || nextDefaultTitle();
}

/**
 * Default title for a new dilemma: "Game X", where X is the highest existing
 * id plus one.
 *
 * Ids are not reused after a delete, so this is a running counter rather than
 * a count of current rows. It is only a suggested label though — nothing keys
 * off it, and the admin is free to overwrite it. If that exact name is already
 * taken (easy to hit by typing "Game 3" by hand) we walk forward to the first
 * free number so two rooms don't end up sharing a label.
 */
function nextDefaultTitle() {
  const maxId = stmt.maxId.get()?.id ?? 0;
  let n = maxId + 1;
  while (stmt.titleExists.get(`Game ${n}`)) n += 1;
  return `Game ${n}`;
}

function cleanDescription(description) {
  return String(description ?? '').trim().slice(0, 1000);
}

function setStatus(dilemmaId, status) {
  const closedAt = status === 'closed' ? new Date().toISOString() : null;
  stmt.setStatus.run(status, closedAt, dilemmaId);
  publishUpdate(dilemmaId, 'status');
  return getById(dilemmaId);
}

/**
 * Wipe every vote and start the round over.
 *
 * This also reopens the room: a reset dilemma that stayed closed would be a
 * dead end — no votes, no verdict, and nobody able to submit anything.
 */
function resetVotes(dilemmaId) {
  db.transaction(() => {
    stmt.resetVotes.run(dilemmaId);
    stmt.clearReservations.run(dilemmaId);
    stmt.setStatus.run('open', null, dilemmaId);
  })();
  publishUpdate(dilemmaId, 'reset');
}

function deleteDilemma(dilemmaId) {
  stmt.deleteDilemma.run(dilemmaId);
  events.publish(dilemmaId, { type: 'deleted' });
}

function publishUpdate(dilemmaId, type = 'update') {
  const dilemma = getById(dilemmaId);
  if (!dilemma) return;
  events.publish(dilemmaId, {
    type,
    status: dilemma.status,
    ...getSnapshot(dilemmaId),
  });
}

/* ------------------------------------------------------------------ *
 * Name pool handling
 * ------------------------------------------------------------------ */

function takenKeys(dilemmaId) {
  return new Set(stmt.takenNameKeys.all(dilemmaId).map((r) => r.name_key));
}

function remainingNameCount(dilemmaId) {
  const used = takenKeys(dilemmaId);
  let free = 0;
  for (const key of POOL_KEYS.keys()) if (!used.has(key)) free += 1;
  return free;
}

function isNameTaken(dilemmaId, key) {
  return !!stmt.nameTaken.get(dilemmaId, key);
}

/**
 * Hand a visitor an alias and hold it for them.
 *
 * Priority:
 *   1. a reservation this very visitor already holds (page reload keeps the
 *      same name instead of shuffling it on every refresh),
 *   2. a random name that is neither already used nor reserved by someone else,
 *   3. a random unused name if every free one happens to be reserved,
 *   4. null when the pool is genuinely exhausted — the UI then asks the
 *      visitor to type their own.
 *
 * With `forceNew` the visitor's own hold is skipped and released, which is
 * what the "give me another alias" button needs.
 */
function suggestName(dilemmaId, voterToken, { forceNew = false } = {}) {
  stmt.purgeExpired.run();

  const previousKey = forceNew
    ? stmt.reservationForVoter.get(dilemmaId, voterToken)?.name_key ?? null
    : null;
  if (forceNew) stmt.dropVoterReservations.run(dilemmaId, voterToken);

  const existing = forceNew
    ? null
    : stmt.reservationForVoter.get(dilemmaId, voterToken);
  if (existing && !isNameTaken(dilemmaId, existing.name_key)) {
    const display = POOL_KEYS.get(existing.name_key);
    if (display) {
      // Refresh the hold so an idle-but-present visitor does not lose it.
      stmt.reserve.run({
        dilemmaId,
        nameKey: existing.name_key,
        voterToken,
        ttl: `+${config.nameReservationMinutes} minutes`,
      });
      return display;
    }
  }

  const used = takenKeys(dilemmaId);
  const reserved = new Set(
    stmt.activeReservationKeys.all(dilemmaId).map((r) => r.name_key),
  );

  const free = [];
  const freeButReserved = [];
  for (const [key, display] of POOL_KEYS) {
    if (used.has(key)) continue;
    // On a reroll, don't hand back the alias they just rejected — unless it
    // is the only one left, which the fallback below takes care of.
    if (key === previousKey) continue;
    if (reserved.has(key)) freeButReserved.push([key, display]);
    else free.push([key, display]);
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  let candidate = free.length ? pick(free) : pick(freeButReserved);

  // Pool down to a single free alias and it happens to be the rejected one.
  if (!candidate && previousKey && !used.has(previousKey)) {
    candidate = [previousKey, POOL_KEYS.get(previousKey)];
  }
  if (!candidate) return null;

  const [key, display] = candidate;
  stmt.dropVoterReservations.run(dilemmaId, voterToken);
  stmt.reserve.run({
    dilemmaId,
    nameKey: key,
    voterToken,
    ttl: `+${config.nameReservationMinutes} minutes`,
  });
  return display;
}

/* ------------------------------------------------------------------ *
 * Voting
 * ------------------------------------------------------------------ */

class VoteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const VALID_CHOICES = new Set(['silence', 'snitch']);

/**
 * Record a vote. Uniqueness of both the device token and the chosen name is
 * enforced by unique indexes, so two concurrent requests cannot slip past the
 * checks — we catch the constraint violation and map it to a friendly error.
 */
function castVote({ dilemma, voterToken, name, choice, ip, userAgent }) {
  if (!VALID_CHOICES.has(choice)) {
    throw new VoteError('bad_choice', 'Pick either "silence" or "snitch".');
  }
  if (dilemma.status !== 'open') {
    throw new VoteError('closed', 'This dilemma is closed. No more votes.');
  }

  const displayName = cleanName(name);
  if (displayName.length < 2) {
    throw new VoteError('bad_name', 'Please enter a name (at least 2 characters).');
  }
  const key = nameKey(displayName);
  if (!key) {
    throw new VoteError('bad_name', 'That name contains no usable characters.');
  }

  if (getVoteByToken(dilemma.id, voterToken)) {
    throw new VoteError('already_voted', 'You have already voted on this dilemma.');
  }
  if (isNameTaken(dilemma.id, key)) {
    throw new VoteError('name_taken', 'That name has already been used. Pick another.');
  }

  try {
    db.transaction(() => {
      stmt.insertVote.run({
        dilemmaId: dilemma.id,
        voterToken,
        displayName,
        nameKey: key,
        choice,
        ipHash: hashIp(ip),
        userAgent: String(userAgent ?? '').slice(0, 200),
      });
      stmt.dropVoterReservations.run(dilemma.id, voterToken);
    })();
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      // Which index tripped? Message tells us; default to the name case.
      if (String(err.message).includes('voter_token')) {
        throw new VoteError('already_voted', 'You have already voted on this dilemma.');
      }
      throw new VoteError('name_taken', 'That name was just taken. Pick another.');
    }
    throw err;
  }

  publishUpdate(dilemma.id, 'vote');
  return getVoteByToken(dilemma.id, voterToken);
}

module.exports = {
  VoteError,
  NAME_POOL,
  castVote,
  createDilemma,
  deleteDilemma,
  getById,
  getBySlug,
  getResolution,
  getSnapshot,
  getTally,
  getVoteByToken,
  getVotes,
  isNameTaken,
  listForAdmin,
  nameKey,
  nextDefaultTitle,
  remainingNameCount,
  resetVotes,
  setStatus,
  suggestName,
};
