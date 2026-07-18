# Ghostwriter

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
analyzes the photo, shows the detected vibe and amenities as tags, then
searches for real stays and renders the matching hotel cards. If Gemini can't
tell where the photo was taken, it asks you where you're going first.

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
  "description": "Sun-bleached cliffside terraces above turquoise water."
}
```

`vibe` is one of `beach`, `urban`, `mountain`, `rustic`, `luxury`,
`minimalist`; `price_tier` is `budget`, `mid` or `luxury`. If Gemini returns
unparseable output, the server retries once with a stricter prompt before
returning an error.

### `POST /api/search-stays`

Accepts the analysis above plus an optional `location` (used when
`destination_guess` is `null`) and optional `checkin`/`checkout` dates.

Returns `{ destination, checkin, checkout, nights, stays }`, where each stay is:

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
- **`gemini-2.5-flash` is retired.** It returns `404 — no longer available to
  new users`. The server pins `gemini-3.5-flash` instead; override with
  `GEMINI_MODEL`.
- **Gemini almost always guesses a destination.** It returned "Kyoto, Japan"
  for a featureless colour gradient. The "Where are you thinking of going?"
  prompt is wired up and works, but in practice `destination_guess` is rarely
  `null`, so users seldom see it.
- **Match captions degrade gracefully.** They come from a second batched Gemini
  call; if it fails or is rate-limited, the server falls back to a rule-based
  caption built from star rating and guest score rather than failing the search.
