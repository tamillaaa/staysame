'use client';

import { useEffect, useState } from 'react';
import Itinerary from './Itinerary';
import HotelPicks from './HotelPicks';
import { BUDGET_TIERS, CONTINENTS } from '@/lib/types';
import type {
  BudgetTier,
  ConfirmedStay,
  Continent,
  GenerateItineraryResponse,
} from '@/lib/types';

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

type CitySuggestion = { id: string; label: string };

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
  confirmedStay,
  onConfirmStay,
}: {
  destination: string;
  onDestinationChange: (value: string) => void;
  trip: GenerateItineraryResponse | null;
  onTripGenerated: (trip: GenerateItineraryResponse) => void;
  confirmedStay: ConfirmedStay | null;
  onConfirmStay: (stay: ConfirmedStay | null) => void;
}) {
  const [mode, setMode] = useState<Mode>('destination');
  const [continent, setContinent] = useState<Continent>('Europe');
  const [budgetTier, setBudgetTier] = useState<BudgetTier>('mid');
  const [tripLength, setTripLength] = useState(4);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citySuggestions, setCitySuggestions] = useState<CitySuggestion[]>([]);
  const [showCitySuggestions, setShowCitySuggestions] = useState(false);
  const [activeCity, setActiveCity] = useState(-1);

  useEffect(() => {
    if (mode !== 'destination' || destination.trim().length < 2 || !showCitySuggestions) {
      setCitySuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/city-search?q=${encodeURIComponent(destination.trim())}`, {
          signal: controller.signal,
        });
        const data = (await response.json()) as { cities?: CitySuggestion[] };
        setCitySuggestions(response.ok ? data.cities ?? [] : []);
        setActiveCity(-1);
      } catch {
        if (!controller.signal.aborted) setCitySuggestions([]);
      }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [destination, mode, showCitySuggestions]);

  function chooseCity(city: CitySuggestion) {
    onDestinationChange(city.label);
    setShowCitySuggestions(false);
    setCitySuggestions([]);
  }

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
            <div className="destination-search">
              <input
                id="destination"
                type="text"
                value={destination}
                placeholder="Start typing a city..."
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="city-suggestions"
                aria-expanded={showCitySuggestions && citySuggestions.length > 0}
                onFocus={() => setShowCitySuggestions(true)}
                onBlur={() => window.setTimeout(() => setShowCitySuggestions(false), 120)}
                onChange={(e) => { onDestinationChange(e.target.value); setShowCitySuggestions(true); }}
                onKeyDown={(e) => {
                  if (!citySuggestions.length) return;
                  if (e.key === 'ArrowDown') { e.preventDefault(); setActiveCity((i) => Math.min(i + 1, citySuggestions.length - 1)); }
                  if (e.key === 'ArrowUp') { e.preventDefault(); setActiveCity((i) => Math.max(i - 1, 0)); }
                  if (e.key === 'Enter' && activeCity >= 0) { e.preventDefault(); chooseCity(citySuggestions[activeCity]); }
                  if (e.key === 'Escape') setShowCitySuggestions(false);
                }}
                disabled={loading}
              />
              {showCitySuggestions && citySuggestions.length > 0 && (
                <div className="city-suggestions" id="city-suggestions" role="listbox">
                  {citySuggestions.map((city, index) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={activeCity === index}
                      className="city-option"
                      key={city.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => chooseCity(city)}
                    >
                      <span>↗</span>{city.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
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

      {trip && !loading && (
        <>
          <Itinerary trip={trip} />
          <HotelPicks
            trip={trip}
            confirmedStay={confirmedStay}
            onConfirmStay={onConfirmStay}
          />
        </>
      )}
    </>
  );
}
