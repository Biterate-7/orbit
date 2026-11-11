/**
 * Turns an environment blueprint into the level's visual identity: colour theme and the static
 * composition behind the playfield. Every level gets its own star field, nebula tints and
 * (for planets) host-star placement, all derived from the seed and the object's catalogue colours.
 */
import type { Catalogue } from '../astronomy/database/catalogue';
import type { AstroObject } from '../astronomy/database/schema';
import { mixHex, shade } from '../astronomy/database/visuals';
import type { BackgroundSpec, BackdropStar, LevelTheme } from '../game/types';
import { rampFrom } from './environments/common';
import type { EnvBlueprint } from './environments/common';
import { hash32, subRng } from './seed';

const BASE_BG = '#04050c';
const STAR_TINTS = ['#e8f0ff', '#e8f0ff', '#e8f0ff', '#bfd0ff', '#9fb4ff', '#7ffcff', '#c9a8ff', '#ffd8a8'];
const DEFAULT_ROCK = ['#1d1630', '#3a2f52', '#5f5478', '#8b81a3', '#c0b7d4'];

export function composeScene(bp: EnvBlueprint, object: AstroObject | null, seed: number, catalogue: Catalogue): { theme: LevelTheme; background: BackgroundSpec } {
  const rng = subRng(seed, 'scene');
  const [nebA, nebB, strength] = bp.nebula;
  // A small seeded drift keeps two levels of the same environment from sharing an exact sky.
  const drift = rng.range(-0.18, 0.18);
  const nebulaA = drift >= 0 ? mixHex(nebA, nebB, drift) : mixHex(nebA, '#1d2a6b', -drift);
  const nebulaB = mixHex(nebB, nebA, rng.range(0, 0.25));
  const theme: LevelTheme = {
    bg: mixHex(BASE_BG, nebulaA, 0.1),
    nebulaA,
    nebulaB,
    nebulaStrength: strength * rng.range(0.85, 1.1),
    accent: bp.accent,
    ripple: bp.ripple,
  };

  // Host stars sit on the lit side of the planet (the renderer lights bodies from the upper left).
  const hostStars: BackdropStar[] = bp.hostStarColors.map((color, i) => ({
    x: 0.1 + rng.range(0, 0.08) + i * 0.07,
    y: 0.12 + rng.range(0, 0.08) + i * 0.05,
    color,
    size: i === 0 ? rng.range(5, 8) : rng.range(3, 5),
  }));

  // Asteroid palette: the object's own taxonomy colours when it is a small body, otherwise neutral rock.
  const smallBody = object && (object.category === 'asteroid' || object.category === 'dwarf-planet');
  const rockRamp = smallBody ? rampFrom(object.visualProperties.dominantColors, 5) : DEFAULT_ROCK;

  // Starlight is tinted toward the scene: warm near red stars, cold in deep space.
  const starColors = STAR_TINTS.map((c, i) => (i % 3 === 0 ? mixHex(c, shade(bp.accent, 1.2), 0.25) : c));

  const useSprite = object !== null && catalogue.sprite(object.id) !== null && (object.category === 'nebula' || object.category === 'galaxy' || object.category === 'quasar');

  return {
    theme,
    background: {
      starSeed: hash32(seed, 0x57a125),
      starDensity: bp.starDensity * rng.range(0.85, 1.15),
      starColors,
      hostStars,
      galaxies: bp.galaxies,
      band: bp.band,
      spriteId: useSprite ? object.id : null,
      fogColor: bp.fogColor,
      rockRamp,
    },
  };
}
