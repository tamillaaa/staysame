'use client';

import type { GenerateItineraryResponse } from '@/lib/types';

/**
 * Solo-traveler connector.
 *
 * The QR code and match list are unlocked by a booked hotel, which arrives with
 * the Stay22 step — so for now this shows the two states it will really have:
 * no trip yet, and a trip without a booking.
 */
export default function ConnectTab({
  trip,
  onGoToPlan,
}: {
  trip: GenerateItineraryResponse | null;
  onGoToPlan: () => void;
}) {
  if (!trip) {
    return (
      <div className="empty">
        <h2>No trip yet</h2>
        <p>
          Once you&apos;ve planned a trip and booked a hotel, you&apos;ll get a code here that
          connects you with other solo travelers staying at the same place on the same dates.
        </p>
        <button type="button" className="link" onClick={onGoToPlan}>
          Plan a trip
        </button>
      </div>
    );
  }

  return (
    <div className="empty">
      <h2>Book a stay to unlock your code</h2>
      <p>
        Your {trip.destination} trip is ready. Hotel matching lands next — once you confirm a stay,
        this tab shows your QR code and anyone else there on overlapping dates who shares your
        interests.
      </p>
      <button type="button" className="link" onClick={onGoToPlan}>
        Back to your itinerary
      </button>
    </div>
  );
}
