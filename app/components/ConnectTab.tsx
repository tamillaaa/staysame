'use client';

import type { ConfirmedStay, GenerateItineraryResponse } from '@/lib/types';

/**
 * Solo-traveler connector.
 *
 * Three states: a confirmed stay (the point a QR code becomes possible), a trip
 * without one, and nothing at all. A stay can arrive from either tab — the photo
 * flow confirms one with no itinerary behind it — so it's checked first.
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
  let body: React.ReactNode;

  if (confirmedStay) {
    body = (
      <div className="empty">
        <h2>You&apos;re staying at {confirmedStay.hotelName}</h2>
        <p>
          {confirmedStay.checkIn} to {confirmedStay.checkOut}. Your QR code and the travelers there
          on overlapping dates come next. That step needs sign-in, so it lands with auth.
        </p>
        <button type="button" className="link" onClick={onGoToPlan}>
          {trip ? 'Back to your itinerary' : 'Plan the full trip'}
        </button>
      </div>
    );
  } else if (!trip) {
    body = (
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
  } else {
    body = (
      <div className="empty">
        <h2>Pick where you&apos;re staying</h2>
        <p>
          Your {trip.destination} trip is ready. Choose a stay under &ldquo;Where to stay&rdquo; and
          mark it as yours. That&apos;s what generates your traveler code.
        </p>
        <button type="button" className="link" onClick={onGoToPlan}>
          Back to your itinerary
        </button>
      </div>
    );
  }

  return (
    <div className="connect-tab">
      <div className="connect-pitch">
        <span className="badge">Upcoming</span>
        <p>
          Want to meet your neighbors during your stay? We left you a hint in your room. If you
          followed the signs correctly, you might just meet your best friend on this trip.
        </p>
      </div>
      {body}
    </div>
  );
}
