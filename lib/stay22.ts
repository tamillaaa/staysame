import type { Anchor, BudgetTier, GeoPoint, Proximity } from './types';

const BASE_URL = 'https://api.stay22.com/v2/accommodations';

/**
 * Per-night USD bands used to translate a budget tier into Stay22's min/max
 * filters. Stay22 only applies these when checkin/checkout are supplied.
 */
const PRICE_BANDS: Record<BudgetTier, { min?: number; max?: number }> = {
  shoestring: { max: 90 },
  mid: { min: 80, max: 260 },
  splurge: { min: 240 },
};

/** Splurge trips should skip unrated inventory; the others take what's there. */
const TIER_FILTERS: Record<BudgetTier, Record<string, string | number>> = {
  shoestring: {},
  mid: {},
  splurge: { minstarrating: 4 },
};

export type HotelPick = {
  /** Stay22's canonical id for the property. */
  id: string;
  name: string;
  location: string;
  /** Cheapest quoting supplier: 'booking' | 'expedia' | 'hotels' | 'vrbo' | ... */
  provider: string | null;
  pricePerNight: number | null;
  priceLabel: string;
  imageUrl: string | null;
  /** Allez deeplink — the booking CTA. */
  allezDeeplink: string | null;
  stars: number | null;
  guestRating: number | null;
  reviewCount: number | null;
  freeCancellation: boolean;
  description: string;
  type: string | null;
  lat: number | null;
  lng: number | null;
  /** Set once anchors are known; null when the trip has no located spots. */
  proximity: Proximity | null;
  /** Median metres to all itinerary spots; drives ranking, never displayed. */
  centralityMeters: number | null;
  blurb: string | null;
  raw: unknown;
};

export type HotelSearchResult = {
  picks: HotelPick[];
  checkin: string;
  checkout: string;
  nights: number;
  /** True when the tier's price band matched nothing and was dropped. */
  relaxedPriceFilter: boolean;
  /** True when the search was anchored on a supplied point, not the address. */
  centeredOnItinerary: boolean;
};

export class Stay22Error extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
  }
}

type RawSupplier = {
  id?: string;
  link?: string;
  price?: { total?: number } | null;
};

type RawListing = {
  id?: string;
  url?: string;
  name?: string;
  type?: string;
  suppliers?: Record<string, RawSupplier>;
  location?: {
    address?: string | null;
    coordinates?: { lat?: number; lng?: number } | null;
  };
  rating?: { value?: number | null; hotelStars?: number | null; count?: number | null };
  capacity?: { guests?: number | null; bedrooms?: number | null };
  policies?: { freeCancellation?: boolean; instantBook?: boolean };
  media?: { thumbnail?: string | null };
};

/** Cheapest supplier that actually quoted; `price` is null when unavailable. */
function cheapestSupplier(
  suppliers: Record<string, RawSupplier> | undefined
): { name: string; supplier: RawSupplier } | null {
  const quoted = Object.entries(suppliers ?? {}).filter(
    ([, s]) => typeof s?.price?.total === 'number'
  );
  if (!quoted.length) return null;
  return quoted
    .map(([name, supplier]) => ({ name, supplier }))
    .reduce((a, b) => ((a.supplier.price!.total ?? 0) <= (b.supplier.price!.total ?? 0) ? a : b));
}

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Stay22 returns no prose description, so compose one from the real fields. */
function buildDescription(raw: RawListing): string {
  const parts: string[] = [];
  if (raw.type) parts.push(raw.type);
  const beds = raw.capacity?.bedrooms;
  if (beds) parts.push(`${beds} bedroom${beds === 1 ? '' : 's'}`);
  if (raw.capacity?.guests) parts.push(`sleeps ${raw.capacity.guests}`);
  if (raw.rating?.value) {
    const count = raw.rating.count ? ` (${raw.rating.count} reviews)` : '';
    parts.push(`rated ${raw.rating.value}/10${count}`);
  }
  if (raw.policies?.freeCancellation) parts.push('free cancellation');
  return parts.join(' · ') || 'No details available.';
}

function transform(raw: RawListing, nights: number, currency: string): HotelPick {
  const cheapest = cheapestSupplier(raw.suppliers);
  const perNight =
    cheapest && nights > 0 ? Math.round((cheapest.supplier.price!.total ?? 0) / nights) : null;

  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name ?? 'Unnamed property',
    location: raw.location?.address ?? 'Location unavailable',
    provider: cheapest?.name ?? null,
    pricePerNight: perNight,
    priceLabel: perNight === null ? 'Price unavailable' : `${formatMoney(perNight, currency)}/night`,
    imageUrl: raw.media?.thumbnail ?? null,
    // Per-listing supplier deeplink; `url` is the provider-agnostic fallback.
    allezDeeplink: cheapest?.supplier.link ?? raw.url ?? null,
    stars: raw.rating?.hotelStars ?? null,
    guestRating: raw.rating?.value ?? null,
    reviewCount: raw.rating?.count ?? null,
    freeCancellation: raw.policies?.freeCancellation ?? false,
    description: buildDescription(raw),
    type: raw.type ?? null,
    lat: raw.location?.coordinates?.lat ?? null,
    lng: raw.location?.coordinates?.lng ?? null,
    proximity: null,
    centralityMeters: null,
    blurb: null,
    raw,
  };
}

