import { GoogleGenAI } from '@google/genai';
import { PRICE_TIERS as PRICE_BANDS } from './stay22.js';

// gemini-2.5-flash is retired ("no longer available to new users"), so this
// pins the current flash model. Prefer an explicit version over the moving
// `gemini-flash-latest` alias so behavior doesn't shift underneath us.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

// Captions and destination suggestions are simple text tasks, so they run on
// the lite model — measured at ~1.2s vs ~4.9s for the same caption batch.
// Photo analysis stays on MODEL, where vision quality actually matters.
const LITE_MODEL = process.env.GEMINI_LITE_MODEL || 'gemini-3.1-flash-lite';

const ANALYZE_PROMPT = `You are a travel vibe analyst. Look at this image and extract structured data for a hotel search. Respond ONLY with valid JSON, no markdown, no preamble, matching this exact schema:
{
  "vibe": "beach" | "urban" | "mountain" | "rustic" | "luxury" | "minimalist",
  "amenities": ["string", ...],
  "destination_guess": "string or null",
  "price_tier": "budget" | "mid" | "luxury",
  "description": "one sentence describing the aesthetic, for display to the user",
  "narrative": "a wistful 2-3 sentence description of the imagined trip, written in second person, evocative but not overwrought"
}

For "narrative", write as if the trip is already happening to the reader. Ground it in specific physical detail drawn from the image — light, texture, temperature, sound — rather than abstract adjectives. Tone to aim for: "There's a version of you already there — bare feet on warm tile, a door that opens straight onto the water." Do not mention hotels, booking, or prices.`;

const STRICTER_REMINDER =
  'Your previous response could not be parsed as JSON. Return ONLY the raw JSON object. ' +
  'No markdown fences, no explanation, no trailing text. Start your response with { and end it with }.';

const VIBES = ['beach', 'urban', 'mountain', 'rustic', 'luxury', 'minimalist'];
const PRICE_TIERS = ['budget', 'mid', 'luxury'];

let client;

/**
 * Lazily construct the client so the server can boot (and serve a clear error)
 * even when GEMINI_API_KEY is missing.
 */
function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error(
      'GEMINI_API_KEY is not set. Copy server/.env.example to server/.env and add your key.'
    );
    err.status = 500;
    err.code = 'MISSING_GEMINI_KEY';
    throw err;
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

/** Gemini often wraps JSON in ```json fences despite being told not to. */
export function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** Reject a well-formed-but-wrong payload early rather than downstream. */
export function validateAnalysis(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Response was not a JSON object');
  }
  if (!VIBES.includes(data.vibe)) {
    throw new Error(`vibe was "${data.vibe}", expected one of ${VIBES.join(', ')}`);
  }
  if (!PRICE_TIERS.includes(data.price_tier)) {
    throw new Error(
      `price_tier was "${data.price_tier}", expected one of ${PRICE_TIERS.join(', ')}`
    );
  }
  return {
    vibe: data.vibe,
    amenities: Array.isArray(data.amenities) ? data.amenities.filter((a) => typeof a === 'string') : [],
    // The model tends to write the string "null" rather than a JSON null.
    destination_guess:
      typeof data.destination_guess === 'string' &&
      data.destination_guess.trim() &&
      data.destination_guess.trim().toLowerCase() !== 'null'
        ? data.destination_guess.trim()
        : null,
    price_tier: data.price_tier,
    description: typeof data.description === 'string' ? data.description : '',
    narrative: typeof data.narrative === 'string' ? data.narrative.trim() : '',
  };
}

/**
 * Analyze an inspiration photo and return structured search criteria.
 * Retries once with a stricter reminder if the first response won't parse.
 */
