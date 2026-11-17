/**
 * The procedural level generator.
 *
 *   rollEncounter(seed, index)   which environment, hosted by which object
 *   buildLevel(encounter)        the complete playable level
 *
 * Both are pure: the same (catalogue, seed, index) always yields the same level, down to hazard
 * placement and colours. Run-specific concerns (which mechanics are new to the player, which
 * candidate seed gets picked) live outside, in the encounter selector.
 */
import { getCatalogue } from '../astronomy/database/catalogue';
import type { Catalogue } from '../astronomy/database/catalogue';
import { SOURCE_LABEL } from '../astronomy/database/schema';
import type { AstroObject } from '../astronomy/database/schema';
import type { CompanionSpec, IdentityKind, LevelDef, LevelMechanics, ModifierKind, Rarity } from '../game/types';
import { difficultyProfile } from './difficulty';
import { composeScene } from './environmentGenerator';
import { NO_MECHANICS, clamp, moon } from './environments/common';
import type { EnvBlueprint } from './environments/common';
import { ENVIRONMENTS, environment, hostPools, systemPools } from './environments';
import { getSystems, systemTypeLabel } from '../astronomy/systems/store';
import type { SystemCatalogue } from '../astronomy/systems/store';
import { SYSTEM_SOURCE_LABEL } from '../astronomy/systems/types';
import type { StarSystem } from '../astronomy/systems/types';
import { sampleWorlds } from './environments/systems';
import type { EnvId, EnvironmentDef } from './environments';
import { levelName, proceduralDesignation } from './naming';
import { configureOrbit } from './orbitalConfiguration';
import { hash32, levelCode, parseLevelCode, rendezvousPick, subRng } from './seed';
import { MISSIONS, MUTATORS, VARIANT_INFO, missionByCode, mutatorByCode, survivalTier } from '../game/missions/catalog';
import type { MutatorId, VariantId } from '../game/missions/types';
import { planMission } from './missionGenerator';
import type { MissionPick } from './missionDirector';

export const MOD_LABEL: Record<ModifierKind, string> = {
  belt: 'ORBITING DEBRIS',
  asteroids: 'ASTEROID FIELD',
  flares: 'STELLAR FLARES',
  beams: 'RADIATION BEAMS',
  fog: 'NEBULA FOG',
  storm: 'STORM FRONTS',
  debris: 'DEBRIS SWARMS',
  comets: 'COMET SHOWERS',
  waves: 'SHOCK WAVES',
  moon: 'GRAVITATING MOONS',
};

/** Labels for the environment-specific mechanics. */
export const MECH_LABEL: Record<string, string> = {
  ...MOD_LABEL,
  drag: 'ORBITAL DRAG',
  ring: 'RING PLANE',
  plume: 'CRYO-PLUME',
  eruptions: 'ERUPTIONS',
  scorch: 'SCORCHED SECTOR',
  dark: 'TOTAL DARKNESS',
  wind: 'STELLAR WIND',
  emp: 'MAGNETIC BURSTS',
  pulsation: 'PULSATING STAR',
  frameDrag: 'FRAME DRAGGING',
  season: 'PERIAPSIS CYCLE',
  inclined: 'INCLINED DEBRIS',
  binary: 'TWIN PRIMARIES',
  clusters: 'ROCK CLUSTERS',
  stream: 'ICE STREAM',
  donor: 'ACCRETION STREAM',
  muWobble: 'UNSTABLE MASS',
  jets: 'RELATIVISTIC JETS',
  fuel: 'LIMITED FUEL',
  wormhole: 'WORMHOLES',
  magfield: 'MAGNETIC FIELDS',
  mines: 'PROXIMITY MINES',
  aegis: 'AEGIS SHIELDS',
  movinggates: 'MOVING GATES',
  planets: 'MOVING PLANETS',
  ionsurge: 'ION SURGES',
  growth: 'GROWING HORIZON',
  hunter: 'HOSTILE CRAFT',
  dock: 'ORBITAL DOCKING',
  waves2: 'PULL WAVES',
  surge: 'GRAVITY SURGES',
  masstransfer: 'MASS-TRANSFER STREAM',
  worlds: 'PLANET LANES',
  widestar: 'COMPANION STAR',
  tidalgates: 'TIDAL GATES',
  superflare: 'SUPERFLARES',
  shadow: 'PLANET SHADOW',
  decoy: 'DECOY WORMHOLE',
  resonance: 'RESONANCE LANE',
  breathing: 'BREATHING MASS',
  convoy: 'CONVOY',
  shieldlink: 'SHIELD LINK',
  ore: 'ORE VEINS',
  drill: 'MINING LASER',
  signal: 'HIDDEN SIGNAL',
  scanlock: 'SCAN LOCK',
  survey: 'WORLD SURVEY',
  flyby: 'SCAN FLYBYS',
};

