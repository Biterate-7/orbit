/**
 * Extreme and small-body environments.
 *
 *   black hole         frame dragging steadily decays the orbit; deep orbits score more
 *   X-ray binary       a donor star feeds a stream of plasma across the band to a compact object
 *   quasar             twin relativistic jets on a slowly precessing axis
 *   galactic core      stars on plunging eccentric orbits around a central black hole
 *   supernova remnant  repeated blast shells and shrapnel around the stellar corpse
 *   nebula             thick gas: low visibility and ion storms
 *   asteroid field     weak gravity, slow orbits, rock arriving in clusters
 *   cometary region    a river of ice flowing away from the Sun, swelling at perihelion
 *   anomaly            FICTIONAL: a mass that will not hold still
 *
 * These are game environments. Nothing here suggests a spacecraft could operate in such places.
 */
import type { AstroObject } from '../../astronomy/database/schema';
import { shade } from '../../astronomy/database/visuals';
import { TAU } from '../../game/math';
import type { BodyLook, CompanionSpec } from '../../game/types';
import { look, objectColors, scaleLog, spinFrom, starLook } from './common';
import type { EnvironmentDef } from './common';
import { primaryEnvironment } from './classify';
import { SUNWARD } from './planetary';

const hosts = (id: EnvironmentDef['id']) => (o: AstroObject) => primaryEnvironment(o) === id;

const DEFAULTS = {
  companions: [] as CompanionSpec[],
  starDensity: 1,
  hostStarColors: [] as string[],
  galaxies: 0,
  band: false,
  fogColor: '#0d0820',
};

const HOLE_RAMP = ['#0e0620', '#24103d', '#4b1f6b', '#86307a', '#cc4a4a', '#ff8a3d', '#ffd890', '#ffffff'];
const holeLook = (glow = '#9b5cff'): BodyLook => ({ surface: 'plasma', ramp: HOLE_RAMP, rim: '#ffd890', glow, glowScale: 1.45, glowIntensity: 0.6, ring: null, lumpiness: 0 });
const NEUTRON_LOOK: BodyLook = { surface: 'plasma', ramp: ['#1a7f8f', '#3ef2ff', '#bff9ff', '#ffffff'], rim: null, glow: '#3ef2ff', glowScale: 9, glowIntensity: 0.9, ring: null, lumpiness: 0 };

