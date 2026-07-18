import { Suspense } from 'react';
import TripPlanner from './components/TripPlanner';

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <h1>Vibe Trip</h1>
        <p className="tagline">
          Real spots, real events, and a few dares you wouldn&apos;t have thought of.
        </p>
      </header>

      {/* TripPlanner reads the active tab from the URL, so it needs a Suspense
          boundary to keep this page statically renderable. */}
      <Suspense fallback={<div className="skeleton">Loading…</div>}>
        <TripPlanner />
      </Suspense>
    </main>
  );
}
