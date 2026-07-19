import Anthropic from '@anthropic-ai/sdk';
import type { HotelPick } from './stay22';

const MODEL = 'claude-opus-4-8';

/**
 * One evocative sentence per stay.
 *
 * Stay22 returns no prose, and inventing history or amenities for a real,
 * bookable property would be fabrication a traveler could act on. The model
 * therefore only gets facts we actually hold — name, type, neighbourhood, star
 * class, guest rating, price, and what it's near — and is told to work from
 * those alone. General knowledge about the *neighbourhood* is allowed; invented
 * claims about the *property* are not.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    blurbs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          blurb: { type: 'string' },
        },
        required: ['index', 'blurb'],
        additionalProperties: false,
      },
    },
  },
  required: ['blurbs'],
  additionalProperties: false,
} as const;

/**
 * Strip cross-listing openers.
 *
 * Each card is read on its own, but the model sees all five at once and
 * intermittently writes "Also on Rua da Atalaia…" even when told not to. The
 * instruction lands most of the time; this makes it certain.
 */
function sanitize(blurb: string): string {
  const cleaned = blurb
    .trim()
    .replace(/^(also|likewise|again|similarly|too),?\s+/i, '')
    // "Another apartment…" -> "An apartment…"; pick the article from the word
    // that follows so we don't produce "A apartment".
    .replace(/^(another|a second|the other)\s+(\w)/i, (_, __, first: string) =>
      `${/[aeiou]/i.test(first) ? 'An' : 'A'} ${first}`
    );
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export async function generateBlurbs(args: {
  destination: string;
  picks: HotelPick[];
}): Promise<(string | null)[]> {
  const { destination, picks } = args;
  if (!picks.length || !process.env.ANTHROPIC_API_KEY) return picks.map(() => null);

  const facts = picks.map((pick, index) => ({
    index,
    name: pick.name,
    type: pick.type,
    street: pick.location.split(',')[0],
    fullAddress: pick.location,
    stars: pick.stars,
    guestRating: pick.guestRating,
    reviewCount: pick.reviewCount,
    pricePerNight: pick.pricePerNight,
    nearest: pick.proximity
      ? `${pick.proximity.walkMinutes} min walk to ${pick.proximity.spotName}`
      : null,
  }));

  const prompt = `A traveler is choosing where to stay in ${destination}. Write one sentence about each of these places.

${JSON.stringify(facts, null, 2)}

Write each sentence to make the place feel like somewhere specific, not a search result. Lead with what makes it distinct — the street, the neighbourhood's character, what's on the doorstep.

What you may use:
- The facts above, exactly as given.
- What you genuinely know about that street or neighbourhood in ${destination} — its character, what it's known for, what it's like to walk out into.

What you must not do:
- Never invent anything about the property itself: no history, no architecture, no amenities, no rooms, no views, no breakfast, no décor. If it isn't in the facts above, you don't know it.
- Never state the property's age, former use, or who stayed there.
- Never invent a quote or attribute words to anyone.
- Don't restate the price, the rating or the review count — the card already shows them.
- Don't restate the walking time or name the place in "nearest" — the card already prints that line directly above your sentence. Use it as context for what the area is like, not as the fact you report.
- Each sentence is read on its own card. Never reference another listing or compare them ("also on…", "unlike the others…").

One sentence each, maximum 22 words. No marketing language, no exclamation marks. Vary the sentence shape across the set; do not open two the same way.

Respond with one entry per listing, keyed by the index given.`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      // A short, formulaic task — low effort keeps this off the critical path.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: prompt }],
    });

    if (response.stop_reason === 'refusal') return picks.map(() => null);

    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') return picks.map(() => null);

    const parsed = JSON.parse(text.text) as { blurbs: Array<{ index: number; blurb: string }> };
    const byIndex = new Map(parsed.blurbs.map((b) => [b.index, sanitize(b.blurb)]));
    return picks.map((_, i) => byIndex.get(i) ?? null);
  } catch (err) {
    // Blurbs are decoration; never fail the stay search over them.
    console.warn('[blurbs] generation failed:', err instanceof Error ? err.message : err);
    return picks.map(() => null);
  }
}
