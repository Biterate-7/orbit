/**
 * Mission layouts.
 *
 * planMission turns (mission kind, tier, the level built for the environment) into the concrete
 * objective layout: gate positions, belt gaps, corridor shapes, wormholes, pickups, boss numbers.
 * It is pure - everything is drawn from the level seed - and works in the mission frame (polar
 * coordinates around the barycentre with the ship starting at angle 0 travelling towards positive
 * angles), so a sector code still rebuilds the identical level.
 *
 * Geometry is derived from the level's own physics (its mass, band and body radius), so the same
 * mission type is laid out differently around a dwarf moon than around a red giant.
 */
import { CONFIG } from '../game/config';
import { MISSIONS, MUTATORS, VARIANT_INFO } from '../game/missions/catalog';
import type {
  Anchor,
  BonusSpec,
  CloudSpec,
  FieldSpec,
  GateSpec,
  MineSpec,
  MissionKind,
  MissionParams,
  MissionSpec,
  MutatorId,
  PickupSpec,
  RockBeltSpec,
  TargetSpec,
  VariantId,
  WaveSpec,
} from '../game/missions/types';
import type { Rng } from '../game/rng';
import type { CompanionSpec, LevelDef, ModifierKind } from '../game/types';
import { clamp, look } from './environments/common';
import { subRng } from './seed';

const TAU = Math.PI * 2;

/** A level as the environment built it, before the mission is attached. */
export type BaseLevel = Omit<LevelDef, 'mission'>;

export interface MissionPlan {
  mission: MissionSpec;
  /** Changes the mission makes to the environment's level (start orbit, companions, belts...). */
  patch: Partial<LevelDef>;
}

const NO_PARAMS: MissionParams = {
  quota: 0,
  growth: 0,
  escapeR: 0,
  captureR: 0,
  syncTime: 0,
  chargeTime: 0,
  fastRange: 0,
  enemyThrust: 0,
  enemyHp: 0,
  fireEvery: 0,
  boltSpeed: 0,
  surgeEvery: 0,
  surgeTime: 0,
  waveEvery: 0,
  nodes: [],
  overheat: 0,
  mouth: 0,
  count: 0,
  range: 0,
  hold: 0,
  hp: 0,
  period: 0,
};

const BONUS_LABEL: Record<BonusSpec['id'], string> = {
  nohit: 'NO HULL DAMAGE',
  par: 'BEAT PAR TIME',
  shards: 'COLLECT EVERY SHARD',
  assist: 'USE A GRAVITY ASSIST',
  fuel: 'FINISH WITH 40% FUEL',
  quota: 'OVERCHARGE 150% QUOTA',
  clean: 'CLEAN RUN - NO GATE CLIPS',
  noburn: 'NO ION BURNS',
  kill: 'DESTROY THE HUNTER',
  deep: 'DIVE BELOW THE PHOTON RING',
  feat: 'MISSION CHALLENGE',
  feat2: 'MISSION CHALLENGE',
};

const bonus = (...ids: BonusSpec['id'][]): BonusSpec[] => ids.map((id) => ({ id, label: BONUS_LABEL[id] }));

/** Angular speed of a circular orbit. */
const omegaAt = (mu: number, r: number): number => Math.sqrt(mu / (r * r * r));
const still = (r: number, angle: number): Anchor => ({ r, angle, omega: 0 });
const orbiting = (mu: number, r: number, angle: number, dir = 1): Anchor => ({ r, angle, omega: dir * omegaAt(mu, r) });

/** Thrust acceleration (u/s^2) the ship will have when it starts at `r`. */
function thrustAt(mu: number, r: number): number {
  return CONFIG.THRUST * Math.pow(Math.sqrt(mu / r) / 108, 0.7);
}

/** Delta-v of a tangential burn that raises the far side of a circular orbit from r1 to r2. */
function transferDv(mu: number, r1: number, r2: number): number {
  return Math.sqrt(mu / r1) * (Math.sqrt((2 * r2) / (r1 + r2)) - 1);
}

function emptyMission(kind: MissionKind, tier: number): MissionSpec {
  const info = MISSIONS[kind];
  return {
    kind,
    tier,
    title: tier > 1 && info.boss ? `${info.title} MK ${['I', 'II', 'III', 'IV', 'V'][Math.min(4, tier - 1)]}` : info.title,
    brief: info.summary.toUpperCase(),
    boss: info.boss,
    orbitRule: 'band',
    arena: 0,
    window: 0,
    par: 60,
    fuel: 0,
    fuelRegen: 0,
    preview: CONFIG.TRAJECTORY_TIME,
    ambient: 1,
    startR: 0,
    features: [],
    bonus: [],
    params: { ...NO_PARAMS, nodes: [] },
    waves: [],
    gates: [],
    targets: [],
    clouds: [],
    buoys: [],
    wormholes: [],
    fields: [],
    pickups: [],
    mines: [],
    rockBelts: [],
    mutators: [],
    variant: 'standard',
    reward: 1,
  };
}

/**
 * Is radius r clear of the environment's in-plane belts and of every moon's path? Objectives that
 * have to be flown to must never sit in a lane where something solid sweeps through.
 */
function laneFree(L: BaseLevel, r: number, margin: number): boolean {
  for (const b of L.mechanics.belts) {
    if (b.inclination === 0 && b.ecc < 0.05 && Math.abs(r - b.radius) < b.spread + margin) return false;
  }
  for (const c of L.companions) {
    const lo = c.orbitRadius * (1 - c.ecc) - c.radius - margin;
    const hi = c.orbitRadius * (1 + c.ecc) + c.radius + margin;
    if (r > lo && r < hi) return false;
  }
  return true;
}

/** The radius in [lo, hi] closest to `want` that is clear of belts and moon lanes. */
function clearRadius(L: BaseLevel, want: number, lo: number, hi: number, margin: number): number {
  for (let d = 0; d < hi - lo; d += 2) {
    for (const r of [want + d, want - d]) if (r >= lo && r <= hi && laneFree(L, r, margin)) return r;
  }
  return want;
}

/** Three shards spread around the band at awkward radii. */
function bandShards(rng: Rng, L: BaseLevel, from = 0.8): PickupSpec[] {
  const out: PickupSpec[] = [];
  const radii = [L.safeMin + 7, L.safeMax - 7, L.safeMin + (L.safeMax - L.safeMin) * rng.range(0.3, 0.7)];
  rng.shuffle(radii);
  for (let i = 0; i < 3; i++) out.push({ kind: 'shard', anchor: still(radii[i], from + i * 2.1 + rng.range(-0.4, 0.4)) });
  return out;
}

function mines(rng: Rng, mu: number, n: number, rMin: number, rMax: number): MineSpec[] {
  const out: MineSpec[] = [];
  for (let i = 0; i < n; i++) out.push({ anchor: orbiting(mu, rng.range(rMin, rMax), (i / n) * TAU + rng.range(0.4, 1.2), rng.chance(0.7) ? 1 : -1) });
  return out;
}

// ------------------------------------------------------------------ survival

function survival(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const count = Math.min(5, 1 + m.tier);
  const base = [14, 16, 14, 15, 16, 17];
  const streams = L.modifiers.filter((k): k is ModifierKind => ['asteroids', 'flares', 'storm', 'debris', 'comets', 'waves'].includes(k));
  const waves: WaveSpec[] = [];
  for (let i = 0; i < count; i++) {
    // Each wave switches on more of the sector's hazard systems and runs them hotter.
    const n = Math.ceil((streams.length * (i + 1)) / count);
    waves.push({ duration: base[i] + (m.tier >= 3 ? 1 : 0), mods: streams.slice(0, n), rate: 0.75 + 0.22 * i });
  }
  m.waves = waves;
  m.params.quota = count;
  m.title = count > 2 ? `SURVIVAL // ${count} WAVES` : 'SURVIVAL';
  m.brief = L.index <= 1 ? 'HOLD YOUR ORBIT BETWEEN THE RINGS. SURVIVE BOTH WAVES.' : `HOLD YOUR ORBIT THROUGH ${count} ESCALATING WAVES.`;
  m.bonus = bonus('nohit', 'shards');
  m.pickups = bandShards(rng, L);
  if (m.tier >= 3) {
    m.pickups.push({ kind: 'aegis', anchor: orbiting(L.orbitMu, (L.safeMin + L.safeMax) / 2, rng.range(0, TAU)) });
    m.features.push('aegis');
  }
  const duration = waves.reduce((s, w) => s + w.duration, 0) + (count - 1) * LULL;
  m.par = duration;
  return { duration };
}

