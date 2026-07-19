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

// A few fixed tilt angles, cycled by index — charming, but stable across renders.
const TILTS = [-2.4, 1.6, -1.1, 2.2, -1.8, 1.1, -2.6, 1.9];
const ASH_PARTICLE_COUNT = 14;

type AlbumPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  caption: string | null;
};

type TiltStyle = React.CSSProperties & { '--tilt'?: string };
type AshStyle = React.CSSProperties & { '--dx'?: string; '--dy'?: string; '--delay'?: string };

/** Fire-and-forget a short ElevenLabs sound effect. Never blocks or throws into the caller. */
function playSfx(effect: 'add' | 'remove') {
  try {
    const audio = new Audio(`/api/album-sfx?effect=${effect}`);
    audio.volume = 0.6;
    void audio.play().catch(() => {});
  } catch {
    // Sound effects are a nicety, not a dependency of the core flow.
  }
}

function AshBurst() {
  return (
    <span className="ash-burst" aria-hidden="true">
      {Array.from({ length: ASH_PARTICLE_COUNT }, (_, i) => {
        const angle = (i / ASH_PARTICLE_COUNT) * 360;
        const spread = 22 + (i % 3) * 12;
        const dx = Math.round(Math.cos((angle * Math.PI) / 180) * spread);
        const dy = -Math.round(28 + (i % 4) * 14);
        const style: AshStyle = {
          '--dx': `${dx}px`,
          '--dy': `${dy}px`,
          '--delay': `${(i % 7) * 35}ms`,
          width: 3 + (i % 3),
          height: 3 + (i % 3),
        };
        return <span key={i} className="ash-particle" style={style} />;
      })}
    </span>
  );
}

const NOTE_GLYPHS = ['♪', '♫', '♬'];

function NoteFloat() {
  return (
    <span className="note-float" aria-hidden="true">
      {NOTE_GLYPHS.map((glyph, i) => (
        <span className="note" key={i}>
          {glyph}
        </span>
      ))}
    </span>
  );
}

