/**
 * The mission registry: static facts about every mission type - its name, where it can take
 * place, and how the mission director may schedule it (weight, earliest sector, cool-down, which
 * twists suit it). Shared by the director, the layout generator, the run and the UI.
 *
 * Adding a mission type means adding an entry here, a planner in missionGenerator.ts and a
 * controller in controllers.ts; the director picks it up from this table without changes.
 */
import type { EnvId } from '../../generation/environments/common';
import type { MissionKind, MutatorId } from './types';

export type MissionRarity = 'common' | 'uncommon' | 'rare';

export interface MissionInfo {
  kind: MissionKind;
  title: string;
  /** Two-letter tag used in sector codes. */
  code: string;
  boss: boolean;
  color: string;
  /** What the player does, in one line (how-to-play, catalogue). */
  summary: string;
  /** Environments this mission can be set in (empty = anywhere). */
  envs: readonly EnvId[];
  /** Relative chance of being drawn when eligible. */
  weight: number;
  /** Earliest sector of a run it can appear in. */
  minSector: number;
  /** Sectors that must pass before it can come up again. */
  cooldown: number;
  rarity: MissionRarity;
  /** Safe to hand to someone flying their very first sector. */
  gentle: boolean;
  /** Base difficulty, 1 (calm) to 5 (demanding): sets the reward and how early twists pile on. */
  difficulty: number;
  /** Twists the director may add to this mission. */
  mutators: readonly MutatorId[];
  /** Icon name (see game/icons.ts). */
  icon: string;
}

const PLANETS: EnvId[] = ['rocky', 'ice', 'desert', 'lava', 'ocean', 'super_earth', 'tidally_locked'];
const STARS: EnvId[] = ['red_dwarf', 'sunlike', 'blue_giant', 'red_giant'];
const SYSTEMS: EnvId[] = ['star_system', 'circumbinary', 'companion_star'];

const BAND_TWISTS: MutatorId[] = ['storm', 'rich', 'mined', 'magnetic', 'dense', 'aegis', 'salvage'];
const TRAVEL_TWISTS: MutatorId[] = ['rich', 'haste', 'aegis', 'salvage'];

