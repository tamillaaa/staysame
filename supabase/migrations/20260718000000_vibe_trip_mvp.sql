-- Vibe Trip MVP schema.
--
-- Four tables: a generated itinerary (trips), the Stay22 results attached to it
-- (hotel_picks), the QR code a traveler carries for a booked stay
-- (traveler_codes), and the connections between two such codes
-- (traveler_matches).

create extension if not exists "pgcrypto";

-- trips: one row per generated itinerary
create table trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  destination text not null,
  start_date date,
  end_date date,
  budget_tier text check (budget_tier in ('shoestring', 'mid', 'splurge')),
  source_image_url text, -- nullable, set if trip came from image-to-destination
  itinerary jsonb not null, -- array of {day, time_block, activity, is_side_quest, description}
  created_at timestamptz default now()
);

-- hotel_picks: Stay22 results attached to a trip
create table hotel_picks (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  provider text, -- 'booking' | 'expedia' | 'hotels' | 'vrbo'
  name text,
  price_per_night numeric,
  allez_deeplink text,
  raw jsonb
);

-- traveler_codes: one barcode per user per trip/hotel stay
create table traveler_codes (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid references trips(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  hotel_name text not null,
  check_in date not null,
  check_out date not null,
  interests text[], -- tags pulled from the trip's activities/side quests
  code text unique not null, -- the string encoded in the QR/barcode
  created_at timestamptz default now(),
  -- A stay can't end before it starts; the matcher's overlap test assumes this.
  constraint traveler_codes_dates_ordered check (check_out >= check_in)
);

-- traveler_matches: computed/opted-in connections between two codes
create table traveler_matches (
  id uuid primary key default gen_random_uuid(),
  code_a uuid references traveler_codes(id) on delete cascade,
  code_b uuid references traveler_codes(id) on delete cascade,
  shared_interests text[],
  status text default 'suggested' check (status in ('suggested', 'connected', 'declined')),
  created_at timestamptz default now(),
  -- Matching is symmetric, so store each pair once in a canonical order.
  constraint traveler_matches_ordered check (code_a < code_b),
  constraint traveler_matches_unique_pair unique (code_a, code_b)
);

-- The matcher looks up other codes at the same hotel over an overlapping range.
create index traveler_codes_hotel_dates_idx on traveler_codes (hotel_name, check_in, check_out);
create index traveler_codes_user_idx on traveler_codes (user_id);
create index trips_user_created_idx on trips (user_id, created_at desc);
create index hotel_picks_trip_idx on hotel_picks (trip_id);
create index traveler_matches_code_a_idx on traveler_matches (code_a);
create index traveler_matches_code_b_idx on traveler_matches (code_b);

-- Row-level security. The itinerary generator is usable logged-out, so trips
-- with a null user_id are readable by anyone (they belong to no one yet);
-- everything owned is scoped to its owner.
alter table trips enable row level security;
alter table hotel_picks enable row level security;
alter table traveler_codes enable row level security;
alter table traveler_matches enable row level security;

create policy "trips readable by owner or anonymous" on trips
  for select using (user_id is null or auth.uid() = user_id);

create policy "trips insertable by owner or anonymous" on trips
  for insert with check (user_id is null or auth.uid() = user_id);

create policy "hotel_picks follow their trip" on hotel_picks
  for select using (
    exists (
      select 1 from trips
      where trips.id = hotel_picks.trip_id
        and (trips.user_id is null or trips.user_id = auth.uid())
    )
  );

create policy "traveler_codes readable by owner" on traveler_codes
  for select using (auth.uid() = user_id);

create policy "traveler_codes insertable by owner" on traveler_codes
  for insert with check (auth.uid() = user_id);

-- A match is visible to both sides.
create policy "traveler_matches readable by either side" on traveler_matches
  for select using (
    exists (
      select 1 from traveler_codes
      where traveler_codes.id in (traveler_matches.code_a, traveler_matches.code_b)
        and traveler_codes.user_id = auth.uid()
    )
  );
