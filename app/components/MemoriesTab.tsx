'use client';

import { useEffect, useRef, useState } from 'react';
import { base64ToBlobUrl } from '@/lib/audio';
import type { AlbumCaptionResponse, NarrateResponse } from '@/lib/types';
import GlobeLoader from './GlobeLoader';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PHOTOS = 10;

const CAPTIONING_LINES = [
  'Looking at the light…',
  'Finding the feeling in each shot…',
  'Writing captions…',
] as const;

type AlbumPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  caption: string | null;
};

/** Trip photo album: upload photos, get a caption per photo, then an optional voice note over the set. */
export default function MemoriesTab({ defaultDestination }: { defaultDestination?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<AlbumPhoto[]>([]);
  const audioUrlRef = useRef<string | null>(null);

  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [captioning, setCaptioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [narrating, setNarrating] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [narration, setNarration] = useState<{ audioUrl: string; script: string } | null>(null);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // Object URLs leak unless revoked; clean up everything on unmount.
  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  async function addPhotos(fileList: FileList) {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setError(`You can add up to ${MAX_PHOTOS} photos. Remove one to add another.`);
      return;
    }

    const accepted: File[] = [];
    const problems: string[] = [];
    for (const file of incoming.slice(0, room)) {
      if (!ACCEPTED.includes(file.type)) {
        problems.push(`${file.name} is a ${file.type || 'unknown type'}`);
        continue;
      }
      if (file.size > MAX_BYTES) {
        problems.push(`${file.name} is over 5MB`);
        continue;
      }
      accepted.push(file);
    }
    if (incoming.length > room) {
      problems.push(`only ${room} more photo${room === 1 ? '' : 's'} fit (max ${MAX_PHOTOS})`);
    }

    if (accepted.length === 0) {
      setError(problems.length ? `Skipped: ${problems.join(', ')}.` : 'No photos added.');
      return;
    }

    const newEntries: AlbumPhoto[] = accepted.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      caption: null,
    }));

    setPhotos((prev) => [...prev, ...newEntries]);
    setError(problems.length ? `Added ${accepted.length}. Skipped: ${problems.join(', ')}.` : null);
    // The photo set changed, so any existing voice note no longer covers it.
    setNarration(null);
    setNarrationError(null);

    setCaptioning(true);
    try {
      const body = new FormData();
      newEntries.forEach((entry) => body.append('photos', entry.file));
      const response = await fetch('/api/album-captions', { method: 'POST', body });
      const data = await response.json();

      if (!response.ok) {
        setError(data?.error ?? `Couldn't caption those photos (HTTP ${response.status}).`);
        return;
      }
      const { captions } = data as AlbumCaptionResponse;
      setPhotos((prev) =>
        prev.map((p) => {
          const index = newEntries.findIndex((e) => e.id === p.id);
          return index >= 0 ? { ...p, caption: captions[index] ?? p.caption } : p;
        })
      );
    } catch {
      setError('Could not reach the server while captioning those photos.');
    } finally {
      setCaptioning(false);
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setNarration(null);
    setNarrationError(null);
  }

  function clearAlbum() {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPhotos([]);
    setError(null);
    setNarration(null);
    setNarrationError(null);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) addPhotos(event.dataTransfer.files);
  }

  async function generateVoiceNote() {
    const captions = photos.map((p) => p.caption).filter((c): c is string => Boolean(c));
    if (captions.length === 0) return;

    setNarrating(true);
    setNarrationError(null);
    try {
      const response = await fetch('/api/album-narrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ captions, destination: defaultDestination }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Could not generate a voice note. Please try again.');
      }
      const { script, audioBase64, mimeType } = data as NarrateResponse;

      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const audioUrl = base64ToBlobUrl(audioBase64, mimeType);
      audioUrlRef.current = audioUrl;
      setNarration({ audioUrl, script });
    } catch (err) {
      setNarrationError(err instanceof Error ? err.message : 'Could not generate a voice note.');
    } finally {
      setNarrating(false);
    }
  }

  const captionedCount = photos.filter((p) => p.caption).length;

  return (
    <div className="memories-tab">
      <div className="memories-head">
        <h2>Turn your trip photos into a keepsake</h2>
        <p className="hint">
          Upload photos from the trip you just took. Each one gets a short caption, and once a few are
          in, you can turn the set into a short voice note.
        </p>
      </div>

      <div
        className={`album-drop${dragging ? ' dragging' : ''}`}
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
        aria-label="Upload trip photos"
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(',')}
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addPhotos(e.target.files);
            e.target.value = '';
          }}
        />
        <div className="dropzone-empty">
          <strong>{photos.length === 0 ? 'Drop your trip photos here' : 'Add more photos'}</strong>
          <span>
            or click to choose · JPEG, PNG or WebP, up to 5MB each · up to {MAX_PHOTOS} photos
          </span>
        </div>
      </div>

      {error && (
        <div className="error" role="alert">
          <p style={{ margin: 0 }}>{error}</p>
        </div>
      )}

      {captioning && (
        <GlobeLoader lines={CAPTIONING_LINES} sub="Reading your photos — this takes a few seconds." />
      )}

      {photos.length > 0 && (
        <section className="album">
          <div className="album-head">
            <h3 className="vibe-head">Your album</h3>
            <button type="button" className="link-small" onClick={clearAlbum}>
              Clear all
            </button>
          </div>
          <div className="album-grid">
            {photos.map((photo) => (
              <figure className="album-card" key={photo.id}>
                <button
                  type="button"
                  className="album-remove"
                  onClick={() => removePhoto(photo.id)}
                  aria-label="Remove this photo"
                >
                  ×
                </button>
                <img className="album-photo" src={photo.previewUrl} alt={photo.caption ?? 'Trip photo'} />
                <figcaption className="album-caption">
                  {photo.caption ?? (captioning ? 'Writing a caption…' : '—')}
                </figcaption>
              </figure>
            ))}
          </div>

          <div className="narration-bar">
            <span className="hint">
              {captionedCount === 0
                ? 'Captions are still being written.'
                : `${captionedCount} ${captionedCount === 1 ? 'photo' : 'photos'} captioned.`}
            </span>
            <button
              type="button"
              disabled={captionedCount === 0 || narrating || captioning}
              onClick={generateVoiceNote}
            >
              {narrating ? 'Generating…' : 'Add a voice note'}
            </button>
          </div>

          {narrationError && <p className="error">{narrationError}</p>}

          {narration && (
            <div className="narration-result">
              <audio controls src={narration.audioUrl} />
              <p className="narration-script">{narration.script}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
