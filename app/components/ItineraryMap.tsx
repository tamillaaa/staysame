'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeoPoint, ItineraryItem } from '@/lib/types';

type Stop = ItineraryItem & { mapLocation: NonNullable<ItineraryItem['mapLocation']> };
type Point = Stop & { x: number; y: number };
type Tile = { key: string; src: string; x: number; y: number };

const TILE_SIZE = 256;

function worldPoint(lat: number, lng: number, zoom: number) {
  const scale = 2 ** zoom;
  const safeLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale * TILE_SIZE,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale * TILE_SIZE,
  };
}

function bestZoom(stops: Stop[], width: number, height: number): number {
  if (stops.length < 2) return 14;
  for (let zoom = 16; zoom >= 3; zoom -= 1) {
    const points = stops.map((stop) => worldPoint(stop.mapLocation.lat, stop.mapLocation.lng, zoom));
    const spanX = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const spanY = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    if (spanX <= width - 120 && spanY <= height - 110) return zoom;
  }
  return 3;
}

function distanceKm(a: Stop, b: Stop): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.mapLocation.lat - a.mapLocation.lat);
  const dLng = rad(b.mapLocation.lng - a.mapLocation.lng);
  const lat1 = rad(a.mapLocation.lat);
  const lat2 = rad(b.mapLocation.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function distanceLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export default function ItineraryMap({ items, center }: { items: ItineraryItem[]; center: GeoPoint | null }) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 600, height: 360 });
  const [zoomOffset, setZoomOffset] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const stops = useMemo(
    () => items.filter((item): item is Stop => Boolean(item.mapLocation)),
    [items]
  );

  useEffect(() => {
    const element = canvasRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => { setSelectedIndex(0); setZoomOffset(0); }, [items]);

  const map = useMemo(() => {
    if (!center && !stops.length) return null;
    const fittedZoom = bestZoom(stops, size.width, size.height);
    const zoom = Math.max(2, Math.min(18, fittedZoom + zoomOffset));
    const rawPoints = stops.map((stop) => worldPoint(stop.mapLocation.lat, stop.mapLocation.lng, zoom));
    const centerWorld = rawPoints.length
      ? {
          x: (Math.min(...rawPoints.map((p) => p.x)) + Math.max(...rawPoints.map((p) => p.x))) / 2,
          y: (Math.min(...rawPoints.map((p) => p.y)) + Math.max(...rawPoints.map((p) => p.y))) / 2,
        }
      : worldPoint(center!.lat, center!.lng, zoom);
    const left = centerWorld.x - size.width / 2;
    const top = centerWorld.y - size.height / 2;
    const minTileX = Math.floor(left / TILE_SIZE) - 1;
    const maxTileX = Math.floor((left + size.width) / TILE_SIZE) + 1;
    const minTileY = Math.floor(top / TILE_SIZE) - 1;
    const maxTileY = Math.floor((top + size.height) / TILE_SIZE) + 1;
    const tileCount = 2 ** zoom;
    const tiles: Tile[] = [];
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCount) continue;
      for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
        const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
        tiles.push({
          key: `${zoom}-${tileX}-${tileY}`,
          src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${tileY}.png`,
          x: tileX * TILE_SIZE - left,
          y: tileY * TILE_SIZE - top,
        });
      }
    }
    const points: Point[] = stops.map((stop, index) => ({
      ...stop,
      x: rawPoints[index].x - left,
      y: rawPoints[index].y - top,
    }));
    return { zoom, tiles, points };
  }, [center, size, stops, zoomOffset]);

  if (!map) return null;

  const legs = stops.slice(1).map((stop, index) => ({
    from: stops[index], to: stop, km: distanceKm(stops[index], stop),
  }));
  const totalKm = legs.reduce((total, leg) => total + leg.km, 0);
  const selected = stops[Math.min(selectedIndex, Math.max(stops.length - 1, 0))];

  return (
    <section className="route-map" aria-labelledby="route-map-title">
      <div className="route-map-head">
        <div>
          <p className="map-kicker">Your checked route</p>
          <h3 id="route-map-title">See how your picks connect</h3>
        </div>
        <p>{stops.length ? `${stops.length} pinned · ${distanceLabel(totalKm)} total` : 'Tick activities to add them'}</p>
      </div>

      <div className="map-layout">
        <div className="map-canvas" ref={canvasRef}>
          <div className="map-tiles" aria-hidden="true">
            {map.tiles.map((tile) => (
              <img key={tile.key} src={tile.src} alt="" draggable={false} style={{ left: tile.x, top: tile.y }} />
            ))}
          </div>
          {map.points.length > 1 && (
            <svg className="map-route" width={size.width} height={size.height} aria-hidden="true">
              <polyline points={map.points.map((point) => `${point.x},${point.y}`).join(' ')} />
            </svg>
          )}
          {map.points.map((stop, index) => (
            <button
              type="button"
              className="map-pin"
              aria-label={`Stop ${index + 1}: ${stop.activity}`}
              aria-pressed={selectedIndex === index}
              key={`${stop.day}-${stop.activity}`}
              style={{ left: stop.x, top: stop.y }}
              onClick={() => setSelectedIndex(index)}
            >
              <span>{index + 1}</span>
            </button>
          ))}
          {!stops.length && <div className="map-empty">Tick a real place, restaurant, or café above to build your route.</div>}
          <div className="map-zoom" aria-label="Map zoom controls">
            <button type="button" onClick={() => setZoomOffset((value) => Math.min(value + 1, 4))} aria-label="Zoom in">+</button>
            <button type="button" onClick={() => setZoomOffset((value) => Math.max(value - 1, -4))} aria-label="Zoom out">−</button>
          </div>
          <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>
        </div>

        <aside className="map-details">
          {selected ? (
            <div className="map-selected">
              <span>Stop {selectedIndex + 1} · Day {selected.day} · {selected.time_block}</span>
              <strong>{selected.activity}</strong>
              <p>{selected.mapLocation.name}</p>
              <a href={`https://www.google.com/maps/search/?api=1&query=${selected.mapLocation.lat},${selected.mapLocation.lng}`} target="_blank" rel="noreferrer">Open in Google Maps ↗</a>
            </div>
          ) : (
            <div className="map-selected"><strong>Your route starts with a tick.</strong><p>Only checked activities appear here.</p></div>
          )}
          {legs.length > 0 && (
            <ol className="map-legs">
              {legs.map((leg, index) => (
                <li key={`${leg.from.activity}-${leg.to.activity}`}><span>{index + 1} → {index + 2}</span><b>{distanceLabel(leg.km)}</b></li>
              ))}
            </ol>
          )}
          <p className="map-distance-note">Distances are straight-line estimates.</p>
        </aside>
      </div>
    </section>
  );
}
