/**
 * The cosmetic catalogue: every hull skin, engine, trail, wing set, core, particle effect, canopy
 * and special effect, with the parameters the ship painter draws them from.
 *
 * Cosmetics are pure presentation - none of them changes how the ship flies. Each item is data:
 * the painter (render/shipPainter.ts) interprets `look`, so the hangar preview and the ship in
 * flight are drawn by the same code from the same record.
 *
 * Rarity is a visual language, not just a label:
 *   common     flat colourways
 *   uncommon   two-tone schemes and patterns
 *   rare       detailed panelling with moving elements, distinctive trails
 *   epic       emissive, animated surfaces and engines
 *   legendary  fully animated skins with their own motion and trail geometry
 *   mythic     signature pieces: the hull itself becomes an effect
 */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';
export const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
export const RARITY_RANK: Record<Rarity, number> = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, mythic: 5 };
export const RARITY_COLOR: Record<Rarity, string> = { common: '#8a96b8', uncommon: '#5dffa0', rare: '#4d9bff', epic: '#b77dff', legendary: '#ffc94d', mythic: '#ff5d8f' };
export const RARITY_LABEL: Record<Rarity, string> = { common: 'COMMON', uncommon: 'UNCOMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY', mythic: 'MYTHIC' };

export type CosmeticSlot = 'hull' | 'engine' | 'trail' | 'wings' | 'core' | 'particles' | 'cockpit' | 'effect';
export const SLOTS: CosmeticSlot[] = ['hull', 'wings', 'cockpit', 'core', 'engine', 'trail', 'particles', 'effect'];
export const SLOT_LABEL: Record<CosmeticSlot, string> = {
  hull: 'HULL SKIN',
  engine: 'ENGINE',
  trail: 'ENGINE TRAIL',
  wings: 'WINGS',
  core: 'ENERGY CORE',
  particles: 'PARTICLES',
  cockpit: 'COCKPIT',
  effect: 'SPECIAL EFFECT',
};

export type HullPattern = 'plain' | 'stripe' | 'split' | 'checker' | 'panel' | 'circuit' | 'molten' | 'gold' | 'holo' | 'crystal' | 'aurora' | 'nebula' | 'void';
export type FlameStyle = 'standard' | 'wide' | 'twin' | 'pulse' | 'ring' | 'spiral' | 'needle';
export type TrailStyle = 'line' | 'dashed' | 'double' | 'ribbon' | 'comet' | 'stars' | 'constellation' | 'geometric' | 'helix' | 'prism';
export type WingStyle = 'stock' | 'swept' | 'delta' | 'twinfin' | 'blades' | 'talon' | 'halo';
export type CoreStyle = 'none' | 'steady' | 'pulse' | 'beat' | 'prism' | 'star';
export type ParticleStyle = 'standard' | 'embers' | 'ions' | 'stardust' | 'pixels' | 'plasma' | 'frost' | 'singularity';
export type EffectStyle = 'none' | 'sparks' | 'orbiters' | 'halo' | 'rings' | 'field' | 'constellation' | 'binary' | 'horizon' | 'comet';

export interface HullLook {
  /** Light, mid and dark plating, and the accent used on wing tips and trim. */
  light: string;
  mid: string;
  dark: string;
  accent: string;
  pattern: HullPattern;
  /** Second colourway for patterns that need one. */
  alt?: string[];
  /** Animation frames (1 = static). */
  frames: number;
  /** Soft glow drawn under the hull, or null. */
  glow: string | null;
}
export interface EngineLook {
  nozzle: string;
  /** Core -> mid -> outer flame colours. */
  flame: [string, string, string];
  style: FlameStyle;
  glow: string;
  /** Extra flame length in pixels. */
  length: number;
}
export interface TrailLook {
  style: TrailStyle;
  colors: string[];
  /** Number of stored trail points drawn (max 48). */
  length: number;
}
export interface WingLook {
  style: WingStyle;
}
export interface CoreLook {
  style: CoreStyle;
  colors: string[];
  /** Glow radius in pixels (0 = none). */
  glow: number;
}
export interface ParticleLook {
  style: ParticleStyle;
  colors: [string, string];
  /** Emission-rate multiplier. */
  rate: number;
}
export interface CockpitLook {
  colors: [string, string];
  blink: boolean;
}
export interface EffectLook {
  style: EffectStyle;
  colors: string[];
}

