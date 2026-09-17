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
  popup?: ReactNode;
}

function dotIcon(color: string, selected?: boolean) {
  const size = selected ? 28 : 22;
  return L.divIcon({
    className: '',
    html: `<div class="marker-dot${selected ? ' selected' : ''}" style="background:${color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
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
  const valid = useMemo(() => points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)), [points]);
  return (
    <div className={className ?? 'h-[60dvh] w-full overflow-hidden rounded-2xl ring-1 ring-slate-200'}>
      <MapContainer center={DEFAULT_CENTER} zoom={8} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={valid} />
        {valid.map((p) => (
          <Marker key={p.id} position={[p.latitude, p.longitude]} icon={dotIcon(p.color, p.selected)}>
            {p.popup && <Popup>{p.popup}</Popup>}
          </Marker>
        ))}
      </MapContainer>
    </div>
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
