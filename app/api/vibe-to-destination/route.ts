import { NextResponse } from 'next/server';
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES, VibeError, analyzeVibe } from '@/lib/gemini';
import { uploadVibePhoto } from '@/lib/storage';
import type { VibeToDestinationResponse } from '@/lib/types';

function bad(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad('Send the image as multipart/form-data with a "photo" field.', 'BAD_FORM');
  }

  const photo = form.get('photo');
  if (!(photo instanceof File)) {
    return bad('No image received. Attach a file as "photo".', 'NO_IMAGE');
  }

  // The browser checks these too, but never trust the client with size limits.
  if (!ACCEPTED_IMAGE_TYPES.includes(photo.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return bad(
      `That file is a ${photo.type || 'unknown type'}. Use a JPEG, PNG or WebP.`,
      'BAD_MIME'
    );
  }
  if (photo.size > MAX_IMAGE_BYTES) {
    return bad(
      `That image is ${(photo.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB.`,
      'FILE_TOO_LARGE',
      413
    );
  }

  try {
    const bytes = await photo.arrayBuffer();

    // Storage is best-effort and independent of the analysis, so run both at
    // once; a missing bucket must not delay or fail the read.
    const [analysis, imageUrl] = await Promise.all([
      analyzeVibe({
        base64Image: Buffer.from(bytes).toString('base64'),
        mimeType: photo.type,
      }),
      uploadVibePhoto({ bytes, mimeType: photo.type }),
    ]);

    const payload: VibeToDestinationResponse = { ...analysis, imageUrl };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof VibeError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[vibe-to-destination]', err);
    return NextResponse.json(
      { error: 'Could not read that photo. Please try again.', code: 'INTERNAL' },
      { status: 500 }
    );
  }
}
