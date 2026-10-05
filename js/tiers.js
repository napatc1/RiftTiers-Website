// Tier -> point value. Higher tier = more points.
const TIER_POINTS = {
  HT1: 100, LT1: 90,
  HT2: 80,  LT2: 70,
  HT3: 60,  LT3: 50,
  HT4: 40,  LT4: 30,
  HT5: 20,  LT5: 10,
};

// Best-to-worst order, used for sorting a single gamemode leaderboard.
const TIER_ORDER = ["HT1", "LT1", "HT2", "LT2", "HT3", "LT3", "HT4", "LT4", "HT5", "LT5"];

// Every gamemode RyftTiers tracks. Add more here as you support them —
// nothing else in the codebase needs to change.
const GAMEMODES = [
  { id: "vanilla", label: "Vanilla", icon: "images/vanilla-icon.svg" },
  { id: "uhc",     label: "UHC",     icon: "images/uhc-icon.svg" },
  { id: "pot",     label: "Pot",     icon: "images/pot-icon.svg" },
  { id: "nethop",  label: "NethOP",  icon: "images/nethop-icon.svg" },
  { id: "smp",     label: "SMP",     icon: "images/smp-icon.svg" },
  { id: "sword",   label: "Sword",   icon: "images/sword-icon.svg" },
  { id: "axe",     label: "Axe",     icon: "images/axe-icon.svg" },
  { id: "mace",    label: "Mace",    icon: "images/mace-icon.svg" },
  { id: "cart",    label: "Cart",    icon: "images/cart-icon.svg" },
];

// Fixed region order used for the region tabs (regardless of what's in the data).
const REGIONS = ["NA", "EU", "AS", "ME", "AU"];

// Overall score: sum of a player's points across every gamemode they have a
// tier in. More gamemodes tested (and higher tiers) means a higher score \u2014
// this rewards being ranked in more gamemodes, not just being good at one.
function overallScore(player) {
  return Object.values(player.tiers).reduce(
    (sum, tier) => sum + (TIER_POINTS[tier] || 0),
    0
  );
}

// All players, ranked by overall score (highest first).
function getOverallLeaderboard(players) {
  return [...players].sort((a, b) => overallScore(b) - overallScore(a));
}

// Players in one region, ranked by overall score.
function getRegionLeaderboard(players, region) {
  return getOverallLeaderboard(players.filter((p) => p.region === region));
}

// Players who have a tier in one gamemode, ranked by that tier (not score).
function getGamemodeLeaderboard(players, gamemode) {
  return players
    .filter((p) => p.tiers && p.tiers[gamemode])
    .sort(
      (a, b) =>
        TIER_ORDER.indexOf(a.tiers[gamemode]) -
        TIER_ORDER.indexOf(b.tiers[gamemode])
    );
}


