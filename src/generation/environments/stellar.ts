/**
 * Stellar environments. The star's spectral type sets its colour; its class sets the mechanic:
 *
 *   red dwarf       small, close orbits, rapid-fire flares
 *   sun-like        coronal mass ejections roll outward as shock waves
 *   blue giant      radiation pressure pushes the ship outward in gusts
 *   red giant       a huge star with long, far-reaching flares
 *   white dwarf     a tiny dense core ringed by lanes of orbiting debris
 *   neutron star    magnetic bursts knock the thrusters offline
 *   pulsar          rotating beams sweep the whole sector
 *   binary          two stars whirl around a shared barycentre
 *   multiple star   a close pair plus a third star patrolling the outer band
 *   variable star   the star pulses, and its heat zone breathes in and out of the band
 */
import type { AstroObject } from '../../astronomy/database/schema';
import { blackbodyHex, renderTemperature, shade } from '../../astronomy/database/visuals';
import { TAU } from '../../game/math';
import type { CompanionSpec } from '../../game/types';
import { scaleLog, starLook, starTemperature } from './common';
import type { EnvBlueprint, EnvironmentDef } from './common';
import { primaryEnvironment } from './classify';

const hosts = (id: EnvironmentDef['id']) => (o: AstroObject) => primaryEnvironment(o) === id;

const STAR_DEFAULTS = {
  companions: [] as CompanionSpec[],
  starDensity: 1,
  hostStarColors: [] as string[],
  galaxies: 0,
  band: false,
  fogColor: '#0d0820',
};

/** Temperatures of the components of a composite spectral type such as "G2V+K1V". */
function componentTemperatures(o: AstroObject | null, fallback: number): number[] {
  const sp = o?.context.spectralType;
  if (!sp || !sp.includes('+')) {
    const t = starTemperature(o, fallback);
    return [t, t * 0.74, t * 0.6];
  }
  return sp
    .split('+')
    .map((part) => renderTemperature(null, part.trim()))
    .concat([fallback * 0.7, fallback * 0.6]);
}

/** Background tint for a star of the given temperature. */
function tints(teff: number): [string, string, number] {
  const c = blackbodyHex(teff);
  return [shade(c, 0.3), shade(blackbodyHex(teff * 0.6), 0.25), 0.38];
}

function accentFor(teff: number): { accent: string; ripple: string } {
  if (teff > 9000) return { accent: '#7ffcff', ripple: '#3d6bff' };
  if (teff > 5200) return { accent: '#ffc94d', ripple: '#ff8a3d' };
  return { accent: '#ff8a3d', ripple: '#ff4d5e' };
}

/** A star companion on a circular path. `slow` stretches the period beyond the physical one for readability. */
function starCompanion(orbitRadius: number, radius: number, mu: number, heatRadius: number, teff: number, period: number, phase: number): CompanionSpec {
  return { kind: 'star', name: null, orbitRadius, ecc: 0, argPeri: 0, period, phase, radius, mu, heatRadius, heatDps: 14, look: starLook(teff), };
}

/** Shared layout of a close binary: both stars circle the barycentre on opposite sides. */
function binaryCore(o: AstroObject | null, sep: number, muTotal: number, q: number, rA: number, phase: number): { body: EnvBlueprint['body']; companion: CompanionSpec; innerReach: number } {
  const temps = componentTemperatures(o, 6000);
  const muA = muTotal / (1 + q);
  const muB = muTotal - muA;
  const dA = (sep * muB) / muTotal;
  const dB = (sep * muA) / muTotal;
  // Physical period, slowed threefold so the pair is readable (see README, simplifications).
  const period = TAU * Math.sqrt((sep * sep * sep) / muTotal) * 3;
  const rB = rA * (0.55 + 0.3 * q);
  return {
    body: {
      kind: 'star',
      label: 'BINARY STAR',
      radius: rA,
      mu: muA,
      heatRadius: rA + 13,
      heatDps: 14,
      spin: 0.04,
      look: starLook(temps[0]),
      deathText: 'INCINERATED BY THE PRIMARY',
      orbit: { radius: dA, period, phase },
    },
    companion: starCompanion(dB, rB, muB, rB + 11, temps[1], period, phase + Math.PI),
    innerReach: dB + rB + 11,
  };
}

