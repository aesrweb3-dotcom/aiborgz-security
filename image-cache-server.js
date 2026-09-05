const express = require('express');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

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
  const cachedCount = fs.readdirSync(CACHE_DIR).length;
  res.json({ status: 'ok', cachedCount });
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

module.exports = { router };
