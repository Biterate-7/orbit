/**
 * Ship modules: equippable systems that change how a mission is flown, and the synergies between
 * them.
 *
 * Modules sit beside the two older upgrade tracks (permanent ship parts bought with credits, and
 * in-run upgrades picked at energy milestones). A module is unlocked by something the pilot has
 * done, bought and levelled with credits, and then fitted into one of a limited number of bays -
 * so which ones fly is a choice, and some pairs do more together than apart.
 *
 * Everything a module does is expressed as numbers in ModuleMods; the run reads those and nothing
 * else, so a new module is a table entry here plus the handful of places its numbers are used.
 */
import { PALETTE } from './config';

export type ModuleId = 'anchor' | 'dualcore' | 'collector' | 'scanner' | 'phase' | 'resonator' | 'drill' | 'aegislink';

export const MODULE_IDS: ModuleId[] = ['anchor', 'dualcore', 'collector', 'scanner', 'phase', 'resonator', 'drill', 'aegislink'];

export const MODULE_MAX = 3;
/** Credits for level 1, 2, 3. */
export const MODULE_COSTS = [120, 260, 480];
/** Module bays on the ship. The third opens with pilot level. */
export const MODULE_BAYS = 3;
export const THIRD_BAY_LEVEL = 6;

/** What the unlock conditions can be measured against (a slice of the lifetime statistics). */
export interface ModuleProgress {
  sectorsCleared: number;
  missionsCompleted: number;
  bossesDefeated: number;
  systemsDiscovered: number;
  objectsDiscovered: number;
  rocksMined: number;
  wormholeTransits: number;
  escortsCompleted: number;
  binaryMissions: number;
  gravityAssists: number;
  pilotLevel: number;
}

export interface ModuleDef {
  id: ModuleId;
  name: string;
  /** What it does, in one sentence. */
  summary: string;
  /** The numbers at a given level (1..3). */
  effect: (level: number) => string;
  /** How its effect shows on screen. */
  visual: string;
  color: string;
  icon: string;
  unlock: { hint: string; progress: (p: ModuleProgress) => [number, number] };
}

const L = (level: number, values: number[]): number => values[Math.max(0, Math.min(values.length - 1, level))];

