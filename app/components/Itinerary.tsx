'use client';

import { useMemo, useState } from 'react';
import type { GenerateItineraryResponse, ItineraryItem } from '@/lib/types';
import ItineraryMap from './ItineraryMap';

function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${fmt.format(new Date(`${start}T00:00:00Z`))} – ${fmt.format(new Date(`${end}T00:00:00Z`))}`;
}

/** Say plainly what the itinerary was built from, rather than implying it's all verified. */
function groundingNote(sources: GenerateItineraryResponse['sources']): string | null {
  const missing: string[] = [];
  if (!sources.placesConfigured) missing.push('Google Places');
  if (!sources.ticketmasterConfigured) missing.push('Ticketmaster');

  if (missing.length) {
    return `${missing.join(' and ')} ${missing.length > 1 ? 'keys are' : 'key is'} not configured, so this itinerary is from the model's own knowledge — double-check opening times before you go.`;
  }
  if (sources.events === 0) {
    return `Grounded in ${sources.spots} real places. No ticketed events were on sale for these dates.`;
  }
  return `Grounded in ${sources.spots} real places and ${sources.events} real events.`;
}

export default function Itinerary({ trip }: { trip: GenerateItineraryResponse }) {
  // Selection is for the narration/video step, which is not wired up yet.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const days = useMemo(() => {
    const grouped = new Map<number, ItineraryItem[]>();
    for (const item of trip.items) {
      const list = grouped.get(item.day) ?? [];
      list.push(item);
      grouped.set(item.day, list);
    }
    return [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  }, [trip.items]);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const note = groundingNote(trip.sources);
  let flatIndex = -1;

  return (
    <section className="results">
      <div className="results-head">
        <h2>{trip.destination}</h2>
        <p className="dates">
          {formatDateRange(trip.startDate, trip.endDate)} · {trip.budgetTier}
        </p>
        <p className="summary">{trip.summary}</p>
        {note && <p className="hint" style={{ marginTop: 10 }}>{note}</p>}
        {!trip.persisted && (
          <p className="hint" style={{ marginTop: 6 }}>
            Not saved — Supabase isn&apos;t configured, so this trip lives only in this tab.
          </p>
        )}
      </div>

      {days.map(([day, items]) => (
        <div className="day" key={day}>
          <div className="day-label">Day {day}</div>
          {items.map((item) => {
            flatIndex += 1;
            const index = flatIndex;
            return (
              <div
                className={item.imageUrl ? 'item item-with-photo' : 'item'}
                key={`${day}-${item.time_block}-${item.activity}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(index)}
                  onChange={() => toggle(index)}
                  aria-label={`Select ${item.activity} for narration`}
                />
                {item.imageUrl && (
                  <img
                    className="item-photo"
                    src={item.imageUrl}
                    alt={item.imageAlt ?? item.activity}
                    loading="lazy"
                  />
                )}
                <div className="item-body">
                  <div className="item-head">
                    <span className="block">{item.time_block}</span>
                    <span className="activity">{item.activity}</span>
                    {item.is_side_quest && <span className="badge">Side quest</span>}
                  </div>
                  <p className="item-desc">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <ItineraryMap key={`${trip.tripId}-${trip.startDate}-${trip.destination}`} items={trip.items} />

      {/* TODO: wire up ElevenLabs narration + video generation for the selected
          activities. The selection UI is live; the generate button stays disabled
          until that lands. */}
      <div className="video-bar">
        <span className="hint">
          {selected.size === 0
            ? 'Tick activities to include them in a narrated recap.'
            : `${selected.size} ${selected.size === 1 ? 'activity' : 'activities'} selected.`}
        </span>
        <button type="button" disabled title="Narration and video generation are not wired up yet">
          Generate video
        </button>
      </div>
    </section>
  );
}
