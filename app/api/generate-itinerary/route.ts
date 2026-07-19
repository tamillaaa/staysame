import { NextResponse } from 'next/server';
import { ApiKeyError, GenerationError, generateItinerary } from '@/lib/claude';
import { pickDestination } from '@/lib/destinations';
import { fetchEvents } from '@/lib/events';
import { centroidOf, fetchFoodSpots, fetchTopSpots } from '@/lib/places';
import { getServiceClient } from '@/lib/supabase';
import { BUDGET_TIERS, CONTINENTS } from '@/lib/types';
import type {
  BudgetTier,
  Continent,
  GenerateItineraryRequest,
  GenerateItineraryResponse,
  ItineraryItem,
  LiveEvent,
  Spot,
} from '@/lib/types';

const MAX_TRIP_DAYS = 14;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function bad(error: string, code: string) {
  return NextResponse.json({ error, code }, { status: 400 });
}

function searchable(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Match generated activities back to the real sources that grounded them. */
function addActivityImages(items: ItineraryItem[], spots: Spot[], events: LiveEvent[]): ItineraryItem[] {
  const photographed = spots.filter((spot) => spot.photoName);

  return items.map((item, index) => {
    const activity = searchable(item.activity);
    const spot = photographed.find((candidate) => {
      const name = searchable(candidate.name);
      return name.length > 3 && (activity.includes(name) || name.includes(activity));
    });
    const event = events.find((candidate) => {
      const name = searchable(candidate.name);
      return name.length > 3 && (activity.includes(name) || name.includes(activity));
    });
    // Claude builds from these supplied spots. If it paraphrases a name, use a
    // rotating destination photo rather than showing an empty card.
    const fallback = photographed.length ? photographed[index % photographed.length] : null;
    const picturedSpot = spot ?? fallback;

    if (event) {
      return {
        ...item,
        imageUrl: event.imageUrl ?? undefined,
        imageAlt: event.name,
        mapLocation:
          event.lat !== null && event.lng !== null
            ? { name: event.venue ?? event.name, lat: event.lat, lng: event.lng }
            : null,
      };
    }
    if (picturedSpot?.photoName) {
      return {
        ...item,
        imageUrl: `/api/place-photo?name=${encodeURIComponent(picturedSpot.photoName)}`,
        imageAlt: spot ? spot.name : `A real place near ${item.activity}`,
        // A fallback photo is decorative; only exact source matches become map pins.
        mapLocation:
          spot && spot.lat !== null && spot.lng !== null
            ? { name: spot.name, lat: spot.lat, lng: spot.lng }
            : null,
      };
    }
    return item;
  });
}

export async function POST(request: Request) {
  let body: GenerateItineraryRequest;
  try {
    body = await request.json();
  } catch {
    return bad('Request body must be JSON.', 'BAD_JSON');
  }

  const { mode, budget_tier, trip_length_days, start_date } = body ?? {};

  if (!BUDGET_TIERS.includes(budget_tier)) {
    return bad(`budget_tier must be one of: ${BUDGET_TIERS.join(', ')}.`, 'BAD_BUDGET_TIER');
  }

  const days = Number(trip_length_days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_TRIP_DAYS) {
    return bad(`trip_length_days must be a whole number between 1 and ${MAX_TRIP_DAYS}.`, 'BAD_TRIP_LENGTH');
  }

  // Resolve the destination: given directly, or picked from the curated pool.
  let destination: string;
  if (mode === 'destination') {
    destination = (body.destination ?? '').trim();
    if (!destination) return bad('Enter a destination, or choose "surprise me".', 'MISSING_DESTINATION');
  } else if (mode === 'continent') {
    const continent = body.continent as Continent;
    if (!CONTINENTS.includes(continent)) {
      return bad(`continent must be one of: ${CONTINENTS.join(', ')}.`, 'BAD_CONTINENT');
    }
    destination = pickDestination(budget_tier as BudgetTier, continent);
  } else if (mode === 'surprise_me') {
    destination = pickDestination(budget_tier as BudgetTier);
  } else {
    return bad('mode must be "destination", "continent" or "surprise_me".', 'BAD_MODE');
  }

  const startDate = start_date?.trim() || addDays(todayIso(), 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return bad('start_date must be YYYY-MM-DD.', 'BAD_START_DATE');
  }
  // An n-day trip spans n-1 nights after the arrival date.
  const endDate = addDays(startDate, days - 1);

  try {
    // Both lookups are independent and each degrades to [] on failure.
    const [attractions, foodSpots, events] = await Promise.all([
      fetchTopSpots(destination),
      fetchFoodSpots(destination),
      fetchEvents(destination, startDate, endDate),
    ]);
    const spots = [...attractions, ...foodSpots].filter(
      (spot, index, list) => list.findIndex((other) => searchable(other.name) === searchable(spot.name)) === index
    );

    const itinerary = await generateItinerary({
      destination,
      budgetTier: budget_tier as BudgetTier,
      tripLengthDays: days,
      startDate,
      endDate,
      spots,
      events,
    });

    // Persist if Supabase is configured. A failure here must not lose the
    // itinerary the user just waited for, so it's reported, not thrown.
    let tripId: string | null = null;
    const supabase = getServiceClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('trips')
        .insert({
          destination: itinerary.destination,
          start_date: startDate,
          end_date: endDate,
          budget_tier: budget_tier,
          itinerary: itinerary.items,
        })
        .select('id')
        .single();

      if (error) console.warn('[trips] insert failed:', error.message);
      else tripId = data.id as string;
    }

    const payload: GenerateItineraryResponse = {
      tripId,
      destination: itinerary.destination,
      summary: itinerary.summary,
      startDate,
      endDate,
      budgetTier: budget_tier as BudgetTier,
      items: addActivityImages(itinerary.items, spots, events),
      sources: {
        spots: spots.length,
        events: events.length,
        placesConfigured: Boolean(process.env.GOOGLE_PLACES_API_KEY),
        ticketmasterConfigured: Boolean(process.env.TICKETMASTER_API_KEY),
      },
      persisted: tripId !== null,
      center: centroidOf(spots),
      // Named spots with coordinates, so stays can be ranked by walking distance.
      anchors: spots
        .filter((s) => s.lat !== null && s.lng !== null)
        .slice(0, 10)
        .map((s) => ({ name: s.name, lat: s.lat!, lng: s.lng! })),
    };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 500 });
    }
    if (err instanceof GenerationError) {
      const status = err.code === 'ANTHROPIC_RATE_LIMIT' ? 429 : 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    console.error('[generate-itinerary]', err);
    return NextResponse.json(
      { error: 'Could not generate an itinerary. Please try again.', code: 'INTERNAL' },
      { status: 500 }
    );
  }
}
