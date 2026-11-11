/**
 * Shared types and helpers for environment definitions.
 *
 * An environment turns one astronomical object (or a procedural stand-in) into a blueprint:
 * the central body, its look, the safe orbital band, native hazards and its signature mechanic.
 *
 * Gameplay scale is NOT physical scale. Real radii, masses and periods are mapped (mostly
 * logarithmically) into ranges that play well; the mapping preserves ordering - a heavier real
 * body is a heavier game body - but not ratios. See README "Scientific simplifications".
 */
import type { Catalogue } from '../../astronomy/database/catalogue';
import type { AstroObject } from '../../astronomy/database/schema';
import { blackbodyHex, mixHex, renderTemperature, shade } from '../../astronomy/database/visuals';
import { TAU } from '../../game/math';
import type { Rng } from '../../game/rng';
import type { BodyKind, BodyLook, CompanionSpec, EnvFamily, LevelMechanics, ModifierKind, Rarity, SurfaceStyle } from '../../game/types';

export type EnvId =
  | 'rocky'
  | 'gas_giant'
  | 'ringed'
  | 'ice'
  | 'lava'
  | 'ocean'
  | 'desert'
  | 'tidally_locked'
  | 'super_earth'
  | 'rogue'
  | 'red_dwarf'
  | 'sunlike'
  | 'blue_giant'
  | 'red_giant'
  | 'white_dwarf'
  | 'neutron_star'
  | 'pulsar'
  | 'binary'
  | 'multiple_star'
  | 'variable_star'
  | 'black_hole'
  | 'xray_binary'
  | 'quasar'
  | 'galactic_core'
  | 'supernova_remnant'
  | 'nebula'
  | 'asteroid_field'
  | 'comet_region'
  | 'anomaly';

export interface EnvContext {
  rng: Rng;
  index: number;
  /** Real host object, or null for a procedural / fictional setting. */
  object: AstroObject | null;
  catalogue: Catalogue;
}

export interface BodyBlueprint {
  kind: BodyKind;
  label: string;
  radius: number;
  mu: number;
  heatRadius: number;
  heatDps: number;
  spin: number;
  look: BodyLook;
  deathText: string;
  orbit: { radius: number; period: number; phase: number } | null;
}

export interface EnvBlueprint {
  body: BodyBlueprint;
  safeMin: number;
  safeMax: number;
  /** Where in the band the ship starts, 0 = inner edge, 1 = outer edge. */
  startAt: number;
  hazardGravity: number;
  speedMul: number;
  /** Seconds between asteroid spawns at sector start / end, before difficulty scaling. */
  interval: [number, number];
  native: ModifierKind[];
  compatible: ModifierKind[];
  mechanics: Partial<LevelMechanics>;
  companions: CompanionSpec[];
  accent: string;
  ripple: string;
  /** Background nebula tints and strength. */
  nebula: [string, string, number];
  starDensity: number;
  /** Host-star colours to paint into the backdrop (planets only). */
  hostStarColors: string[];
  galaxies: number;
  band: boolean;
  fogColor: string;
  tagline: string;
  description: string;
  /** Name patterns: {N} = object name. Patterns without {N} are evocative titles for this environment. */
  names: string[];
}

export interface EnvironmentDef {
  id: EnvId;
  label: string;
  family: EnvFamily;
  /** 0 Solar System, 1 solar neighbourhood, 2 deep galaxy, 3 extragalactic. */
  depth: number;
  minLevel: number;
  weight: number;
  rarity: Rarity;
  /** Whether a catalogue object can host this environment. */
  hosts: (o: AstroObject) => boolean;
  /** Class label used when the environment is generated without a real host. */
  variantClass: string;
  /** True for invented settings that have no real-world counterpart. */
  fictional?: boolean;
  build: (ctx: EnvContext) => EnvBlueprint;
}

export const NO_MECHANICS: LevelMechanics = {
  belts: [],
  dragZones: [],
  beam: null,
  plume: null,
  eruptions: null,
  scorch: null,
  dark: null,
  wind: null,
  emp: null,
  pulsation: null,
  frameDrag: 0,
  depthBonus: false,
  season: null,
  spawn: 'edge',
  streamAngle: 0,
  muWobble: null,
  waveStrength: 1,
  flareRate: 1,
};

// ------------------------------------------------------------------ scaling helpers

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Map a real quantity onto a gameplay range on a log scale. `fallback` (0..1) is used when the
 * catalogue has no value - the level is still built, it just sits mid-range.
 */
