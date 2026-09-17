/**
 * Free geocoding via OpenStreetMap Nominatim.
 * Usage policy: max 1 request/second → callers must throttle (see geocodeSequential).
 * Failures never block anything: we simply return null and the manager can fix coordinates manually.
 */
export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(query: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=il&accept-language=he&q=' +
    encodeURIComponent(query);
  try {
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;
    const latitude = Number(data[0].lat);
    const longitude = Number(data[0].lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geocodeSequential<T>(
  items: T[],
  toQuery: (item: T) => string,
  onResult: (item: T, result: GeocodeResult | null, index: number) => Promise<void> | void,
  signal?: AbortSignal,
): Promise<void> {
  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) return;
    const result = await geocodeAddress(toQuery(items[i]), signal);
    await onResult(items[i], result, i);
    if (i < items.length - 1) await sleep(1100);
  }
}
