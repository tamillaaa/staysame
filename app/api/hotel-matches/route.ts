import { NextResponse } from 'next/server';
import { Stay22Error, searchStays } from '@/lib/stay22';
import { getServiceClient } from '@/lib/supabase';
import { BUDGET_TIERS } from '@/lib/types';
import type { BudgetTier } from '@/lib/types';
import type { HotelMatchesRequest, HotelMatchesResponse } from '@/lib/types';

function bad(error: string, code: string) {
  return NextResponse.json({ error, code }, { status: 400 });
}

export async function POST(request: Request) {
  let body: HotelMatchesRequest;
  try {
    body = await request.json();
  } catch {
    return bad('Request body must be JSON.', 'BAD_JSON');
  }

  const { destination, checkin, checkout, budget_tier, trip_id, center } = body ?? {};

  if (!destination?.trim()) return bad('destination is required.', 'MISSING_DESTINATION');
  if (!BUDGET_TIERS.includes(budget_tier)) {
    return bad(`budget_tier must be one of: ${BUDGET_TIERS.join(', ')}.`, 'BAD_BUDGET_TIER');
  }
  const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!isDate(checkin) || !isDate(checkout)) {
    return bad('checkin and checkout must be YYYY-MM-DD.', 'BAD_DATES');
  }
  if (checkout < checkin) return bad('checkout must be on or after checkin.', 'BAD_DATE_ORDER');

  try {
    const result = await searchStays({
      destination: destination.trim(),
      checkin,
      checkout,
      budgetTier: budget_tier as BudgetTier,
      center: center ?? null,
    });

    if (!result.picks.length) {
      return NextResponse.json(
        {
          error: `No stays available in ${destination} for those dates.`,
          code: 'NO_RESULTS',
        },
        { status: 404 }
      );
    }

    // Persist alongside the trip when both Supabase and a trip id are present.
    // A failure here must not lose the results the user is waiting on.
    let persisted = false;
    const supabase = getServiceClient();
    if (supabase && trip_id) {
      const { error } = await supabase.from('hotel_picks').insert(
        result.picks.map((pick) => ({
          trip_id,
          provider: pick.provider,
          name: pick.name,
          price_per_night: pick.pricePerNight,
          allez_deeplink: pick.allezDeeplink,
          raw: pick.raw,
        }))
      );
      if (error) console.warn('[hotel_picks] insert failed:', error.message);
      else persisted = true;
    }

    // `raw` is only needed for persistence; don't ship it to the browser.
    const payload: HotelMatchesResponse = {
      destination: destination.trim(),
      checkin: result.checkin,
      checkout: result.checkout,
      nights: result.nights,
      relaxedPriceFilter: result.relaxedPriceFilter,
      centeredOnItinerary: result.centeredOnItinerary,
      affiliateConfigured: Boolean(process.env.STAY22_AID),
      persisted,
      picks: result.picks.map(({ raw, ...pick }) => pick),
    };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof Stay22Error) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[hotel-matches]', err);
    return NextResponse.json(
      { error: 'Could not search for stays. Please try again.', code: 'INTERNAL' },
      { status: 500 }
    );
  }
}
