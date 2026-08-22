'use strict';

const Database = require('better-sqlite3');
const config = require('./config');

const db = new Database(config.databaseFile);

// WAL keeps readers (the live SSE polling of aggregates) from blocking the
// writers (incoming votes), which matters as soon as a room gets busy.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,
  admin_id   INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS dilemmas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  slug          TEXT    NOT NULL UNIQUE,
  title         TEXT    NOT NULL,
  description   TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  show_results  INTEGER NOT NULL DEFAULT 0,
  created_by    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at     TEXT
);

CREATE TABLE IF NOT EXISTS votes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  dilemma_id   INTEGER NOT NULL REFERENCES dilemmas(id) ON DELETE CASCADE,
  voter_token  TEXT    NOT NULL,
  display_name TEXT    NOT NULL,
  name_key     TEXT    NOT NULL,
  choice       TEXT    NOT NULL CHECK (choice IN ('silence','snitch')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  ip_hash      TEXT,
  user_agent   TEXT
);

-- One vote per device per dilemma.
CREATE UNIQUE INDEX IF NOT EXISTS votes_one_per_device
  ON votes (dilemma_id, voter_token);

-- A name may only be claimed once inside a dilemma.
CREATE UNIQUE INDEX IF NOT EXISTS votes_unique_name
  ON votes (dilemma_id, name_key);

CREATE INDEX IF NOT EXISTS votes_by_dilemma ON votes (dilemma_id, created_at);

/*
 * Soft holds on a suggested name. When a visitor opens a dilemma we prefill
 * their name field and reserve that name for a while, so two people who open
 * the link at the same time do not get handed the same alias.
 */
CREATE TABLE IF NOT EXISTS name_reservations (
  dilemma_id  INTEGER NOT NULL REFERENCES dilemmas(id) ON DELETE CASCADE,
  name_key    TEXT    NOT NULL,
  voter_token TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  PRIMARY KEY (dilemma_id, name_key)
);

CREATE INDEX IF NOT EXISTS reservations_by_voter
  ON name_reservations (dilemma_id, voter_token);
`);

module.exports = db;
