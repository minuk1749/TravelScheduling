-- T2's minimal ownership model; later trip data must reference trips with ON DELETE CASCADE.
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  google_id text NOT NULL UNIQUE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
