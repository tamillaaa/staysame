import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import {
  analyzePhoto,
  generateMatchCaptions,
  suggestDestinations,
  resolveDestinations,
} from './lib/gemini.js';
import { searchStays, searchAnywhere } from './lib/stay22.js';

const app = express();
const PORT = process.env.PORT || 3001;

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    const err = new Error(`Unsupported image type "${file.mimetype}". Use JPEG, PNG, WebP or HEIC.`);
    err.status = 400;
    cb(err);
  },
});

app.use(cors({ origin: 'http://localhost:5173' }));
// Generous limit: the JSON path accepts base64 image payloads.
app.use(express.json({ limit: '15mb' }));

/** Send a consistently shaped error the frontend can render directly. */
function sendError(res, err, fallback) {
  const status = err?.status ?? 500;
  const message = err?.status ? err.message : fallback;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: message, code: err?.code ?? 'INTERNAL' });
}

/**
 * POST /api/analyze-photo
 * Accepts either multipart/form-data (field: `photo`) or JSON
 * { image: "<base64 or data URL>", mimeType?: "image/jpeg" }.
 */
app.post('/api/analyze-photo', upload.single('photo'), async (req, res) => {
  try {
    let base64Image;
    let mimeType;

    if (req.file) {
      base64Image = req.file.buffer.toString('base64');
      mimeType = req.file.mimetype;
    } else if (typeof req.body?.image === 'string' && req.body.image.trim()) {
      const dataUrl = req.body.image.match(/^data:(image\/[a-z+.-]+);base64,(.*)$/is);
      base64Image = dataUrl ? dataUrl[2] : req.body.image;
      mimeType = dataUrl ? dataUrl[1] : req.body.mimeType || 'image/jpeg';
      if (!ALLOWED_MIME.includes(mimeType)) {
        return res.status(400).json({
          error: `Unsupported image type "${mimeType}". Use JPEG, PNG, WebP or HEIC.`,
          code: 'BAD_MIME',
        });
      }
    } else {
      return res.status(400).json({
        error: 'No image received. Attach a file as "photo" or send { image: "<base64>" }.',
        code: 'NO_IMAGE',
      });
    }

    res.json(await analyzePhoto({ base64Image, mimeType }));
  } catch (err) {
    sendError(res, err, 'Could not analyze that photo. Please try again.');
  }
});

/**
 * POST /api/search-stays
 * Body: { vibe, amenities, destination_guess, price_tier, description,
 *         location?, checkin?, checkout? }
 */
app.post('/api/search-stays', async (req, res) => {
  try {
    const {
      vibe,
      amenities,
      destination_guess,
      price_tier,
      description,
      location,
      anywhere,
      checkin,
      checkout,
    } = req.body ?? {};

    if (!vibe || !price_tier) {
      return res.status(400).json({
        error: 'Missing photo analysis. Analyze a photo before searching.',
        code: 'MISSING_ANALYSIS',
      });
    }

    const analysis = {
      vibe,
      price_tier,
      amenities: Array.isArray(amenities) ? amenities : [],
      destination_guess: destination_guess ?? null,
      description: description ?? '',
    };

    const chosen = location?.trim() || analysis.destination_guess;
    if (!anywhere && !chosen) {
      return res.status(400).json({
        error: 'No destination provided or detected from the photo.',
        code: 'MISSING_DESTINATION',
      });
    }

    // Work out which places to search. "Anywhere" picks them from the vibe
    // alone; otherwise a broad input like "Portugal" is expanded into specific
    // places within it, while a city is passed straight through.
    let destinations;
    let expandedFrom = null;
    if (anywhere) {
      destinations = await suggestDestinations({ analysis });
    } else if (chosen === analysis.destination_guess) {
      // Gemini produced this guess itself and it's already specific — skip the
      // extra round trip on the common auto-search path.
      destinations = [chosen];
    } else {
      const resolved = await resolveDestinations({ analysis, location: chosen });
      destinations = resolved.destinations;
      if (resolved.expanded) expandedFrom = chosen;
    }

    const { listings, destination, ...window } =
      destinations.length > 1
        ? await searchAnywhere({ analysis, destinations, checkin, checkout })
        : await searchStays({ analysis, location: destinations[0], checkin, checkout });

    if (!listings.length) {
      return res.status(404).json({
        error: anywhere
          ? 'No stays found for that vibe right now. Try a specific destination instead.'
          : `No stays found in ${destination} for those criteria. Try a different place.`,
        code: 'NO_RESULTS',
      });
    }

    const captions = await generateMatchCaptions({ analysis, listings });
    const stays = listings.map(({ type, stars, guestRating, freeCancellation, ...card }, i) => ({
      ...card,
      matchReason: captions[i],
    }));

    res.json({ destination, expandedFrom, ...window, stays });
  } catch (err) {
    sendError(res, err, 'Could not search for stays. Please try again.');
  }
});

// Multer and fileFilter rejections surface here rather than as unhandled errors.
app.use((err, _req, res, _next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That image is larger than 10MB.', code: 'FILE_TOO_LARGE' });
  }
  sendError(res, err, 'Unexpected server error.');
});

app.listen(PORT, () => {
  console.log(`Ghostwriter server running on http://localhost:${PORT}`);
  if (!process.env.GEMINI_API_KEY) console.warn('⚠  GEMINI_API_KEY is not set — /api/analyze-photo will fail.');
  if (!process.env.STAY22_API_KEY) console.warn('⚠  STAY22_API_KEY is not set — using Stay22 demo mode (5 req/min).');
});
