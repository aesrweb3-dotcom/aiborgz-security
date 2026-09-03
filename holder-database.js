const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.HOLDER_DB_PATH || path.join(__dirname, 'holder-roles.db');
// better-sqlite3 doesn't create the parent directory itself - if HOLDER_DB_PATH
// points somewhere like /data that isn't actually mounted as a volume, this
// throws at require time and takes the whole process down with it. Creating
// it first makes that impossible either way, whether /data is a real
// persistent volume or just a normal (non-persistent) container directory.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// One-time migration from the original one-wallet-per-Discord-account schema
// (discord_id as primary key) to one-row-per-wallet (wallet_address as
// primary key), so a holder can link several wallets and have them stack.
// Safe to run on every boot - a no-op once already migrated or on a fresh DB.
const existingCols = db.prepare(`PRAGMA table_info(holder_links)`).all();
const hasOldSchema = existingCols.some(c => c.name === 'discord_id' && c.pk === 1);
if (hasOldSchema) {
  db.exec(`
    ALTER TABLE holder_links RENAME TO holder_links_old;
    CREATE TABLE holder_links (
      wallet_address TEXT PRIMARY KEY,
      discord_id     TEXT NOT NULL,
      guild_id       TEXT NOT NULL,
      linked_at      INTEGER
    );
    INSERT OR IGNORE INTO holder_links (wallet_address, discord_id, guild_id, linked_at)
      SELECT wallet_address, discord_id, guild_id, linked_at FROM holder_links_old;
    DROP TABLE holder_links_old;
  `);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS holder_links (
    wallet_address TEXT PRIMARY KEY,
    discord_id     TEXT NOT NULL,
    guild_id       TEXT NOT NULL,
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

// ── wallet links - many per discord_id, one discord_id per wallet ──
function getWalletOwner(walletAddress) {
  return db.prepare(`SELECT discord_id FROM holder_links WHERE wallet_address = ?`).get(walletAddress);
}

// Throws if the wallet is already linked to a *different* Discord account,
// rather than silently reassigning it - a wallet's holdings should only
// ever count toward the one identity that actually proved ownership first.
function storeWalletLink(discordId, guildId, walletAddress) {
  const owner = getWalletOwner(walletAddress);
  if (owner && owner.discord_id !== discordId) {
    throw new Error('This wallet is already linked to a different Discord account.');
  }
  db.prepare(`
    INSERT INTO holder_links (wallet_address, discord_id, guild_id, linked_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(wallet_address) DO UPDATE SET
      guild_id = excluded.guild_id,
      linked_at = excluded.linked_at
  `).run(walletAddress, discordId, guildId, Date.now());
}
function getWalletsForDiscordId(discordId) {
  return db.prepare(`SELECT * FROM holder_links WHERE discord_id = ?`).all(discordId);
}
// One row per distinct verified user, for the periodic recheck loop
function getAllLinkedUsers() {
  return db.prepare(`SELECT DISTINCT discord_id, guild_id FROM holder_links`).all();
}

module.exports = {
  storePendingState, getPendingState, deletePendingState, cleanOldStates,
  storeWalletLink, getWalletOwner, getWalletsForDiscordId, getAllLinkedUsers,
};