export interface SlotLook {
  hull: HullLook;
  engine: EngineLook;
  trail: TrailLook;
  wings: WingLook;
  core: CoreLook;
  particles: ParticleLook;
  cockpit: CockpitLook;
  effect: EffectLook;
}

/** How an item can be obtained. */
export type Obtain =
  | { kind: 'starter' }
  | { kind: 'case' }
  | { kind: 'shop'; price: number }
  | { kind: 'achievement'; id: string }
  | { kind: 'level'; level: number };

export interface CosmeticDef<S extends CosmeticSlot = CosmeticSlot> {
  id: string;
  slot: S;
  name: string;
  rarity: Rarity;
  description: string;
  obtain: Obtain;
  look: SlotLook[S];
}

type AnyDef = { [S in CosmeticSlot]: CosmeticDef<S> }[CosmeticSlot];

const CASE: Obtain = { kind: 'case' };
const shop = (price: number): Obtain => ({ kind: 'shop', price });
const ach = (id: string): Obtain => ({ kind: 'achievement', id });
const lvl = (level: number): Obtain => ({ kind: 'level', level });

const hull = (id: string, name: string, rarity: Rarity, description: string, obtain: Obtain, look: Partial<HullLook> & Pick<HullLook, 'light' | 'mid' | 'dark' | 'accent'>): CosmeticDef<'hull'> => ({
  id: `hull.${id}`,
  slot: 'hull',
  name,
  rarity,
  description,
  obtain,
  look: { pattern: 'plain', frames: 1, glow: null, ...look },
});
const engine = (id: string, name: string, rarity: Rarity, description: string, obtain: Obtain, look: EngineLook): CosmeticDef<'engine'> => ({ id: `engine.${id}`, slot: 'engine', name, rarity, description, obtain, look });
const trail = (id: string, name: string, rarity: Rarity, description: string, obtain: Obtain, look: TrailLook): CosmeticDef<'trail'> => ({ id: `trail.${id}`, slot: 'trail', name, rarity, description, obtain, look });
const wings = (id: string, name: string, rarity: Rarity, description: string, obtain: Obtain, style: WingStyle): CosmeticDef<'wings'> => ({ id: `wings.${id}`, slot: 'wings', name, rarity, description, obtain, look: { style } });
const core = (id: string, name: string, rarity: Rarity, description: string, obtain: Obtain, look: CoreLook): CosmeticDef<'core'> => ({ id: `core.${id}`, slot: 'core', name, rarity, description, obtain, look });
const particles = (id: string, name: string, rarity: Rarity, description: string, obtain: Obtain, look: ParticleLook): CosmeticDef<'particles'> => ({ id: `particles.${id}`, slot: 'particles', name, rarity, description, obtain, look });
const cockpit = (id: string, name: string, rarity: Rarity, description: string, obtain: Obtain, look: CockpitLook): CosmeticDef<'cockpit'> => ({ id: `cockpit.${id}`, slot: 'cockpit', name, rarity, description, obtain, look });
const effect = (id: string, name: string, rarity: Rarity, description: string, obtain: Obtain, look: EffectLook): CosmeticDef<'effect'> => ({ id: `effect.${id}`, slot: 'effect', name, rarity, description, obtain, look });

