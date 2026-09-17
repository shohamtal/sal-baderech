/**
 * Dynamic delivery-cluster suggestions.
 *
 * Pure, deterministic, UI-independent. Given the currently AVAILABLE deliveries
 * and a requested basket count, returns a few compact candidate clusters.
 *
 * Proximity signals (in order of trust):
 *   1. coordinates (haversine distance)          — when both deliveries have them
 *   2. same street + nearby house numbers          — when coordinates are missing
 *   3. otherwise "far"
 *
 * Deliberately simple: no odd/even side logic, no routing.
 */

export interface ClusterInput {
  id: string;
  street: string;
  houseNumber: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ClusterSuggestion {
  deliveryIds: string[];
  size: number;
  /** Lower is better. Roughly "average meters between baskets" plus penalties. */
  score: number;
  streets: string[];
  /** Approximate radius in meters around the centroid (coordinates only), else null. */
  radiusMeters: number | null;
  sameStreet: boolean;
  /** How many members were placed without coordinates. */
  withoutCoords: number;
}

export interface ClusterOptions {
  maxSuggestions?: number;
  /** Assumed distance between consecutive house numbers when no coordinates. */
  metersPerHouseNumber?: number;
  /** Distance assumed between deliveries whose proximity is unknown. */
  unknownDistanceMeters?: number;
  /** Penalty (meters) per missing basket when the cluster is smaller than requested. */
  shortfallPenaltyMeters?: number;
  /** Cap on the number of seeds explored (performance guard). */
  maxSeeds?: number;
}

const DEFAULTS: Required<ClusterOptions> = {
  maxSuggestions: 3,
  metersPerHouseNumber: 12,
  unknownDistanceMeters: 2500,
  shortfallPenaltyMeters: 600,
  maxSeeds: 300,
};

const STREET_PREFIXES = /^(רחוב|רח'|רח׳|רח|שדרות|שד'|שד׳|שד|סמטת|סמ'|דרך|st\.?|street|rd\.?|road|ave\.?|avenue)\s+/i;

export function normalizeStreet(street: string): string {
  return street
    .trim()
    .toLowerCase()
    .replace(/[.,'"׳"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(STREET_PREFIXES, '')
    .trim();
}

export function parseHouseNumber(value: string): number | null {
  const m = String(value ?? '').trim().match(/\d+/);
  if (!m) return null;
  const n = parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

interface Node {
  id: string;
  street: string;
  /** Original street text for display. */
  streetLabel: string;
  house: number | null;
  lat: number | null;
  lng: number | null;
}

function hasCoords(n: Node): n is Node & { lat: number; lng: number } {
  return n.lat != null && n.lng != null;
}

function toNode(d: ClusterInput): Node {
  const lat = d.latitude ?? null;
  const lng = d.longitude ?? null;
  const valid = lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
  return {
    id: d.id,
    street: normalizeStreet(d.street ?? ''),
    streetLabel: (d.street ?? '').trim(),
    house: parseHouseNumber(d.houseNumber),
    lat: valid ? lat : null,
    lng: valid ? lng : null,
  };
}

function distance(a: Node, b: Node, o: Required<ClusterOptions>): number {
  if (hasCoords(a) && hasCoords(b)) {
    return haversineMeters(a.lat, a.lng, b.lat, b.lng);
  }
  if (a.street && a.street === b.street) {
    if (a.house != null && b.house != null) {
      return Math.abs(a.house - b.house) * o.metersPerHouseNumber;
    }
    return o.metersPerHouseNumber * 10;
  }
  return o.unknownDistanceMeters;
}

function growCluster(seed: Node, all: Node[], requested: number, dist: (i: number, j: number) => number, seedIdx: number): number[] {
  const members = [seedIdx];
  const used = new Set<number>([seedIdx]);
  while (members.length < requested && members.length < all.length) {
    let best = -1;
    let bestCost = Infinity;
    for (let j = 0; j < all.length; j++) {
      if (used.has(j)) continue;
      let minToMembers = Infinity;
      for (const m of members) {
        const d = dist(m, j);
        if (d < minToMembers) minToMembers = d;
      }
      // Compactness around the seed prevents long chains drifting away.
      const cost = minToMembers + 0.5 * dist(seedIdx, j);
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        best = j;
      }
    }
    if (best === -1) break;
    members.push(best);
    used.add(best);
  }
  void seed;
  return members;
}

function evaluate(
  members: number[],
  all: Node[],
  requested: number,
  dist: (i: number, j: number) => number,
  o: Required<ClusterOptions>,
): ClusterSuggestion {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      total += dist(members[i], members[j]);
      pairs++;
    }
  }
  const meanPairwise = pairs ? total / pairs : 0;
  const byKey = new Map<string, string>();
  for (const m of members) if (!byKey.has(all[m].street)) byKey.set(all[m].street, all[m].streetLabel);
  const streets = Array.from(byKey.values()).sort();
  const shortfall = Math.max(0, requested - members.length);
  const score = meanPairwise + shortfall * o.shortfallPenaltyMeters + (streets.length - 1) * 40;

  const withCoords = members.map((m) => all[m]).filter(hasCoords);
  // Radius is only meaningful when every member has coordinates.
  let radiusMeters: number | null = null;
  if (withCoords.length >= 2 && withCoords.length === members.length) {
    const cLat = withCoords.reduce((s, n) => s + n.lat, 0) / withCoords.length;
    const cLng = withCoords.reduce((s, n) => s + n.lng, 0) / withCoords.length;
    radiusMeters = Math.round(Math.max(...withCoords.map((n) => haversineMeters(cLat, cLng, n.lat, n.lng))));
  }

  return {
    deliveryIds: members.map((m) => all[m].id),
    size: members.length,
    score: Math.round(score * 100) / 100,
    streets,
    radiusMeters,
    sameStreet: streets.length === 1,
    withoutCoords: members.length - withCoords.length,
  };
}

export function findDeliveryClusters(
  availableDeliveries: ClusterInput[],
  requestedCount: number,
  options: ClusterOptions = {},
): ClusterSuggestion[] {
  const o = { ...DEFAULTS, ...options };
  const requested = Math.max(1, Math.floor(requestedCount || 0));
  if (!availableDeliveries.length || !requestedCount || requestedCount < 1) return [];

  // Deterministic order regardless of input order.
  const all = availableDeliveries
    .map(toNode)
    .sort((a, b) =>
      a.street.localeCompare(b.street) || (a.house ?? 1e9) - (b.house ?? 1e9) || a.id.localeCompare(b.id),
    );
  const n = all.length;

  // Memoized symmetric distance matrix (n ≤ a few thousand is fine).
  const cache = new Map<number, number>();
  const dist = (i: number, j: number): number => {
    if (i === j) return 0;
    const key = i < j ? i * n + j : j * n + i;
    let d = cache.get(key);
    if (d === undefined) {
      d = distance(all[i], all[j], o);
      cache.set(key, d);
    }
    return d;
  };

  if (requested >= n) {
    return [evaluate(all.map((_, i) => i), all, requested, dist, o)];
  }

  const step = Math.max(1, Math.ceil(n / o.maxSeeds));
  const candidates: ClusterSuggestion[] = [];
  const seen = new Set<string>();
  for (let s = 0; s < n; s += step) {
    const members = growCluster(all[s], all, requested, dist, s);
    const suggestion = evaluate(members, all, requested, dist, o);
    const key = [...suggestion.deliveryIds].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(suggestion);
  }

  candidates.sort((a, b) => a.score - b.score || a.deliveryIds[0].localeCompare(b.deliveryIds[0]));

  // Prefer disjoint suggestions so alternatives are meaningfully different.
  const chosen: ClusterSuggestion[] = [];
  const taken = new Set<string>();
  for (const c of candidates) {
    if (chosen.length >= o.maxSuggestions) break;
    if (c.deliveryIds.some((id) => taken.has(id))) continue;
    chosen.push(c);
    c.deliveryIds.forEach((id) => taken.add(id));
  }
  // Fill remaining slots with partially-overlapping alternatives (< 50% overlap).
  if (chosen.length < o.maxSuggestions) {
    for (const c of candidates) {
      if (chosen.length >= o.maxSuggestions) break;
      if (chosen.includes(c)) continue;
      const overlap = c.deliveryIds.filter((id) => chosen.some((x) => x.deliveryIds.includes(id))).length;
      if (overlap / c.size < 0.5) chosen.push(c);
    }
  }
  return chosen;
}