async function callStay22(params: URLSearchParams) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.STAY22_API_KEY) headers['X-API-KEY'] = process.env.STAY22_API_KEY;

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}?${params}`, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Stay22Error(
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Stay22 took too long to respond. Please try again.'
        : 'Could not reach Stay22.',
      'STAY22_UNREACHABLE',
      504
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (detail) console.warn(`[stay22] HTTP ${response.status}:`, detail.slice(0, 200));

    // A 400 here is nearly always an unrecognized destination — user-fixable
    // input, so surface it as a 400 rather than a gateway error.
    const cases: Record<number, [number, string]> = {
      400: [400, 'We could not find stays for that destination. Try a nearby city.'],
      401: [500, 'Stay22 rejected the API key. Check STAY22_API_KEY in .env.local.'],
      403: [500, 'Stay22 rejected the API key. Check STAY22_API_KEY in .env.local.'],
      429: [
        429,
        process.env.STAY22_API_KEY
          ? 'Stay22 rate limit reached. Wait a moment and try again.'
          : 'Stay22 demo-mode rate limit reached (5 requests/min). Add STAY22_API_KEY to .env.local.',
      ],
    };
    const [status, message] = cases[response.status] ?? [
      502,
      `Stay22 is temporarily unavailable (HTTP ${response.status}).`,
    ];
    throw new Stay22Error(message, `STAY22_${response.status}`, status);
  }

  return (await response.json()) as {
    meta?: { nights?: number; currency?: string };
    results?: RawListing[];
  };
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

/** Average walking pace, ~4.8 km/h, rounded up to whole minutes. */
function walkMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / 80));
}

/** Distance from a stay to the closest thing on the itinerary — what we show. */
function nearestAnchor(pick: HotelPick, anchors: Anchor[]): Proximity | null {
  if (pick.lat === null || pick.lng === null || !anchors.length) return null;

  let best: Proximity | null = null;
  for (const anchor of anchors) {
    const meters = Math.round(haversineMeters(pick.lat, pick.lng, anchor.lat, anchor.lng));
    if (!best || meters < best.meters) {
      best = { spotName: anchor.name, meters, walkMinutes: walkMinutes(meters) };
    }
  }
  return best;
}

/**
 * Median distance to every spot — what we *rank* on.
 *
 * Ranking on the nearest spot alone rewards a hotel that happens to sit beside
 * one outlying attraction: a place next to the Oceanário would score "2 min
 * walk" while being 7km from the other nine stops. The median rewards a base
 * that's central to the whole itinerary.
 */
function centrality(pick: HotelPick, anchors: Anchor[]): number | null {
  if (pick.lat === null || pick.lng === null || !anchors.length) return null;
  const distances = anchors
    .map((a) => haversineMeters(pick.lat!, pick.lng!, a.lat, a.lng))
    .sort((a, b) => a - b);
  return distances[Math.floor(distances.length / 2)];
}

/**
 * Group key for near-duplicate listings.
 *
 * Operators list whole buildings as separate units — a raw top-5 for Lisbon
 * came back as five "… by Innkeeper" apartments in one complex, and later as
 * three units of one Rua da Rosa address. Collapsing by street means the
 * traveler sees five genuinely different places.
 */
function familyKey(pick: HotelPick): string {
  // Street name only. House and unit numbers vary between listings in the same
  // building ("Rua da Rosa 109 1º", "Rua da Rosa 109 2", "Rua da Rosa 111 r/c"),
  // so strip digits and unit markers to collapse them into one family.
  const street = pick.location
    .toLowerCase()
    .split(',')[0]
    .replace(/\d+/g, ' ')
    // Ordinal indicators are Unicode letters, so the \p{L} filter below would
    // keep them — leaving "rua da rosa º" unequal to "rua da rosa".
    .replace(/[ºª°]/g, ' ')
    .replace(/\b(r\/c|andar|piso|apt|apto|flat|unit|esq|dto|bl|bloco)\b/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Keyed on street alone. Including the operator was too fine-grained: the
  // same building gets listed by several operators, so three units of one
  // Rua da Rosa address still came back as three separate "choices".
  return street || pick.name.toLowerCase();
}

/**
 * Confidence-weighted rating, so a 10/10 from 3 reviews doesn't outrank a 9.2
 * from 400. Standard shrinkage toward the prior mean: the fewer the reviews,
 * the closer the score sits to `PRIOR_MEAN`.
 *
 * Ranking on the raw rating produced a Lisbon mid-tier list of five novelty
 * boat stays with near-perfect scores from a handful of reviews each.
 */
const PRIOR_MEAN = 8.2; // roughly the median guest rating Stay22 returns
const PRIOR_WEIGHT = 25; // reviews needed before the listing's own score dominates

function quality(pick: HotelPick): number {
  const rating = pick.guestRating;
  const base =
    rating === null
      ? PRIOR_MEAN - 1 // unrated sorts below rated
      : (() => {
          const count = pick.reviewCount ?? 0;
          return (
            (count / (count + PRIOR_WEIGHT)) * rating +
            (PRIOR_WEIGHT / (count + PRIOR_WEIGHT)) * PRIOR_MEAN
          );
        })();

  // Star class breaks ties between similarly-rated properties.
  let score = base * 10 + (pick.stars ?? 0);

  // Being central to the itinerary is worth real weight: a slightly worse-rated
  // place you can walk from beats a better one across town. Capped at 6km so a
  // remote outlier isn't penalised without limit.
  if (pick.centralityMeters !== null) {
    score -= (Math.min(pick.centralityMeters, 6000) / 1000) * PROXIMITY_PENALTY_PER_KM;
  }
  return score;
}

/** Points deducted per kilometre from the nearest itinerary spot. */
const PROXIMITY_PENALTY_PER_KM = 7;

/** Best listing from each family, best families first. */
function diversify(picks: HotelPick[], limit: number): HotelPick[] {
  const families = new Map<string, HotelPick>();
  for (const pick of picks) {
    const key = familyKey(pick);
    const incumbent = families.get(key);
    if (!incumbent || quality(pick) > quality(incumbent)) families.set(key, pick);
  }
  return [...families.values()].sort((a, b) => quality(b) - quality(a)).slice(0, limit);
}

/**
 * Search stays for a trip.
 *
 * Runs in Stay22's keyless demo mode (5 req/min) when STAY22_API_KEY is unset,
 * which is enough to exercise the flow locally.
 */
export async function searchStays(args: {
  destination: string;
  checkin: string;
  checkout: string;
  budgetTier: BudgetTier;
  limit?: number;
  /** Anchor point; falls back to geocoding `destination` when absent. */
  center?: GeoPoint | null;
  /** Itinerary spots, used to rank stays by walking distance. */
  anchors?: Anchor[];
}): Promise<HotelSearchResult> {
  const {
    destination,
    checkin,
    checkout,
    budgetTier,
    limit = 5,
    center = null,
    anchors = [],
  } = args;
  // Over-fetch so there's a real pool to diversify and rank from.
  const fetchSize = Math.min(Math.max(limit * 6, 30), 100);

  const band = PRICE_BANDS[budgetTier];
  const params = new URLSearchParams({
    checkin,
    checkout,
    adults: '2',
    rooms: '1',
    currency: 'USD',
    pageSize: String(fetchSize),
  });

  // Stay22's address geocoder is unreliable at city level, so search around the
  // itinerary's own centre when we have one.
  const useCenter = (on: boolean) => {
    params.delete('lat');
    params.delete('lng');
    params.delete('radius');
    params.delete('address');
    if (on && center) {
      params.set('lat', String(center.lat));
      params.set('lng', String(center.lng));
      params.set('radius', String(center.radiusMeters ?? 5000));
    } else {
      params.set('address', destination);
    }
  };
  useCenter(true);
  for (const [key, value] of Object.entries({ ...band, ...TIER_FILTERS[budgetTier] })) {
    params.set(key, String(value));
  }
  // Without an affiliate id Stay22 attributes bookings to its own default.
  if (process.env.STAY22_AID) params.set('aid', process.env.STAY22_AID);

  let body = await callStay22(params);

  // A spread-out destination ("Seychelles") can have no inventory near the
  // centroid of its attractions. Fall back to the address search rather than
  // reporting no stays at all.
  let centeredOnItinerary = center !== null;
  if (!body.results?.length && center) {
    useCenter(false);
    body = await callStay22(params);
    centeredOnItinerary = false;
  }

  // An expensive destination plus a tight band can filter everything out.
  // Rather than dead-ending, drop the band and show what's actually there.
  let relaxedPriceFilter = false;
  if (!body.results?.length && ('min' in band || 'max' in band)) {
    params.delete('min');
    params.delete('max');
    body = await callStay22(params);
    relaxedPriceFilter = Boolean(body.results?.length);
  }

  const nights = body.meta?.nights ?? 1;
  const currency = body.meta?.currency ?? 'USD';

  return {
    // Proximity has to be attached before ranking, since it feeds the score.
    picks: diversify(
      (body.results ?? [])
        .map((r) => transform(r, nights, currency))
        .map((pick) => ({
          ...pick,
          proximity: nearestAnchor(pick, anchors),
          centralityMeters: centrality(pick, anchors),
        })),
      limit
    ),
    checkin,
    checkout,
    nights,
    relaxedPriceFilter,
    centeredOnItinerary,
  };
}
