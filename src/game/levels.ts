import { Rng } from './rng';
import type { BodyKind, BodySpec, LevelDef, LevelTheme, ModifierKind, MoonSpec } from './types';

interface BodyBase {
  radius: number;
  mu: number;
  heatRadius: number;
  heatDps: number;
  spin: number;
  safeMin: number;
  safeMax: number;
  start: number;
  hazardGravity: number;
  speedMul: number;
  native: ModifierKind[];
  label: string;
  words: string[];
  theme: LevelTheme;
}

const BODIES: Record<BodyKind, BodyBase> = {
  planet: {
    radius: 20,
    mu: 1.27e6,
    heatRadius: 0,
    heatDps: 0,
    spin: 0.08,
    safeMin: 56,
    safeMax: 168,
    start: 108,
    hazardGravity: 0.3,
    speedMul: 1,
    native: ['belt'],
    label: 'ROCKY PLANET',
    words: ['ROCK', 'STONE', 'GRANITE', 'BASALT'],
    theme: { bg: '#04050c', nebulaA: '#1d2a6b', nebulaB: '#0f3a5a', nebulaStrength: 0.35, accent: '#3ef2ff', ripple: '#3d6bff' },
  },
  redgiant: {
    radius: 40,
    mu: 2.4e6,
    heatRadius: 64,
    heatDps: 16,
    spin: 0.035,
    safeMin: 90,
    safeMax: 176,
    start: 140,
    hazardGravity: 0.42,
    speedMul: 1.05,
    native: ['flares'],
    label: 'RED GIANT',
    words: ['EMBER', 'CINDER', 'CRIMSON', 'ASH'],
    theme: { bg: '#0a0408', nebulaA: '#5a1424', nebulaB: '#6a2a10', nebulaStrength: 0.4, accent: '#ff8a3d', ripple: '#ff4d5e' },
  },
  neutron: {
    radius: 7,
    mu: 3.0e6,
    heatRadius: 34,
    heatDps: 12,
    spin: 0.6,
    safeMin: 70,
    safeMax: 172,
    start: 118,
    hazardGravity: 0.5,
    speedMul: 1.28,
    native: ['beams'],
    label: 'NEUTRON STAR',
    words: ['PULSE', 'NEEDLE', 'STROBE', 'SPARK'],
    theme: { bg: '#03070c', nebulaA: '#0f4a5a', nebulaB: '#1b2a6a', nebulaStrength: 0.38, accent: '#7ffcff', ripple: '#3ef2ff' },
  },
  blackhole: {
    radius: 13,
    mu: 3.4e6,
    heatRadius: 52,
    heatDps: 18,
    spin: 1.1,
    safeMin: 88,
    safeMax: 178,
    start: 130,
    hazardGravity: 0.65,
    speedMul: 1.1,
    native: [],
    label: 'BLACK HOLE',
    words: ['VOID', 'MAW', 'HOLLOW', 'NULL'],
    theme: { bg: '#030209', nebulaA: '#3a1460', nebulaB: '#5a2a14', nebulaStrength: 0.42, accent: '#b77dff', ripple: '#9b5cff' },
  },
  gasgiant: {
    radius: 27,
    mu: 1.9e6,
    heatRadius: 0,
    heatDps: 0,
    spin: 0.16,
    safeMin: 68,
    safeMax: 170,
    start: 116,
    hazardGravity: 0.38,
    speedMul: 1.05,
    native: ['fog', 'storm', 'debris'],
    label: 'GAS GIANT',
    words: ['VEIL', 'HAZE', 'DRIFT', 'SHADE'],
    theme: { bg: '#06040f', nebulaA: '#4b2a9a', nebulaB: '#1d4a9a', nebulaStrength: 0.85, accent: '#b77dff', ripple: '#9b5cff' },
  },
};

