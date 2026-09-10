const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { ethers } = require('ethers');

// Reuses the tournament admin key rather than introducing a second secret -
// this is a one-time migration utility (moving the cache to its own volume
// after it filled the shared one and starved the SQLite databases of write
// space), not a permanent feature, so a dedicated key isn't worth adding.
const ADMIN_KEY = process.env.TOURNAMENT_ADMIN_KEY;
function requireAdmin(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  if (!ADMIN_KEY) return res.status(503).json({ error: 'Admin actions are not configured.' });
  if (req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'Invalid admin key.' });
  next();
}

const CONTRACT_ADDRESS = process.env.AIBORGZ_CONTRACT_ADDRESS || '0xc086de91ea6f1e736ccd9032799dab0f07d063ff';
const RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com/';
const ERC721_ABI = ['function tokenURI(uint256) view returns (string)'];
const IPFS_GATEWAYS = [
  'https://gateway.pinata.cloud/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://w3s.link/ipfs/',
];

// Caches each token's image permanently after the first fetch, so browsers
// stop depending on public IPFS gateways at all past the very first load -
// client-side gateway rotation/retry helped, but two different real users
// have now hit broken images anyway when the public gateways were degraded.
// A server fetching each image ONCE, ever, and serving it from disk after
// that sidesteps per-browser rate limits entirely.
const CACHE_DIR = process.env.IMAGE_CACHE_DIR || path.join(__dirname, 'image-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

function ipfsToHttp(uri, gatewayIndex) {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) return IPFS_GATEWAYS[gatewayIndex % IPFS_GATEWAYS.length] + uri.slice('ipfs://'.length);
  return uri;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Same rotation + retry-with-backoff as the client-side version in
// my-aiborgz.html. This one matters even more here: Railway's own outbound
// IP gets rate-limited by the public gateways too, and a fast bulk prewarm
// run proved it - hammering this endpoint without retry logic here produced
// an 87% failure rate (850 processed, 742 failed) even though the gateways
// themselves were fine for isolated requests. A single pass with no retry
// just meant one rate-limited moment permanently failed that token.
let gatewayRotation = 0;
async function fetchWithFallback(ipfsUri, maxPasses) {
  maxPasses = maxPasses || 4;
  const startGateway = gatewayRotation++ % IPFS_GATEWAYS.length;
  let lastErr;
  for (let pass = 0; pass < maxPasses; pass++) {
    if (pass > 0) await sleep(2000 * pass);
    for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
      const g = (startGateway + i) % IPFS_GATEWAYS.length;
      try {
        const res = await fetch(ipfsToHttp(ipfsUri, g));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res;
      } catch (e) { lastErr = e; }
    }
  }
  throw lastErr;
}

const router = express.Router();
const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ERC721_ABI, provider);

// Concurrent requests for the same not-yet-cached token share one fetch
// instead of each independently hitting the gateways.
const inflight = {};

// Registered before /image/:tokenId - Express matches in order, and the
// wildcard would otherwise swallow these (tokenId="health"/"missing") first.
router.get('/image/health', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const files = fs.readdirSync(CACHE_DIR);
  const totalBytes = files.reduce((sum, f) => {
    try { return sum + fs.statSync(path.join(CACHE_DIR, f)).size; } catch (e) { return sum; }
  }, 0);
  res.json({
    status: 'ok',
    cachedCount: files.length,
    totalBytes,
    totalMB: Math.round(totalBytes / 1024 / 1024),
    avgBytesPerFile: files.length ? Math.round(totalBytes / files.length) : 0,
  });
});

// Lets a prewarm/closer script target only the stragglers instead of
// re-requesting all 3333 every run just to find out most are already cached.
router.get('/image/missing', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const totalSupply = parseInt(req.query.totalSupply, 10) || 3333;
  const cached = new Set(fs.readdirSync(CACHE_DIR).map(f => f.replace('.png', '')));
  const missing = [];
  for (let id = 1; id <= totalSupply; id++) {
    if (!cached.has(String(id))) missing.push(id);
  }
  res.json({ missing, missingCount: missing.length, cachedCount: cached.size });
});