export const MODULES: Record<ModuleId, ModuleDef> = {
  anchor: {
    id: 'anchor',
    name: 'GRAVITATIONAL ANCHOR',
    summary: 'Holds the ship against gravitational disturbances, and soaks one gravity wave outright while charged.',
    effect: (l) => `-${Math.round(L(l, [0, 30, 45, 60]))}% PUSH FROM WAVES, WIND, STORMS, SURGES · ABSORBS A WAVE EVERY ${L(l, [0, 16, 12, 9])}s`,
    visual: 'A grounding ring snaps around the hull when a wave is absorbed; a pip shows the charge.',
    color: '#7dffd8',
    icon: 'mod_anchor',
    unlock: { hint: 'CLEAR 5 SECTORS', progress: (p) => [p.sectorsCleared, 5] },
  },
  dualcore: {
    id: 'dualcore',
    name: 'DUAL-CORE THRUSTERS',
    summary: 'A second engine core: more acceleration, and every boost can be followed by a second burst.',
    effect: (l) => `+${L(l, [0, 8, 14, 20])}% THRUST · SECOND BURST WITHIN ${L(l, [0, 2.5, 3.5, 4.5])}s · +${L(l, [0, 10, 20, 30])}% BURST POWER`,
    visual: 'Twin exhaust plumes; the boost pip splits in two.',
    color: PALETTE.orange,
    icon: 'mod_dualcore',
    unlock: { hint: 'COMPLETE 8 MISSIONS', progress: (p) => [p.missionsCompleted, 8] },
  },
  collector: {
    id: 'collector',
    name: 'QUANTUM COLLECTOR',
    summary: 'Draws in energy, shards, cells and other pickups from a distance instead of making you fly through them.',
    effect: (l) => `ATTRACTS ENERGY AND PICKUPS WITHIN ${L(l, [0, 26, 38, 50])} UNITS`,
    visual: 'Violet tethers reach out to whatever it has hold of.',
    color: PALETTE.violet,
    icon: 'mod_collector',
    unlock: { hint: 'CATALOGUE 6 OBJECTS OR SYSTEMS', progress: (p) => [p.objectsDiscovered + p.systemsDiscovered, 6] },
  },
  scanner: {
    id: 'scanner',
    name: 'DEEP-SPACE SCANNER',
    summary: 'Reveals what is hidden: supply caches, wormhole routes, unlisted signals, and hazards before they arrive.',
    effect: (l) => `FINDS HIDDEN CACHES · SHOWS WORMHOLE EXITS · +${L(l, [0, 25, 50, 75])}% SIGNAL RANGE · +${L(l, [0, 0.5, 1, 1.5])}s HAZARD WARNING`,
    visual: 'A scan pulse sweeps out from the ship; hidden things light up as it crosses them.',
    color: '#fff3a8',
    icon: 'mod_scanner',
    unlock: { hint: 'DISCOVER 2 STAR SYSTEMS', progress: (p) => [p.systemsDiscovered, 2] },
  },
  phase: {
    id: 'phase',
    name: 'PHASE DRIVE',
    summary: 'Boosting phases the ship for longer, and through what a plain boost cannot pass: moons and planets.',
    effect: (l) => `+${L(l, [0, 40, 80, 120])}% PHASE TIME · PASS THROUGH MOONS AND PLANETS${l >= 2 ? ' · -15% BOOST COOLDOWN' : ''}${l >= 3 ? ' · EXIT SHOCK CLEARS ROCK' : ''}`,
    visual: 'The hull turns translucent violet and leaves a long ghost trail while phased.',
    color: '#b8a4ff',
    icon: 'mod_phase',
    unlock: { hint: 'DEFEAT A MAJOR ENCOUNTER', progress: (p) => [p.bossesDefeated, 1] },
  },
  resonator: {
    id: 'resonator',
    name: 'ORBITAL RESONATOR',
    summary: 'Reads complex gravity: a longer flight-path preview, steadier orbits and easier rendezvous among several bodies.',
    effect: (l) => `+${L(l, [0, 30, 50, 70])}% PATH PREVIEW · -${L(l, [0, 12, 24, 36])}% STABILITY DRAIN · +${L(l, [0, 15, 30, 45])}% LOCK TOLERANCE · +${L(l, [0, 15, 30, 45])}% STRAFE`,
    visual: 'Resonance ticks ride the predicted path; periapsis and apoapsis are always marked.',
    color: '#8fd3ff',
    icon: 'mod_resonator',
    unlock: { hint: 'FLY A BINARY STAR MISSION OR 2 GRAVITY ASSISTS', progress: (p) => [Math.max(p.binaryMissions * 2, p.gravityAssists), 2] },
  },
  drill: {
    id: 'drill',
    name: 'RESONANCE DRILL',
    summary: 'A mining laser that cuts ore faster, and makes every rock you ram shed its energy.',
    effect: (l) => `+${L(l, [0, 30, 60, 90])}% MINING SPEED · RAMMED ROCK ALWAYS SHEDS ENERGY${l >= 3 ? ' (DOUBLE)' : ''}`,
    visual: 'An amber cutting beam; shattered rock sheds energy motes.',
    color: '#e0a060',
    icon: 'mod_drill',
    unlock: { hint: 'MINE 4 ORE ROCKS', progress: (p) => [p.rocksMined, 4] },
  },
  aegislink: {
    id: 'aegislink',
    name: 'AEGIS LINK',
    summary: 'Projects your shielding further: a longer, faster-charging escort link, and aegis pickups that last.',
    effect: (l) => `+${L(l, [0, 20, 40, 60])}% LINK RANGE AND RECHARGE · AEGIS PICKUPS +${L(l, [0, 2, 4, 6])}s`,
    visual: 'The shield link is drawn as a bright cyan lattice instead of a thin line.',
    color: PALETTE.cyan,
    icon: 'mod_aegis',
    unlock: { hint: 'COMPLETE AN ESCORT MISSION', progress: (p) => [p.escortsCompleted, 1] },
  },
};

export function moduleUnlocked(id: ModuleId, p: ModuleProgress): boolean {
  const [have, need] = MODULES[id].unlock.progress(p);
  return have >= need;
}

export function baysOpen(pilotLevel: number): number {
  return pilotLevel >= THIRD_BAY_LEVEL ? MODULE_BAYS : MODULE_BAYS - 1;
}

// ------------------------------------------------------------------ synergies

export type SynergyId = 'prospector' | 'harmonics' | 'phasedash' | 'deepvein' | 'bulwark' | 'pathfinder' | 'ghostsurvey';

export interface SynergyDef {
  id: SynergyId;
  pair: [ModuleId, ModuleId];
  name: string;
  description: string;
  color: string;
}

