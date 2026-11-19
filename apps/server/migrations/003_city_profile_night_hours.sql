-- The surcharge is a fractional increase applied during [start, end) local time.
ALTER TABLE city_profiles
  ADD COLUMN night_start time,
  ADD COLUMN night_end time;