const ITEMS: AnyDef[] = [
  // ---------------------------------------------------------------- hull skins
  hull('standard', 'SURVEY WHITE', 'common', 'Factory finish. Every pilot starts here.', { kind: 'starter' }, { light: '#e8f0ff', mid: '#9aa8cc', dark: '#4a5680', accent: '#9b5cff' }),
  hull('slate', 'SLATE', 'common', 'Matte grey plating that hides the scorch marks.', shop(60), { light: '#b8c2d8', mid: '#6f7a96', dark: '#2f364c', accent: '#3ef2ff' }),
  hull('ember', 'EMBER', 'common', 'Burnt orange, for pilots who like the corona.', CASE, { light: '#ffd0a0', mid: '#d0703a', dark: '#5a2416', accent: '#ffc94d' }),
  hull('tidal', 'TIDAL', 'common', 'Deep-water blue.', CASE, { light: '#bfe4ff', mid: '#4f8fd8', dark: '#1a2f66', accent: '#5dffa0' }),
  hull('moss', 'MOSS', 'common', 'Olive drab from a decommissioned tender.', CASE, { light: '#d4e8b0', mid: '#7f9a54', dark: '#2f3c1e', accent: '#ffc94d' }),
  hull('rose', 'DUSK ROSE', 'common', 'The colour of a red dwarf at the horizon.', shop(80), { light: '#ffd0dc', mid: '#c8607a', dark: '#4c1c30', accent: '#e8f0ff' }),
  hull('racing', 'RACING STRIPE', 'uncommon', 'White with a hard red stripe down the spine.', CASE, { light: '#f4f6ff', mid: '#b0b8d0', dark: '#4a5068', accent: '#ff4d5e', pattern: 'stripe', alt: ['#ff4d5e', '#c22a3c'] }),
  hull('hazard', 'HAZARD', 'uncommon', 'Black and amber chevrons. Other pilots give it room.', CASE, { light: '#ffc94d', mid: '#c89020', dark: '#2a2410', accent: '#1c1c22', pattern: 'checker', alt: ['#1c1c22', '#101014'] }),
  hull('twilight', 'TWILIGHT SPLIT', 'uncommon', 'Violet above, teal below, split on the keel line.', CASE, { light: '#d8c0ff', mid: '#8a5cd8', dark: '#2c1c58', accent: '#3ef2ff', pattern: 'split', alt: ['#a8f4e8', '#2fa89a', '#103a40'] }),
  hull('polar', 'POLAR', 'uncommon', 'Ice-white with cyan underside, built for cryo-plumes.', shop(180), { light: '#ffffff', mid: '#c8e4f4', dark: '#6f90b0', accent: '#3ef2ff', pattern: 'split', alt: ['#bff4ff', '#3ec8e8', '#125a78'] }),
  hull('fieldworn', 'FIELD-WORN', 'rare', 'Riveted panels with a maintenance light that walks the hull.', CASE, { light: '#d8dce8', mid: '#8088a0', dark: '#30364a', accent: '#ffc94d', pattern: 'panel', alt: ['#ffc94d'], frames: 8 }),
  hull('circuit', 'LIVE CIRCUIT', 'rare', 'Dark composite threaded with traces that carry a pulse.', CASE, { light: '#58648c', mid: '#2c3454', dark: '#121628', accent: '#3ef2ff', pattern: 'circuit', alt: ['#3ef2ff', '#1a7f8f'], frames: 8 }),
  hull('surveyor', 'CARTOGRAPHER', 'rare', 'Survey-corps blue with a scanning strip. Earned in the field.', ach('catalogue-50'), { light: '#cfe4ff', mid: '#5a8adf', dark: '#1c2c6a', accent: '#fff3a8', pattern: 'panel', alt: ['#fff3a8'], frames: 8 }),
  hull('molten', 'MOLTEN CORE', 'epic', 'A black crust over something that is still liquid.', CASE, { light: '#5a3a3a', mid: '#2a1a1c', dark: '#100a0c', accent: '#ff8a3d', pattern: 'molten', alt: ['#ffe08a', '#ff8a3d', '#c0392b'], frames: 10, glow: '#ff5a2a' }),
  hull('gilded', 'GILDED', 'epic', 'Polished gold. A highlight runs its length as it turns.', CASE, { light: '#fff0b0', mid: '#e0a830', dark: '#7a5210', accent: '#ffffff', pattern: 'gold', alt: ['#ffffff', '#fff6d0'], frames: 12, glow: '#ffc94d' }),
  hull('sentinel', 'SENTINEL RED', 'epic', 'Armour cut from the war machine itself. It still runs warm.', ach('boss-sentinel'), { light: '#ff9aa4', mid: '#c8283c', dark: '#3c0c18', accent: '#ffc94d', pattern: 'molten', alt: ['#ffd0a0', '#ff4d5e', '#8a1020'], frames: 10, glow: '#ff4d5e' }),
  hull('holo', 'HOLOGRAPHIC', 'legendary', 'The colour depends on where you stand. It never stands still.', CASE, { light: '#ffffff', mid: '#c0c8ff', dark: '#404a90', accent: '#ffffff', pattern: 'holo', frames: 16, glow: '#9fd8ff' }),
  hull('crystal', 'CRYSTALLINE', 'legendary', 'Grown, not built. The facets catch light one after another.', CASE, { light: '#f0fbff', mid: '#8fe0f4', dark: '#2a6a90', accent: '#ffffff', pattern: 'crystal', alt: ['#ffffff', '#bff4ff', '#5ac8e8', '#2a88b8', '#b8a4ff'], frames: 12, glow: '#7ffcff' }),
  hull('aurora', 'AURORA', 'legendary', 'Curtains of green and violet fall along the hull.', ach('master-explorer'), { light: '#d0ffe8', mid: '#3ad8a0', dark: '#103a48', accent: '#b77dff', pattern: 'aurora', alt: ['#5dffa0', '#3ef2ff', '#9b5cff', '#ff7ad8'], frames: 16, glow: '#5dffa0' }),
  hull('nebula', 'NEBULA WINDOW', 'mythic', 'The plating is a window onto somewhere else. Stars drift across it.', CASE, { light: '#c8a4ff', mid: '#5a2c9a', dark: '#140a30', accent: '#ff7ad8', pattern: 'nebula', alt: ['#ffffff', '#ff7ad8', '#3ef2ff', '#2a1458', '#0c0620'], frames: 20, glow: '#9b5cff' }),
  hull('void', 'EVENT HORIZON', 'mythic', 'No surface at all: a ship-shaped hole with a burning edge.', ach('cosmic-veteran'), { light: '#0a0a12', mid: '#050508', dark: '#000000', accent: '#ffd890', pattern: 'void', alt: ['#ffffff', '#ffd890', '#ff8a3d', '#b77dff'], frames: 16, glow: '#ffb060' }),

  // ---------------------------------------------------------------- wings
  wings('stock', 'STOCK FINS', 'common', 'The standard airframe.', { kind: 'starter' }, 'stock'),
  wings('swept', 'SWEPT WINGS', 'uncommon', 'Raked back for a meaner silhouette.', CASE, 'swept'),
  wings('delta', 'DELTA', 'uncommon', 'One broad triangular planform.', shop(220), 'delta'),
  wings('twinfin', 'TWIN FINS', 'rare', 'Paired tail fins with a gap between them.', CASE, 'twinfin'),
  wings('blades', 'BLADES', 'rare', 'Forward-swept blades ahead of the cockpit.', CASE, 'blades'),
  wings('talon', 'TALON', 'epic', 'Hooked wing tips that curl inward like claws.', CASE, 'talon'),
  wings('halo', 'HALO FRAME', 'legendary', 'A ring structure braced around the fuselage.', lvl(18), 'halo'),

  // ---------------------------------------------------------------- cockpits
  cockpit('cyan', 'CYAN GLASS', 'common', 'Standard canopy tint.', { kind: 'starter' }, { colors: ['#3ef2ff', '#3ef2ff'], blink: false }),
  cockpit('amber', 'AMBER GLASS', 'common', 'Warm tint, easier on the eyes near a star.', shop(60), { colors: ['#ffc94d', '#ffc94d'], blink: false }),
  cockpit('green', 'NIGHT VISION', 'common', 'Green phosphor.', CASE, { colors: ['#5dffa0', '#5dffa0'], blink: false }),
  cockpit('red', 'RED ALERT', 'uncommon', 'A canopy that always looks like trouble.', CASE, { colors: ['#ff4d5e', '#ff9aa4'], blink: true }),
  cockpit('mirror', 'MIRRORED', 'rare', 'Silvered. Nobody sees in.', CASE, { colors: ['#ffffff', '#b8c4e0'], blink: true }),
  cockpit('violet', 'VIOLET PRISM', 'rare', 'Splits the light as the ship turns.', lvl(8), { colors: ['#b77dff', '#3ef2ff'], blink: true }),
  cockpit('solar', 'SOLAR GOLD', 'epic', 'Gold-film glass that glows on its own.', CASE, { colors: ['#fff0b0', '#ffb030'], blink: true }),

  // ---------------------------------------------------------------- energy cores
  core('none', 'SHIELDED CORE', 'common', 'The core stays behind its plating.', { kind: 'starter' }, { style: 'none', colors: ['#3ef2ff'], glow: 0 }),
  core('steady', 'OPEN CORE', 'common', 'A steady point of light amidships.', shop(90), { style: 'steady', colors: ['#3ef2ff', '#ffffff'], glow: 3 }),
  core('pulse', 'PULSE CORE', 'uncommon', 'Breathes slowly, like something asleep.', CASE, { style: 'pulse', colors: ['#5dffa0', '#e8fff0'], glow: 4 }),
  core('beat', 'HEARTBEAT', 'rare', 'Two quick beats, then a pause.', CASE, { style: 'beat', colors: ['#ff4d5e', '#ffd0d4'], glow: 5 }),
  core('violet', 'VIOLET REACTOR', 'rare', 'A reactor tuned past the visible.', lvl(5), { style: 'pulse', colors: ['#b77dff', '#ffffff'], glow: 5 }),
  core('prism', 'PRISM CORE', 'epic', 'Cycles through the spectrum.', CASE, { style: 'prism', colors: ['#ff4d5e', '#ffc94d', '#5dffa0', '#3ef2ff', '#b77dff'], glow: 6 }),
  core('neutron', 'NEUTRON HEART', 'legendary', 'A sliver of the Core, still spinning.', ach('boss-neutron'), { style: 'star', colors: ['#ffffff', '#7ffcff', '#3ef2ff'], glow: 8 }),
  core('star', 'CAPTIVE STAR', 'mythic', 'There is a star in there. It flares.', CASE, { style: 'star', colors: ['#ffffff', '#ffe08a', '#ff8a3d'], glow: 10 }),

  // ---------------------------------------------------------------- engines
  engine('standard', 'CHEMICAL DRIVE', 'common', 'Orange flame, honest thrust.', { kind: 'starter' }, { nozzle: '#ff8a3d', flame: ['#ffffff', '#ffc94d', '#ff8a3d'], style: 'standard', glow: '#ff8a3d', length: 0 }),
  engine('ion', 'ION DRIVE', 'common', 'A thin blue line of xenon.', CASE, { nozzle: '#3d6bff', flame: ['#ffffff', '#7ffcff', '#3d6bff'], style: 'needle', glow: '#3d6bff', length: 1 }),
  engine('afterburner', 'AFTERBURNER', 'uncommon', 'Wide, loud and yellow.', CASE, { nozzle: '#ffc94d', flame: ['#ffffff', '#fff0b0', '#ffc94d'], style: 'wide', glow: '#ffc94d', length: 1 }),
  engine('verdant', 'VERDANT DRIVE', 'uncommon', 'Copper in the fuel turns it green.', shop(200), { nozzle: '#5dffa0', flame: ['#ffffff', '#b0ffd0', '#2fb870'], style: 'standard', glow: '#5dffa0', length: 1 }),
  engine('twin', 'TWIN NOZZLES', 'rare', 'Two flames, side by side.', CASE, { nozzle: '#ff8a3d', flame: ['#ffffff', '#ffc94d', '#ff4d5e'], style: 'twin', glow: '#ff8a3d', length: 1 }),
  engine('pulse', 'PULSE DETONATION', 'rare', 'Fires in beats instead of burning.', CASE, { nozzle: '#b77dff', flame: ['#ffffff', '#d8c0ff', '#9b5cff'], style: 'pulse', glow: '#9b5cff', length: 2 }),
  engine('plasma', 'PLASMA RING', 'epic', 'Each pulse leaves a ring behind it.', CASE, { nozzle: '#3ef2ff', flame: ['#ffffff', '#bff9ff', '#3ef2ff'], style: 'ring', glow: '#3ef2ff', length: 2 }),
  engine('devourer', 'SINGULARITY DRIVE', 'epic', 'The exhaust falls inward before it leaves.', ach('boss-devourer'), { nozzle: '#b77dff', flame: ['#ffffff', '#ff7ad8', '#5a2c9a'], style: 'spiral', glow: '#b77dff', length: 3 }),
  engine('helix', 'HELIX DRIVE', 'legendary', 'Twin streams wind around each other.', CASE, { nozzle: '#ffc94d', flame: ['#ffffff', '#ffc94d', '#3ef2ff'], style: 'spiral', glow: '#ffc94d', length: 4 }),
  engine('nova', 'NOVA DRIVE', 'mythic', 'White at the nozzle, every colour after.', CASE, { nozzle: '#ffffff', flame: ['#ffffff', '#ff7ad8', '#3ef2ff'], style: 'ring', glow: '#ffffff', length: 5 }),

  // ---------------------------------------------------------------- trails
  trail('standard', 'ION WAKE', 'common', 'The stock cyan-to-violet wake.', { kind: 'starter' }, { style: 'line', colors: ['#3ef2ff', '#3d6bff', '#9b5cff'], length: 26 }),
  trail('amber', 'AMBER WAKE', 'common', 'A warm wake.', shop(70), { style: 'line', colors: ['#ffc94d', '#ff8a3d', '#c0392b'], length: 26 }),
  trail('mint', 'MINT WAKE', 'common', 'Green fading to teal.', CASE, { style: 'line', colors: ['#5dffa0', '#2fb8a0', '#1a5f8f'], length: 26 }),
  trail('dashed', 'MORSE', 'uncommon', 'Dots and dashes.', CASE, { style: 'dashed', colors: ['#e8f0ff', '#8a96b8'], length: 32 }),
  trail('double', 'TWIN WAKE', 'uncommon', 'Two parallel lines from the wing roots.', CASE, { style: 'double', colors: ['#3ef2ff', '#9b5cff'], length: 30 }),
  trail('ribbon', 'RIBBON', 'rare', 'A broad band that tapers to nothing.', CASE, { style: 'ribbon', colors: ['#ff7ad8', '#9b5cff', '#3d6bff'], length: 36 }),
  trail('comet', 'COMET TAIL', 'rare', 'A bright head and a long pale tail.', lvl(3), { style: 'comet', colors: ['#ffffff', '#bff9ff', '#3ef2ff'], length: 40 }),
  trail('stars', 'STARFALL', 'epic', 'Sheds small stars that twinkle out behind you.', CASE, { style: 'stars', colors: ['#ffffff', '#fff3a8', '#ffc94d'], length: 40 }),
  trail('geometric', 'TESSELLATE', 'epic', 'Leaves squares and diamonds that shrink away.', CASE, { style: 'geometric', colors: ['#3ef2ff', '#5dffa0', '#b77dff'], length: 40 }),
  trail('constellation', 'CONSTELLATION', 'legendary', 'Your path, drawn as joined stars.', ach('cartographer-25'), { style: 'constellation', colors: ['#ffffff', '#9fd8ff', '#3d6bff'], length: 46 }),
  trail('helix', 'DOUBLE HELIX', 'legendary', 'Two strands that cross and re-cross.', CASE, { style: 'helix', colors: ['#3ef2ff', '#ff7ad8', '#ffffff'], length: 44 }),
  trail('prism', 'PRISMATIC', 'mythic', 'The whole spectrum, travelling down the wake.', CASE, { style: 'prism', colors: ['#ff4d5e', '#ff8a3d', '#ffc94d', '#5dffa0', '#3ef2ff', '#3d6bff', '#b77dff'], length: 48 }),

  // ---------------------------------------------------------------- particles
  particles('standard', 'EXHAUST', 'common', 'Ordinary exhaust.', { kind: 'starter' }, { style: 'standard', colors: ['#ff8a3d', '#ffc94d'], rate: 1 }),
  particles('embers', 'EMBERS', 'common', 'Slow, drifting sparks.', CASE, { style: 'embers', colors: ['#ff4d5e', '#ffc94d'], rate: 0.9 }),
  particles('ions', 'ION SPRAY', 'uncommon', 'A fine blue spray.', CASE, { style: 'ions', colors: ['#3ef2ff', '#3d6bff'], rate: 1.1 }),
  particles('frost', 'FROST', 'uncommon', 'Ice crystals that hang in the wake.', shop(190), { style: 'frost', colors: ['#ffffff', '#bfe8ff'], rate: 1 }),
  particles('pixels', 'DATA STREAM', 'rare', 'Square green fragments, like a corrupted feed.', CASE, { style: 'pixels', colors: ['#5dffa0', '#e8fff0'], rate: 1 }),
  particles('plasma', 'PLASMA', 'epic', 'Fat violet globes that pop.', CASE, { style: 'plasma', colors: ['#b77dff', '#ff7ad8'], rate: 0.9 }),
  particles('stardust', 'STARDUST', 'legendary', 'Gold dust that scatters and lingers.', CASE, { style: 'stardust', colors: ['#fff3a8', '#ffffff'], rate: 1.2 }),
  particles('singularity', 'COLLAPSE', 'mythic', 'The exhaust curls back toward the ship before it dies.', CASE, { style: 'singularity', colors: ['#ffffff', '#b77dff'], rate: 1 }),

  // ---------------------------------------------------------------- special effects
  effect('none', 'NO EFFECT', 'common', 'Nothing extra.', { kind: 'starter' }, { style: 'none', colors: [] }),
  effect('sparks', 'STATIC', 'uncommon', 'The hull crackles now and then.', CASE, { style: 'sparks', colors: ['#3ef2ff', '#ffffff'] }),
  effect('orbiters', 'SATELLITES', 'rare', 'Three motes keep station around the ship.', CASE, { style: 'orbiters', colors: ['#3ef2ff', '#ffc94d', '#ff7ad8'] }),
  effect('halo', 'HALO', 'rare', 'A soft ring that breathes.', lvl(12), { style: 'halo', colors: ['#fff3a8', '#ffc94d'] }),
  effect('field', 'ENERGY FIELD', 'epic', 'A faceted field flickers around the hull.', CASE, { style: 'field', colors: ['#3ef2ff', '#3d6bff'] }),
  effect('rings', 'PLANETARY RINGS', 'epic', 'A tilted ring system, turning.', ach('all-environments'), { style: 'rings', colors: ['#f0dcb8', '#b98a5a', '#ffffff'] }),
  effect('comet', 'COMA', 'epic', 'A faint cometary coma streams off the bow.', CASE, { style: 'comet', colors: ['#bff9ff', '#ffffff'] }),
  effect('constellation', 'ASTERISM', 'legendary', 'A small constellation turns around you.', CASE, { style: 'constellation', colors: ['#ffffff', '#9fd8ff'] }),
  effect('binary', 'BINARY COMPANIONS', 'legendary', 'Two tiny suns orbit the ship, and each other.', ach('binary-explorer'), { style: 'binary', colors: ['#ffd890', '#9fd8ff'] }),
  effect('horizon', 'PHOTON RING', 'mythic', 'Light bends around the hull in a thin bright ring.', CASE, { style: 'horizon', colors: ['#ffffff', '#ffd890', '#ff8a3d'] }),
];

