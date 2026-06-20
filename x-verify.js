const crypto = require('crypto');

const X_CLIENT_ID = process.env.X_CLIENT_ID;
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET;
const X_CALLBACK_URL = process.env.X_CALLBACK_URL;

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generatePKCE() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

const pkceStore = new Map();

function buildAuthUrl(state) {
  const { verifier, challenge } = generatePKCE();
  pkceStore.set(state, verifier);
  setTimeout(() => pkceStore.delete(state), 15 * 60 * 1000);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: X_CLIENT_ID,
    redirect_uri: X_CALLBACK_URL,
    scope: 'tweet.read users.read follows.read like.read offline.access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code, state) {
  const verifier = pkceStore.get(state);
  if (!verifier) throw new Error('PKCE verifier expired or missing — please try again');
  pkceStore.delete(state);

  const basicAuth = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');

  const res = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: X_CALLBACK_URL,
      code_verifier: verifier,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`X token exchange failed: ${res.status} ${errText}`);
  }

  return res.json();
}

async function getMyXProfile(accessToken) {
  const res = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`X profile fetch failed: ${res.status}`);
  const data = await res.json();
  return data.data;
}

function extractTweetId(url) {
  const match = url.match(/status(?:es)?\/(\d+)/);
  return match ? match[1] : null;
}

async function checkFollowing(accessToken, myUserId, targetUserId) {
  const res = await fetch(
    `https://api.twitter.com/2/users/${myUserId}/following?max_results=1000`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    console.warn('Follow check failed:', res.status, await res.text());
    return false;
  }
  const data = await res.json();
  const following = (data.data || []).map(u => u.id);
  return following.includes(targetUserId);
}

async function checkLiked(accessToken, myUserId, tweetId) {
  const res = await fetch(
    `https://api.twitter.com/2/users/${myUserId}/liked_tweets?max_results=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    console.warn('Like check failed:', res.status, await res.text());
    return false;
  }
  const data = await res.json();
  const liked = (data.data || []).map(t => t.id);
  return liked.includes(tweetId);
}

async function checkRetweetedByUser(accessToken, myUserId, tweetId) {
  const appBearer = process.env.X_BEARER_TOKEN;
  if (!appBearer) {
    console.warn('X_BEARER_TOKEN not set — cannot verify retweets');
    return false;
  }
  let nextToken;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`https://api.twitter.com/2/tweets/${tweetId}/retweeted_by`);
    url.searchParams.set('max_results', '100');
    if (nextToken) url.searchParams.set('pagination_token', nextToken);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${appBearer}` } });
    if (!res.ok) break;
    const data = await res.json();
    if ((data.data || []).some(u => u.id === myUserId)) return true;
    nextToken = data.meta?.next_token;
    if (!nextToken) break;
  }
  return false;
}

module.exports = {
  buildAuthUrl,
  exchangeCodeForToken,
  getMyXProfile,
  extractTweetId,
  checkFollowing,
  checkLiked,
  checkRetweetedByUser,
};
