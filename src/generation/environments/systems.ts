/**
 * Real star systems as playable environments.
 *
 * These three environments are hosted by a StarSystem record (src/astronomy/systems) instead of a
 * single catalogue object, and the record's data shapes the level:
 *
 *   - the host star's effective temperature colours it, its radius and mass size it;
 *   - the number of known planets is the number of worlds in the sector (up to a readable
 *     maximum), in their real order outward, spaced by their real semi-major axes on a log scale;
 *   - each planet's measured radius, mass, eccentricity and equilibrium temperature set its size,
 *     pull, path and look;
 *   - a second star appears only when the source lists one, and the planets ride outside the
 *     pair or beside one star exactly as the source's circumbinary flag says.
 *
 * Scale is compressed for play (see README, "Scientific simplifications"): order and proportion
 * are kept, ratios are not. Where a companion star's own properties are not catalogued it is drawn
 * with a cooler tint for rendering only - nothing about it is stored or shown as data.
 */
import { TAU } from '../../game/math';
import type { Rng } from '../../game/rng';
import type { BodyLook, CompanionSpec, ModifierKind } from '../../game/types';
import { blackbodyHex, shade } from '../../astronomy/database/visuals';
import { SOLAR_SYSTEM_ID } from '../../astronomy/systems/store';
import type { StarSystem, SystemPlanet } from '../../astronomy/systems/types';
import { clamp, lerp, look, scaleLog, starLook } from './common';
import type { EnvBlueprint, EnvContext, EnvironmentDef } from './common';

/** Most worlds a sector shows; larger systems are sampled evenly, innermost and outermost kept. */
export const MAX_WORLDS = 5;

const DEFAULTS = {
  starDensity: 1,
  hostStarColors: [] as string[],
  galaxies: 0,
  band: false,
  fogColor: '#0d0820',
};

function tints(teff: number): [string, string, number] {
  const c = blackbodyHex(teff);
  return [shade(c, 0.3), shade(blackbodyHex(teff * 0.6), 0.25), 0.38];
}

function accentFor(teff: number): { accent: string; ripple: string } {
  if (teff > 9000) return { accent: '#7ffcff', ripple: '#3d6bff' };
  if (teff > 5200) return { accent: '#ffc94d', ripple: '#ff8a3d' };
  return { accent: '#ff8a3d', ripple: '#ff4d5e' };
}

/** Temperature to draw the host with: the catalogued value, else a neutral Sun-like one (colour only). */
function hostTeff(sys: StarSystem): number {
  return sys.stars[0]?.teff ?? 5600;
}

/** How a planet is drawn - a gameplay interpretation of its measured radius and temperature. */
function planetLook(p: SystemPlanet): BodyLook {
  const r = p.radiusEarth;
  const t = p.eqTempK;
  if (r !== null && r >= 6) {
    return t !== null && t > 1000
      ? look('bands', ['#ffd0a0', '#c8553a', '#3a1420'], { rim: '#ffb080', glow: '#ff8a3d', glowIntensity: 0.4 })
      : look('bands', ['#f0dcb8', '#b98a5a', '#3c2a1e'], { rim: '#e8f0ff', glow: '#c9a070', glowIntensity: 0.3 });
  }
  if (r !== null && r >= 2.2) return look('bands', ['#bfe8ff', '#4f8fd8', '#162a5a'], { rim: '#d8f0ff', glow: '#5aa0ff', glowIntensity: 0.3 });
  if (t !== null && t > 900) return look('lava', ['#ffc94d', '#c0392b', '#1a0c10'], { rim: '#ff8a3d', glow: '#ff4d2e', glowIntensity: 0.45 });
  if (t !== null && t < 190) return look('ice', ['#eef8ff', '#8fc0e8', '#28406a'], { rim: '#d8f0ff' });
  if (t !== null && t >= 190 && t <= 330) return look('ocean', ['#d8f0e8', '#3d8fb8', '#102a48'], { rim: '#bfe8ff' });
  return look('rock', ['#d8c8b8', '#8a705e', '#2a1f1c']);
}

/** Up to `max` planets, innermost first, evenly sampled when the system has more. */
export function sampleWorlds(sys: StarSystem, max = MAX_WORLDS): SystemPlanet[] {
  const all = sys.planets;
  if (all.length <= max) return [...all];
  return Array.from({ length: max }, (_, i) => all[Math.round((i * (all.length - 1)) / (max - 1))]);
}

