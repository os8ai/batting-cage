import { TIERS } from '../../src/core/constants';
import { resolveContact } from '../../src/core/contact/contactModel';
import { projectCarryFt } from '../../src/core/physics/projection';
import { mulberry32, pitchRng, type Rng } from '../../src/core/rng';
import { medalFor, medalRank, MEDALS } from '../../src/core/rules/progression';
import { pointsFor } from '../../src/core/rules/scoring';
import type { Medal, TierMph } from '../../src/core/types';

/**
 * The M4 tuning oracle (M4-PLAN §3.2): a synthetic player driving the REAL
 * judgment chain — resolveContact → projectCarryFt → pointsFor → medalFor —
 * with press error ε ~ N(bias, σ). σ is the skill knob on the §6 window
 * ladder's own scale (novice ≈ 55–70 ms, practiced ≈ 30–40, elite ≈ 15–20);
 * a small per-round σ improvement models first-session practice.
 *
 * The pitch clock is skipped deliberately: medal outcomes depend only on the
 * judged ε stream, and the analytic judgment path is exactly what the sim
 * runs (sim.queueSwing computes ε then calls this same chain). 200 seeded
 * rounds per (tier, σ) cell run in milliseconds instead of sim-minutes.
 *
 * The oracle FOCUSES tuning and guards regressions; the §14.22–.24 contract
 * remains owner playtests (M4-PLAN §3.3).
 */

export interface OracleRound {
  score: number;
  totalCarryFt: number;
  bestCarryFt: number;
  medal: Medal | null;
  contacts: number;
}

/** One standard-normal draw (Box–Muller, two uniform draws from rng). */
export function gauss(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng(); // avoid log(0)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export interface PlayerParams {
  /** Press-error stddev, ms — the skill knob. */
  sigmaMs: number;
  /** Systematic press bias, ms (late-leaning novices press positive). */
  biasMs?: number;
}

/**
 * One 10-pitch round through the real rules chain. `seed` plays the save-id
 * role and `round` the round counter, so per-pitch jitter streams match the
 * sim's derivation exactly.
 */
export function simulateRound(
  tier: TierMph,
  player: PlayerParams,
  seed: number,
  round: number,
  pressRng: Rng
): OracleRound {
  const bias = player.biasMs ?? 0;
  let score = 0;
  let totalCarry = 0;
  let bestCarry = 0;
  let contacts = 0;
  for (let pitch = 1; pitch <= 10; pitch++) {
    const epsMs = bias + player.sigmaMs * gauss(pressRng);
    const outcome = resolveContact(tier, epsMs, tier, pitchRng(seed, round, pitch));
    let carryFt: number | null = null;
    if (outcome.grade !== 'MISS' && outcome.grade !== 'FOUL') {
      carryFt = projectCarryFt(outcome.evMph!, outcome.laDeg!, outcome.sprayDeg!);
      totalCarry += carryFt;
      if (carryFt > bestCarry) bestCarry = carryFt;
      contacts++;
    } else if (outcome.grade === 'FOUL') {
      contacts++;
    }
    score += pointsFor(outcome.grade, carryFt);
  }
  return {
    score,
    totalCarryFt: totalCarry,
    bestCarryFt: bestCarry,
    medal: medalFor(tier, score, totalCarry),
    contacts,
  };
}

export interface MedalProbs {
  bronze: number;
  silver: number;
  gold: number;
  platinum: number;
  medianScore: number;
}

/** P(round earns ≥ medal) per medal over n seeded rounds at fixed σ. */
export function medalProbabilities(
  tier: TierMph,
  player: PlayerParams,
  rounds: number,
  seed = 0xbc04
): MedalProbs {
  const reached = [0, 0, 0, 0];
  const scores: number[] = [];
  const pressRng = mulberry32(seed ^ 0x5eed);
  for (let r = 1; r <= rounds; r++) {
    const out = simulateRound(tier, player, seed, r, pressRng);
    scores.push(out.score);
    if (out.medal !== null) {
      for (let m = 0; m <= medalRank(out.medal); m++) reached[m]!++;
    }
  }
  scores.sort((a, b) => a - b);
  return {
    bronze: reached[0]! / rounds,
    silver: reached[1]! / rounds,
    gold: reached[2]! / rounds,
    platinum: reached[3]! / rounds,
    medianScore: scores[Math.floor(rounds / 2)]!,
  };
}

/**
 * §14.22 first-session proxy: synthetic novices (σ0, improving `improve`×
 * per round) each play `roundsPerSession` rounds at 40 mph; returns the
 * fraction that earn bronze at least once.
 */
export function noviceFirstSessionBronzeRate(opts: {
  sigma0Ms: number;
  biasMs?: number;
  improvePerRound?: number; // multiplicative σ decay per round, e.g. 0.95
  roundsPerSession?: number;
  players?: number;
  seed?: number;
}): number {
  const improve = opts.improvePerRound ?? 0.95;
  const roundsPerSession = opts.roundsPerSession ?? 3;
  const players = opts.players ?? 200;
  const seed = opts.seed ?? 0xf1e7;
  let earned = 0;
  for (let p = 0; p < players; p++) {
    const pressRng = mulberry32((seed + p * 7919) >>> 0);
    let sigma = opts.sigma0Ms;
    for (let r = 1; r <= roundsPerSession; r++) {
      const out = simulateRound(
        40,
        { sigmaMs: sigma, biasMs: opts.biasMs ?? 0 },
        (seed ^ (p * 2654435761)) >>> 0,
        r,
        pressRng
      );
      if (out.medal !== null) {
        earned++;
        break;
      }
      sigma *= improve;
    }
  }
  return earned / players;
}

/**
 * The ladder probe: the largest σ on a 1 ms grid whose per-round bronze
 * probability is ≥ targetP at the tier. "σ needed for bronze rises smoothly
 * tier to tier" ⇔ this value falls smoothly 40 → 90.
 */
export function maxSigmaForBronze(
  tier: TierMph,
  targetP = 0.5,
  rounds = 150,
  loMs = 5,
  hiMs = 140
): number {
  // P(bronze) is monotone-decreasing in σ (up to sampling noise): bisect.
  let lo = loMs;
  let hi = hiMs;
  if (medalProbabilities(tier, { sigmaMs: hi }, rounds).bronze >= targetP) return hi;
  if (medalProbabilities(tier, { sigmaMs: lo }, rounds).bronze < targetP) return 0;
  while (hi - lo > 1) {
    const mid = Math.round((lo + hi) / 2);
    if (medalProbabilities(tier, { sigmaMs: mid }, rounds).bronze >= targetP) lo = mid;
    else hi = mid;
  }
  return lo;
}

export { TIERS, MEDALS };
export type { TierMph, Medal };
