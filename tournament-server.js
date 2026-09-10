const express = require('express');
const { ethers } = require('ethers');
const tournamentDb = require('./tournament-database');

const CONTRACT_ADDRESS = process.env.AIBORGZ_CONTRACT_ADDRESS || '0xc086de91ea6f1e736ccd9032799dab0f07d063ff';
const RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com/';
const ADMIN_KEY = process.env.TOURNAMENT_ADMIN_KEY;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ['function ownerOf(uint256) view returns (address)'], provider);

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ error: 'Tournament admin actions are not configured (TOURNAMENT_ADMIN_KEY unset).' });
  if (req.get('x-admin-key') !== ADMIN_KEY) return res.status(401).json({ error: 'Invalid admin key.' });
  next();
}

// Registered before /tournament/mine/:address - Express matches in order,
// and the wildcard would otherwise swallow /tournament/health first.
router.get('/tournament/health', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ status: 'ok' });
});

router.get('/tournament/state', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ phase: tournamentDb.getPhase(), entrantCount: tournamentDb.getEntrantCount() });
});

router.get('/tournament/entrants', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ entrants: tournamentDb.getEntrants() });
});

// What of THIS wallet's real holdings is already entered - lets the client
// show entered/not-entered per unit without pulling the whole entrant list.
router.get('/tournament/mine/:address', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const address = String(req.params.address || '').toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) return res.status(400).json({ error: 'Invalid address' });
  res.json({ tokenIds: tournamentDb.getEntrantsForOwner(address) });
});

router.post('/tournament/enter', async (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    if (tournamentDb.getPhase() !== 'registration') {
      return res.status(400).json({ error: 'Tournament registration is not open.' });
    }
    const { address, tokenIds } = req.body || {};
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) return res.status(400).json({ error: 'Invalid address' });
    if (!Array.isArray(tokenIds) || !tokenIds.length || tokenIds.length > 200) {
      return res.status(400).json({ error: 'tokenIds must be a non-empty array of at most 200 ids' });
    }

    // Verify real on-chain ownership for every id before recording it - a
    // wallet can only enter units it actually holds right now, checked
    // fresh against the chain rather than trusted from the client.
    const accepted = [];
    const rejected = [];
    for (const raw of tokenIds) {
      const tokenId = parseInt(raw, 10);
      if (!Number.isInteger(tokenId) || tokenId < 1) { rejected.push({ tokenId: raw, reason: 'invalid id' }); continue; }
      try {
        const owner = await contract.ownerOf(tokenId);
        if (owner.toLowerCase() === address.toLowerCase()) accepted.push(tokenId);
        else rejected.push({ tokenId, reason: 'not owned by this address' });
      } catch (e) {
        rejected.push({ tokenId, reason: 'ownerOf lookup failed' });
      }
    }

    if (accepted.length) tournamentDb.enterTokens(address.toLowerCase(), accepted);
    res.json({ ok: true, accepted, rejected, entrantCount: tournamentDb.getEntrantCount() });
  } catch (err) {
    console.error('Tournament enter error:', err.message);
    res.status(500).json({ error: 'Could not process entry right now.' });
  }
});

router.post('/tournament/admin/close-registration', requireAdmin, (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  if (tournamentDb.getPhase() !== 'registration') return res.status(400).json({ error: 'Registration is not currently open.' });
  tournamentDb.closeRegistration();
  res.json({ ok: true, phase: tournamentDb.getPhase(), entrantCount: tournamentDb.getEntrantCount() });
});

router.post('/tournament/admin/reset', requireAdmin, (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  tournamentDb.resetTournament();
  res.json({ ok: true, phase: tournamentDb.getPhase() });
});

module.exports = { router };
