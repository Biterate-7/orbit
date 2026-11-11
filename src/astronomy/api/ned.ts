/**
 * NASA/IPAC Extragalactic Database - object lookup service.
 * Docs: https://ned.ipac.caltech.edu/Documents/Guides/Interface/ObjectLookup
 */
import type { HttpClient } from './http';

const LOOKUP = 'https://ned.ipac.caltech.edu/srs/ObjectLookup';

export interface NedObject {
  /** The name the lookup was made with (kept as the friendly display name). */
  queried: string;
  preferredName: string;
  ra: number | null;
  dec: number | null;
  objType: string | null;
  redshift: number | null;
}

interface NedResponse {
  ResultCode?: number;
  Preferred?: {
    Name?: string;
    Position?: { RA?: number; Dec?: number };
    ObjType?: { Value?: string | null };
    Redshift?: { Value?: number | null };
  };
}

/** Resolve one object name. Returns null when NED does not know the name. */
export async function lookupObject(http: HttpClient, name: string): Promise<NedObject | null> {
  const url = `${LOOKUP}?name=${encodeURIComponent(name)}&aliases=false`;
  const res = await http.json<NedResponse>(url);
  const p = res.Preferred;
  // ResultCode 3 = unique object found.
  if (res.ResultCode !== 3 || !p?.Name) return null;
  return {
    queried: name,
    preferredName: p.Name,
    ra: typeof p.Position?.RA === 'number' ? p.Position.RA : null,
    dec: typeof p.Position?.Dec === 'number' ? p.Position.Dec : null,
    objType: p.ObjType?.Value ?? null,
    redshift: typeof p.Redshift?.Value === 'number' ? p.Redshift.Value : null,
  };
}

/**
 * Names resolved against NED. These are only lookup keys - every stored value
 * (type, position, redshift) comes from NED's answer.
 */
export const NED_TARGETS: string[] = [
  ...[31, 32, 33, 49, 51, 58, 59, 60, 61, 63, 64, 65, 66, 74, 77, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 94, 95, 96, 98, 99, 100, 101, 104, 105, 106, 108, 109, 110].map(
    (n) => `M${n}`,
  ),
  ...[55, 247, 253, 300, 891, 1068, 1097, 1232, 1275, 1300, 1316, 1365, 2403, 2841, 2903, 3115, 3628, 4038, 4039, 4449, 4565, 4631, 4993, 5128, 5195, 5866, 6240, 6822, 6946, 7331, 7742].map(
    (n) => `NGC ${n}`,
  ),
  'IC 10',
  'IC 342',
  'IC 1101',
  'IC 1613',
  'Large Magellanic Cloud',
  'Small Magellanic Cloud',
  'Fornax Dwarf Spheroidal',
  'Sculptor Dwarf Galaxy',
  'Leo I',
  'Cartwheel Galaxy',
  "Hoag's Object",
  'Arp 220',
  'Cygnus A',
  'Hercules A',
  'Markarian 421',
  'Markarian 501',
  'Markarian 231',
  'BL Lacertae',
  'OJ 287',
  '3C 273',
  '3C 279',
  '3C 48',
  '3C 345',
  '3C 454.3',
  '3C 120',
  'PKS 2155-304',
  'PKS 1830-211',
  'TON 618',
  'S5 0014+81',
  'APM 08279+5255',
  'ULAS J1120+0641',
  'ULAS J1342+0928',
  'SDSS J010013.02+280225.8',
  'QSO B0957+561',
  'QSO B2237+0305',
  'H1413+117',
  'GN-z11',
];
