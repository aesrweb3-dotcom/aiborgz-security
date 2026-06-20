require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const xVerify = require('./x-verify');
const rumbleDb = require('./rumble-database');

const app = express();
const PORT = process.env.RUMBLE_OAUTH_PORT || 3001;

// Set by index.js once the Discord client is ready — lets this server
// reach into Discord to assign roles / send DMs after verification completes.
let discordClient = null;
function attachDiscordClient(client) {
  discordClient = client;
}

// ── Landing page that kicks off OAuth — linked from the DM the bot sends ──
app.get('/rumble/start', (req, res) => {
  const { discordId, guildId } = req.query;
  if (!discordId || !guildId) {
    return res.status(400).send(renderPage('Missing info', 'This link is missing required information. Please react to the entry message in Discord again.'));
  }

  const state = crypto.randomBytes(16).toString('hex');
  rumbleDb.storePendingState(state, discordId, guildId);

  const authUrl = xVerify.buildAuthUrl(state);
  res.redirect(authUrl);
});

// ── X redirects back here after the user approves ──
app.get('/rumble/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.send(renderPage('Cancelled', 'You cancelled the X login. Go back to Discord and react to the entry message again if you want to try once more.'));
  }

  const pending = rumbleDb.getPendingState(state);
  if (!pending) {
    return res.send(renderPage('Link expired', 'This verification link has expired. Please react to the entry message in Discord again to get a fresh one.'));
  }
  rumbleDb.deletePendingState(state);

  try {
    const tokenData = await xVerify.exchangeCodeForToken(code, state);
    const profile = await xVerify.getMyXProfile(tokenData.access_token);

    rumbleDb.storeXLink({
      discordId: pending.discord_id,
      xUserId: profile.id,
      xUsername: profile.username,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    });

    // Run the actual verification now that we have a token
    const result = await runVerification(pending.discord_id, pending.guild_id, tokenData.access_token, profile);

    if (result.verified) {
      res.send(renderPage(
        'Verified ✓',
        `@${profile.username} is connected and verified. Head back to Discord — your entry has been confirmed.`
      ));
    } else {
      const missing = [];
      if (!result.followed) missing.push('follow the account');
      if (!result.liked) missing.push('like the tweet');
      if (!result.retweeted) missing.push('retweet the tweet');
      res.send(renderPage(
        'Almost there',
        `@${profile.username} is connected, but you still need to: ${missing.join(', ')}. Do that on X, then go back to Discord and react to the entry message again.`
      ));
    }
  } catch (err) {
    console.error('Rumble OAuth callback error:', err.message);
    res.send(renderPage('Something went wrong', 'We could not complete verification. Please try again from Discord.'));
  }
});

// ── Core verification logic — shared between callback and re-checks ──
async function runVerification(discordId, guildId, accessToken, profile) {
  const settings = rumbleDb.getGuildSettings(guildId);
  if (!settings || !settings.tweet_url || !settings.target_x_user_id) {
    throw new Error('Rumble Room is not configured yet — admin needs to run /rumble-set-tweet');
  }

  const tweetId = xVerify.extractTweetId(settings.tweet_url);

  const [followed, liked, retweeted] = await Promise.all([
    xVerify.checkFollowing(accessToken, profile.id, settings.target_x_user_id),
    xVerify.checkLiked(accessToken, profile.id, tweetId),
    xVerify.checkRetweetedByUser(accessToken, profile.id, tweetId),
  ]);

  const verified = rumbleDb.storeVerification({
    discordId, guildId, tweetUrl: settings.tweet_url, followed, liked, retweeted,
  });

  // If verified, hand them the Rumble role and DM confirmation via Discord
  if (verified && discordClient && settings.rumble_role_id) {
    try {
      const guild = await discordClient.guilds.fetch(guildId);
      const member = await guild.members.fetch(discordId);
      await member.roles.add(settings.rumble_role_id);
      await member.send('✅ You\'re verified! Your Rumble Room entry is confirmed — good luck.').catch(() => {});
    } catch (err) {
      console.error('Failed to assign rumble role:', err.message);
    }
  }

  return { verified, followed, liked, retweeted };
}

function renderPage(title, message) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title} — AIBORGZ Rumble Room</title>
      <style>
        body { background:#050608; color:#c8d8e8; font-family: -apple-system, sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:20px; }
        .card { max-width:420px; text-align:center; border:1px solid #1a1f2e; border-radius:10px; padding:40px 28px; background:#0a0c10; }
        h1 { font-size:20px; color:#00e5ff; margin-bottom:14px; }
        p { font-size:14px; line-height:1.6; color:#8896a8; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${title}</h1>
        <p>${message}</p>
      </div>
    </body>
    </html>
  `;
}

app.get('/rumble/health', (req, res) => res.json({ status: 'ok' }));

function startRumbleServer() {
  app.listen(PORT, () => console.log(`Rumble OAuth server listening on port ${PORT}`));
}

module.exports = { startRumbleServer, attachDiscordClient, runVerification };