/** Quiet seconds between survival waves. */
export const LULL = 3.5;

// ------------------------------------------------------------------ precision

function precision(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  const n = m.tier <= 1 ? 5 : m.tier === 2 ? 7 : 8;
  const gap = m.tier <= 1 ? 30 : m.tier === 2 ? 27 : 23;
  const lo = L.safeMin + 16;
  const hi = L.safeMax - 16;
  const maxStep = m.tier <= 1 ? 28 : 40;
  // Keep gates off the radii of the environment's own belts and moon lanes.
  const free = (r: number): boolean => laneFree(L, r, 14);
  // The first gate lies beyond the stretch flown during the intro card.
  let angle = 3.3;
  let r = L.startRadius;
  const gates: GateSpec[] = [];
  const pos = (g: GateSpec): [number, number] => [Math.cos(g.anchor.angle) * g.anchor.r, Math.sin(g.anchor.angle) * g.anchor.r];
  for (let i = 0; i < n; i++) {
    let next = r;
    for (let tries = 0; tries < 40; tries++) {
      next = clamp(r + rng.range(-maxStep, maxStep), lo, hi);
      // Gates on later laps must not sit on top of earlier ones.
      const px = Math.cos(angle) * next;
      const py = Math.sin(angle) * next;
      const crowded = gates.some((g) => {
        const [gx, gy] = pos(g);
        return Math.hypot(gx - px, gy - py) < gap + 26;
      });
      if (Math.abs(next - r) > maxStep * 0.35 && free(next) && !crowded) break;
      if (crowded) angle += 0.05;
    }
    r = next;
    const moving = m.tier >= 2 && rng.chance(0.45);
    gates.push({ anchor: still(r, angle), gap, osc: moving ? rng.range(6, 9) : 0, oscPeriod: rng.range(5, 7.5) });
    angle += rng.range(1.55, 2.15);
  }
  m.gates = gates;
  if (m.tier >= 2) m.features.push('movinggates');
  // Shards sit off the racing line, beside some of the gates.
  m.pickups = [];
  for (const g of rng.shuffle(gates.slice(1)).slice(0, 3)) {
    const side = g.anchor.r + (rng.chance(0.5) ? 1 : -1) * (gap / 2 + rng.range(14, 22));
    m.pickups.push({ kind: 'shard', anchor: still(clamp(side, L.safeMin + 5, L.safeMax - 5), g.anchor.angle - rng.range(0.35, 0.6)) });
  }
  if (m.tier >= 2) {
    // Magnetic regions between gates can bend a path into line - or out of it.
    const f: FieldSpec[] = [];
    for (let i = 0; i < m.tier - 1; i++) {
      const g = gates[2 + i * 2] ?? gates[gates.length - 1];
      f.push({ anchor: still(clamp(g.anchor.r + rng.range(-20, 20), lo, hi), g.anchor.angle - rng.range(0.6, 0.9)), r: rng.range(18, 24), turn: rng.sign() * rng.range(0.3, 0.5) });
    }
    m.fields = f;
    m.features.push('magfield');
  }
  if (m.tier >= 3) {
    m.mines = mines(rng, mu, 4, lo, hi);
    m.features.push('mines');
  }
  const mid = (L.safeMin + L.safeMax) / 2;
  const w = omegaAt(mu, mid);
  const travel = angle / w;
  const period = TAU / w;
  m.par = Math.round(travel * 1.55 + 6);
  m.window = Math.round(travel + period * 4 + 26);
  m.ambient = [0.15, 0.3, 0.45][Math.min(2, m.tier - 1)];
  m.bonus = bonus('clean', 'par', 'shards');
  m.brief = `FLY THROUGH ${n} GATES IN ORDER. MISS ONE AND COME AROUND AGAIN.`;
  return { duration: m.window };
}

// ------------------------------------------------------------------ extraction

function extraction(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  const quota = [16, 24, 30][Math.min(2, m.tier - 1)];
  m.params.quota = quota;
  m.params.captureR = 24;
  m.params.syncTime = m.tier <= 1 ? 1.5 : 2;
  const mid = (L.safeMin + L.safeMax) / 2;
  const dockR = clearRadius(L, clamp(mid + rng.range(-15, 15), L.safeMin + 20, L.safeMax - 20), L.safeMin + 20, L.safeMax - 20, 16);
  m.targets = [{ kind: 'dock', anchor: orbiting(mu, dockR, Math.PI + rng.range(-0.5, 0.5)), r: 24, hidden: true }];
  // Rich crystal cells sit where it hurts: the heat zone's edge, the ring plane, the band edges.
  const rich: number[] = [L.safeMin + 4, L.safeMax - 4];
  if (L.body.heatRadius > 0) rich.push(Math.max(L.body.heatRadius + 3, L.body.radius + 10));
  for (const z of L.mechanics.dragZones) rich.push(clamp((Math.max(z.rMin, L.safeMin) + z.rMax) / 2, L.safeMin, L.safeMax));
  for (const b of L.mechanics.belts) if (b.inclination === 0) rich.push(b.radius);
  m.pickups = [];
  const cells = 4 + m.tier;
  for (let i = 0; i < cells; i++) {
    const r = rich[i % rich.length] + rng.range(-3, 3);
    const a = rng.range(0, TAU);
    m.pickups.push({ kind: 'cell', anchor: i % 2 === 0 ? still(r, a) : orbiting(mu, r, a) });
  }
  m.pickups.push(...bandShards(rng, L, 1.6));
  m.features.push('dock');
  if (m.tier >= 2) {
    m.mines = mines(rng, mu, 3 + m.tier, L.safeMin + 10, L.safeMax - 10);
    m.features.push('mines');
  }
  if (m.tier >= 3) {
    m.fuel = 14;
    m.fuelRegen = 0.12;
    m.pickups.push({ kind: 'fuel', anchor: orbiting(mu, mid, rng.range(0, TAU)) });
    m.features.push('fuel');
  }
  m.window = 100 + 10 * m.tier;
  m.par = 42 + 8 * m.tier;
  m.ambient = 0.8;
  m.bonus = bonus('quota', 'nohit', 'shards');
  m.brief = `COLLECT ${quota} ENERGY, THEN MATCH ORBITS WITH THE EXTRACTION DOCK.`;
  return { duration: m.window, energyRichness: L.energyRichness * 1.5 };
}

// ------------------------------------------------------------------ asteroid run

/**
 * Climb from a circular orbit at r0 by burning prograde until the apoapsis reaches `apo`, then
 * coast; for each radius, report how long the ship spends within +-band of it and its angular
 * speed while there.
 */
