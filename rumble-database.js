const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.RUMBLE_DB_PATH || path.join(__dirname, 'rumble-gate.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS rumble_links (
    discord_id   TEXT PRIMARY KEY,
    x_user_id    TEXT,
    x_username   TEXT,
    access_token TEXT,
    refresh_token TEXT,
    linked_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS rumble_verifications (
    discord_id   TEXT NOT NULL,
    guild_id     TEXT NOT NULL,
    tweet_url    TEXT NOT NULL,
    followed     INTEGER DEFAULT 0,
    liked        INTEGER DEFAULT 0,
    retweeted    INTEGER DEFAULT 0,
    verified     INTEGER DEFAULT 0,
    timestamp    INTEGER NOT NULL,
    PRIMARY KEY (discord_id, guild_id, tweet_url)
  );

  CREATE TABLE IF NOT EXISTS rumble_settings (
    guild_id   TEXT PRIMARY KEY,
    tweet_url  TEXT,
    target_x_user_id TEXT,
    target_x_username TEXT,
    entry_message_id TEXT,
    entry_channel_id TEXT,
    rumble_role_id TEXT
  );

  CREATE TABLE IF NOT EXISTS rumble_pending_states (
    state        TEXT PRIMARY KEY,
    discord_id   TEXT NOT NULL,
    guild_id     TEXT NOT NULL,
    created_at   INTEGER NOT NULL
  );
`);

// ── OAuth state (CSRF protection during OAuth handshake) ──
function storePendingState(state, discordId, guildId) {
  db.prepare(`INSERT OR REPLACE INTO rumble_pending_states (state, discord_id, guild_id, created_at) VALUES (?, ?, ?, ?)`)
    .run(state, discordId, guildId, Date.now());
}
function getPendingState(state) {
  return db.prepare(`SELECT * FROM rumble_pending_states WHERE state = ?`).get(state);
}
function deletePendingState(state) {
  db.prepare(`DELETE FROM rumble_pending_states WHERE state = ?`).run(state);
}
function cleanOldStates() {
  const cutoff = Date.now() - 15 * 60 * 1000; // 15 min expiry
  db.prepare(`DELETE FROM rumble_pending_states WHERE created_at < ?`).run(cutoff);
}

// ── X account link ──
function storeXLink({ discordId, xUserId, xUsername, accessToken, refreshToken }) {
  db.prepare(`
    INSERT INTO rumble_links (discord_id, x_user_id, x_username, access_token, refresh_token, linked_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      x_user_id = excluded.x_user_id,
      x_username = excluded.x_username,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      linked_at = excluded.linked_at
  `).run(discordId, xUserId, xUsername, accessToken, refreshToken, Date.now());
}
function getXLink(discordId) {
  return db.prepare(`SELECT * FROM rumble_links WHERE discord_id = ?`).get(discordId);
}

// ── Verification result ──
function storeVerification({ discordId, guildId, tweetUrl, followed, liked, retweeted }) {
  const verified = followed && liked && retweeted ? 1 : 0;
  db.prepare(`
    INSERT INTO rumble_verifications (discord_id, guild_id, tweet_url, followed, liked, retweeted, verified, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id, guild_id, tweet_url) DO UPDATE SET
      followed = excluded.followed,
      liked = excluded.liked,
      retweeted = excluded.retweeted,
      verified = excluded.verified,
      timestamp = excluded.timestamp
  `).run(discordId, guildId, tweetUrl, followed ? 1 : 0, liked ? 1 : 0, retweeted ? 1 : 0, verified, Date.now());
  return !!verified;
}
function getVerification(discordId, guildId, tweetUrl) {
  return db.prepare(`SELECT * FROM rumble_verifications WHERE discord_id = ? AND guild_id = ? AND tweet_url = ?`)
    .get(discordId, guildId, tweetUrl);
}

// ── Guild settings (admin-controlled tweet URL etc) ──
function setGuildSettings(guildId, settings) {
  const existing = getGuildSettings(guildId) || {};
  const merged = { ...existing, ...settings };
  db.prepare(`
    INSERT INTO rumble_settings (guild_id, tweet_url, target_x_user_id, target_x_username, entry_message_id, entry_channel_id, rumble_role_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      tweet_url = excluded.tweet_url,
      target_x_user_id = excluded.target_x_user_id,
      target_x_username = excluded.target_x_username,
      entry_message_id = excluded.entry_message_id,
      entry_channel_id = excluded.entry_channel_id,
      rumble_role_id = excluded.rumble_role_id
  `).run(
    guildId,
    merged.tweet_url || null,
    merged.target_x_user_id || null,
    merged.target_x_username || null,
    merged.entry_message_id || null,
    merged.entry_channel_id || null,
    merged.rumble_role_id || null
  );
}
function getGuildSettings(guildId) {
  return db.prepare(`SELECT * FROM rumble_settings WHERE guild_id = ?`).get(guildId);
}

module.exports = {
  storePendingState, getPendingState, deletePendingState, cleanOldStates,
  storeXLink, getXLink,
  storeVerification, getVerification,
  setGuildSettings, getGuildSettings,
};
