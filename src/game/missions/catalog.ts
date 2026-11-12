/**
 * Static facts about every mission type: names, where they can take place, how they are scheduled
 * across a run. Shared by the generator, the run and the UI.
 */
import type { EnvId } from '../../generation/environments/common';
import type { MissionKind } from './types';

export interface MissionInfo {
  kind: MissionKind;
  title: string;
  /** Two-letter tag used in sector codes. */
  code: string;
  boss: boolean;
  color: string;
  /** What the player does, in one line (how-to-play, catalogue). */
  summary: string;
  /** Environments this mission can be set in. */
  envs: readonly EnvId[];
}

const PLANETS: EnvId[] = ['rocky', 'ice', 'desert', 'lava', 'ocean', 'super_earth', 'tidally_locked'];
const STARS: EnvId[] = ['red_dwarf', 'sunlike', 'blue_giant', 'red_giant'];

export const MISSIONS: Record<MissionKind, MissionInfo> = {
  survival: {
    kind: 'survival',
    title: 'SURVIVAL',
    code: 'SV',
    boss: false,
    color: '#3ef2ff',
    summary: 'Hold your orbit through escalating waves of hazards.',
    envs: [], // anywhere (empty = unrestricted)
  },
  precision: {
    kind: 'precision',
    title: 'PRECISION NAVIGATION',
    code: 'PN',
    boss: false,
    color: '#5dffa0',
    summary: 'Thread a sequence of narrow gates by raising and lowering your orbit.',
    envs: [...PLANETS, 'asteroid_field', 'comet_region', 'red_dwarf', 'white_dwarf'],
  },
  extraction: {
    kind: 'extraction',
    title: 'ENERGY EXTRACTION',
    code: 'EX',
    boss: false,
    color: '#9b5cff',
    summary: 'Harvest an energy quota, then rendezvous with the extraction dock.',
    envs: ['ringed', 'ice', 'rocky', 'lava', 'gas_giant', 'red_dwarf', 'sunlike', 'red_giant', 'variable_star', 'comet_region'],
  },
  asteroid_run: {
    kind: 'asteroid_run',
    title: 'ASTEROID RUN',
    code: 'AR',
    boss: false,
    color: '#ffc94d',
    summary: 'Cross counter-rotating asteroid belts through their gaps to reach the jump gate.',
    envs: ['asteroid_field', 'rocky', 'comet_region', 'desert', 'ice', 'white_dwarf', 'supernova_remnant'],
  },
  slingshot: {
    kind: 'slingshot',
    title: 'GRAVITY SLINGSHOT',
    code: 'GS',
    boss: false,
    color: '#ff8a3d',
    summary: 'Fuel is short: fly past a moving planet to be flung out to a distant beacon.',
    envs: ['rocky', 'ice', 'desert', 'super_earth', 'red_dwarf', 'sunlike', 'lava'],
  },
  event_horizon: {
    kind: 'event_horizon',
    title: 'EVENT HORIZON',
    code: 'EH',
    boss: false,
    color: '#b77dff',
    summary: 'A growing black hole is reeling you in. Burn at periapsis and climb out.',
    envs: ['black_hole', 'quasar', 'galactic_core'],
  },
  nebula: {
    kind: 'nebula',
    title: 'NEBULA NAVIGATION',
    code: 'NN',
    boss: false,
    color: '#ff7a9a',
    summary: 'Follow narrow corridors through ionised gas while surges scramble your controls.',
    envs: ['nebula', 'supernova_remnant'],
  },
  pursuit: {
    kind: 'pursuit',
    title: 'PURSUIT',
    code: 'PU',
    boss: false,
    color: '#ff4d5e',
    summary: 'A hunter is on your tail. Stay alive - and far away - while the jump drive charges.',
    envs: [...PLANETS, 'gas_giant', 'asteroid_field', 'red_dwarf', 'sunlike', 'white_dwarf', 'comet_region'],
  },
  boss_neutron: {
    kind: 'boss_neutron',
    title: 'THE NEUTRON CORE',
    code: 'BN',
    boss: true,
    color: '#7ffcff',
    summary: 'Synchronise with its stabiliser nodes while it pounds you with gravitational waves.',
    envs: ['neutron_star', 'pulsar'],
  },
  boss_devourer: {
    kind: 'boss_devourer',
    title: 'THE DEVOURER',
    code: 'BD',
    boss: true,
    color: '#b77dff',
    summary: 'An expanding black hole. Carry destabiliser charges down to its photon ring.',
    envs: ['black_hole'],
  },
  boss_sentinel: {
    kind: 'boss_sentinel',
    title: 'THE SENTINEL',
    code: 'BS',
    boss: true,
    color: '#ff4d5e',
    summary: 'A war machine that hunts you. Lure it through the stellar corona until it overheats.',
    envs: STARS,
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
  'boss_neutron',
  'boss_devourer',
  'boss_sentinel',
];

export const NORMAL_MISSIONS: MissionKind[] = MISSION_ORDER.filter((k) => !MISSIONS[k].boss);
export const BOSS_ROTATION: MissionKind[] = ['boss_neutron', 'boss_devourer', 'boss_sentinel'];

/**
 * The opening of every run is a curriculum: each sector teaches one thing, every fifth sector is a
 * major encounter that leans on what came before.
 *
 *    1 survival      learn the orbit           6 slingshot     fuel, gravity assists
 *    2 precision     raise / lower the orbit   7 event horiz.  the Oberth effect
 *    3 extraction    collect, then rendezvous  8 nebula        blind flying, scrambled controls
 *    4 asteroid run  transfer orbits, timing   9 survival      everything at once
 *    5 NEUTRON CORE  rendezvous under waves   10 DEVOURER      dive-and-climb under growth
 *   11 pursuit      12-14 tier-2 remixes (moving gates, magnetic fields, mines, wormholes)
 *   15 SENTINEL     pursuit + heat
 */
export const CURRICULUM: MissionKind[] = [
  'survival',
  'precision',
  'extraction',
  'asteroid_run',
  'boss_neutron',
  'slingshot',
  'event_horizon',
  'nebula',
  'survival',
  'boss_devourer',
  'pursuit',
  'precision',
  'extraction',
  'asteroid_run',
  'boss_sentinel',
];

export const BOSS_INTERVAL = 5;

export function missionByCode(code: string): MissionKind | null {
  const c = code.toUpperCase();
  for (const k of MISSION_ORDER) if (MISSIONS[k].code === c) return k;
  return null;
}

/** Tier of a survival sector is a function of the sector alone (so old sector codes stay valid). */
export function survivalTier(index: number): number {
  return index <= 1 ? 1 : index < 9 ? 2 : 3 + Math.floor((index - 9) / 15);
}
