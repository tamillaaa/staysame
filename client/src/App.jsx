import { useState } from 'react';
import PhotoUpload from './components/PhotoUpload';
import HotelCard from './components/HotelCard';
import './App.css';

const API_BASE = 'http://localhost:3001';

function App() {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [hotels, setHotels] = useState([]);
  const [vibe, setVibe] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileSelected = (selectedFile) => {
    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setHotels([]);
    setVibe(null);
    setError(null);
  };

  const handleFindStay = async () => {
    if (!file) {
      setError('Please choose an inspiration photo first.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('photo', file);

      const analyzeRes = await fetch(`${API_BASE}/api/analyze-photo`, {
        method: 'POST',
        body: formData,
      });
      const analysis = await analyzeRes.json();
      setVibe(analysis);

      const staysRes = await fetch(`${API_BASE}/api/search-stays`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analysis),
      });
      const stays = await staysRes.json();
      setHotels(stays);
    } catch {
      setError('Something went wrong while finding your stay. Is the server running?');
    } finally {
      setLoading(false);
    }
  };

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
            disabled={loading}
          >
            {loading ? 'Finding your stay...' : 'Find my stay'}
          </button>
          {error && <p className="error-message">{error}</p>}
          {vibe && (
            <p className="vibe-summary">
              Detected vibe: <strong>{vibe.vibe}</strong> &middot; amenities:{' '}
              {vibe.amenities.join(', ')}
            </p>
          )}
        </section>

        {hotels.length > 0 && (
          <section className="results-section">
            <h2>Matched stays</h2>
            <div className="hotel-grid">
              {hotels.map((hotel) => (
                <HotelCard key={hotel.name} hotel={hotel} />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