export function scaleLog(value: number | null, lo: number, hi: number, outLo: number, outHi: number, fallback = 0.5): number {
  const t = value === null || value <= 0 ? fallback : clamp(Math.log(value / lo) / Math.log(hi / lo), 0, 1);
  return lerp(outLo, outHi, t);
}

/** Visual spin from a real rotation period (hours): fast rotators visibly spin faster. */
export function spinFrom(rotationHours: number | null, base: number): number {
  return base * scaleLog(rotationHours, 2, 2000, 2.2, 0.35, 0.45);
}

/** Period of a circular orbit, slowed a little so companions stay readable. */
export function railPeriod(mu: number, a: number): number {
  return (TAU * Math.sqrt((a * a * a) / mu)) / 0.85;
}

// ------------------------------------------------------------------ look helpers

/** Build a dark-to-bright shading ramp through up to three key colours (given brightest first). */
export function rampFrom(colors: string[], steps = 7): string[] {
  const bright = colors[0] ?? '#c9e2ff';
  const mid = colors[1] ?? shade(bright, 0.6);
  const dark = colors[2] ?? shade(mid, 0.45);
  const stops = [shade(dark, 0.35), dark, mid, bright, shade(bright, 1.45)];
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / (steps - 1)) * (stops.length - 1);
    const k = Math.min(stops.length - 2, Math.floor(t));
    out.push(mixHex(stops[k], stops[k + 1], t - k));
  }
  return out;
}

export function look(surface: SurfaceStyle, colors: string[], opts: Partial<BodyLook> = {}): BodyLook {
  return {
    surface,
    ramp: rampFrom(colors),
    rim: null,
    glow: colors[1] ?? colors[0] ?? '#3d6bff',
    glowScale: 2.1,
    glowIntensity: 0.5,
    ring: null,
    lumpiness: 0,
    ...opts,
  };
}

/** Star look from an effective temperature: spectral class decides the whole palette. */
export function starLook(teff: number, opts: Partial<BodyLook> = {}): BodyLook {
  const base = blackbodyHex(teff);
  const hot = teff > 9000;
  return {
    surface: 'plasma',
    ramp: [shade(base, 0.16), shade(base, 0.3), shade(base, 0.5), shade(base, 0.75), base, shade(base, 1.3), shade(base, 1.7)],
    rim: null,
    glow: hot ? shade(base, 1.15) : base,
    glowScale: 1.5,
    glowIntensity: 1,
    ring: null,
    lumpiness: 0,
    ...opts,
  };
}

/** Temperature a star should be drawn with (catalogue value, else typical for its spectral class). */
export function starTemperature(o: AstroObject | null, fallback: number): number {
  if (!o) return fallback;
  if (o.physicalProperties.temperature === null && !o.context.spectralType) return fallback;
  return renderTemperature(o.physicalProperties.temperature, o.context.spectralType);
}

/** Colours to use for an object's surface: its catalogue colours, or a fallback palette. */
export function objectColors(o: AstroObject | null, fallback: string[]): string[] {
  const c = o?.visualProperties.dominantColors;
  return c && c.length >= 3 ? c : fallback;
}

/** Host-star colour(s) for a planet's backdrop, from the host's real temperature / spectral type. */
export function hostColors(o: AstroObject | null, fallbackTeff: number): string[] {
  if (!o) return [blackbodyHex(fallbackTeff)];
  if (o.context.hostName === 'Sun' || o.source === 'JPL-HORIZONS') return [blackbodyHex(5772)];
  const t = renderTemperature(o.context.hostTemperature, o.context.spectralType);
  const n = Math.min(3, Math.max(1, o.context.starsInSystem ?? 1));
  return Array.from({ length: n }, (_, i) => blackbodyHex(t * (1 - i * 0.22)));
}

export function moon(orbitRadius: number, radius: number, mu: number, primaryMu: number, phase: number, name: string | null = null, ecc = 0, argPeri = 0): CompanionSpec {
  return { kind: 'moon', name, orbitRadius, ecc, argPeri, period: railPeriod(primaryMu, orbitRadius), phase, radius, mu, heatRadius: 0, heatDps: 0, look: null };
}

export const EARTH_RADIUS_KM = 6371;
export const EARTH_MASS_KG = 5.9722e24;
export const SUN_MASS_KG = 1.98841e30;

export const isCat = (o: AstroObject, ...cats: AstroObject['category'][]): boolean => cats.includes(o.category);
export const classHas = (o: AstroObject, ...words: string[]): boolean => {
  const c = o.classification.toLowerCase();
  return words.some((w) => c.includes(w));
};
export const radiusEarths = (o: AstroObject): number | null => (o.physicalProperties.radius === null ? null : o.physicalProperties.radius / EARTH_RADIUS_KM);
