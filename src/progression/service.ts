/**
 * The bridge between the game and the progression core: turns a GameEvent into one atomic save
 * update and tells whoever is listening what came of it.
 */
import type { SaveStore } from '../game/persistence';
import { applyEvent } from './events';
import type { GameEvent, Outcome } from './events';

export type OutcomeListener = (outcome: Outcome, event: GameEvent) => void;

/** True when an outcome carries something worth showing the player. */
export function hasNews(o: Outcome): boolean {
  return o.achievements.length > 0 || o.levels.length > 0 || o.cosmetics.length > 0 || o.synergies.length > 0;
}

export class Progression {
  private listeners = new Set<OutcomeListener>();

  constructor(
    readonly store: SaveStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Apply an event. The save is written once, with everything the event caused. */
  dispatch(event: GameEvent): Outcome {
    let out: Outcome | null = null;
    this.store.update((d) => {
      out = applyEvent(d, event, this.now());
    });
    const outcome = out as unknown as Outcome;
    this.listeners.forEach((l) => l(outcome, event));
    return outcome;
  }

  /** Called after every event (use `hasNews` to pick out the ones worth a toast). */
  onOutcome(fn: OutcomeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
