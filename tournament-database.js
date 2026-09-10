const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.TOURNAMENT_DB_PATH || path.join(__dirname, 'tournament.db');
// Same /data-volume requirement as every other *_DB_PATH in this project -
// creating the parent dir first means a misconfigured (non-mounted) path
// fails as an empty-but-working local DB instead of crashing the process.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS tournament_entrants (
    token_id      INTEGER PRIMARY KEY,
    owner_address TEXT NOT NULL,
    entered_at    INTEGER NOT NULL,
    group_num     INTEGER,
    wins          INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    points        INTEGER NOT NULL DEFAULT 0
  );

  -- Full qualifying round-robin log, kept for transparency (anyone can see
  -- exactly which match produced which result, not just the final table).
  CREATE TABLE IF NOT EXISTS tournament_qualifying_matches (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    group_num  INTEGER NOT NULL,
    token_a    INTEGER NOT NULL,
    token_b    INTEGER NOT NULL,
    winner     INTEGER NOT NULL
  );

  -- Single-elimination bracket. One row per match, created only once its two
  -- participants are known (so an ungenerated future round simply has no
  -- rows yet - the client fills those slots in as "TBD"). 'script' is the
  -- full seeded battle log from simulateKnockoutMatch, stored as JSON as
  -- soon as the match is activated - the same log every viewer's client
  -- replays through the existing duel engine, so "played live" means
  -- identical for everyone, not a per-viewer random animation.
  CREATE TABLE IF NOT EXISTS tournament_bracket_matches (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    round    TEXT NOT NULL,
    slot     INTEGER NOT NULL,
    token_a  INTEGER,
    token_b  INTEGER,
    seed     TEXT,
    script   TEXT,
    winner   INTEGER,
    status   TEXT NOT NULL DEFAULT 'pending',
    UNIQUE(round, slot)
  );
`);

// ── phase state machine: registration -> closed -> qualifying -> knockout -> complete ──
function getMeta(key, fallback) {
  const row = db.prepare(`SELECT value FROM tournament_meta WHERE key = ?`).get(key);
  return row ? row.value : fallback;
}
function setMeta(key, value) {
  db.prepare(`INSERT INTO tournament_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(key, String(value));
}
function getPhase() { return getMeta('phase', 'registration'); }
function closeRegistration() { setMeta('phase', 'closed'); setMeta('closed_at', Date.now()); }
function setQualifyingComplete(seed) { setMeta('phase', 'qualifying'); setMeta('season_seed', seed); }
function setKnockoutStarted() { setMeta('phase', 'knockout'); }
function setTournamentComplete() { setMeta('phase', 'complete'); }

// Wipes entrants and reopens registration for a fresh tournament run - the
// only way to start a new one once a previous run reached 'complete'.
function resetTournament() {
  db.exec(`DELETE FROM tournament_entrants; DELETE FROM tournament_qualifying_matches; DELETE FROM tournament_bracket_matches;`);
  setMeta('phase', 'registration');
  db.prepare(`DELETE FROM tournament_meta WHERE key != 'phase'`).run();
}

// ── entrants - one row per entered TOKEN, not per wallet, since a wallet
// can enter several of its own units and each competes independently ──
function isEntered(tokenId) {
  return !!db.prepare(`SELECT 1 FROM tournament_entrants WHERE token_id = ?`).get(tokenId);
}
function enterTokens(ownerAddress, tokenIds) {
  const insert = db.prepare(`INSERT OR IGNORE INTO tournament_entrants (token_id, owner_address, entered_at) VALUES (?, ?, ?)`);
  const now = Date.now();
  const tx = db.transaction((ids) => { for (const id of ids) insert.run(id, ownerAddress, now); });
  tx(tokenIds);
}
function getEntrants() {
  return db.prepare(`SELECT token_id, owner_address, entered_at FROM tournament_entrants ORDER BY token_id ASC`).all();
}
function getEntrantCount() {
  return db.prepare(`SELECT COUNT(*) AS n FROM tournament_entrants`).get().n;
}
function getEntrantsForOwner(ownerAddress) {
  return db.prepare(`SELECT token_id FROM tournament_entrants WHERE owner_address = ?`).all(ownerAddress).map(r => r.token_id);
}

