-- App session tokens (T18). Only the SHA-256 hex of the opaque token is stored; withdrawal cascades.
CREATE TABLE mobile_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mobile_sessions_user_id_idx ON mobile_sessions (user_id);
CREATE TRIGGER set_updated_at BEFORE UPDATE ON mobile_sessions
  FOR EACH ROW EXECUTE FUNCTION set_row_updated_at();
