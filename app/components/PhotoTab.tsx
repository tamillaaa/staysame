'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import GlobeLoader from './GlobeLoader';
import StayCard from './StayCard';
import type {
  ConfirmedStay,
  HotelMatchesResponse,
  HotelPickPublic,
  VibeSuggestion,
  VibeToDestinationResponse,
} from '@/lib/types';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

const READING_LINES = [
  'Reading the light and colour…',
  'Naming the mood…',
  'Matching it against real places…',
  'Shortlisting three that fit…',
] as const;

/** The photo flow has no dates, so stays are priced for a representative window. */
function defaultStayWindow(): { checkin: string; checkout: string } {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 30);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 2);
  return { checkin: start.toISOString().slice(0, 10), checkout: end.toISOString().slice(0, 10) };
}

/** Per-destination hotel state, so one bad geocode doesn't break the tab. */
type StayState =
  | { status: 'loading' }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string }
  | { status: 'ready'; picks: HotelPickPublic[] };

export default function PhotoTab({
  onDestinationPicked,
  onConfirmStay,
  confirmedStay,
}: {
  onDestinationPicked: (destination: string) => void;
  onConfirmStay: (stay: ConfirmedStay | null) => void;
  confirmedStay: ConfirmedStay | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<VibeToDestinationResponse | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [stays, setStays] = useState<StayState | null>(null);

  // Object URLs leak unless revoked; keep exactly one alive.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function setPreview(file: File) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }

  const analyze = useCallback(async (file: File) => {
    // Validate before spending a request.
    if (!ACCEPTED.includes(file.type)) {
      setError(`That file is a ${file.type || 'unknown type'}. Use a JPEG, PNG or WebP.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is 5MB.`);
      return;
    }

    setPreview(file);
    setError(null);
    setAnalysis(null);
    setSelected(null);
    setStays(null);
    setReading(true);

    try {
      const body = new FormData();
      body.append('photo', file);
      const response = await fetch('/api/vibe-to-destination', { method: 'POST', body });
      const data = await response.json();

      if (!response.ok) {
        setError(data?.error ?? `Couldn't read that photo (HTTP ${response.status}).`);
        return;
      }
      setAnalysis(data as VibeToDestinationResponse);
    } catch {
      setError('Could not reach the server. Is it running?');
    } finally {
      setReading(false);
    }
  }, []);

  const pickDestination = useCallback(
    async (suggestion: VibeSuggestion) => {
      setSelected(suggestion.destination);
      setStays({ status: 'loading' });

      const { checkin, checkout } = defaultStayWindow();
      try {
        const response = await fetch('/api/hotel-matches', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            destination: suggestion.destination,
            checkin,
            checkout,
            budget_tier: 'mid',
            // Bias ordering toward stays that read like the photo. The listing
            // keywords do most of the work — mood tags rarely appear in names.
            vibeTags: [...(analysis?.listingKeywords ?? []), ...(analysis?.tags ?? [])],
          }),
        });
        const data = await response.json();

        if (response.status === 404) {
          // One destination with no inventory shouldn't break the whole tab.
          setStays({ status: 'empty', message: 'No matches for this one yet, try another.' });
          return;
        }
        if (!response.ok) {
          setStays({ status: 'error', message: data?.error ?? 'Could not load stays.' });
          return;
        }
        setStays({ status: 'ready', picks: (data as HotelMatchesResponse).picks });
      } catch {
        setStays({ status: 'error', message: 'Could not reach the server while loading stays.' });
      }
    },
    [analysis]
  );

  async function confirmStay(pick: HotelPickPublic) {
    if (confirmedStay?.hotelName === pick.name) {
      onConfirmStay(null);
      return;
    }
    const { checkin, checkout } = defaultStayWindow();
    onConfirmStay({ hotelName: pick.name, checkIn: checkin, checkOut: checkout });

    // Give the Connect tab a trip to attach a traveler code to. Fire and forget:
    // the row is a nicety, and Supabase may not be configured at all.
    try {
      await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: selected,
          source_image_url: analysis?.imageUrl ?? null,
        }),
      });
    } catch {
      // Non-blocking by design.
    }
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) analyze(file);
  }

  return (
    <div className="photo-tab">
      <div className="photo-head">
        <h2>Turn one photo into your next trip</h2>
        <p className="hint">
          Drop a photo with the vibe you&apos;re chasing: golden light, tiled alleys, a moody
          coastline. We read its mood and colours, then suggest three real places that match, each
          with stays to go with it. Pick one and hand it straight to the trip planner.
        </p>
      </div>

      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Upload an inspiration photo"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) analyze(file);
            // Reset so re-picking the same file fires change again.
            e.target.value = '';
          }}
        />
        {previewUrl ? (
          <img className="dropzone-preview" src={previewUrl} alt="Your inspiration photo" />
        ) : (
          <div className="dropzone-empty">
            <strong>Drop an inspiration photo</strong>
            <span>or click to choose one · JPEG, PNG or WebP, up to 5MB</span>
          </div>
        )}
      </div>

      {error && (
        <div className="error" role="alert">
          <p style={{ margin: 0 }}>{error}</p>
          <button
            type="button"
            className="retry"
            onClick={() => {
              setError(null);
              inputRef.current?.click();
            }}
          >
            Try another photo
          </button>
        </div>
      )}

      {reading && (
        <GlobeLoader lines={READING_LINES} sub="Reading your photo, this takes a few seconds." />
      )}

      {analysis && !reading && (
        <section className="vibe">
          <ul className="vibe-tags">
            {analysis.tags.map((tag) => (
              <li className="vibe-tag" key={tag}>
                {tag}
              </li>
            ))}
          </ul>

          <h3 className="vibe-head">Three places that match</h3>
          <div className="vibe-grid">
            {analysis.suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion.destination}
                className={`vibe-card${selected === suggestion.destination ? ' active' : ''}`}
                aria-pressed={selected === suggestion.destination}
                onClick={() => pickDestination(suggestion)}
              >
                <span className="vibe-dest">{suggestion.destination}</span>
                <span className="vibe-reason">{suggestion.reason}</span>
              </button>
            ))}
          </div>

          {!analysis.imageUrl && (
            <p className="hint" style={{ marginTop: 12 }}>
              Photo not saved. Supabase Storage isn&apos;t configured, so it lives only in this tab.
            </p>
          )}
        </section>
      )}

      {selected && stays && (
        <section className="stays">
          <h3 className="stays-head">Where to stay in {selected}</h3>

          {stays.status === 'loading' && <p className="hint">Finding stays that match the vibe…</p>}
          {stays.status === 'empty' && <p className="hint">{stays.message}</p>}
          {stays.status === 'error' && (
            <p className="error" role="alert">
              {stays.message}
            </p>
          )}

          {stays.status === 'ready' && (
            <>
              <div className="stay-grid">
                {stays.picks.map((pick) => (
                  <StayCard
                    key={pick.id}
                    pick={pick}
                    confirmed={confirmedStay?.hotelName === pick.name}
                    onConfirm={() => confirmStay(pick)}
                  />
                ))}
              </div>
              <button
                type="button"
                className="primary handoff"
                onClick={() => onDestinationPicked(selected)}
              >
                Build the full itinerary for {selected}
              </button>
            </>
          )}
        </section>
      )}
    </div>
  );
}
