-- Adds email-based identity alongside the existing (now unused) phone columns.
-- Phone columns are kept, nullable, in case phone auth is reconsidered later.

ALTER TABLE users
  ADD COLUMN email_enc text,
  ADD COLUMN email_hmac text UNIQUE,
  ADD COLUMN email_verified_at timestamptz;

ALTER TABLE otp_codes
  ADD COLUMN email_hmac text,
  ALTER COLUMN phone_hmac DROP NOT NULL;

CREATE INDEX otp_codes_email_idx ON otp_codes (email_hmac, created_at DESC);
