// One-off precompute: real per-token rarity rank/tier + real traits, from the
// actual minted metadata in ./metadata/<id> (untracked in git - see .gitignore
// notes / README for where that comes from). Output ships as a static
// rarity-data.json next to tcg.html on the main site. Re-run this only if the
// metadata itself ever changes; nothing else depends on running it regularly.
//
// Algorithm: standard sum-of-inverse-frequency rarity score for the 3,278
// "normal" tokens (7 possible trait_types - Background/Outfit/Ears/Mouth/Eyes
// are universal, Weapons/Head are optional and neither penalized nor
// rewarded for being absent). The 55 special tokens (40 "Species" + 15 true
// 1-of-1 "Special") have a disjoint schema with none of those traits and are
// ranked 1-55 unconditionally ahead of every normal token. The existing 5
// RARITIES tiers' weights become cumulative, rounded percentile cutoffs over
// the full 1-3,333 rank - independently rounding each tier's own share does
// NOT reliably sum to 3,333, cumulative rounding does.
const fs = require('fs');
const path = require('path');

const METADATA_DIR = path.join(__dirname, 'metadata');
const OUT_PATH = path.join(__dirname, '..', 'AIBORGZ', 'rarity-data.json');
const SUPPLY = 3333;
const NORMAL_TRAITS = ['Background', 'Weapons', 'Outfit', 'Ears', 'Mouth', 'Eyes', 'Head'];
// Must match RARITIES' own order in tcg.html: [common, rare, epic, legendary, omega]
const TIER_WEIGHTS = [0.50, 0.27, 0.14, 0.075, 0.015];

const all = [];
for (let id = 1; id <= SUPPLY; id++) {
  const data = JSON.parse(fs.readFileSync(path.join(METADATA_DIR, String(id)), 'utf8'));
  const attrs = Object.fromEntries(data.attributes.map(a => [a.trait_type, a.value]));
  all.push({ id, attrs });
}

const special = all.filter(t => t.attrs.Special);
const species = all.filter(t => t.attrs.Species);
const normal = all.filter(t => !t.attrs.Special && !t.attrs.Species);
console.log(`special: ${special.length}, species: ${species.length}, normal: ${normal.length}, total: ${special.length + species.length + normal.length}`);

// per-trait-type value counts, over the normal tokens only
const counts = {};
NORMAL_TRAITS.forEach(t => counts[t] = {});
for (const t of normal) {
  for (const tt of NORMAL_TRAITS) {
    const v = t.attrs[tt];
    if (v === undefined) continue;
    counts[tt][v] = (counts[tt][v] || 0) + 1;
  }
}
const totalForTrait = {};
for (const tt of NORMAL_TRAITS) totalForTrait[tt] = Object.values(counts[tt]).reduce((a, b) => a + b, 0);

function scoreOf(attrs) {
  let score = 0;
  for (const tt of NORMAL_TRAITS) {
    const v = attrs[tt];
    if (v === undefined) continue;
    score += totalForTrait[tt] / counts[tt][v];
  }
  return score;
}
normal.forEach(t => { t.score = scoreOf(t.attrs); });
normal.sort((a, b) => b.score - a.score);

special.sort((a, b) => a.id - b.id);
species.sort((a, b) => a.id - b.id);

// final rank order: true 1-of-1s, then species groups, then normal by score desc
const ranked = [...special, ...species, ...normal];
if (ranked.length !== SUPPLY) throw new Error('ranked count mismatch: ' + ranked.length);

// cumulative-rounded tier cutoffs so they sum to exactly SUPPLY. Rank 1 is
// the RAREST (special/species first, then normal sorted by descending
// score), so cutoffs must be built rarest-tier-first (omega's 0.015 share
// first) even though TIER_WEIGHTS itself is written in RARITIES' own
// [common..omega] order - consume it reversed here.
const WEIGHTS_RARE_FIRST = [...TIER_WEIGHTS].reverse(); // [omega, legendary, epic, rare, common]
const cutoffs = [];
let cum = 0;
for (let i = 0; i < WEIGHTS_RARE_FIRST.length; i++) {
  cum += WEIGHTS_RARE_FIRST[i];
  cutoffs.push(i === WEIGHTS_RARE_FIRST.length - 1 ? SUPPLY : Math.round(SUPPLY * cum));
}
console.log('tier cutoffs (cumulative rank ceilings, rarest-first):', cutoffs);
const TIER_INDEX_BY_CUTOFF_SLOT = [4, 3, 2, 1, 0]; // omega, legendary, epic, rare, common
function tierIndexForRank(rank) {
  for (let i = 0; i < cutoffs.length; i++) {
    if (rank <= cutoffs[i]) return TIER_INDEX_BY_CUTOFF_SLOT[i];
  }
  return 0;
}

const out = {};
const tierCounts = [0, 0, 0, 0, 0];
ranked.forEach((t, i) => {
  const rank = i + 1;
  const tierIndex = tierIndexForRank(rank);
  tierCounts[tierIndex]++;
  out[t.id] = { rank, tierIndex, traits: t.attrs };
});
console.log('tier counts [common,rare,epic,legendary,omega]:', tierCounts);

// sanity: special/species tier distribution
const specSpeciesDist = {};
[...special.map(t => ({ ...t, kind: 'special' })), ...species.map(t => ({ ...t, kind: 'species' }))].forEach(t => {
  const key = t.kind + ':' + ['common', 'rare', 'epic', 'legendary', 'omega'][out[t.id].tierIndex];
  specSpeciesDist[key] = (specSpeciesDist[key] || 0) + 1;
});
console.log('special/species tier distribution:', specSpeciesDist);

fs.writeFileSync(OUT_PATH, JSON.stringify(out));
const bytes = fs.statSync(OUT_PATH).size;
console.log('wrote', OUT_PATH, '-', bytes, 'bytes', '(' + (bytes / 1024).toFixed(1) + ' KB)');

// spot-check a few
[1, 52, special[0].id, species[0].id, ranked[0].id, ranked[ranked.length - 1].id].forEach(id => {
  console.log('spot check #' + id + ':', JSON.stringify(out[id]));
});
