import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || query.length < 2) return NextResponse.json({ cities: [] });

  try {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({ input: query, includedPrimaryTypes: ['(cities)'] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return NextResponse.json({ cities: [] });

    const body = (await response.json()) as {
      suggestions?: Array<{ placePrediction?: { placeId?: string; text?: { text?: string } } }>;
    };
    const cities = (body.suggestions ?? []).flatMap((suggestion) => {
      const prediction = suggestion.placePrediction;
      const label = prediction?.text?.text;
      return label ? [{ id: prediction?.placeId ?? label, label }] : [];
    }).slice(0, 6);
    return NextResponse.json({ cities });
  } catch {
    return NextResponse.json({ cities: [] });
  }
}
