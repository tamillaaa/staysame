import { GoogleGenAI } from '@google/genai';

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
  "description": "one sentence describing the aesthetic, for display to the user"
}`;

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
    pricePerNight: l.price,
    freeCancellation: l.freeCancellation,
  }));

  const prompt = `A traveler uploaded a photo with this vibe: "${analysis.vibe}", price tier "${analysis.price_tier}", and these desired amenities: ${analysis.amenities.join(', ') || 'none specified'}. Photo description: "${analysis.description}"

Here are hotel listings as JSON:
${JSON.stringify(facts, null, 2)}

For each listing, write one short sentence (max 15 words) explaining why it matches the traveler's photo. Reference concrete details from the listing (its type, star rating, guest score, or location). Do not invent amenities that are not listed.

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

/** Deterministic caption used when the caption model call fails. */
function fallbackCaption(analysis, listing) {
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
