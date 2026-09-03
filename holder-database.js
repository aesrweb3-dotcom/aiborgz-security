const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.HOLDER_DB_PATH || path.join(__dirname, 'holder-roles.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS holder_links (
    discord_id     TEXT PRIMARY KEY,
    guild_id       TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    linked_at      INTEGER
  );

  CREATE TABLE IF NOT EXISTS holder_pending_states (
    state      TEXT PRIMARY KEY,
    discord_id TEXT NOT NULL,
    guild_id   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

// ── verification nonce (single-use, CSRF/replay protection during the connect flow) ──
function storePendingState(state, discordId, guildId) {
  db.prepare(`INSERT OR REPLACE INTO holder_pending_states (state, discord_id, guild_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(state, discordId, guildId, Date.now());
}
function getPendingState(state) {
  return db.prepare(`SELECT * FROM holder_pending_states WHERE state = ?`).get(state);
}
function deletePendingState(state) {
  db.prepare(`DELETE FROM holder_pending_states WHERE state = ?`).run(state);
}
function cleanOldStates() {
  const cutoff = Date.now() - 15 * 60 * 1000; // 15 min expiry
  db.prepare(`DELETE FROM holder_pending_states WHERE created_at < ?`).run(cutoff);
}

// ── wallet link ──
function storeWalletLink(discordId, guildId, walletAddress) {
  db.prepare(`
    INSERT INTO holder_links (discord_id, guild_id, wallet_address, linked_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      guild_id = excluded.guild_id,
      wallet_address = excluded.wallet_address,
      linked_at = excluded.linked_at
  `).run(discordId, guildId, walletAddress, Date.now());
}
function getWalletLink(discordId) {
  return db.prepare(`SELECT * FROM holder_links WHERE discord_id = ?`).get(discordId);
}
function getAllWalletLinks() {
  return db.prepare(`SELECT * FROM holder_links`).all();
}

module.exports = {
  storePendingState, getPendingState, deletePendingState, cleanOldStates,
  storeWalletLink, getWalletLink, getAllWalletLinks,
};
