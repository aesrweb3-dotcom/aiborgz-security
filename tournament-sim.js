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

module.exports = { simulateQualifying, hashStr, mulberry32 };
