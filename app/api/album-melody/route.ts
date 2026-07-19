import { NextResponse } from 'next/server';
import { ElevenLabsError, generateSoundEffect } from '@/lib/elevenlabs';

const MAX_CAPTION_LENGTH = 300;
const MELODY_DURATION_SECONDS = 6;

function bad(error: string, code: string) {
  return NextResponse.json({ error, code }, { status: 400 });
}

export async function GET(request: Request) {
  const caption = new URL(request.url).searchParams.get('caption')?.trim();
  if (!caption) {
    return bad('caption is required.', 'MISSING_CAPTION');
  }

  // Always wrap in our own fixed template — the caption is Gemini's own
  // writing (already vetted by the captioning prompt), never raw free text
  // forwarded verbatim to a paid generation API.
  const prompt = `A short, gentle instrumental melody, no vocals and no words, like a music box or a soft acoustic strum, that captures this mood: ${caption.slice(0, MAX_CAPTION_LENGTH)}`;

  try {
    const audio = await generateSoundEffect(prompt, MELODY_DURATION_SECONDS);
    return new NextResponse(new Uint8Array(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        // Same caption -> same melody; safe to cache hard, same as the fixed SFX.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  } catch (err) {
    if (err instanceof ElevenLabsError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[album-melody]', err);
    return NextResponse.json(
      { error: 'Could not generate a melody for that photo.', code: 'INTERNAL' },
      { status: 500 }
    );
  }
}
