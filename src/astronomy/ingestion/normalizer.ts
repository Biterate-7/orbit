/**
 * Source-specific rows -> unified `AstroObject` records.
 *
 * Normalisation only converts units and labels. A value the source does not provide stays null.
 */
import type { ExoEuRow, ExoRow } from '../api/exoplanets';
import type { HorizonsBody } from '../api/horizons';
import type { SbdbRow } from '../api/jpl';
import type { NedObject } from '../api/ned';
import type { SimbadRow } from '../api/simbad';
import { EMPTY_CONTEXT, EMPTY_ORBITAL, EMPTY_PHYSICAL, num, slug } from '../database/schema';
import type { AstroCategory, AstroContext, AstroObject, OrbitalProperties, PhysicalProperties, SourceId } from '../database/schema';
import { derivedColors, luminosityClass, spectralClass, visualDescription } from '../database/visuals';

const G_KM = 6.6743e-20;
const EARTH_RADIUS_KM = 6371.0;
const EARTH_MASS_KG = 5.9722e24;
const JUPITER_RADIUS_KM = 71492;
const JUPITER_MASS_KG = 1.89813e27;
const LY_PER_PC = 3.26156;

const pos = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
};
const nonNeg = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && n >= 0 ? n : null;
};
const sig = (v: number | null, digits = 6): number | null => (v === null ? null : Number(v.toPrecision(digits)));

interface Draft {
  id: string;
  name: string;
  designation: string;
  category: AstroCategory;
  classification: string;
  physical?: Partial<PhysicalProperties>;
  orbital?: Partial<OrbitalProperties>;
  context?: Partial<AstroContext>;
  source: SourceId;
}

function build(d: Draft, now: string): AstroObject {
  const physical = { ...EMPTY_PHYSICAL, ...d.physical };
  const orbital = { ...EMPTY_ORBITAL, ...d.orbital };
  for (const k of Object.keys(physical) as (keyof PhysicalProperties)[]) physical[k] = sig(physical[k]);
  for (const k of Object.keys(orbital) as (keyof OrbitalProperties)[]) orbital[k] = sig(orbital[k]);
  const base = {
    category: d.category,
    classification: d.classification,
    physicalProperties: physical,
    context: { ...EMPTY_CONTEXT, ...d.context },
  };
  return {
    id: d.id,
    name: d.name.trim(),
    designation: d.designation.trim(),
    ...base,
    orbitalProperties: orbital,
    visualProperties: {
      imageUrl: null,
      imageSource: null,
      imageAttribution: null,
      dominantColors: derivedColors(base),
      colorSource: 'derived',
      visualDescription: visualDescription(base),
    },
    source: d.source,
    alsoIn: [],
    lastUpdated: now,
  };
}

// ------------------------------------------------------------------ JPL SBDB

const ORBIT_CLASS: Record<string, string> = {
  MBA: 'Main-belt asteroid',
  IMB: 'Inner main-belt asteroid',
  OMB: 'Outer main-belt asteroid',
  TJN: 'Jupiter trojan',
  CEN: 'Centaur',
  TNO: 'Trans-Neptunian object',
  AMO: 'Amor near-Earth asteroid',
  APO: 'Apollo near-Earth asteroid',
  ATE: 'Aten near-Earth asteroid',
  IEO: 'Atira near-Earth asteroid',
  MCA: 'Mars-crossing asteroid',
  AST: 'Asteroid',
  JFC: 'Jupiter-family comet',
  HTC: 'Halley-type comet',
  ETC: 'Encke-type comet',
  CTC: 'Chiron-type comet',
  COM: 'Comet',
  PAR: 'Parabolic comet',
  HYP: 'Hyperbolic comet',
};

/** Bodies the IAU recognises as dwarf planets (a classification, not a measurement). */
const IAU_DWARF_PLANETS = new Set(['ceres', 'pluto', 'eris', 'haumea', 'makemake']);

