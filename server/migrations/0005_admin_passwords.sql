-- Username + password login for admin/moderator accounts (ADR-0013).
-- Volunteers continue to authenticate with email OTP on mobile, so both
-- columns are nullable: only staff accounts carry credentials.

ALTER TABLE users
  ADD COLUMN username text UNIQUE,
  ADD COLUMN password_hash text,
  ADD COLUMN password_set_at timestamptz;

-- Credentials are only meaningful together; never one without the other.
ALTER TABLE users
  ADD CONSTRAINT users_credentials_paired
  CHECK ((username IS NULL) = (password_hash IS NULL));
