import { offsetsForOverlapping } from '@/lib/mapSpread';
import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet';
import type { ReactNode } from 'react';

export interface MapPoint {
  id: string;
  latitude: number;
  longitude: number;
  color: string;
  selected?: boolean;
  /** Short text inside the dot, normally the house number. */
  label?: string;
  popup?: ReactNode;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function dotIcon(color: string, selected?: boolean, label?: string, offset?: { dx: number; dy: number }) {
  const text = (label ?? '').trim().slice(0, 4);
  const size = text ? (selected ? 34 : 28) : selected ? 28 : 22;
  const inner = text
    ? `<div class="marker-dot marker-dot--labelled${selected ? ' selected' : ''}" style="background:${color}">${escapeHtml(text)}</div>`
    : `<div class="marker-dot${selected ? ' selected' : ''}" style="background:${color}"></div>`;
  const dx = offset?.dx ?? 0;
  const dy = offset?.dy ?? 0;
  return L.divIcon({
    className: '',
    html: inner,
    iconSize: [size, size],
    // Shifting the anchor moves the icon on screen while the marker stays put.
    iconAnchor: [size / 2 - dx, size / 2 - dy],
    popupAnchor: [dx, dy - size / 2],
  });
}

function FitBounds({ points }: { points: MapPoint[] }) {
  const map = useMap();
  const key = points.map((p) => `${p.id}:${p.latitude}:${p.longitude}`).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 16);
      return;
    }
    map.fitBounds(
      L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number])),
      { padding: [30, 30], maxZoom: 17 },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

// Default: Israel center.
const DEFAULT_CENTER: [number, number] = [31.9, 34.9];

export function DeliveryMap({ points, className }: { points: MapPoint[]; className?: string }) {
  // Addresses on a street without house-number data all geocode to the same
  // point; fan those out so each delivery is its own dot.
  const { valid, offsets } = useMemo(() => {
    const ok = points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    return { valid: ok, offsets: offsetsForOverlapping(ok) };
  }, [points]);

  return (
    <>
    <div className={className ?? 'h-[60dvh] w-full overflow-hidden rounded-2xl ring-1 ring-slate-200'}>
      <MapContainer center={DEFAULT_CENTER} zoom={8} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={valid} />
        {valid.map((p) => (
          <Marker key={p.id} position={[p.latitude, p.longitude]} icon={dotIcon(p.color, p.selected, p.label, offsets.get(p.id))}>
            {p.popup && (
              <Popup>
                {p.popup}
                {offsets.has(p.id) && (
                  <div className="mt-1 text-xs text-slate-500">מיקום מקורב — לרחוב זה אין מספרי בתים במפה</div>
                )}
              </Popup>
            )}
          </Marker>
        ))}
      </MapContainer>
    </div>
    {offsets.size > 0 && (
      <p className="mt-1 text-xs text-slate-500">
        {offsets.size} כתובות באזור ללא מספרי בתים במפה — הן מפוזרות סביב נקודת הרחוב. המספר בתוך הנקודה הוא מספר הבית.
      </p>
    )}
    </>
  );
}

export function MapLegend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span className="inline-block size-3 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
