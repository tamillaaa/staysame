import { GoogleGenAI } from '@google/genai';
import type { ItineraryItem, VibeAnalysis, VibeSuggestion } from './types';

// The spec named gemini-2.5-flash, but it is retired and returns
// `404 — no longer available to new users` on a current key. This is the
// equivalent current flash model; override with GEMINI_MODEL if needed.
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ALBUM_PHOTOS = 10;

export class VibeError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number
  ) {
    super(message);
  }
}

const PROMPT = `Look at this image and describe its aesthetic/mood in 5-8 tags
(e.g. moody, minimalist, tropical, gritty-urban, cozy, coastal, retro, luxe).
Then suggest 3 real cities/regions worldwide that genuinely match this aesthetic,
with a one-sentence reason each explaining the visual/cultural connection.

Also list 4-8 "listing_keywords": words that would plausibly appear in the NAME
of a hotel or rental matching this aesthetic (e.g. "sea view", "terrace",
"loft", "villa", "riad", "chalet"). These are matched against real listing
names, so use concrete nouns a property would actually be called, not mood
words.

Return strict JSON only, no markdown fences:
{
  "tags": string[],
  "listing_keywords": string[],
  "suggestions": [
    { "destination": string, "reason": string }
  ]
}

Rules for the suggestions:
- Exactly 3, all real places a traveler can book a hotel in. Prefer a city or a
  well-known named region ("Lisbon, Portugal", "Amalfi Coast, Italy") over a
  whole country, so a hotel search can geocode it.
- Make them genuinely different from each other — three cities on the same coast
  is a weak answer.
- The reason names what in the image connects to that place. Do not describe the
  image back to the reader in general terms.`;

const STRICTER_RETRY =
  'Your previous response could not be parsed. Return ONLY the raw JSON object, ' +
  'starting with { and ending with }. No markdown fences, no commentary.';

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new VibeError(
      'GEMINI_API_KEY is not set. Add it to .env.local to read photos.',
      'MISSING_GEMINI_KEY',
      500
    );
  }
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

/** responseMimeType usually prevents fences, but the model still adds them sometimes. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** Reject a well-formed-but-useless payload here rather than downstream. */
function validate(data: unknown): VibeAnalysis {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('response was not a JSON object');
  }
  const record = data as Record<string, unknown>;

  const tags = Array.isArray(record.tags)
    ? record.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : [];
  if (tags.length < 3) throw new Error(`expected at least 3 tags, got ${tags.length}`);

  // Optional: the mood tags rarely appear in listing names, so these carry the
  // actual matching signal. Absent is fine — scoring falls back to the tags.
  const listingKeywords = Array.isArray(record.listing_keywords)
    ? record.listing_keywords
        .filter((k): k is string => typeof k === 'string' && k.trim().length > 2)
        .map((k) => k.trim().toLowerCase())
        .slice(0, 8)
    : [];

  const rawSuggestions = Array.isArray(record.suggestions) ? record.suggestions : [];
  const suggestions: VibeSuggestion[] = rawSuggestions
    .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
    .map((s) => ({
      destination: typeof s.destination === 'string' ? s.destination.trim() : '',
      reason: typeof s.reason === 'string' ? s.reason.trim() : '',
    }))
    .filter((s) => s.destination.length > 0);

  // The spec calls for 3; fewer than 3 is a retry-worthy failure.
  if (suggestions.length < 3) {
    throw new Error(`expected 3 suggestions, got ${suggestions.length}`);
  }

  return { tags: tags.slice(0, 8), listingKeywords, suggestions: suggestions.slice(0, 3) };
}

/**
 * Read a photo's aesthetic and suggest matching destinations.
 * Retries once with a stricter reminder if the first response won't parse.
 */
