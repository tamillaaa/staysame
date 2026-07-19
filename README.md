# Stay Here

Plan a trip from a vibe. The itinerary generator is the landing page: pick a
destination (or let it surprise you), set a budget, and get a day-by-day plan
that mixes top-rated real places, real ticketed events, and a couple of playful
"side quests" per day.

Built with Next.js (App Router), Supabase, Claude (itinerary generation),
Gemini (image-to-destination and narration scripts), Stay22 (hotels), and
ElevenLabs (voice narration).

> **Status:** this branch contains the foundation, the itinerary generator,
> Stay22 hotel matching, the photo-to-destination flow, audio narration of a
> selected day recap, a post-trip photo album with captions and an optional
> voice note, and Auth0 sign-in wired through to Supabase RLS. The traveler
> connector is unlocked by confirming a stay; login now works, but the actual
> QR code and matching logic still isn't built.

## Repository layout

This repo holds two applications:

| Path | What it is |
| --- | --- |
| `app/`, `lib/`, `supabase/` | **Stay Here** — the Next.js app documented below |
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
| `GEMINI_API_KEY` | Photo tab, album captions, and narration scripts | Required. Without it `/api/vibe-to-destination`, `/api/album-captions`, `/api/narrate` and `/api/album-narrate`'s script steps all return a clear 500. |
| `ELEVENLABS_API_KEY` | Narration, voice-note, and sound-effect audio | Optional. Without it `/api/narrate` and `/api/album-narrate` return a clear 500, and `/api/album-sfx` fails silently (no sound plays); everything else is unaffected. |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | Narration voice/model | Optional. Default to ElevenLabs' premade "Rachel" voice and `eleven_turbo_v2_5`. |
| `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`, `AUTH0_SECRET` | Sign-in | Required for login. Without them the SDK logs a startup warning and `/auth/login` fails; the rest of the app is unaffected. |
| `APP_BASE_URL` | Sign-in | Optional. Defaults to inferring the base URL from the request host; set explicitly for a stable production domain. |
| `NEXT_PUBLIC_AUTH0_AUDIENCE` | Sign-in tied to Supabase | Required for `auth.uid()` to resolve. Without it Auth0 issues an opaque token Supabase can't verify, so RLS-scoped writes (as opposed to the service-role ones already in place) silently fail. |

Apply the database schema with the Supabase CLI:

```bash
supabase db push
```

### Setting up Auth0

