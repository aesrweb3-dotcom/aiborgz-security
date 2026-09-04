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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Same chunking/backoff pattern as the client-side scan in my-aiborgz.html:
// try the full range in one call first (works fine directly against the
// RPC), fall back to narrower chunks - remembering whatever size last
// worked instead of re-discovering it every window - only if that's rejected.
async function queryFilterChunked(contract, filter, fromBlock, toBlock, startChunkSize) {
  const results = [];
  let from = fromBlock;
  let chunkSize = startChunkSize;
  while (from <= toBlock) {
    const to = Math.min(from + chunkSize - 1, toBlock);
    try {
      results.push(...await contract.queryFilter(filter, from, to));
      from = to + 1;
      await sleep(60);
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      if (msg.includes('too many requests') || msg.includes('rate limit') || msg.includes('429')) {
        await sleep(1000);
        continue;
      }
      if (chunkSize <= 20000) throw new Error('getLogs failed even at a 20000-block range: ' + e.message);
      chunkSize = Math.floor(chunkSize / 2);
    }
  }
  return results;
}

async function getAllTransferLogs(contract, fromBlock, toBlock) {
  const filter = contract.filters.Transfer();
  try {
    return await contract.queryFilter(filter, fromBlock, toBlock);
  } catch (e) {
    return await queryFilterChunked(contract, filter, fromBlock, toBlock, 2000000);
  }
}

let syncing = false;
async function syncFromChain() {
  if (syncing) return; // never overlap - a slow sync plus the 60s interval could otherwise stack up
  syncing = true;
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ERC721_ABI, provider);

    const lastSynced = parseInt(getState('last_synced_block') || '0', 10);
    const latest = await provider.getBlockNumber();
    if (lastSynced > 0 && lastSynced >= latest) return; // already caught up

    const fromBlock = lastSynced === 0 ? 0 : lastSynced + 1;
    const events = await getAllTransferLogs(contract, fromBlock, latest);

    // Apply in the order they actually happened so the last write for a
    // given tokenId is whoever really owns it now, not just insertion order.
    events.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

    const upsert = db.prepare(`
      INSERT INTO token_owners (token_id, owner_address, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(token_id) DO UPDATE SET owner_address = excluded.owner_address, updated_at = excluded.updated_at
    `);
    const applyAll = db.transaction((evts) => {
      for (const ev of evts) {
        upsert.run(Number(ev.args.tokenId), ev.args.to.toLowerCase(), Date.now());
      }
    });
    applyAll(events);

    setState('last_synced_block', latest);
    if (events.length) console.log(`Units indexer: applied ${events.length} transfer(s), synced to block ${latest}`);
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

module.exports = { startUnitsIndexer, syncFromChain, getOwnedTokenIds };