export const MISSIONS: Record<MissionKind, MissionInfo> = {
  survival: {
    kind: 'survival',
    title: 'SURVIVAL',
    code: 'SV',
    boss: false,
    color: '#3ef2ff',
    summary: 'Hold your orbit through escalating waves of hazards.',
    envs: [], // anywhere (empty = unrestricted)
    weight: 0.9,
    minSector: 1,
    cooldown: 2,
    rarity: 'common',
    gentle: true,
    difficulty: 2,
    mutators: ['storm', 'rich', 'mined', 'dense', 'aegis', 'salvage', 'lowfuel'],
    icon: 'm_survival',
  },
  precision: {
    kind: 'precision',
    title: 'PLANETARY NAVIGATION',
    code: 'PN',
    boss: false,
    color: '#5dffa0',
    summary: 'Thread a sequence of narrow gates by raising and lowering your orbit.',
    envs: [...PLANETS, 'asteroid_field', 'comet_region', 'red_dwarf', 'white_dwarf', 'star_system'],
    weight: 1,
    minSector: 1,
    cooldown: 2,
    rarity: 'common',
    gentle: true,
    difficulty: 2,
    mutators: ['storm', 'magnetic', 'mined', 'haste', 'aegis', 'salvage', 'lowfuel'],
    icon: 'm_gates',
  },
  extraction: {
    kind: 'extraction',
    title: 'ENERGY COLLECTION',
    code: 'EX',
    boss: false,
    color: '#9b5cff',
    summary: 'Harvest an energy quota, then rendezvous with the extraction dock.',
    envs: ['ringed', 'ice', 'rocky', 'lava', 'gas_giant', 'red_dwarf', 'sunlike', 'red_giant', 'variable_star', 'comet_region', 'star_system'],
    weight: 1,
    minSector: 1,
    cooldown: 2,
    rarity: 'common',
    gentle: true,
    difficulty: 2,
    mutators: BAND_TWISTS,
    icon: 'm_energy',
  },
  asteroid_run: {
    kind: 'asteroid_run',
    title: 'ASTEROID FIELD',
    code: 'AR',
    boss: false,
    color: '#ffc94d',
    summary: 'Cross counter-rotating asteroid belts through their gaps to reach the jump gate.',
    envs: ['asteroid_field', 'rocky', 'comet_region', 'desert', 'ice', 'white_dwarf', 'supernova_remnant'],
    weight: 1,
    minSector: 2,
    cooldown: 2,
    rarity: 'common',
    gentle: false,
    difficulty: 3,
    mutators: TRAVEL_TWISTS,
    icon: 'm_rocks',
  },
  slingshot: {
    kind: 'slingshot',
    title: 'GRAVITY SLINGSHOT',
    code: 'GS',
    boss: false,
    color: '#ff8a3d',
    summary: 'Fuel is short: fly past a moving planet to be flung out to a distant beacon.',
    envs: ['rocky', 'ice', 'desert', 'super_earth', 'red_dwarf', 'sunlike', 'lava'],
    weight: 0.9,
    minSector: 3,
    cooldown: 3,
    rarity: 'common',
    gentle: false,
    difficulty: 3,
    mutators: ['rich', 'aegis', 'salvage'],
    icon: 'm_sling',
  },
  event_horizon: {
    kind: 'event_horizon',
    title: 'BLACK HOLE ESCAPE',
    code: 'EH',
    boss: false,
    color: '#b77dff',
    summary: 'A growing black hole is reeling you in. Burn at periapsis and climb out.',
    envs: ['black_hole', 'quasar', 'galactic_core'],
    weight: 0.75,
    minSector: 4,
    cooldown: 4,
    rarity: 'uncommon',
    gentle: false,
    difficulty: 4,
    mutators: ['rich', 'aegis', 'salvage', 'haste'],
    icon: 'm_hole',
  },
  nebula: {
    kind: 'nebula',
    title: 'NEBULA EXPLORATION',
    code: 'NN',
    boss: false,
    color: '#ff7a9a',
    summary: 'Follow narrow corridors through ionised gas while surges scramble your controls.',
    envs: ['nebula', 'supernova_remnant'],
    weight: 0.8,
    minSector: 3,
    cooldown: 3,
    rarity: 'uncommon',
    gentle: false,
    difficulty: 3,
    mutators: ['rich', 'aegis', 'salvage'],
    icon: 'm_nebula',
  },
  pursuit: {
    kind: 'pursuit',
    title: 'PURSUIT',
    code: 'PU',
    boss: false,
    color: '#ff4d5e',
    summary: 'A hunter is on your tail. Stay alive - and far away - while the jump drive charges.',
    envs: [...PLANETS, 'gas_giant', 'asteroid_field', 'red_dwarf', 'sunlike', 'white_dwarf', 'comet_region'],
    weight: 0.8,
    minSector: 4,
    cooldown: 3,
    rarity: 'uncommon',
    gentle: false,
    difficulty: 4,
    mutators: ['rich', 'aegis', 'salvage', 'storm'],
    icon: 'm_hunter',
  },
  binary_nav: {
    kind: 'binary_nav',
    title: 'BINARY STAR NAVIGATION',
    code: 'BV',
    boss: false,
    color: '#ffd890',
    summary: 'Thread relay gates around two stars while their pull swings and the stream between them flares.',
    envs: ['binary', 'multiple_star', 'circumbinary'],
    weight: 1.1,
    minSector: 3,
    cooldown: 3,
    rarity: 'uncommon',
    gentle: false,
    difficulty: 4,
    mutators: ['magnetic', 'haste', 'aegis', 'salvage', 'rich'],
    icon: 'm_binary',
  },
  flare_run: {
    kind: 'flare_run',
    title: 'SOLAR FLARE AVOIDANCE',
    code: 'SF',
    boss: false,
    color: '#ffb347',
    summary: 'Superflares scour the whole orbit. Be inside a planet\'s shadow every time one fires.',
    envs: [...STARS, 'variable_star', 'star_system'],
    weight: 1,
    minSector: 2,
    cooldown: 3,
    rarity: 'common',
    gentle: false,
    difficulty: 3,
    mutators: ['rich', 'mined', 'aegis', 'salvage', 'dense', 'lowfuel'],
    icon: 'm_flare',
  },
  wormhole: {
    kind: 'wormhole',
    title: 'WORMHOLE TRAVERSAL',
    code: 'WH',
    boss: false,
    color: '#b8a4ff',
    summary: 'The beacon is out of reach of your fuel. Find the chain of wormholes that carries you to it.',
    envs: [...PLANETS, 'asteroid_field', 'comet_region', 'white_dwarf', 'anomaly', 'rogue'],
    weight: 0.9,
    minSector: 3,
    cooldown: 3,
    rarity: 'uncommon',
    gentle: false,
    difficulty: 3,
    mutators: ['rich', 'aegis', 'salvage', 'mined'],
    icon: 'm_worm',
  },
  anomaly: {
    kind: 'anomaly',
    title: 'GRAVITATIONAL ANOMALY',
    code: 'GA',
    boss: false,
    color: '#7dffd8',
    summary: 'The mass at the centre will not hold still. Ride the shifting resonance lane to stabilise it.',
    envs: ['anomaly', 'neutron_star', 'white_dwarf', 'rogue', 'black_hole'],
    weight: 0.85,
    minSector: 4,
    cooldown: 4,
    rarity: 'uncommon',
    gentle: false,
    difficulty: 4,
    mutators: ['storm', 'rich', 'aegis', 'salvage', 'magnetic'],
    icon: 'm_anomaly',
  },
  escort: {
    kind: 'escort',
    title: 'ESCORT',
    code: 'ES',
    boss: false,
    color: '#8fd3ff',
    summary: 'A survey tender is crossing the sector. Fly close to shield it until it reaches its jump point.',
    envs: [...PLANETS, 'gas_giant', 'sunlike', 'red_dwarf', 'asteroid_field', 'star_system'],
    weight: 0.9,
    minSector: 2,
    cooldown: 3,
    rarity: 'common',
    gentle: false,
    difficulty: 3,
    mutators: ['storm', 'rich', 'dense', 'aegis', 'salvage'],
    icon: 'm_escort',
  },
  mining: {
    kind: 'mining',
    title: 'RESOURCE EXTRACTION',
    code: 'RX',
    boss: false,
    color: '#e0a060',
    summary: 'Match orbits with ore-bearing rocks and cut them open. Rich veins sit where it is dangerous.',
    envs: ['asteroid_field', 'rocky', 'ice', 'comet_region', 'ringed', 'white_dwarf', 'desert', 'star_system'],
    weight: 1,
    minSector: 1,
    cooldown: 2,
    rarity: 'common',
    gentle: true,
    difficulty: 2,
    mutators: BAND_TWISTS,
    icon: 'm_mining',
  },
  discovery: {
    kind: 'discovery',
    title: 'ASTRONOMICAL DISCOVERY',
    code: 'AD',
    boss: false,
    color: '#fff3a8',
    summary: 'Something unlisted is hiding in this sector. Follow the signal, find it and hold the scan.',
    envs: ['pulsar', 'quasar', 'galactic_core', 'supernova_remnant', 'xray_binary', 'rogue', 'variable_star', 'multiple_star', 'comet_region', 'black_hole'],
    weight: 0.45,
    minSector: 5,
    cooldown: 6,
    rarity: 'rare',
    gentle: false,
    difficulty: 4,
    mutators: ['rich', 'aegis', 'salvage', 'storm'],
    icon: 'm_discovery',
  },
  survey: {
    kind: 'survey',
    title: 'SYSTEM SURVEY',
    code: 'SS',
    boss: false,
    color: '#9fe3ff',
    summary: 'Fly a close pass of every world in the system and bring the survey home.',
    envs: [...SYSTEMS, 'gas_giant', 'ringed'],
    weight: 1.2,
    minSector: 2,
    cooldown: 3,
    rarity: 'uncommon',
    gentle: false,
    difficulty: 3,
    mutators: ['rich', 'aegis', 'salvage', 'haste'],
    icon: 'm_survey',
  },
  boss_neutron: {
    kind: 'boss_neutron',
    title: 'THE NEUTRON CORE',
    code: 'BN',
    boss: true,
    color: '#7ffcff',
    summary: 'Synchronise with its stabiliser nodes while it pounds you with gravitational waves.',
    envs: ['neutron_star', 'pulsar'],
    weight: 1,
    minSector: 4,
    cooldown: 0,
    rarity: 'rare',
    gentle: false,
    difficulty: 5,
    mutators: [],
    icon: 'm_boss',
  },
  boss_devourer: {
    kind: 'boss_devourer',
    title: 'THE DEVOURER',
    code: 'BD',
    boss: true,
    color: '#b77dff',
    summary: 'An expanding black hole. Carry destabiliser charges down to its photon ring.',
    envs: ['black_hole'],
    weight: 1,
    minSector: 4,
    cooldown: 0,
    rarity: 'rare',
    gentle: false,
    difficulty: 5,
    mutators: [],
    icon: 'm_boss',
  },
  boss_sentinel: {
    kind: 'boss_sentinel',
    title: 'THE SENTINEL',
    code: 'BS',
    boss: true,
    color: '#ff4d5e',
    summary: 'A war machine that hunts you. Lure it through the stellar corona until it overheats.',
    envs: STARS,
    weight: 1,
    minSector: 4,
    cooldown: 0,
    rarity: 'rare',
    gentle: false,
    difficulty: 5,
    mutators: [],
    icon: 'm_boss',
  },
};

