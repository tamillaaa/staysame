import type { Spot } from './types';

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Top-rated attractions for a destination, used to ground the itinerary in real
 * places rather than whatever the model recalls.
 *
 * Returns an empty array when the key is missing or the call fails — a missing
 * spot list degrades the itinerary, it doesn't break it.
 */
export async function fetchTopSpots(destination: string, limit = 12): Promise<Spot[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch(PLACES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // Field mask is required by the Places v1 API and controls billing tier.
        'X-Goog-FieldMask': [
          'places.displayName',
          'places.formattedAddress',
          'places.rating',
          'places.userRatingCount',
          'places.types',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: `top rated tourist attractions in ${destination}`,
        maxResultCount: Math.min(limit, 20),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[places] HTTP ${response.status}:`, (await response.text()).slice(0, 200));
      return [];
    }

    const body = (await response.json()) as {
      places?: Array<{
        displayName?: { text?: string };
        formattedAddress?: string;
        rating?: number;
        userRatingCount?: number;
        types?: string[];
      }>;
    };

    return (body.places ?? [])
      .map((p) => ({
        name: p.displayName?.text ?? 'Unnamed place',
        address: p.formattedAddress ?? '',
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? null,
        types: p.types ?? [],
      }))
      .filter((s) => s.name !== 'Unnamed place')
      // Highest-rated first, so the model sees the best options at the top.
      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, limit);
  } catch (err) {
    console.warn('[places] lookup failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