1. Create an Auth0 account at [auth0.com](https://auth0.com) if you don't have
   one, then create an application of type **Regular Web Application**.
2. Under that application's settings, add to **Allowed Callback URLs**:
   `http://localhost:3000/auth/callback`, and to **Allowed Logout URLs**:
   `http://localhost:3000`.
3. Copy the application's **Domain**, **Client ID**, and **Client Secret**
   into `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`.
4. Generate `AUTH0_SECRET`: `openssl rand -hex 32`.
5. Under **Applications → APIs**, create a new API (any name, any identifier
   URI, e.g. `https://stay-here-api`). This is what makes Auth0 issue a real
   JWT instead of an opaque token. Put that identifier in
   `NEXT_PUBLIC_AUTH0_AUDIENCE`.
6. In the **Supabase dashboard**, under **Authentication → Sign In /
   Providers → Third-Party Auth**, add Auth0 as a provider using the same
   Auth0 domain. This is what makes `auth.uid()` resolve from an Auth0-issued
   token inside RLS policies; without this step, login will work but every
   RLS-scoped Supabase read/write will behave as if no one is signed in.

Then run it:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Page structure

One page, four tabs, with the active tab in the URL as
`?tab=plan|photo|memories|connect` so tabs are linkable. Switching tabs does
not reload the page.

- **Plan a trip** (default) — the itinerary generator. Hotel picks will render
  inline here once Stay22 is wired up.
- **From a photo** — the image-to-destination uploader. Selecting a suggested
  destination switches back to the plan tab with it pre-filled.
- **Memories** — a whimsical scrapbook for photos from the trip you just took:
  polaroid-style cards with a short caption per photo, each with its own tiny
  ElevenLabs-generated melody that plays with a floating musical-note animation
  on hover, an optional voice note over the whole set, sound effects on
  add/remove, drag-to-reorder on a film-tape strip, and an ash-dissolve
  animation when a photo is removed. Independent of any planned itinerary;
  nothing here is persisted — it lives in the tab for the session, same as the
  itinerary's narration audio.
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

### `POST /api/narrate`

```json
{
  "destination": "Lisbon, Portugal",
  "summary": "A relaxed mid-range week mixing Alfama's viewpoints with day trips to Sintra.",
  "items": [/* up to 12 selected ItineraryItem entries, from the itinerary response */]
}
```

Writes a short (~45–75 second) spoken-word recap script with Gemini, grounded
only in the selected items' own descriptions, then synthesizes it with
ElevenLabs. Returns `{ script, audioBase64, mimeType }`; the UI decodes the
audio client-side and plays it in an `<audio>` element. Ticking activities in
the itinerary drives the `items` sent here — the "Generate narration" button
in the UI stays disabled until at least one is selected.

### `POST /api/album-captions`

`multipart/form-data` with one or more `photos` fields. JPEG, PNG or WebP, up
to 5MB each, up to 10 photos per request. Sends the whole batch to Gemini in
one call and returns `{ captions: string[] }` — one short, warm caption per
photo, in the same order they were sent, so the set reads consistently rather
than as N independent guesses.

### `POST /api/album-narrate`

```json
{
  "captions": ["A tiled terrace above the rooftops of Alfama...", "..."],
  "destination": "Lisbon, Portugal"
}
```

Same two-step pipeline as `/api/narrate` (Gemini script, then ElevenLabs
audio), but grounded in a photo album's captions instead of itinerary items,
and in the past tense — a recollection rather than a preview. `destination` is
optional context; the Memories tab isn't tied to a specific planned trip.
Returns the same `{ script, audioBase64, mimeType }` shape.

### `GET /api/album-sfx?effect=add|remove`

Generates a short (~2.5s) sound effect with ElevenLabs' sound-generation
endpoint from one of two fixed, whitelisted prompts — never client-supplied
text — and streams back raw `audio/mpeg` with a long `Cache-Control`, since
the same effect is safe to cache hard. The Memories tab plays `add` when
photos land in the album and `remove` when one is deleted, both fire-and-forget
(a failed or unconfigured request just plays nothing).

### `GET /api/album-melody?caption=<url-encoded caption>`

Generates a short (~6s), looping instrumental melody from ElevenLabs' sound
generation endpoint, wrapping the photo's own caption in a fixed
music-generation template server-side. Also cached hard, keyed on the caption
text — the same photo always gets the same melody within a browser's cache
lifetime. The Memories tab lazily creates and caches an `<audio loop>` element
per photo on first hover and just replays it on later hovers, so only the
first hover per photo pays the ~2-3s generation cost.

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
- **Narration is a script, then a TTS pass — not one call.** Gemini writes the
  spoken-word recap (grounded only in the selected items' own descriptions, no
  headers or markdown, sized to ~150 words/minute of speech) and ElevenLabs
  turns that text into audio. Splitting the steps means the script is never
  garbled by voice-model quirks, and a `/api/narrate` failure clearly indicates
  whether Gemini or ElevenLabs was the cause.
- **Album captions are one batched call, not N.** All uploaded photos go to
  Gemini together with a single prompt asking for one caption per image in
  order. This is both cheaper than N separate calls and reads as a coherent
  set — Gemini sees the whole batch and can vary its phrasing across photos
  rather than each caption being written in isolation.
- **The Memories tab has no persistence layer.** Photos, captions, and the
  generated voice note all live in component state, same as the itinerary's
  narration audio. Nothing is uploaded to Supabase Storage or saved to a
  table — closing the tab loses the album. This was a deliberate scope call
  for this branch, not a missing-key degradation like the rest of the app.
- **Sound effects are prompts, not files.** `add` and `remove` aren't checked-in
  audio assets — they're generated on demand from a fixed text prompt via
  ElevenLabs' sound-generation endpoint and cached hard at the HTTP layer
  (`Cache-Control: public, max-age=86400`), so the first play per browser costs
  a generation and every play after is free. Never pass client-supplied text to
  this endpoint — the route only accepts an `effect` key against a server-side
  whitelist.
- **Reordering is native HTML5 drag-and-drop, desktop only.** The film-tape
  strip swaps two photos live on `dragover` rather than waiting for `drop`, so
  the reorder is visible mid-drag. No touch-drag fallback exists yet — this
  matches the rest of the app's scope (no mobile-specific interaction layer
  anywhere else either).
- **Per-photo melodies are templated, not free-form.** `/api/album-melody`
  never forwards raw request input to ElevenLabs — the `caption` query param
  is Gemini's own writing (already vetted by the captioning prompt), truncated
  and wrapped in a fixed instrumental-music template before it reaches the
  generation call. Melodies are fetched lazily on first hover and reused for
  every hover after, rather than generated on every `mouseenter` — a fresh
  ~2-3s generation on every hover would feel broken, not charming.
- **Two Supabase clients, two trust levels.** `getServiceClient()` uses the
  service-role key and bypasses RLS entirely; it's what the itinerary and
  hotel-match routes use today for anonymous, pre-login writes.
  `getUserScopedClient(accessToken)` uses the anon key plus a signed-in
  user's Auth0 access token, so `auth.uid()` resolves and RLS actually
  applies. Reach for the scoped client whenever a write should be attributed
  to the person who's actually signed in, not the server's own privileges.
- **Auth0 users aren't rows in `auth.users`.** Supabase's Third-Party Auth
  makes `auth.uid()` resolve correctly from an Auth0 token without ever
  creating a matching row in Supabase's own `auth.users` table. The original
  schema's `references auth.users(id)` foreign keys on `trips.user_id` and
  `traveler_codes.user_id` would therefore reject every insert from a real
  signed-in user; a follow-up migration drops just the foreign key, leaving
  the RLS policies (`auth.uid() = user_id`) untouched since those still work.

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