export const MISSION_ORDER: MissionKind[] = [
  'survival',
  'precision',
  'extraction',
  'asteroid_run',
  'slingshot',
  'event_horizon',
  'nebula',
  'pursuit',
  'binary_nav',
  'flare_run',
  'wormhole',
  'anomaly',
  'escort',
  'mining',
  'discovery',
  'survey',
  'boss_neutron',
  'boss_devourer',
  'boss_sentinel',
];

export const NORMAL_MISSIONS: MissionKind[] = MISSION_ORDER.filter((k) => !MISSIONS[k].boss);
export const BOSSES: MissionKind[] = MISSION_ORDER.filter((k) => MISSIONS[k].boss);

export function missionByCode(code: string): MissionKind | null {
  const c = code.toUpperCase();
  for (const k of MISSION_ORDER) if (MISSIONS[k].code === c) return k;
  return null;
}

/** Tier of a survival sector is a function of the sector alone (so old sector codes stay valid). */
export function survivalTier(index: number): number {
  return index <= 1 ? 1 : index < 9 ? 2 : 3 + Math.floor((index - 9) / 15);
}

export interface MutatorInfo {
  id: MutatorId;
  name: string;
  /** One line shown on the sector intro card. */
  note: string;
  /** Single letter used in sector codes. */
  code: string;
  /** Added to the sector's reward multiplier (negative for twists that help). */
  reward: number;
  /** Earliest sector the twist can appear in. */
  minSector: number;
  color: string;
}

