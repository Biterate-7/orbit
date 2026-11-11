/**
 * Planetary environments. Each one has a signature mechanic that changes how the orbit is flown:
 *
 *   rocky           baseline - a belt of co-orbiting rock
 *   gas giant       moons on rails carve the band into lanes
 *   ringed          a ring you can dive into for energy, at the cost of orbital speed
 *   ice             a rotating cryo-plume that kicks the ship outward and carries crystals
 *   lava            eruptions lob ballistic ejecta up from the surface
 *   ocean           a heavy moon raises tides in the ship's orbit
 *   desert          dust storms and a thin, dragging upper atmosphere
 *   tidally locked  a permanently scorched sector on the day side
 *   super-Earth     a deep gravity well, fast orbits, dense atmosphere
 *   rogue           no star at all: darkness, with radar pings to see by
 */
import type { AstroObject } from '../../astronomy/database/schema';
import { shade } from '../../astronomy/database/visuals';
import type { CompanionSpec } from '../../game/types';
import { classHas, hostColors, look, moon, objectColors, railPeriod, scaleLog, spinFrom } from './common';
import type { EnvContext, EnvironmentDef } from './common';
import { primaryEnvironment } from './classify';

const hosts = (id: EnvironmentDef['id']) => (o: AstroObject) => primaryEnvironment(o) === id;

/** Direction of the host star in every planetary level (matches the renderer's light direction). */
export const SUNWARD = Math.atan2(-0.5, -0.55);

const PLANET_COMPAT = ['asteroids', 'comets', 'waves', 'storm', 'debris', 'moon', 'fog'] as const;

/** Real phase of a catalogued moon around its parent, from its Horizons state vector. */
function ephemerisPhase(o: AstroObject, fallback: number): number {
  const e = o.context.ephemeris;
  return e ? Math.atan2(e.position[1], e.position[0]) : fallback;
}

/** Up to `max` real moons of the host, biggest first, returned nearest-first. */
function realMoons(ctx: EnvContext, max: number): AstroObject[] {
  if (!ctx.object) return [];
  const all = ctx.catalogue.moonsOf(ctx.object.id);
  const biggest = [...all].sort((a, b) => (b.physicalProperties.radius ?? 0) - (a.physicalProperties.radius ?? 0)).slice(0, max);
  return all.filter((m) => biggest.includes(m));
}

