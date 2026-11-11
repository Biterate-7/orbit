/**
 * Generation survey: builds a few thousand seeded levels and prints variety, difficulty and
 * survivability statistics. Development aid - the assertions live in tests/.
 *
 *   npx vite-node scripts/survey.ts -- [levels=600] [sim=1]
 */
import { getCatalogue } from '../src/astronomy/database/catalogue';
import { ENVIRONMENTS, hostPools } from '../src/generation/environments';
import { EMPTY_PROGRESS, recordEncounter, selectEncounter } from '../src/generation/encounterSelector';
import type { RunHistory } from '../src/generation/encounterSelector';
import { buildLevel, generateLevelFromSeed, levelSignature, rollEncounter } from '../src/generation/levelGenerator';
import { candidateSeed, hash32 } from '../src/generation/seed';
import { simulateLevel } from '../tests/harness';

const total = Number(process.argv[2] ?? 600);
const sim = process.argv[3] !== '0';
const cat = getCatalogue();
console.log(`catalogue v${cat.version}: ${cat.size} objects`);
const pools = hostPools(cat);
console.log('host pools:', ENVIRONMENTS.map((e) => `${e.id}=${pools.get(e.id)?.length ?? 0}`).join(' '));

// ---- journeys: what a player actually meets
const runs = 30;
const depth = 40;
const envCount = new Map<string, number>();
const first: Record<string, number[]> = {};
for (let r = 0; r < runs; r++) {
  let history: RunHistory = { environments: [], objects: [], sinceRare: 0 };
  const line: string[] = [];
  for (let i = 1; i <= depth; i++) {
    const { encounter } = selectEncounter(hash32(r, 991), i, history, EMPTY_PROGRESS, cat);
    const level = buildLevel(encounter, new Set(), cat);
    history = recordEncounter(history, encounter, level.identity.objectId);
    envCount.set(encounter.env, (envCount.get(encounter.env) ?? 0) + 1);
    (first[encounter.env] ??= []).push(i);
    if (r < 2 && i <= 16) line.push(`${String(i).padStart(2, '0')} ${level.name} [${level.identity.environment}/${level.identity.objectName}/${level.identity.orbit}]`);
  }
  if (r < 2) console.log(`\nrun ${r}:\n  ${line.join('\n  ')}`);
}
console.log('\nenvironment share over', runs * depth, 'sectors:');
for (const e of ENVIRONMENTS) {
  const n = envCount.get(e.id) ?? 0;
  const firsts = first[e.id] ?? [];
  console.log(`  ${e.id.padEnd(18)} ${String(n).padStart(4)}  earliest sector ${firsts.length ? Math.min(...firsts) : '-'}`);
}

// ---- raw seeded levels: uniqueness and survivability
const signatures = new Set<string>();
const names = new Set<string>();
const fails: string[] = [];
const byEnv = new Map<string, { n: number; ok: number; minStab: number }>();
const started = Date.now();
for (let k = 0; k < total; k++) {
  const index = 1 + (k % 60);
  const seed = candidateSeed(0xc0ffee, index, k);
  const level = generateLevelFromSeed(seed, index, new Set(), cat);
  signatures.add(levelSignature(level));
  names.add(level.name);
  if (!sim) continue;
  const res = simulateLevel(level);
  const row = byEnv.get(level.identity.environment) ?? { n: 0, ok: 0, minStab: 100 };
  row.n++;
  if (res.survived) row.ok++;
  row.minStab = Math.min(row.minStab, res.minStability);
  byEnv.set(level.identity.environment, row);
  if (!res.survived) fails.push(`${level.code} ${level.identity.environment}/${level.identity.orbit} [${level.mechanicKeys.join(',')}] -> ${res.cause} @${res.time.toFixed(1)}s`);
}
console.log(`\n${total} seeded levels: ${signatures.size} distinct signatures, ${names.size} distinct names (${((Date.now() - started) / 1000).toFixed(1)}s)`);
if (sim) {
  console.log('autopilot survival (no incoming hazards):');
  for (const [env, row] of [...byEnv].sort()) console.log(`  ${env.padEnd(18)} ${row.ok}/${row.n}  min stability ${row.minStab.toFixed(0)}`);
  console.log(`failures: ${fails.length}`);
  for (const f of fails.slice(0, 40)) console.log('  ' + f);
}
void rollEncounter;
