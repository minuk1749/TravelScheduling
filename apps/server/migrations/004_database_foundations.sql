-- Existing PK/UNIQUE indexes already cover the other FK leading columns.
CREATE INDEX trips_owner_id_idx ON trips (owner_id);
CREATE INDEX flights_airport_place_id_idx ON flights (airport_place_id);
CREATE INDEX lodgings_trip_id_idx ON lodgings (trip_id);
CREATE INDEX lodgings_place_id_idx ON lodgings (place_id);
CREATE INDEX trip_places_place_id_idx ON trip_places (place_id);
CREATE INDEX stops_trip_place_id_idx ON stops (trip_place_id);
CREATE INDEX stops_place_id_idx ON stops (place_id);

-- Existing rows without historical timestamps are backfilled at migration time.
-- users.created_at already exists and must retain its original value.
ALTER TABLE users ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'trips', 'day_settings', 'flights', 'lodgings', 'trip_places',
    'itineraries', 'day_plans', 'stops', 'legs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now()', table_name);
  END LOOP;
END $$;

ALTER TABLE places ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
-- city_profiles.updated_at is the supplied fare-source date, not a row audit clock.
-- Keep its established meaning and caller-managed value.
CREATE FUNCTION set_row_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := statement_timestamp();
  RETURN NEW;
END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'trips', 'day_settings', 'flights', 'lodgings', 'trip_places',
    'itineraries', 'day_plans', 'stops', 'legs', 'places'
  ] LOOP
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
      FOR EACH ROW EXECUTE FUNCTION set_row_updated_at()', table_name);
  END LOOP;
END $$;

-- Global insertion ordinal: distinguishes even snapshots in the same transaction.
-- Backfilled ordinals are deterministic identifiers, not recovered historical order.
ALTER TABLE itineraries ADD COLUMN generation bigint GENERATED ALWAYS AS IDENTITY;
CREATE UNIQUE INDEX itineraries_trip_generation_idx ON itineraries (trip_id, generation DESC);
