/**
 * Deterministic seeding. A level is a pure function of (catalogue version, sector index, seed):
 * the same three values always rebuild exactly the same level.
 */
import { Rng } from '../game/rng';

export { Rng };

/** Avalanche-mix any number of integers into one 32-bit seed (murmur3 finaliser). */
export function hash32(...parts: number[]): number {
  let h = 0x9e3779b9;
  for (const p of parts) {
    let k = Math.imul(p | 0, 0xcc9e2d51);
    k = (k << 15) | (k >>> 17);
    k = Math.imul(k, 0x1b873593);
    h ^= k;
    h = (h << 13) | (h >>> 19);
    h = (Math.imul(h, 5) + 0xe6546b64) | 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Seed of the n-th candidate level for a sector of a run. */
export function candidateSeed(runSeed: number, index: number, attempt: number): number {
  return hash32(runSeed, index, attempt, 0x0b17105);
}

/** Independent random stream for one aspect of a level, so changing one never shifts another. */
export function subRng(seed: number, channel: string): Rng {
  return new Rng(hash32(seed, hashString(channel)));
}

export function levelCode(catalogueVersion: number, index: number, seed: number): string {
  return `C${catalogueVersion}-${String(index).padStart(3, '0')}-${(seed >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
}

export interface ParsedCode {
  catalogueVersion: number;
  index: number;
  seed: number;
  /** Mission suffix (e.g. AR2); absent for survival sectors. */
  mission?: { code: string; tier: number };
}

export function parseLevelCode(code: string): ParsedCode | null {
  const m = /^C(\d+)-(\d+)-([0-9A-F]{8})(?:-([A-Z]{2})(\d+))?$/i.exec(code.trim());
  if (!m) return null;
  const out: ParsedCode = { catalogueVersion: Number(m[1]), index: Number(m[2]), seed: parseInt(m[3], 16) >>> 0 };
  if (m[4]) out.mission = { code: m[4].toUpperCase(), tier: Number(m[5]) };
  return out;
}

/**
 * Rendezvous (highest-random-weight) choice: every item gets a score from (seed, key) and the best
 * wins. Unlike indexing into a list, adding items to the catalogue later only changes the pick
 * when a new item actually wins - so old seeds keep resolving to the same objects.
 */
export function rendezvousPick<T>(seed: number, items: readonly T[], key: (item: T) => string): T | null {
  let best: T | null = null;
  let bestScore = -1;
  for (const item of items) {
    const score = hash32(seed, hashString(key(item)));
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}
