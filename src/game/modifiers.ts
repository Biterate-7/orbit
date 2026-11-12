/**
 * Run modifiers: optional rules chosen before a run. Harder rules pay a score multiplier, the one
 * assist rule costs one. They change how a run plays, not just its numbers.
 */
import { PALETTE } from './config';
import type { RunModifierId } from './types';

export interface RunModifierDef {
  id: RunModifierId;
  name: string;
  description: string;
  scoreMul: number;
  color: string;
}

export const RUN_MODIFIERS: RunModifierDef[] = [
  { id: 'glass', name: 'GLASS HULL', description: 'Half hull. Every hit matters.', scoreMul: 1.4, color: PALETTE.red },
  { id: 'swarm', name: 'SWARM', description: '50% more incoming hazards in every sector.', scoreMul: 1.3, color: PALETTE.amber },
  { id: 'blind', name: 'NO FLIGHT PLAN', description: 'No trajectory preview. Fly by feel.', scoreMul: 1.5, color: PALETTE.violet },
  { id: 'dry', name: 'DRY TANKS', description: 'Every mission is fuel-limited. Coast to recharge.', scoreMul: 1.25, color: PALETTE.orange },
  { id: 'calm', name: 'CALM SKIES', description: 'Assist: fewer hazards, tougher hull.', scoreMul: 0.6, color: PALETTE.green },
];

export const MODIFIER_IDS = RUN_MODIFIERS.map((m) => m.id);

export function scoreMultiplier(ids: readonly RunModifierId[]): number {
  let m = 1;
  for (const d of RUN_MODIFIERS) if (ids.includes(d.id)) m *= d.scoreMul;
  return Math.round(m * 100) / 100;
}