export function normalizeSmallBody(r: SbdbRow, now: string): AstroObject | null {
  const pdes = r.pdes === null ? '' : String(r.pdes).trim();
  if (!pdes) return null;
  const isComet = String(r.kind ?? '').startsWith('c');
  const rawName = r.name === null ? '' : String(r.name).trim();
  const fullName = String(r.full_name ?? '').trim();
  const cls = String(r.class ?? '').trim();
  let name: string;
  let designation: string;
  if (isComet) {
    designation = fullName || pdes;
    name = rawName || designation.replace(/^[^/]*\//, '') || pdes;
  } else {
    name = rawName || pdes;
    designation = rawName ? `${pdes} ${rawName}` : pdes;
  }
  const dwarf = !isComet && IAU_DWARF_PLANETS.has(name.toLowerCase());
  const diameter = pos(r.diameter);
  const gm = pos(r.GM);
  const taxonomy = (r.spec_B ?? r.spec_T) === null ? null : String(r.spec_B ?? r.spec_T).trim() || null;
  let classification = ORBIT_CLASS[cls.toUpperCase()] ?? (isComet ? 'Comet' : 'Asteroid');
  if (dwarf) classification = 'Dwarf planet';
  else if (r.pha === 'Y') classification += ' (potentially hazardous)';
  return build(
    {
      id: `sbdb:${slug(pdes)}`,
      name,
      designation,
      category: dwarf ? 'dwarf-planet' : isComet ? 'comet' : 'asteroid',
      classification,
      physical: {
        radius: diameter === null ? null : diameter / 2,
        mass: gm === null ? null : gm / G_KM,
        rotationPeriod: pos(r.rot_per),
      },
      orbital: {
        eccentricity: nonNeg(r.e),
        inclination: nonNeg(r.i),
        semiMajorAxis: num(r.a),
        orbitalPeriod: pos(r.per),
      },
      context: { objectType: cls || null, hostName: 'Sun', albedo: pos(r.albedo), taxonomy },
      source: 'JPL-SBDB',
    },
    now,
  );
}

// ------------------------------------------------------------------ JPL Horizons

const PLANET_CLASS: Record<string, string> = {
  '199': 'Terrestrial planet',
  '299': 'Terrestrial planet',
  '399': 'Terrestrial planet',
  '499': 'Terrestrial planet',
  '599': 'Gas giant',
  '699': 'Gas giant',
  '799': 'Ice giant',
  '899': 'Ice giant',
};

export function normalizeHorizons(b: HorizonsBody, now: string): AstroObject {
  const t = b.target;
  const parentId = t.kind === 'moon' ? `horizons:${t.center.split('@')[1]}` : null;
  let classification: string;
  let category: AstroCategory;
  if (t.kind === 'star') {
    category = 'star';
    classification = 'Main-sequence star';
  } else if (t.kind === 'moon') {
    category = 'moon';
    classification = `Natural satellite of ${t.parent}`;
  } else if (t.kind === 'dwarf-planet') {
    category = 'dwarf-planet';
    classification = 'Dwarf planet';
  } else {
    category = 'planet';
    classification = PLANET_CLASS[t.id] ?? 'Planet';
  }
  return build(
    {
      id: `horizons:${t.id}`,
      name: t.name,
      designation: t.kind === 'star' ? 'Sol' : `${t.name} (${t.id})`,
      category,
      classification,
      physical: {
        radius: b.physical.radiusKm,
        mass: b.physical.massKg,
        rotationPeriod: b.physical.rotationHours,
        temperature: b.physical.temperatureK,
        luminosity: b.physical.luminositySun,
      },
      orbital: b.elements
        ? { eccentricity: b.elements.e, inclination: b.elements.incDeg, semiMajorAxis: b.elements.aAu, orbitalPeriod: b.elements.periodDays }
        : {},
      context: {
        objectType: t.kind,
        hostName: t.kind === 'star' ? null : (t.parent ?? 'Sun'),
        parentId,
        distanceLy: t.kind === 'star' ? 0 : null,
        ephemeris: b.vector ? { epoch: b.epoch, center: t.center.split('@')[1], position: b.vector.position, velocity: b.vector.velocity } : null,
      },
      source: 'JPL-HORIZONS',
    },
    now,
  );
}

// ------------------------------------------------------------------ exoplanets

/**
 * Size classes follow the radius bins NASA uses in its public exoplanet catalogue
 * (terrestrial / super-Earth / Neptune-like / gas giant); mass is used when no radius is known.
 */
export function classifyPlanet(radiusEarth: number | null, massEarth: number | null, periodDays: number | null): string {
  let size: 'terrestrial' | 'super' | 'neptune' | 'giant';
  if (radiusEarth !== null) size = radiusEarth <= 1.25 ? 'terrestrial' : radiusEarth <= 2 ? 'super' : radiusEarth <= 6 ? 'neptune' : 'giant';
  else if (massEarth !== null) size = massEarth <= 2 ? 'terrestrial' : massEarth <= 10 ? 'super' : massEarth <= 50 ? 'neptune' : 'giant';
  else return 'Exoplanet';
  if (size === 'giant') return periodDays !== null && periodDays < 10 ? 'Hot Jupiter' : 'Gas giant exoplanet';
  if (size === 'neptune') return 'Neptune-like exoplanet';
  if (size === 'super') return 'Super-Earth';
  return 'Terrestrial exoplanet';
}

export function normalizeExoplanet(r: ExoRow, now: string): AstroObject | null {
  const name = r.pl_name === null ? '' : String(r.pl_name).trim();
  if (!name) return null;
  const rade = pos(r.pl_rade);
  const masse = pos(r.pl_bmasse);
  const per = pos(r.pl_orbper);
  const dist = pos(r.sy_dist);
  return build(
    {
      id: `exo:${slug(name)}`,
      name,
      designation: name,
      category: 'exoplanet',
      classification: classifyPlanet(rade, masse, per),
      physical: {
        radius: rade === null ? null : rade * EARTH_RADIUS_KM,
        mass: masse === null ? null : masse * EARTH_MASS_KG,
        temperature: pos(r.pl_eqt),
      },
      orbital: { eccentricity: nonNeg(r.pl_orbeccen), inclination: nonNeg(r.pl_orbincl), semiMajorAxis: pos(r.pl_orbsmax), orbitalPeriod: per },
      context: {
        objectType: r.discoverymethod === null ? null : String(r.discoverymethod),
        hostName: r.hostname === null ? null : String(r.hostname),
        spectralType: r.st_spectype === null ? null : String(r.st_spectype).trim() || null,
        hostTemperature: pos(r.st_teff),
        distanceLy: dist === null ? null : sig(dist * LY_PER_PC, 5),
        starsInSystem: pos(r.sy_snum),
        discoveryYear: pos(r.disc_year),
      },
      source: 'NASA-EXOPLANET-ARCHIVE',
    },
    now,
  );
}

export function normalizeExoplanetEu(r: ExoEuRow, now: string): AstroObject | null {
  const name = (r.name ?? '').trim();
  if (!name) return null;
  const rj = pos(r.radius);
  const mj = pos(r.mass);
  const per = pos(r.orbital_period);
  const dist = pos(r.star_distance);
  const inc = nonNeg(r.inclination);
  return build(
    {
      id: `exo:${slug(name)}`,
      name,
      designation: name,
      category: 'exoplanet',
      classification: classifyPlanet(
        rj === null ? null : (rj * JUPITER_RADIUS_KM) / EARTH_RADIUS_KM,
        mj === null ? null : (mj * JUPITER_MASS_KG) / EARTH_MASS_KG,
        per,
      ),
      physical: {
        radius: rj === null ? null : rj * JUPITER_RADIUS_KM,
        mass: mj === null ? null : mj * JUPITER_MASS_KG,
        temperature: pos(r.temp_measured) ?? pos(r.temp_calculated),
      },
      orbital: {
        eccentricity: nonNeg(r.eccentricity),
        inclination: inc !== null && inc <= 180 ? inc : null,
        semiMajorAxis: pos(r.semi_major_axis),
        orbitalPeriod: per,
      },
      context: {
        objectType: r.detection_type?.trim() || null,
        hostName: r.star_name?.trim() || null,
        spectralType: r.star_sp_type?.trim() || null,
        hostTemperature: pos(r.star_teff),
        distanceLy: dist === null ? null : sig(dist * LY_PER_PC, 5),
        discoveryYear: pos(r.discovered),
      },
      source: 'EXOPLANET-EU',
    },
    now,
  );
}

// ------------------------------------------------------------------ SIMBAD

const OTYPE: Record<string, { category: AstroCategory; label: string }> = {
  Psr: { category: 'stellar-remnant', label: 'Pulsar' },
  'N*': { category: 'stellar-remnant', label: 'Neutron star' },
  'WD*': { category: 'stellar-remnant', label: 'White dwarf' },
  BH: { category: 'stellar-remnant', label: 'Black hole' },
  HXB: { category: 'stellar-remnant', label: 'High-mass X-ray binary' },
  LXB: { category: 'stellar-remnant', label: 'Low-mass X-ray binary' },
  SNR: { category: 'nebula', label: 'Supernova remnant' },
  PN: { category: 'nebula', label: 'Planetary nebula' },
  HII: { category: 'nebula', label: 'HII region (emission nebula)' },
  RNe: { category: 'nebula', label: 'Reflection nebula' },
  DNe: { category: 'nebula', label: 'Dark nebula' },
  MoC: { category: 'nebula', label: 'Molecular cloud' },
  'cC*': { category: 'star', label: 'Classical Cepheid variable' },
  'Ce*': { category: 'star', label: 'Cepheid variable' },
  'Mi*': { category: 'star', label: 'Mira variable' },
  'RR*': { category: 'star', label: 'RR Lyrae variable' },
  'dS*': { category: 'star', label: 'Delta Scuti variable' },
  'LP*': { category: 'star', label: 'Long-period variable' },
  'WR*': { category: 'star', label: 'Wolf-Rayet star' },
  'No*': { category: 'star', label: 'Nova' },
  'EB*': { category: 'star', label: 'Eclipsing binary' },
  'SB*': { category: 'star', label: 'Spectroscopic binary' },
  '**': { category: 'star', label: 'Double or multiple star' },
  's*b': { category: 'star', label: 'Blue supergiant' },
  's*r': { category: 'star', label: 'Red supergiant' },
  'BD*': { category: 'star', label: 'Brown dwarf' },
  'TT*': { category: 'star', label: 'T Tauri star' },
  'Be*': { category: 'star', label: 'Be star' },
  'RG*': { category: 'star', label: 'Red giant branch star' },
  'AB*': { category: 'star', label: 'Asymptotic giant branch star' },
  'HB*': { category: 'star', label: 'Horizontal branch star' },
  'C*': { category: 'star', label: 'Carbon star' },
  'Er*': { category: 'star', label: 'Eruptive variable' },
  'BY*': { category: 'star', label: 'BY Draconis variable' },
  'RS*': { category: 'star', label: 'RS Canum Venaticorum variable' },
  'Pu*': { category: 'star', label: 'Pulsating variable' },
  'V*': { category: 'star', label: 'Variable star' },
  'bC*': { category: 'star', label: 'Beta Cephei variable' },
  'a2*': { category: 'star', label: 'Alpha2 CVn variable' },
  'El*': { category: 'star', label: 'Ellipsoidal variable' },
  'Y*O': { category: 'star', label: 'Young stellar object' },
  'Ae*': { category: 'star', label: 'Herbig Ae/Be star' },
  'HV*': { category: 'star', label: 'High-velocity star' },
  'PM*': { category: 'star', label: 'High proper-motion star' },
  'LM*': { category: 'star', label: 'Low-mass star' },
  'Em*': { category: 'star', label: 'Emission-line star' },
  'SX*': { category: 'star', label: 'SX Phoenicis variable' },
  'gD*': { category: 'star', label: 'Gamma Doradus variable' },
  'Ro*': { category: 'star', label: 'Rotating variable' },
  'WV*': { category: 'star', label: 'W Virginis variable' },
  'RV*': { category: 'star', label: 'RV Tauri variable' },
  'S*': { category: 'star', label: 'S-type star' },
  'sg*': { category: 'star', label: 'Evolved supergiant' },
  'pA*': { category: 'star', label: 'Post-AGB star' },
  'OH*': { category: 'star', label: 'OH/IR star' },
  'Sy*': { category: 'star', label: 'Symbiotic star' },
  'CV*': { category: 'star', label: 'Cataclysmic binary' },
  'XB*': { category: 'stellar-remnant', label: 'X-ray binary' },
  '*': { category: 'star', label: 'Star' },
};

const CLASS_NAME: Record<string, string> = { O: 'O-type', B: 'B-type', A: 'A-type', F: 'F-type', G: 'G-type', K: 'K-type', M: 'M-type' };
const LUM_NAME: Record<string, string> = { I: 'supergiant', II: 'bright giant', III: 'giant', IV: 'subgiant', V: 'main-sequence star' };

/** Human label for a star from its SIMBAD type and MK spectral type. */
export function describeStar(otype: string, sp: string | null): string {
  const known = OTYPE[otype];
  const generic = !known || ['*', 'PM*', 'LM*', 'Em*', 'V*', 'HV*', '**', 'SB*', 'Er*', 'BY*', 'Ro*', 'RS*'].includes(otype);
  const c = spectralClass(sp);
  const lum = luminosityClass(sp);
  let spectral: string | null = null;
  if (c === 'D') spectral = 'White dwarf';
  else if (c === 'W') spectral = 'Wolf-Rayet star';
  else if (c === 'L' || c === 'T' || c === 'Y') spectral = `${c}-type brown dwarf`;
  else if (c && CLASS_NAME[c]) {
    if (c === 'M' && (lum === 'V' || lum === null) && otype !== 's*r' && otype !== 'Mi*' && otype !== 'LP*' && otype !== 'AB*') {
      spectral = lum === 'V' ? 'Red dwarf' : 'M-type star';
    } else spectral = `${CLASS_NAME[c]} ${lum ? LUM_NAME[lum] : 'star'}`;
  }
  if (!known) return spectral ?? 'Star';
  if (generic) {
    if (!spectral) return known.label;
    // Lower-case the qualifier unless it starts with an acronym ("BY Draconis", "RS Canum Venaticorum").
    const qualifier = /^[A-Z]{2}/.test(known.label) ? known.label : `${known.label.charAt(0).toLowerCase()}${known.label.slice(1)}`;
    return otype === '*' || otype === 'PM*' || otype === 'LM*' ? spectral : `${spectral} (${qualifier})`;
  }
  return known.label;
}

const GREEK: Record<string, string> = {
  alf: 'Alpha',
  bet: 'Beta',
  gam: 'Gamma',
  del: 'Delta',
  eps: 'Epsilon',
  zet: 'Zeta',
  eta: 'Eta',
  tet: 'Theta',
  iot: 'Iota',
  kap: 'Kappa',
  lam: 'Lambda',
  mu: 'Mu',
  nu: 'Nu',
  ksi: 'Xi',
  omi: 'Omicron',
  pi: 'Pi',
  rho: 'Rho',
  sig: 'Sigma',
  tau: 'Tau',
  ups: 'Upsilon',
  phi: 'Phi',
  chi: 'Chi',
  psi: 'Psi',
  ome: 'Omega',
};

/** "* alf Ori" -> "Alpha Ori", "V* CM Tau" -> "CM Tau", "NAME Vela Pulsar" -> "Vela Pulsar". */
export function cleanSimbadId(id: string): string {
  let s = id.trim().replace(/^(NAME|V\*|\*\*|\*|EM\*|SV\*)\s+/, '').replace(/\s+/g, ' ');
  const m = /^([a-z]{2,3})(\d{0,2})\s+(.+)$/.exec(s);
  if (m && GREEK[m[1]]) s = `${GREEK[m[1]]}${m[2] ? ` ${Number(m[2])}` : ''} ${m[3]}`;
  return s;
}

/** Prefer a short proper name ("Betelgeuse") over catalogue-style aliases. */
export function pickCommonName(names: string[] | undefined, prefer?: RegExp): string | null {
  if (!names || names.length === 0) return null;
  if (prefer) {
    const typed = names.filter((n) => prefer.test(n) && n.length <= 30);
    if (typed.length) return typed.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }
  const good = names.filter((n) => n.length >= 3 && n.length <= 26 && !/\d{4,}/.test(n) && !/^(GAL|GRS|1E|2E|4U|3A|XTE|SWIFT|PSR|IGR|AX|RX)\b/i.test(n));
  if (good.length === 0) return null;
  return good.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

export function normalizeSimbad(r: SimbadRow, commonNames: string[] | undefined, teff: number | null, now: string): AstroObject | null {
  const mainId = (r.main_id ?? '').trim();
  if (!mainId) return null;
  const otype = (r.otype ?? '').trim();
  const sp = (r.sp_type ?? '').trim() || null;
  const info = OTYPE[otype];
  const designation = cleanSimbadId(mainId);
  const plx = pos(r.plx_value);
  // A white-dwarf spectral type outranks a generic object type.
  const isWd = spectralClass(sp) === 'D' && (!info || info.category === 'star');
  const category: AstroCategory = isWd ? 'stellar-remnant' : (info?.category ?? 'star');
  const classification = isWd ? 'White dwarf' : category === 'star' ? describeStar(otype, sp) : (info?.label ?? 'Star');
  // "Crab Nebula" reads better than the shortest alias "Crab"; likewise for pulsars.
  const prefer = category === 'nebula' ? /nebula|loop|remnant|cloud|pillars/i : category === 'stellar-remnant' ? /pulsar|star/i : undefined;
  const name = pickCommonName(commonNames, prefer) ?? designation;
  return build(
    {
      id: `simbad:${slug(mainId)}`,
      name,
      designation,
      category,
      classification,
      physical: { temperature: teff },
      context: {
        objectType: otype || null,
        spectralType: sp,
        // Distance from trigonometric parallax: d[pc] = 1000 / parallax[mas].
        distanceLy: plx === null ? null : sig((1000 / plx) * LY_PER_PC, 4),
        ra: num(r.ra),
        dec: num(r.dec),
        notability: pos(r.nbref),
      },
      source: 'SIMBAD',
    },
    now,
  );
}

// ------------------------------------------------------------------ NED

const NED_TYPE: Record<string, { category: AstroCategory; label: string }> = {
  G: { category: 'galaxy', label: 'Galaxy' },
  GPair: { category: 'galaxy', label: 'Galaxy pair' },
  GTrpl: { category: 'galaxy', label: 'Galaxy triple' },
  GGroup: { category: 'galaxy', label: 'Galaxy group' },
  GClstr: { category: 'galaxy', label: 'Galaxy cluster' },
  QSO: { category: 'quasar', label: 'Quasar' },
  QGroup: { category: 'quasar', label: 'Quasar group' },
  G_Lens: { category: 'quasar', label: 'Gravitationally lensed quasar' },
  Q_Lens: { category: 'quasar', label: 'Gravitationally lensed quasar' },
  RadioS: { category: 'quasar', label: 'Radio source' },
};

/** "MESSIER 087" -> "Messier 87", "NGC 1300" stays as is. */
export function prettyNedName(n: string): string {
  return n
    .replace(/\s+/g, ' ')
    .replace(/\b(MESSIER|Messier) 0*(\d+)/, 'Messier $2')
    .replace(/\b(NGC|IC|UGC) 0*(\d+)/, '$1 $2')
    .trim();
}

export function normalizeNed(o: NedObject, now: string): AstroObject | null {
  const info = o.objType ? NED_TYPE[o.objType] : undefined;
  if (!info) return null;
  const designation = prettyNedName(o.preferredName);
  // Keep a descriptive query name ("Cartwheel Galaxy") as the display name; catalogue ids use NED's.
  const friendly = /^(M|NGC|IC)\s*\d+$/i.test(o.queried) ? designation : o.queried;
  return build(
    {
      id: `ned:${slug(o.preferredName)}`,
      name: friendly,
      designation,
      category: info.category,
      classification: info.label,
      context: { objectType: o.objType, redshift: o.redshift, ra: o.ra, dec: o.dec },
      source: 'NED',
    },
    now,
  );
}