/** Trip photo album: upload photos, get a caption per photo, reorder/remove them, then an optional voice note. */
export default function MemoriesTab({ defaultDestination }: { defaultDestination?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef<AlbumPhoto[]>([]);
  const audioUrlRef = useRef<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const melodyAudioRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const hoveredIdRef = useRef<string | null>(null);
  const generatingAudioRef = useRef<HTMLAudioElement | null>(null);

  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [captioning, setCaptioning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [narrating, setNarrating] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [narration, setNarration] = useState<{ audioUrl: string; script: string } | null>(null);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  // A cozy loop plays for as long as photos are being read and captioned.
  useEffect(() => {
    if (!captioning) {
      generatingAudioRef.current?.pause();
      return;
    }
    if (!generatingAudioRef.current) {
      generatingAudioRef.current = new Audio('/api/album-sfx?effect=generating');
      generatingAudioRef.current.loop = true;
      generatingAudioRef.current.volume = 0.4;
    }
    void generatingAudioRef.current.play().catch(() => {});
  }, [captioning]);

  // Object URLs leak unless revoked; clean up everything on unmount.
  useEffect(() => {
    return () => {
      photosRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      melodyAudioRef.current.forEach((audio) => audio.pause());
      generatingAudioRef.current?.pause();
    };
  }, []);

  /** Lazily fetches and caches a photo's vibe melody, then plays it on loop while hovered. */
  function hoverPhoto(photo: AlbumPhoto) {
    if (!photo.caption || removingIds.has(photo.id)) return;
    hoveredIdRef.current = photo.id;
    setPlayingId(photo.id);
    generatingAudioRef.current?.pause();

    melodyAudioRef.current.forEach((audio, id) => {
      if (id !== photo.id) audio.pause();
    });

    let audio = melodyAudioRef.current.get(photo.id);
    if (!audio) {
      audio = new Audio(`/api/album-melody?caption=${encodeURIComponent(photo.caption)}`);
      audio.loop = true;
      audio.volume = 0.45;
      melodyAudioRef.current.set(photo.id, audio);
    }
    audio.currentTime = 0;
    void audio.play().catch(() => {});
  }

  function leavePhoto(photo: AlbumPhoto) {
    if (hoveredIdRef.current === photo.id) hoveredIdRef.current = null;
    setPlayingId((id) => (id === photo.id ? null : id));
    melodyAudioRef.current.get(photo.id)?.pause();
  }

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

    playSfx('add');
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
    if (removingIds.has(id)) return;
    playSfx('remove');
    setRemovingIds((prev) => new Set(prev).add(id));
    setNarration(null);
    setNarrationError(null);

    const melody = melodyAudioRef.current.get(id);
    if (melody) {
      melody.pause();
      melodyAudioRef.current.delete(id);
    }
    if (hoveredIdRef.current === id) hoveredIdRef.current = null;
    setPlayingId((current) => (current === id ? null : current));

    // Let the ash animation play before the photo actually leaves the album.
    window.setTimeout(() => {
      setPhotos((prev) => {
        const target = prev.find((p) => p.id === id);
        if (target) URL.revokeObjectURL(target.previewUrl);
        return prev.filter((p) => p.id !== id);
      });
      setRemovingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 850);
  }

  function clearAlbum() {
    photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    melodyAudioRef.current.forEach((audio) => audio.pause());
    melodyAudioRef.current.clear();
    hoveredIdRef.current = null;
    setPlayingId(null);
    setPhotos([]);
    setRemovingIds(new Set());
    setError(null);
    setNarration(null);
    setNarrationError(null);
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files?.length) addPhotos(event.dataTransfer.files);
  }

  function reorderOverFrame(overId: string) {
    const fromId = dragIdRef.current;
    if (!fromId || fromId === overId) return;
    setPhotos((prev) => {
      const fromIndex = prev.findIndex((p) => p.id === fromId);
      const toIndex = prev.findIndex((p) => p.id === overId);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setNarration(null);
    setNarrationError(null);
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
        throw new Error(data?.error || 'Could not turn this into a story. Please try again.');
      }
      const { script, audioBase64, mimeType } = data as NarrateResponse;

      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      const audioUrl = base64ToBlobUrl(audioBase64, mimeType);
      audioUrlRef.current = audioUrl;
      setNarration({ audioUrl, script });
    } catch (err) {
      setNarrationError(err instanceof Error ? err.message : 'Could not turn this into a story.');
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
          Upload photos from the trip you just took. Each one gets a short caption and its own little
          melody — hover a photo to hear it. Drag the film reel below to reorder them, and once a few
          are captioned you can turn the set into a short spoken story.
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
            {photos.map((photo, index) => {
              const removing = removingIds.has(photo.id);
              const tiltStyle: TiltStyle = { '--tilt': `${TILTS[index % TILTS.length]}deg` };
              return (
                <figure
                  className={`album-card${removing ? ' removing' : ''}`}
                  key={photo.id}
                  style={tiltStyle}
                  onMouseEnter={() => hoverPhoto(photo)}
                  onMouseLeave={() => leavePhoto(photo)}
                >
                  {!removing && (
                    <button
                      type="button"
                      className="album-remove"
                      onClick={() => removePhoto(photo.id)}
                      aria-label="Remove this photo"
                    >
                      ×
                    </button>
                  )}
                  <img className="album-photo" src={photo.previewUrl} alt={photo.caption ?? 'Trip photo'} />
                  <figcaption className="album-caption">
                    {photo.caption ?? (captioning ? 'Writing a caption…' : '—')}
                  </figcaption>
                  {removing && <AshBurst />}
                  {playingId === photo.id && !removing && <NoteFloat />}
                </figure>
              );
            })}
          </div>

          {photos.length > 1 && (
            <div className="filmstrip">
              <div className="filmstrip-track">
                {photos.map((photo, index) => (
                  <div
                    key={photo.id}
                    className={`filmstrip-frame${dragOverId === photo.id ? ' drag-over' : ''}`}
                    draggable
                    onDragStart={() => {
                      dragIdRef.current = photo.id;
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverId(photo.id);
                      reorderOverFrame(photo.id);
                    }}
                    onDragLeave={() => setDragOverId((id) => (id === photo.id ? null : id))}
                    onDrop={(e) => e.preventDefault()}
                    onDragEnd={() => {
                      dragIdRef.current = null;
                      setDragOverId(null);
                    }}
                    title={`Photo ${index + 1} — drag to reorder`}
                  >
                    <img src={photo.previewUrl} alt="" />
                  </div>
                ))}
              </div>
              <p className="filmstrip-hint">Drag the reel to reorder your album</p>
            </div>
          )}

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
              {narrating ? 'Writing your story…' : 'Turn into a story'}
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
