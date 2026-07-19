import { NextResponse } from 'next/server';
import { ElevenLabsError, synthesizeSpeech } from '@/lib/elevenlabs';
import { VibeError, generateNarration } from '@/lib/gemini';
import { TIME_BLOCKS } from '@/lib/types';
import type { ItineraryItem, NarrateRequest, NarrateResponse } from '@/lib/types';

const MAX_ITEMS = 12;

function bad(error: string, code: string) {
  return NextResponse.json({ error, code }, { status: 400 });
}

function isItineraryItem(value: unknown): value is ItineraryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.day === 'number' &&
    typeof item.activity === 'string' &&
    typeof item.description === 'string' &&
    typeof item.is_side_quest === 'boolean' &&
    typeof item.time_block === 'string' &&
    (TIME_BLOCKS as readonly string[]).includes(item.time_block)
  );
}

export async function POST(request: Request) {
  let body: NarrateRequest;
  try {
    body = await request.json();
  } catch {
    return bad('Request body must be JSON.', 'BAD_JSON');
  }

  const destination = (body?.destination ?? '').trim();
  const summary = (body?.summary ?? '').trim();
  const items = body?.items;

  if (!destination) return bad('destination is required.', 'MISSING_DESTINATION');
  if (!Array.isArray(items) || items.length === 0 || !items.every(isItineraryItem)) {
    return bad('items must be a non-empty array of itinerary items.', 'BAD_ITEMS');
  }
  if (items.length > MAX_ITEMS) {
    return bad(`Select at most ${MAX_ITEMS} activities for a narration.`, 'TOO_MANY_ITEMS');
  }

  try {
    const script = await generateNarration({ destination, summary, items });
    const audio = await synthesizeSpeech(script);

    const payload: NarrateResponse = {
      script,
      audioBase64: audio.toString('base64'),
      mimeType: 'audio/mpeg',
    };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    if (err instanceof VibeError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[narrate]', err);
    return NextResponse.json(
      { error: 'Could not generate narration. Please try again.', code: 'INTERNAL' },
      { status: 500 }
    );
  }
}
