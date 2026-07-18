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
  lat: number | null;
  lng: number | null;
};

/** Map centre used to anchor the hotel search, sized to the spots' spread. */
export type GeoPoint = { lat: number; lng: number; radiusMeters?: number };

/** A named place from the itinerary, used to measure how close a stay is. */
export type Anchor = { name: string; lat: number; lng: number };

/** How far a stay is from the nearest thing on the itinerary. */
export type Proximity = { spotName: string; meters: number; walkMinutes: number };

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
  /** Centre of the itinerary's spots; anchors the hotel search. */
  center: GeoPoint | null;
  /** The spots themselves, so stays can be ranked by walking distance to them. */
  anchors: Anchor[];
};

export type ApiError = { error: string; code: string };

/** A stay the traveler can book, as sent to the browser (no `raw` payload). */
export type HotelPickPublic = {
  id: string;
  name: string;
  location: string;
  provider: string | null;
  pricePerNight: number | null;
  priceLabel: string;
  imageUrl: string | null;
  allezDeeplink: string | null;
  stars: number | null;
  guestRating: number | null;
  reviewCount: number | null;
  freeCancellation: boolean;
  description: string;
  /** Distance to the closest itinerary spot, when anchors were supplied. */
  proximity: Proximity | null;
  /** One evocative sentence about the place, grounded only in known facts. */
  blurb: string | null;
};

export type HotelMatchesRequest = {
  destination: string;
  checkin: string;
  checkout: string;
  budget_tier: BudgetTier;
  /** Optional: links the saved picks to a trip row. */
  trip_id?: string | null;
  /** Optional: search around this point instead of geocoding the destination. */
  center?: GeoPoint | null;
  /** Optional: itinerary spots, used to rank stays by walking distance. */
  anchors?: Anchor[];
};

export type HotelMatchesResponse = {
  destination: string;
  checkin: string;
  checkout: string;
  nights: number;
  /** True when the budget band matched nothing and was dropped. */
  relaxedPriceFilter: boolean;
  /** False when STAY22_AID is unset — bookings won't attribute to you. */
  affiliateConfigured: boolean;
  persisted: boolean;
  /** True when the search was anchored on the itinerary's spots. */
  centeredOnItinerary: boolean;
  picks: HotelPickPublic[];
};

/** The stay a traveler confirmed, which unlocks the Connect tab. */
export type ConfirmedStay = {
  hotelName: string;
  checkIn: string;
  checkOut: string;
};