export interface Encounter {
  seed: number;
  index: number;
  env: EnvId;
  object: AstroObject | null;
  identity: IdentityKind;
  rarity: Rarity;
  /** Real star system hosting the sector (system environments), else null. */
  system?: StarSystem | null;
}

/** Sectors during which Solar System bodies are preferred as hosts. */
const HOME_SECTORS = 7;

function isSolarSystem(o: AstroObject): boolean {
  return o.source === 'JPL-HORIZONS' || o.source === 'JPL-SBDB';
}

/** How far out the journey has reached: 0 = Solar System ... 3 = extragalactic. */
function depthTarget(index: number): number {
  return Math.min(3, (index - 1) / 7);
}

/** Weight of an environment at a given sector: early sectors favour nearby space, later ones mix everything. */
export function environmentWeight(env: EnvironmentDef, index: number, ignoreMinLevel = false): number {
  if (env.minLevel > index && !ignoreMinLevel) return 0;
  const gap = env.depth - depthTarget(index);
  const near = Math.exp(-(gap * gap) / 1.6) + 0.1;
  const flat = clamp((index - 22) / 10, 0, 1);
  return env.weight * (near + (1 - near) * flat);
}

/**
 * Roll the environment and host for a sector. `allowed` restricts the environments to those a
 * mission can take place in (a mission's own requirements outrank the usual depth gating).
 */
export function rollEncounter(seed: number, index: number, catalogue: Catalogue = getCatalogue(), allowed: readonly EnvId[] = [], systems: SystemCatalogue = getSystems()): Encounter {
  const rng = subRng(seed, 'encounter');
  const constrained = allowed.length > 0;
  const sysPools = systemPools(systems);
  // A system environment with nothing to host it is simply not on offer.
  const offered = ENVIRONMENTS.filter((e) => !e.systemHosts || (sysPools.get(e.id)?.length ?? 0) > 0);
  const narrowed = constrained ? offered.filter((e) => allowed.includes(e.id)) : offered;
  const envPool = narrowed.length > 0 ? narrowed : offered;
  // Sector 1 is always a quiet rocky world: it is where the controls are learned.
  const env =
    index <= 1 && (!constrained || allowed.includes('rocky'))
      ? environment('rocky')
      : rng.weighted(envPool, envPool.map((e) => Math.max(constrained ? 1e-3 : 0, environmentWeight(e, index, constrained))));
  if (env.systemHosts) {
    let hosts = sysPools.get(env.id) ?? [];
    // The journey starts at home: early planetary-system sectors are the Solar System when it qualifies.
    const home = index <= HOME_SECTORS ? hosts.filter((s) => s.source === 'JPL-HORIZONS') : [];
    if (home.length > 0 && rng.next() < 0.6) hosts = home;
    const system = rendezvousPick(hash32(seed, 0x0b7ec7), hosts, (s) => s.id);
    return { seed, index, env: env.id, object: null, identity: 'REAL OBJECT', rarity: env.rarity, system };
  }
  let pool = hostPools(catalogue).get(env.id) ?? [];
  // The journey starts at home: the opening sectors draw on the Solar System wherever it has a
  // suitable body (the Moon, Mars, Io, Saturn, the Sun ...) before heading out to other systems.
  const home = index <= HOME_SECTORS ? pool.filter(isSolarSystem) : [];
  if (home.length > 0) pool = home;
  // Environments with few real hosts fall back to procedural variants more often, so they do not
  // keep revisiting the same handful of objects.
  const pReal = env.fictional ? 0 : home.length > 0 ? 0.96 : pool.length >= 8 ? 0.94 : pool.length >= 3 ? 0.75 : pool.length >= 1 ? 0.4 : 0;
  const object = rng.next() < pReal ? rendezvousPick(hash32(seed, 0x0b7ec7), pool, (o) => o.id) : null;
  return {
    seed,
    index,
    env: env.id,
    object,
    identity: object ? 'REAL OBJECT' : env.fictional ? 'FICTIONAL OBJECT' : 'PROCEDURAL VARIANT',
    rarity: env.rarity,
  };
}

