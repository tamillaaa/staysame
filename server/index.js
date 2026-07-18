import express from 'express';
import cors from 'cors';

const app = express();
const PORT = 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.post('/api/analyze-photo', (req, res) => {
  res.json({
    vibe: 'beach',
    amenities: ['pool', 'ocean view', 'balcony'],
    destination: 'unknown',
  });
});

app.post('/api/search-stays', (req, res) => {
  res.json([
    {
      name: 'Azure Horizon Resort',
      location: 'Playa del Carmen, Mexico',
      price: '$189/night',
      image: 'https://placehold.co/400x300?text=Azure+Horizon+Resort',
      description: 'Beachfront suites with private balconies and infinity pool access.',
    },
    {
      name: 'Coral Bay Bungalows',
      location: 'Zanzibar, Tanzania',
      price: '$142/night',
      image: 'https://placehold.co/400x300?text=Coral+Bay+Bungalows',
      description: 'Cozy ocean-view bungalows steps from white sand beaches.',
    },
    {
      name: 'Marina Breeze Hotel',
      location: 'Santorini, Greece',
      price: '$225/night',
      image: 'https://placehold.co/400x300?text=Marina+Breeze+Hotel',
      description: 'Cliffside rooms with panoramic sea views and rooftop pool.',
    },
  ]);
});

app.listen(PORT, () => {
  console.log(`Ghostwriter server running on http://localhost:${PORT}`);
});
