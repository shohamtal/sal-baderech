/**
 * Free geocoding via OpenStreetMap Nominatim.
 *
 * Usage policy: at most 1 request/second, which geocodeRun enforces between
 * calls. Failures never block anything: the delivery stays usable and the
 * manager can fill coordinates in by hand.
 *
 * Deliberately does NOT send the neighbourhood. Recipient lists use local
 * names that differ from OSM's (a list saying "חורש" against OSM's "החורש"),
 * and the mismatch turns a working lookup into no result at all.
 */
export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** 'house' pinpoints the building; 'street' is the street centroid. */
  precision: 'house' | 'street';
}

export interface GeocodeTarget {
  street: string;
  house_number: string;
  city: string | null;
}

async function query(q: string, signal?: AbortSignal): Promise<{ lat: number; lon: number } | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=il&accept-language=he&q=' +
    encodeURIComponent(q);
  try {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    const lat = Number(data[0].lat);
    const lon = Number(data[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

export function buildQueries(t: GeocodeTarget, fallbackCity: string | null): string[] {
  const city = (t.city ?? fallbackCity ?? '').trim();
  const street = (t.street ?? '').trim();
  const house = (t.house_number ?? '').trim();
  if (!street) return [];
  const withCity = (s: string) => (city ? `${s}, ${city}` : s);
  const out: string[] = [];
  if (house) out.push(withCity(`${street} ${house}`));
  out.push(withCity(street)); // street centroid: better than leaving it unmapped
  return out;
}

/** Try the building first, then fall back to the street centroid. */
export async function geocodeDelivery(
  t: GeocodeTarget,
  fallbackCity: string | null,
  signal?: AbortSignal,
): Promise<GeocodeResult | null> {
  const queries = buildQueries(t, fallbackCity);
  for (let i = 0; i < queries.length; i++) {
    if (signal?.aborted) return null;
    const r = await query(queries[i], signal);
    if (r) {
      const precision: 'house' | 'street' = i === 0 && (t.house_number ?? '').trim() ? 'house' : 'street';
      return { latitude: r.lat, longitude: r.lon, precision };
    }
    // Stay within the usage policy between the building and street attempts.
    if (i < queries.length - 1) await new Promise((r) => setTimeout(r, 1100));
  }
  return null;
}
