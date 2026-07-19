import { NextResponse } from 'next/server';
import { ElevenLabsError, synthesizeSpeech } from '@/lib/elevenlabs';
import { MAX_ALBUM_PHOTOS, VibeError, generateAlbumNarration } from '@/lib/gemini';
import type { AlbumNarrationRequest, NarrateResponse } from '@/lib/types';

// Gemini script generation plus ElevenLabs TTS can exceed Vercel's default
// 10s serverless timeout, which fails as HTML, not JSON.
export const maxDuration = 60;

function bad(error: string, code: string) {
  return NextResponse.json({ error, code }, { status: 400 });
}

export async function POST(request: Request) {
  let body: AlbumNarrationRequest;
  try {
    body = await request.json();
  } catch {
    return bad('Request body must be JSON.', 'BAD_JSON');
  }

  const captions = Array.isArray(body?.captions)
    ? body.captions.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];
  const destination = typeof body?.destination === 'string' ? body.destination.trim() || undefined : undefined;

  if (captions.length === 0) {
    return bad('captions must be a non-empty array of strings.', 'BAD_CAPTIONS');
  }
  if (captions.length > MAX_ALBUM_PHOTOS) {
    return bad(`Select at most ${MAX_ALBUM_PHOTOS} photos for a voice note.`, 'TOO_MANY_CAPTIONS');
  }

  try {
    const script = await generateAlbumNarration({ captions, destination });
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
    console.error('[album-narrate]', err);
    return NextResponse.json(
      { error: 'Could not generate a voice note. Please try again.', code: 'INTERNAL' },
      { status: 500 }
    );
  }
}
