/**
 * Orbital configurations: how the object's own orbit shapes the level.
 *
 *   circular    the baseline
 *   eccentric   the body's real eccentricity drives an activity cycle (Kepler's equation): hazards
 *               intensify toward periapsis and relax toward apoapsis; the ship starts on an ellipse
 *   inclined    orbiting debris lies in a plane tilted by the real inclination, so it only
 *               crosses the ship's plane - and can only be hit - near the two nodes
 *   binary      two primaries around a barycentre
 *   multi-body  several gravitating companions on rails
 *   decaying    something steadily bleeds orbital energy (frame dragging, atmosphere)
 *   unstable    a perturber on an eccentric path, or a central mass that will not hold still
 *
 * Simplifications: companions and the primaries move on fixed Keplerian rails and are not perturbed
 * by each other or the ship; orbital periods are compressed to seconds; inclination is modelled as
 * a height above the play plane rather than by a 3D simulation.
 */
import type { AstroObject } from '../astronomy/database/schema';
import type { Rng } from '../game/rng';
import type { CompanionSpec, LevelMechanics } from '../game/types';
import { clamp, lerp } from './environments/common';
import type { EnvBlueprint, EnvironmentDef } from './environments/common';
import { eccentricMoon } from './environments/planetary';

export type OrbitId = 'circular' | 'eccentric' | 'inclined' | 'binary' | 'multi-body' | 'decaying' | 'unstable';

export interface OrbitConfig {
  id: OrbitId;
  label: string;
  /** Plain-language note for the discovery card. */
  note: string;
  /** Eccentricity of the ship's starting orbit. */
  startEcc: number;
}

export interface OrbitInputs {
  env: EnvironmentDef;
  blueprint: EnvBlueprint;
  mechanics: LevelMechanics;
  companions: CompanionSpec[];
  object: AstroObject | null;
  rng: Rng;
  index: number;
  safeMax: number;
  /** Where the ship will start, before lane adjustments. */
  startRadius: number;
  mu: number;
}

const DEG = Math.PI / 180;

export function configureOrbit(a: OrbitInputs): OrbitConfig {
  const { blueprint: bp, mechanics, companions, object, rng } = a;
  // Structural configurations are decided by the environment itself.
  if (bp.body.orbit) {
    return { id: 'binary', label: companions.length > 1 ? 'HIERARCHICAL TRIPLE' : 'BINARY SYSTEM', note: 'Two primaries circle a shared barycentre; the ship orbits both.', startEcc: 0 };
  }
  if (mechanics.muWobble) {
    return { id: 'unstable', label: 'UNSTABLE ORBIT', note: 'The central mass varies, so no orbit stays closed.', startEcc: 0 };
  }

  // Real orbital elements when the catalogue has them; a generated pair for procedural settings.
  const real = object !== null;
  const e = real ? object.orbitalProperties.eccentricity : rng.chance(0.35) ? rng.range(0.2, 0.7) : rng.range(0, 0.15);
  // Catalogued inclinations mean different things: for Solar System bodies it is the tilt of the
  // orbit to the ecliptic, which is what this mechanic models; for exoplanets it is the viewing
  // angle from Earth (about 90 degrees for anything that transits) and says nothing of the kind.
  const tiltKnown = real && (object.source === 'JPL-HORIZONS' || object.source === 'JPL-SBDB');
  const rawInc = real ? (tiltKnown ? object.orbitalProperties.inclination : null) : rng.chance(0.3) ? rng.range(12, 55) : rng.range(0, 10);
  const inc = rawInc === null ? null : Math.min(rawInc, 180 - rawInc);
  const hasBelts = mechanics.belts.length > 0;
  const decays = mechanics.frameDrag > 0 || mechanics.dragZones.some((z) => z.style === 'haze');

  const options: OrbitId[] = ['circular'];
  const weights: number[] = [e !== null && e < 0.1 ? 3 : 1.4];
  if (e !== null && e >= 0.18) {
    options.push('eccentric');
    weights.push(3 + e * 4);
  }
  if (inc !== null && inc >= 12 && hasBelts) {
    options.push('inclined');
    weights.push(2.6);
  }
  if (decays) {
    options.push('decaying');
    weights.push(3);
  }
  if (companions.length >= 2) {
    options.push('multi-body');
    weights.push(3.5);
  }
  // Only where the start lane sits well below the outer edge the perturber skims.
  if (a.index >= 12 && a.env.family === 'planetary' && companions.length === 0 && !mechanics.dark && a.startRadius <= a.safeMax - 40) {
    options.push('unstable');
    weights.push(0.9);
  }

  const id = rng.weighted(options, weights);
  const tag = real ? '' : ' (generated)';
  switch (id) {
    case 'eccentric': {
      const ecc = clamp(e ?? 0.3, 0.2, 0.8);
      mechanics.season = { period: lerp(34, 22, (ecc - 0.2) / 0.6), ecc };
      // The ship itself starts on an ellipse too - unless that ellipse would cross lanes of debris or moons.
      const crowded = hasBelts || companions.some((c) => c.orbitRadius < a.safeMax + 10);
      return {
        id,
        label: `ECCENTRIC ORBIT · e ${(e ?? ecc).toFixed(2)}`,
        note: `Activity follows the body's ${real ? 'real' : 'generated'} orbital eccentricity (e = ${(e ?? ecc).toFixed(2)}): it peaks at each closest approach and fades toward the far point.`,
        startEcc: crowded ? 0 : Math.min(0.16, ecc * 0.3),
      };
    }
    case 'inclined': {
      const tilt = clamp(inc ?? 20, 12, 65);
      const node = rng.range(0, Math.PI * 2);
      for (const b of mechanics.belts) {
        b.inclination = tilt * DEG;
        b.node = node;
      }
      return {
        id,
        label: `INCLINED PLANE · ${Math.round(inc ?? tilt)}°${tag}`,
        note: `Orbiting debris is tilted ${Math.round(inc ?? tilt)}° to the ship's plane. It can only be hit where the two planes cross.`,
        startEcc: 0,
      };
    }
    case 'decaying':
      return { id, label: 'DECAYING ORBIT', note: 'Drag steadily removes orbital energy; height must be bought back with thrust.', startEcc: 0 };
    case 'multi-body':
      return { id, label: `MULTI-BODY SYSTEM · ${companions.length + 1} MASSES`, note: 'Several masses pull on the ship at once; the companions move on fixed Keplerian paths.', startEcc: 0 };
    case 'unstable': {
      // A captured moon on a stretched path that skims the outer edge of the band once per revolution.
      const apo = a.safeMax + 62;
      const peri = a.safeMax - 6;
      const sma = (apo + peri) / 2;
      companions.push(eccentricMoon(sma, a.mu, (apo - peri) / (apo + peri), rng.range(0, Math.PI * 2), rng.range(0, Math.PI * 2)));
      return { id, label: 'UNSTABLE ORBIT', note: 'A moon on an eccentric path skims the outer edge of the band once per revolution, tugging at everything nearby.', startEcc: 0 };
    }
    default:
      return { id: 'circular', label: 'CIRCULAR ORBIT', note: 'A near-circular reference orbit.', startEcc: 0 };
  }
}