export async function analyzeVibe(args: {
  base64Image: string;
  mimeType: string;
}): Promise<VibeAnalysis> {
  const ai = getClient();
  const imagePart = { inlineData: { data: args.base64Image, mimeType: args.mimeType } };

  let lastError: Error | null = null;

  for (const prompt of [PROMPT, `${PROMPT}\n\n${STRICTER_RETRY}`]) {
    let raw: string | undefined;
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [imagePart, { text: prompt }] }],
        config: { responseMimeType: 'application/json' },
      });
      raw = response.text;
    } catch (err) {
      // A transport or auth failure won't be fixed by re-prompting.
      throw wrapGeminiError(err);
    }

    try {
      return validate(JSON.parse(stripFences(raw ?? '')));
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[gemini] unusable vibe response (${lastError.message}), retrying:`, raw);
    }
  }

  throw new VibeError(
    `We couldn't read that photo (${lastError?.message ?? 'unknown error'}). Try another one.`,
    'GEMINI_BAD_JSON',
    502
  );
}

function buildAlbumCaptionPrompt(count: number): string {
  return `You're captioning a traveler's own photos for a private trip photo album — not stock photography, their actual memories.

For each of the ${count} images below, write exactly one short caption (12-20 words) that's warm and a little romanticized — the way a well-kept travel diary captions a photo, not a literal description of pixels. Capture the feeling of the moment, not a list of objects in frame.

Do not invent a specific place, business, or street name unless it is clearly visible in the image itself (a sign, a landmark you are certain of). When in doubt, describe the scene and mood instead of guessing a name.

Return strict JSON only, no markdown fences:
{ "captions": string[] }
with exactly ${count} entries, in the same order as the images.`;
}

function validateCaptions(data: unknown, count: number): string[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('response was not a JSON object');
  }
  const record = data as Record<string, unknown>;
  const captions = Array.isArray(record.captions)
    ? record.captions.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map((c) => c.trim())
    : [];
  if (captions.length !== count) {
    throw new Error(`expected ${count} captions, got ${captions.length}`);
  }
  return captions;
}

/**
 * Caption a batch of the traveler's own trip photos in one call, so the
 * captions read as a consistent set rather than N independent guesses.
 * Retries once with a stricter reminder if the count doesn't match.
 */
export async function captionAlbum(
  photos: Array<{ base64Image: string; mimeType: string }>
): Promise<string[]> {
  const ai = getClient();
  const imageParts = photos.map((p) => ({ inlineData: { data: p.base64Image, mimeType: p.mimeType } }));
  const basePrompt = buildAlbumCaptionPrompt(photos.length);

  let lastError: Error | null = null;

  for (const prompt of [basePrompt, `${basePrompt}\n\n${STRICTER_RETRY}`]) {
    let raw: string | undefined;
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }],
        config: { responseMimeType: 'application/json' },
      });
      raw = response.text;
    } catch (err) {
      throw wrapGeminiError(err);
    }

    try {
      return validateCaptions(JSON.parse(stripFences(raw ?? '')), photos.length);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[gemini] unusable album caption response (${lastError.message}), retrying:`, raw);
    }
  }

  throw new VibeError(
    `We couldn't caption those photos (${lastError?.message ?? 'unknown error'}). Try again.`,
    'GEMINI_BAD_JSON',
    502
  );
}

const NARRATION_SYSTEM =
  'You are a warm, evocative travel narrator recording a short audio recap for someone about to relive their trip. You write for the ear, not the page — natural spoken rhythm, no visual formatting, and you never invent a detail that was not given to you.';

