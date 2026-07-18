import { Suspense } from 'react';
import TripPlanner from './components/TripPlanner';

export default function Home() {
  return (
    <main className="page">
      <nav className="topbar" aria-label="Vibe Trip">
        <div className="brand-lockup">
          <span className="brand-stamp">VT</span>
          <span>VIBE TRIP</span>
        </div>
        <span className="topbar-note">TRAVEL WITH A BETTER STORY</span>
      </nav>
      <header className="masthead">
        <div className="masthead-copy">
          <p className="eyebrow"><span /> YOUR NEXT STORY STARTS HERE</p>
          <h1>Go for the trip.<br /><em>Stay for the plot.</em></h1>
        <p className="tagline">
          Real spots, real events, and a few dares you wouldn&apos;t have thought of.
        </p>
        </div>
        <div className="postcard" aria-hidden="true">
          <div className="postcard-sun" />
          <div className="postcard-water" />
          <div className="postcard-land"><i /><i /><i /><i /><i /></div>
          <span className="postcard-stamp">GO<br />FIND<br />OUT</span>
          <small>VACATION MODE: ON</small>
        </div>
      </header>

      <div className="ticker" aria-hidden="true">
        <span>REAL PLACES</span><b>✦</b><span>LIVE EVENTS</span><b>✦</b><span>SMARTER STAYS</span><b>✦</b><span>SIDE QUESTS INCLUDED</span>
      </div>

      {/* TripPlanner reads the active tab from the URL, so it needs a Suspense
          boundary to keep this page statically renderable. */}
      <Suspense fallback={<div className="skeleton">Loading…</div>}>
        <TripPlanner />
      </Suspense>
    </main>
  );
}
