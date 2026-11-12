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
import { MISSIONS } from '../game/missions/catalog';
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
  PickupSpec,
  RockBeltSpec,
  TargetSpec,
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

const PLANNERS: Record<MissionKind, (m: MissionSpec, L: BaseLevel, rng: Rng) => Partial<LevelDef>> = {
  survival,
  precision,
  extraction,
  asteroid_run: asteroidRun,
  slingshot,
  event_horizon: eventHorizon,
  nebula,
  pursuit,
  boss_neutron: bossNeutron,
  boss_devourer: bossDevourer,
  boss_sentinel: bossSentinel,
};

export function planMission(kind: MissionKind, tier: number, level: BaseLevel): MissionPlan {
  const rng = subRng(level.seed, `mission:${kind}`);
  const mission = emptyMission(kind, Math.max(1, tier));
  const patch = PLANNERS[kind](mission, level, rng);
  return { mission, patch };
}
