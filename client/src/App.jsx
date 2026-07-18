import { useEffect, useRef, useState } from 'react';
import PhotoUpload from './components/PhotoUpload';
import HotelCard from './components/HotelCard';
import './App.css';

const API_BASE = 'http://localhost:3001';

/** Read the server's { error, code } envelope, falling back to a status line. */
async function readError(response, fallback) {
  const body = await response.json().catch(() => null);
  return body?.error || `${fallback} (HTTP ${response.status})`;
}

/** "Cancun, Mexico", "Phuket, Thailand" -> "Cancun, Phuket & Mallorca" */
function formatDestinations(destinations) {
  const names = destinations.map((d) => d.split(',')[0].trim());
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [stays, setStays] = useState([]);
  const [heading, setHeading] = useState(null);
  const [destinationInput, setDestinationInput] = useState('');
  const [anywhere, setAnywhere] = useState(false);
  const [phase, setPhase] = useState('idle'); // idle | analyzing | searching
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  // The narrative lands first and the rest follows a beat later, so the result
  // reads as a reveal rather than everything appearing at once.
  const [revealDetails, setRevealDetails] = useState(false);
  const revealTimer = useRef(null);

  useEffect(() => () => clearTimeout(revealTimer.current), []);

  const busy = phase === 'analyzing' || phase === 'searching';
  const canSearch = anywhere || destinationInput.trim().length > 0;

  const handleFileSelected = (selectedFile) => {
    setFile(selectedFile);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(selectedFile);
    });
    clearTimeout(revealTimer.current);
    setRevealDetails(false);
    setAnalysis(null);
    setStays([]);
    setHeading(null);
    setDestinationInput('');
    setAnywhere(false);
    setNotice(null);
    setError(null);
  };

  const runSearch = async (photoAnalysis, { location, searchAnywhere }) => {
    setPhase('searching');
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`${API_BASE}/api/search-stays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...photoAnalysis,
          location: searchAnywhere ? null : location,
          anywhere: searchAnywhere,
        }),
      });
      if (!response.ok) {
        setStays([]);
        setError(await readError(response, 'Stay search failed'));
        return;
      }

      const data = await response.json();
      setStays(data.stays);
      setHeading(
        data.destinations?.length > 1
          ? `Matched stays across ${formatDestinations(data.destinations)}`
          : `Matched stays in ${data.destination}`
      );

      // Say so when we searched somewhere other than what was typed, rather
      // than silently substituting destinations.
      const messages = [];
      if (data.expandedFrom) {
        messages.push(
          `${data.expandedFrom} is a big place, so we focused on the spots that best match your ${photoAnalysis.vibe} vibe.`
        );
      }
      if (data.relaxedPriceFilter) {
        messages.push(
          `Nothing matched your ${photoAnalysis.price_tier} budget there, so here are the closest options.`
        );
      }
      setNotice(messages.length ? messages : null);
    } catch {
      setStays([]);
      setError('Could not reach the server while searching for stays. Is it running?');
    } finally {
      setPhase('idle');
    }
  };

  const handleFindStay = async () => {
    if (!file) {
      setError('Please choose an inspiration photo first.');
      return;
    }

    setPhase('analyzing');
    setError(null);
    setNotice(null);
    setStays([]);
    setAnalysis(null);
    setHeading(null);
    clearTimeout(revealTimer.current);
    setRevealDetails(false);

    let photoAnalysis;
    try {
      const formData = new FormData();
      formData.append('photo', file);

      const response = await fetch(`${API_BASE}/api/analyze-photo`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        setError(await readError(response, 'Photo analysis failed'));
        setPhase('idle');
        return;
      }
      photoAnalysis = await response.json();
      setAnalysis(photoAnalysis);
      // Hold the narrative alone for a moment before the tags and picker join
      // it. With no narrative there's nothing to pause on, so skip the beat.
      if (photoAnalysis.narrative) {
        revealTimer.current = setTimeout(() => setRevealDetails(true), 1600);
      } else {
        setRevealDetails(true);
      }
    } catch {
      setError('Could not reach the server while analyzing your photo. Is it running?');
      setPhase('idle');
      return;
    }

    // Pre-fill the destination with Gemini's guess so it can be corrected, and
    // search it straight away. Without a guess, wait for the traveler to choose.
    const guess = photoAnalysis.destination_guess ?? '';
    setDestinationInput(guess);
    setAnywhere(false);

    if (guess) {
      await runSearch(photoAnalysis, { location: guess, searchAnywhere: false });
    } else {
      setPhase('idle');
      setNotice(["We couldn't tell where this photo was taken — pick a place, or search anywhere."]);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!analysis || !canSearch) return;
    runSearch(analysis, { location: destinationInput.trim(), searchAnywhere: anywhere });
  };

  const tags = analysis ? [analysis.vibe, ...analysis.amenities] : [];

  return (
    <div className="page">
      <header className="app-header">
        <h1>Ghostwriter</h1>
        <p className="tagline">Upload a vibe. Get matched with your next stay.</p>
      </header>

      <main>
        <section className="upload-section">
          <PhotoUpload onFileSelected={handleFileSelected} previewUrl={previewUrl} />
          <button
            type="button"
            className="find-stay-button"
            onClick={handleFindStay}
            disabled={busy}
          >
            {phase === 'analyzing'
              ? 'Reading your photo...'
              : phase === 'searching'
                ? 'Finding your stay...'
                : 'Find my stay'}
          </button>

          {error && (
            <p className="error-message" role="alert">
              {error}
            </p>
          )}

          {analysis?.narrative && (
            <p className="narrative">{analysis.narrative}</p>
          )}

          {analysis && revealDetails && (
            <div className="vibe-summary reveal">
              <p className="vibe-description">{analysis.description}</p>
              <ul className="vibe-tags">
                {tags.map((tag) => (
                  <li key={tag} className="vibe-tag">
                    {tag}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {analysis && revealDetails && (
            <form className="destination-picker reveal" onSubmit={handleSearchSubmit}>
              <span className="destination-label">Where to?</span>

              <div className="destination-modes">
                <button
                  type="button"
                  className={`mode-button ${anywhere ? '' : 'active'}`}
                  onClick={() => setAnywhere(false)}
                  disabled={busy}
                >
                  A specific place
                </button>
                <button
                  type="button"
                  className={`mode-button ${anywhere ? 'active' : ''}`}
                  onClick={() => setAnywhere(true)}
                  disabled={busy}
                >
                  Anywhere
                </button>
              </div>

              {anywhere ? (
                <p className="destination-hint">
                  We&apos;ll pick destinations around the world that match your photo&apos;s vibe.
                </p>
              ) : (
                <input
                  className="destination-input"
                  type="text"
                  value={destinationInput}
                  placeholder="City, region or country — e.g. Lisbon, Portugal"
                  onChange={(e) => setDestinationInput(e.target.value)}
                  disabled={busy}
                />
              )}

              <button type="submit" className="destination-submit" disabled={busy || !canSearch}>
                {phase === 'searching' ? 'Searching...' : 'Search stays'}
              </button>
            </form>
          )}

          {notice?.map((message) => (
            <p className="notice-message" key={message}>
              {message}
            </p>
          ))}

          {phase === 'searching' && (
            <p className="loading-message">
              {anywhere
                ? 'Scouting destinations that match your vibe...'
                : 'Searching real stays that match your vibe...'}
            </p>
          )}
        </section>

        {stays.length > 0 && revealDetails && (
          <section className="results-section reveal">
            <h2>{heading}</h2>
            <div className="hotel-grid">
              {stays.map((hotel) => (
                <HotelCard key={hotel.bookingUrl ?? hotel.name} hotel={hotel} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