router.get('/image/:tokenId', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const tokenId = parseInt(req.params.tokenId, 10);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    return res.status(400).json({ error: 'Invalid tokenId' });
  }

  const cachePath = path.join(CACHE_DIR, tokenId + '.png');
  if (fs.existsSync(cachePath)) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Content-Type', 'image/png');
    res.set('X-Cache', 'HIT'); // lets the prewarm script skip its throttle delay on hits - they never touch IPFS
    return res.sendFile(cachePath);
  }

  try {
    if (!inflight[tokenId]) {
      inflight[tokenId] = (async () => {
        const uri = await contract.tokenURI(tokenId);
        const metaRes = await fetchWithFallback(uri);
        const meta = await metaRes.json();
        const imgRes = await fetchWithFallback(meta.image);
        const buffer = Buffer.from(await imgRes.arrayBuffer());
        fs.writeFileSync(cachePath, buffer);
        return buffer;
      })();
    }
    const buffer = await inflight[tokenId];
    delete inflight[tokenId];
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Content-Type', 'image/png');
    res.set('X-Cache', 'MISS');
    res.send(buffer);
  } catch (e) {
    delete inflight[tokenId];
    console.error('Image cache fetch failed for token', tokenId, ':', e.message);
    res.status(502).json({ error: 'Could not fetch image right now' });
  }
});

// One-time migration to a separate volume, run once after the shared /data
// volume filled up (this cache was ~92% of it). Copies only - never touches
// the source files, so it's safe to re-run if it's interrupted partway
// (already-copied, matching-size files are skipped, not re-fetched).
// Async + bounded concurrency so copying ~4.5GB doesn't block the rest of
// this process (Discord bot, tournament API) for the whole duration.
router.options('/image/admin/:action', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  res.sendStatus(204);
});

async function copyWithConcurrency(files, srcDir, destDir, concurrency) {
  let copied = 0, skipped = 0;
  const failed = [];
  let idx = 0;
  async function worker() {
    while (idx < files.length) {
      const f = files[idx++];
      const src = path.join(srcDir, f);
      const dst = path.join(destDir, f);
      try {
        const srcStat = await fsp.stat(src);
        try {
          const dstStat = await fsp.stat(dst);
          if (dstStat.size === srcStat.size) { skipped++; continue; }
        } catch (e) { /* doesn't exist yet at destination - fall through to copy */ }
        await fsp.copyFile(src, dst);
        copied++;
      } catch (e) { failed.push({ file: f, error: e.message }); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { copied, skipped, failed };
}

router.post('/image/admin/migrate-cache', requireAdmin, async (req, res) => {
  const destDir = req.body && req.body.destDir;
  if (!destDir) return res.status(400).json({ error: 'destDir required' });
  try {
    await fsp.mkdir(destDir, { recursive: true });
    const files = await fsp.readdir(CACHE_DIR);
    const result = await copyWithConcurrency(files, CACHE_DIR, destDir, 8);
    res.json({ total: files.length, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Only deletes a source file once the destination copy is confirmed present
// with a matching size - never deletes on a hunch. Run this only after
// verifying /image/admin/migrate-cache's result looks complete.
router.post('/image/admin/cleanup-old-cache', requireAdmin, async (req, res) => {
  const destDir = req.body && req.body.destDir;
  if (!destDir) return res.status(400).json({ error: 'destDir required' });
  try {
    const files = await fsp.readdir(CACHE_DIR);
    let deleted = 0;
    const skipped = [];
    for (const f of files) {
      const src = path.join(CACHE_DIR, f);
      const dst = path.join(destDir, f);
      try {
        const [srcStat, dstStat] = await Promise.all([fsp.stat(src), fsp.stat(dst)]);
        if (srcStat.size === dstStat.size) { await fsp.unlink(src); deleted++; }
        else skipped.push({ file: f, reason: 'size mismatch - not deleted' });
      } catch (e) { skipped.push({ file: f, reason: e.message }); }
    }
    res.json({ total: files.length, deleted, skippedCount: skipped.length, skipped: skipped.slice(0, 20) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = { router };
