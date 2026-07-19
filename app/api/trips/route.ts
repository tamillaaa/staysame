import { NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/supabase';

/**
 * Create a bare trip row from the photo flow.
 *
 * When someone confirms a stay straight from a photo they have a destination
 * but no itinerary yet, and the Connect tab needs a trip to hang a traveler
 * code off. The schema requires `itinerary` to be non-null, so it starts as an
 * empty array and the itinerary generator fills it in later.
 */
export async function POST(request: Request) {
  let body: { destination?: string; source_image_url?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.', code: 'BAD_JSON' }, { status: 400 });
  }

  const destination = body?.destination?.trim();
  if (!destination) {
    return NextResponse.json(
      { error: 'destination is required.', code: 'MISSING_DESTINATION' },
      { status: 400 }
    );
  }

  const supabase = getServiceClient();
  // Without Supabase there's nothing to save; report it rather than erroring,
  // so the flow still works locally.
  if (!supabase) return NextResponse.json({ tripId: null, persisted: false });

  const { data, error } = await supabase
    .from('trips')
    .insert({
      destination,
      source_image_url: body.source_image_url ?? null,
      itinerary: [],
    })
    .select('id')
    .single();

  if (error) {
    console.warn('[trips] insert failed:', error.message);
    return NextResponse.json({ tripId: null, persisted: false });
  }

  return NextResponse.json({ tripId: data.id as string, persisted: true });
}