function climbCrossings(mu: number, r0: number, thrust: number, apo: number, radii: number[], band: number): { time: number; omega: number }[] {
  let x = r0;
  let y = 0;
  let vx = 0;
  let vy = Math.sqrt(mu / r0);
  const out = radii.map(() => ({ time: 0, omega: 0, n: 0 }));
  const dt = 1 / 120;
  let burning = true;
  for (let i = 0; i < 30 / dt; i++) {
    const r = Math.hypot(x, y);
    const sp = Math.hypot(vx, vy);
    if (burning) {
      const energy = (sp * sp) / 2 - mu / r;
      const h = x * vy - y * vx;
      const ecc = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
      if (energy >= 0 || (-mu / (2 * energy)) * (1 + ecc) >= apo) burning = false;
    }
    let ax = (-mu * x) / (r * r * r);
    let ay = (-mu * y) / (r * r * r);
    if (burning) {
      ax += (vx / sp) * thrust;
      ay += (vy / sp) * thrust;
    }
    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;
    const rr = Math.hypot(x, y);
    radii.forEach((br, k) => {
      if (Math.abs(rr - br) < band) {
        out[k].time += dt;
        out[k].omega += (x * vy - y * vx) / (rr * rr);
        out[k].n++;
      }
    });
    if (!burning && (x * vx + y * vy) / rr < 0) break;
  }
  return out.map((c) => ({ time: Math.max(0.2, c.time), omega: c.n > 0 ? c.omega / c.n : 0 }));
}

function asteroidRun(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  m.orbitRule = 'free';
  m.arena = 320;
  const startR = Math.max(L.body.radius + 34, L.safeMin + 12);
  const exitR = 262;
  m.startR = startR;
  const exitAngle = Math.PI + rng.range(-0.6, 0.6);
  m.targets = [{ kind: 'gate', anchor: still(exitR, exitAngle), r: 18, hidden: false }];
  const beltCount = m.tier <= 1 ? 2 : 3;
  const spacing = [27, 22, 19][Math.min(2, m.tier - 1)];
  // How generously a gap outlasts the crossing: the higher the tier, the tighter the timing.
  const margin = [2.4, 1.9, 1.6][Math.min(2, m.tier - 1)];
  const large = m.tier >= 2 ? 1 : 0.4;
  const belts: RockBeltSpec[] = [];
  m.pickups = [];
  const band = (large > 0.5 ? 7 : 5.5) + CONFIG.SHIP_RADIUS + 1;
  const radii = Array.from({ length: beltCount }, (_, i) => startR + 40 + ((exitR - 40 - (startR + 40)) * i) / Math.max(1, beltCount - 1));
  // Fly the climb for real (finite thrust spirals out slowly through the inner belts) and time how
  // long it spends inside each belt's danger band.
  const crossings = climbCrossings(mu, startR, thrustAt(mu, startR), exitR, radii, band);
  for (let i = 0; i < beltCount; i++) {
    const r = radii[i];
    // The first run teaches timing on co-rotating belts; counter-rotating ones arrive at tier 2.
    const dir: 1 | -1 = m.tier <= 1 ? 1 : i % 2 === 0 ? -1 : 1;
    // Size each gap from the crossing it has to allow: time in the band times how fast the gap
    // sweeps past the ship (a counter-rotating belt sweeps past twice as fast), plus clearance.
    const c = crossings[i];
    const rel = Math.abs(c.omega - dir * omegaAt(mu, r));
    const width = clamp(rel * c.time * margin + (2 * band) / r, 0.5, 2.6);
    const gaps = [
      { angle: rng.range(0, TAU), width },
      { angle: rng.range(0, TAU), width: width * 0.55 },
    ];
    const count = Math.round((TAU * r) / spacing);
    belts.push({ radius: r, spread: 5, count, dir, gaps, large });
    // A shard rides in each narrow gap: collecting it means taking the hard line.
    if (i < 3) m.pickups.push({ kind: 'shard', anchor: { r, angle: gaps[1].angle, omega: dir * omegaAt(mu, r) } });
  }
  m.rockBelts = belts;
  if (m.tier >= 2) {
    // Alternative route: a wormhole from the inner lane to the far side of the field, guarded by mines.
    const wa = rng.range(1.2, 2.2);
    const out = exitAngle + rng.sign() * rng.range(0.7, 1.0);
    m.wormholes = [{ a: still(startR + 20, wa), b: still(exitR - 34, out), r: 10 }];
    m.mines = Array.from({ length: 3 }, (_, i) => ({ anchor: still(exitR - 30 + rng.range(-14, 14), out + (i - 1) * 0.22) }));
    m.features.push('wormhole', 'mines');
  }
  m.window = 90;
  m.par = 26 + 6 * m.tier;
  m.preview = 5;
  m.ambient = 0.35;
  m.bonus = bonus('nohit', 'par', 'shards');
  m.brief = 'RAISE YOUR ORBIT THROUGH THE GAPS IN THE BELTS AND REACH THE JUMP GATE.';
  const v = Math.sqrt(mu / startR);
  // Moons would sweep straight through the belts: the field is cleared of them.
  return { startRadius: startR, duration: m.window, thrustScale: Math.pow(v / 108, 0.7), mechanics: { ...L.mechanics, belts: [] }, companions: [] };
}

// ------------------------------------------------------------------ slingshot

function slingshot(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.body.mu;
  m.orbitRule = 'free';
  m.arena = 345;
  const startR = Math.max(L.body.radius + 30, L.safeMin + 14);
  m.startR = startR;
  const targetR = 292;
  m.targets = [{ kind: 'beacon', anchor: still(targetR, rng.range(0, TAU)), r: 24, hidden: false }];
  // Not enough fuel to burn straight out: a flyby has to make up the difference.
  const need = transferDv(mu, startR, targetR) / thrustAt(mu, startR);
  m.fuel = Math.round(need * [0.85, 0.75, 0.68][Math.min(2, m.tier - 1)] * 100) / 100;
  m.fuelRegen = 0.035;
  const planets: CompanionSpec[] = [];
  const count = m.tier <= 1 ? 1 : 2;
  const colors = [
    ['#ffd890', '#c07a3a', '#4a2414'],
    ['#9fd8ff', '#3d6bff', '#121a4a'],
  ];
  for (let i = 0; i < count; i++) {
    const a = i === 0 ? 168 : 222;
    // Heavy enough to bend a flyby by tens of degrees, light enough not to drag the inner orbit
    // around: companions ride fixed rails, so their pull on the inner system is not cancelled.
    const pmu = mu * (i === 0 ? 0.045 : 0.035);
    const ecc = i === 1 ? 0.12 : 0;
    planets.push({
      kind: 'planet',
      name: null,
      orbitRadius: a,
      ecc,
      argPeri: rng.range(0, TAU),
      period: TAU * Math.sqrt((a * a * a) / mu),
      phase: rng.range(0, TAU),
      radius: i === 0 ? 10 : 8,
      mu: pmu,
      heatRadius: 0,
      heatDps: 0,
      look: look('bands', colors[i], { rim: '#e8f0ff', glow: colors[i][1], glowIntensity: 0.4 }),
    });
  }
  m.features.push('fuel', 'planets');
  m.pickups = [
    { kind: 'fuel', anchor: orbiting(mu, 118, rng.range(0, TAU)) },
    { kind: 'fuel', anchor: orbiting(mu, 212, rng.range(0, TAU)) },
  ];
  // Shards ride just outside the big planet's orbit: they reward a close pass.
  for (let i = 0; i < 3; i++) m.pickups.push({ kind: 'shard', anchor: orbiting(mu, 168 + (i - 1) * 26, (i * TAU) / 3 + rng.range(0, 1)) });
  if (m.tier >= 3) {
    m.fields = [{ anchor: still(targetR - 60, m.targets[0].anchor.angle + rng.range(-0.5, 0.5)), r: 34, turn: rng.sign() * 0.7 }];
    m.features.push('magfield');
  }
  m.window = 85;
  m.par = 28 + 4 * m.tier;
  m.preview = 7.5;
  m.ambient = 0.2;
  m.bonus = bonus('assist', 'fuel', 'shards');
  m.brief = 'FUEL IS SHORT. SWING PAST THE MOVING PLANET TO REACH THE BEACON.';
  const v = Math.sqrt(mu / startR);
  return {
    startRadius: startR,
    companions: planets,
    duration: m.window,
    thrustScale: Math.pow(v / 108, 0.7),
    mechanics: { ...L.mechanics, belts: [] },
  };
}

