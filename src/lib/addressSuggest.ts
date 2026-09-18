/**
 * Suggestions for addresses that could not be geocoded.
 *
 * Recipient lists are typed by hand and contain small errors that make a
 * geocoder return nothing at all: a transposed pair (נריקס for נרקיס), a
 * dropped prefix (קהילה for הקהילה), a single wrong letter (אחרות for אחדות).
 *
 * Nothing here ever edits a delivery. It only proposes candidates for a manager
 * to approve, because silently rewriting a recipient's street would send a
 * volunteer to the wrong building with nobody noticing.
 *
 * Photon is a typo-tolerant geocoder over the same OpenStreetMap data, free and
 * CORS-enabled. (Overpass would give a fuller street list but rate-limits hard,
 * returning 406 under light use, so it is not dependable here.)
 *
 * Two things about Photon that are easy to get wrong:
 *  - It picks its output language from Accept-Language. A browser asking for
 *    English gets "Harish"/"Achdut" where Node with no header gets
 *    "חריש"/"אחדות", so the header must be set explicitly.
 *  - Filtering candidates by comparing city NAMES therefore breaks the moment
 *    the transliteration changes. Candidates are filtered by distance instead,
 *    which no translation can affect.
 */

const PHOTON_URL = 'https://photon.komoot.io/api/';

/** Candidates further than this from the campaign are never useful. */
const DEFAULT_MAX_KM = 25;

export interface GeoPoint { latitude: number; longitude: number }

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

const HEBREW_STREET_PREFIX = /^(רחוב|רח'|רח׳|רח|שדרות|שד'|שד׳|שד|סמטת|סמ'|דרך)\s+/;

/** Normalise for comparison only; the original spelling is kept for display. */
export function normalizeStreetName(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/["'״׳`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(HEBREW_STREET_PREFIX, '')
    .trim()
    .toLowerCase();
}

/**
 * Damerau-Levenshtein distance (optimal string alignment).
 * Plain Levenshtein charges 2 for a transposition, which would miss the single
 * most common typing error, so adjacent swaps must cost 1 here.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i][0] = i;
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost); // transposition
      }
    }
  }
  return d[a.length][b.length];
}

/** Edit budget by name length. Short names get one edit; long names get two. */
export function distanceBudget(name: string): number {
  const n = normalizeStreetName(name).length;
  if (n <= 3) return 0;
  if (n <= 6) return 1;
  return 2;
}

export interface StreetMatch {
  /** The gazetteer spelling. */
  name: string;
  distance: number;
  exact: boolean;
}

/**
 * Closest street in `streets`, or null when nothing is close enough or the best
 * candidate is not a clear winner.
 */
export function bestStreetMatch(raw: string, streets: string[]): StreetMatch | null {
  const target = normalizeStreetName(raw);
  if (!target) return null;

  let best: { name: string; distance: number } | null = null;
  let runnerUp = Infinity;
  for (const s of streets) {
    const d = editDistance(target, normalizeStreetName(s));
    if (d === 0) return { name: s, distance: 0, exact: true };
    if (!best || d < best.distance) {
      if (best) runnerUp = best.distance;
      best = { name: s, distance: d };
    } else if (d < runnerUp) {
      runnerUp = d;
    }
  }
  if (!best) return null;
  if (best.distance > distanceBudget(raw)) return null;
  // Ambiguous: two different streets are equally close. Do not guess.
  if (runnerUp === best.distance) return null;
  return { ...best, exact: false };
}

export interface AddressSuggestion {
  /** Proposed street spelling. */
  street: string;
  houseNumber: string | null;
  latitude: number;
  longitude: number;
  /** Edit distance from the street as written in the file. */
  distance: number;
  label: string;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string; street?: string; housenumber?: string;
    city?: string; district?: string; state?: string;
  };
}

export interface RankOptions {
  /** Preferred filter: keep candidates near the campaign. Language independent. */
  reference?: GeoPoint | null;
  maxKm?: number;
  /** Used only when no reference point is known yet. */
  city?: string | null;
  max?: number;
}

/** Shape the UI needs, separated from the network call so it can be tested. */
export function rankSuggestions(
  features: PhotonFeature[],
  street: string,
  opts: RankOptions = {},
): AddressSuggestion[] {
  const { reference = null, maxKm = DEFAULT_MAX_KM, city = null, max = 3 } = opts;
  const cityName = (city ?? '').trim();
  const target = normalizeStreetName(street);
  const seen = new Set<string>();
  const out: AddressSuggestion[] = [];

  for (const f of features) {
    const p = f.properties ?? {};
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;

    // Keep candidates near the campaign. A same-named street in another town is
    // never a useful suggestion. Distance first, because it survives translation.
    if (reference) {
      if (haversineKm(reference.latitude, reference.longitude, coords[1], coords[0]) > maxKm) continue;
    } else if (cityName) {
      const where = `${p.city ?? ''} ${p.district ?? ''} ${p.state ?? ''}`;
      if (!where.includes(cityName)) continue;
    }
    const name = (p.street || p.name || '').trim();
    if (!name) continue;
    const key = normalizeStreetName(name);
    if (!key || key === target) continue; // identical to what already failed
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      street: name,
      houseNumber: p.housenumber ?? null,
      latitude: coords[1],
      longitude: coords[0],
      distance: editDistance(target, key),
      label: [name, p.housenumber, p.district || p.city].filter(Boolean).join(' '),
    });
  }
  return out.sort((a, b) => a.distance - b.distance || a.street.localeCompare(b.street)).slice(0, max);
}

/** Candidate corrections for one unresolvable address, closest spelling first. */
export async function fetchAddressSuggestions(
  street: string,
  houseNumber: string,
  city: string | null,
  reference?: GeoPoint | null,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  if (!street.trim()) return [];
  const q = [street, houseNumber, (city ?? '').trim()].filter(Boolean).join(' ');
  const url = `${PHOTON_URL}?limit=15&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      signal,
      // Without this the browser's own Accept-Language wins and names come back
      // transliterated, which would not match the Hebrew in the recipient list.
      headers: { Accept: 'application/json', 'Accept-Language': 'he' },
    });
    if (!res.ok) return [];
    const features = ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
    return rankSuggestions(features, street, { reference, city });
  } catch {
    return [];
  }
}