export const PLANETARY: EnvironmentDef[] = [
  {
    id: 'rocky',
    label: 'ROCKY WORLD',
    family: 'planetary',
    depth: 0,
    minLevel: 1,
    weight: 1,
    rarity: 'common',
    hosts: hosts('rocky'),
    variantClass: 'Rocky planet',
    build: ({ object: o, rng }) => {
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 8, 7000, 16, 22);
      const mu = scaleLog(p?.mass ?? null, 1e16, 1e25, 1.05e6, 1.4e6);
      const safeMin = radius + 36;
      const safeMax = 168;
      const airless = o ? o.category === 'moon' || o.name === 'Mercury' : rng.chance(0.4);
      // Bodies too small to pull themselves round (Phobos, Deimos) keep an irregular outline.
      const tiny = p?.radius !== null && p?.radius !== undefined && p.radius < 150;
      const colors = objectColors(o, ['#8fb3e0', '#3a4c8c', '#15143a']);
      return {
        body: {
          kind: tiny ? 'smallbody' : 'planet',
          label: tiny ? 'SMALL MOON' : 'ROCKY WORLD',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: spinFrom(p?.rotationPeriod ?? null, tiny ? 0.4 : 0.08),
          look: tiny
            ? look('lumpy', colors, { glow: '#3d6bff', glowScale: 2.4, glowIntensity: 0.3, lumpiness: 0.3 })
            : look('rock', colors, { rim: airless ? null : '#3ef2ff', glow: '#3d6bff', glowIntensity: 0.55 }),
          deathText: 'CRASHED INTO THE SURFACE',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.46,
        hazardGravity: 0.3,
        speedMul: 1,
        interval: [2.5, 1.45],
        native: ['belt'],
        compatible: [...PLANET_COMPAT],
        mechanics: { belts: [{ radius: safeMax - 15, spread: 9, count: 8, dir: 1, ecc: 0, inclination: 0, node: 0, kind: 'asteroid' }] },
        companions: [],
        accent: '#3ef2ff',
        ripple: '#3d6bff',
        nebula: ['#1d2a6b', '#0f3a5a', 0.35],
        starDensity: 1,
        hostStarColors: hostColors(o, 5772),
        galaxies: 0,
        band: false,
        fogColor: '#0d0820',
        tagline: 'DRIFTING ROCK. LEARN YOUR ORBIT.',
        description: 'A solid, cratered world with a loose belt of co-orbiting rock.',
        names: ['{N} DRIFT', 'LOW {N} ORBIT', '{N} TRANSIT', 'QUIET ROCK'],
      };
    },
  },

  {
    id: 'gas_giant',
    label: 'GAS GIANT',
    family: 'planetary',
    depth: 0.3,
    minLevel: 3,
    weight: 1,
    rarity: 'common',
    hosts: hosts('gas_giant'),
    variantClass: 'Gas giant',
    build: (ctx) => {
      const { object: o, rng } = ctx;
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 20000, 95000, 25, 31);
      const mu = scaleLog(p?.mass ?? null, 5e25, 5e27, 1.8e6, 2.2e6);
      const hot = (p?.temperature ?? 0) > 1000 || (o ? classHas(o, 'hot jupiter') : false);
      const ice = o ? classHas(o, 'ice giant', 'neptune') : rng.chance(0.3);
      const safeMin = 70;
      const safeMax = 176;
      const w = safeMax - safeMin;
      // Moons sit on fixed lanes; the ship starts in the clear lane between the two band moons.
      const lanes = [radius + 22, safeMin + 0.18 * w, safeMin + 0.8 * w, safeMax + 22];
      const real = realMoons(ctx, 4);
      const count = real.length > 0 ? real.length : rng.int(2, 3);
      const slots = count >= 4 ? [0, 1, 2, 3] : count === 3 ? [1, 2, 3] : count === 2 ? [1, 3] : [3];
      const companions: CompanionSpec[] = slots.map((slot, i) => {
        const m = real[i];
        // Moons that share the band with the ship are kept light: a tug each pass, never a capture.
        const inBand = slot === 1 || slot === 2;
        return moon(
          lanes[slot],
          scaleLog(m?.physicalProperties.radius ?? null, 150, 2700, 4.5, 8),
          mu * scaleLog(m?.physicalProperties.mass ?? null, 1e19, 2e23, inBand ? 0.0016 : 0.008, inBand ? 0.0032 : 0.016),
          mu,
          m ? ephemerisPhase(m, rng.range(0, Math.PI * 2)) : rng.range(0, Math.PI * 2),
          m ? m.name.toUpperCase() : null,
        );
      });
      const colors = hot ? ['#ff9a5c', '#8c2f2a', '#2a0d14'] : ice ? ['#8fd0f0', '#3f73b8', '#162a55'] : objectColors(o, ['#e0b98a', '#9c6b4a', '#3d2a26']);
      return {
        body: {
          kind: 'gasgiant',
          label: hot ? 'HOT JUPITER' : ice ? 'ICE GIANT' : 'GAS GIANT',
          radius,
          mu,
          heatRadius: hot ? radius + 20 : 0,
          heatDps: hot ? 12 : 0,
          spin: spinFrom(p?.rotationPeriod ?? null, 0.16),
          look: look('bands', colors, { rim: shade(colors[0], 1.2), glow: colors[1], glowScale: 2.2, glowIntensity: 0.5 }),
          deathText: 'SWALLOWED BY THE GAS GIANT',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.49,
        hazardGravity: 0.38,
        speedMul: 1.05,
        interval: [3.0, 1.9],
        native: ['moon'],
        compatible: ['asteroids', 'comets', 'waves', 'debris', 'storm'],
        mechanics: hot
          ? { dragZones: [{ rMin: radius + 10, rMax: safeMin + 14, k: 0.03, moteBias: 1, label: 'UPPER ATMOSPHERE', style: 'haze', color: '#ff8a3d' }] }
          : {},
        companions,
        accent: hot ? '#ff8a3d' : '#b77dff',
        ripple: hot ? '#ff4d5e' : '#9b5cff',
        nebula: [shade(colors[1], 0.5), shade(colors[2], 1.2), 0.4],
        starDensity: 1,
        hostStarColors: hostColors(o, 5772),
        galaxies: 0,
        band: false,
        fogColor: '#0d0820',
        tagline: `${count} MOON${count > 1 ? 'S' : ''} ON THE MOVE. PICK A LANE AND HOLD IT.`,
        description: hot
          ? 'A giant planet roasting close to its star. Its swollen upper atmosphere drags at low orbits.'
          : 'A giant planet whose moons sweep fixed lanes through the orbital band.',
        names: real.length > 0 ? [`${real[real.length - 1].name.toUpperCase()}'S SHADOW`, '{N} DEEP', "GIANT'S WAKE"] : ['{N} DEEP', "GIANT'S WAKE", '{N} MOONS'],
      };
    },
  },

  {
    id: 'ringed',
    label: 'RINGED PLANET',
    family: 'planetary',
    depth: 0.3,
    minLevel: 4,
    weight: 0.7,
    rarity: 'uncommon',
    hosts: hosts('ringed'),
    variantClass: 'Ringed giant planet',
    build: (ctx) => {
      const { object: o, rng } = ctx;
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 20000, 95000, 24, 28);
      const mu = scaleLog(p?.mass ?? null, 5e25, 5e27, 1.75e6, 2.05e6);
      const safeMin = 70;
      const safeMax = 174;
      const ringOuter = safeMin + 0.36 * (safeMax - safeMin);
      const ice = o ? classHas(o, 'ice giant') : rng.chance(0.4);
      const colors = ice ? ['#a8e0e8', '#4f93b8', '#1c3550'] : objectColors(o, ['#e8d2a0', '#a8845a', '#3d2e26']);
      const ringRamp = [shade(colors[2], 1.1), shade(colors[1], 0.9), colors[1], shade(colors[0], 1.1)];
      const big = realMoons(ctx, 1)[0];
      return {
        body: {
          kind: 'gasgiant',
          label: 'RINGED PLANET',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: spinFrom(p?.rotationPeriod ?? null, 0.16),
          look: look('bands', colors, { rim: shade(colors[0], 1.2), glow: colors[1], glowIntensity: 0.45, ring: { inner: radius + 12, outer: ringOuter, ramp: ringRamp, gap: true } }),
          deathText: 'SWALLOWED BY THE GAS GIANT',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.64,
        hazardGravity: 0.36,
        speedMul: 1.05,
        interval: [3.0, 1.9],
        native: ['moon'],
        compatible: ['asteroids', 'comets', 'waves', 'debris', 'storm'],
        mechanics: { dragZones: [{ rMin: radius + 12, rMax: ringOuter, k: 0.02, moteBias: 3.2, label: 'RING PLANE', style: 'ring', color: colors[1] }] },
        companions: [moon(safeMax + 22, 7, mu * 0.02, mu, big ? ephemerisPhase(big, 0) : rng.range(0, Math.PI * 2), big ? big.name.toUpperCase() : null)],
        accent: '#ffc94d',
        ripple: '#9b5cff',
        nebula: [shade(colors[1], 0.45), '#1d2a6b', 0.4],
        starDensity: 1,
        hostStarColors: hostColors(o, 5772),
        galaxies: 0,
        band: false,
        fogColor: '#0d0820',
        tagline: 'THE RINGS ARE RICH IN ENERGY. THEY WILL ALSO GRIND YOU DOWN.',
        description: 'A giant planet circled by a broad ring of ice and dust. Flying inside the ring plane bleeds orbital speed.',
        names: ['RINGS OF {N}', '{N} RING PLANE', 'THE DIVISION'],
      };
    },
  },

  {
    id: 'ice',
    label: 'ICE WORLD',
    family: 'planetary',
    depth: 0.4,
    minLevel: 2,
    weight: 0.9,
    rarity: 'common',
    hosts: hosts('ice'),
    variantClass: 'Ice world',
    build: (ctx) => {
      const { object: o, rng } = ctx;
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 100, 6400, 13, 19);
      const mu = scaleLog(p?.mass ?? null, 1e19, 6e24, 0.85e6, 1.2e6);
      const safeMin = radius + 34;
      const safeMax = 162;
      const w = safeMax - safeMin;
      const spin = 0.2 * (rng.chance(0.5) ? 1 : -1);
      const partner = realMoons(ctx, 1)[0];
      return {
        body: {
          kind: 'planet',
          label: 'ICE WORLD',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: Math.abs(spin),
          look: look('ice', objectColors(o, ['#e6f4ff', '#8fb8d8', '#2f4a66']), { rim: '#bff9ff', glow: '#7fd6ff', glowIntensity: 0.5 }),
          deathText: 'SHATTERED ON THE ICE',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.5,
        hazardGravity: 0.28,
        speedMul: 0.95,
        interval: [2.8, 1.7],
        native: [],
        compatible: ['asteroids', 'comets', 'debris', 'moon', 'waves', 'belt'],
        mechanics: { plume: { halfWidth: 0.2, angularSpeed: spin, reach: safeMin + 0.8 * w, kick: 15 } },
        companions: partner ? [moon(safeMax + 24, 7, mu * 0.05, mu, ephemerisPhase(partner, 0), partner.name.toUpperCase())] : [],
        accent: '#7ffcff',
        ripple: '#3ef2ff',
        nebula: ['#143a5a', '#1d2a6b', 0.32],
        starDensity: 1.1,
        hostStarColors: hostColors(o, 5772),
        galaxies: 0,
        band: false,
        fogColor: '#0d0820',
        tagline: 'A CRYO-PLUME SWEEPS THE SKY. RIDE IT OR AVOID IT.',
        description: 'A frozen world venting a plume of ice crystals into space. The plume shoves ships outward but is full of energy.',
        names: ['{N} PLUME', '{N} FROST', 'COLD HARBOUR', 'CRYO VENT'],
      };
    },
  },

  {
    id: 'lava',
    label: 'LAVA WORLD',
    family: 'planetary',
    depth: 0.6,
    minLevel: 4,
    weight: 0.7,
    rarity: 'uncommon',
    hosts: hosts('lava'),
    variantClass: 'Lava world',
    build: ({ object: o }) => {
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 1500, 13000, 17, 22);
      const mu = scaleLog(p?.mass ?? null, 5e22, 6e25, 1.15e6, 1.5e6);
      const safeMin = radius + 38;
      const safeMax = 166;
      const w = safeMax - safeMin;
      return {
        body: {
          kind: 'planet',
          label: 'LAVA WORLD',
          radius,
          mu,
          heatRadius: radius + 15,
          heatDps: 12,
          spin: spinFrom(p?.rotationPeriod ?? null, 0.1),
          look: look('lava', ['#ffb347', '#d8361e', '#2a0a0c'], { rim: '#ff8a3d', glow: '#ff4d5e', glowIntensity: 0.8 }),
          deathText: 'MELTED INTO THE MAGMA',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.55,
        hazardGravity: 0.34,
        speedMul: 1,
        interval: [3.2, 2.0],
        native: [],
        compatible: ['asteroids', 'comets', 'waves', 'debris', 'moon', 'belt'],
        mechanics: { eruptions: { interval: [5.5, 8.5], count: [2, 4], reach: [safeMin + 0.2 * w, safeMin + 0.9 * w] } },
        companions: [],
        accent: '#ff8a3d',
        ripple: '#ff4d5e',
        nebula: ['#5a1424', '#6a2a10', 0.4],
        starDensity: 0.9,
        hostStarColors: hostColors(o, 5200),
        galaxies: 0,
        band: false,
        fogColor: '#1a0808',
        tagline: 'ERUPTIONS THROW MOLTEN ROCK INTO ORBIT. WATCH THE SURFACE.',
        description: 'A world with a molten surface. Eruptions hurl ballistic ejecta up through the orbital band before it falls back.',
        names: ['{N} BURNING', 'MAGMA TIDE', '{N} FORGE'],
      };
    },
  },

  {
    id: 'ocean',
    label: 'OCEAN WORLD',
    family: 'planetary',
    depth: 0.6,
    minLevel: 3,
    weight: 0.6,
    rarity: 'uncommon',
    hosts: hosts('ocean'),
    variantClass: 'Ocean world',
    build: (ctx) => {
      const { object: o, rng } = ctx;
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 3000, 13000, 18, 22);
      const mu = scaleLog(p?.mass ?? null, 1e24, 6e25, 1.2e6, 1.45e6);
      const safeMin = radius + 38;
      const safeMax = 164;
      const real = realMoons(ctx, 1)[0];
      return {
        body: {
          kind: 'planet',
          label: o && o.name !== 'Earth' ? 'TEMPERATE WORLD' : 'OCEAN WORLD',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: spinFrom(p?.rotationPeriod ?? null, 0.12),
          look: look('ocean', ['#bfe8ff', '#2f7ac8', '#0c1f4a'], { rim: '#7ffcff', glow: '#3d6bff', glowIntensity: 0.6 }),
          deathText: 'LOST BENEATH THE CLOUDS',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.42,
        hazardGravity: 0.3,
        speedMul: 0.95,
        interval: [3.4, 2.2],
        native: ['moon'],
        compatible: ['asteroids', 'comets', 'waves', 'storm', 'debris', 'fog'],
        mechanics: {},
        // One heavy moon just outside the band: every pass pumps the ship's orbit (tides, exaggerated).
        companions: [moon(safeMax + 30, 8, mu * 0.065, mu, real ? ephemerisPhase(real, 0) : rng.range(0, Math.PI * 2), real ? real.name.toUpperCase() : null)],
        accent: '#3ef2ff',
        ripple: '#3d6bff',
        nebula: ['#143a6a', '#0f4a5a', 0.36],
        starDensity: 1,
        hostStarColors: hostColors(o, 5772),
        galaxies: 0,
        band: false,
        fogColor: '#081220',
        tagline: 'A HEAVY MOON PULLS AT EVERY ORBIT. EXPECT TIDES.',
        description:
          o && o.name !== 'Earth'
            ? 'A temperate rocky world, modelled here as an ocean planet (its surface is not confirmed). A massive moon tugs at every pass.'
            : 'A water world with a single massive moon whose pull reshapes nearby orbits.',
        names: ['{N} TIDEWATER', '{N} HIGH TIDE', 'BLUE HARBOUR'],
      };
    },
  },

  {
    id: 'desert',
    label: 'DESERT WORLD',
    family: 'planetary',
    depth: 0.4,
    minLevel: 2,
    weight: 0.8,
    rarity: 'common',
    hosts: hosts('desert'),
    variantClass: 'Desert planet',
    build: ({ object: o }) => {
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 2500, 13000, 17, 21);
      const mu = scaleLog(p?.mass ?? null, 3e23, 6e25, 1.1e6, 1.4e6);
      const safeMin = radius + 37;
      const safeMax = 166;
      const colors = o?.name === 'Venus' ? ['#f0d8a0', '#b88a4a', '#3d2a16'] : ['#e0a868', '#a85a30', '#3a1c14'];
      return {
        body: {
          kind: 'planet',
          label: 'DESERT WORLD',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: spinFrom(p?.rotationPeriod ?? null, 0.09),
          look: look('rock', colors, { rim: '#ffc94d', glow: '#ff8a3d', glowIntensity: 0.45 }),
          deathText: 'BURIED IN THE DUST',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.5,
        hazardGravity: 0.3,
        speedMul: 1,
        interval: [2.9, 1.75],
        native: ['storm'],
        compatible: ['asteroids', 'comets', 'waves', 'debris', 'moon', 'belt'],
        mechanics: { dragZones: [{ rMin: radius + 8, rMax: safeMin + 12, k: 0.03, moteBias: 1, label: 'THIN ATMOSPHERE', style: 'haze', color: '#c88a4a' }] },
        companions: [],
        accent: '#ffc94d',
        ripple: '#ff8a3d',
        nebula: ['#5a3414', '#3a1c2a', 0.34],
        starDensity: 1,
        hostStarColors: hostColors(o, 5772),
        galaxies: 0,
        band: false,
        fogColor: '#1a1008',
        tagline: 'DUST STORMS SHOVE YOU OFF COURSE. LOW ORBITS DRAG.',
        description: 'A dry world wrapped in a thin, dusty atmosphere. Storm fronts push ships off course and low passes bleed speed.',
        names: ['{N} DUST', 'RED WIND', '{N} SIROCCO'],
      };
    },
  },

  {
    id: 'tidally_locked',
    label: 'TIDALLY LOCKED WORLD',
    family: 'planetary',
    depth: 1,
    minLevel: 5,
    weight: 0.8,
    rarity: 'common',
    hosts: hosts('tidally_locked'),
    variantClass: 'Tidally locked planet',
    build: ({ object: o }) => {
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 3000, 13000, 17, 21);
      const mu = scaleLog(p?.mass ?? null, 1e24, 6e25, 1.15e6, 1.45e6);
      const safeMin = radius + 37;
      const safeMax = 168;
      const w = safeMax - safeMin;
      return {
        body: {
          kind: 'planet',
          label: 'TIDALLY LOCKED WORLD',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: 0,
          look: look('locked', ['#ffb347', '#8a3a2a', '#101828'], { rim: '#ff8a3d', glow: '#ff8a3d', glowIntensity: 0.5 }),
          deathText: 'CRASHED ON THE TERMINATOR',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.76,
        hazardGravity: 0.32,
        speedMul: 1,
        interval: [2.8, 1.7],
        native: [],
        compatible: ['asteroids', 'comets', 'debris', 'moon', 'belt', 'waves'],
        mechanics: { scorch: { angle: SUNWARD, halfWidth: 0.72, reach: safeMin + 0.56 * w, dps: 13 } },
        companions: [],
        accent: '#ff8a3d',
        ripple: '#ff4d5e',
        nebula: ['#5a2414', '#141c4a', 0.36],
        starDensity: 0.9,
        hostStarColors: hostColors(o, 3400),
        galaxies: 0,
        band: false,
        fogColor: '#140a08',
        tagline: 'ONE SIDE ALWAYS FACES THE STAR. STAY HIGH OVER THE DAY SIDE.',
        description: 'A close-in world that likely keeps one face to its star. The space above the day side is permanently irradiated.',
        names: ['{N} TERMINATOR', 'ETERNAL NOON', '{N} DAYSIDE'],
      };
    },
  },

  {
    id: 'super_earth',
    label: 'SUPER-EARTH',
    family: 'planetary',
    depth: 1,
    minLevel: 5,
    weight: 0.8,
    rarity: 'common',
    hosts: hosts('super_earth'),
    variantClass: 'Super-Earth',
    build: ({ object: o }) => {
      const p = o?.physicalProperties;
      const radius = scaleLog(p?.radius ?? null, 8000, 22000, 22, 26);
      const mu = scaleLog(p?.mass ?? null, 1e25, 1.2e26, 2.3e6, 2.8e6);
      const safeMin = radius + 42;
      const safeMax = 170;
      return {
        body: {
          kind: 'planet',
          label: 'SUPER-EARTH',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: spinFrom(p?.rotationPeriod ?? null, 0.07),
          look: look('rock', objectColors(o, ['#9fd8c8', '#3f8a8a', '#12303a']), { rim: '#5dffa0', glow: '#3ef2ff', glowIntensity: 0.6 }),
          deathText: 'CRUSHED BY THE GRAVITY WELL',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.52,
        hazardGravity: 0.62,
        speedMul: 1.15,
        interval: [2.7, 1.6],
        native: ['belt'],
        compatible: ['asteroids', 'comets', 'waves', 'debris', 'moon', 'storm'],
        mechanics: {
          belts: [{ radius: safeMax - 13, spread: 8, count: 10, dir: 1, ecc: 0, inclination: 0, node: 0, kind: 'asteroid' }],
          dragZones: [{ rMin: radius + 8, rMax: safeMin + 16, k: 0.035, moteBias: 1, label: 'DENSE ATMOSPHERE', style: 'haze', color: '#3f8a8a' }],
        },
        companions: [],
        accent: '#5dffa0',
        ripple: '#3ef2ff',
        nebula: ['#143a4a', '#1d2a6b', 0.36],
        starDensity: 1,
        hostStarColors: hostColors(o, 4800),
        galaxies: 0,
        band: false,
        fogColor: '#081a1a',
        tagline: 'DEEP GRAVITY WELL. EVERYTHING MOVES FASTER HERE.',
        description: 'A planet several times the mass of Earth. Orbits are fast, incoming rock bends hard toward it and its atmosphere reaches high.',
        names: ['{N} HEAVY', 'DEEP WELL', '{N} DESCENT'],
      };
    },
  },

  {
    id: 'rogue',
    label: 'STARLESS WORLD',
    family: 'planetary',
    depth: 1.6,
    minLevel: 9,
    weight: 0.45,
    rarity: 'rare',
    hosts: hosts('rogue'),
    variantClass: 'Rogue planet',
    build: ({ object: o }) => {
      // Catalogued hosts are free-floating brown dwarfs; the procedural stand-in is a rogue planet.
      const dwarf = o !== null;
      const radius = dwarf ? 26 : 20;
      const mu = dwarf ? 2.0e6 : 1.3e6;
      const safeMin = radius + 40;
      const safeMax = 168;
      return {
        body: {
          kind: dwarf ? 'gasgiant' : 'planet',
          label: dwarf ? 'BROWN DWARF' : 'ROGUE PLANET',
          radius,
          mu,
          heatRadius: 0,
          heatDps: 0,
          spin: 0.12,
          look: look(dwarf ? 'bands' : 'dark', dwarf ? ['#8a4a5a', '#4a2030', '#160a12'] : ['#4a5a78', '#1c2438', '#080a12'], { rim: null, glow: dwarf ? '#8a2a4a' : '#1c2a5a', glowScale: 1.8, glowIntensity: 0.35 }),
          deathText: 'LOST IN THE DARK',
          orbit: null,
        },
        safeMin,
        safeMax,
        startAt: 0.5,
        hazardGravity: 0.32,
        speedMul: 0.9,
        interval: [3.3, 2.1],
        native: [],
        compatible: ['asteroids', 'comets', 'debris', 'belt', 'moon'],
        mechanics: { dark: { radius: 84, pingPeriod: 4.2 } },
        companions: [],
        accent: '#9b5cff',
        ripple: '#4b2a8a',
        nebula: ['#141438', '#0a1a2a', 0.2],
        starDensity: 2.4,
        hostStarColors: [],
        galaxies: 0,
        band: false,
        fogColor: '#020308',
        tagline: 'NO STAR. NO LIGHT. NAVIGATE BY RADAR PING.',
        description: dwarf
          ? 'A free-floating brown dwarf: too small to shine like a star, drifting with no sun of its own. Nothing here is lit.'
          : 'A planet with no star, drifting through interstellar space in total darkness.',
        names: ['THE FORGOTTEN ORBIT', 'STARLESS', '{N} ADRIFT'],
      };
    },
  },
];

/** Used by orbital configurations that add a perturbing moon on an eccentric path. */
export function eccentricMoon(orbitRadius: number, primaryMu: number, ecc: number, phase: number, argPeri: number): CompanionSpec {
  return { ...moon(orbitRadius, 6, primaryMu * 0.012, primaryMu, phase, null, ecc, argPeri), period: railPeriod(primaryMu, orbitRadius) * 1.2 };
}
