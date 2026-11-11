/**
 * Compact on-disk form of the catalogue.
 *
 * The bundled file omits everything that is null or can be recomputed (derived colours and the
 * visual description), which shrinks it to roughly a quarter. `unpackCatalogue` restores the full
 * `AstroObject` schema, so the rest of the code never sees the packed form.
 */
import { EMPTY_CONTEXT, EMPTY_ORBITAL, EMPTY_PHYSICAL } from './schema';
import type { AstroCategory, AstroContext, AstroObject, CatalogueFile, OrbitalProperties, PhysicalProperties, SourceId } from './schema';
import { derivedColors, visualDescription } from './visuals';

interface PackedObject {
  id: string;
  n: string;
  d?: string;
  k: AstroCategory;
  cl: string;
  p?: Partial<PhysicalProperties>;
  o?: Partial<OrbitalProperties>;
  c?: Partial<AstroContext>;
  img?: [url: string, source: string, attribution: string];
  col?: string[];
  s: SourceId;
  a?: SourceId[];
  t?: string;
}

export interface PackedCatalogue {
  version: number;
  generatedAt: string;
  sources: CatalogueFile['sources'];
  packed: PackedObject[];
}

function dropNulls<T extends object>(obj: T): Partial<T> | undefined {
  const out: Partial<T> = {};
  let any = false;
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== null && obj[k] !== undefined) {
      out[k] = obj[k];
      any = true;
    }
  }
  return any ? out : undefined;
}

export function packCatalogue(file: CatalogueFile): PackedCatalogue {
  return {
    version: file.version,
    generatedAt: file.generatedAt,
    sources: file.sources,
    packed: file.objects.map((o) => {
      const v = o.visualProperties;
      const p: PackedObject = { id: o.id, n: o.name, k: o.category, cl: o.classification, s: o.source };
      if (o.designation !== o.name) p.d = o.designation;
      const phys = dropNulls(o.physicalProperties);
      const orb = dropNulls(o.orbitalProperties);
      const ctx = dropNulls(o.context);
      if (phys) p.p = phys;
      if (orb) p.o = orb;
      if (ctx) p.c = ctx;
      if (v.imageUrl && v.imageSource && v.imageAttribution) p.img = [v.imageUrl, v.imageSource, v.imageAttribution];
      if (v.colorSource === 'image') p.col = v.dominantColors;
      if (o.alsoIn.length) p.a = o.alsoIn;
      if (o.lastUpdated !== file.generatedAt) p.t = o.lastUpdated;
      return p;
    }),
  };
}

export function unpackCatalogue(raw: PackedCatalogue | CatalogueFile): CatalogueFile {
  if ('objects' in raw) return raw;
  const objects: AstroObject[] = raw.packed.map((p) => {
    const base = {
      category: p.k,
      classification: p.cl,
      physicalProperties: { ...EMPTY_PHYSICAL, ...p.p },
      context: { ...EMPTY_CONTEXT, ...p.c },
    };
    return {
      id: p.id,
      name: p.n,
      designation: p.d ?? p.n,
      ...base,
      orbitalProperties: { ...EMPTY_ORBITAL, ...p.o },
      visualProperties: {
        imageUrl: p.img?.[0] ?? null,
        imageSource: p.img?.[1] ?? null,
        imageAttribution: p.img?.[2] ?? null,
        dominantColors: p.col ?? derivedColors(base),
        colorSource: p.col ? 'image' : 'derived',
        visualDescription: visualDescription(base),
      },
      source: p.s,
      alsoIn: p.a ?? [],
      lastUpdated: p.t ?? raw.generatedAt,
    };
  });
  return { version: raw.version, generatedAt: raw.generatedAt, sources: raw.sources, objects };
}
