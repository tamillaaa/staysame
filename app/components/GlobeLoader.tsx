'use client';

import { useEffect, useState } from 'react';

const STATUS_LINES = [
  'Scanning three continents…',
  'Checking what’s on that week…',
  'Reading the room, city by city…',
  'Plotting detours worth the story…',
  'Cross-checking the real spots…',
];

/**
 * The "searching the world" state: a wireframe chart globe with rotating
 * meridians and a magenta flight path that lands a pin each sweep.
 * Reduced motion gets a static globe with one pulsing waypoint (CSS handles
 * the swap); the status line also stops cycling.
 */
export default function GlobeLoader({
  lines = STATUS_LINES,
  sub = 'Real spots, real events — this takes a few seconds.',
}: {
  /** Override the cycling copy; the photo flow isn't searching for events. */
  lines?: readonly string[];
  sub?: string;
} = {}) {
  const [line, setLine] = useState(0);

  useEffect(() => {
    setLine(0);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      setLine((current) => (current + 1) % lines.length);
    }, 2400);
    return () => clearInterval(timer);
  }, [lines]);

  return (
    <div className="globe-loader" role="status">
      <svg className="globe" viewBox="0 0 120 120" aria-hidden="true">
        <defs>
          <clipPath id="globe-clip">
            <circle cx="60" cy="60" r="44" />
          </clipPath>
        </defs>

        <circle className="globe-outline" cx="60" cy="60" r="44" />

        <g clipPath="url(#globe-clip)">
          {/* latitude chords, gently bowed away from the equator */}
          <path className="lat" d="M22 40 Q60 46 98 40" />
          <path className="lat" d="M16 60 H104" />
          <path className="lat" d="M22 80 Q60 74 98 80" />

          {/* meridians: rx animates to fake rotation */}
          <ellipse className="meridian meridian-1" cx="60" cy="60" rx="44" ry="44" />
          <ellipse className="meridian meridian-2" cx="60" cy="60" rx="28" ry="44" />
          <ellipse className="meridian meridian-3" cx="60" cy="60" rx="12" ry="44" />
        </g>

        {/* great-circle flight path, drawn each sweep */}
        <path className="flight" d="M22 74 Q56 8 97 51" pathLength={100} />
        <circle className="pin" cx="97" cy="51" r="3.5" />
      </svg>

      <p className="globe-status" aria-live="polite">
        <span className="globe-line" key={line}>
          {lines[line]}
        </span>
      </p>
      <p className="globe-sub">{sub}</p>
    </div>
  );
}
