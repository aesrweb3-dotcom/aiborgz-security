const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'security.db');
const db = new Database(dbPath);

// ── SETUP TABLES ──
db.exec(`
  CREATE TABLE IF NOT EXISTS banned_users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    username    TEXT NOT NULL,
    avatar_url  TEXT,
    guild_id    TEXT NOT NULL,
    timestamp   INTEGER NOT NULL,
    UNIQUE(user_id, guild_id)
  );

  CREATE TABLE IF NOT EXISTS flagged_joins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL,
    username    TEXT NOT NULL,
    guild_id    TEXT NOT NULL,
    score       INTEGER NOT NULL,
    flags       TEXT NOT NULL,
    matched_ban TEXT,
    timestamp   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS approved_users (
    user_id   TEXT NOT NULL,
    guild_id  TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    PRIMARY KEY(user_id, guild_id)
  );
`);

// ── BANS ──
function storeBan({ userId, username, avatarURL, guildId, timestamp }) {
  const stmt = db.prepare(`
    INSERT INTO banned_users (user_id, username, avatar_url, guild_id, timestamp)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, guild_id) DO UPDATE SET
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      timestamp = excluded.timestamp
  `);
  stmt.run(userId, username, avatarURL, guildId, timestamp);
}

function removeBan(userId, guildId) {
  db.prepare('DELETE FROM banned_users WHERE user_id = ? AND guild_id = ?').run(userId, guildId);
}

function getAllBans(guildId) {
  return db.prepare('SELECT * FROM banned_users WHERE guild_id = ? ORDER BY timestamp DESC').all(guildId);
}

function getBan(userId, guildId) {
  return db.prepare('SELECT * FROM banned_users WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
}

// ── FLAGGED JOINS ──
function storeFlaggedJoin({ userId, username, guildId, score, flags, matchedBan, timestamp }) {
  db.prepare(`
    INSERT INTO flagged_joins (user_id, username, guild_id, score, flags, matched_ban, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId, username, guildId, score, JSON.stringify(flags), matchedBan ? JSON.stringify(matchedBan) : null, timestamp);
}

function getRecentFlagged(guildId, limit = 20) {
  return db.prepare(`
    SELECT * FROM flagged_joins WHERE guild_id = ? ORDER BY timestamp DESC LIMIT ?
  `).all(guildId, limit);
}

// ── APPROVED USERS ──
function approveUser(userId, guildId) {
  db.prepare(`
    INSERT OR REPLACE INTO approved_users (user_id, guild_id, timestamp) VALUES (?, ?, ?)
  `).run(userId, guildId, Date.now());
}

function isApproved(userId, guildId) {
  return !!db.prepare('SELECT 1 FROM approved_users WHERE user_id = ? AND guild_id = ?').get(userId, guildId);
}

// ── STATS ──
function getStats(guildId) {
  const totalBans   = db.prepare('SELECT COUNT(*) as c FROM banned_users WHERE guild_id = ?').get(guildId).c;
  const totalFlags  = db.prepare('SELECT COUNT(*) as c FROM flagged_joins WHERE guild_id = ?').get(guildId).c;
  const last24h     = db.prepare('SELECT COUNT(*) as c FROM flagged_joins WHERE guild_id = ? AND timestamp > ?').get(guildId, Date.now() - 86400000).c;
  return { totalBans, totalFlags, last24h };
}

module.exports = {
  storeBan, removeBan, getAllBans, getBan,
  storeFlaggedJoin, getRecentFlagged,
  approveUser, isApproved,
  getStats,
};
