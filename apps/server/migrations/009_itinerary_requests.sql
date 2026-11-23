-- A keyed POST and its replayable owner response commit with the itinerary and its day rows.
ALTER TABLE itineraries
  ADD COLUMN request_id uuid,
  ADD COLUMN request_result jsonb,
  ADD CONSTRAINT itineraries_request_result_pair CHECK ((request_id IS NULL) = (request_result IS NULL));

CREATE UNIQUE INDEX itineraries_trip_request_idx ON itineraries (trip_id, request_id)
  WHERE request_id IS NOT NULL;
