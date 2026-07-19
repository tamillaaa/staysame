import { NextResponse } from 'next/server';
import { ElevenLabsError, generateSoundEffect } from '@/lib/elevenlabs';

// A single ElevenLabs generation call is normally fast, but this guards
// against Vercel's default 10s serverless timeout failing as HTML, not JSON.
export const maxDuration = 30;

// Fixed, whitelisted prompts — never pass client-supplied text to a paid
// generation API.
const EFFECTS: Record<string, { prompt: string; durationSeconds: number }> = {
  add: {
    prompt:
      'A single soft camera shutter click, followed by the gentle flutter of a photograph landing on a wooden table.',
    durationSeconds: 2.5,
  },
  remove: {
    prompt: 'A photograph crumbling into soft ash and embers, with a light whoosh as the dust disperses.',
    durationSeconds: 2.5,
  },
  generating: {
    prompt:
      'A whimsical, cozy instrumental loop, like paging gently through an old photo album by candlelight — warm, magical, unhurried, no vocals.',
    durationSeconds: 8,
  },
};

export async function GET(request: Request) {
  const effect = new URL(request.url).searchParams.get('effect');
  const config = effect ? EFFECTS[effect] : undefined;

  if (!config) {
    return NextResponse.json(
      { error: `effect must be one of: ${Object.keys(EFFECTS).join(', ')}.`, code: 'BAD_EFFECT' },
      { status: 400 }
    );
  }

  try {
    const audio = await generateSoundEffect(config.prompt, config.durationSeconds);
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        // Same effect, same prompt, every time — safe (and cheap) to cache hard.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[album-sfx]', err);
    return NextResponse.json(
      { error: 'Could not generate that sound effect.', code: 'INTERNAL' },
      { status: 500 }
    );
  }
}
