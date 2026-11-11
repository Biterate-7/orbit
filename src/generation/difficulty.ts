/**
 * Difficulty model. Progression is spread over several independent dimensions so that later
 * sectors are not just "the same thing, faster":
 *
 *   intensity   hazard rate and speed (saturates - it never becomes unreadable)
 *   complexity  how many extra hazard systems are layered onto the environment
 *   precision   a wrong orbit destabilises faster, so there is less time to correct it
 *   endurance   sectors last longer
 *   mass        central bodies get heavier, so orbits are faster
 */

export interface DifficultyProfile {
  index: number;
  /** Scalar intensity, 1 at sector 1, approaching 2.5 asymptotically. */
  intensity: number;
  /** Number of extra hazard modifiers layered on top of the environment's native ones. */
  extras: number;
  /** Multiplier on how fast stability drains while the orbit is wrong: less time to correct, deeper in. */
  drainScale: number;
  /** Sector length in seconds. */
  duration: number;
  /** Multiplier on the central mass. */
  massScale: number;
  /** Multiplier on heat-zone damage. */
  heatScale: number;
  /** 0..1 chance that a sector is an "elite" variant with one more layered system. */
  eliteChance: number;
}

export function intensityFor(index: number): number {
  let d: number;
  if (index <= 5) d = 1 + 0.07 * (index - 1);
  else if (index <= 19) d = Math.min(2.05, 1.28 + 0.055 * (index - 5));
  else d = 2.05 + 0.45 * (1 - Math.exp(-(index - 19) / 60));
  // A gentle rise-and-fall so runs breathe instead of climbing a flat ramp.
  const breath = index > 5 ? 0.045 * Math.sin(index * 1.3) : 0;
  return d * (1 + breath);
}

export function durationFor(index: number): number {
  if (index === 1) return 32;
  if (index <= 5) return 42;
  return Math.min(56, 46 + (index - 6) * 1.5);
}

export function difficultyProfile(index: number): DifficultyProfile {
  const extras = index < 4 ? 0 : index < 9 ? 1 : index < 16 ? 2 : 3;
  return {
    index,
    intensity: intensityFor(index),
    extras,
    drainScale: index <= 8 ? 1 : Math.min(1.35, 1 + 0.012 * (index - 8)),
    duration: durationFor(index),
    massScale: index <= 5 ? 1 : Math.min(1.22, 1 + 0.025 * (index - 5)),
    heatScale: index <= 5 ? 1 : 1.15,
    eliteChance: index < 30 ? 0 : Math.min(0.3, 0.1 + (index - 30) * 0.004),
  };
}