// ------------------------------------------------------------------ event horizon

function eventHorizon(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.body.mu;
  m.orbitRule = 'free';
  m.arena = 335;
  const startR = Math.max(L.body.heatRadius + 24, L.safeMin - 6);
  m.startR = startR;
  m.params.escapeR = 285;
  m.params.growth = [0.009, 0.012, 0.014][Math.min(2, m.tier - 1)];
  const need = transferDv(mu, startR, m.params.escapeR) / thrustAt(mu, startR);
  // Frame dragging and the growing mass eat into every burn, so the tank is sized above the ideal.
  m.fuel = Math.round(need * [1.7, 1.4, 1.22][Math.min(2, m.tier - 1)] * 100) / 100;
  m.pickups = [130, 175, 225].map((r) => ({ kind: 'fuel' as const, anchor: orbiting(mu, r, rng.range(0, TAU)) }));
  m.pickups.push({ kind: 'shard', anchor: orbiting(mu, L.body.heatRadius + 9, rng.range(0, TAU)) });
  m.pickups.push({ kind: 'shard', anchor: still(200, rng.range(0, TAU)) });
  m.pickups.push({ kind: 'shard', anchor: still(262, rng.range(0, TAU)) });
  m.features.push('fuel', 'growth');
  m.window = 0;
  m.par = 26 + 4 * m.tier;
  m.preview = 6;
  m.ambient = 0.5;
  m.bonus = bonus('nohit', 'par', 'shards');
  m.brief = 'THE HOLE IS GROWING. BURN AT PERIAPSIS AND CLIMB PAST THE SAFE RING.';
  const v = Math.sqrt(mu / startR);
  return { startRadius: startR, duration: 120, thrustScale: Math.pow(v / 108, 0.7) };
}

// ------------------------------------------------------------------ nebula

/**
 * Fly a reference route with the ship's real engine: start on a circular orbit at r0 and angle
 * a0, and for each stage burn prograde until the apoapsis reaches its target, then coast to that
 * apoapsis. Corridors traced from a real flight are always flyable, however deep the well.
 */
function referenceFlight(mu: number, r0: number, a0: number, thrust: number, stages: number[]): { x: number; y: number }[] {
  let x = Math.cos(a0) * r0;
  let y = Math.sin(a0) * r0;
  const v0 = Math.sqrt(mu / r0);
  let vx = -Math.sin(a0) * v0;
  let vy = Math.cos(a0) * v0;
  const out: { x: number; y: number }[] = [];
  const dt = 1 / 120;
  for (const target of stages) {
    let burning = true;
    for (let i = 0; i < 60 / dt; i++) {
      const r = Math.hypot(x, y);
      const sp = Math.hypot(vx, vy);
      const energy = (sp * sp) / 2 - mu / r;
      const h = x * vy - y * vx;
      const ecc = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (mu * mu)));
      const apo = energy < 0 ? (-mu / (2 * energy)) * (1 + ecc) : Infinity;
      if (burning && apo >= target) burning = false;
      const vr = (x * vx + y * vy) / r;
      if (!burning && vr <= 0) break;
      const g = -mu / (r * r * r);
      let ax = g * x;
      let ay = g * y;
      if (burning) {
        ax += (vx / sp) * thrust;
        ay += (vy / sp) * thrust;
      }
      vx += ax * dt;
      vy += ay * dt;
      x += vx * dt;
      y += vy * dt;
      const last = out[out.length - 1];
      if (!last || Math.hypot(last.x - x, last.y - y) > 4) out.push({ x, y });
    }
  }
  out.push({ x, y });
  return out;
}

const rotate = (p: { x: number; y: number }, a: number): { x: number; y: number } => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
});

function nebula(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  m.orbitRule = 'free';
  m.arena = 320;
  const startR = Math.max(L.body.radius + 34, L.safeMin + 14);
  m.startR = startR;
  const exitR = 252;
  const midR = (startR + exitR) / 2 + rng.range(-10, 10);
  const thrust = thrustAt(mu, startR);
  // Route A: one long burn straight out. Route B: two shorter climbs via a middle orbit - narrower,
  // starting from the far side of the orbit, and carrying the shards. Both end at the same beacon.
  const a0 = 2.1 + rng.range(-0.3, 0.3);
  const routeA = referenceFlight(mu, startR, a0, thrust, [exitR]);
  const endA = routeA[routeA.length - 1];
  const rawB = referenceFlight(mu, startR, 0, thrust, [midR, exitR]);
  const endB = rawB[rawB.length - 1];
  const turnB = Math.atan2(endA.y, endA.x) - Math.atan2(endB.y, endB.x);
  const routeB = rawB.map((p) => rotate(p, turnB));
  const exitAngle = Math.atan2(endA.y, endA.x);
  m.params.mouth = a0;
  m.targets = [{ kind: 'beacon', anchor: still(Math.hypot(endA.x, endA.y), exitAngle), r: 22, hidden: false }];
  const wide = m.tier <= 1 ? 42 : 36;
  const narrow = m.tier <= 1 ? 32 : 28;
  const path = [...routeA.map((p) => ({ ...p, w: wide })), ...routeB.map((p) => ({ ...p, w: narrow }))];
  const clouds: CloudSpec[] = [];
  const inner = startR + 24;
  const outer = exitR + 34;
  const want = m.tier <= 1 ? 120 : 150;
  for (let tries = 0; tries < want * 12 && clouds.length < want; tries++) {
    const r = Math.sqrt(rng.range(inner * inner, outer * outer));
    const a = rng.range(0, TAU);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    const cr = rng.range(10, 21);
    if (Math.hypot(x - endA.x, y - endA.y) < 36 + cr) continue;
    if (path.some((p) => Math.hypot(p.x - x, p.y - y) < p.w / 2 + cr)) continue;
    if (clouds.some((c) => Math.hypot(c.x - x, c.y - y) < (c.r + cr) * 0.55)) continue;
    clouds.push({ x, y, r: cr });
  }
  m.clouds = clouds;
  m.buoys = [];
  routeA.forEach((p, i) => {
    if (i % 4 === 0 && Math.hypot(p.x, p.y) > inner - 6) m.buoys.push({ x: p.x, y: p.y, alt: false });
  });
  routeB.forEach((p, i) => {
    if (i % 5 === 0 && Math.hypot(p.x, p.y) > inner - 6) m.buoys.push({ x: p.x, y: p.y, alt: true });
  });
  m.pickups = [0.35, 0.6, 0.85].map((f) => {
    const p = routeB[Math.floor(routeB.length * f)];
    return { kind: 'shard' as const, anchor: still(Math.hypot(p.x, p.y), Math.atan2(p.y, p.x)) };
  });
  m.params.surgeEvery = [12, 10, 8.5][Math.min(2, m.tier - 1)];
  m.params.surgeTime = 2.6;
  m.features.push('ionsurge');
  if (m.tier >= 2) {
    // A magnetic region parked beside the main route: drift into it and it bends you into the gas.
    const p = routeA[Math.floor(routeA.length * 0.55)];
    const side = rotate(p, rng.sign() * 0.22);
    m.fields = [{ anchor: still(Math.hypot(side.x, side.y), Math.atan2(side.y, side.x)), r: 22, turn: rng.sign() * 0.45 }];
    m.features.push('magfield');
  }
  m.window = 95;
  m.par = 30 + 5 * m.tier;
  m.preview = 6;
  m.ambient = 0.25;
  m.bonus = bonus('noburn', 'par', 'shards');
  m.brief = 'FOLLOW THE BUOYS THROUGH THE GAS. ION SURGES WILL INVERT YOUR CONTROLS.';
  const v = Math.sqrt(mu / startR);
  return { startRadius: startR, duration: m.window, thrustScale: Math.pow(v / 108, 0.7), mechanics: { ...L.mechanics, belts: [] } };
}

