'use client';

import { useMemo, useRef, useState } from 'react';
import { base64ToBlobUrl } from '@/lib/audio';
import type { GenerateItineraryResponse, ItineraryItem, NarrateResponse } from '@/lib/types';
import ItineraryMap from './ItineraryMap';

function formatDateRange(start: string | null, end: string | null): string {
  if (!start || !end) return '';
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return `${fmt.format(new Date(`${start}T00:00:00Z`))} to ${fmt.format(new Date(`${end}T00:00:00Z`))}`;
}

/** Say plainly what the itinerary was built from, rather than implying it's all verified. */
function groundingNote(sources: GenerateItineraryResponse['sources']): string | null {
  const missing: string[] = [];
  if (!sources.placesConfigured) missing.push('Google Places');
  if (!sources.ticketmasterConfigured) missing.push('Ticketmaster');

  if (missing.length) {
    return `${missing.join(' and ')} ${missing.length > 1 ? 'keys are' : 'key is'} not configured, so this itinerary is from the model's own knowledge. Double-check opening times before you go.`;
  }
  if (sources.events === 0) {
    return `Grounded in ${sources.spots} real places. No ticketed events were on sale for these dates.`;
  }
  return `Grounded in ${sources.spots} real places and ${sources.events} real events.`;
}

export default function Itinerary({ trip }: { trip: GenerateItineraryResponse }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [narrating, setNarrating] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [narration, setNarration] = useState<{ audioUrl: string; script: string } | null>(null);
  const audioUrlRef = useRef<string | null>(null);

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
    // The selection changed, so any existing narration no longer matches it.
    setNarration(null);
    setNarrationError(null);
  }

  async function generateNarration() {
    const items = trip.items.filter((_, index) => selected.has(index));
    if (items.length === 0) return;

    setNarrating(true);
    setNarrationError(null);
    try {
      const response = await fetch('/api/narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destination: trip.destination, summary: trip.summary, items }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Could not generate narration. Please try again.');
      }
      const { script, audioBase64, mimeType } = data as NarrateResponse;

      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const audioUrl = base64ToBlobUrl(audioBase64, mimeType);
      audioUrlRef.current = audioUrl;
      setNarration({ audioUrl, script });
    } catch (err) {
      setNarrationError(err instanceof Error ? err.message : 'Could not generate narration.');
    } finally {
      setNarrating(false);
    }
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
            Not saved. Supabase isn&apos;t configured, so this trip lives only in this tab.
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

      <ItineraryMap
        key={`${trip.tripId}-${trip.startDate}-${trip.destination}`}
        items={trip.items.filter((_, index) => selected.has(index))}
        center={trip.center}
      />

      <div className="narration-bar">
        <span className="hint">
          {selected.size === 0
            ? 'Tick activities to include them in a narrated recap.'
            : `${selected.size} ${selected.size === 1 ? 'activity' : 'activities'} selected.`}
        </span>
        <button type="button" disabled={selected.size === 0 || narrating} onClick={generateNarration}>
          {narrating ? 'Generating…' : 'Generate narration'}
        </button>
      </div>

      {narrationError && <p className="error">{narrationError}</p>}

      {narration && (
        <div className="narration-result">
          <audio controls src={narration.audioUrl} />
          <p className="narration-script">{narration.script}</p>
        </div>
      )}
    </section>
  );
}
