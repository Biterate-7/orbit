/**
 * NASA Image and Video Library search.
 * Docs: https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf
 *
 * An image is only attached to a catalogue object when its own metadata says it depicts that
 * object (see `matchImage`). When nothing matches the object keeps `imageUrl: null` and the game
 * falls back to a procedural rendering.
 */
import type { AstroCategory } from '../database/schema';
import type { HttpClient } from './http';

const SEARCH = 'https://images-api.nasa.gov/search';

export interface NasaImage {
  nasaId: string;
  title: string;
  description: string;
  keywords: string[];
  center: string | null;
  credit: string | null;
  thumbUrl: string;
  dateCreated: string | null;
}

interface SearchResponse {
  collection?: {
    items?: {
      data?: {
        nasa_id?: string;
        title?: string;
        description?: string;
        keywords?: string[];
        center?: string;
        secondary_creator?: string;
        photographer?: string;
        media_type?: string;
        date_created?: string;
      }[];
      links?: { href?: string; rel?: string; render?: string }[];
    }[];
  };
}

export async function searchImages(http: HttpClient, query: string, pageSize = 20): Promise<NasaImage[]> {
  const url = `${SEARCH}?q=${encodeURIComponent(query)}&media_type=image&page_size=${pageSize}`;
  const res = await http.json<SearchResponse>(url);
  const out: NasaImage[] = [];
  for (const it of res.collection?.items ?? []) {
    const d = it.data?.[0];
    const thumb = it.links?.find((l) => l.rel === 'preview' && l.href)?.href;
    if (!d?.nasa_id || !d.title || !thumb || d.media_type !== 'image') continue;
    out.push({
      nasaId: d.nasa_id,
      title: d.title,
      description: d.description ?? '',
      keywords: (d.keywords ?? []).flatMap((k) => k.split(/[,;]/)).map((k) => k.trim()).filter(Boolean),
      center: d.center ?? null,
      credit: d.secondary_creator?.replace(/\s+/g, ' ').trim() || d.photographer?.trim() || null,
      thumbUrl: thumb.replace(/^http:/, 'https:'),
      dateCreated: d.date_created ?? null,
    });
  }
  return out;
}

/** Words that must appear alongside the name for the image to count as depicting that kind of object. */
const CATEGORY_TERMS: Record<AstroCategory, RegExp | null> = {
  star: /\b(star|supergiant|giant|dwarf|stellar|binary|sun|solar)\b/i,
  planet: null,
  moon: null,
  'dwarf-planet': null,
  asteroid: /\b(asteroid|minor planet|near-earth object|dwarf planet|protoplanet)\b/i,
  comet: /\bcomet\b/i,
  exoplanet: /\b(exoplanet|planet|planetary system)\b/i,
  'stellar-remnant': /\b(pulsar|neutron star|white dwarf|black hole|magnetar|supernova|remnant|x-ray binary)\b/i,
  nebula: /\b(nebula|nebulae|remnant|cloud|star-forming|supernova)\b/i,
  galaxy: /\b(galaxy|galaxies|galactic|spiral|elliptical)\b/i,
  quasar: /\b(quasar|blazar|active galax|galaxy|black hole|jet)\b/i,
};

/** Things that share names with celestial objects (rockets, probes, artwork, events) or are not pictures of them. */
const REJECT =
  /\b(rocket|launch|liftoff|lift-off|booster|assembly|clean ?room|artist|artists|illustration|concept|rendering|animation|gif|logo|patch|poster|astronaut|crew|ceremony|celebration|briefing|press|model|mockup|simulat\w*|diagram|chart|graph|spectrum|spectra|infographic|mission control|technician|engineer|team|sample|vial|capsule|integration|magnetometer|instrument|telescope|aircraft|fuselage|antenna|lander|rover|hardware|testing|facility|laboratory|magnetic field|map|maps|globe|temperature|warmth|trajectory|flyby plan|visitors?|students?|orbit of|journey|3-d|3d|stereo|anaglyph|drenched|tale of)\b/i;
const RESTRICTED = /(©|\(c\)|copyright|all rights reserved|used with permission|courtesy of)/i;
/** NASA centres whose library entries are science imagery rather than event / launch photography. */
const SCIENCE_CENTERS = new Set(['JPL', 'GSFC', 'ARC', 'MSFC']);

/**
 * Library entries that pass the automatic rules but were found, on manual review of an ingestion
 * run, to show something else (a different object that shares the name).
 */
const REVIEWED_MISMATCHES = new Set([
  'GSFC_20171208_Archive_e002088', // "Cen A Optical Capella" - Centaurus A, not the star Capella
  'PIA23867', // "The Blue Ring Nebula" - a different object from the Ring Nebula (M57)
  'PIA19379', // "Asteroid Lithograph of Eros and Other Asteroids" - a printed montage, not Eros alone
  'PIA25329', // "NASA's DART at the Didymos System" - mission graphic
]);

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = (name: string): RegExp => new RegExp(`(^|[^a-z0-9])${esc(name.toLowerCase())}($|[^a-z0-9])`, 'i');

/**
 * Pick the search result that verifiably depicts the object, or null.
 *
 * Rules (all must hold):
 *  - the image comes from a science centre and its metadata does not look like a rocket, an
 *    event, a piece of hardware, a map or an illustration, and carries no third-party copyright;
 *  - the object's name appears as a whole word in the image title;
 *  - for planets and moons the name is also an exact keyword; for everything else a
 *    category-specific term (e.g. "comet", "nebula") appears in the title, keywords or the
 *    opening of the caption.
 * Among the results that pass, the one whose title is closest to just the object's name wins.
 */
export function matchImage(names: string[], category: AstroCategory, items: NasaImage[]): NasaImage | null {
  const term = CATEGORY_TERMS[category];
  let best: NasaImage | null = null;
  let bestScore = -Infinity;
  for (const img of items) {
    if (!img.center || !SCIENCE_CENTERS.has(img.center) || REVIEWED_MISMATCHES.has(img.nasaId)) continue;
    const head = `${img.title} ${img.keywords.join(' ')}`;
    if (REJECT.test(head) || RESTRICTED.test(`${img.description} ${img.credit ?? ''}`)) continue;
    for (const name of names) {
      if (name.length < 2 || !word(name).test(img.title)) continue;
      if (term) {
        if (!term.test(`${head} ${img.description.slice(0, 300)}`)) continue;
      } else if (!img.keywords.some((k) => k.toLowerCase() === name.toLowerCase())) continue;
      const title = img.title.trim().toLowerCase();
      const score = (title === name.toLowerCase() ? 100 : 0) + (title.startsWith(name.toLowerCase()) ? 15 : 0) + (term && term.test(img.title) ? 20 : 0) - title.length * 0.4;
      if (score > bestScore) {
        bestScore = score;
        best = img;
      }
    }
  }
  return best;
}

/** Credit line shown next to the image in the game. */
export function attribution(img: NasaImage): string {
  const who = img.credit ?? (img.center ? `NASA/${img.center}` : 'NASA');
  return /nasa/i.test(who) ? who : `NASA / ${who}`;
}