/**
 * Game radii for the sampled planets: positioned by log semi-major axis between rIn and rOut when
 * every axis is known (so a tight resonant chain looks tight), evenly by order otherwise, and then
 * pushed apart to a minimum spacing so no two lanes overlap.
 */
export function layoutRadii(planets: readonly SystemPlanet[], rIn: number, rOut: number, minGap = 28): number[] {
  const n = planets.length;
  if (n === 0) return [];
  if (n === 1) return [lerp(rIn, rOut, 0.35)];
  const axes = planets.map((p) => p.smaAu);
  const known = axes.every((a): a is number => a !== null && a > 0);
  const lo = known ? Math.log(Math.min(...(axes as number[]))) : 0;
  const hi = known ? Math.log(Math.max(...(axes as number[]))) : 1;
  const out = planets.map((_, i) => {
    const t = known && hi > lo ? (Math.log(axes[i] as number) - lo) / (hi - lo) : i / (n - 1);
    // Blend with even spacing so a single far-out planet cannot crush the rest together.
    return lerp(rIn, rOut, 0.6 * t + 0.4 * (i / (n - 1)));
  });
  for (let i = 1; i < n; i++) if (out[i] - out[i - 1] < minGap) out[i] = out[i - 1] + minGap;
  return out;
}

/**
 * The sampled worlds as companions on rails. With `inner` set, the innermost world is placed there -
 * inside the band, on a clean circular lane - and the rest are laid out from rIn outward (beyond the
 * band): the ship's corridor is the space between the first world and the second.
 */
function worlds(sys: StarSystem, rng: Rng, mu: number, rIn: number, rOut: number, inner: number | null = null): CompanionSpec[] {
  const picked = sampleWorlds(sys);
  const radii = inner === null ? layoutRadii(picked, rIn, rOut) : [inner, ...layoutRadii(picked.slice(1), rIn, rOut)];
  return picked.map((p, i) => {
    const a = radii[i];
    const lane = inner !== null && i <= 1;
    return {
      kind: 'planet' as const,
      name: p.letter ? p.letter : p.name,
      orbitRadius: a,
      // Real eccentricity, capped hard: lanes have to stay apart and flyable.
      ecc: lane ? 0 : clamp(p.eccentricity ?? 0, 0, 0.05),
      argPeri: rng.range(0, TAU),
      period: TAU * Math.sqrt((a * a * a) / mu),
      phase: rng.range(0, TAU),
      radius: scaleLog(p.radiusEarth, 0.5, 12, 4, 8),
      // Light enough to tug rather than capture (companions ride rails; see README).
      mu: mu * scaleLog(p.massEarth, 0.3, 300, 0.004, 0.012, 0.35),
      heatRadius: 0,
      heatDps: 0,
      look: planetLook(p),
    };
  });
}

/** Where to start, 0..1 across the band: the middle of the widest lane clear of every in-band world. */
function startLane(companions: readonly CompanionSpec[], safeMin: number, safeMax: number): number {
  const lo = safeMin + 18;
  const hi = safeMax - 18;
  const edges: [number, number][] = companions
    .filter((c) => c.kind !== 'star')
    .map((c): [number, number] => [c.orbitRadius * (1 - c.ecc) - c.radius - 20, c.orbitRadius * (1 + c.ecc) + c.radius + 20])
    .filter(([a, b]) => b > lo && a < hi)
    .sort((a, b) => a[0] - b[0]);
  let best = (lo + hi) / 2;
  let bestWidth = -1;
  let cursor = lo;
  for (const [a, b] of [...edges, [hi, hi] as [number, number]]) {
    if (a - cursor > bestWidth) {
      bestWidth = a - cursor;
      best = (cursor + a) / 2;
    }
    cursor = Math.max(cursor, b);
  }
  return clamp((best - safeMin) / (safeMax - safeMin), 0, 1);
}

function shownNote(sys: StarSystem): string {
  const shown = Math.min(sys.planets.length, MAX_WORLDS);
  const known = sys.planetCount;
  return known > shown ? `${known} known planets, ${shown} shown.` : `${known} known planet${known === 1 ? '' : 's'}.`;
}

function starModifiers(teff: number): { native: ModifierKind[]; flareRate: number } {
  // Cool dwarfs flare hard and often; hotter stars are steadier.
  return { native: ['flares'], flareRate: teff < 3900 ? 1.6 : teff < 5200 ? 1.1 : 0.8 };
}

