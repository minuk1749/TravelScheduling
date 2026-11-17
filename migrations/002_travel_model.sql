-- Existing T2 trips may contain only an owner; keep those rows during upgrade.
ALTER TABLE trips
  ADD COLUMN city_code text,
  ADD COLUMN time_zone text,
  ADD COLUMN start_date date,
  ADD COLUMN end_date date,
  ADD COLUMN default_departure_time time,
  ADD COLUMN default_return_time time,
  ADD COLUMN default_meal_slots jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN meal_windows jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN luggage_option text,
  ADD COLUMN arrival_buffer_minutes integer,
  ADD COLUMN departure_buffer_minutes integer,
  ADD COLUMN taxi_policy text,
  ADD COLUMN share_token text UNIQUE,
  ADD CONSTRAINT trip_dates_ordered CHECK (end_date >= start_date),
  ADD CONSTRAINT trip_taxi_policy CHECK (taxi_policy IN ('NEVER', 'WHEN_NEEDED', 'PREFER')),
  ADD CONSTRAINT trip_buffers_nonnegative CHECK (arrival_buffer_minutes >= 0 AND departure_buffer_minutes >= 0);

CREATE TABLE city_profiles (
  city_code text PRIMARY KEY, country text NOT NULL, currency text NOT NULL,
  transit_coverage text, transit_hours text,
  taxi_base_fare numeric, taxi_fare_per_km numeric, taxi_fare_per_minute numeric,
  night_surcharge numeric, call_buffer_minutes integer, efficiency_threshold numeric,
  ride_hailing_apps jsonb NOT NULL DEFAULT '[]', source text NOT NULL, updated_at timestamptz NOT NULL
);
CREATE TABLE places (
  id uuid PRIMARY KEY, google_place_id text NOT NULL UNIQUE, name text,
  latitude double precision, longitude double precision, opening_hours jsonb,
  types jsonb, cache_expires_at timestamptz
);
CREATE TABLE day_settings (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE, date date NOT NULL,
  departure_time time, return_time time, meal_slots jsonb,
  PRIMARY KEY (trip_id, date)
);
CREATE TABLE flights (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('ARRIVAL', 'DEPARTURE')),
  airport_place_id uuid NOT NULL REFERENCES places(id), local_datetime timestamp NOT NULL,
  UNIQUE (trip_id, direction)
);
CREATE TABLE lodgings (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  place_id uuid NOT NULL REFERENCES places(id), check_in date NOT NULL, check_out date NOT NULL,
  CHECK (check_out > check_in)
);
CREATE TABLE trip_places (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  place_id uuid NOT NULL REFERENCES places(id), kind text NOT NULL CHECK (kind IN ('RESTAURANT', 'ATTRACTION')),
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  priority text NOT NULL CHECK (priority IN ('REQUIRED', 'WISHLIST')),
  fixed_date date, fixed_time time, fixed_order integer CHECK (fixed_order >= 0),
  UNIQUE (trip_id, place_id)
);
CREATE TABLE itineraries (
  id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  input_hash text NOT NULL, status text NOT NULL CHECK (status IN ('OK', 'OVER_CAPACITY', 'CONFLICT')),
  unplaced jsonb NOT NULL DEFAULT '[]', efficiency_summary jsonb
);
CREATE TABLE day_plans (
  id uuid PRIMARY KEY, itinerary_id uuid NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  date date NOT NULL, UNIQUE (itinerary_id, date)
);
CREATE TABLE stops (
  id uuid PRIMARY KEY, day_plan_id uuid NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  trip_place_id uuid REFERENCES trip_places(id) ON DELETE SET NULL,
  place_id uuid REFERENCES places(id), position integer NOT NULL CHECK (position >= 0),
  arrival_time timestamptz, departure_time timestamptz, UNIQUE (day_plan_id, position)
);
CREATE TABLE legs (
  id uuid PRIMARY KEY, day_plan_id uuid NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  selected_mode text NOT NULL CHECK (selected_mode IN ('TRANSIT', 'WALK', 'TAXI')),
  user_fixed boolean NOT NULL DEFAULT false, alternatives jsonb NOT NULL DEFAULT '{}',
  UNIQUE (day_plan_id, position)
);
