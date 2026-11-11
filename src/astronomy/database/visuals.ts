/**
 * Visual properties derived from catalogue data.
 *
 * Nothing in this file is a measurement. These helpers turn real properties (temperature,
 * spectral type, taxonomy) into colours for rendering; the results are stored with
 * `colorSource: 'derived'` so they are never mistaken for observed colours.
 */
import type { AstroObject } from './schema';

const hex2 = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export const rgbToHex = (r: number, g: number, b: number): string => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function hexToRgb3(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mixHex(a: string, b: string, t: number): string {
  const A = hexToRgb3(a);
  const B = hexToRgb3(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

/** Scale a colour's brightness (0 = black, 1 = unchanged, >1 brighter towards white). */
export function shade(hex: string, k: number): string {
  return k <= 1 ? mixHex('#000000', hex, k) : mixHex(hex, '#ffffff', Math.min(1, k - 1));
}

/**
 * Approximate colour of a black body at temperature `kelvin` (Tanner Helland's fit to the
 * CIE curve, valid 1000 K - 40000 K). Saturation is exaggerated slightly so that spectral
 * classes read clearly in a restrained pixel palette.
 */
export function blackbodyHex(kelvin: number): string {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const avg = (r + g + b) / 3;
  const sat = 1.35;
  return rgbToHex(avg + (r - avg) * sat, avg + (g - avg) * sat, avg + (b - avg) * sat);
}

/** Leading spectral class letter of an MK type ("K1.5IIIFe-0.5" -> "K", "DA2" -> "D", "WC8" -> "W"). */
export function spectralClass(sp: string | null): string | null {
  if (!sp) return null;
  const m = /^(?:sd|d|g|c|esd|usd)?\s*([OBAFGKMLTYDWCSN])/.exec(sp.trim());
  return m ? m[1] : null;
}

/** MK luminosity class: 'I' supergiant, 'II' bright giant, 'III' giant, 'IV' subgiant, 'V' dwarf. */
export function luminosityClass(sp: string | null): 'I' | 'II' | 'III' | 'IV' | 'V' | null {
  if (!sp) return null;
  // The class follows the subtype digit, possibly after a dash, and may carry a/b/ab suffixes
  // ("K1.5IIIFe-0.5", "M1.5IIIa", "K2-IIIbCa-1", "M1-M2Ia-Iab", "A0mA1Va").
  const m = /[0-9.]\s*[-:+]?\s*(III|II|IV|I|V)/.exec(sp.replace(/^[a-z]+/, ''));
  return m ? (m[1] as 'I' | 'II' | 'III' | 'IV' | 'V') : null;
}

/** Typical effective temperature for a spectral class. Used for colour only - never stored as data. */
const CLASS_TEFF: Record<string, number> = {
  O: 36000,
  B: 17000,
  A: 8600,
  F: 6700,
  G: 5600,
  K: 4400,
  M: 3200,
  L: 1900,
  T: 1200,
  Y: 600,
  D: 13000,
  W: 40000,
  C: 3000,
  S: 3200,
  N: 3000,
};

/** Temperature to render a star with: the catalogue value when present, else the class typical value. */
export function renderTemperature(temperature: number | null, sp: string | null): number {
  if (temperature && temperature > 300) return temperature;
  const c = spectralClass(sp);
  return (c && CLASS_TEFF[c]) || 5600;
}

const ASTEROID_TAXONOMY: Record<string, string[]> = {
  C: ['#6f6a66', '#3f3b3a', '#1f1d1e'],
  B: ['#7a8088', '#454a52', '#23262b'],
  S: ['#b08f72', '#6e5444', '#372a24'],
  V: ['#b9a58a', '#75644f', '#3a3128'],
  M: ['#b4bac6', '#70778a', '#373c4a'],
  X: ['#a3a7b0', '#646876', '#33353e'],
  D: ['#7d5b4c', '#4a342c', '#241917'],
  P: ['#75605a', '#443634', '#221a1a'],
  E: ['#d0cabd', '#8c877c', '#46433e'],
  A: ['#c2835a', '#7a4f36', '#3d271b'],
  Q: ['#b39a80', '#6f5e4e', '#372f27'],
};

/** Palette families keyed by the classification strings the normaliser produces. */
function planetColors(classification: string, temperature: number | null): string[] {
  const c = classification.toLowerCase();
  const t = temperature ?? 0;
  if (c.includes('gas giant') || c.includes('hot jupiter')) {
    if (t > 1000) return ['#ff9a5c', '#8c2f2a', '#2a0d14'];
    return ['#e0b98a', '#9c6b4a', '#3d2a26'];
  }
  if (c.includes('ice giant') || c.includes('neptune')) return ['#8fd0f0', '#3f73b8', '#162a55'];
  if (t > 1300) return ['#ff7a3d', '#8c2218', '#1c0a0a'];
  if (t > 0 && t < 160) return ['#e6f4ff', '#8fb8d8', '#2f4a66'];
  if (t >= 230 && t <= 320) return ['#6fb7e8', '#2f6aa8', '#12284a'];
  if (t > 320) return ['#d8a868', '#946238', '#3d2616'];
  return ['#a9a9b8', '#62627a', '#2a2a3a'];
}

/** Colours for an object computed from its catalogue properties. */
export function derivedColors(o: Pick<AstroObject, 'category' | 'classification' | 'physicalProperties' | 'context'>): string[] {
  const t = o.physicalProperties.temperature;
  const cls = o.classification.toLowerCase();
  switch (o.category) {
    case 'star': {
      const base = blackbodyHex(renderTemperature(t, o.context.spectralType));
      return [shade(base, 1.35), base, shade(base, 0.45)];
    }
    case 'stellar-remnant':
      if (cls.includes('pulsar') || cls.includes('neutron') || cls.includes('magnetar')) return ['#ffffff', '#7ffcff', '#1a7f8f'];
      if (cls.includes('white dwarf')) return ['#ffffff', '#c9dcff', '#5a78c8'];
      return ['#ffd890', '#cc4a4a', '#4b1f6b'];
    case 'planet':
    case 'exoplanet':
      return planetColors(o.classification, t);
    case 'moon':
    case 'dwarf-planet':
      return t !== null && t < 120 ? ['#e6f4ff', '#8fb8d8', '#2f4a66'] : ['#c9c4bc', '#7c7770', '#3a3733'];
    case 'asteroid': {
      const tax = (o.context.taxonomy ?? '').trim().charAt(0).toUpperCase();
      return ASTEROID_TAXONOMY[tax] ?? ['#9a94a3', '#5f5870', '#2c2838'];
    }
    case 'comet':
      return ['#e8f6ff', '#7fd6ff', '#2a5a8c'];
    case 'nebula':
      if (cls.includes('supernova')) return ['#ffb36b', '#3ec9d8', '#7a2a4a'];
      if (cls.includes('planetary')) return ['#7ff0d0', '#3a8ad8', '#5a2a7a'];
      if (cls.includes('reflection')) return ['#9fc4ff', '#4a6ad8', '#1d2a6b'];
      if (cls.includes('dark') || cls.includes('molecular')) return ['#8a6a5a', '#4a352f', '#1f1716'];
      return ['#ff7a9a', '#c0407a', '#4a1a5a'];
    case 'galaxy':
      return ['#fff0d0', '#b8c4ff', '#4a4a8a'];
    case 'quasar':
      return ['#ffffff', '#b8a8ff', '#5a3ad8'];
  }
}

const fmt = (n: number, digits = 2): string => {
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString('en-US');
  return String(Number(n.toPrecision(digits + 1)));
};

/** One-line description of what the object looks like, built only from catalogue fields. */
export function visualDescription(o: Pick<AstroObject, 'category' | 'classification' | 'physicalProperties' | 'context'>): string {
  const p = o.physicalProperties;
  const bits: string[] = [o.classification];
  if (o.category === 'star' || o.category === 'stellar-remnant') {
    if (o.context.spectralType) bits.push(`spectral type ${o.context.spectralType}`);
    if (p.temperature) bits.push(`${fmt(p.temperature)} K`);
  } else if (p.radius) {
    bits.push(`${fmt(p.radius * 2)} km across`);
  }
  if (o.context.taxonomy) bits.push(`${o.context.taxonomy}-type surface`);
  if (o.context.albedo !== null) bits.push(`albedo ${fmt(o.context.albedo)}`);
  if (o.context.redshift !== null) bits.push(`redshift ${fmt(o.context.redshift, 3)}`);
  return bits.join(', ');
}
