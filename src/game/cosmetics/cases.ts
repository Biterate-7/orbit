/**
 * Cases: the in-game shop's randomised cosmetic containers.
 *
 * Cases are bought only with credits earned by playing - there is no other currency and nothing
 * here can be paid for. Every case states its odds, and the same table that is displayed is the
 * one that is rolled (`rollCase` reads CaseDef.odds directly).
 *
 * Duplicate protection: within the rarity that was rolled, the reward is always an item the pilot
 * does not own yet while one exists. Only when every item of that rarity in the case's pool is
 * already owned does a duplicate come up, and it is converted straight back into credits.
 *
 * Bad-luck protection: each case guarantees a reward of a stated rarity or better after a stated
 * number of opens without one.
 */
import { COSMETICS, RARITIES, RARITY_RANK } from './catalog';
import type { CosmeticDef, CosmeticSlot, Rarity } from './catalog';

export type CaseId = 'survey' | 'propulsion' | 'deepfield' | 'singularity';

export interface CaseDef {
  id: CaseId;
  name: string;
  description: string;
  price: number;
  /** Chance of each rarity, in percent. Sums to 100. Rarities not listed cannot drop. */
  odds: Partial<Record<Rarity, number>>;
  /** Slots the case draws from (all slots when omitted). */
  slots?: CosmeticSlot[];
  /** After `after` opens without a `rarity`-or-better reward, the next one is guaranteed to be. */
  pity: { rarity: Rarity; after: number };
  color: string;
}

export const CASES: CaseDef[] = [
  {
    id: 'survey',
    name: 'SURVEY CASE',
    description: 'Standard-issue surplus from the survey corps. Mostly paint.',
    price: 150,
    odds: { common: 60, uncommon: 29, rare: 9.5, epic: 1.5 },
    pity: { rarity: 'rare', after: 6 },
    color: '#8a96b8',
  },
  {
    id: 'propulsion',
    name: 'PROPULSION CASE',
    description: 'Engines, trails and exhaust effects only.',
    price: 260,
    odds: { common: 40, uncommon: 34, rare: 18, epic: 6.5, legendary: 1.5 },
    slots: ['engine', 'trail', 'particles'],
    pity: { rarity: 'rare', after: 5 },
    color: '#ff8a3d',
  },
  {
    id: 'deepfield',
    name: 'DEEP FIELD CASE',
    description: 'Recovered from beyond the neighbourhood. Nothing common inside.',
    price: 420,
    odds: { uncommon: 44, rare: 38, epic: 14, legendary: 4 },
    pity: { rarity: 'epic', after: 6 },
    color: '#4d9bff',
  },
  {
    id: 'singularity',
    name: 'SINGULARITY CASE',
    description: 'Sealed near an event horizon. The only case a mythic can come from.',
    price: 950,
    odds: { rare: 48, epic: 35, legendary: 14, mythic: 3 },
    pity: { rarity: 'legendary', after: 7 },
    color: '#ff5d8f',
  },
];

export function caseDef(id: string): CaseDef | undefined {
  return CASES.find((c) => c.id === id);
}

/** Credits a duplicate is converted into. */
export const DUPLICATE_VALUE: Record<Rarity, number> = { common: 35, uncommon: 70, rare: 140, epic: 280, legendary: 560, mythic: 1200 };

/** Items a case can contain: case-obtainable cosmetics of the rarities it lists, in its slots. */
export function casePool(c: CaseDef): CosmeticDef[] {
  return COSMETICS.filter((i) => i.obtain.kind === 'case' && (c.odds[i.rarity] ?? 0) > 0 && (!c.slots || c.slots.includes(i.slot)));
}

/** The odds actually in force: a rarity with nothing in the pool has its share handed to the next one down. */
export function effectiveOdds(c: CaseDef): { rarity: Rarity; chance: number; items: number }[] {
  const pool = casePool(c);
  const rows = RARITIES.filter((r) => (c.odds[r] ?? 0) > 0).map((r) => ({ rarity: r, chance: c.odds[r] as number, items: pool.filter((i) => i.rarity === r).length }));
  for (let i = rows.length - 1; i > 0; i--) {
    if (rows[i].items === 0) {
      rows[i - 1].chance += rows[i].chance;
      rows[i].chance = 0;
    }
  }
  return rows.filter((r) => r.chance > 0);
}

export interface CaseRoll {
  item: CosmeticDef;
  rarity: Rarity;
  /** True when the pilot already owned every item of this rarity in the pool. */
  duplicate: boolean;
  /** Credits returned for a duplicate (0 otherwise). */
  refund: number;
  /** True when bad-luck protection forced the rarity. */
  guaranteed: boolean;
}

/**
 * Open a case. Pure: the outcome depends only on the arguments and the random source, so it can be
 * tested and reproduced. `sinceGood` = opens of this case since a reward at or above its pity rarity.
 */
export function rollCase(c: CaseDef, owned: ReadonlySet<string>, sinceGood: number, random: () => number): CaseRoll {
  const pool = casePool(c);
  let rows = effectiveOdds(c);
  const guaranteed = sinceGood >= c.pity.after - 1;
  if (guaranteed) {
    const good = rows.filter((r) => RARITY_RANK[r.rarity] >= RARITY_RANK[c.pity.rarity]);
    if (good.length > 0) rows = good;
  }
  const total = rows.reduce((s, r) => s + r.chance, 0);
  let roll = random() * total;
  let rarity = rows[rows.length - 1].rarity;
  for (const r of rows) {
    roll -= r.chance;
    if (roll < 0) {
      rarity = r.rarity;
      break;
    }
  }
  const tier = pool.filter((i) => i.rarity === rarity);
  const fresh = tier.filter((i) => !owned.has(i.id));
  const from = fresh.length > 0 ? fresh : tier;
  const item = from[Math.min(from.length - 1, Math.floor(random() * from.length))];
  const duplicate = fresh.length === 0;
  return { item, rarity, duplicate, refund: duplicate ? DUPLICATE_VALUE[rarity] : 0, guaranteed };
}

/** Does this reward reset the case's bad-luck counter? */
export function meetsPity(c: CaseDef, rarity: Rarity): boolean {
  return RARITY_RANK[rarity] >= RARITY_RANK[c.pity.rarity];
}

/** Share of a case's pool the pilot already owns. */
export function caseProgress(c: CaseDef, owned: ReadonlySet<string>): { owned: number; total: number } {
  const pool = casePool(c);
  return { owned: pool.filter((i) => owned.has(i.id)).length, total: pool.length };
}