export const MUTATORS: Record<MutatorId, MutatorInfo> = {
  storm: { id: 'storm', name: 'SOLAR STORM', note: 'Flares and shock fronts on top of everything else.', code: 'S', reward: 0.2, minSector: 4, color: '#ffb347' },
  lowfuel: { id: 'lowfuel', name: 'RESERVE TANKS', note: 'Fuel is limited this sector. Coast to recover it.', code: 'L', reward: 0.2, minSector: 5, color: '#ff8a3d' },
  rich: { id: 'rich', name: 'RICH VEINS', note: 'The sector is thick with energy.', code: 'R', reward: 0, minSector: 2, color: '#b77dff' },
  mined: { id: 'mined', name: 'MINEFIELD', note: 'Old proximity mines still drift on these orbits.', code: 'M', reward: 0.25, minSector: 6, color: '#ff4d5e' },
  wormholes: { id: 'wormholes', name: 'TORN SPACE', note: 'A wormhole pair links two orbits here.', code: 'W', reward: 0.1, minSector: 5, color: '#b8a4ff' },
  magnetic: { id: 'magnetic', name: 'MAGNETIC KNOTS', note: 'Magnetic regions bend your path.', code: 'G', reward: 0.15, minSector: 4, color: '#3d6bff' },
  haste: { id: 'haste', name: 'CLOSING WINDOW', note: 'The jump window is a quarter shorter.', code: 'H', reward: 0.25, minSector: 5, color: '#ff7a9a' },
  dense: { id: 'dense', name: 'DENSE FIELD', note: 'Half again as much incoming rock.', code: 'D', reward: 0.2, minSector: 3, color: '#ffc94d' },
  aegis: { id: 'aegis', name: 'AEGIS CACHE', note: 'An aegis shield is drifting somewhere in the band.', code: 'A', reward: -0.05, minSector: 2, color: '#3ef2ff' },
  salvage: { id: 'salvage', name: 'SALVAGE FIELD', note: 'Repair kits and a fourth shard are out there.', code: 'V', reward: 0, minSector: 2, color: '#5dffa0' },
};

export const MUTATOR_IDS = Object.keys(MUTATORS) as MutatorId[];

export function mutatorByCode(code: string): MutatorId | null {
  const c = code.toUpperCase();
  return MUTATOR_IDS.find((id) => MUTATORS[id].code === c) ?? null;
}

export const VARIANT_INFO: Record<'standard' | 'elite' | 'pristine' | 'anomalous', { name: string; note: string; code: string; reward: number; color: string }> = {
  standard: { name: '', note: '', code: '', reward: 0, color: '#8592bb' },
  elite: { name: 'ELITE', note: 'A tier harder than this sector calls for. Pays half again.', code: 'E', reward: 0.5, color: '#ff4d5e' },
  pristine: { name: 'PRISTINE', note: 'Untouched: more shards and a hidden cache.', code: 'P', reward: 0.15, color: '#5dffa0' },
  anomalous: { name: 'ANOMALOUS', note: 'Readings are strange here. One more twist than usual.', code: 'X', reward: 0.25, color: '#b8a4ff' },
};
