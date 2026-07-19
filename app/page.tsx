import { Suspense } from 'react';
import TripPlanner from './components/TripPlanner';
import ScrollDots from './components/ScrollDots';

export default function Home() {
  return (
    <main className="page">
      <section className="snap-section hero-section" id="hero" data-snap-label="Welcome">
        <nav className="topbar" aria-label="Stay Here">
          <div className="brand-lockup">
            <span className="brand-stamp">SH</span>
            <span>STAY HERE</span>
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
        <a className="scroll-hint" href="#plan">
          <span>Scroll to plan your trip</span>
          <i aria-hidden="true">↓</i>
        </a>
        <div className="ticker" aria-hidden="true">
          <span>REAL PLACES</span><b>✦</b><span>LIVE EVENTS</span><b>✦</b><span>SMARTER STAYS</span><b>✦</b><span>SIDE QUESTS INCLUDED</span>
        </div>
      </section>

      <section className="snap-section plan-section" id="plan" data-snap-label="Plan a trip">
        {/* TripPlanner reads the active tab from the URL, so it needs a Suspense
            boundary to keep this page statically renderable. */}
        <Suspense fallback={<div className="skeleton">Loading…</div>}>
          <TripPlanner />
        </Suspense>
      </section>

      <ScrollDots />
    </main>
  );
}
