# Ghostwriter

Ghostwriter matches travelers to hotel stays based on the vibe of an inspiration
photo. Upload an image, and Ghostwriter analyzes its aesthetic to surface hotel
listings that fit the mood.

This is a hackathon project. This stage of the app is scaffolding only: the
frontend and backend are wired together end-to-end using hardcoded mock data.
No AI analysis, hotel search API, database, or authentication is implemented
yet.

## Project structure

- `client/` — React app (Vite, JavaScript)
- `server/` — Express API server

## Setup

Requires Node.js 18+.

### 1. Install dependencies

```bash
cd client && npm install
cd ../server && npm install
```

### 2. Run the backend

```bash
cd server
npm run dev
```

The API server starts on [http://localhost:3001](http://localhost:3001).

### 3. Run the frontend

In a separate terminal:

```bash
cd client
npm run dev
```

The app opens on [http://localhost:5173](http://localhost:5173).

### 4. Try it out

Open the app in your browser, upload/drag in an image, and click "Find my
stay." The frontend calls the backend's mock `/api/analyze-photo` and
`/api/search-stays` endpoints and renders the returned hotel cards.

## API endpoints (mock data for now)

- `POST /api/analyze-photo` — returns a hardcoded vibe/amenities/destination
  analysis.
- `POST /api/search-stays` — returns a hardcoded list of hotel listings.