// ------------------------------------------------------------------ pursuit

function pursuit(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  m.orbitRule = 'free';
  m.arena = 310;
  m.params.chargeTime = [36, 44, 50][Math.min(2, m.tier - 1)];
  m.params.fastRange = 165;
  m.params.enemyThrust = 1.45 + 0.1 * (m.tier - 1);
  m.params.enemyHp = 3;
  m.params.fireEvery = [2.5, 2.1, 1.8][Math.min(2, m.tier - 1)];
  m.params.boltSpeed = 92;
  m.features.push('hunter');
  m.pickups = bandShards(rng, L, 2.4);
  m.pickups.push({ kind: 'repair', anchor: orbiting(L.orbitMu, L.safeMax - 12, rng.range(0, TAU)) });
  if (m.tier >= 2) {
    m.pickups.push({ kind: 'aegis', anchor: orbiting(L.orbitMu, L.safeMin + 16, rng.range(0, TAU)) });
    m.mines = mines(rng, L.orbitMu, 4, L.safeMin + 10, L.safeMax);
    m.features.push('aegis', 'mines');
  }
  m.window = 0;
  m.par = Math.round(m.params.chargeTime * 0.72);
  m.preview = 4.5;
  m.ambient = 0.7;
  m.bonus = bonus('kill', 'nohit', 'shards');
  m.brief = 'A HUNTER IS CLOSING. STAY ALIVE WHILE THE JUMP DRIVE CHARGES - FASTER AT RANGE.';
  return { duration: 120 };
}

// ------------------------------------------------------------------ bosses

function bossNeutron(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  m.params.nodes = m.tier <= 1 ? [1, 2, 2] : [2, 2, 3];
  m.params.captureR = 30;
  m.params.syncTime = m.tier <= 1 ? 2.4 : 2.8;
  m.params.waveEvery = m.tier <= 1 ? 6.5 : 5.5;
  // Nodes sit well inside the band: matching one must never force the ship out of it.
  const radii = [L.safeMin + 34, L.safeMax - 34, (L.safeMin + L.safeMax) / 2];
  m.targets = [];
  m.params.nodes.forEach((n, phase) => {
    for (let i = 0; i < n; i++) {
      const r = clearRadius(L, radii[(phase + i) % radii.length] + rng.range(-6, 6), L.safeMin + 24, L.safeMax - 24, 16);
      const node: TargetSpec = { kind: 'dock', anchor: orbiting(mu, r, Math.PI * (0.6 + i) + rng.range(-0.4, 0.4)), r: 30, hidden: true, phase };
      m.targets.push(node);
    }
  });
  m.features.push('dock', 'waves2');
  m.pickups = [{ kind: 'aegis', anchor: orbiting(mu, (L.safeMin + L.safeMax) / 2, rng.range(0, TAU)) }];
  m.window = 0;
  m.par = 70 + 10 * m.tier;
  m.ambient = 0.35;
  m.bonus = bonus('nohit', 'par');
  m.brief = 'MATCH ORBITS WITH EACH STABILISER NODE. HOLD STEADY AS THE WAVES HIT.';
  // The core fires its own waves; the generic shock-wave system is switched off.
  return { duration: 200, modifiers: L.modifiers.filter((k) => k !== 'waves') };
}

function bossDevourer(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  m.orbitRule = 'free';
  m.arena = 330;
  const startR = Math.min(L.safeMax - 10, 172);
  m.startR = startR;
  m.params.growth = 0.0055 + 0.0015 * (m.tier - 1);
  m.params.surgeEvery = 9.5 - m.tier;
  m.params.surgeTime = 3;
  m.params.nodes = [1, 1, 1];
  m.features.push('growth', 'surge');
  m.pickups = [{ kind: 'aegis', anchor: orbiting(L.body.mu, 210, rng.range(0, TAU)) }];
  m.window = 0;
  m.par = 80 + 10 * m.tier;
  m.preview = 5;
  m.ambient = 0.4;
  m.bonus = bonus('nohit', 'par');
  m.brief = 'PICK UP EACH CHARGE AND CARRY IT DOWN TO THE PHOTON RING. THEN CLIMB BACK OUT.';
  const v = Math.sqrt(L.body.mu / startR);
  return { startRadius: startR, duration: 200, thrustScale: Math.pow(v / 108, 0.7) };
}

function bossSentinel(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  m.orbitRule = 'free';
  m.arena = 305;
  m.params.enemyThrust = 1.7 + 0.12 * (m.tier - 1);
  m.params.enemyHp = 3;
  m.params.fireEvery = 2.1 - 0.2 * (m.tier - 1);
  m.params.boltSpeed = 100;
  m.params.overheat = 1.6 + 0.25 * (m.tier - 1);
  m.features.push('hunter', 'aegis');
  m.pickups = [0, 1].map((i) => ({ kind: 'aegis' as const, anchor: orbiting(L.orbitMu, L.safeMax - 14, i * Math.PI + rng.range(0, 1)) }));
  m.pickups.push({ kind: 'repair', anchor: orbiting(L.orbitMu, (L.safeMin + L.safeMax) / 2, rng.range(0, TAU)) });
  m.window = 0;
  m.par = 85 + 10 * m.tier;
  m.preview = 4.5;
  m.ambient = 0.3;
  m.bonus = bonus('nohit', 'par');
  m.brief = 'IT IS BUILT FOR VACUUM, NOT FIRE. LURE IT THROUGH THE CORONA UNTIL IT OVERHEATS.';
  return { duration: 200 };
}

// ------------------------------------------------------------------ binary star navigation

/** Period of the pair at the heart of a binary level (the primary's own path, else its companion star's). */
function binaryPeriod(L: BaseLevel): number {
  if (L.body.orbit) return Math.abs(L.body.orbit.period);
  const star = L.companions.find((c) => c.kind === 'star');
  return star ? Math.abs(star.period) : 12;
}

function binaryNav(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  const n = m.tier <= 1 ? 5 : m.tier === 2 ? 6 : 7;
  // Wide gates, kept to the outer two thirds of the band: close in, the pair's shifting pull
  // swings an orbit by more than any gate could allow for.
  const gap = m.tier <= 1 ? 40 : m.tier === 2 ? 36 : 32;
  const lo = L.safeMin + Math.max(22, 0.34 * (L.safeMax - L.safeMin));
  const hi = L.safeMax - 20;
  const period = binaryPeriod(L);
  // Each gate rides the tide the two stars raise: it breathes in and out twice per binary orbit.
  const tide = clamp(period / 2, 4.5, 9);
  let angle = 3.2;
  let r = clamp(L.startRadius, lo, hi);
  const gates: GateSpec[] = [];
  for (let i = 0; i < n; i++) {
    let next = r;
    for (let tries = 0; tries < 30; tries++) {
      // Gentle steps: the pull of two moving stars already bends every transfer.
      const step = i === 0 ? 16 : m.tier <= 1 ? 24 : 30;
      next = clamp(r + rng.range(-step, step), lo, hi);
      if (Math.abs(next - r) > 8 && laneFree(L, next, 14)) break;
    }
    r = next;
    gates.push({ anchor: still(r, angle), gap, osc: m.tier <= 1 ? 4 : rng.range(5, 8), oscPeriod: tide });
    angle += rng.range(1.7, 2.3);
  }
  m.gates = gates;
  m.params.count = n;
  // The mass-transfer stream between the stars flares along their axis on this beat.
  m.params.period = clamp(period * 0.75, 7, 13) - (m.tier - 1) * 0.8;
  m.params.range = 0.2 + 0.03 * Math.min(3, m.tier);
  m.pickups = [];
  for (const g of rng.shuffle(gates.slice(1)).slice(0, 3)) {
    const side = g.anchor.r + (rng.chance(0.5) ? 1 : -1) * (gap / 2 + rng.range(14, 20));
    m.pickups.push({ kind: 'shard', anchor: still(clamp(side, L.safeMin + 5, L.safeMax - 5), g.anchor.angle - rng.range(0.35, 0.6)) });
  }
  if (m.tier >= 3) {
    m.fields = [{ anchor: still(clamp(gates[3].anchor.r + rng.range(-18, 18), lo, hi), gates[3].anchor.angle - 0.8), r: 22, turn: rng.sign() * 0.4 }];
    m.features.push('magfield');
  }
  m.features.push('tidalgates', 'masstransfer');
  const w = omegaAt(mu, (L.safeMin + L.safeMax) / 2);
  const travel = angle / w;
  m.par = Math.round(travel * 1.6 + 8);
  m.window = Math.round(travel + (TAU / w) * 4 + 30);
  m.ambient = 0.2;
  m.bonus = bonus('clean', 'par', 'shards');
  m.brief = `THREAD ${n} TIDAL GATES AROUND THE PAIR. THE STREAM BETWEEN THE STARS FLARES ALONG THEIR AXIS.`;
  return { duration: m.window, mechanics: { ...L.mechanics, stream: { period: m.params.period, halfWidth: m.params.range } } };
}

