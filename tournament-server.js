const express = require('express');
const { ethers } = require('ethers');
const tournamentDb = require('./tournament-database');
const { simulateQualifying } = require('./tournament-sim');

const CONTRACT_ADDRESS = process.env.AIBORGZ_CONTRACT_ADDRESS || '0xc086de91ea6f1e736ccd9032799dab0f07d063ff';
const RPC_URL = process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com/';
const ADMIN_KEY = process.env.TOURNAMENT_ADMIN_KEY;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ['function ownerOf(uint256) view returns (address)'], provider);

const router = express.Router();

// The GET routes elsewhere in this app (units-index, image-cache) never
// needed CORS preflight handling because plain GETs with no custom headers
// are "simple requests" under the Fetch spec. POSTing JSON isn't - the
// browser sends an OPTIONS preflight first, and with nothing here to answer
// it, the real request never goes out at all (fails client-side as a fetch
// error, not even a visible 404). tcg.html and admin.html both call these
// POST routes cross-origin (aiborgz.com -> this Railway service), so this
// is required, not optional, for either of them to work.
router.options('/tournament/enter', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});
router.options('/tournament/admin/:action', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key');
  res.sendStatus(204);
});

function requireAdmin(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
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

// Closes registration AND runs the full qualifying simulation in one step -
// there's no real reason to make an admin do two separate actions when the
// computation itself is instant (a few thousand coin-flips, not an external
// call), and a "closed but not yet computed" in-between state would just be
// a confusing thing to show holders for no benefit.
router.post('/tournament/admin/close-registration', requireAdmin, (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  if (tournamentDb.getPhase() !== 'registration') return res.status(400).json({ error: 'Registration is not currently open.' });
  tournamentDb.closeRegistration();

  const entrantIds = tournamentDb.getEntrants().map(e => e.token_id);
  if (entrantIds.length) {
    const { seed, assignments, matches } = simulateQualifying(entrantIds);
    tournamentDb.saveQualifyingResults(assignments, matches);
    tournamentDb.setQualifyingComplete(seed);
  } else {
    tournamentDb.setQualifyingComplete(null); // nothing entered - still move the phase along rather than get stuck
  }
  res.json({ ok: true, phase: tournamentDb.getPhase(), entrantCount: tournamentDb.getEntrantCount() });
});

router.get('/tournament/groups', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const groups = [1, 2, 3, 4].map(n => ({ groupNum: n, standings: tournamentDb.getGroupStandings(n) }));
  res.json({ groups });
});

router.get('/tournament/groups/:num/matches', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const num = parseInt(req.params.num, 10);
  if (![1, 2, 3, 4].includes(num)) return res.status(400).json({ error: 'group must be 1-4' });
  res.json({ matches: tournamentDb.getQualifyingMatches(num) });
});

router.get('/tournament/top16', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.json({ top: tournamentDb.getTopEntrants(16) });
});

router.post('/tournament/admin/reset', requireAdmin, (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  tournamentDb.resetTournament();
  res.json({ ok: true, phase: tournamentDb.getPhase() });
});

module.exports = { router };
