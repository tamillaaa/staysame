export const BUDGET_TIERS = ['shoestring', 'mid', 'splurge'] as const;
export type BudgetTier = (typeof BUDGET_TIERS)[number];

export const TIME_BLOCKS = ['morning', 'afternoon', 'evening', 'night'] as const;
export type TimeBlock = (typeof TIME_BLOCKS)[number];

export const CONTINENTS = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
] as const;
export type Continent = (typeof CONTINENTS)[number];

/** One row of the `itinerary` jsonb array stored on `trips`. */
export type ItineraryItem = {
  day: number;
  time_block: TimeBlock;
  activity: string;
  is_side_quest: boolean;
  description: string;
};

export type Itinerary = {
  destination: string;
  summary: string;
  items: ItineraryItem[];
};

/** A top-rated spot from Google Places, fed to Claude as grounding. */
export type Spot = {
  name: string;
  address: string;
  rating: number | null;
  ratingCount: number | null;
  types: string[];
};

/** A real event from Ticketmaster, fed to Claude as grounding. */
export type LiveEvent = {
  name: string;
  date: string | null;
  venue: string | null;
  url: string | null;
  category: string | null;
};

export type GenerateItineraryRequest = {
  /** 'surprise_me' picks any destination; 'continent' narrows it to one. */
  mode: 'destination' | 'surprise_me' | 'continent';
  destination?: string;
  continent?: Continent;
  budget_tier: BudgetTier;
  trip_length_days: number;
  start_date?: string;
};

export type GenerateItineraryResponse = {
  tripId: string | null;
  destination: string;
  summary: string;
  startDate: string | null;
  endDate: string | null;
  budgetTier: BudgetTier;
  items: ItineraryItem[];
  /** What actually grounded the itinerary, so the UI can be honest about it. */
  sources: {
    spots: number;
    events: number;
    placesConfigured: boolean;
    ticketmasterConfigured: boolean;
  };
  persisted: boolean;
};

export type ApiError = { error: string; code: string };