const MOD_WORDS: Record<ModifierKind, string[]> = {
  belt: ['BELT', 'RING'],
  asteroids: ['FIELD', 'RUBBLE', 'BELT'],
  flares: ['FLARE', 'CORONA'],
  beams: ['LANCE', 'BEACON'],
  fog: ['NEBULA', 'MIST', 'SHROUD'],
  storm: ['STORM', 'GALE'],
  debris: ['SCRAP', 'WRECK', 'SHARDS'],
  comets: ['COMET', 'SHOWER', 'STREAK'],
  waves: ['TIDE', 'WAVE', 'RIPPLE'],
  moon: ['BINARY', 'TWIN', 'ECLIPSE'],
};

export const MOD_LABEL: Record<ModifierKind, string> = {
  belt: 'ASTEROID BELT',
  asteroids: 'ASTEROID FIELD',
  flares: 'SOLAR FLARES',
  beams: 'PULSAR BEAMS',
  fog: 'NEBULA FOG',
  storm: 'ION STORMS',
  debris: 'DEBRIS SWARMS',
  comets: 'COMET SHOWERS',
  waves: 'GRAVITY WAVES',
  moon: 'BINARY MOON',
};

/** Which extra modifiers make sense for each body. */
const COMPATIBLE: Record<BodyKind, ModifierKind[]> = {
  planet: ['asteroids', 'comets', 'waves', 'storm', 'debris', 'moon', 'fog'],
  redgiant: ['asteroids', 'comets', 'waves', 'storm', 'debris', 'moon'],
  neutron: ['asteroids', 'comets', 'waves', 'debris', 'moon', 'fog'],
  blackhole: ['asteroids', 'comets', 'waves', 'debris', 'beams', 'fog', 'storm'],
  gasgiant: ['asteroids', 'comets', 'waves', 'moon'],
};

/** Hand-authored introduction order for the first five sectors. */
const AUTHORED: { kind: BodyKind; name: string; tagline: string }[] = [
  { kind: 'planet', name: 'ASTEROID BELT', tagline: 'DRIFTING ROCK. LEARN YOUR ORBIT.' },
  { kind: 'redgiant', name: 'RED GIANT', tagline: 'HEAT ZONES. STRONGER PULL. KEEP YOUR DISTANCE.' },
  { kind: 'neutron', name: 'NEUTRON STAR', tagline: 'DENSE CORE. PULSAR BEAMS SWEEP THE SECTOR.' },
  { kind: 'blackhole', name: 'BLACK HOLE', tagline: 'EVERYTHING FALLS IN. DO NOT FOLLOW IT.' },
  { kind: 'gasgiant', name: 'NEBULA', tagline: 'LOW VISIBILITY. ION STORMS. LOOSE DEBRIS.' },
];

export function difficultyFor(index: number): number {
  if (index <= 5) return 1 + 0.07 * (index - 1);
  return Math.min(2.05, 1.28 + 0.055 * (index - 5));
}

export function levelDuration(index: number): number {
  if (index === 1) return 32;
  if (index <= 5) return 42;
  return Math.min(56, 46 + (index - 6) * 1.5);
}

function makeMoon(base: BodyBase, mu: number, rng: Rng): MoonSpec {
  const orbitRadius = base.safeMax + rng.range(26, 36);
  const moonMu = mu * 0.022;
  // Moons move on rails (a fixed circular path) - the ship still feels their gravity.
  const angularSpeed = Math.sqrt(mu / orbitRadius) / orbitRadius * 0.85;
  return { orbitRadius, radius: 8, mu: moonMu, angularSpeed, phase: rng.range(0, Math.PI * 2) };
}

/**
 * Generate a level. Levels 1-5 are the authored introduction of each environment;
 * from level 6 onward environments and hazards are recombined procedurally.
 */
