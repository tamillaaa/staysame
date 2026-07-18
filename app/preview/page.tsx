'use client';

// TEMPORARY design-review harness — not linked from anywhere, deleted after
// visual verification. Renders every designed state with mock data so no
// real API calls are needed.

import GlobeLoader from '../components/GlobeLoader';
import Itinerary from '../components/Itinerary';
import ConnectTab from '../components/ConnectTab';
import type { GenerateItineraryResponse } from '@/lib/types';

const trip = {
  tripId: 'preview',
  destination: 'Valparaíso, Chile',
  startDate: '2026-08-17',
  endDate: '2026-08-20',
  budgetTier: 'mid',
  summary:
    'Three days of funiculars, port-side seafood, and staircase murals — with a couple of detours you can blame on us.',
  persisted: true,
  sources: { placesConfigured: true, ticketmasterConfigured: true, spots: 14, events: 2 },
  center: null,
  anchors: [],
  items: [
    {
      day: 1,
      time_block: 'morning',
      activity: 'Ascensor Concepción',
      description: 'Ride the 1883 funicular up to Cerro Concepción and walk the mural alleys.',
      is_side_quest: false,
    },
    {
      day: 1,
      time_block: 'afternoon',
      activity: 'Mercado Cardonal lunch',
      description: 'Pastel de jaiba where the vendors actually eat.',
      is_side_quest: false,
    },
    {
      day: 1,
      time_block: 'evening',
      activity: 'Order in Chilean slang only',
      description:
        'One full restaurant order using only what a stranger teaches you. No pointing at the menu.',
      is_side_quest: true,
    },
    {
      day: 2,
      time_block: 'morning',
      activity: 'La Sebastiana',
      description: "Neruda's house on the hill — go early, the light through the top floor is the point.",
      is_side_quest: false,
    },
    {
      day: 2,
      time_block: 'afternoon',
      activity: 'Find the blue staircase',
      description:
        'Somewhere on Cerro Alegre there is a staircase painted like a wave. No map. Ask three locals.',
      is_side_quest: true,
    },
    {
      day: 2,
      time_block: 'evening',
      activity: 'Bar Cinzano',
      description: 'Tango night since 1896. Stay for the second set.',
      is_side_quest: false,
    },
  ],
} as unknown as GenerateItineraryResponse;

export default function Preview() {
  return (
    <main className="page">
      <h1 style={{ fontSize: 28 }}>Preview: loader</h1>
      <GlobeLoader />

      <h1 style={{ fontSize: 28, marginTop: 40 }}>Preview: itinerary</h1>
      <Itinerary trip={trip} />

      <h1 style={{ fontSize: 28, marginTop: 40 }}>Preview: stays</h1>
      <section className="stays">
        <h3 className="stays-head">Where to stay</h3>
        <div className="stay-grid">
          <article className="stay">
            <div className="stay-img stay-img-empty">No photo</div>
            <div className="stay-body">
              <h4 className="stay-name">Hotel Brighton</h4>
              <p className="stay-near">6 min walk to Ascensor Concepción</p>
              <p className="stay-blurb">A yellow Victorian hanging off the cliff edge.</p>
              <p className="stay-desc">Balcony views over the whole bay.</p>
              <p className="stay-price">$84 / night</p>
              <div className="stay-actions">
                <a className="stay-book" href="#">Book on Stay22</a>
                <button type="button" className="stay-confirm" aria-pressed="false">
                  I&apos;m staying here
                </button>
              </div>
            </div>
          </article>
          <article className="stay confirmed">
            <div className="stay-img stay-img-empty">No photo</div>
            <div className="stay-body">
              <h4 className="stay-name">Casa Galos</h4>
              <p className="stay-near">3 min walk to La Sebastiana</p>
              <p className="stay-desc">Rooftop terrace, quiet street.</p>
              <p className="stay-price">$112 / night</p>
              <div className="stay-actions">
                <a className="stay-book" href="#">Book on Stay22</a>
                <button type="button" className="stay-confirm" aria-pressed="true">
                  Staying here ✓
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <h1 style={{ fontSize: 28, marginTop: 40 }}>Preview: boarding pass</h1>
      <ConnectTab
        trip={trip}
        confirmedStay={{ hotelName: 'Casa Galos', checkIn: '2026-08-17', checkOut: '2026-08-20' }}
        onGoToPlan={() => {}}
      />
    </main>
  );
}