// ------------------------------------------------------------------ solar flare avoidance

function flareRun(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.body.mu;
  const width = L.safeMax - L.safeMin;
  // The shield world rides low in the band on a real Keplerian orbit; its shadow reaches outward.
  const rp = L.safeMin + clamp(width * 0.28, 16, 34);
  const named = L.companions.find((c) => c.kind === 'planet' && c.name);
  const shield: CompanionSpec = {
    kind: 'planet',
    name: named?.name ?? null,
    orbitRadius: rp,
    ecc: 0,
    argPeri: 0,
    period: TAU * Math.sqrt((rp * rp * rp) / mu),
    phase: rng.range(0, TAU),
    radius: 7,
    // Very light: it has to shade the ship, not capture it - the shelter is flown right beside it.
    mu: mu * 0.0008,
    heatRadius: 0,
    heatDps: 0,
    look: named?.look ?? look('rock', ['#d8c8b0', '#8a6f5a', '#2a1d18'], { rim: '#ffd890', glow: '#ffb347', glowIntensity: 0.3 }),
  };
  m.startR = clamp(rp + 18, L.safeMin + 14, L.safeMax - 14);
  // The shadow laps a ship on the starting lane once per synodic period. At tier 1 the flares keep
  // that same beat - hold the lane and the shadow is overhead each time; later tiers fire faster
  // than the shadow comes round, so the lane has to be changed between flares.
  const synodic = TAU / (Math.sqrt(mu / (rp * rp * rp)) - Math.sqrt(L.orbitMu / (m.startR * m.startR * m.startR)));
  m.params.count = [3, 4, 5][Math.min(2, m.tier - 1)];
  m.params.period = synodic * [1, 0.84, 0.72][Math.min(2, m.tier - 1)];
  m.params.hold = synodic;
  m.params.range = [0.55, 0.48, 0.42][Math.min(2, m.tier - 1)];
  m.params.hp = [30, 36, 42][Math.min(2, m.tier - 1)];
  m.pickups = bandShards(rng, L, 1.2);
  if (m.tier >= 2) {
    m.pickups.push({ kind: 'aegis', anchor: orbiting(mu, L.safeMax - 14, rng.range(0, TAU)) });
    m.features.push('aegis');
  }
  m.features.push('superflare', 'shadow');
  m.window = Math.round(m.params.count * m.params.period + synodic + 22);
  m.par = m.window - 8;
  m.ambient = 0.45;
  m.bonus = [{ id: 'feat', label: 'SHELTERED FROM EVERY SUPERFLARE' }, ...bonus('shards')];
  m.brief = `${m.params.count} SUPERFLARES ARE COMING. BE BEHIND THE PLANET - IN ITS SHADOW - EACH TIME ONE FIRES.`;
  const v = Math.sqrt(mu / m.startR);
  return {
    startRadius: m.startR,
    // Other in-band companions would turn the shelter into a pinball table; distant ones stay.
    companions: [shield, ...L.companions.filter((c) => c !== named && c.orbitRadius * (1 - c.ecc) - c.radius > L.safeMax + 16)],
    duration: m.window,
    thrustScale: Math.pow(v / 108, 0.7),
    modifiers: L.modifiers.includes('flares') ? L.modifiers : [...L.modifiers, 'flares'],
    mechanics: { ...L.mechanics, belts: L.mechanics.belts.filter((b) => Math.abs(b.radius - rp) > b.spread + 20) },
  };
}

// ------------------------------------------------------------------ wormhole traversal

function wormholeRun(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.body.mu;
  m.orbitRule = 'free';
  m.arena = 345;
  const startR = Math.max(L.body.radius + 30, L.safeMin + 14);
  m.startR = startR;
  // Shelves: the start orbit, the middle orbit(s), the beacon's orbit. Each hop is one wormhole.
  const hops = m.tier <= 1 ? 2 : 3;
  const shelves = hops === 2 ? [startR + 26, 188, 276] : [startR + 26, 160, 222, 284];
  const wh: MissionSpec['wormholes'] = [];
  let angle = rng.range(2.4, 3.2);
  for (let i = 0; i < hops; i++) {
    const out = angle + rng.range(1.8, 4.2);
    // After the first, each mouth sits a little off the orbit the last one releases you on: a trim, not a climb.
    const offset = i === 0 ? 0 : rng.sign() * rng.range(9, 13);
    wh.push({ a: still(shelves[i] + offset, angle), b: still(shelves[i + 1], out), r: 11, circular: true });
    // The next mouth lies further along the orbit the ship comes out on.
    angle = out + rng.range(1.5, 2.6);
  }
  if (m.tier >= 2) {
    // A decoy sits right on the middle shelf, ahead of the true mouth: sidestep it or be dropped back to the start.
    const mid = wh[1];
    wh.push({ a: still(shelves[1], mid.a.angle - 0.75), b: still(startR + 8, rng.range(0, TAU)), r: 8, circular: true });
    m.features.push('decoy');
  }
  m.wormholes = wh;
  m.params.count = hops;
  const beaconR = shelves[shelves.length - 1];
  m.targets = [{ kind: 'beacon', anchor: still(beaconR, angle), r: 22, hidden: false }];
  // Fuel for lining up on mouths and trimming orbits - about two thirds of what a direct climb to the beacon costs.
  const direct = transferDv(mu, startR, beaconR) / thrustAt(mu, startR);
  m.fuel = Math.round(direct * [0.64, 0.57, 0.5][Math.min(2, m.tier - 1)] * 100) / 100;
  m.fuelRegen = 0.04;
  // The spare fuel cell sits off the shelf: fetching it costs a trim of its own.
  m.pickups = [{ kind: 'fuel', anchor: still(shelves[1] + 16, wh[0].b.angle + 0.9) }];
  for (let i = 0; i < 3; i++) {
    const shelf = shelves[Math.min(shelves.length - 1, i + (hops === 2 ? 0 : 1))];
    m.pickups.push({ kind: 'shard', anchor: still(shelf + (i % 2 ? -15 : 15), rng.range(0, TAU)) });
  }
  if (m.tier >= 3) {
    m.mines = Array.from({ length: 3 }, (_, i) => ({ anchor: orbiting(mu, shelves[2] + rng.range(-10, 10), (i * TAU) / 3) }));
    m.features.push('mines');
  }
  m.features.push('wormhole', 'fuel');
  m.window = 115 + 15 * (hops - 2);
  m.par = 44 + 12 * (hops - 2);
  m.preview = 6;
  m.ambient = 0.15;
  m.bonus = bonus('fuel', 'par', 'shards');
  m.brief = `THE BEACON IS BEYOND YOUR FUEL. CHAIN ${hops} WORMHOLES - MATCHING COLOURS LINK - TO REACH IT.`;
  const v = Math.sqrt(mu / startR);
  return { startRadius: startR, duration: m.window, thrustScale: Math.pow(v / 108, 0.7), mechanics: { ...L.mechanics, belts: [] }, companions: [] };
}