function buildNarrationPrompt(args: {
  destination: string;
  summary: string;
  items: ItineraryItem[];
}): string {
  const { destination, summary, items } = args;

  const itemsBlock = items
    .map(
      (item, i) =>
        `${i + 1}. Day ${item.day}, ${item.time_block}${item.is_side_quest ? ' (side quest)' : ''} — ${item.activity}: ${item.description}`
    )
    .join('\n');

  // ~150 spoken words/min; aim for a tight 45-75 second recap regardless of how many items were picked.
  const wordBudget = Math.min(220, 90 + items.length * 25);

  return `Write a short audio narration script recapping a trip to ${destination}.

Trip summary: ${summary}

The traveler picked these moments to include, in order:
${itemsBlock}

Write ONE continuous piece of spoken narration — not a list, not a script with labels — that walks through these moments and captures the feeling of the trip. For each moment, evoke what it is and its vibe using only the description given; do not invent details, prices, or places not listed above. Use natural spoken transitions between moments ("Then, as the evening cools down...") rather than announcing "Day 2" or "afternoon" like a label.

Rules:
- Second person, present or future tense ("You start the morning...").
- Sensory and vivid, but grounded — nothing invented beyond what's in the descriptions above.
- Around ${wordBudget} words total. This is a short recap, not the full itinerary read aloud.
- No headers, no bullet points, no markdown — plain spoken prose only, ready to feed directly to a text-to-speech engine.
- Open with a one-line hook about the trip, close with a one-line send-off.`;
}

/** Generate a short spoken-word recap script for the traveler's selected activities. */
export async function generateNarration(args: {
  destination: string;
  summary: string;
  items: ItineraryItem[];
}): Promise<string> {
  const ai = getClient();

  let raw: string | undefined;
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: buildNarrationPrompt(args) }] }],
      config: { systemInstruction: NARRATION_SYSTEM },
    });
    raw = response.text;
  } catch (err) {
    throw wrapGeminiError(err);
  }

  const script = raw?.trim();
  if (!script) {
    throw new VibeError('Gemini returned no narration content.', 'GEMINI_EMPTY_RESPONSE', 502);
  }
  return script;
}

function buildAlbumNarrationPrompt(args: { captions: string[]; destination?: string }): string {
  const { captions, destination } = args;
  const list = captions.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const place = destination ? ` from ${destination}` : '';

  // ~150 spoken words/min; aim for a tight 45-75 second recap regardless of how many photos were picked.
  const wordBudget = Math.min(220, 90 + captions.length * 20);

  return `Write a short audio voice note recapping a traveler's own photo album${place}, based only on these photo captions, in order:
${list}

Write ONE continuous piece of spoken narration weaving these moments into a single warm recollection — not a list, no caption read verbatim, no numbering spoken aloud. Use natural transitions between moments.

Rules:
- Second person, past tense, like remembering a trip just taken ("You wandered...", "You found...").
- Warm and a little romanticized, but grounded only in what the captions describe — invent no new facts, places, or names.
- Around ${wordBudget} words total.
- No headers, no bullet points, no markdown — plain spoken prose only, ready to feed directly to a text-to-speech engine.
- Open with a one-line hook, close with a one-line send-off.`;
}

/** Generate a short spoken-word voice note recapping an uploaded photo album. */
export async function generateAlbumNarration(args: {
  captions: string[];
  destination?: string;
}): Promise<string> {
  const ai = getClient();

  let raw: string | undefined;
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [{ text: buildAlbumNarrationPrompt(args) }] }],
      config: { systemInstruction: NARRATION_SYSTEM },
    });
    raw = response.text;
  } catch (err) {
    throw wrapGeminiError(err);
  }

  const script = raw?.trim();
  if (!script) {
    throw new VibeError('Gemini returned no narration content.', 'GEMINI_EMPTY_RESPONSE', 502);
  }
  return script;
}

function wrapGeminiError(err: unknown): VibeError {
  const status = (err as { status?: number; code?: number })?.status ?? (err as { code?: number })?.code;
  if (status === 400 || status === 401 || status === 403) {
    return new VibeError(
      'Gemini rejected the API key. Check GEMINI_API_KEY in .env.local.',
      'GEMINI_AUTH',
      500
    );
  }
  if (status === 429) {
    return new VibeError('Gemini rate limit reached. Wait a moment and try again.', 'GEMINI_RATE_LIMIT', 429);
  }
  return new VibeError(
    `Gemini request failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    'GEMINI_UNAVAILABLE',
    502
  );
}
