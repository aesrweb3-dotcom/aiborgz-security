// Qualifying-stage simulation: random group assignment + full round-robin
// within each group, resolved as a plain coin-flip per match. Deliberately
// NOT stat-weighted - the existing Card Battle duel engine (tcg.html) is
// explicitly documented as "100% random - no stats, no rarity - everyone
// has the exact same chance," a design choice already made elsewhere in
// this project. Qualifying results honor that same philosophy instead of
// introducing a different, inconsistent rarity-favors-you model.
//
// Same mulberry32/hashStr PRNG already used client-side in tcg.html and
// regenesis-core.js, so this fits the project's existing "seeded, always
// reproducible from the same seed" pattern - anyone could independently
// replay this exact tournament from its stored season_seed and get the
// identical result.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// entrantIds: array of token IDs. Returns { seed, assignments, matches }
// ready to hand straight to tournament-database's saveQualifyingResults.
function simulateQualifying(entrantIds, seed) {
  seed = seed || Math.floor(Math.random() * 2 ** 31);
  const rng = mulberry32(hashStr('AIBORGZ-TOURNAMENT:' + seed));

  const shuffled = shuffle(entrantIds, rng);
  const groups = [[], [], [], []];
  shuffled.forEach((id, i) => groups[i % 4].push(id));

  const assignments = [];
  const matches = [];
  groups.forEach((group, idx) => {
    const groupNum = idx + 1;
    for (const tokenId of group) assignments.push({ tokenId, groupNum });
    // full round robin - every unique pair within this group plays once
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const tokenA = group[i], tokenB = group[j];
        const winner = rng() < 0.5 ? tokenA : tokenB;
        matches.push({ groupNum, tokenA, tokenB, winner });
      }
    }
  });

  return { seed, assignments, matches };
}

// Knockout-stage match simulation: a headless, seeded replay of tcg.html's
// HP duel engine (coin toss -> attack/attack -> possible event -> status
// ticks, repeat until someone hits 0). Every probability and damage formula
// below is copied verbatim from the client's attack()/rollEvent()/
// playEvent()/applyStatus()/tickStatus() (tcg.html) - this is the single
// authoritative computation of who wins, done once, here, at match-activate
// time. The client never rolls its own dice for a knockout match; it just
// replays this exact log through the same animation code with the outcome
// already decided, which is what makes "played and shown live" mean the
// same result for every viewer instead of a per-browser random reenactment.
//
// Sides are 'a'/'b' (token A / token B) rather than 'you'/'opp' since
// neither participant is "the viewer" for a spectated tournament match -
// the client maps a->you, b->opp once, right before launching playback.
function simulateKnockoutMatch(tokenA, tokenB, seed) {
  seed = seed || Math.floor(Math.random() * 2 ** 31);
  const rng = mulberry32(hashStr('AIBORGZ-KNOCKOUT:' + seed));

  let hpA = 100, hpB = 100;
  const fx = { a: { poison: 0 }, b: { poison: 0 } };
  const first = rng() < 0.5 ? 'a' : 'b';
  const order = first === 'a' ? ['a', 'b'] : ['b', 'a'];
  const rounds = [];

  const rollAttack = () => {
    const miss = rng() < 0.15;
    if (miss) return { miss: true, crit: false, dmg: 0 };
    const crit = rng() < 0.15;
    const dmg = crit ? 24 + Math.floor(rng() * 17) : 10 + Math.floor(rng() * 11);
    return { miss: false, crit, dmg };
  };
  const dead = () => hpA <= 0 || hpB <= 0;

  while (!dead()) {
    const attacks = [];
    for (const side of order) {
      const r = rollAttack();
      if (side === 'a') hpB = Math.max(0, hpB - r.dmg); else hpA = Math.max(0, hpA - r.dmg);
      attacks.push({ side, miss: r.miss, crit: r.crit, dmg: r.dmg });
      if (dead()) break;
    }
    if (dead()) { rounds.push({ attacks, event: null, ticks: [] }); break; }

    let event = null;
    if (rng() <= 0.24) {
      const low = Math.min(hpA, hpB);
      const pool = [];
      if (low >= 1 && low <= 60) pool.push('gain');
      if (low >= 40 && low <= 100) pool.push('drain');
      if (!fx.a.poison || !fx.b.poison) pool.push('fx');
      if (pool.length) {
        const kind = pool[Math.floor(rng() * pool.length)];
        if (kind === 'fx') {
          const clean = ['a', 'b'].filter(s => !fx[s].poison);
          const side = clean[Math.floor(rng() * clean.length)];
          const roundsLeft = 2 + Math.floor(rng() * 3);
          fx[side].poison = roundsLeft;
          event = { kind: 'fx', side, rounds: roundsLeft };
        } else {
          const amtA = 8 + Math.floor(rng() * 13), amtB = 8 + Math.floor(rng() * 13);
          if (kind === 'gain') { hpA = Math.min(100, hpA + amtA); hpB = Math.min(100, hpB + amtB); }
          else { hpA = Math.max(1, hpA - amtA); hpB = Math.max(1, hpB - amtB); }
          event = { kind, amtA, amtB };
        }
      }
    }
    if (dead()) { rounds.push({ attacks, event, ticks: [] }); break; }

    const ticks = [];
    for (const side of ['a', 'b']) {
      if (!fx[side].poison) continue;
      const dmg = 3 + Math.floor(rng() * 5);
      if (side === 'a') hpA = Math.max(0, hpA - dmg); else hpB = Math.max(0, hpB - dmg);
      fx[side].poison--;
      ticks.push({ side, dmg, left: fx[side].poison });
      if (dead()) break;
    }
    rounds.push({ attacks, event, ticks });
    if (dead()) break;
  }

  const winnerSide = hpA <= 0 ? 'b' : 'a';
  const winner = winnerSide === 'a' ? tokenA : tokenB;
  return { seed, first, rounds, winnerSide, winner };
}

module.exports = { simulateQualifying, simulateKnockoutMatch, hashStr, mulberry32 };