function buildSingle(ctx: EnvContext): EnvBlueprint {
  const sys = ctx.system as StarSystem;
  const star = sys.stars[0];
  const teff = hostTeff(sys);
  const radius = scaleLog(star.radiusSun, 0.1, 10, 16, 25);
  const mu = scaleLog(star.massSun, 0.08, 3, 1.5e6, 2.5e6);
  const safeMin = radius + 40;
  const safeMax = 176;
  // The innermost world rides low in the band; the others ride beyond its top. The ship's corridor
  // lies between the first world and the second, with both pulling on it as they pass.
  const companions = worlds(sys, ctx.rng, mu, safeMax + 18, safeMax + 18 + 30 * 3, safeMin + 24);
  const mods = starModifiers(teff);
  const home = sys.id === SOLAR_SYSTEM_ID;
  return {
    ...DEFAULTS,
    body: { kind: 'star', label: home ? 'THE SUN' : 'HOST STAR', radius, mu, heatRadius: radius + 16, heatDps: 13, spin: 0.05, look: starLook(teff), deathText: `INCINERATED BY ${home ? 'THE SUN' : star.name.toUpperCase()}`, orbit: null },
    companions,
    safeMin,
    safeMax,
    startAt: startLane(companions, safeMin, safeMax),
    hazardGravity: 0.4,
    speedMul: 1,
    interval: [3.2, 2.1],
    native: mods.native,
    compatible: ['asteroids', 'comets', 'waves', 'debris'],
    mechanics: { flareRate: mods.flareRate },
    ...accentFor(teff),
    nebula: tints(teff),
    tagline: home ? 'HOME. EIGHT WORLDS ON THEIR REAL ORDER OUTWARD.' : `${shownNote(sys).toUpperCase()} EVERY ONE PULLS ON YOUR ORBIT.`,
    description: `${sys.name}: a planetary system${star.spectralType ? ` around a ${star.spectralType} star` : ''}. ${shownNote(sys)} The worlds ride their real order outward; distances are compressed.`,
    names: ['{N} SYSTEM', '{N}', 'WORLDS OF {N}'],
  };
}

function buildCircumbinary(ctx: EnvContext): EnvBlueprint {
  const sys = ctx.system as StarSystem;
  const star = sys.stars[0];
  const teff = hostTeff(sys);
  const rng = ctx.rng;
  const sep = rng.range(44, 52);
  const muTotal = 2.4e6;
  // Mass ratio is not catalogued per component: a fixed, clearly unequal pair so the pull visibly swings.
  const q = 0.6;
  const muA = muTotal / (1 + q);
  const muB = muTotal - muA;
  const dA = (sep * muB) / muTotal;
  const dB = (sep * muA) / muTotal;
  // Physical period of the pair, slowed threefold so it stays readable (as the binary environment does).
  const period = TAU * Math.sqrt((sep * sep * sep) / muTotal) * 3;
  const phase = rng.range(0, TAU);
  const rA = scaleLog(star.radiusSun, 0.1, 10, 14, 19);
  const rB = rA * 0.72;
  const companionStar: CompanionSpec = { kind: 'star', name: null, orbitRadius: dB, ecc: 0, argPeri: 0, period, phase: phase + Math.PI, radius: rB, mu: muB, heatRadius: rB + 11, heatDps: 14, look: starLook(teff * 0.72) };
  const safeMin = Math.max(92, dB + rB + 11 + 34);
  const safeMax = 184;
  // Circumbinary planets ride outside the band: the ship flies between the pair and its worlds.
  const planets = worlds(sys, rng, muTotal, safeMax + 26, safeMax + 26 + 26 * 4);
  return {
    ...DEFAULTS,
    body: { kind: 'star', label: 'CIRCUMBINARY SYSTEM', radius: rA, mu: muA, heatRadius: rA + 13, heatDps: 14, spin: 0.04, look: starLook(teff), deathText: 'INCINERATED BY THE PRIMARY', orbit: { radius: dA, period, phase } },
    companions: [companionStar, ...planets],
    safeMin,
    safeMax,
    startAt: startLane(planets, safeMin, safeMax),
    hazardGravity: 0.42,
    speedMul: 1.05,
    interval: [3.1, 2.0],
    native: ['flares'],
    compatible: ['asteroids', 'comets', 'waves', 'debris'],
    mechanics: { stream: { period: clamp(period * 0.8, 8, 14), halfWidth: 0.2 } },
    ...accentFor(teff),
    nebula: tints(teff),
    tagline: 'TWO SUNS. THE PLANETS CIRCLE BOTH - AND SO DO YOU.',
    description: `${sys.name}: two stars circling a shared centre, with ${shownNote(sys).replace('.', '')} orbiting the pair (circumbinary, per the NASA Exoplanet Archive). The companion star's own properties are not catalogued; its colour here is illustrative.`,
    names: ['{N} TWIN SUNS', '{N} CIRCUMBINARY', 'DOUBLE DAWN AT {N}'],
  };
}

