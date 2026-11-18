-- T12: fields needed to persist a verified itinerary. Existing rows remain valid.
ALTER TABLE itineraries ADD COLUMN details jsonb NOT NULL DEFAULT '{}';

ALTER TABLE stops
  ADD COLUMN kind text NOT NULL DEFAULT 'VISIT' CHECK (kind IN ('VISIT', 'MEAL')),
  ADD COLUMN meal_slot text CHECK (meal_slot IN ('BREAKFAST', 'LUNCH', 'DINNER')),
  ADD CONSTRAINT stops_meal_slot_matches_kind CHECK ((kind = 'MEAL') = (meal_slot IS NOT NULL));

ALTER TABLE legs
  ADD COLUMN from_place_id uuid REFERENCES places(id),
  ADD COLUMN to_place_id uuid REFERENCES places(id),
  ADD COLUMN departure_time timestamptz,
  ADD COLUMN arrival_time timestamptz,
  ADD COLUMN fare numeric CHECK (fare >= 0),
  ADD CONSTRAINT legs_times_ordered CHECK (arrival_time >= departure_time);

CREATE INDEX legs_from_place_id_idx ON legs (from_place_id);
CREATE INDEX legs_to_place_id_idx ON legs (to_place_id);
