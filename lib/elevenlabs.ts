const ELEVENLABS_TTS_URL = 'https://api.elevenlabs.io/v1/text-to-speech';
// "Rachel" — a premade ElevenLabs voice available on every account.
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL_ID = 'eleven_turbo_v2_5';

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 502
  ) {
    super(message);
  }
}

export function isElevenLabsConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY);
}

/** Synthesize narration text into MP3 audio bytes. */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new ElevenLabsError(
      'ELEVENLABS_API_KEY is not set. Copy .env.local.example to .env.local and add your key.',
      'MISSING_ELEVENLABS_KEY',
      500
    );
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const modelId = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;

  let response: Response;
  try {
    response = await fetch(`${ELEVENLABS_TTS_URL}/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new ElevenLabsError(
      `Could not reach ElevenLabs: ${err instanceof Error ? err.message : 'unknown error'}`,
      'ELEVENLABS_UNREACHABLE'
    );
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ElevenLabsError('ElevenLabs rejected the API key.', 'ELEVENLABS_AUTH', 500);
    }
    if (response.status === 429) {
      throw new ElevenLabsError(
        'ElevenLabs rate limit reached. Wait a moment and try again.',
        'ELEVENLABS_RATE_LIMIT',
        429
      );
    }
    const detail = await response.text().catch(() => '');
    throw new ElevenLabsError(
      `ElevenLabs request failed (${response.status}): ${detail.slice(0, 200)}`,
      'ELEVENLABS_ERROR'
    );
  }

  return Buffer.from(await response.arrayBuffer());
}
