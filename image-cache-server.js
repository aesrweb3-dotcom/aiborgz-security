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

async function fetchWithFallback(ipfsUri) {
  let lastErr;
  for (let g = 0; g < IPFS_GATEWAYS.length; g++) {
    try {
      const res = await fetch(ipfsToHttp(ipfsUri, g));
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    } catch (e) { lastErr = e; }
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
// wildcard would otherwise swallow this (tokenId="health") first.
router.get('/image/health', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const cachedCount = fs.readdirSync(CACHE_DIR).length;
  res.json({ status: 'ok', cachedCount });
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
    res.send(buffer);
  } catch (e) {
    delete inflight[tokenId];
    console.error('Image cache fetch failed for token', tokenId, ':', e.message);
    res.status(502).json({ error: 'Could not fetch image right now' });
  }
});

module.exports = { router };
