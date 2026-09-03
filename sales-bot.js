// Polls OpenSea for new AIBORGZ sales and posts them to a Discord channel
// using IRON DON's existing client. No LLM involved here on purpose --
// sale price/buyer/seller are real data, not something to hand to a model
// that's deliberately told never to state facts about the project.
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const SALES_CHANNEL_ID = process.env.SALES_CHANNEL_ID;
const COLLECTION_SLUG = process.env.OPENSEA_COLLECTION_SLUG || 'aiborgz';
const POLL_INTERVAL_MS = 60 * 1000;
const STATE_PATH = process.env.SALES_STATE_PATH || '/data/sales-bot-state.json';

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch (e) {
    // First run, or file missing - start from "now" so a fresh deploy
    // doesn't dump the collection's entire sale history into the channel.
    return { lastEventTimestamp: Math.floor(Date.now() / 1000) };
  }
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state));
  } catch (err) {
    console.error('Sales bot: failed to save state:', err.message);
  }
}

function shortAddr(a) {
  return a ? `${a.slice(0, 6)}...${a.slice(-4)}` : 'unknown';
}

function formatSaleEmbed(event) {
  const decimals = event.payment?.decimals ?? 18;
  const amount = Number(event.payment?.quantity || 0) / (10 ** decimals);
  const symbol = event.payment?.symbol || '';
  const nft = event.nft || {};
  const name = nft.name || `AIBORGZ #${nft.identifier}`;

  return {
    title: `${name} sold`,
    url: nft.opensea_url || `https://opensea.io/collection/${COLLECTION_SLUG}`,
    color: 0x00e5ff,
    thumbnail: nft.display_image_url ? { url: nft.display_image_url } : undefined,
    fields: [
      { name: 'Price', value: `${amount} ${symbol}`, inline: true },
      { name: 'Buyer', value: shortAddr(event.buyer), inline: true },
      { name: 'Seller', value: shortAddr(event.seller), inline: true },
    ],
    footer: { text: 'AIBORGZ // EVOLVE. OR BE REWRITTEN //' },
    timestamp: new Date((event.event_timestamp || Date.now() / 1000) * 1000).toISOString(),
  };
}

async function pollOnce(client) {
  const state = loadState();
  const url = `https://api.opensea.io/api/v2/events/collection/${COLLECTION_SLUG}?event_type=sale&after=${state.lastEventTimestamp}&limit=50`;

  let data;
  try {
    const res = await fetch(url, { headers: { 'x-api-key': OPENSEA_API_KEY } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error('Sales bot: OpenSea fetch failed:', err.message);
    return;
  }

  const events = (data.asset_events || []).slice().sort((a, b) => a.event_timestamp - b.event_timestamp);

  if (events.length) {
    const channel = await client.channels.fetch(SALES_CHANNEL_ID).catch(() => null);
    if (!channel) {
      console.error('Sales bot: could not find SALES_CHANNEL_ID', SALES_CHANNEL_ID);
      // Don't advance state - retry this same window next poll, once the
      // channel's reachable it'll pick these events back up.
      return;
    }
    for (const event of events) {
      try {
        await channel.send({ embeds: [formatSaleEmbed(event)] });
      } catch (err) {
        console.error('Sales bot: failed to post a sale:', err.message);
      }
    }
  }

  // Always checkpoint after a successful fetch, found something or not.
  // Previously this only ran inside the events.length branch above, so a
  // quiet poll (the normal case) never wrote state - which meant the next
  // poll's "no state file yet" fallback recomputed "now" from scratch every
  // single time, and could never see anything that happened in between.
  // A self-reinforcing dead loop that looked identical to "working, just quiet."
  saveState({ lastEventTimestamp: Math.floor(Date.now() / 1000) });
}

function startSalesBot(client) {
  if (!OPENSEA_API_KEY || !SALES_CHANNEL_ID) {
    console.log('Sales bot: OPENSEA_API_KEY or SALES_CHANNEL_ID not set, skipping.');
    return;
  }
  console.log(`Sales bot: watching "${COLLECTION_SLUG}" for sales every ${POLL_INTERVAL_MS / 1000}s.`);
  pollOnce(client).catch(err => console.error('Sales bot: initial poll failed:', err.message));
  setInterval(() => {
    pollOnce(client).catch(err => console.error('Sales bot: poll failed:', err.message));
  }, POLL_INTERVAL_MS);
}

module.exports = { startSalesBot };