// ── qualifying stage - group assignment, round-robin log, standings ──

// Assigns every current entrant to one of 4 groups and records the full
// round-robin result set in one transaction, so a crash mid-computation
// can't leave the tournament in a half-simulated state.
function saveQualifyingResults(assignments, matches) {
  const tx = db.transaction(() => {
    const setGroup = db.prepare(`UPDATE tournament_entrants SET group_num = ? WHERE token_id = ?`);
    for (const a of assignments) setGroup.run(a.groupNum, a.tokenId);

    const insertMatch = db.prepare(`INSERT INTO tournament_qualifying_matches (group_num, token_a, token_b, winner) VALUES (?, ?, ?, ?)`);
    const addWin = db.prepare(`UPDATE tournament_entrants SET wins = wins + 1, points = points + 1 WHERE token_id = ?`);
    const addLoss = db.prepare(`UPDATE tournament_entrants SET losses = losses + 1 WHERE token_id = ?`);
    for (const m of matches) {
      insertMatch.run(m.groupNum, m.tokenA, m.tokenB, m.winner);
      addWin.run(m.winner);
      addLoss.run(m.winner === m.tokenA ? m.tokenB : m.tokenA);
    }
  });
  tx();
}

function getGroupStandings(groupNum) {
  return db.prepare(`
    SELECT token_id, owner_address, wins, losses, points
    FROM tournament_entrants WHERE group_num = ?
    ORDER BY points DESC, token_id ASC
  `).all(groupNum);
}

// Tiebreak is token_id ASC - arbitrary but deterministic and transparent,
// same spirit as every other seeded/reproducible piece of this system.
function getTopEntrants(n) {
  return db.prepare(`
    SELECT token_id, owner_address, group_num, wins, losses, points
    FROM tournament_entrants WHERE group_num IS NOT NULL
    ORDER BY points DESC, token_id ASC LIMIT ?
  `).all(n);
}

function getQualifyingMatches(groupNum) {
  return db.prepare(`SELECT token_a, token_b, winner FROM tournament_qualifying_matches WHERE group_num = ? ORDER BY id ASC`).all(groupNum);
}

// ── knockout bracket - one row per match, created lazily round by round ──
function insertBracketMatch(round, slot, tokenA, tokenB) {
  db.prepare(`INSERT OR IGNORE INTO tournament_bracket_matches (round, slot, token_a, token_b, status) VALUES (?, ?, ?, ?, 'pending')`)
    .run(round, slot, tokenA, tokenB);
}
function getRoundMatches(round) {
  return db.prepare(`SELECT * FROM tournament_bracket_matches WHERE round = ? ORDER BY slot ASC`).all(round);
}
function getAllBracketMatches() {
  return db.prepare(`SELECT * FROM tournament_bracket_matches ORDER BY id ASC`).all();
}
function getCurrentBracketMatch() {
  return db.prepare(`SELECT * FROM tournament_bracket_matches WHERE status = 'current' LIMIT 1`).get();
}
// Activating a match computes its result immediately (seed -> deterministic
// winner, same "authoritative, not client-decided" principle as qualifying)
// - status='current' only controls which slot the client treats as the one
// to animate live right now, not whether the result already exists.
function activateBracketMatch(round, slot, seed, scriptJson, winner) {
  db.prepare(`UPDATE tournament_bracket_matches SET seed = ?, script = ?, winner = ?, status = 'current' WHERE round = ? AND slot = ?`)
    .run(seed, scriptJson, winner, round, slot);
}
function completeCurrentBracketMatch() {
  db.prepare(`UPDATE tournament_bracket_matches SET status = 'done' WHERE status = 'current'`).run();
}

module.exports = {
  getMeta, setMeta, getPhase, closeRegistration, setQualifyingComplete, setKnockoutStarted, setTournamentComplete, resetTournament,
  isEntered, enterTokens, getEntrants, getEntrantCount, getEntrantsForOwner,
  saveQualifyingResults, getGroupStandings, getTopEntrants, getQualifyingMatches,
  insertBracketMatch, getRoundMatches, getAllBracketMatches, getCurrentBracketMatch, activateBracketMatch, completeCurrentBracketMatch,
};
