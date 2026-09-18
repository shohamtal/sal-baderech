/**
 * Separate markers that sit on exactly the same coordinate.
 *
 * OpenStreetMap has no house numbers for much of a newer town, so every address
 * on a street geocodes to the same street centre. Drawn as-is, eight deliveries
 * become one dot and a volunteer cannot see how many stops a street holds.
 *
 * The offset is in SCREEN PIXELS, not metres. A geographic offset large enough
 * to see at street zoom would put the marker a block away, and a small one
 * disappears as soon as you zoom out. Offsetting the icon keeps every marker
 * anchored to the real point while staying legible at any zoom.
 */
export interface Positioned {
  id: string;
  latitude: number;
  longitude: number;
}

export interface MarkerOffset {
  /** Pixels right of the anchor point. */
  dx: number;
  /** Pixels below the anchor point. */
  dy: number;
}

const METERS_KEY_PRECISION = 5; // ~1 metre

/** Ring radius in pixels, wide enough that labelled dots stay readable. */
export function ringRadiusPixels(count: number): number {
  return Math.min(48, Math.max(18, 5 * count));
}

/**
 * Pixel offsets for markers sharing a coordinate. Markers that are already
 * distinct are absent from the map, meaning "do not move".
 */
export function offsetsForOverlapping(points: Positioned[]): Map<string, MarkerOffset> {
  const groups = new Map<string, Positioned[]>();
  for (const p of points) {
    const k = `${p.latitude.toFixed(METERS_KEY_PRECISION)},${p.longitude.toFixed(METERS_KEY_PRECISION)}`;
    const list = groups.get(k);
    if (list) list.push(p);
    else groups.set(k, [p]);
  }

  const offsets = new Map<string, MarkerOffset>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Stable order, so dots keep their place between renders.
    const ordered = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const radius = ringRadiusPixels(ordered.length);
    ordered.forEach((p, i) => {
      const angle = (2 * Math.PI * i) / ordered.length - Math.PI / 2; // first dot on top
      offsets.set(p.id, {
        dx: Math.round(radius * Math.cos(angle)),
        dy: Math.round(radius * Math.sin(angle)),
      });
    });
  }
  return offsets;
}