/** Add a row to create a synergy; the run reads `mods.syn.has(id)` wherever it should matter. */
export const SYNERGIES: SynergyDef[] = [
  { id: 'prospector', pair: ['scanner', 'collector'], name: 'PROSPECTOR', description: 'Discoveries, signals and hidden caches pay 50% more credits, and caches are drawn in from range.', color: '#fff3a8' },
  { id: 'harmonics', pair: ['anchor', 'resonator'], name: 'BINARY HARMONICS', description: 'Around two or more stars: stability drains 40% slower and the anchor recharges twice as fast.', color: '#7dffd8' },
  { id: 'phasedash', pair: ['dualcore', 'phase'], name: 'PHASE DASH', description: 'The second burst re-phases the ship and its window is a second longer.', color: '#b8a4ff' },
  { id: 'deepvein', pair: ['collector', 'drill'], name: 'DEEP VEIN', description: 'Every mined rock gives one extra load, and shattered rock sheds twice the energy.', color: '#e0a060' },
  { id: 'bulwark', pair: ['anchor', 'aegislink'], name: 'BULWARK', description: 'A linked convoy takes 40% less damage, and the link never drops from a gravity wave.', color: PALETTE.cyan },
  { id: 'pathfinder', pair: ['scanner', 'resonator'], name: 'PATHFINDER', description: 'Hidden targets show as ghosts from the start, and gates and survey points on course are flagged earlier.', color: '#8fd3ff' },
  { id: 'ghostsurvey', pair: ['phase', 'scanner'], name: 'GHOST SURVEY', description: 'Scans and survey passes run 35% faster, and keep running while phased.', color: '#d8c8ff' },
];

export function activeSynergies(equipped: readonly ModuleId[]): SynergyId[] {
  return SYNERGIES.filter((s) => equipped.includes(s.pair[0]) && equipped.includes(s.pair[1])).map((s) => s.id);
}

export interface ModuleLoadout {
  levels: Record<ModuleId, number>;
  equipped: ModuleId[];
}

export function emptyModuleLevels(): Record<ModuleId, number> {
  return { anchor: 0, dualcore: 0, collector: 0, scanner: 0, phase: 0, resonator: 0, drill: 0, aegislink: 0 };
}

/** The numbers a run reads. Level 0 everywhere means "no modules": every value is neutral. */
export interface ModuleMods {
  /** Level of each fitted module (0 = not fitted). */
  level: Record<ModuleId, number>;
  syn: ReadonlySet<SynergyId>;
  /** Multiplier on pushes from waves, wind, storms, plumes and surges. */
  disturbMul: number;
  /** Seconds between waves the anchor can absorb outright (0 = cannot). */
  anchorCd: number;
  thrustMul: number;
  /** Seconds after a boost in which a second burst is available (0 = none). */
  burstWindow: number;
  burstDvMul: number;
  /** Radius within which energy and pickups are drawn in (0 = none). */
  collectR: number;
  /** Deep scan level: caches, wormhole exits, signal range. */
  deepScan: number;
  signalRangeMul: number;
  warnBonus: number;
  phaseTimeMul: number;
  /** Phase level: 1 passes through moons and planets, 2 shortens the boost cooldown, 3 adds an exit shock. */
  phaseLevel: number;
  previewMul: number;
  stabilityDrainMul: number;
  lockMul: number;
  strafeMul: number;
  drillMul: number;
  linkMul: number;
  aegisBonus: number;
  scanMul: number;
}

export function computeModuleMods(loadout: ModuleLoadout | null | undefined): ModuleMods {
  const level = emptyModuleLevels();
  const fitted = loadout ? loadout.equipped.filter((id) => (loadout.levels[id] ?? 0) > 0) : [];
  for (const id of fitted) level[id] = Math.min(MODULE_MAX, loadout?.levels[id] ?? 0);
  const syn = new Set(activeSynergies(fitted));
  return {
    level,
    syn,
    disturbMul: 1 - L(level.anchor, [0, 0.3, 0.45, 0.6]),
    anchorCd: L(level.anchor, [0, 16, 12, 9]),
    thrustMul: 1 + L(level.dualcore, [0, 0.08, 0.14, 0.2]),
    burstWindow: level.dualcore > 0 ? L(level.dualcore, [0, 2.5, 3.5, 4.5]) + (syn.has('phasedash') ? 1 : 0) : 0,
    burstDvMul: 1 + L(level.dualcore, [0, 0.1, 0.2, 0.3]),
    collectR: L(level.collector, [0, 26, 38, 50]),
    deepScan: level.scanner,
    signalRangeMul: 1 + 0.25 * level.scanner,
    warnBonus: 0.5 * level.scanner,
    phaseTimeMul: 1 + L(level.phase, [0, 0.4, 0.8, 1.2]),
    phaseLevel: level.phase,
    previewMul: 1 + L(level.resonator, [0, 0.3, 0.5, 0.7]),
    stabilityDrainMul: 1 - 0.12 * level.resonator,
    lockMul: 1 + 0.15 * level.resonator,
    strafeMul: 1 + 0.15 * level.resonator,
    drillMul: 1 + 0.3 * level.drill,
    linkMul: 1 + 0.2 * level.aegislink,
    aegisBonus: 2 * level.aegislink,
    scanMul: syn.has('ghostsurvey') ? 1.35 : 1,
  };
}
