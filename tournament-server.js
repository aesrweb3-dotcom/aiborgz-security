const express = require('express');
const { ethers } = require('ethers');
const tournamentDb = require('./tournament-database');
const { simulateQualifying, simulateKnockoutMatch } = require('./tournament-sim');

// Standard 16-bracket seeding (keeps top seeds apart until later rounds) -
// SEED_ORDER[2i]/[2i+1] are the two seed numbers paired in R16 slot i.
// Cosmetic only here (qualifying rank carries no combat advantage - the
// duel engine is 100% random), but it's what makes the bracket look like a
// real seeded tournament instead of an arbitrary pairing.
const BRACKET_SEED_ORDER = [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11];
const BRACKET_ROUND_ORDER = ['r16', 'qf', 'sf', 'third', 'final'];

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

router.get('/tournament/bracket', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  const matches = tournamentDb.getAllBracketMatches().map(m => ({
    round: m.round, slot: m.slot, tokenA: m.token_a, tokenB: m.token_b,
    winner: m.winner, status: m.status,
    script: m.script ? JSON.parse(m.script) : null,
  }));
  res.json({ matches });
});

// Computes the match's result right now (seed -> simulateKnockoutMatch),
// stores it, and marks it 'current' - the client isn't asked for a result,
// it only ever replays one that already exists.
function activateBracketMatch(round, slot, tokenA, tokenB) {
  const result = simulateKnockoutMatch(tokenA, tokenB);
  tournamentDb.activateBracketMatch(round, slot, String(result.seed), JSON.stringify({ first: result.first, rounds: result.rounds }), result.winner);
  return { round, slot, tokenA, tokenB };
}

// Walks the fixed round order looking for the next thing to do: activate a
// still-pending match in an already-generated round, or - once a round is
// completely done - generate the next round (or, after 'sf', both 'third'
// and 'final' at once, from the semifinal winners/losers) and keep looking.
// Returns the newly-activated {round,slot,...}, or null once every round
// through 'final' is done (tournament complete).
function findAndActivateNext() {
  for (const round of BRACKET_ROUND_ORDER) {
    const matches = tournamentDb.getRoundMatches(round);
    if (!matches.length) return null; // next round not generated yet and nothing upstream triggered it - shouldn't happen, stop rather than guess
    const pending = matches.find(m => m.status === 'pending');
    if (pending) return activateBracketMatch(round, pending.slot, pending.token_a, pending.token_b);
    if (!matches.every(m => m.status === 'done')) return null; // one match still 'current' - caller should have completed it first

    if (round === 'sf') {
      if (!tournamentDb.getRoundMatches('third').length) {
        const loser = m => (m.winner === m.token_a ? m.token_b : m.token_a);
        tournamentDb.insertBracketMatch('third', 0, loser(matches[0]), loser(matches[1]));
        tournamentDb.insertBracketMatch('final', 0, matches[0].winner, matches[1].winner);
      }
    } else if (round === 'r16' || round === 'qf') {
      const next = round === 'r16' ? 'qf' : 'sf';
      if (!tournamentDb.getRoundMatches(next).length) {
        for (let i = 0; i * 2 + 1 < matches.length; i++) {
          tournamentDb.insertBracketMatch(next, i, matches[i * 2].winner, matches[i * 2 + 1].winner);
        }
      }
    }
    // round fully done with nothing new to generate ('third', or 'final') - keep scanning forward
  }
  return null; // every round including 'final' is done
}

// One button, one step: finish whatever's currently live (if anything),
// then start the next match - seeding the R16 bracket from the qualifying
// Top 16 on the very first call. "One battle at a time" end to end.
router.post('/tournament/admin/advance-knockout', requireAdmin, (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const phase = tournamentDb.getPhase();
    if (phase === 'qualifying') {
      const top16 = tournamentDb.getTopEntrants(16);
      if (top16.length < 16) {
        return res.status(400).json({ error: `Need 16 qualified entrants to start the knockout stage (currently ${top16.length}).` });
      }
      for (let i = 0; i < 8; i++) {
        const a = top16[BRACKET_SEED_ORDER[i * 2] - 1].token_id;
        const b = top16[BRACKET_SEED_ORDER[i * 2 + 1] - 1].token_id;
        tournamentDb.insertBracketMatch('r16', i, a, b);
      }
      tournamentDb.setKnockoutStarted();
    } else if (phase === 'knockout') {
      if (tournamentDb.getCurrentBracketMatch()) tournamentDb.completeCurrentBracketMatch();
    } else {
      return res.status(400).json({ error: 'Tournament is not in the qualifying or knockout phase.' });
    }

    const activated = findAndActivateNext();
    if (!activated) tournamentDb.setTournamentComplete();
    res.json({ ok: true, phase: tournamentDb.getPhase(), activated: activated || null });
  } catch (err) {
    console.error('advance-knockout error:', err.message);
    res.status(500).json({ error: 'Could not advance the bracket right now.' });
  }
});

module.exports = { router };