export function generateLevel(index: number, runSeed: number, prevKind: BodyKind | null, seen: Set<ModifierKind>): LevelDef {
  const seed = (runSeed * 31 + index * 7919) >>> 0;
  const rng = new Rng(seed);
  const d = difficultyFor(index);

  let kind: BodyKind;
  let name: string;
  let tagline: string;
  let classification: string;
  let modifiers: ModifierKind[];

  if (index <= AUTHORED.length) {
    const a = AUTHORED[index - 1];
    kind = a.kind;
    name = a.name;
    tagline = a.tagline;
    modifiers = [...BODIES[kind].native];
    classification = `SECTOR ${String(index).padStart(2, '0')} // ${BODIES[kind].label}`;
  } else {
    const kinds = (Object.keys(BODIES) as BodyKind[]).filter((k) => k !== prevKind);
    kind = rng.pick(kinds);
    const base = BODIES[kind];
    const extraCount = index < 9 ? 1 : index < 13 ? 2 : 3;
    const pool = rng.shuffle([...COMPATIBLE[kind]].filter((m) => !base.native.includes(m)));
    // Introduce never-seen hazards one at a time, first, so they get the spotlight.
    pool.sort((a, b) => Number(seen.has(a)) - Number(seen.has(b)));
    const extras = pool.slice(0, extraCount);
    // Gas giant natives are heavy; keep only fog + one other in mixes.
    const natives = kind === 'gasgiant' ? ['fog' as ModifierKind, rng.pick(['storm', 'debris'] as ModifierKind[])] : [...base.native];
    modifiers = [...natives, ...extras];
    const lead = extras[0] ?? natives[0] ?? 'asteroids';
    name = `${rng.pick(base.words)} ${rng.pick(MOD_WORDS[lead])}`;
    tagline = extras.map((m) => MOD_LABEL[m]).join(' + ') || base.label;
    classification = `SECTOR ${String(index).padStart(2, '0')} // ${base.label}`;
    // Black holes in deep space are often surrounded by asteroid fields.
    if (kind === 'blackhole' && !modifiers.includes('asteroids') && rng.chance(0.4)) modifiers.push('asteroids');
  }

  const base = BODIES[kind];
  const massScale = index <= 5 ? 1 : Math.min(1.22, 1 + 0.025 * (index - 5));
  const mu = base.mu * massScale;
  const body: BodySpec = {
    kind,
    radius: base.radius,
    mu,
    heatRadius: base.heatRadius,
    heatDps: base.heatDps * (index <= 5 ? 1 : 1.15),
    spin: base.spin,
  };

  const moon = modifiers.includes('moon') ? makeMoon(base, mu, rng) : null;

  // Shared thrust feel: partially compensate for faster orbital speeds around heavier bodies.
  const vStart = Math.sqrt(mu / base.start);
  const thrustScale = Math.pow(vStart / 108, 0.7);

  const dense = modifiers.includes('asteroids');
  const baseInterval: [number, number] = kind === 'planet' ? [2.5, 1.45] : [3.0, 1.9];
  const intervalScale = (dense ? 0.58 : 1) / Math.pow(d, 0.85);
  const asteroidInterval: [number, number] = [
    Math.max(0.55, baseInterval[0] * intervalScale),
    Math.max(0.45, baseInterval[1] * intervalScale),
  ];
  const speedScale = base.speedMul * Math.pow(d, 0.45);
  const asteroidSpeed: [number, number] = [30 * speedScale, 54 * speedScale];
  const large = Math.min(0.35, 0.12 + 0.025 * (index - 1));
  const asteroidSizeWeights: [number, number, number] = [0.48 - large * 0.4, 0.4, large];

  const newMechanics = modifiers.filter((m) => !seen.has(m) && index > 1).map((m) => MOD_LABEL[m]);

  return {
    index,
    seed,
    name,
    tagline,
    classification,
    body,
    moon,
    safeMin: base.safeMin,
    safeMax: base.safeMax,
    startRadius: base.start,
    outerLimit: 212,
    duration: levelDuration(index),
    difficulty: d,
    hazardGravity: base.hazardGravity,
    thrustScale,
    asteroidInterval,
    asteroidSpeed,
    asteroidSizeWeights,
    modifiers,
    newMechanics,
    theme: base.theme,
  };
}

/** A calm level used for the animated main-menu background. */
export function menuLevel(): LevelDef {
  const lvl = generateLevel(1, 1234, null, new Set());
  return { ...lvl, modifiers: ['belt'], newMechanics: [] };
}
