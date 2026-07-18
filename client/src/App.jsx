import { useState } from 'react';
import PhotoUpload from './components/PhotoUpload';
import HotelCard from './components/HotelCard';
import './App.css';

const API_BASE = 'http://localhost:3001';

/** Read the server's { error, code } envelope, falling back to a status line. */
async function readError(response, fallback) {
  const body = await response.json().catch(() => null);
  return body?.error || `${fallback} (HTTP ${response.status})`;
}

function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [stays, setStays] = useState([]);
  const [destination, setDestination] = useState(null);
  const [locationInput, setLocationInput] = useState('');
  const [needsLocation, setNeedsLocation] = useState(false);
  const [notice, setNotice] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | analyzing | searching
  const [error, setError] = useState(null);

  const busy = phase === 'analyzing' || phase === 'searching';

  const handleFileSelected = (selectedFile) => {
    setFile(selectedFile);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(selectedFile);
    });
    setAnalysis(null);
    setStays([]);
    setDestination(null);
    setNeedsLocation(false);
    setLocationInput('');
    setNotice(null);
    setError(null);
  };

  const searchStays = async (photoAnalysis, location) => {
    setPhase('searching');
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${API_BASE}/api/search-stays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...photoAnalysis, location }),
      });
      if (!response.ok) {
        setError(await readError(response, 'Stay search failed'));
        return;
      }
      const data = await response.json();
      setStays(data.stays);
      setDestination(data.destination);
      setNotice(
        data.relaxedPriceFilter
          ? `Nothing matched your ${photoAnalysis.price_tier} budget there, so here are the closest options.`
          : null
      );
      setNeedsLocation(false);
    } catch {
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
    setStays([]);
    setAnalysis(null);
    setNeedsLocation(false);
    setNotice(null);

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
    } catch {
      setError('Could not reach the server while analyzing your photo. Is it running?');
      setPhase('idle');
      return;
    }

    // Gemini could not place the photo — ask the traveler before searching.
    if (!photoAnalysis.destination_guess) {
      setNeedsLocation(true);
      setPhase('idle');
      return;
    }
    await searchStays(photoAnalysis, null);
  };

  const handleLocationSubmit = (e) => {
    e.preventDefault();
    if (locationInput.trim()) searchStays(analysis, locationInput.trim());
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

          {analysis && (
            <div className="vibe-summary">
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

          {needsLocation && (
            <form className="location-prompt" onSubmit={handleLocationSubmit}>
              <label htmlFor="location">Where are you thinking of going?</label>
              <div className="location-row">
                <input
                  id="location"
                  type="text"
                  value={locationInput}
                  placeholder="e.g. Lisbon, Portugal"
                  onChange={(e) => setLocationInput(e.target.value)}
                  disabled={busy}
                  autoFocus
                />
                <button type="submit" disabled={busy || !locationInput.trim()}>
                  Search
                </button>
              </div>
            </form>
          )}

          {phase === 'searching' && (
            <p className="loading-message">Searching real stays that match your vibe...</p>
          )}
        </section>

        {stays.length > 0 && (
          <section className="results-section">
            <h2>Matched stays{destination ? ` in ${destination}` : ''}</h2>
            {notice && <p className="notice-message">{notice}</p>}
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