export const EXTREME: EnvironmentDef[] = [
  {
    id: 'black_hole',
    label: 'BLACK HOLE',
    family: 'extreme',
    depth: 2.6,
    minLevel: 10,
    weight: 0.5,
    rarity: 'rare',
    hosts: hosts('black_hole'),
    variantClass: 'Stellar-mass black hole',
    build: () => ({
      ...DEFAULTS,
      body: { kind: 'blackhole', label: 'BLACK HOLE', radius: 13, mu: 3.4e6, heatRadius: 52, heatDps: 18, spin: 1.1, look: holeLook(), deathText: 'CONSUMED BY THE BLACK HOLE', orbit: null },
      safeMin: 88,
      safeMax: 178,
      startAt: 0.47,
      hazardGravity: 0.65,
      speedMul: 1.1,
      interval: [3.0, 1.9],
      native: [],
      compatible: ['asteroids', 'comets', 'waves', 'debris', 'beams', 'fog', 'storm'],
      mechanics: { frameDrag: 2.2, depthBonus: true },
      accent: '#b77dff',
      ripple: '#9b5cff',
      nebula: ['#3a1460', '#5a2a14', 0.42],
      tagline: 'EVERYTHING FALLS IN. YOUR ORBIT DECAYS UNLESS YOU FIGHT IT.',
      description: 'A collapsed star whose gravity lets nothing escape. Spinning space around it drags orbits steadily inward.',
      names: ['EVENT HORIZON', '{N} ABYSS', 'PHOTON RING', 'NO RETURN'],
    }),
  },

  {
    id: 'xray_binary',
    label: 'X-RAY BINARY',
    family: 'extreme',
    depth: 2.5,
    minLevel: 12,
    weight: 0.5,
    rarity: 'rare',
    hosts: hosts('xray_binary'),
    variantClass: 'X-ray binary',
    build: ({ object: o, rng }) => {
      const highMass = o ? o.classification.toLowerCase().includes('high-mass') : rng.chance(0.5);
      const safeMin = 74;
      const safeMax = 170;
      const donor: CompanionSpec = {
        kind: 'star',
        name: null,
        orbitRadius: safeMax + 30,
        ecc: 0,
        argPeri: 0,
        period: 34 * rng.sign(),
        phase: rng.range(0, TAU),
        radius: highMass ? 18 : 13,
        mu: 0.14e6,
        heatRadius: highMass ? 34 : 26,
        heatDps: 14,
        look: starLook(highMass ? 22000 : 3600),
      };
      return {
        ...DEFAULTS,
        body: { kind: 'blackhole', label: 'COMPACT OBJECT', radius: 9, mu: 2.7e6, heatRadius: 36, heatDps: 15, spin: 1.4, look: holeLook('#3d6bff'), deathText: 'CONSUMED BY THE ACCRETOR', orbit: null },
        companions: [donor],
        safeMin,
        safeMax,
        startAt: 0.42,
        hazardGravity: 0.55,
        speedMul: 1.1,
        interval: [2.6, 1.6],
        native: [],
        compatible: ['comets', 'waves', 'debris', 'beams'],
        mechanics: { spawn: 'donor', frameDrag: 1.0 },
        accent: '#7ffcff',
        ripple: '#3d6bff',
        nebula: ['#14306a', '#4a1a5a', 0.4],
        tagline: 'A STAR IS BEING EATEN ALIVE. ITS PLASMA CROSSES YOUR ORBIT.',
        description: `A ${highMass ? 'massive blue' : 'small, cool'} star orbiting a compact object - a neutron star or black hole - that strips gas from it. The infalling stream glows in X-rays.`,
        names: ['{N} ACCRETION', 'ROCHE LOBE', '{N} STREAM'],
      };
    },
  },

  {
    id: 'quasar',
    label: 'QUASAR',
    family: 'extreme',
    depth: 3,
    minLevel: 15,
    weight: 0.4,
    rarity: 'rare',
    hosts: hosts('quasar'),
    variantClass: 'Active galactic nucleus',
    build: ({ rng }) => ({
      ...DEFAULTS,
      body: { kind: 'blackhole', label: 'ACTIVE GALACTIC NUCLEUS', radius: 15, mu: 3.6e6, heatRadius: 56, heatDps: 20, spin: 1.3, look: holeLook('#b8a8ff'), deathText: 'CONSUMED BY THE QUASAR', orbit: null },
      safeMin: 92,
      safeMax: 180,
      startAt: 0.5,
      hazardGravity: 0.65,
      speedMul: 1.1,
      interval: [3.3, 2.2],
      native: ['beams'],
      compatible: ['asteroids', 'waves', 'debris', 'fog'],
      mechanics: { beam: { count: 2, angularSpeed: 0.07 * rng.sign(), off: 2.3, charge: 1.1, on: 1.8, halfWidth: 7, jet: true }, frameDrag: 1.6, depthBonus: true },
      accent: '#b8a8ff',
      ripple: '#9b5cff',
      nebula: ['#2a1a6a', '#14143a', 0.3],
      galaxies: 7,
      starDensity: 0.55,
      tagline: 'TWIN JETS AT NEAR LIGHT SPEED. CROSS THE AXIS BETWEEN PULSES.',
      description: 'A supermassive black hole feeding so violently that it outshines its whole galaxy and fires twin jets of plasma across intergalactic space.',
      names: ['REDSHIFT {Z}', '{N} JET', 'RELATIVISTIC'],
    }),
  },

  {
    id: 'galactic_core',
    label: 'GALACTIC CORE',
    family: 'extreme',
    depth: 3,
    minLevel: 13,
    weight: 0.6,
    rarity: 'uncommon',
    hosts: hosts('galactic_core'),
    variantClass: 'Galactic nucleus',
    build: ({ object: o, rng }) => {
      const colors = objectColors(o, ['#fff0d0', '#b8c4ff', '#4a4a8a']);
      const safeMin = 84;
      const safeMax = 178;
      const star = (a: number, ecc: number, count: number) => ({ radius: a, spread: 6, count, dir: (rng.chance(0.75) ? 1 : -1) as 1 | -1, ecc, inclination: 0, node: rng.range(0, TAU), kind: 'star' as const });
      return {
        ...DEFAULTS,
        body: { kind: 'blackhole', label: 'SUPERMASSIVE BLACK HOLE', radius: 12, mu: 3.3e6, heatRadius: 46, heatDps: 16, spin: 0.9, look: holeLook('#ffd890'), deathText: 'CONSUMED AT THE GALACTIC CORE', orbit: null },
        safeMin,
        safeMax,
        startAt: 0.5,
        hazardGravity: 0.6,
        speedMul: 1.1,
        interval: [3.6, 2.4],
        native: ['belt'],
        compatible: ['asteroids', 'waves', 'debris', 'fog', 'comets'],
        // Stars on plunging orbits, like the S-stars around the Milky Way's central black hole.
        mechanics: { belts: [star(118, rng.range(0.42, 0.55), 3), star(146, rng.range(0.3, 0.42), 3)], depthBonus: true },
        accent: '#ffc94d',
        ripple: '#b77dff',
        nebula: [shade(colors[1], 0.4), shade(colors[0], 0.28), 0.5],
        starDensity: 2.6,
        band: true,
        galaxies: 2,
        tagline: 'STARS DIVE PAST THE CENTRAL BLACK HOLE. STAY OFF THEIR PATHS.',
        description: 'The crowded centre of a galaxy, where stars whip around a supermassive black hole on stretched, plunging orbits.',
        names: ['BEYOND {N}', 'CORE OF {N}', '{N} NUCLEUS'],
      };
    },
  },

  {
    id: 'supernova_remnant',
    label: 'SUPERNOVA REMNANT',
    family: 'extreme',
    depth: 2.3,
    minLevel: 10,
    weight: 0.6,
    rarity: 'uncommon',
    hosts: hosts('supernova_remnant'),
    variantClass: 'Supernova remnant',
    build: ({ object: o }) => {
      const colors = objectColors(o, ['#ffb36b', '#3ec9d8', '#7a2a4a']);
      return {
        ...DEFAULTS,
        body: { kind: 'neutron', label: 'STELLAR CORPSE', radius: 6, mu: 2.8e6, heatRadius: 28, heatDps: 12, spin: 0.6, look: NEUTRON_LOOK, deathText: 'CRUSHED BY THE STELLAR CORPSE', orbit: null },
        safeMin: 68,
        safeMax: 172,
        startAt: 0.5,
        hazardGravity: 0.45,
        speedMul: 1.2,
        interval: [3.2, 2.1],
        native: ['waves', 'debris'],
        compatible: ['asteroids', 'comets', 'beams', 'fog'],
        mechanics: { waveStrength: 1.5 },
        accent: '#ff8a3d',
        ripple: '#3ef2ff',
        nebula: [shade(colors[0], 0.5), shade(colors[1], 0.45), 0.95],
        tagline: 'THE STAR IS GONE. THE BLAST IS STILL ARRIVING.',
        description: 'The expanding wreckage of an exploded star, still ringing with shock fronts around the collapsed core left behind.',
        names: ['{N} AFTERMATH', 'SHOCK FRONT', '{N} EJECTA'],
      };
    },
  },

  {
    id: 'nebula',
    label: 'NEBULA',
    family: 'extreme',
    depth: 2,
    minLevel: 6,
    weight: 0.8,
    rarity: 'uncommon',
    hosts: hosts('nebula'),
    variantClass: 'Emission nebula',
    build: ({ object: o, rng }) => {
      const cls = (o?.classification ?? 'HII region').toLowerCase();
      const colors = objectColors(o, ['#ff7a9a', '#c0407a', '#4a1a5a']);
      const planetary = cls.includes('planetary');
      const dark = cls.includes('dark') || cls.includes('molecular');
      // The central star is not an individually catalogued object: it is generated from the nebula's type.
      const core = planetary
        ? { label: 'PLANETARY NEBULA', radius: 7, mu: 2.4e6, heat: 26, look: starLook(rng.range(40000, 90000), { glowScale: 5 }), text: 'A shell of gas thrown off by a dying star, lit by the white-hot core at its centre.' }
        : dark
          ? { label: cls.includes('molecular') ? 'MOLECULAR CLOUD' : 'DARK NEBULA', radius: 18, mu: 1.6e6, heat: 34, look: starLook(rng.range(2800, 3600)), text: 'A cold, dense cloud of gas and dust that blocks the light behind it. New stars are condensing inside.' }
          : { label: cls.includes('reflection') ? 'REFLECTION NEBULA' : 'EMISSION NEBULA', radius: 26, mu: 2.3e6, heat: 46, look: starLook(rng.range(18000, 32000)), text: 'A vast cloud of gas set glowing by the hot young stars forming within it.' };
      return {
        ...DEFAULTS,
        body: { kind: 'star', label: core.label, radius: core.radius, mu: core.mu, heatRadius: core.heat, heatDps: 12, spin: 0.05, look: core.look, deathText: 'LOST INSIDE THE NEBULA', orbit: null },
        safeMin: core.heat + 34,
        safeMax: 170,
        startAt: 0.48,
        hazardGravity: 0.38,
        speedMul: 1.05,
        interval: [3.0, 1.9],
        native: ['fog', 'storm'],
        compatible: ['asteroids', 'comets', 'waves', 'debris'],
        mechanics: {},
        accent: '#b77dff',
        ripple: '#9b5cff',
        nebula: [shade(colors[0], 0.55), shade(colors[1], 0.6), 0.95],
        fogColor: shade(colors[2] ?? colors[1], dark ? 0.22 : 0.3),
        starDensity: dark ? 0.5 : 1.1,
        tagline: 'LOW VISIBILITY. ION STORMS. YOU SEE ONLY WHAT IS CLOSE.',
        description: `${core.text} The embedded star shown here is generated, not catalogued.`,
        names: ['{N} VEIL', 'INTO {N}', '{N} SHROUD'],
      };
    },
  },

  {
    id: 'asteroid_field',
    label: 'ASTEROID FIELD',
    family: 'extreme',
    depth: 0,
    minLevel: 2,
    weight: 1.1,
    rarity: 'common',
    hosts: hosts('asteroid_field'),
    variantClass: 'Asteroid',
    build: ({ object: o, rng }) => {
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 0.15, 480, 8, 17);
      const mu = scaleLog(p?.radius ?? null, 0.15, 480, 0.42e6, 0.78e6);
      const colors = objectColors(o, ['#9a94a3', '#5f5870', '#2c2838']);
      const safeMin = radius + 32;
      return {
        ...DEFAULTS,
        body: {
          kind: 'smallbody',
          label: o?.category === 'dwarf-planet' ? 'DWARF PLANET' : 'ASTEROID',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: spinFrom(p?.rotationPeriod ?? null, 0.5),
          look: look('lumpy', colors, { glow: '#3d6bff', glowScale: 2.4, glowIntensity: 0.3, lumpiness: scaleLog(p?.radius ?? null, 0.15, 480, 0.34, 0.06) }),
          deathText: 'CRASHED INTO THE ASTEROID',
          orbit: null,
        },
        safeMin,
        safeMax: 156,
        startAt: 0.5,
        hazardGravity: 0.2,
        speedMul: 0.85,
        interval: [2.6, 1.6],
        native: ['asteroids'],
        compatible: ['belt', 'comets', 'debris', 'waves', 'moon'],
        mechanics: { spawn: 'clusters' },
        accent: '#ffc94d',
        ripple: '#3d6bff',
        nebula: ['#1d2a6b', '#2a1d4a', 0.3],
        hostStarColors: ['#fff4e0'],
        tagline: 'WEAK GRAVITY, SLOW ORBITS. ROCK ARRIVES IN CLUSTERS - FIND THE GAP.',
        description: `A small rocky body among many. Its gravity is feeble, so orbits are slow and every burn counts for more.${rng.chance(0.5) ? '' : ' Loose rubble drifts through in groups.'}`,
        names: ['{N} RUBBLE', '{N} FIELD', 'SCATTERED STONE', '{N} BELT'],
      };
    },
  },

  {
    id: 'comet_region',
    label: 'COMETARY REGION',
    family: 'extreme',
    depth: 0.2,
    minLevel: 3,
    weight: 0.9,
    rarity: 'common',
    hosts: hosts('comet_region'),
    variantClass: 'Comet nucleus',
    build: ({ object: o }) => {
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 0.3, 600, 8, 14);
      const mu = scaleLog(p?.radius ?? null, 0.3, 600, 0.45e6, 0.7e6);
      const icy = o?.category !== 'asteroid';
      const safeMin = radius + 34;
      return {
        ...DEFAULTS,
        body: {
          kind: 'smallbody',
          label: icy ? 'COMET NUCLEUS' : 'ICY BODY',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: spinFrom(p?.rotationPeriod ?? null, 0.4),
          look: look('lumpy', ['#cfe6f4', '#5f7f98', '#1c2a3a'], { glow: '#7fd6ff', glowScale: icy ? 5.5 : 3, glowIntensity: icy ? 0.55 : 0.3, lumpiness: 0.26 }),
          deathText: 'SHATTERED ON THE NUCLEUS',
          orbit: null,
        },
        safeMin,
        safeMax: 158,
        startAt: 0.5,
        hazardGravity: 0.22,
        speedMul: 0.9,
        interval: [2.3, 1.45],
        native: ['comets'],
        compatible: ['asteroids', 'debris', 'waves', 'belt', 'fog'],
        // The tail streams directly away from the Sun, so the ice always arrives from the sunward side.
        mechanics: { spawn: 'stream', streamAngle: SUNWARD },
        accent: '#7ffcff',
        ripple: '#3ef2ff',
        nebula: ['#143a5a', '#1d2a6b', 0.34],
        hostStarColors: ['#fff4e0'],
        tagline: 'A RIVER OF ICE BLOWS AWAY FROM THE SUN. FLY ACROSS THE CURRENT.',
        description: icy
          ? 'The frozen nucleus of a comet. Sunlight boils ice off its surface into a tail that streams away from the Sun.'
          : 'A distant icy body from the outer Solar System, shedding fragments that the solar wind carries downstream.',
        names: ['{N} TAIL', '{N} COMA', 'LONG FALL'],
      };
    },
  },

  {
    id: 'anomaly',
    label: 'GRAVITATIONAL ANOMALY',
    family: 'extreme',
    depth: 3,
    minLevel: 18,
    weight: 0.12,
    rarity: 'legendary',
    hosts: () => false,
    variantClass: 'Unclassified anomaly',
    fictional: true,
    build: ({ rng }) => ({
      ...DEFAULTS,
      body: {
        kind: 'neutron',
        label: 'ANOMALY',
        radius: 8,
        mu: 2.6e6,
        heatRadius: 30,
        heatDps: 14,
        spin: 1.2,
        look: { surface: 'plasma', ramp: ['#4b2a8a', '#9b5cff', '#e0c8ff', '#ffffff'], rim: null, glow: '#9b5cff', glowScale: 8, glowIntensity: 0.9, ring: null, lumpiness: 0 },
        deathText: 'ERASED BY THE ANOMALY',
        orbit: null,
      },
      safeMin: 72,
      safeMax: 172,
      startAt: 0.5,
      hazardGravity: 0.5,
      speedMul: 1.1,
      interval: [3.4, 2.3],
      native: ['waves'],
      compatible: ['asteroids', 'debris', 'fog', 'comets'],
      mechanics: { muWobble: { amp: 0.2, period: rng.range(8, 11) }, waveStrength: 1.2 },
      accent: '#b77dff',
      ripple: '#9b5cff',
      nebula: ['#3a1460', '#141c6a', 0.5],
      galaxies: 4,
      starDensity: 0.7,
      tagline: 'ITS MASS WILL NOT HOLD STILL. NO ORBIT HERE STAYS AN ORBIT.',
      description: 'An invented object: a mass that swells and shrinks on a slow cycle. Nothing like it is known to exist.',
      names: ['SIGNAL UNKNOWN', 'THE IMPOSSIBLE MASS', 'UNCHARTED'],
    }),
  },
];
