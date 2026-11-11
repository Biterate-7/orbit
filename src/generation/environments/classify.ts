/**
 * Maps every catalogue object to the one environment it hosts.
 *
 * The thresholds are deliberately simple and documented here. They decide which *gameplay*
 * environment represents an object - they are not scientific claims. In particular, "ocean",
 * "desert" and "tidally locked" for exoplanets are interpretations of equilibrium temperature and
 * orbital period, and the game labels them as such.
 *
 *   rocky exoplanets (terrestrial / super-Earth size class)
 *     T_eq >= 1100 K                  lava world
 *     period < 12 d                   tidally locked (tidal locking is expected for such close orbits)
 *     T_eq unknown                    super-Earth / rocky by size class
 *     T_eq < 200 K                    ice world
 *     200-320 K                       temperate, modelled as an ocean world
 *     > 320 K                         desert world
 */
import type { AstroObject } from '../../astronomy/database/schema';
import { luminosityClass, spectralClass } from '../../astronomy/database/visuals';
import type { EnvId } from './common';

const PLANETS: Record<string, EnvId> = {
  mercury: 'rocky',
  venus: 'desert',
  earth: 'ocean',
  mars: 'desert',
  jupiter: 'gas_giant',
  saturn: 'ringed',
  uranus: 'ringed',
  neptune: 'gas_giant',
};

const ROCKY_MOONS = new Set(['moon', 'phobos', 'deimos']);
const PULSATING = new Set(['cC*', 'Ce*', 'Mi*', 'RR*', 'dS*', 'LP*', 'WV*', 'RV*', 'Pu*', 'bC*', 'SX*', 'gD*']);
const BINARY = new Set(['SB*', 'EB*', '**', 'El*', 'RS*', 'Sy*']);

function classifyExoplanet(o: AstroObject): EnvId | null {
  const cls = o.classification;
  const t = o.physicalProperties.temperature;
  const period = o.orbitalProperties.orbitalPeriod;
  if (cls === 'Hot Jupiter' || cls === 'Gas giant exoplanet') return 'gas_giant';
  if (cls === 'Neptune-like exoplanet') {
    const r = o.physicalProperties.radius;
    return r === null || r > 3.2 * 6371 ? 'gas_giant' : 'super_earth';
  }
  if (cls !== 'Super-Earth' && cls !== 'Terrestrial exoplanet') return null;
  if (t !== null && t >= 1100) return 'lava';
  if (period !== null && period < 12) return 'tidally_locked';
  if (t === null) return cls === 'Super-Earth' ? 'super_earth' : 'rocky';
  if (t < 200) return 'ice';
  if (t <= 320) return 'ocean';
  return 'desert';
}

function classifyStar(o: AstroObject): EnvId {
  const otype = o.context.objectType ?? '';
  const sp = o.context.spectralType;
  const c = spectralClass(sp);
  const lum = luminosityClass(sp);
  // A "+" joins components only when a spectral class follows it ("G2V+K1V"); in "K5+III" it is a qualifier.
  const plus = sp ? (sp.match(/\+\s*(?:sd|d)?[OBAFGKMDW]/g) ?? []).length : 0;
  if (PULSATING.has(otype)) return 'variable_star';
  // Only a spectral type listing three components verifies a triple. The current sources record
  // binarity but not multiplicity, so in practice this environment is generated procedurally.
  if (plus >= 2) return 'multiple_star';
  if (BINARY.has(otype) || plus === 1) return 'binary';
  if (otype === 'No*' || otype === 'CV*') return 'white_dwarf';
  if (otype === 'BD*' || c === 'L' || c === 'T' || c === 'Y') return 'rogue';
  const evolved = lum === 'I' || lum === 'II' || lum === 'III';
  if (c === 'W' || c === 'O' || c === 'B' || otype === 's*b' || otype === 'WR*' || (c === 'A' && evolved)) return 'blue_giant';
  if (otype === 's*r' || otype === 'RG*' || otype === 'AB*' || otype === 'C*' || c === 'C' || c === 'S' || c === 'N') return 'red_giant';
  if ((c === 'K' || c === 'M' || c === 'G') && evolved) return 'red_giant';
  if (c === 'M') return 'red_dwarf';
  return 'sunlike';
}

export function primaryEnvironment(o: AstroObject): EnvId | null {
  const cls = o.classification.toLowerCase();
  switch (o.category) {
    case 'planet':
      return PLANETS[o.name.toLowerCase()] ?? 'rocky';
    case 'moon': {
      const n = o.name.toLowerCase();
      if (n === 'io') return 'lava';
      return ROCKY_MOONS.has(n) ? 'rocky' : 'ice';
    }
    case 'dwarf-planet':
      return o.name.toLowerCase() === 'ceres' ? 'asteroid_field' : 'ice';
    case 'asteroid': {
      const t = (o.context.objectType ?? '').toUpperCase();
      return t === 'TNO' || t === 'CEN' ? 'comet_region' : 'asteroid_field';
    }
    case 'comet':
      return 'comet_region';
    case 'exoplanet':
      return classifyExoplanet(o);
    case 'star':
      return classifyStar(o);
    case 'stellar-remnant':
      if (cls.includes('pulsar')) return 'pulsar';
      if (cls.includes('neutron')) return 'neutron_star';
      if (cls.includes('white dwarf')) return 'white_dwarf';
      if (cls.includes('x-ray binary')) return 'xray_binary';
      return 'black_hole';
    case 'nebula':
      return cls.includes('supernova') ? 'supernova_remnant' : 'nebula';
    case 'galaxy':
      return 'galactic_core';
    case 'quasar':
      return 'quasar';
  }
}
