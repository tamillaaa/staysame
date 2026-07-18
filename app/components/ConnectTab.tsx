'use client';

import type { ConfirmedStay, GenerateItineraryResponse } from '@/lib/types';

/**
 * Solo-traveler connector.
 *
 * Three states: no trip, a trip with no confirmed stay, and a confirmed stay —
 * which is the point the QR code and match list become possible. The code
 * itself needs `/api/traveler-code` and auth, which land next.
 */
export default function ConnectTab({
  trip,
  confirmedStay,
  onGoToPlan,
}: {
  trip: GenerateItineraryResponse | null;
  confirmedStay: ConfirmedStay | null;
  onGoToPlan: () => void;
}) {
  if (!trip) {
    return (
      <div className="empty">
        <h2>No trip yet</h2>
        <p>
          Once you&apos;ve planned a trip and picked a place to stay, you&apos;ll get a code here
          that connects you with other solo travelers at the same hotel on overlapping dates.
        </p>
        <button type="button" className="link" onClick={onGoToPlan}>
          Plan a trip
        </button>
      </div>
    );
  }

  if (!confirmedStay) {
    return (
      <div className="empty">
        <h2>Pick where you&apos;re staying</h2>
        <p>
          Your {trip.destination} trip is ready. Choose a stay under &ldquo;Where to stay&rdquo; and
          mark it as yours — that&apos;s what generates your traveler code.
        </p>
        <button type="button" className="link" onClick={onGoToPlan}>
          Back to your itinerary
        </button>
      </div>
    );
  }

  return (
    <div className="empty">
      <h2>You&apos;re staying at {confirmedStay.hotelName}</h2>
      <p>
        {confirmedStay.checkIn} to {confirmedStay.checkOut}. Your QR code and the travelers there on
        overlapping dates come next — that step needs sign-in, so it lands with auth.
      </p>
      <button type="button" className="link" onClick={onGoToPlan}>
        Back to your itinerary
      </button>
    </div>
  );
}
