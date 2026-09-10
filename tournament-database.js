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
    entered_at    INTEGER NOT NULL
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

// Wipes entrants and reopens registration for a fresh tournament run - the
// only way to start a new one once a previous run reached 'complete'.
function resetTournament() {
  db.exec(`DELETE FROM tournament_entrants;`);
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

module.exports = {
  getMeta, setMeta, getPhase, closeRegistration, resetTournament,
  isEntered, enterTokens, getEntrants, getEntrantCount, getEntrantsForOwner,
};