function buildCompanion(ctx: EnvContext): EnvBlueprint {
  const base = buildSingle(ctx);
  const sys = ctx.system as StarSystem;
  const teff = hostTeff(sys);
  const rng = ctx.rng;
  // The planets circle one star; the system's other star(s) hold a wide orbit beyond them. A wide
  // companion is slowed so it sweeps the sky once or twice a sector instead of every few seconds.
  const outer = Math.max(base.safeMax + 70, ...base.companions.map((c) => c.orbitRadius + 36));
  const count = Math.min(2, sys.starCount - 1);
  // Light, as the wide star of the triple environment is: companions ride rails, so a heavy one
  // would drag every inner orbit around on its own (see README, simplifications).
  const stars: CompanionSpec[] = Array.from({ length: count }, (_, i) => {
    const a = outer + i * 44;
    return { kind: 'star' as const, name: null, orbitRadius: a, ecc: 0, argPeri: 0, period: TAU * Math.sqrt((a * a * a) / base.body.mu) * 1.6, phase: rng.range(0, TAU), radius: 11 - i * 2, mu: base.body.mu * (0.05 - i * 0.015), heatRadius: 26 - i * 4, heatDps: 12, look: starLook(teff * (0.8 - i * 0.12)) };
  });
  return {
    ...base,
    body: { ...base.body, label: sys.starCount >= 3 ? `${sys.starCount}-STAR SYSTEM` : 'BINARY COMPANION' },
    companions: [...base.companions, ...stars],
    tagline: sys.starCount >= 3 ? 'PLANETS AROUND ONE SUN, WITH MORE SUNS WATCHING.' : 'PLANETS AROUND ONE SUN. A SECOND SUN HOLDS THE EDGE.',
    description: `${sys.name}: ${shownNote(sys)} The planets orbit one star of a ${sys.starCount}-star system (circumstellar, per the NASA Exoplanet Archive); the companion star${sys.starCount > 2 ? 's ride' : ' rides'} a wide orbit and ${sys.starCount > 2 ? 'their' : 'its'} pull comes and goes. Companion properties are not catalogued; colours are illustrative.`,
    names: ['{N} AND COMPANION', '{N}', 'SECOND SUN OVER {N}'],
  };
}

const never = (): boolean => false;

export const SYSTEMS: EnvironmentDef[] = [
  {
    id: 'star_system',
    label: 'PLANETARY SYSTEM',
    family: 'stellar',
    depth: 1.2,
    minLevel: 2,
    weight: 1.5,
    rarity: 'uncommon',
    hosts: never,
    systemHosts: (s) => s.kind === 'single' && s.planets.length >= 2,
    variantClass: 'Planetary system',
    build: buildSingle,
  },
  {
    id: 'circumbinary',
    label: 'CIRCUMBINARY SYSTEM',
    family: 'stellar',
    depth: 1.6,
    minLevel: 5,
    weight: 0.9,
    rarity: 'rare',
    hosts: never,
    systemHosts: (s) => s.hostConfig === 'circumbinary' && s.planets.length >= 1,
    variantClass: 'Circumbinary planetary system',
    build: buildCircumbinary,
  },
  {
    id: 'companion_star',
    label: 'MULTI-STAR PLANETARY SYSTEM',
    family: 'stellar',
    depth: 1.5,
    minLevel: 4,
    weight: 0.9,
    rarity: 'uncommon',
    hosts: never,
    systemHosts: (s) => s.hostConfig === 'circumstellar' && s.planets.length >= 1,
    variantClass: 'Planetary system with a stellar companion',
    build: buildCompanion,
  },
];
