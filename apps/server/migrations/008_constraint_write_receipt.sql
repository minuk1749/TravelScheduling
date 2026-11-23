-- The input hash identifies scheduling inputs, while this generation distinguishes equal-valued writes.
ALTER TABLE trips
  ADD COLUMN constraint_write_version uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN constraint_operation_id uuid,
  ADD COLUMN constraint_operation_revision text,
  ADD CONSTRAINT constraint_receipt_complete CHECK (
    (constraint_operation_id IS NULL) = (constraint_operation_revision IS NULL)
  );

CREATE FUNCTION advance_constraint_write_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.constraint_write_version := gen_random_uuid();
  NEW.constraint_operation_id := NULL;
  NEW.constraint_operation_revision := NULL;
  RETURN NEW;
END $$;

-- The constraint writer always updates leg_modes; the living-settings writer updates the activity
-- fields even for a day-only edit. Old servers perform the same updates. Unrelated sharing and
-- generation keep the current receipt. An ownership change invalidates the previous owner's receipt.
CREATE TRIGGER advance_constraint_write_version
  BEFORE UPDATE OF leg_modes, default_departure_time, default_return_time, default_meal_slots, meal_windows,
    taxi_policy, luggage_option, arrival_buffer_minutes, departure_buffer_minutes, city_code, time_zone,
    start_date, end_date, owner_id ON trips
  FOR EACH ROW EXECUTE FUNCTION advance_constraint_write_version();