export const STELLAR: EnvironmentDef[] = [
  {
    id: 'red_dwarf',
    label: 'RED DWARF',
    family: 'stellar',
    depth: 1,
    minLevel: 3,
    weight: 1,
    rarity: 'common',
    hosts: hosts('red_dwarf'),
    variantClass: 'Red dwarf',
    build: ({ object: o }) => {
      const teff = starTemperature(o, 3200);
      const radius = scaleLog(teff, 2400, 4000, 18, 24);
      return {
        ...STAR_DEFAULTS,
        body: { kind: 'star', label: 'RED DWARF', radius, mu: 1.7e6, heatRadius: radius + 18, heatDps: 13, spin: 0.05, look: starLook(teff), deathText: 'INCINERATED BY THE RED DWARF', orbit: null },
        safeMin: radius + 42,
        safeMax: 164,
        startAt: 0.55,
        hazardGravity: 0.4,
        speedMul: 1.05,
        interval: [3.0, 1.9],
        native: ['flares'],
        compatible: ['asteroids', 'comets', 'waves', 'debris', 'moon', 'belt'],
        mechanics: { flareRate: 1.7 },
        ...accentFor(teff),
        nebula: tints(teff),
        tagline: 'A SMALL STAR WITH A SHORT TEMPER. FLARES COME FAST.',
        description: 'A cool, dim star - the most common kind in the galaxy. Red dwarfs flare often and violently for their size.',
        names: ['{N} FLARE', 'EMBER STAR', 'RED SHORE'],
      };
    },
  },

  {
    id: 'sunlike',
    label: 'SUN-LIKE STAR',
    family: 'stellar',
    depth: 0.8,
    minLevel: 3,
    weight: 0.9,
    rarity: 'common',
    hosts: hosts('sunlike'),
    variantClass: 'Sun-like star',
    build: ({ object: o }) => {
      const teff = starTemperature(o, 5772);
      const radius = scaleLog(teff, 4200, 8500, 27, 33);
      return {
        ...STAR_DEFAULTS,
        body: { kind: 'star', label: teff > 7200 ? 'WHITE MAIN-SEQUENCE STAR' : 'SUN-LIKE STAR', radius, mu: 2.1e6, heatRadius: radius + 20, heatDps: 14, spin: 0.04, look: starLook(teff), deathText: 'INCINERATED BY THE STAR', orbit: null },
        safeMin: radius + 46,
        safeMax: 172,
        startAt: 0.52,
        hazardGravity: 0.42,
        speedMul: 1.05,
        interval: [3.0, 1.9],
        native: ['waves'],
        compatible: ['flares', 'asteroids', 'comets', 'debris', 'moon', 'belt', 'storm'],
        mechanics: { waveStrength: 1.1 },
        ...accentFor(teff),
        nebula: tints(teff),
        tagline: 'CORONAL MASS EJECTIONS ROLL OUTWARD. BRACE FOR THE SHOCK.',
        description: 'A steady main-sequence star. Now and then it throws off a shell of plasma that shoves everything in orbit outward.',
        names: ['{N} CORONA', 'SOLAR MAXIMUM', '{N} PASSAGE'],
      };
    },
  },

  {
    id: 'blue_giant',
    label: 'BLUE GIANT',
    family: 'stellar',
    depth: 1.6,
    minLevel: 7,
    weight: 0.8,
    rarity: 'uncommon',
    hosts: hosts('blue_giant'),
    variantClass: 'Blue giant',
    build: ({ object: o }) => {
      const teff = starTemperature(o, 20000);
      const wr = o ? o.classification.toLowerCase().includes('wolf-rayet') : false;
      return {
        ...STAR_DEFAULTS,
        body: { kind: 'star', label: wr ? 'WOLF-RAYET STAR' : 'BLUE GIANT', radius: 44, mu: 2.8e6, heatRadius: 70, heatDps: 18, spin: 0.05, look: starLook(Math.max(teff, 9500), { glowScale: 1.7 }), deathText: 'VAPORISED BY THE BLUE GIANT', orbit: null },
        safeMin: 98,
        safeMax: 182,
        startAt: 0.45,
        hazardGravity: 0.45,
        speedMul: 1.1,
        interval: [3.1, 2.0],
        native: [],
        compatible: ['flares', 'asteroids', 'comets', 'debris', 'waves'],
        mechanics: { wind: { base: wr ? 3.5 : 2.5, gust: wr ? 7.5 : 6, period: 9 } },
        accent: '#7ffcff',
        ripple: '#3d6bff',
        nebula: ['#143a6a', '#2a1d6b', 0.42],
        tagline: 'STARLIGHT ITSELF PUSHES YOU OUT. FIGHT THE GUSTS.',
        description: 'A massive, intensely luminous star. Its radiation pressure and stellar wind push outward on anything in orbit, in surges.',
        names: ['{N} GALE', 'BLUE FURY', '{N} RADIANCE'],
      };
    },
  },

  {
    id: 'red_giant',
    label: 'RED GIANT',
    family: 'stellar',
    depth: 1.5,
    minLevel: 5,
    weight: 0.9,
    rarity: 'common',
    hosts: hosts('red_giant'),
    variantClass: 'Red giant',
    build: ({ object: o }) => {
      const teff = Math.min(5200, starTemperature(o, 3800));
      const sg = o ? o.classification.toLowerCase().includes('supergiant') : false;
      return {
        ...STAR_DEFAULTS,
        body: { kind: 'star', label: sg ? 'RED SUPERGIANT' : 'RED GIANT', radius: sg ? 44 : 40, mu: 2.4e6, heatRadius: sg ? 68 : 64, heatDps: 16, spin: 0.035, look: starLook(teff), deathText: 'INCINERATED BY THE RED GIANT', orbit: null },
        safeMin: sg ? 94 : 90,
        safeMax: 176,
        startAt: 0.58,
        hazardGravity: 0.42,
        speedMul: 1.05,
        interval: [3.0, 1.9],
        native: ['flares'],
        compatible: ['asteroids', 'comets', 'waves', 'storm', 'debris', 'moon'],
        // A giant's atmosphere has no sharp edge: its thin outer envelope reaches into low orbits and drags on them.
        mechanics: {
          dragZones: [{ rMin: sg ? 68 : 64, rMax: (sg ? 94 : 90) + 20, k: 0.024, moteBias: 1, label: 'EXTENDED ENVELOPE', style: 'haze', color: '#c0402a' }],
        },
        accent: '#ff8a3d',
        ripple: '#ff4d5e',
        nebula: ['#5a1424', '#6a2a10', 0.4],
        tagline: 'A BLOATED STAR WITH NO CLEAR EDGE. ITS OUTER ENVELOPE DRAGS LOW ORBITS DOWN.',
        description: 'An ageing star swollen to enormous size. Its cool, turbulent surface lashes out in long flares and its thin outer envelope reaches far into space.',
        names: ['{N} DUSK', 'DYING LIGHT', '{N} EMBERS'],
      };
    },
  },

  {
    id: 'white_dwarf',
    label: 'WHITE DWARF',
    family: 'stellar',
    depth: 2,
    minLevel: 8,
    weight: 0.7,
    rarity: 'uncommon',
    hosts: hosts('white_dwarf'),
    variantClass: 'White dwarf',
    build: ({ object: o }) => {
      const teff = Math.max(8000, starTemperature(o, 13000));
      const safeMin = 62;
      const safeMax = 170;
      const w = safeMax - safeMin;
      const belt = (at: number, count: number, kind: 'asteroid' | 'debris') => ({ radius: safeMin + at * w, spread: 5, count, dir: 1 as const, ecc: 0, inclination: 0, node: 0, kind });
      return {
        ...STAR_DEFAULTS,
        body: { kind: 'star', label: 'WHITE DWARF', radius: 6, mu: 2.6e6, heatRadius: 24, heatDps: 12, spin: 0.3, look: starLook(teff, { glowScale: 5, glowIntensity: 0.9 }), deathText: 'CRUSHED BY THE DEAD STAR', orbit: null },
        safeMin,
        safeMax,
        startAt: 0.7,
        hazardGravity: 0.5,
        speedMul: 1.2,
        interval: [3.3, 2.1],
        native: ['belt'],
        compatible: ['asteroids', 'comets', 'waves', 'debris', 'moon'],
        // Three debris lanes: the remains of planets torn apart by the dead star.
        mechanics: { belts: [belt(0.1, 7, 'debris'), belt(0.5, 8, 'asteroid'), belt(0.92, 9, 'asteroid')] },
        accent: '#bff9ff',
        ripple: '#3d6bff',
        nebula: ['#1d2a6b', '#143a5a', 0.3],
        tagline: 'A DEAD STAR RINGED BY WRECKAGE. THREAD THE DEBRIS LANES.',
        description: 'The dense, cooling core of a star that has finished burning. Lanes of rubble - shredded planets - circle it.',
        names: ['DEAD STAR', '{N} ASHES', 'DEGENERATE'],
      };
    },
  },

  {
    id: 'neutron_star',
    label: 'NEUTRON STAR',
    family: 'stellar',
    depth: 2.2,
    minLevel: 10,
    weight: 0.5,
    rarity: 'rare',
    hosts: hosts('neutron_star'),
    variantClass: 'Neutron star',
    build: () => ({
      ...STAR_DEFAULTS,
      body: {
        kind: 'neutron',
        label: 'NEUTRON STAR',
        radius: 6,
        mu: 3.0e6,
        heatRadius: 32,
        heatDps: 12,
        spin: 0.6,
        look: { surface: 'plasma', ramp: ['#1a7f8f', '#3ef2ff', '#bff9ff', '#ffffff'], rim: null, glow: '#3ef2ff', glowScale: 9, glowIntensity: 0.9, ring: null, lumpiness: 0 },
        deathText: 'CRUSHED BY THE NEUTRON STAR',
        orbit: null,
      },
      safeMin: 70,
      safeMax: 172,
      startAt: 0.47,
      hazardGravity: 0.5,
      speedMul: 1.28,
      interval: [3.0, 1.9],
      native: [],
      compatible: ['asteroids', 'comets', 'debris', 'moon', 'fog', 'belt', 'waves'],
      mechanics: { emp: { interval: [9, 13], duration: 1.7, telegraph: 1.5 } },
      accent: '#7ffcff',
      ripple: '#3ef2ff',
      nebula: ['#0f4a5a', '#1b2a6a', 0.38],
      tagline: 'MAGNETIC BURSTS KILL YOUR THRUSTERS. BE STABLE BEFORE THEY HIT.',
      description: 'A city-sized stellar corpse with an immense magnetic field. Its bursts overload ship systems for a moment at a time.',
      names: ['IRON STAR', '{N} STARQUAKE', 'DEAD CALM'],
    }),
  },

  {
    id: 'pulsar',
    label: 'PULSAR',
    family: 'stellar',
    depth: 2.2,
    minLevel: 9,
    weight: 0.7,
    rarity: 'uncommon',
    hosts: hosts('pulsar'),
    variantClass: 'Pulsar',
    build: ({ rng }) => ({
      ...STAR_DEFAULTS,
      body: {
        kind: 'neutron',
        label: 'PULSAR',
        radius: 7,
        mu: 3.0e6,
        heatRadius: 34,
        heatDps: 12,
        spin: 0.6,
        look: { surface: 'plasma', ramp: ['#1a7f8f', '#3ef2ff', '#bff9ff', '#ffffff'], rim: null, glow: '#3ef2ff', glowScale: 9, glowIntensity: 0.9, ring: null, lumpiness: 0 },
        deathText: 'CRUSHED BY THE PULSAR',
        orbit: null,
      },
      safeMin: 70,
      safeMax: 172,
      startAt: 0.47,
      hazardGravity: 0.5,
      speedMul: 1.28,
      interval: [3.0, 1.9],
      native: ['beams'],
      compatible: ['asteroids', 'comets', 'waves', 'debris', 'moon', 'fog'],
      mechanics: { beam: { count: 2, angularSpeed: 0.36 * rng.sign(), off: 2.9, charge: 0.9, on: 0.8, halfWidth: 4, jet: false } },
      accent: '#7ffcff',
      ripple: '#3ef2ff',
      nebula: ['#0f4a5a', '#1b2a6a', 0.38],
      tagline: 'DENSE CORE. PULSAR BEAMS SWEEP THE SECTOR.',
      description: 'A spinning neutron star whose radiation beams sweep space like a lighthouse.',
      names: ['PULSAR {D}', 'LIGHTHOUSE', '{N} BEACON'],
    }),
  },

  {
    id: 'binary',
    label: 'BINARY STAR',
    family: 'stellar',
    depth: 1.4,
    minLevel: 7,
    weight: 0.8,
    rarity: 'uncommon',
    hosts: hosts('binary'),
    variantClass: 'Binary star',
    build: ({ object: o, rng }) => {
      const sep = rng.range(44, 52);
      const core = binaryCore(o, sep, 2.4e6, rng.range(0.5, 0.9), 17, rng.range(0, TAU));
      const safeMin = Math.max(92, core.innerReach + 36);
      const teff = starTemperature(o, 6000);
      return {
        ...STAR_DEFAULTS,
        body: core.body,
        companions: [core.companion],
        safeMin,
        safeMax: 182,
        startAt: 0.5,
        hazardGravity: 0.42,
        speedMul: 1.05,
        interval: [3.1, 2.0],
        native: ['flares'],
        compatible: ['asteroids', 'comets', 'waves', 'debris', 'belt'],
        mechanics: {},
        ...accentFor(teff),
        nebula: tints(teff),
        tagline: 'TWO STARS, ONE ORBIT. THE PULL NEVER SITS STILL.',
        description: 'Two stars circling a shared centre of mass. An orbit around both feels a pull that shifts with every turn of the pair.',
        names: ['{N} TWINS', 'TWO SUNS', '{N} BARYCENTRE'],
      };
    },
  },

  {
    id: 'multiple_star',
    label: 'MULTIPLE STAR SYSTEM',
    family: 'stellar',
    depth: 1.7,
    minLevel: 11,
    weight: 0.45,
    rarity: 'rare',
    hosts: hosts('multiple_star'),
    variantClass: 'Triple star system',
    build: ({ object: o, rng }) => {
      const core = binaryCore(o, rng.range(36, 42), 2.4e6, rng.range(0.6, 0.9), 15, rng.range(0, TAU));
      const safeMin = Math.max(88, core.innerReach + 36);
      const safeMax = 180;
      const temps = componentTemperatures(o, 6000);
      // The third star patrols just outside the band; its heat bubble sweeps the outer lanes.
      const third = starCompanion(safeMax + 36, 12, 0.12e6, 44, temps[2], 42 * rng.sign(), rng.range(0, TAU));
      const teff = starTemperature(o, 6000);
      return {
        ...STAR_DEFAULTS,
        body: { ...core.body, label: 'TRIPLE STAR' },
        companions: [core.companion, third],
        safeMin,
        safeMax,
        startAt: 0.4,
        hazardGravity: 0.42,
        speedMul: 1.05,
        interval: [3.2, 2.1],
        native: [],
        compatible: ['flares', 'asteroids', 'comets', 'waves', 'debris'],
        mechanics: {},
        ...accentFor(teff),
        nebula: tints(teff),
        tagline: 'A CLOSE PAIR AND A WANDERING THIRD. MIND THE OUTER LANES.',
        description: 'A hierarchical triple: a tight pair of stars with a third on a wide orbit. Its heat sweeps slowly around the outer band.',
        names: ['{N} TRINITY', 'THREE-BODY PROBLEM', '{N} HIERARCHY'],
      };
    },
  },

  {
    id: 'variable_star',
    label: 'VARIABLE STAR',
    family: 'stellar',
    depth: 1.8,
    minLevel: 8,
    weight: 0.7,
    rarity: 'uncommon',
    hosts: hosts('variable_star'),
    variantClass: 'Pulsating variable star',
    build: ({ object: o, rng }) => {
      const teff = starTemperature(o, 5800);
      const cls = o?.classification ?? 'Pulsating variable';
      const mira = cls.toLowerCase().includes('mira') || cls.toLowerCase().includes('long-period');
      const safeMin = 80;
      const safeMax = 176;
      const amp = mira ? 0.42 : 0.34;
      // At maximum the heat zone reaches a third of the way into the band.
      const heatMax = safeMin + 0.32 * (safeMax - safeMin);
      return {
        ...STAR_DEFAULTS,
        body: { kind: 'star', label: cls.toUpperCase().replace(' VARIABLE', '') + ' VARIABLE', radius: mira ? 38 : 32, mu: 2.3e6, heatRadius: heatMax / (1 + amp), heatDps: 15, spin: 0.04, look: starLook(teff), deathText: 'INCINERATED BY THE VARIABLE STAR', orbit: null },
        safeMin,
        safeMax,
        startAt: 0.64,
        hazardGravity: 0.42,
        speedMul: 1.05,
        interval: [3.1, 2.0],
        native: [],
        compatible: ['flares', 'asteroids', 'comets', 'waves', 'debris', 'moon'],
        mechanics: { pulsation: { period: mira ? rng.range(11, 14) : rng.range(7, 10), amp } },
        ...accentFor(teff),
        nebula: tints(teff),
        tagline: 'THE STAR BREATHES. ITS HEAT RISES INTO YOUR ORBIT AND FALLS AWAY.',
        description: 'A star that physically swells and shrinks on a regular cycle, brightening and dimming as it does.',
        names: ['{N} PULSE', 'HEARTBEAT STAR', '{N} MAXIMUM'],
      };
    },
  },
];
