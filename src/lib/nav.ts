/** External navigation links. Navigation itself is Waze / Google Maps' job. */
export interface NavTarget {
  latitude: number | null;
  longitude: number | null;
  address: string;
}

export function wazeUrl(t: NavTarget): string {
  if (t.latitude != null && t.longitude != null) {
    return `https://waze.com/ul?ll=${t.latitude},${t.longitude}&navigate=yes`;
  }
  return `https://waze.com/ul?q=${encodeURIComponent(t.address)}&navigate=yes`;
}

export function googleMapsUrl(t: NavTarget): string {
  const dest = t.latitude != null && t.longitude != null ? `${t.latitude},${t.longitude}` : t.address;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}
