-- User constraints belong to trip inputs, not generated legs. They survive every generation.
ALTER TABLE trips ADD COLUMN leg_modes jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(leg_modes) = 'array');
