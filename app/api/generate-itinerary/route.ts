import { NextResponse } from 'next/server';
import { ApiKeyError, GenerationError, generateItinerary } from '@/lib/claude';
import { pickDestination } from '@/lib/destinations';
import { fetchEvents } from '@/lib/events';
import { fetchTopSpots } from '@/lib/places';
import { getServiceClient } from '@/lib/supabase';
import { BUDGET_TIERS, CONTINENTS } from '@/lib/types';
import type {
  BudgetTier,
  Continent,
  GenerateItineraryRequest,
  GenerateItineraryResponse,
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
    const [spots, events] = await Promise.all([
      fetchTopSpots(destination),
      fetchEvents(destination, startDate, endDate),
    ]);

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
      items: itinerary.items,
      sources: {
        spots: spots.length,
        events: events.length,
        placesConfigured: Boolean(process.env.GOOGLE_PLACES_API_KEY),
        ticketmasterConfigured: Boolean(process.env.TICKETMASTER_API_KEY),
      },
      persisted: tripId !== null,
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
