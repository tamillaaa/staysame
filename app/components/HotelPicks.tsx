'use client';

import { useEffect, useState } from 'react';
import type {
  ConfirmedStay,
  GenerateItineraryResponse,
  HotelMatchesResponse,
  HotelPickPublic,
} from '@/lib/types';

/**
 * Stay22 results for the trip, rendered inline beneath the itinerary.
 * Confirming one is what unlocks the Connect tab.
 */
export default function HotelPicks({
  trip,
  confirmedStay,
  onConfirmStay,
}: {
  trip: GenerateItineraryResponse;
  confirmedStay: ConfirmedStay | null;
  onConfirmStay: (stay: ConfirmedStay | null) => void;
}) {
  const [result, setResult] = useState<HotelMatchesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { destination, startDate, endDate, budgetTier, tripId, center, anchors } = trip;

  useEffect(() => {
    if (!startDate || !endDate) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const response = await fetch('/api/hotel-matches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination,
            checkin: startDate,
            checkout: endDate,
            budget_tier: budgetTier,
            trip_id: tripId,
            center,
            anchors,
          }),
        });
        const data = await response.json();
        if (cancelled) return;
        if (!response.ok) setError(data?.error ?? `Stay search failed (HTTP ${response.status}).`);
        else setResult(data as HotelMatchesResponse);
      } catch {
        if (!cancelled) setError('Could not reach the server while searching for stays.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    // A new trip supersedes the in-flight search for the previous one.
    return () => {
      cancelled = true;
    };
  }, [destination, startDate, endDate, budgetTier, tripId, center, anchors]);

  function toggleConfirm(pick: HotelPickPublic) {
    if (confirmedStay?.hotelName === pick.name) {
      onConfirmStay(null);
      return;
    }
    onConfirmStay({
      hotelName: pick.name,
      checkIn: result?.checkin ?? startDate!,
      checkOut: result?.checkout ?? endDate!,
    });
  }

  return (
    <section className="stays">
      <h3 className="stays-head">Where to stay</h3>

      {loading && <p className="hint">Finding stays in {destination}…</p>}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <>
          {result.relaxedPriceFilter && (
            <p className="hint stays-note">
              Nothing matched your {budgetTier} budget in {destination}, so these are the closest
              options.
            </p>
          )}
          {!result.affiliateConfigured && (
            <p className="hint stays-note">
              STAY22_AID isn&apos;t set, so bookings won&apos;t be attributed to your affiliate
              account.
            </p>
          )}

          <div className="stay-grid">
            {result.picks.map((pick) => {
              const isConfirmed = confirmedStay?.hotelName === pick.name;
              return (
                <article className={`stay${isConfirmed ? ' confirmed' : ''}`} key={pick.id}>
                  {pick.imageUrl ? (
                    <img className="stay-img" src={pick.imageUrl} alt={pick.name} loading="lazy" />
                  ) : (
                    <div className="stay-img stay-img-empty">No photo</div>
                  )}
                  <div className="stay-body">
                    <h4 className="stay-name">{pick.name}</h4>
                    {pick.proximity ? (
                      <p className="stay-near">
                        {pick.proximity.walkMinutes} min walk to {pick.proximity.spotName}
                      </p>
                    ) : (
                      <p className="stay-loc">{pick.location}</p>
                    )}
                    {pick.blurb && <p className="stay-blurb">{pick.blurb}</p>}
                    <p className="stay-desc">{pick.description}</p>
                    <p className="stay-price">{pick.priceLabel}</p>

                    <div className="stay-actions">
                      {pick.allezDeeplink && (
                        <a
                          className="stay-book"
                          href={pick.allezDeeplink}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Book{pick.provider ? ` on ${pick.provider}` : ''}
                        </a>
                      )}
                      <button
                        type="button"
                        className="stay-confirm"
                        aria-pressed={isConfirmed}
                        onClick={() => toggleConfirm(pick)}
                      >
                        {isConfirmed ? 'Staying here ✓' : "I'm staying here"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <p className="hint stays-note">
            {result.nights} night{result.nights === 1 ? '' : 's'} · {result.checkin} to{' '}
            {result.checkout}
            {result.persisted ? ' · saved to your trip' : ''}
          </p>
        </>
      )}
    </section>
  );
}
