'use client';

import { useState } from 'react';
import Itinerary from './Itinerary';
import { BUDGET_TIERS, CONTINENTS } from '@/lib/types';
import type { BudgetTier, Continent, GenerateItineraryResponse } from '@/lib/types';

type Mode = 'destination' | 'surprise_me' | 'continent';

const MODE_LABELS: Record<Mode, string> = {
  destination: 'I know where',
  surprise_me: 'Surprise me',
  continent: 'Pick a continent',
};

const BUDGET_LABELS: Record<BudgetTier, string> = {
  shoestring: 'Shoestring',
  mid: 'Mid-range',
  splurge: 'Splurge',
};

function defaultStartDate(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

export default function PlanTab({
  destination,
  onDestinationChange,
  trip,
  onTripGenerated,
}: {
  destination: string;
  onDestinationChange: (value: string) => void;
  trip: GenerateItineraryResponse | null;
  onTripGenerated: (trip: GenerateItineraryResponse) => void;
}) {
  const [mode, setMode] = useState<Mode>('destination');
  const [continent, setContinent] = useState<Continent>('Europe');
  const [budgetTier, setBudgetTier] = useState<BudgetTier>('mid');
  const [tripLength, setTripLength] = useState(4);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = mode !== 'destination' || destination.trim().length > 0;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit || loading) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/generate-itinerary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          destination: mode === 'destination' ? destination.trim() : undefined,
          continent: mode === 'continent' ? continent : undefined,
          budget_tier: budgetTier,
          trip_length_days: tripLength,
          start_date: startDate,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? `Something went wrong (HTTP ${response.status}).`);
        return;
      }
      onTripGenerated(data as GenerateItineraryResponse);
      // Surfaced back into the form so a surprise pick can be re-rolled or edited.
      onDestinationChange((data as GenerateItineraryResponse).destination);
    } catch {
      setError('Could not reach the server. Is it running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form className="card" onSubmit={handleSubmit}>
        <div className="field">
          <span className="field-label">Where to?</span>
          <div className="choice-row">
            {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className="choice"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
                disabled={loading}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {mode === 'destination' && (
          <div className="field">
            <label htmlFor="destination">Destination</label>
            <input
              id="destination"
              type="text"
              value={destination}
              placeholder="Lisbon, Portugal"
              onChange={(e) => onDestinationChange(e.target.value)}
              disabled={loading}
            />
          </div>
        )}

        {mode === 'continent' && (
          <div className="field">
            <label htmlFor="continent">Continent</label>
            <select
              id="continent"
              value={continent}
              onChange={(e) => setContinent(e.target.value as Continent)}
              disabled={loading}
            >
              {CONTINENTS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        {mode === 'surprise_me' && (
          <p className="notice">We&apos;ll pick a destination that suits your budget.</p>
        )}

        <div className="field">
          <span className="field-label">Budget</span>
          <div className="choice-row">
            {BUDGET_TIERS.map((tier) => (
              <button
                key={tier}
                type="button"
                className="choice"
                aria-pressed={budgetTier === tier}
                onClick={() => setBudgetTier(tier)}
                disabled={loading}
              >
                {BUDGET_LABELS[tier]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="start-date">Starting</label>
          <input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={loading}
          />
        </div>

        <div className="field">
          <label htmlFor="trip-length">How many days?</label>
          <input
            id="trip-length"
            type="number"
            min={1}
            max={14}
            value={tripLength}
            onChange={(e) => setTripLength(Number(e.target.value))}
            disabled={loading}
          />
        </div>

        <button type="submit" className="primary" disabled={loading || !canSubmit}>
          {loading ? 'Planning your trip...' : 'Plan my trip'}
        </button>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>

      {loading && (
        <p className="skeleton">
          Finding real spots and events, then building your days. This takes a few seconds.
        </p>
      )}

      {trip && !loading && <Itinerary trip={trip} />}
    </>
  );
}
