const fetch = require('node-fetch');
const db = require('./database');

// ── ACCOUNT AGE THRESHOLDS ──
const AGE_THRESHOLDS = {
  VERY_NEW:  1 * 24 * 60 * 60 * 1000,   // Under 1 day
  NEW:       7 * 24 * 60 * 60 * 1000,   // Under 7 days
  RECENT:    30 * 24 * 60 * 60 * 1000,  // Under 30 days
};

// ── FORMAT ACCOUNT AGE ──
function formatAge(ms) {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return 'Less than 1 day old';
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} old`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} week${weeks !== 1 ? 's' : ''} old`;
  const months = Math.floor(days / 30);
  return `${months} month${months !== 1 ? 's' : ''} old`;
}

// ── USERNAME SIMILARITY ──
function similarityScore(a, b) {
  a = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  b = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;

  // Levenshtein distance
  const matrix = Array.from({ length: b.length + 1 }, (_, i) =>
    Array.from({ length: a.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
      }
    }
  }
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - matrix[b.length][a.length] / maxLen;
}

// ── AVATAR COMPARISON ──
async function compareAvatar(url1, url2) {
  try {
    if (!url1 || !url2) return 0;
    // Same URL = same avatar
    const base1 = url1.split('?')[0].split('/').slice(-2).join('/');
    const base2 = url2.split('?')[0].split('/').slice(-2).join('/');
    if (base1 === base2) return 1;

    // Fetch both images and compare pixel data
    const [res1, res2] = await Promise.all([
      fetch(url1).then(r => r.buffer()),
      fetch(url2).then(r => r.buffer()),
    ]);

    // Simple hash comparison — if buffers are same length and mostly similar
    if (res1.length === 0 || res2.length === 0) return 0;
    const minLen = Math.min(res1.length, res2.length);
    const sampleSize = Math.min(minLen, 1000);
    let matches = 0;
    for (let i = 0; i < sampleSize; i++) {
      if (Math.abs(res1[i] - res2[i]) < 10) matches++;
    }
    return matches / sampleSize;
  } catch {
    return 0;
  }
}

// ── MAIN DETECTION FUNCTION ──
async function checkNewMember(member, client) {
  const user = member.user;
  const guildId = member.guild.id;
  const now = Date.now();
  const accountAge = now - user.createdTimestamp;

  // Skip bots
  if (user.bot) return { flagged: false };

  // Skip if already approved
  if (db.isApproved(user.id, guildId)) return { flagged: false };

  // Skip if previously banned themselves (re-ban)
  const selfBan = db.getBan(user.id, guildId);
  if (selfBan) {
    return {
      flagged: true,
      severity: 'HIGH',
      score: 100,
      accountAge: formatAge(accountAge),
      flags: ['🔴 **Previously banned account rejoined**'],
      matchedBan: { username: selfBan.username, userId: selfBan.user_id, timestamp: selfBan.timestamp },
    };
  }

  const flags = [];
  let score = 0;
  let matchedBan = null;

  // ── ACCOUNT AGE CHECK ──
  if (accountAge < AGE_THRESHOLDS.VERY_NEW) {
    flags.push('🔴 Account created **less than 1 day ago**');
    score += 40;
  } else if (accountAge < AGE_THRESHOLDS.NEW) {
    flags.push(`🟡 Account created **${formatAge(accountAge)}**`);
    score += 25;
  } else if (accountAge < AGE_THRESHOLDS.RECENT) {
    flags.push(`🟡 Account is **${formatAge(accountAge)}** old`);
    score += 10;
  }

  // ── DEFAULT AVATAR ──
  if (!user.avatar) {
    flags.push('🟡 Using default Discord avatar');
    score += 15;
  }

  // ── NO NITRO / LOW PROFILE ──
  if (!member.premiumSince && !user.avatar && accountAge < AGE_THRESHOLDS.RECENT) {
    score += 5;
  }

  // ── COMPARE AGAINST BAN LIST ──
  const bannedUsers = db.getAllBans(guildId);
  let highestSimilarity = 0;

  for (const banned of bannedUsers) {
    // Username similarity
    const userSim = similarityScore(user.username, banned.username);
    if (userSim >= 0.75) {
      flags.push(`🔴 Username similar to banned user **${banned.username}** (${Math.round(userSim * 100)}% match)`);
      score += Math.round(userSim * 35);
      if (!matchedBan || userSim > highestSimilarity) {
        highestSimilarity = userSim;
        matchedBan = { username: banned.username, userId: banned.user_id, timestamp: banned.timestamp };
      }
    }

    // Avatar similarity (only if both have avatars)
    if (user.avatar && banned.avatar_url) {
      const avatarSim = await compareAvatar(
        user.displayAvatarURL({ extension: 'png', size: 256 }),
        banned.avatar_url
      );
      if (avatarSim >= 0.85) {
        flags.push(`🔴 Avatar very similar to banned user **${banned.username}** (${Math.round(avatarSim * 100)}% match)`);
        score += Math.round(avatarSim * 40);
        if (!matchedBan) {
          matchedBan = { username: banned.username, userId: banned.user_id, timestamp: banned.timestamp };
        }
      }
    }
  }

  // Cap score at 100
  score = Math.min(score, 100);

  // ── DETERMINE IF FLAGGED ──
  const threshold = parseInt(process.env.FLAG_THRESHOLD || '30');
  const flagged = score >= threshold;

  if (flagged) {
    const severity = score >= 70 ? 'HIGH' : score >= 45 ? 'MEDIUM' : 'LOW';

    // Store in database
    db.storeFlaggedJoin({
      userId:     user.id,
      username:   user.username,
      guildId,
      score,
      flags,
      matchedBan,
      timestamp:  now,
    });

    return {
      flagged: true,
      severity,
      score,
      accountAge: formatAge(accountAge),
      flags,
      matchedBan,
    };
  }

  return { flagged: false };
}

module.exports = { checkNewMember, compareAvatar };
