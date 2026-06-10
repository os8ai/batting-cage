// M4 tuning sweep (M4-PLAN §3.2 / P0.3): prints the full medal-probability
// table — tier × σ × seeded rounds — through the real judgment chain, plus
// the ladder probe (max σ for 50% bronze) and the first-session novice rate.
// Usage: node scripts/tune-sweep.mjs [roundsPerCell]
// Vite's ssrLoadModule runs the TS oracle directly (same loader as vitest).
import { createServer } from 'vite';

const rounds = Number(process.argv[2] ?? 200);

const server = await createServer({
  configFile: 'vite.config.ts',
  server: { middlewareMode: true },
  logLevel: 'error',
});

try {
  const oracle = await server.ssrLoadModule('/tests/oracle/playerModel.ts');
  const tuning = await server.ssrLoadModule('/src/core/tuning.ts');
  const { TIERS, medalProbabilities, maxSigmaForBronze, noviceFirstSessionBronzeRate } = oracle;

  const SIGMAS = [70, 60, 50, 40, 30, 25, 20, 15, 12];
  const pct = (x) => `${Math.round(x * 100)}`.padStart(3) + '%';

  console.log(`tune-sweep — ${rounds} seeded rounds per cell, ε ~ N(0, σ)`);
  console.log(`medal thresholds in play:`);
  for (const t of TIERS) {
    const m = tuning.MEDAL_THRESHOLDS[t];
    console.log(
      `  ${t} mph  B ${m.bronze}  S ${m.silver}  G ${m.gold}  P ${m.platinum} (+${m.platinumCarryFt} ft)`
    );
  }

  for (const tier of TIERS) {
    console.log(`\n=== ${tier} mph ===`);
    console.log('  σ ms |  P(B)  P(S)  P(G)  P(Pt) | median score');
    for (const sigma of SIGMAS) {
      const p = medalProbabilities(tier, { sigmaMs: sigma }, rounds);
      console.log(
        `  ${String(sigma).padStart(4)} | ${pct(p.bronze)} ${pct(p.silver)} ${pct(p.gold)} ${pct(
          p.platinum
        )}  | ${String(p.medianScore).padStart(6)}`
      );
    }
  }

  console.log('\nladder probe — max σ (ms) with P(bronze) ≥ 50%:');
  const ladder = TIERS.map((t) => maxSigmaForBronze(t));
  console.log('  ' + TIERS.map((t, i) => `${t}→${ladder[i]}`).join('  '));

  const novice = noviceFirstSessionBronzeRate({ sigma0Ms: 65, biasMs: 10 });
  console.log(`\nnovice first-session bronze@40 (σ0 65 ms, bias +10, 3 rounds): ${pct(novice)}`);
} finally {
  await server.close();
}