export const COSMETICS: readonly CosmeticDef[] = ITEMS;
const BY_ID = new Map<string, CosmeticDef>(ITEMS.map((c) => [c.id, c]));

export function cosmetic(id: string): CosmeticDef | undefined {
  return BY_ID.get(id);
}

export function cosmeticsIn(slot: CosmeticSlot): CosmeticDef[] {
  return ITEMS.filter((c) => c.slot === slot);
}

export type Loadout = Record<CosmeticSlot, string>;

export const DEFAULT_LOADOUT: Loadout = {
  hull: 'hull.standard',
  engine: 'engine.standard',
  trail: 'trail.standard',
  wings: 'wings.stock',
  core: 'core.none',
  particles: 'particles.standard',
  cockpit: 'cockpit.cyan',
  effect: 'effect.none',
};

export const STARTER_IDS: string[] = ITEMS.filter((c) => c.obtain.kind === 'starter').map((c) => c.id);

/** Everything the painter needs for one ship. */
export type ShipLook = SlotLook & { key: string; rarity: Rarity };

/** Resolve a loadout into paint parameters. Unknown or mismatched ids fall back to the stock part. */
export function resolveLook(loadout: Partial<Loadout> | null | undefined): ShipLook {
  const pick = <S extends CosmeticSlot>(slot: S): CosmeticDef<S> => {
    const c = BY_ID.get(loadout?.[slot] ?? '');
    return (c && c.slot === slot ? c : BY_ID.get(DEFAULT_LOADOUT[slot])) as CosmeticDef<S>;
  };
  const parts = { hull: pick('hull'), engine: pick('engine'), trail: pick('trail'), wings: pick('wings'), core: pick('core'), particles: pick('particles'), cockpit: pick('cockpit'), effect: pick('effect') };
  let best: Rarity = 'common';
  for (const p of Object.values(parts)) if (RARITY_RANK[p.rarity] > RARITY_RANK[best]) best = p.rarity;
  return {
    hull: parts.hull.look,
    engine: parts.engine.look,
    trail: parts.trail.look,
    wings: parts.wings.look,
    core: parts.core.look,
    particles: parts.particles.look,
    cockpit: parts.cockpit.look,
    effect: parts.effect.look,
    key: SLOTS.map((s) => parts[s].id).join('|'),
    rarity: best,
  };
}

/** Where an item comes from, in words (catalogue card). */
export function acquisitionText(c: CosmeticDef): string {
  switch (c.obtain.kind) {
    case 'starter':
      return 'STANDARD ISSUE';
    case 'case':
      return 'FOUND IN CASES';
    case 'shop':
      return `SHOP · ${c.obtain.price} CR`;
    case 'achievement':
      return 'ACHIEVEMENT REWARD';
    case 'level':
      return `PILOT LEVEL ${c.obtain.level}`;
  }
}