function cloneMechanics(partial: Partial<LevelMechanics>): LevelMechanics {
  const m: LevelMechanics = { ...NO_MECHANICS, ...partial };
  m.belts = (partial.belts ?? []).map((b) => ({ ...b }));
  m.dragZones = (partial.dragZones ?? []).map((z) => ({ ...z }));
  return m;
}

/** Keys of everything that makes this level play the way it does. */
function collectMechanicKeys(modifiers: ModifierKind[], m: LevelMechanics, bp: EnvBlueprint): string[] {
  const keys: string[] = [...modifiers];
  if (m.beam?.jet) keys.push('jets');
  for (const z of m.dragZones) keys.push(z.style === 'ring' ? 'ring' : 'drag');
  if (m.plume) keys.push('plume');
  if (m.eruptions) keys.push('eruptions');
  if (m.scorch) keys.push('scorch');
  if (m.dark) keys.push('dark');
  if (m.wind) keys.push('wind');
  if (m.emp) keys.push('emp');
  if (m.pulsation) keys.push('pulsation');
  if (m.frameDrag > 0) keys.push('frameDrag');
  if (m.season) keys.push('season');
  if (m.belts.some((b) => b.inclination > 0)) keys.push('inclined');
  if (bp.body.orbit) keys.push('binary');
  if (bp.companions.some((c) => c.kind === 'planet')) keys.push('worlds');
  if (!bp.body.orbit && bp.companions.some((c) => c.kind === 'star') && bp.companions.some((c) => c.kind === 'planet')) keys.push('widestar');
  if (m.stream) keys.push('masstransfer');
  if (m.spawn !== 'edge') keys.push(m.spawn);
  if (m.muWobble) keys.push('muWobble');
  return [...new Set(keys)];
}

/** The mission a sector code without a mission suffix stands for. */
export function defaultMission(index: number): MissionPick {
  return { kind: 'survival', tier: survivalTier(index) };
}