// ------------------------------------------------------------------ gravitational anomaly

function anomalyMission(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const n = [4, 5, 6][Math.min(2, m.tier - 1)];
  const half = [10, 9, 8][Math.min(2, m.tier - 1)];
  const lo = L.safeMin + half + 8;
  const hi = L.safeMax - half - 8;
  // Lane radii: each a real change of orbit from the one before, none on a belt or a moon's path.
  const lanes: number[] = [];
  let r = L.startRadius;
  for (let i = 0; i < n; i++) {
    let next = r;
    for (let tries = 0; tries < 30; tries++) {
      next = Math.round(clamp(r + rng.sign() * rng.range(16, 40), lo, hi));
      if (Math.abs(next - r) >= 14 && laneFree(L, next, half + 4)) break;
    }
    lanes.push(next);
    r = next;
  }
  m.params.nodes = lanes;
  m.params.count = n;
  m.params.range = half;
  m.params.hold = [5, 5.5, 6][Math.min(2, m.tier - 1)];
  // How hard the central mass breathes, and how often it throws a wave.
  m.params.growth = [0.07, 0.1, 0.13][Math.min(2, m.tier - 1)];
  m.params.period = 9;
  m.params.waveEvery = [13, 11, 9.5][Math.min(2, m.tier - 1)];
  m.pickups = bandShards(rng, L, 1.4);
  m.features.push('resonance', 'breathing', 'waves2');
  m.window = Math.round(n * (m.params.hold + 15) + 24);
  m.par = Math.round(n * (m.params.hold + 8) + 6);
  m.ambient = 0.35;
  m.bonus = [{ id: 'feat', label: 'NEVER LOSE A LANE ONCE IT IS HALF CHARGED' }, ...bonus('par', 'shards')];
  m.brief = `THE MASS IS BREATHING. HOLD THE RESONANCE LANE UNTIL IT CHARGES, THEN FOLLOW IT - ${n} TIMES.`;
  return { duration: m.window };
}

// ------------------------------------------------------------------ escort

function escort(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  const mid = (L.safeMin + L.safeMax) / 2;
  const rc = clearRadius(L, clamp(mid + rng.range(-12, 12), L.safeMin + 22, L.safeMax - 22), L.safeMin + 22, L.safeMax - 22, 18);
  m.targets = [{ kind: 'convoy', anchor: orbiting(mu, rc, rng.range(0.9, 1.5)), r: 20, hidden: false, label: `TENDER ${String.fromCharCode(65 + Math.floor(rng.next() * 26))}-${10 + Math.floor(rng.next() * 89)}` }];
  m.params.hp = 100;
  m.params.range = [36, 32, 29][Math.min(2, m.tier - 1)];
  m.params.hold = [38, 46, 54][Math.min(2, m.tier - 1)];
  m.params.period = [5.2, 4.4, 3.8][Math.min(2, m.tier - 1)];
  m.params.count = m.tier >= 2 ? 2 : 1;
  m.pickups = bandShards(rng, L, 2.0);
  m.pickups.push({ kind: 'repair', anchor: orbiting(mu, clamp(rc + 26, L.safeMin + 8, L.safeMax - 8), rng.range(0, TAU)) });
  if (m.tier >= 3) {
    m.mines = mines(rng, mu, 3, L.safeMin + 12, L.safeMax - 12);
    m.features.push('mines');
  }
  m.features.push('convoy', 'shieldlink');
  m.window = 0;
  m.par = m.params.hold;
  m.ambient = 0.5;
  m.bonus = [{ id: 'feat', label: 'TENDER TAKES NO DAMAGE' }, ...bonus('nohit', 'shards')];
  m.brief = 'A SURVEY TENDER IS CROSSING. FLY CLOSE: YOUR SHIELD LINK ABSORBS WHAT IS THROWN AT IT.';
  return { duration: m.params.hold + 20, startRadius: clamp(rc - 6, L.safeMin + 14, L.safeMax - 14) };
}

// ------------------------------------------------------------------ resource extraction (mining)

function mining(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  const quota = [3, 4, 5][Math.min(2, m.tier - 1)];
  const rocks = quota + 2;
  m.params.quota = quota;
  m.params.count = rocks;
  m.params.captureR = 22;
  m.params.hold = [2.4, 2.8, 3.2][Math.min(2, m.tier - 1)];
  m.params.syncTime = m.params.hold;
  const lo = L.safeMin + 12;
  const hi = L.safeMax - 12;
  // Rich veins sit where it hurts: hard against the inner edge (heat, drag) or the outer edge.
  const rich = [L.safeMin + 7, L.safeMax - 7];
  m.targets = [];
  for (let i = 0; i < rocks; i++) {
    const isRich = i < 2;
    const want = isRich ? rich[i] : lo + ((i - 2 + rng.range(0.15, 0.85)) / (rocks - 2)) * (hi - lo);
    const r = isRich ? want : clearRadius(L, want, lo, hi, 12);
    m.targets.push({ kind: 'ore', anchor: orbiting(mu, r, (i / rocks) * TAU + rng.range(0.5, 1.3)), r: 22, hidden: false, rich: isRich });
  }
  m.pickups = bandShards(rng, L, 1.7);
  if (m.tier >= 2) {
    m.mines = mines(rng, mu, 2 + m.tier, lo, hi);
    m.features.push('mines');
  }
  m.features.push('ore', 'drill');
  m.window = 105 + 15 * m.tier;
  m.par = 40 + 12 * m.tier;
  m.ambient = 0.7;
  m.bonus = [{ id: 'feat', label: 'CUT A RICH VEIN' }, ...bonus('nohit', 'shards')];
  m.brief = `MATCH ORBITS WITH ORE ROCKS AND CUT ${quota} LOADS. RICH VEINS (DOUBLE) HUG THE EDGES OF THE BAND.`;
  return { duration: m.window };
}

// ------------------------------------------------------------------ astronomical discovery

function discovery(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  // The source hides off the starting lane, towards one edge of the band.
  const inner = rng.chance(0.5);
  const want = inner ? L.safeMin + rng.range(14, 26) : L.safeMax - rng.range(14, 26);
  const r = clearRadius(L, want, L.safeMin + 12, L.safeMax - 12, 14);
  m.targets = [{ kind: 'signal', anchor: orbiting(mu, r, rng.range(1.6, 4.6)), r: 28, hidden: true }];
  m.params.range = [50, 44, 38][Math.min(2, m.tier - 1)];
  m.params.captureR = 24;
  m.params.hold = [4, 4.5, 5][Math.min(2, m.tier - 1)];
  m.pickups = bandShards(rng, L, 2.2);
  m.features.push('signal', 'scanlock');
  m.window = 135;
  m.par = 46 + 6 * m.tier;
  m.ambient = 0.55;
  m.bonus = bonus('par', 'nohit', 'shards');
  m.brief = 'AN UNLISTED SOURCE IS HIDING HERE. THE SIGNAL STRENGTHENS AS YOU CLOSE IN. FIND IT AND HOLD THE SCAN.';
  return { duration: m.window };
}

// ------------------------------------------------------------------ system survey

