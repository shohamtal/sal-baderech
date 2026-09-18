import { fetchAddressSuggestions, type AddressSuggestion, type GeoPoint } from './addressSuggest';
import { geocodeDelivery } from './geocode';
import { supabase } from './supabase';

/**
 * Fill in coordinates for a campaign's deliveries.
 *
 * Runs automatically after an import and on demand from the deliveries screen,
 * so a freshly imported list is usable without anyone having to know that
 * geocoding exists.
 *
 * This never changes an address. When a lookup fails it collects candidate
 * corrections for a manager to approve, because silently rewriting a street
 * would send a volunteer to the wrong building with nobody noticing.
 */

export interface GeocodeCandidate {
  id: string;
  street: string;
  house_number: string;
  city: string | null;
}

export interface UnresolvedAddress {
  id: string;
  street: string;
  house_number: string;
  city: string | null;
  suggestions: AddressSuggestion[];
}

export interface GeocodeProgress {
  done: number;
  total: number;
  /** Pinpointed to the building. */
  house: number;
  /** Placed on the street. */
  street: number;
  failed: number;
  unresolved: UnresolvedAddress[];
}

const NOMINATIM_MIN_INTERVAL_MS = 1100; // usage policy: at most 1 request/second
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function emptyProgress(total: number): GeocodeProgress {
  return { done: 0, total, house: 0, street: 0, failed: 0, unresolved: [] };
}

export async function geocodeDeliveries(
  deliveries: GeocodeCandidate[],
  campaignCity: string | null,
  onProgress: (p: GeocodeProgress) => void,
  signal?: AbortSignal,
): Promise<GeocodeProgress> {
  const progress = emptyProgress(deliveries.length);
  if (!deliveries.length) return progress;

  // Reference point for filtering suggestions: the middle of whatever we have
  // already placed. Independent of how a geocoder spells the city.
  const placed: GeoPoint[] = [];
  const reference = (): GeoPoint | null => {
    if (!placed.length) return null;
    return {
      latitude: placed.reduce((s, p) => s + p.latitude, 0) / placed.length,
      longitude: placed.reduce((s, p) => s + p.longitude, 0) / placed.length,
    };
  };
  const deferred: GeocodeCandidate[] = [];

  for (let i = 0; i < deliveries.length; i++) {
    if (signal?.aborted) break;
    const d = deliveries[i];

    const hit = await geocodeDelivery(
      { street: d.street, house_number: d.house_number, city: d.city },
      campaignCity,
      signal,
    );

    if (hit) {
      if (hit.precision === 'house') progress.house++;
      else progress.street++;
      placed.push({ latitude: hit.latitude, longitude: hit.longitude });
      await supabase
        .from('deliveries')
        .update({ latitude: hit.latitude, longitude: hit.longitude })
        .eq('id', d.id);
    } else {
      progress.failed++;
      // Suggestions are gathered afterwards, once enough addresses have been
      // placed to know where this campaign actually is.
      deferred.push(d);
    }

    progress.done = i + 1;
    onProgress({ ...progress, unresolved: [...progress.unresolved] });
    if (i < deliveries.length - 1) await sleep(NOMINATIM_MIN_INTERVAL_MS);
  }

  const ref = reference();
  for (const d of deferred) {
    if (signal?.aborted) break;
    const suggestions = await fetchAddressSuggestions(
      d.street, d.house_number, d.city ?? campaignCity, ref, signal,
    );
    progress.unresolved.push({ ...d, suggestions });
    onProgress({ ...progress, unresolved: [...progress.unresolved] });
    await sleep(400); // Photon is lighter than Nominatim but still a shared service
  }

  return progress;
}

/** Apply a correction a manager approved: the street text and its coordinates. */
export async function applySuggestion(deliveryId: string, s: AddressSuggestion): Promise<void> {
  const { error } = await supabase
    .from('deliveries')
    .update({ street: s.street, latitude: s.latitude, longitude: s.longitude })
    .eq('id', deliveryId);
  if (error) throw error;
}

/** Deliveries in a campaign that still need coordinates. */
export async function fetchPendingGeocode(campaignId: string): Promise<GeocodeCandidate[]> {
  const { data, error } = await supabase
    .from('deliveries')
    .select('id, street, house_number, city')
    .eq('campaign_id', campaignId)
    .is('latitude', null)
    .neq('status', 'CANCELLED')
    .order('street');
  if (error) throw error;
  return (data ?? []) as GeocodeCandidate[];
}
