'use client';

import { useMemo, useState } from 'react';
import type { ItineraryItem } from '@/lib/types';

type Stop = ItineraryItem & {
  mapLocation: NonNullable<ItineraryItem['mapLocation']>;
  itineraryIndex: number;
};

function distanceKm(a: Stop, b: Stop): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.mapLocation.lat - a.mapLocation.lat);
  const dLng = toRad(b.mapLocation.lng - a.mapLocation.lng);
  const lat1 = toRad(a.mapLocation.lat);
  const lat2 = toRad(b.mapLocation.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function distanceLabel(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
}

export default function ItineraryMap({ items }: { items: ItineraryItem[] }) {
  const allStops = useMemo(
    () => items.flatMap((item, itineraryIndex) =>
      item.mapLocation ? [{ ...item, mapLocation: item.mapLocation, itineraryIndex }] : []
    ) as Stop[],
    [items]
  );
  const days = useMemo(() => [...new Set(allStops.map((stop) => stop.day))], [allStops]);
  const [selectedDay, setSelectedDay] = useState(days[0] ?? 1);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const stops = allStops.filter((stop) => stop.day === selectedDay);
  const selected = stops[Math.min(selectedIndex, Math.max(stops.length - 1, 0))];

  const plotted = useMemo(() => {
    if (!stops.length) return [];
    const lats = stops.map((stop) => stop.mapLocation.lat);
    const lngs = stops.map((stop) => stop.mapLocation.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latRange = Math.max(maxLat - minLat, 0.01);
    const lngRange = Math.max(maxLng - minLng, 0.01);
    return stops.map((stop) => ({
      ...stop,
      x: 10 + ((stop.mapLocation.lng - minLng) / lngRange) * 80,
      y: 12 + ((maxLat - stop.mapLocation.lat) / latRange) * 76,
    }));
  }, [stops]);

  if (allStops.length === 0) return null;

  const legs = stops.slice(1).map((stop, index) => ({
    from: stops[index],
    to: stop,
    km: distanceKm(stops[index], stop),
  }));
  const totalKm = legs.reduce((total, leg) => total + leg.km, 0);

  return (
    <section className="route-map" aria-labelledby="route-map-title">
      <div className="route-map-head">
        <div>
          <p className="map-kicker">Your route</p>
          <h3 id="route-map-title">See how the day connects</h3>
        </div>
        <div className="map-day-picker" aria-label="Choose a day to map">
          {days.map((day) => (
            <button
              type="button"
              key={day}
              aria-pressed={selectedDay === day}
              onClick={() => { setSelectedDay(day); setSelectedIndex(0); }}
            >
              Day {day}
            </button>
          ))}
        </div>
      </div>

      <div className="map-layout">
        <div className="map-canvas">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path className="map-road map-road-one" d="M-5,80 C18,55 31,90 54,48 S87,18 105,34" />
            <path className="map-road map-road-two" d="M8,-5 C30,28 17,47 43,61 S78,68 96,105" />
            <path className="map-water" d="M-8,24 C17,15 31,31 50,17 S84,4 108,14" />
            {plotted.length > 1 && (
              <polyline points={plotted.map((stop) => `${stop.x},${stop.y}`).join(' ')} />
            )}
          </svg>
          {plotted.map((stop, index) => (
            <button
              type="button"
              className="map-pin"
              aria-label={`Stop ${index + 1}: ${stop.activity}`}
              aria-pressed={selectedIndex === index}
              key={`${stop.itineraryIndex}-${stop.mapLocation.name}`}
              style={{ left: `${stop.x}%`, top: `${stop.y}%` }}
              onClick={() => setSelectedIndex(index)}
            >
              <span>{index + 1}</span>
            </button>
          ))}
          <span className="map-north" aria-hidden="true">N ↑</span>
          <span className="map-scale">Relative map · straight-line distance</span>
        </div>

        <aside className="map-details">
          <p className="map-total">{stops.length} mapped stops · {distanceLabel(totalKm)} total</p>
          {selected && (
            <div className="map-selected">
              <span>{selected.time_block}</span>
              <strong>{selected.activity}</strong>
              <p>{selected.mapLocation.name}</p>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${selected.mapLocation.lat},${selected.mapLocation.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in Google Maps ↗
              </a>
            </div>
          )}
          {legs.length > 0 && (
            <ol className="map-legs">
              {legs.map((leg, index) => (
                <li key={`${leg.from.itineraryIndex}-${leg.to.itineraryIndex}`}>
                  <span>{index + 1} → {index + 2}</span>
                  <b>{distanceLabel(leg.km)}</b>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </section>
  );
}
