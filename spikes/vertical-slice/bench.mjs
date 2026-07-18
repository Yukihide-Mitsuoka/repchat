// In-process measurement of the §11 exit criteria: hit rate + latency.
// Simulates a realistic read mix: many viewers, occasional data refreshes.
// Run: node spikes/vertical-slice/bench.mjs
import { makeControlPlane, mintToken } from './control_plane.mjs';
import { makeGate } from './gate.mjs';

const cp = makeControlPlane();
const gate = makeGate(cp);
const users = ['alice', 'bob', 'bev', 'boris'];
const tokens = Object.fromEntries(users.map((u) => [u, mintToken(cp, u, { ttlSec: 3600 })]));
const REQ = { reportId: 'r_sales', queryId: 'q_sales_by_category' };

const N = 20_000;
const lat = new Float64Array(N);
for (let i = 0; i < N; i += 1) {
  if (i % 2000 === 1999) gate.bumpDataVersion('t_alpha'); // periodic ETL refresh
  const user = users[i % users.length];
  const t0 = performance.now();
  const res = await gate.requestData(tokens[user], REQ);
  lat[i] = performance.now() - t0;
  if (res.status !== 200) throw new Error(`unexpected ${res.status} at ${i}`);
}

const sorted = [...lat].sort((a, b) => a - b);
const pct = (p) => sorted[Math.floor((sorted.length - 1) * p)];
const { hits, misses, executorCalls } = gate.stats;
console.log(`requests        ${N}`);
console.log(`hit rate        ${((hits / (hits + misses)) * 100).toFixed(2)}%  (hits ${hits} / misses ${misses})`);
console.log(`executor calls  ${executorCalls} (one per scope×version, single-flight)`);
console.log(`p50 / p95 / p99 ${pct(0.5).toFixed(4)} / ${pct(0.95).toFixed(4)} / ${pct(0.99).toFixed(4)} ms (in-process)`);
