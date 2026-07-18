# Vibe Trip

Plan a trip from a vibe. The itinerary generator is the landing page: pick a
destination (or let it surprise you), set a budget, and get a day-by-day plan
that mixes top-rated real places, real ticketed events, and a couple of playful
"side quests" per day.

Built with Next.js (App Router), Supabase, Claude (itinerary generation), Gemini
(image-to-destination), and Stay22 (hotels).

> **Status:** this branch contains the foundation, the itinerary generator,
> Stay22 hotel matching, and the photo-to-destination flow. The traveler
> connector is unlocked by confirming a stay, but its QR code and matching still
> need auth.

## Repository layout

This repo holds two applications:

| Path | What it is |
| --- | --- |
| `app/`, `lib/`, `supabase/` | **Vibe Trip** — the Next.js app documented below |
| `client/`, `server/` | **Ghostwriter** — the earlier Vite + Express photo-to-hotel prototype, kept for its working Gemini and Stay22 integrations. See [Ghostwriter](#ghostwriter-legacy-prototype) below. |

## Setup

Requires Node.js 18+.

```bash
npm install
cp .env.local.example .env.local
```

Then fill in `.env.local`:

| Variable | Required for | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Itinerary generation | Required. Without it `/api/generate-itinerary` returns a clear 500. |
| `GOOGLE_PLACES_API_KEY` | Real places | Optional. Without it the itinerary is built from the model's own knowledge, and the UI says so. |
| `TICKETMASTER_API_KEY` | Real events | Optional, same degradation. |
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Saving trips | Optional. Without them itineraries generate but aren't persisted. |
| `STAY22_API_KEY` | Hotel matching | Optional. Without it Stay22 runs in demo mode, capped at 5 requests/minute. |
| `STAY22_AID` | Booking attribution | Optional. Without it bookings are not attributed to your affiliate account, and the UI says so. |
| `GEMINI_API_KEY` | Photo tab | Not used yet on this branch. |
| `ELEVENLABS_API_KEY` | Narration | Stretch goal, not wired up. |

Apply the database schema with the Supabase CLI:

```bash
supabase db push
```

Then run it:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Page structure

One page, three tabs, with the active tab in the URL as `?tab=plan|photo|connect`
so tabs are linkable. Switching tabs does not reload the page.

- **Plan a trip** (default) — the itinerary generator. Hotel picks will render
  inline here once Stay22 is wired up.
- **From a photo** — the image-to-destination uploader. Selecting a suggested
  destination switches back to the plan tab with it pre-filled.
- **Connect** — the solo-traveler QR connector, unlocked by a booked hotel.

## API

### `POST /api/generate-itinerary`

```json
{
  "mode": "destination" | "surprise_me" | "continent",
  "destination": "Lisbon, Portugal",
  "continent": "Europe",
  "budget_tier": "shoestring" | "mid" | "splurge",
  "trip_length_days": 4,
  "start_date": "2026-08-17"
}
```

Resolves the destination, fetches top-rated spots (Google Places) and events in
the date range (Ticketmaster), feeds both to Claude, and saves the result to
`trips`. Returns the itinerary plus a `sources` block reporting what actually
grounded it.

### `POST /api/hotel-matches`

```json
{
  "destination": "Lisbon, Portugal",
  "checkin": "2026-09-10",
  "checkout": "2026-09-12",
  "budget_tier": "mid",
  "trip_id": "uuid-or-null",
  "center": { "lat": 38.7134, "lng": -9.1455, "radiusMeters": 6000 }
}
```

Searches Stay22 for stays, returns the top 5 with Allez booking deeplinks, and
saves them to `hotel_picks` against the trip. Each pick carries `proximity`
(walking time to the nearest itinerary spot) and `blurb` (one sentence about the
place). Renders inline beneath the itinerary; marking one as yours unlocks the
Connect tab.

### `POST /api/vibe-to-destination`

`multipart/form-data` with a `photo` field. JPEG, PNG or WebP, up to 5MB.
Returns `{ tags, listingKeywords, suggestions, imageUrl }` — the aesthetic read
out of the image, three matching destinations with a reason each, and the
Supabase Storage URL (`null` when storage isn't configured).

### `POST /api/trips`

`{ destination, source_image_url }`. Creates a bare trip row with an empty
itinerary, so a stay confirmed straight from the photo flow still has something
for the Connect tab to attach a traveler code to.

## Implementation notes

- **Structured outputs, not prompt-and-parse.** The itinerary comes back through
  `output_config.format` with a JSON schema, so the response is guaranteed-valid
  JSON — no markdown fences to strip and no parse-retry loop.
- **Grounding degrades, it doesn't break.** Places and Ticketmaster each return
  `[]` on a missing key or a failed call. The itinerary still generates, the
  prompt tells Claude not to invent venues or events it wasn't given, and the UI
  states which sources were actually used.
- **Persistence is optional.** With Supabase unconfigured the trip generates and
  renders but isn't saved, and the UI says so rather than silently dropping it.
- **`surprise_me` uses a curated pool**, not a model call — the surprise is
  instant, and entries are grouped by budget so a shoestring surprise doesn't
  land in Zurich. Most entries are cities, but a few splurge picks are regions
  or small countries ("Seychelles", "Patagonia, Chile"); those rely on the
  hotel search's address fallback, since their attractions are too scattered
  for a radius search around one centroid.
- **Hotels are anchored on the itinerary, not the city name.** Stay22's
  `address` geocoder is unreliable at city level: "Lisbon", "Baixa, Lisbon" and
  "Alfama, Lisbon" all resolve to the *same* point 5.5km northeast of the
  centre, putting every result in Parque das Nações while the itinerary was in
  Alfama and Chiado. The hotel search therefore uses the centroid of the trip's
  own Google Places spots, with a radius sized to how far those spots scatter
  (4–40km). Destinations with no inventory near that centroid — an island
  nation like the Seychelles — fall back to the address search.
- **Listings are de-duplicated by street.** Operators list a whole building as
  separate units, so a raw top-5 for Lisbon returned five "… by Innkeeper"
  apartments in one complex, and later three units of a single Rua da Rosa
  address. Note the street key strips `º`/`ª` explicitly: they are Unicode
  *letters*, so a `\p{L}` filter alone leaves `"rua da rosa º"` unequal to
  `"rua da rosa"`.
- **Stays are ranked by centrality, but display the nearest spot.** Ranking on
  the closest attraction alone rewards a hotel that happens to sit beside one
  outlying stop — a place next to the Oceanário would read "2 min walk" while
  being 7km from the other nine. Ranking uses the *median* distance to every
  spot; the card shows the nearest one, since that's what a traveler wants to
  read. For a Lisbon trip spanning 12.3km, the picks landed in Bairro Alto,
  within 1.4km of seven of the ten spots.
- **Blurbs may describe the neighbourhood, never the property.** Stay22 returns
  no prose, and inventing a hotel's history or amenities is a claim a traveler
  could act on. The model gets only the facts we hold and is allowed to draw on
  what it knows about the *street or district* — Kyoto picks cite Shinsen-en
  garden and the machiya lanes of Shinmachi-Rokkaku — while any claim about the
  building itself is forbidden. A deterministic pass also strips cross-listing
  openers ("Also on Rua da Atalaia…"), which the prompt alone didn't fully
  prevent since the model writes all five at once.
- **Hotel ranking is confidence-weighted.** Sorting on the raw guest rating
  surfaced novelty stays with perfect scores from a handful of reviews — one
  Lisbon mid-tier list came back as five boats. Scores now shrink toward the
  prior mean by review count, so a 9.2 from 400 reviews outranks a 10 from 3.
- **TypeScript is pinned to 5.x.** TypeScript 7 crashes the Next 16 build worker
  (`The "id" argument must be of type string`).

---

# Ghostwriter (legacy prototype)

Ghostwriter matches travelers to hotel stays based on the vibe of an inspiration
photo. Upload an image, and Ghostwriter analyzes its aesthetic to surface hotel
listings that fit the mood.

This is a hackathon project. Photo analysis runs on Google Gemini and hotel
listings come from the Stay22 Direct Travel API. No database or authentication
is implemented yet.

## Project structure

- `client/` — React app (Vite, JavaScript)
- `server/` — Express API server
  - `lib/gemini.js` — photo analysis + match captions
  - `lib/stay22.js` — hotel search and response normalization

## Setup

Requires Node.js 18+.

### 1. Install dependencies

```bash
cd client && npm install
cd ../server && npm install
```

### 2. Add API keys

```bash
cd server
cp .env.example .env
```

Then edit `server/.env`:

| Variable | Required | Notes |
| --- | --- | --- |
| `GEMINI_API_KEY` | Yes | Get one free at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Photo analysis fails without it. |
| `GEMINI_MODEL` | No | Defaults to `gemini-3.5-flash`. |
| `STAY22_API_KEY` | No | From [hub.stay22.com](https://hub.stay22.com). Without it the server uses Stay22's keyless demo mode, which works but is capped at **5 requests/minute**. |
| `STAY22_AID` | No | Stay22 affiliate ID for booking-commission attribution. |
| `PORT` | No | Defaults to `3001`. |

`.env` is gitignored — only `.env.example` is committed.

### 3. Run the backend

```bash
cd server
npm run dev
```

The API server starts on [http://localhost:3001](http://localhost:3001).

### 4. Run the frontend

In a separate terminal:

```bash
cd client
npm run dev
```

The app opens on [http://localhost:5173](http://localhost:5173).

### 5. Try it out

Upload or drag in an inspiration photo and click "Find my stay." The app
analyzes the photo and opens with a short second-person narrative of the trip,
which sits alone for a beat before the vibe tags, destination picker and hotel
cards fade in beneath it.

The destination picker under the tags lets you steer the search:

- **A specific place** — pre-filled with Gemini's guess and fully editable.
  Accepts a city, a region ("Amalfi Coast, Italy") or a country ("Portugal").
- **Anywhere** — Gemini picks three destinations matching the photo's vibe and
  the results are interleaved across all of them.

## API endpoints

### `POST /api/analyze-photo`

Accepts `multipart/form-data` with a `photo` field, or JSON
`{ "image": "<base64 or data URL>", "mimeType": "image/jpeg" }`. Max 10MB;
JPEG, PNG, WebP or HEIC.

Returns the Gemini analysis:

```json
{
  "vibe": "beach",
  "amenities": ["pool", "ocean view"],
  "destination_guess": "Santorini, Greece",
  "price_tier": "mid",
  "description": "Sun-bleached cliffside terraces above turquoise water.",
  "narrative": "You are tracing worn stone paths through the sun-baked village..."
}
```

`vibe` is one of `beach`, `urban`, `mountain`, `rustic`, `luxury`,
`minimalist`; `price_tier` is `budget`, `mid` or `luxury`. If Gemini returns
unparseable output, the server retries once with a stricter prompt before
returning an error.

### `POST /api/search-stays`

Accepts the analysis above plus:

| Field | Notes |
| --- | --- |
| `location` | Where to search — a city, region or country. Anything broader than a city is expanded into three vibe-matched places inside it. Falls back to `destination_guess` when omitted. |
| `anywhere` | When `true`, `location` is ignored: Gemini picks three vibe-matched destinations and the server searches all of them, interleaving the results. |
| `checkin` / `checkout` | Optional `YYYY-MM-DD`. Defaults to a 3-night window 30 days out. |

Returns `{ destination, checkin, checkout, nights, stays }`, plus `destinations`
(the array of places actually searched) and `expandedFrom` (the broad input
they were derived from, or `null`). Each stay is:

```json
{
  "name": "Aeolos Art & Eco Suites",
  "location": "Imerovigli, Greece, 84700",
  "price": "$286/night",
  "imageUrl": "https://...",
  "bookingUrl": "https://www.stay22.com/allez/booking/...",
  "description": "Accommodation · 2 bedrooms · sleeps 4 · rated 8.8/10",
  "matchReason": "Cliffside suites echo the terraced whites in your photo."
}
```

### `POST /api/hotel-matches`

```json
{
  "destination": "Lisbon, Portugal",
  "checkin": "2026-09-10",
  "checkout": "2026-09-12",
  "budget_tier": "mid",
  "trip_id": "uuid-or-null",
  "center": { "lat": 38.7134, "lng": -9.1455, "radiusMeters": 6000 }
}
```

Searches Stay22 for stays, returns the top 5 with Allez booking deeplinks, and
saves them to `hotel_picks` against the trip. Each pick carries `proximity`
(walking time to the nearest itinerary spot) and `blurb` (one sentence about the
place). Renders inline beneath the itinerary; marking one as yours unlocks the
Connect tab.

### `POST /api/vibe-to-destination`

`multipart/form-data` with a `photo` field. JPEG, PNG or WebP, up to 5MB.
Returns `{ tags, listingKeywords, suggestions, imageUrl }` — the aesthetic read
out of the image, three matching destinations with a reason each, and the
Supabase Storage URL (`null` when storage isn't configured).

### `POST /api/trips`

`{ destination, source_image_url }`. Creates a bare trip row with an empty
itinerary, so a stay confirmed straight from the photo flow still has something
for the Connect tab to attach a traveler code to.

## Implementation notes

- **Stay22 exposes no amenity data.** The `amenities` Gemini extracts can't be
  used as a search filter — there is no such parameter or response field. They
  steer the match captions instead, while `vibe` and `price_tier` map onto the
  filters Stay22 *does* support (`type`, `minstarrating`, `min`/`max`).
- **Prices require dates.** Stay22 only quotes a price when `checkin` and
  `checkout` are supplied, and quotes the *stay total*, not a nightly rate.
  Since the UI has no date picker yet, the server searches a 3-night window 30
  days out and divides the total by `meta.nights`. Pass `checkin`/`checkout`
  explicitly to override.
- **Vibe matching leans on Gemini's listing keywords, not its mood tags.** The
  mood tags ("sun-drenched", "cliffside") almost never appear in hotel names —
  on a Positano search they matched **0%** of candidates. Gemini therefore also
  returns `listing_keywords` (villa, terrace, suite, caldera), concrete nouns
  that do appear, which lifted the match rate to 14%. This is a genuinely thin
  signal either way: Stay22 exposes no amenity text, so the only thing to match
  against is the property name. It nudges ordering; it does not transform the
  list.
- **Photo storage is optional.** Without Supabase the upload is skipped, the
  browser's own object URL drives the preview thumbnail, and `imageUrl` comes
  back `null` — the UI says the photo wasn't saved rather than failing. Storage
  expects a public bucket named `vibe-photos`.
- **`gemini-2.5-flash` is retired.** It returns `404 — no longer available to
  new users`. The server pins `gemini-3.5-flash` instead; override with
  `GEMINI_MODEL`.
- **Gemini almost always guesses a destination** — it returned "Kyoto, Japan"
  for a featureless colour gradient. Because the guess is confident but often
  wrong, the destination picker is always visible and pre-filled with it rather
  than only appearing when the guess is `null`.
- **Broad inputs are expanded before searching.** Stay22 resolves a country to
  one arbitrary point and searches ~10km around it, so `location=Portugal`
  returned inland guesthouses in a village called Bicas, and `Italy` returned a
  lakeside mountain town for a beach photo. Anything broader than a city is
  therefore passed through `resolveDestinations()`, which asks Gemini for three
  specific places inside it that match the vibe — "Japan" + beach becomes
  Okinawa, Ishigaki and Miyakojima; "Japan" + mountain becomes Hakuba, Niseko
  and Yuzawa. A city is passed through untouched, and the response carries
  `expandedFrom` so the UI can say what actually happened.
- **The auto-search path skips resolution.** When the destination still equals
  Gemini's own guess, it's already specific, so the extra round trip is
  skipped. Editing the field triggers resolution.
- **"Anywhere" tolerates partial failure.** The three destination searches run
  in parallel via `Promise.allSettled`; if one geocodes badly or rate-limits,
  the others still return. Only an all-failed result raises an error.
- **Captions name only gaps we can prove.** The brief for this feature was to
  compare a listing's amenities against the photo's — but Stay22 returns no
  amenity data, so "no pool here" would be invented. `findGaps()` instead
  derives shortfalls from fields that do exist (price above the tier band, star
  class below a luxury vibe, a rating under 8, fewer than 10 reviews, no live
  price) and the prompt forbids asserting that a property has or lacks any
  amenity. Photo features are raised as unconfirmed — "we can't promise the
  plunge pool" — never as absent.
- **Match captions degrade gracefully.** They come from a second batched Gemini
  call; if it fails or is rate-limited, the server falls back to a rule-based
  caption built from star rating and guest score rather than failing the search.
