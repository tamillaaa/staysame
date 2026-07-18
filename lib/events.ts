import type { LiveEvent } from './types';

const TICKETMASTER_URL = 'https://app.ticketmaster.com/discovery/v2/events.json';

/** "Lisbon, Portugal" -> "Lisbon". Ticketmaster's `city` param wants a bare city. */
function cityOf(destination: string): string {
  return destination.split(',')[0].trim();
}

/**
 * Real events in the destination during the trip window.
 *
 * Returns an empty array when the key is missing or the call fails — the
 * itinerary is still generated, just without real events pinned to it.
 */
export async function fetchEvents(
  destination: string,
  startDate: string,
  endDate: string,
  limit = 15
): Promise<LiveEvent[]> {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    apikey: apiKey,
    city: cityOf(destination),
    // Ticketmaster wants a full ISO-8601 instant, not a bare date.
    startDateTime: `${startDate}T00:00:00Z`,
    endDateTime: `${endDate}T23:59:59Z`,
    size: String(Math.min(limit, 50)),
    sort: 'date,asc',
  });

  try {
    const response = await fetch(`${TICKETMASTER_URL}?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.warn(`[ticketmaster] HTTP ${response.status}`);
      return [];
    }

    const body = (await response.json()) as {
      _embedded?: {
        events?: Array<{
          name?: string;
          url?: string;
          dates?: { start?: { localDate?: string } };
          classifications?: Array<{ segment?: { name?: string } }>;
          _embedded?: {
            venues?: Array<{
              name?: string;
              location?: { latitude?: string; longitude?: string };
            }>;
          };
          images?: Array<{ url?: string; width?: number }>;
        }>;
      };
    };

    // No events in range is a normal, empty-bodied response, not an error.
    return (body._embedded?.events ?? []).slice(0, limit).map((e) => {
      const venue = e._embedded?.venues?.[0];
      const lat = Number(venue?.location?.latitude);
      const lng = Number(venue?.location?.longitude);
      return {
        name: e.name ?? 'Untitled event',
        date: e.dates?.start?.localDate ?? null,
        venue: venue?.name ?? null,
        url: e.url ?? null,
        category: e.classifications?.[0]?.segment?.name ?? null,
        imageUrl:
          [...(e.images ?? [])]
            .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0]?.url ?? null,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
      };
    });
  } catch (err) {
    console.warn('[ticketmaster] lookup failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
