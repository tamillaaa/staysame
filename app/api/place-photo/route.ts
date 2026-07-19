import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  const photoName = new URL(request.url).searchParams.get('name');

  if (!apiKey || !photoName || !/^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
    return NextResponse.json({ error: 'Photo unavailable.' }, { status: 404 });
  }

  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=720`,
      { headers: { 'X-Goog-Api-Key': apiKey }, redirect: 'follow', signal: AbortSignal.timeout(15000) }
    );
    if (!response.ok || !response.body) {
      return NextResponse.json({ error: 'Photo unavailable.' }, { status: 404 });
    }

    return new NextResponse(response.body, {
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  } catch {
    return NextResponse.json({ error: 'Photo unavailable.' }, { status: 404 });
  }
}
