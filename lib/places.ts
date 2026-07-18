import type { GeoPoint, Spot } from './types';

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Top-rated attractions for a destination, used to ground the itinerary in real
 * places rather than whatever the model recalls.
 *
 * Returns an empty array when the key is missing or the call fails — a missing
 * spot list degrades the itinerary, it doesn't break it.
 */
async function fetchSpots(query: string, limit: number): Promise<Spot[]> {
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
          'places.location',
          'places.photos',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: query,
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
        location?: { latitude?: number; longitude?: number };
        photos?: Array<{ name?: string }>;
      }>;
    };

    return (body.places ?? [])
      .map((p) => ({
        name: p.displayName?.text ?? 'Unnamed place',
        address: p.formattedAddress ?? '',
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? null,
        types: p.types ?? [],
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        photoName: p.photos?.[0]?.name ?? null,
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

export function fetchTopSpots(destination: string, limit = 12): Promise<Spot[]> {
  return fetchSpots(`top rated tourist attractions in ${destination}`, limit);
}

/** Real restaurants and cafés so meal stops are useful, not model inventions. */
export function fetchFoodSpots(destination: string, limit = 10): Promise<Spot[]> {
  return fetchSpots(`top rated local restaurants and cafes in ${destination}`, limit);
}

/**
 * Centre of the attractions an itinerary is built around.
 *
 * Stay22's `address` geocoder is unreliable at city level — "Lisbon",
 * "Baixa, Lisbon" and "Alfama, Lisbon" all resolve to the same point 5.5km
 * northeast of the centre, in Parque das Nações. Searching around the actual
 * spots puts hotels where the traveler will actually spend their days.
 */
export function centroidOf(spots: Spot[]): GeoPoint | null {
  const located = spots.filter((s) => s.lat !== null && s.lng !== null);
  if (!located.length) return null;

  const lat = located.reduce((sum, s) => sum + s.lat!, 0) / located.length;
  const lng = located.reduce((sum, s) => sum + s.lng!, 0) / located.length;

  // A compact city centre wants a tight radius; a spread-out destination (an
  // island nation, a national park) needs a wide one, or the search finds
  // nothing. Size it from how far the spots actually scatter.
  const spread = Math.max(...located.map((s) => haversineMeters(lat, lng, s.lat!, s.lng!)));
  const radiusMeters = Math.round(Math.min(Math.max(spread * 1.25, 4000), 40000));

  return { lat, lng, radiusMeters };
}

/** Great-circle distance in metres. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
