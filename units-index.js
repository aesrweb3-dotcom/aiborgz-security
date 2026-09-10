const { ethers } = require('ethers');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const CONTRACT_ADDRESS = process.env.AIBORGZ_CONTRACT_ADDRESS || '0xc086de91ea6f1e736ccd9032799dab0f07d063ff';
const RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com/';
const ERC721_ABI = ['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'];

// Keeps a live wallet -> owned tokenIds index in SQLite by watching Transfer
// events, so the site can look up someone's units with one fast local query
// instead of scanning the chain (up to all 3333 tokens, one by one, when a
// wallet's extension doesn't support eth_getLogs) on every single page load.
const dbPath = process.env.UNITS_INDEX_DB_PATH || path.join(__dirname, 'units-index.db');
// better-sqlite3 doesn't create its parent directory - see holder-database.js
// for why this matters (a missing /data volume crashes the whole process).
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS token_owners (
    token_id      INTEGER PRIMARY KEY,
    owner_address TEXT NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_token_owners_address ON token_owners(owner_address);

  CREATE TABLE IF NOT EXISTS indexer_state (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

function getState(key) {
  const row = db.prepare(`SELECT value FROM indexer_state WHERE key = ?`).get(key);
  return row ? row.value : null;
}
function setState(key, value) {
  db.prepare(`
    INSERT INTO indexer_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function getOwnedTokenIds(address) {
  const rows = db.prepare(`SELECT token_id FROM token_owners WHERE owner_address = ?`).all(address.toLowerCase());
  return rows.map(r => r.token_id).sort((a, b) => a - b);
}
function getIndexerStatus() {
  return {
    lastSyncedBlock: parseInt(getState('last_synced_block') || '0', 10),
    indexedTokenCount: db.prepare(`SELECT COUNT(*) AS n FROM token_owners`).get().n,
    syncing,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const upsertOwner = db.prepare(`
  INSERT INTO token_owners (token_id, owner_address, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(token_id) DO UPDATE SET owner_address = excluded.owner_address, updated_at = excluded.updated_at
`);
const applyEvents = db.transaction((evts) => {
  // Apply in the order they actually happened so the last write for a
  // given tokenId is whoever really owns it now, not just insertion order.
  evts.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  for (const ev of evts) {
    upsertOwner.run(Number(ev.args.tokenId), ev.args.to.toLowerCase(), Date.now());
  }
});

let syncing = false;
// Chunked, with progress persisted after EVERY successful chunk - not just
// once at the very end of the whole catch-up range. The previous version
// only called setState('last_synced_block', ...) after successfully
// fetching+applying the ENTIRE fromBlock..latest range in one pass; if any
// single chunk anywhere in that range kept failing (rate limits, a request
// that's simply too large once the gap has grown into the millions of
// blocks), the indexer made literally zero forward progress every single
// 60-second cycle, forever - which is exactly what happened here: it sat
// parked ~4.4M blocks behind for months, silently (failures only ever went
// to console.error, easy to miss), so ownership lookups kept returning
// wherever a token was OWNED BACK THEN instead of now. Persisting after
// each chunk means a later failure can no longer erase earlier progress -
// worst case this cycle stops partway through and picks back up exactly
// where it left off on the next one, instead of restarting from scratch.
async function syncFromChain() {
  if (syncing) return; // never overlap - a slow sync plus the 60s interval could otherwise stack up
  syncing = true;
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ERC721_ABI, provider);
    const filter = contract.filters.Transfer();

    const lastSynced = parseInt(getState('last_synced_block') || '0', 10);
    const latest = await provider.getBlockNumber();
    if (lastSynced > 0 && lastSynced >= latest) return; // already caught up

    let from = lastSynced === 0 ? 0 : lastSynced + 1;
    let chunkSize = 2000000; // try the full remaining range first when it's small; this just becomes the starting point when it's not
    let appliedTotal = 0;
    while (from <= latest) {
      const to = Math.min(from + chunkSize - 1, latest);
      try {
        const events = await contract.queryFilter(filter, from, to);
        applyEvents(events);
        appliedTotal += events.length;
        setState('last_synced_block', to);
        from = to + 1;
        await sleep(60);
      } catch (e) {
        const msg = (e.message || '').toLowerCase();
        if (msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('429')) {
          await sleep(1000);
          continue;
        }
        if (chunkSize <= 20000) {
          console.error(`Units indexer: chunk ${from}-${to} failed even at the 20000-block floor (${e.message}) - stopping this cycle, will resume from block ${from} next time`);
          return;
        }
        chunkSize = Math.floor(chunkSize / 2);
      }
    }
    if (appliedTotal) console.log(`Units indexer: applied ${appliedTotal} transfer(s), synced to block ${latest}`);
  } catch (e) {
    console.error('Units indexer sync failed:', e.message);
  } finally {
    syncing = false;
  }
}

function startUnitsIndexer() {
  syncFromChain(); // catch up immediately on boot
  setInterval(syncFromChain, 60 * 1000); // then stay current
}

module.exports = { startUnitsIndexer, syncFromChain, getOwnedTokenIds, getIndexerStatus };
