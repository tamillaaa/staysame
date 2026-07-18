const BASE_URL = 'https://api.stay22.com/v2/accommodations';

/**
 * Stay22 quotes a price only when checkin/checkout are supplied, and the `min`
 * and `max` filters are ignored without them. Since Ghostwriter's flow has no
 * date picker yet, we search a representative near-future window so cards can
 * show a real nightly rate.
 */
const DEFAULT_LEAD_DAYS = 30;
const DEFAULT_NIGHTS = 3;

/** Per-night USD bands used to translate Gemini's price_tier into min/max. */
const PRICE_TIERS = {
  budget: { max: 120 },
  mid: { min: 100, max: 300 },
  luxury: { min: 275 },
};

/**
 * Stay22 has no amenity data or amenity filter, so vibe can only steer the
 * structural filters the API does expose: property type and star class.
 */
const VIBE_FILTERS = {
  beach: {},
  urban: { type: 'hotel' },
  mountain: { type: 'rental' },
  rustic: { type: 'rental' },
  luxury: { type: 'hotel', minstarrating: 4 },
  minimalist: {},
};

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function defaultDates() {
  const checkin = new Date(Date.now() + DEFAULT_LEAD_DAYS * 86400000);
  const checkout = new Date(checkin.getTime() + DEFAULT_NIGHTS * 86400000);
  return { checkin: isoDate(checkin), checkout: isoDate(checkout) };
}

/**
 * Pick the cheapest supplier that actually quoted a price. Stay22 returns a
 * supplier map where `price` is null for suppliers with no availability.
 */
function cheapestSupplier(suppliers) {
  const quoted = Object.values(suppliers ?? {}).filter(
    (s) => typeof s?.price?.total === 'number'
  );
  if (!quoted.length) return null;
  return quoted.reduce((a, b) => (a.price.total <= b.price.total ? a : b));
}

function transformListing(raw, { nights, currency }) {
  const supplier = cheapestSupplier(raw.suppliers);
  const perNight =
    supplier && nights > 0 ? Math.round(supplier.price.total / nights) : null;

  return {
    name: raw.name ?? 'Unnamed property',
    location: raw.location?.address ?? 'Location unavailable',
    price: perNight === null ? 'Price unavailable' : `${formatMoney(perNight, currency)}/night`,
    imageUrl: raw.media?.thumbnail ?? 'https://placehold.co/400x300?text=No+photo',
    // `link` is the supplier deeplink; `url` is the provider-agnostic fallback.
    bookingUrl: supplier?.link ?? raw.url ?? null,
    description: buildDescription(raw),

    // Retained for caption generation; not rendered directly.
    type: raw.type ?? null,
    stars: raw.rating?.hotelStars ?? null,
    guestRating: raw.rating?.value ?? null,
    freeCancellation: raw.policies?.freeCancellation ?? false,
  };
}

function formatMoney(amount, currency) {
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
function buildDescription(raw) {
  const parts = [];
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

/**
 * Search Stay22 for stays matching a photo analysis.
 *
 * Runs in Stay22's keyless demo mode (5 req/min) when STAY22_API_KEY is unset,
 * which is enough to exercise the flow locally.
 */
export async function searchStays({ analysis, location, checkin, checkout, limit = 9 }) {
  const destination = location?.trim() || analysis.destination_guess;
  if (!destination) {
    const err = new Error('No destination provided or detected from the photo.');
    err.status = 400;
    err.code = 'MISSING_DESTINATION';
    throw err;
  }

  const dates = checkin && checkout ? { checkin, checkout } : defaultDates();
  const tier = PRICE_TIERS[analysis.price_tier] ?? {};
  const vibe = VIBE_FILTERS[analysis.vibe] ?? {};

  const params = new URLSearchParams({
    address: destination,
    checkin: dates.checkin,
    checkout: dates.checkout,
    adults: '2',
    rooms: '1',
    currency: 'USD',
    pageSize: String(limit),
  });
  for (const [key, value] of Object.entries({ ...tier, ...vibe })) {
    params.set(key, String(value));
  }

  if (process.env.STAY22_AID) params.set('aid', process.env.STAY22_AID);

  let body = await fetchStays(params);

  // An expensive destination plus a "budget" tier can filter everything out.
  // Rather than dead-ending, drop the price band and show what's actually there.
  let relaxed = false;
  if (!body.results?.length && ('min' in tier || 'max' in tier)) {
    params.delete('min');
    params.delete('max');
    body = await fetchStays(params);
    relaxed = body.results?.length > 0;
  }

  const nights = body.meta?.nights ?? DEFAULT_NIGHTS;
  const currency = body.meta?.currency ?? 'USD';
  const listings = (body.results ?? []).map((r) => transformListing(r, { nights, currency }));

  return {
    listings,
    destination,
    checkin: dates.checkin,
    checkout: dates.checkout,
    nights,
    relaxedPriceFilter: relaxed,
  };
}

async function fetchStays(params) {
  const headers = { Accept: 'application/json' };
  if (process.env.STAY22_API_KEY) headers['X-API-KEY'] = process.env.STAY22_API_KEY;

  let response;
  try {
    response = await fetch(`${BASE_URL}?${params}`, {
      headers,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    const wrapped = new Error(
      err.name === 'TimeoutError'
        ? 'Stay22 took too long to respond. Please try again.'
        : `Could not reach Stay22: ${err.message}`
    );
    wrapped.status = 504;
    wrapped.code = 'STAY22_UNREACHABLE';
    throw wrapped;
  }

  if (!response.ok) throw await stay22Error(response);
  return response.json();
}

async function stay22Error(response) {
  // Upstream 400 bodies are generic ("Upstream API error: HTTP 400"), so log
  // them for debugging but show the traveler something they can act on.
  const detail = await response.text().catch(() => '');
  if (detail) console.warn(`[stay22] HTTP ${response.status}:`, detail.slice(0, 300));

  // A 400 here is nearly always an unrecognized destination — user-fixable
  // input, so pass it through as a 400 rather than masking it as a gateway error.
  const cases = {
    400: [400, 'We could not find that destination. Try a city name, like "Lisbon, Portugal".'],
    401: [500, 'Stay22 rejected the API key. Check STAY22_API_KEY in server/.env.'],
    403: [500, 'Stay22 rejected the API key. Check STAY22_API_KEY in server/.env.'],
    429: [
      429,
      process.env.STAY22_API_KEY
        ? 'Stay22 rate limit reached. Please wait a moment and try again.'
        : 'Stay22 demo-mode rate limit reached (5 requests/min). Add STAY22_API_KEY to server/.env to raise it.',
    ],
  };

  const [status, message] = cases[response.status] ?? [
    502,
    `Stay22 is temporarily unavailable (HTTP ${response.status}). Please try again.`,
  ];

  const err = new Error(message);
  err.status = status;
  err.code = `STAY22_${response.status}`;
  return err;
}
