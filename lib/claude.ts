import Anthropic from '@anthropic-ai/sdk';
import type { BudgetTier, Itinerary, ItineraryItem, LiveEvent, Spot, TimeBlock } from './types';
import { TIME_BLOCKS } from './types';

const MODEL = 'claude-opus-4-8';

let client: Anthropic | null = null;

/** Lazily construct so the app boots (and serves a clear error) without a key. */
function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ApiKeyError(
      'ANTHROPIC_API_KEY is not set. Copy .env.local.example to .env.local and add your key.'
    );
  }
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export class ApiKeyError extends Error {
  code = 'MISSING_ANTHROPIC_KEY';
}

export class GenerationError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
  }
}

/**
 * Structured-output schema. The API constrains the response to match this, so
 * the result is guaranteed-valid JSON — no markdown fences to strip and no
 * parse-retry loop.
 */
const ITINERARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'Two sentences on the shape of this trip and why it fits the budget.',
    },
    days: {
      type: 'array',
      description: 'One entry per day of the trip, in order.',
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer', description: '1-indexed day number.' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                time_block: { type: 'string', enum: [...TIME_BLOCKS] },
                activity: { type: 'string', description: 'Short name of the activity.' },
                description: {
                  type: 'string',
                  description: 'One or two sentences on what it is and why it is worth doing.',
                },
                is_side_quest: {
                  type: 'boolean',
                  description: 'True for the playful invented dares, false for real places and events.',
                },
              },
              required: ['time_block', 'activity', 'description', 'is_side_quest'],
              additionalProperties: false,
            },
          },
        },
        required: ['day', 'items'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'days'],
  additionalProperties: false,
} as const;

const BUDGET_GUIDANCE: Record<BudgetTier, string> = {
  shoestring:
    'Shoestring: free and cheap first — walking, public transit, markets, street food, free museum hours. Flag anything with a ticket price.',
  mid: 'Mid-range: a mix of free sights and a few paid experiences per day. Sit-down meals are fine; skip the tasting menus.',
  splurge:
    'Splurge: the good stuff — notable restaurants, private or small-group experiences, standout paid attractions. Still avoid tourist traps.',
};

function buildPrompt(args: {
  destination: string;
  budgetTier: BudgetTier;
  tripLengthDays: number;
  startDate: string;
  endDate: string;
  spots: Spot[];
  events: LiveEvent[];
}): string {
  const { destination, budgetTier, tripLengthDays, startDate, endDate, spots, events } = args;

  const spotsBlock = spots.length
    ? `Top-rated real places in ${destination} (from Google Places — use these as the backbone):\n${JSON.stringify(spots, null, 2)}`
    : `No verified place data was available for ${destination}. Use well-known real landmarks you are confident exist, and do not invent specific businesses, opening hours, or prices.`;

  const eventsBlock = events.length
    ? `Real events happening during the trip window (from Ticketmaster — schedule these on their actual dates):\n${JSON.stringify(events, null, 2)}`
    : `No ticketed events were found for these dates. Do not invent any — build the itinerary from places instead.`;

  return `Plan a ${tripLengthDays}-day trip to ${destination}, ${startDate} to ${endDate}.

Budget tier: ${budgetTier}. ${BUDGET_GUIDANCE[budgetTier]}

${spotsBlock}

${eventsBlock}

Build a day-by-day itinerary that mixes three things:

1. **Real places** — drawn from the list above where one was provided. Do not invent restaurants, bars, or venues.
2. **Real events** — scheduled on the exact date given. Only from the list above; never invent an event.
3. **Side quests** — 1 to 2 per day, marked \`is_side_quest: true\`. These are small playful dares, not places: "order something you can't pronounce", "find the best view in the city without paying for it", "ask a local where they actually eat lunch". They should fit the ${budgetTier} budget and the character of ${destination}. Make them specific to this place — a side quest that would work in any city is a boring side quest.

Rules:
- 3 to 5 items per day, ordered morning → afternoon → evening → night.
- Every item that is not a side quest must be a real, findable place or a real event from the lists above.
- For real places and events, use the exact supplied place or event name in the activity title so it can be pinned accurately on a map.
- Vary the days. Do not open every morning the same way.
- Keep descriptions concrete and short. No travel-brochure language.`;
}

/** Flatten the nested day/item shape into the flat jsonb row shape. */
function flatten(
  days: Array<{ day: number; items: Array<Omit<ItineraryItem, 'day'>> }>
): ItineraryItem[] {
  const order = new Map<TimeBlock, number>(TIME_BLOCKS.map((b, i) => [b, i]));
  return days
    .slice()
    .sort((a, b) => a.day - b.day)
    .flatMap((d) =>
      d.items
        .slice()
        .sort((a, b) => (order.get(a.time_block) ?? 0) - (order.get(b.time_block) ?? 0))
        .map((item) => ({ ...item, day: d.day }))
    );
}

/** Generate a day-by-day itinerary grounded in the supplied spots and events. */
export async function generateItinerary(args: {
  destination: string;
  budgetTier: BudgetTier;
  tripLengthDays: number;
  startDate: string;
  endDate: string;
  spots: Spot[];
  events: LiveEvent[];
}): Promise<Itinerary> {
  const anthropic = getClient();

  let response;
  try {
    // Streaming with finalMessage() avoids HTTP timeouts on long itineraries
    // while still giving us one complete message to work with.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: ITINERARY_SCHEMA },
      },
      system:
        'You are a sharp, well-travelled trip planner. You ground every recommendation in real places and real events, and you never invent a business, price, or opening time.',
      messages: [{ role: 'user', content: buildPrompt(args) }],
    });
    response = await stream.finalMessage();
  } catch (err) {
    throw wrapAnthropicError(err);
  }

  if (response.stop_reason === 'refusal') {
    throw new GenerationError(
      'The itinerary request was declined. Try a different destination.',
      'REFUSAL'
    );
  }
  if (response.stop_reason === 'max_tokens') {
    throw new GenerationError(
      'The itinerary ran long and was cut off. Try a shorter trip.',
      'TRUNCATED'
    );
  }

  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text') {
    throw new GenerationError('Claude returned no itinerary content.', 'EMPTY_RESPONSE');
  }

  // Guaranteed to parse: output_config.format constrains the response shape.
  const parsed = JSON.parse(text.text) as {
    summary: string;
    days: Array<{ day: number; items: Array<Omit<ItineraryItem, 'day'>> }>;
  };

  return {
    destination: args.destination,
    summary: parsed.summary,
    items: flatten(parsed.days),
  };
}

function wrapAnthropicError(err: unknown): Error {
  if (err instanceof ApiKeyError) return err;

  if (err instanceof Anthropic.AuthenticationError) {
    return new GenerationError(
      'Anthropic rejected the API key. Check ANTHROPIC_API_KEY in .env.local.',
      'ANTHROPIC_AUTH'
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new GenerationError(
      'Anthropic rate limit reached. Wait a moment and try again.',
      'ANTHROPIC_RATE_LIMIT'
    );
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new GenerationError('Could not reach Anthropic. Check your connection.', 'ANTHROPIC_UNREACHABLE');
  }
  if (err instanceof Anthropic.APIError) {
    return new GenerationError(`Anthropic request failed: ${err.message}`, 'ANTHROPIC_ERROR');
  }
  return new GenerationError(
    `Itinerary generation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    'UNKNOWN'
  );
}
