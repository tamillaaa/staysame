import { NextResponse } from 'next/server';
import { ACCEPTED_IMAGE_TYPES, MAX_ALBUM_PHOTOS, MAX_IMAGE_BYTES, VibeError, captionAlbum } from '@/lib/gemini';
import type { AlbumCaptionResponse } from '@/lib/types';

function bad(error: string, code: string, status = 400) {
  return NextResponse.json({ error, code }, { status });
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad('Send the images as multipart/form-data with one or more "photos" fields.', 'BAD_FORM');
  }

  const files = form.getAll('photos').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return bad('No images received. Attach one or more files as "photos".', 'NO_IMAGES');
  }
  if (files.length > MAX_ALBUM_PHOTOS) {
    return bad(`Upload at most ${MAX_ALBUM_PHOTOS} photos at a time.`, 'TOO_MANY_PHOTOS');
  }

  for (const file of files) {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      return bad(`"${file.name}" is a ${file.type || 'unknown type'}. Use JPEG, PNG or WebP.`, 'BAD_MIME');
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return bad(
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB per photo.`,
        'FILE_TOO_LARGE',
        413
      );
    }
  }

  try {
    const photos = await Promise.all(
      files.map(async (file) => ({
        base64Image: Buffer.from(await file.arrayBuffer()).toString('base64'),
        mimeType: file.type,
      }))
    );
    const captions = await captionAlbum(photos);

    const payload: AlbumCaptionResponse = { captions };
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof VibeError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[album-captions]', err);
    return NextResponse.json(
      { error: 'Could not caption those photos. Please try again.', code: 'INTERNAL' },
      { status: 500 }
    );
  }
}