export async function analyzePhoto({ base64Image, mimeType }) {
  const ai = getClient();
  const imagePart = { inlineData: { data: base64Image, mimeType } };

  let lastError;
  for (const prompt of [ANALYZE_PROMPT, `${ANALYZE_PROMPT}\n\n${STRICTER_REMINDER}`]) {
    let raw;
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
      });
      raw = response.text;
    } catch (err) {
      // A transport/auth failure won't be fixed by re-prompting, so fail fast.
      throw wrapGeminiError(err);
    }

    try {
      return validateAnalysis(JSON.parse(stripCodeFences(raw ?? '')));
    } catch (err) {
      lastError = err;
      console.warn(`[gemini] unusable analysis response (${err.message}), retrying:`, raw);
    }
  }

  const err = new Error(
    `Gemini did not return usable JSON after a retry (${lastError.message}). Please try another photo.`
  );
  err.status = 502;
  err.code = 'GEMINI_BAD_JSON';
  throw err;
}

/**
 * Write a one-line "why this matches your photo" caption per listing, in a
 * single batched call. Stay22 exposes no amenity data, so the model compares
 * the photo's vibe against the structural facts we do get: property type, star
 * class, guest rating, price tier and location.
 */
export async function generateMatchCaptions({ analysis, listings }) {
  if (!listings.length) return [];

  const facts = listings.map((l, i) => ({
    index: i,
    name: l.name,
    type: l.type,
    location: l.location,
    stars: l.stars,
    guestRating: l.guestRating,
    reviewCount: l.reviewCount,
    pricePerNight: l.priceValue,
    sleeps: l.guests,
    bedrooms: l.bedrooms,
    freeCancellation: l.freeCancellation,
    gaps: findGaps(analysis, l),
  }));

  const prompt = `A traveler uploaded a photo with this vibe: "${analysis.vibe}", price tier "${analysis.price_tier}". Photo description: "${analysis.description}"

The photo suggested these features: ${analysis.amenities.join(', ') || 'none specified'}.

CRITICAL: our hotel data source provides NO amenity information. You do not know whether any of these properties has a pool, a view, a spa, a balcony or anything else. You know ONLY the fields below.

Here are the listings as JSON. The "gaps" array lists shortfalls we have actually verified:
${JSON.stringify(facts, null, 2)}

For each listing write ONE honest sentence, maximum 22 words, addressed to the traveler as "you".

- If "gaps" is non-empty: name the single most important gap plainly, then give one genuine strength as a counterweight. Example: "At $412 it runs past your budget, but you get a 5-star cliffside address."
- If "gaps" is empty: connect it warmly to the photo's vibe using ONE concrete detail — its star class, its guest score, or where it sits. Where the photo hinged on a specific feature, say that feature is unconfirmed.
- You may say a photo feature is unconfirmed — "we can't confirm the plunge pool" — but NEVER state that a property has or lacks one. Claiming "no pool here" is a lie: we have no such data.

Style rules:
- The card already displays the price, guest rating, review count and capacity. Do NOT restate them as figures. The one exception: when price is the gap, naming the amount is the point.
- Never write a spec list like "5-star hotel with a 9 rating and 301 reviews at 686 dollars per night". Say something the card does not already say.
- These captions appear stacked in a grid, so they must not read as variations of one template. Vary the sentence shape across the set and never open two captions the same way.
- Raise an unconfirmed photo feature on at most a third of the listings, and phrase it plainly ("we can't promise the plunge pool") rather than legalistically ("we cannot verify the existence of"). For the rest, simply say what the place is.
- No marketing language. Do not oversell.
- Banned words: might, could, may, perhaps, possibly, likely, probably, seems, appears.

Respond ONLY with a valid JSON array of objects, no markdown:
[{"index": 0, "caption": "..."}, ...]`;

  try {
    const response = await getClient().models.generateContent({
      model: LITE_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const captions = JSON.parse(stripCodeFences(response.text ?? ''));
    if (!Array.isArray(captions)) throw new Error('not an array');

    const byIndex = new Map(
      captions
        .filter((c) => c && typeof c.caption === 'string')
        .map((c) => [c.index, c.caption])
    );
    return listings.map((l, i) => byIndex.get(i) ?? fallbackCaption(analysis, l));
  } catch (err) {
    // Captions are a nice-to-have; never fail the search over them.
    console.warn('[gemini] caption generation failed, using rule-based fallback:', err.message);
    return listings.map((l) => fallbackCaption(analysis, l));
  }
}

/**
 * Used when "Anywhere" is picked and the suggestion call fails. Broad regions
 * like "Southeast Asia" geocode badly on Stay22 (it once matched a village in
 * Czechia), so every entry here is a specific, unambiguous place.
 */
const FALLBACK_DESTINATIONS = {
  beach: ['Tulum, Mexico', 'Zanzibar, Tanzania', 'Palawan, Philippines'],
  urban: ['Tokyo, Japan', 'Lisbon, Portugal', 'Mexico City, Mexico'],
  mountain: ['Chamonix, France', 'Banff, Canada', 'Queenstown, New Zealand'],
  rustic: ['Tuscany, Italy', 'Cotswolds, England', 'Asheville, North Carolina'],
  luxury: ['Santorini, Greece', 'Dubai, UAE', 'Amalfi Coast, Italy'],
  minimalist: ['Kyoto, Japan', 'Copenhagen, Denmark', 'Reykjavik, Iceland'],
};

/**
 * Pick real destinations matching a photo's vibe, for "Anywhere" searches.
 * Falls back to a curated list if Gemini is unavailable or returns junk.
 */
export async function suggestDestinations({ analysis, count = 3 }) {
  const fallback = (FALLBACK_DESTINATIONS[analysis.vibe] ?? FALLBACK_DESTINATIONS.beach).slice(
    0,
    count
  );

  const prompt = `A traveler's inspiration photo has this vibe: "${analysis.vibe}", price tier "${analysis.price_tier}", desired amenities: ${analysis.amenities.join(', ') || 'none specified'}. Photo description: "${analysis.description}"

Name exactly ${count} real travel destinations that match this vibe and budget. Requirements:
- Each must be a specific, unambiguous place a hotel search can geocode: either "City, Country" or a well-known named region like "Amalfi Coast, Italy" or "Tuscany, Italy".
- Do NOT use vague or continent-scale terms like "Southeast Asia", "the Caribbean" or "Europe".
- Spread them across different countries for variety.

Respond ONLY with a valid JSON array of strings, no markdown:
["City, Country", "City, Country", "City, Country"]`;

  try {
    const response = await getClient().models.generateContent({
      model: LITE_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const parsed = JSON.parse(stripCodeFences(response.text ?? ''));

    // A bare country or one-word answer geocodes unpredictably, so require a
    // comma-separated "place, country" shape before trusting it.
    const usable = Array.isArray(parsed)
      ? parsed.filter((d) => typeof d === 'string' && d.includes(',') && d.trim().length > 3)
      : [];

    return usable.length ? usable.slice(0, count) : fallback;
  } catch (err) {
    console.warn('[gemini] destination suggestion failed, using curated list:', err.message);
    return fallback;
  }
}

/**
 * Turn whatever the traveler typed into destinations Stay22 can actually
 * search well.
 *
 * Stay22 resolves a country to a single arbitrary point and searches ~10km
 * around it, so "Portugal" returned inland guesthouses in a village called
 * Bicas and "Italy" returned a mountain town for a beach photo. Broad inputs
 * are therefore expanded into specific places within them that match the vibe;
 * an already-specific city is passed through untouched.
 */
export async function resolveDestinations({ analysis, location, count = 3 }) {
  const typed = location.trim();

  const prompt = `A traveler searching for hotels typed this destination: "${typed}"

Their inspiration photo has this vibe: "${analysis.vibe}", price tier "${analysis.price_tier}", desired amenities: ${analysis.amenities.join(', ') || 'none specified'}. Photo description: "${analysis.description}"

Decide which case applies:

1. If "${typed}" is already a specific searchable place (a city, town, island, resort area or neighbourhood), return just that one place, normalized to "Place, Country".

2. If "${typed}" is a country, state, province or large region, it is too broad to search directly. Return the ${count} best specific destinations WITHIN it that match the traveler's vibe and budget. For a "${analysis.vibe}" vibe, choose places genuinely known for that — a beach vibe in Portugal means coastal areas like the Algarve, never an inland village.

Rules for every destination you return:
- Must be specific enough for a hotel search to geocode to the right area.
- Format as "Place, Country" (for example "Lagos, Portugal", "Amalfi Coast, Italy", "Niseko, Japan").
- Never return a bare country name on its own.
- Stay inside "${typed}" — do not suggest places in other countries.

Respond ONLY with valid JSON, no markdown:
{"broad": true or false, "destinations": ["Place, Country", ...]}`;

  try {
    const response = await getClient().models.generateContent({
      model: LITE_MODEL,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const parsed = JSON.parse(stripCodeFences(response.text ?? ''));

    const usable = (Array.isArray(parsed?.destinations) ? parsed.destinations : []).filter(
      (d) => typeof d === 'string' && d.includes(',') && d.trim().length > 3
    );
    if (!usable.length) throw new Error('no usable destinations returned');

    const expanded = Boolean(parsed.broad) && usable.length > 1;
    return { destinations: usable.slice(0, expanded ? count : 1), expanded };
  } catch (err) {
    // Fall back to searching exactly what was typed — worse results for a
    // country, but never worse than failing the search outright.
    console.warn('[gemini] destination resolution failed, using raw input:', err.message);
    return { destinations: [typed], expanded: false };
  }
}

/**
 * Shortfalls we can actually prove from Stay22's data, so the caption model
 * names real gaps instead of inventing amenity ones. Amenities are deliberately
 * absent here: the API returns none, so any claim about them would be fiction.
 */
function findGaps(analysis, listing) {
  const gaps = [];
  const band = PRICE_BANDS[analysis.price_tier];

  if (listing.priceValue && band?.max && listing.priceValue > band.max) {
    gaps.push(
      `costs $${listing.priceValue}/night, above the ${analysis.price_tier} range (up to $${band.max})`
    );
  }
  if (analysis.vibe === 'luxury' && listing.stars && listing.stars < 4) {
    gaps.push(`is only ${listing.stars}-star, below the luxury feel of the photo`);
  }
  if (listing.guestRating && listing.guestRating < 8) {
    gaps.push(`is rated ${listing.guestRating}/10, lower than the others here`);
  }
  if (listing.reviewCount !== null && listing.reviewCount < 10) {
    gaps.push(`has only ${listing.reviewCount} reviews, so the rating is unproven`);
  }
  if (!listing.priceValue) {
    gaps.push('has no live price for these dates');
  }
  return gaps;
}

/** Deterministic caption used when the caption model call fails. */
function fallbackCaption(analysis, listing) {
  const [gap] = findGaps(analysis, listing);
  if (gap) {
    const strength = listing.stars
      ? `a ${listing.stars}-star ${(listing.type ?? 'stay').toLowerCase()}`
      : (listing.type ?? 'stay').toLowerCase();
    return `This one ${gap} — but it's still ${strength} in ${analysis.vibe} territory.`;
  }

  const bits = [];
  if (listing.stars) bits.push(`${listing.stars}-star`);
  bits.push(listing.type ? listing.type.toLowerCase() : 'stay');
  if (listing.guestRating) bits.push(`rated ${listing.guestRating}/10`);
  return `A ${bits.join(' ')} matching your ${analysis.vibe} vibe.`;
}

function wrapGeminiError(err) {
  const status = err?.status ?? err?.code;
  const wrapped = new Error();
  if (status === 400 || status === 401 || status === 403) {
    wrapped.message = 'Gemini rejected the API key. Check GEMINI_API_KEY in server/.env.';
    wrapped.status = 500;
    wrapped.code = 'GEMINI_AUTH';
  } else if (status === 429) {
    wrapped.message = 'Gemini rate limit reached. Wait a moment and try again.';
    wrapped.status = 429;
    wrapped.code = 'GEMINI_RATE_LIMIT';
  } else {
    wrapped.message = `Gemini request failed: ${err?.message ?? 'unknown error'}`;
    wrapped.status = 502;
    wrapped.code = 'GEMINI_UNAVAILABLE';
  }
  return wrapped;
}