export function buildLevel(
  enc: Encounter,
  seen: ReadonlySet<string> = new Set(),
  catalogue: Catalogue = getCatalogue(),
  pick: MissionPick = defaultMission(enc.index),
): LevelDef {
  const { seed, index, object } = enc;
  const env = environment(enc.env);
  const rng = subRng(seed, 'build');
  const diff = difficultyProfile(index);
  const d = diff.intensity;
  // A system environment always has a system behind it, even when the encounter was built by hand.
  const system = enc.system ?? (env.systemHosts ? (systemPools(getSystems()).get(env.id)?.[0] ?? null) : null);
  const bp = env.build({ rng, index, object, catalogue, system });

  const mechanics = cloneMechanics(bp.mechanics);
  const companions: CompanionSpec[] = bp.companions.map((c) => ({ ...c }));
  const safeMin = bp.safeMin;
  const safeMax = bp.safeMax;
  const width = safeMax - safeMin;

  // ---- mass grows with depth; rail periods shorten to stay consistent with it
  const mass = diff.massScale;
  const body = { ...bp.body, mu: bp.body.mu * mass, heatDps: bp.body.heatDps * diff.heatScale };
  if (body.orbit) body.orbit = { ...body.orbit, period: body.orbit.period / Math.sqrt(mass) };
  for (const c of companions) {
    c.mu *= mass;
    c.period /= Math.sqrt(mass);
  }

  // ---- layered hazard systems: more of them the deeper the run goes
  const modifiers: ModifierKind[] = [...bp.native];
  const elite = rng.next() < diff.eliteChance;
  const wanted = diff.extras + (elite ? 1 : 0);
  const candidates = rng.shuffle(bp.compatible.filter((m) => !modifiers.includes(m)));
  for (const m of candidates) {
    if (modifiers.length - bp.native.length >= wanted) break;
    if (m === 'moon') {
      const at = safeMax + rng.range(26, 36);
      if (companions.length >= 3 || companions.some((c) => Math.abs(c.orbitRadius - at) < 22)) continue;
      companions.push(moon(at, 8, body.mu * 0.022, body.mu, rng.range(0, Math.PI * 2)));
    } else if (m === 'belt') {
      const at = safeMax - 14;
      if (mechanics.belts.some((b) => Math.abs(b.radius - at) < 18)) continue;
      mechanics.belts.push({ radius: at, spread: 8, count: 8, dir: 1, ecc: 0, inclination: 0, node: 0, kind: 'asteroid' });
    } else if (m === 'beams') {
      mechanics.beam = { count: 2, angularSpeed: 0.3 * rng.sign(), off: 3.1, charge: 0.9, on: 0.8, halfWidth: 4, jet: body.kind === 'blackhole' };
    }
    modifiers.push(m);
  }
  // Black holes in deep space are often wrapped in infalling rubble.
  if (enc.env === 'black_hole' && index > 5 && !modifiers.includes('asteroids') && rng.chance(0.4)) modifiers.push('asteroids');

  // ---- orbit
  const orbitMu = body.mu + companions.reduce((sum, c) => sum + (c.kind === 'star' && c.orbitRadius < safeMin ? c.mu : 0), 0);
  const orbit = configureOrbit({ env, blueprint: bp, mechanics, companions, object, rng, index, safeMax, startRadius: safeMin + bp.startAt * width, mu: body.mu });

  // ---- start lane: inside the band, clear of in-plane belts and of anything that hurts
  let startRadius = safeMin + bp.startAt * width;
  for (const b of mechanics.belts) {
    if (b.inclination > 0 || b.ecc > 0.05) continue;
    const gap = startRadius - b.radius;
    const need = b.spread + 12;
    if (Math.abs(gap) < need) startRadius = b.radius + (gap >= 0 ? need : -need);
  }
  startRadius = clamp(startRadius, safeMin + 14, safeMax - 14);

  // ---- pacing, as in the hand-tuned original
  const vStart = Math.sqrt(orbitMu / startRadius);
  const thrustScale = Math.pow(vStart / 108, 0.7);
  const dense = modifiers.includes('asteroids');
  const denseFactor = dense ? (index < 6 ? 0.8 : 0.58) : 1;
  const intervalScale = denseFactor / Math.pow(d, 0.85);
  const speedScale = bp.speedMul * Math.pow(d, 0.45);
  const large = Math.min(0.35, 0.12 + 0.025 * (index - 1));

  // ---- identity
  const subject = system ? { name: system.name, designation: system.name } : (object ?? proceduralDesignation(rng, env.family === 'planetary'));
  const name = levelName({ templates: bp.names, subject, object, orbit, rng });
  const mechanicKeys = collectMechanicKeys(modifiers, mechanics, bp);
  const { theme, background } = composeScene(bp, object, seed, catalogue);

  const base: Omit<LevelDef, 'mission'> = {
    index,
    seed,
    code: levelCode(catalogue.version, index, seed),
    name,
    tagline: bp.tagline,
    classification: `SECTOR ${String(index).padStart(3, '0')} // ${body.label}`,
    identity: {
      kind: enc.identity,
      objectId: system ? system.id : object ? object.id : `${env.fictional ? 'fx' : 'pv'}:${env.id}:${(seed >>> 0).toString(16)}`,
      objectName: system ? system.name : object ? object.name : subject.designation,
      objectClass: system ? systemTypeLabel(system) : object ? object.classification : env.variantClass,
      source: system ? SYSTEM_SOURCE_LABEL[system.source] : object ? SOURCE_LABEL[object.source] : null,
      ...(system ? { systemId: system.id, planets: sampleWorlds(system).map((p) => p.name) } : {}),
      environment: env.id,
      environmentLabel: env.label,
      family: env.family,
      orbit: orbit.id,
      orbitLabel: orbit.label,
      rarity: env.rarity,
      description: `${bp.description} ${orbit.note}`,
    },
    body,
    companions,
    orbitMu,
    safeMin,
    safeMax,
    startRadius,
    outerLimit: Math.max(212, safeMax + 34),
    duration: diff.duration,
    difficulty: d,
    hazardGravity: bp.hazardGravity,
    thrustScale,
    asteroidInterval: [Math.max(0.55, bp.interval[0] * intervalScale), Math.max(0.45, bp.interval[1] * intervalScale)],
    asteroidSpeed: [30 * speedScale, 54 * speedScale],
    asteroidSizeWeights: [0.48 - large * 0.4, 0.4, large],
    modifiers,
    mechanics,
    mechanicKeys,
    stabilityDrain: diff.drainScale,
    startEcc: orbit.startEcc,
    // Upgrade opportunities: some sectors are lean, some are rich; rare encounters pay better.
    energyRichness: subRng(seed, 'energy').range(0.8, 1.3) * (env.rarity === 'rare' || env.rarity === 'legendary' ? 1.2 : 1),
    newMechanics: index > 1 ? mechanicKeys.filter((k) => !seen.has(k) && k !== 'belt').map((k) => MECH_LABEL[k] ?? k.toUpperCase()) : [],
    theme,
    background,
  };
  return attachMission(base, pick, seen);
}

