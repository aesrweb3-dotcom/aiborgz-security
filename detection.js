require('dotenv').config();
const db = require('./database');

// ── ACCOUNT AGE THRESHOLDS ──
const AGE = {
  VERY_NEW: 1  * 24 * 60 * 60 * 1000,
  NEW:      7  * 24 * 60 * 60 * 1000,
  RECENT:   30 * 24 * 60 * 60 * 1000,
};

function formatAge(ms) {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1)  return 'Less than 1 day old';
  if (days < 7)  return `${days} day${days !== 1 ? 's' : ''} old`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} week${weeks !== 1 ? 's' : ''} old`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? 's' : ''} old`;
}

// ── USERNAME SIMILARITY (Levenshtein) ──
function similarity(a, b) {
  a = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  b = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;
  const m = Array.from({ length: b.length + 1 }, (_, i) =>
    Array.from({ length: a.length + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++)
      m[i][j] = b[i-1] === a[j-1] ? m[i-1][j-1] : 1 + Math.min(m[i-1][j], m[i][j-1], m[i-1][j-1]);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - m[b.length][a.length] / maxLen;
}

// ── AVATAR COMPARISON — URL hash only (no canvas needed) ──
function compareAvatarUrl(url1, url2) {
  if (!url1 || !url2) return 0;
  // Extract avatar hash from Discord CDN URL
  // e.g. https://cdn.discordapp.com/avatars/123456/abcdef1234.png
  const hash1 = url1.split('/').slice(-1)[0].split('?')[0].replace(/\.[^.]+$/, '');
  const hash2 = url2.split('/').slice(-1)[0].split('?')[0].replace(/\.[^.]+$/, '');
  if (hash1 === hash2 && hash1.length > 5) return 1; // Exact same avatar hash
  return 0;
}

// ── MAIN DETECTION ──
async function checkNewMember(member, client) {
  const user    = member.user;
  const guildId = member.guild.id;
  const now     = Date.now();
  const accountAge = now - user.createdTimestamp;

  if (user.bot) return { flagged: false };
  if (db.isApproved(user.id, guildId)) return { flagged: false };

  // Previously banned account rejoining
  const selfBan = db.getBan(user.id, guildId);
  if (selfBan) {
    return {
      flagged: true, severity: 'HIGH', score: 100,
      accountAge: formatAge(accountAge),
      flags: ['🔴 **Previously banned account rejoined**'],
      matchedBan: { username: selfBan.username, userId: selfBan.user_id, timestamp: selfBan.timestamp },
    };
  }

  const flags = [];
  let score = 0;
  let matchedBan = null;

  // Account age
  if      (accountAge < AGE.VERY_NEW) { flags.push('🔴 Account created **less than 1 day ago**'); score += 40; }
  else if (accountAge < AGE.NEW)      { flags.push(`🟡 Account created **${formatAge(accountAge)}**`); score += 25; }
  else if (accountAge < AGE.RECENT)   { flags.push(`🟡 Account is **${formatAge(accountAge)}** old`); score += 10; }

  // Default avatar
  if (!user.avatar) { flags.push('🟡 Using default Discord avatar'); score += 15; }

  // Compare against ban list
  const bannedUsers = db.getAllBans(guildId);
  for (const banned of bannedUsers) {
    const userSim = similarity(user.username, banned.username);
    if (userSim >= 0.75) {
      flags.push(`🔴 Username similar to banned user **${banned.username}** (${Math.round(userSim * 100)}% match)`);
      score += Math.round(userSim * 35);
      if (!matchedBan) matchedBan = { username: banned.username, userId: banned.user_id, timestamp: banned.timestamp };
    }

    // Avatar hash comparison — exact same avatar as banned user
    if (user.avatar && banned.avatar_url) {
      const avatarSim = compareAvatarUrl(
        user.displayAvatarURL({ extension: 'png', size: 256 }),
        banned.avatar_url
      );
      if (avatarSim >= 0.99) {
        flags.push(`🔴 Identical avatar to banned user **${banned.username}**`);
        score += 40;
        if (!matchedBan) matchedBan = { username: banned.username, userId: banned.user_id, timestamp: banned.timestamp };
      }
    }
  }

  score = Math.min(score, 100);

  const threshold = parseInt(process.env.FLAG_THRESHOLD || '30');
  const flagged   = score >= threshold;

  if (flagged) {
    const severity = score >= 70 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW';
    db.storeFlaggedJoin({ userId: user.id, username: user.username, guildId, score, flags, matchedBan, timestamp: now });
    return { flagged: true, severity, score, accountAge: formatAge(accountAge), flags, matchedBan };
  }

  return { flagged: false };
}

module.exports = { checkNewMember };
