import { getServiceClient } from './supabase';

const BUCKET = 'vibe-photos';

/**
 * Store an uploaded vibe photo and return its public URL.
 *
 * Returns null when Supabase isn't configured or the upload fails — the photo
 * flow works without persistence (the browser already has the file for the
 * preview thumbnail), so a missing bucket degrades the feature rather than
 * blocking it. The URL is only needed later, to attach to a trip row.
 */
export async function uploadVibePhoto(args: {
  bytes: ArrayBuffer;
  mimeType: string;
}): Promise<string | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;

  const extension = args.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const path = `${crypto.randomUUID()}.${extension}`;

  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, args.bytes, { contentType: args.mimeType, upsert: false });

    if (error) {
      // Most likely the bucket doesn't exist yet — say so rather than failing
      // the whole request over a thumbnail.
      console.warn(`[storage] upload failed (create a public "${BUCKET}" bucket):`, error.message);
      return null;
    }

    return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.warn('[storage] upload threw:', err instanceof Error ? err.message : err);
    return null;
  }
}