/** Lay the mission out over the environment and fold its mechanics into the level's identity. */
function attachMission(base: Omit<LevelDef, 'mission'>, pick: MissionPick, seen: ReadonlySet<string>): LevelDef {
  // A survival sector's tier is a function of its index alone, so codes without a suffix stay exact.
  const tier = pick.kind === 'survival' ? survivalTier(base.index) : pick.tier;
  const { mission, patch } = planMission(pick.kind, tier, base, pick.mutators ?? [], pick.variant ?? 'standard');
  const level: LevelDef = { ...base, ...patch, mission };
  let keys = base.mechanicKeys;
  if (patch.mechanics && patch.mechanics.belts.length === 0) keys = keys.filter((k) => k !== 'belt' && k !== 'inclined');
  if (patch.companions) keys = keys.filter((k) => k !== 'moon');
  level.mechanicKeys = [...new Set([...keys, ...mission.features])];
  level.newMechanics =
    base.index > 1 ? level.mechanicKeys.filter((k) => !seen.has(k) && k !== 'belt').map((k) => MECH_LABEL[k] ?? k.toUpperCase()) : [];
  const twists = mission.mutators.map((m) => MUTATORS[m].code).join('');
  const suffix = `${VARIANT_INFO[mission.variant].code}${twists ? `+${twists}` : ''}`;
  // A plain survival sector keeps the bare code, so codes from before missions existed still work.
  if (pick.kind !== 'survival' || suffix) level.code = `${base.code}-${MISSIONS[pick.kind].code}${mission.tier}${suffix}`;
  return level;
}

/** Rebuild a level from nothing but its seed and sector index (and mission, when not survival). */
export function generateLevelFromSeed(
  seed: number,
  index: number,
  seen: ReadonlySet<string> = new Set(),
  catalogue: Catalogue = getCatalogue(),
  pick: MissionPick = defaultMission(index),
): LevelDef {
  return buildLevel(rollEncounter(seed, index, catalogue, MISSIONS[pick.kind].envs), seen, catalogue, pick);
}

/** Rebuild any level from its sector code (e.g. C1-012-56115553-AR2). */
export function levelFromCode(code: string, catalogue: Catalogue = getCatalogue()): LevelDef | null {
  const parsed = parseLevelCode(code);
  if (!parsed) return null;
  const kind = parsed.mission ? missionByCode(parsed.mission.code) : 'survival';
  if (!kind) return null;
  const variant = (Object.keys(VARIANT_INFO) as VariantId[]).find((v) => v !== 'standard' && VARIANT_INFO[v].code === parsed.mission?.variant) ?? 'standard';
  const mutators = [...(parsed.mission?.mutators ?? '')].map(mutatorByCode).filter((m): m is MutatorId => m !== null);
  const pick: MissionPick = { kind, tier: kind === 'survival' ? defaultMission(parsed.index).tier : (parsed.mission?.tier ?? 1), mutators, variant };
  return generateLevelFromSeed(parsed.seed, parsed.index, new Set(), catalogue, pick);
}

/**
 * A compact fingerprint of what makes a level play and look the way it does. Two levels with the
 * same signature would feel like near-duplicates; the tests use it to measure variety.
 */
export function levelSignature(l: LevelDef): string {
  return [l.mission.kind, l.identity.environment, l.identity.objectId, l.identity.orbit, [...l.mechanicKeys].sort().join('+'), l.companions.length].join('|');
}

/**
 * A level set in a chosen star system (the catalogue's "fly this system"). The system's own data
 * decides the environment: circumbinary, a planetary system with a stellar companion, or a single
 * star with its planets. Returns null for a system with nothing to build a sector from.
 */
export function levelForSystem(system: StarSystem, seed: number, index: number, pick?: MissionPick, catalogue: Catalogue = getCatalogue()): LevelDef | null {
  if (system.planets.length === 0) return null;
  const envId: EnvId = system.hostConfig === 'circumbinary' ? 'circumbinary' : system.hostConfig === 'circumstellar' ? 'companion_star' : 'star_system';
  const env = environment(envId);
  const enc: Encounter = { seed, index, env: envId, object: null, identity: 'REAL OBJECT', rarity: env.rarity, system };
  const mission = pick ?? { kind: envId === 'circumbinary' ? ('binary_nav' as const) : ('survey' as const), tier: 1 };
  return buildLevel(enc, new Set(), catalogue, mission);
}