function survey(m: MissionSpec, L: BaseLevel, rng: Rng): Partial<LevelDef> {
  const mu = L.body.mu;
  let companions = L.companions;
  const worlds = (): number[] => companions.map((c, i) => (c.kind === 'star' ? -1 : i)).filter((i) => i >= 0);
  if (worlds().length < 2) {
    // A system with too few catalogued companions gets unnamed survey targets beyond the band.
    const extra: CompanionSpec[] = [];
    for (let i = worlds().length; i < 2; i++) {
      const a = L.safeMax + 26 + i * 24;
      extra.push({ kind: 'moon', name: null, orbitRadius: a, ecc: 0, argPeri: 0, period: TAU * Math.sqrt((a * a * a) / mu), phase: rng.range(0, TAU), radius: 6, mu: mu * 0.01, heatRadius: 0, heatDps: 0, look: look('rock', ['#c9c2d6', '#7a6d8a', '#2a2233']) });
    }
    companions = [...L.companions, ...extra];
  }
  const max = [3, 4, 5][Math.min(2, m.tier - 1)];
  const picked = worlds().slice(0, max);
  m.targets = picked.map((i) => {
    const c = companions[i];
    // The scan field reaches far enough to be flown from inside the band, however far out the world is.
    const near = clamp(c.orbitRadius, L.safeMin + 10, L.safeMax - 10);
    const range = Math.abs(c.orbitRadius - near) + c.radius + 27;
    return { kind: 'scan' as const, anchor: orbiting(mu, c.orbitRadius, c.phase, Math.sign(c.period) || 1), r: range, hidden: false, companion: i, label: c.name ?? `UNNAMED ${i + 1}` };
  });
  m.params.count = m.targets.length;
  m.params.hold = [2.2, 2.6, 3][Math.min(2, m.tier - 1)];
  m.pickups = bandShards(rng, L, 1.9);
  m.features.push('survey', 'flyby');
  m.window = 110 + 28 * m.targets.length;
  m.par = 30 + 16 * m.targets.length;
  m.preview = 5;
  m.ambient = 0.4;
  m.bonus = [{ id: 'feat', label: 'A CLOSE PASS: INSIDE 3 RADII OF A WORLD' }, ...bonus('nohit', 'shards')];
  m.brief = `FLY THROUGH THE SCAN FIELD OF ${m.targets.length} WORLDS. THE CLOSER THE PASS, THE FASTER THE SCAN.`;
  return companions === L.companions ? { duration: m.window } : { duration: m.window, companions };
}

// ------------------------------------------------------------------ twists and variants

/** Lay the director's twists over a planned mission. Each one adds something to fly around or to find. */
function applyTwists(m: MissionSpec, L: BaseLevel, patch: Partial<LevelDef>, rng: Rng): Partial<LevelDef> {
  const mu = L.orbitMu;
  const free = m.orbitRule === 'free';
  // Where loose things can be put: the band, or (travel missions) the space the climb passes through.
  const lo = free ? (m.startR || L.startRadius) + 18 : L.safeMin + 10;
  const hi = free ? Math.min(m.arena - 60, 230) : L.safeMax - 10;
  const somewhere = (): number => rng.range(lo, hi);
  const out: Partial<LevelDef> = { ...patch };
  for (const id of m.mutators) {
    switch (id) {
      case 'storm': {
        const mods = new Set<ModifierKind>(out.modifiers ?? L.modifiers);
        mods.add('flares');
        mods.add('waves');
        out.modifiers = [...mods];
        m.features.push('flares');
        break;
      }
      case 'lowfuel':
        if (m.fuel <= 0) {
          m.fuel = 12;
          m.fuelRegen = 0.28;
          m.pickups.push({ kind: 'fuel', anchor: orbiting(mu, somewhere(), rng.range(0, TAU)) });
          m.features.push('fuel');
        }
        break;
      case 'rich':
        out.energyRichness = (out.energyRichness ?? L.energyRichness) * 1.6;
        for (let i = 0; i < 2; i++) m.pickups.push({ kind: 'cell', anchor: orbiting(mu, somewhere(), rng.range(0, TAU)) });
        break;
      case 'mined':
        if (m.mines.length === 0) {
          m.mines = mines(rng, mu, 3, lo, hi);
          m.features.push('mines');
        }
        break;
      case 'wormholes':
        if (m.wormholes.length === 0 && !free) {
          const a = rng.range(0, TAU);
          m.wormholes = [{ a: still(L.safeMin + 20, a), b: still(L.safeMax - 20, a + Math.PI + rng.range(-0.6, 0.6)), r: 10 }];
          m.features.push('wormhole');
        }
        break;
      case 'magnetic':
        if (m.fields.length === 0) {
          m.fields = Array.from({ length: 2 }, () => ({ anchor: still(somewhere(), rng.range(0, TAU)), r: rng.range(18, 24), turn: rng.sign() * rng.range(0.3, 0.45) }));
          m.features.push('magfield');
        }
        break;
      case 'haste':
        if (m.window > 0) {
          m.window = Math.max(Math.round(m.par * 1.5 + 8), Math.round(m.window * 0.78));
          out.duration = m.window;
        }
        break;
      case 'dense':
        m.ambient = Math.max(0.5, m.ambient * 1.5);
        break;
      case 'aegis':
        if (!m.pickups.some((p) => p.kind === 'aegis')) {
          m.pickups.push({ kind: 'aegis', anchor: orbiting(mu, somewhere(), rng.range(0, TAU)) });
          m.features.push('aegis');
        }
        break;
      case 'salvage':
        m.pickups.push({ kind: 'repair', anchor: orbiting(mu, somewhere(), rng.range(0, TAU)) });
        m.pickups.push({ kind: 'shard', anchor: still(somewhere(), rng.range(0, TAU)) });
        break;
    }
  }
  if (m.variant === 'pristine') m.pickups.push({ kind: 'shard', anchor: orbiting(mu, somewhere(), rng.range(0, TAU)) });
  // Hidden supply caches: always in a pristine sector, otherwise in about half of them from sector 3.
  // They are only detectable - and only collectable - with a Deep-Space Scanner fitted.
  if (!m.boss && (m.variant === 'pristine' || (L.index >= 3 && rng.chance(0.5)))) {
    m.pickups.push({ kind: 'cache', anchor: orbiting(mu, somewhere(), rng.range(0, TAU), rng.chance(0.75) ? 1 : -1) });
  }
  m.features = [...new Set(m.features)];
  return out;
}

/** What a sector pays relative to a plain tier-1 mission: its difficulty, tier, variant and twists. */
export function rewardFor(kind: MissionKind, tier: number, mutators: readonly MutatorId[], variant: VariantId): number {
  const info = MISSIONS[kind];
  let r = 1 + 0.12 * (info.difficulty - 2) + 0.1 * (Math.max(1, tier) - 1) + VARIANT_INFO[variant].reward;
  for (const id of mutators) r += MUTATORS[id].reward;
  if (info.boss) r += 0.6;
  return Math.round(Math.max(0.6, r) * 100) / 100;
}

const PLANNERS: Record<MissionKind, (m: MissionSpec, L: BaseLevel, rng: Rng) => Partial<LevelDef>> = {
  survival,
  precision,
  extraction,
  asteroid_run: asteroidRun,
  slingshot,
  event_horizon: eventHorizon,
  nebula,
  pursuit,
  binary_nav: binaryNav,
  flare_run: flareRun,
  wormhole: wormholeRun,
  anomaly: anomalyMission,
  escort,
  mining,
  discovery,
  survey,
  boss_neutron: bossNeutron,
  boss_devourer: bossDevourer,
  boss_sentinel: bossSentinel,
};

export function planMission(kind: MissionKind, tier: number, level: BaseLevel, mutators: readonly MutatorId[] = [], variant: VariantId = 'standard'): MissionPlan {
  const rng = subRng(level.seed, `mission:${kind}`);
  const mission = emptyMission(kind, Math.max(1, tier));
  const allowed = MISSIONS[kind].mutators;
  mission.mutators = mutators.filter((id) => allowed.includes(id));
  mission.variant = MISSIONS[kind].boss ? 'standard' : variant;
  mission.reward = rewardFor(kind, mission.tier, mission.mutators, mission.variant);
  const planned = PLANNERS[kind](mission, level, rng);
  // Twists draw from their own stream, so adding one never shifts the base layout.
  const patch = applyTwists(mission, level, planned, subRng(level.seed, `twists:${kind}`));
  return { mission, patch };
}
