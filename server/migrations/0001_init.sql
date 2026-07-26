-- Sahay initial schema. Hand-written and reviewed: this DDL is the source of truth;
-- server/src/db/schema.ts mirrors it for the query builder.
-- Conventions: uuid PKs (gen_random_uuid), timestamptz everywhere, snake_case.

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pseudonym     text NOT NULL,
  avatar_seed   text NOT NULL,
  locale        text NOT NULL DEFAULT 'en',
  role          text NOT NULL DEFAULT 'user',          -- user | moderator | admin
  status        text NOT NULL DEFAULT 'active',        -- active | restricted | suspended | deleted
  -- phone stored AES-256-GCM encrypted; hmac is a blind index for lookup only
  phone_enc     text,
  phone_hmac    text UNIQUE,
  phone_verified_at timestamptz,
  can_request   boolean NOT NULL DEFAULT true,          -- moderation restriction switches
  can_help      boolean NOT NULL DEFAULT true,
  suspended_until timestamptz,
  risk_flags    text[] NOT NULL DEFAULT '{}',
  pseudonym_changed_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hmac  text NOT NULL,
  code_hash   text NOT NULL,                            -- sha256(code + pepper)
  attempts    int  NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_phone_idx ON otp_codes (phone_hmac, created_at DESC);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,                     -- sha256 of opaque bearer token
  platform    text NOT NULL,                            -- ios | android | web
  device_name text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider   text NOT NULL,                             -- expo | webpush
  token      text NOT NULL,
  disabled   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  UNIQUE (user_id, token)
);

-- ---------------------------------------------------------------- events
CREATE TABLE events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                     -- short shareable id, e.g. MELA-7K2F
  title       text NOT NULL,
  description text NOT NULL DEFAULT '',
  type        text NOT NULL,
  status      text NOT NULL DEFAULT 'scheduled',        -- draft..disabled (§8)
  visibility  text NOT NULL DEFAULT 'unlisted',         -- public | unlisted | invite_only
  public_approved boolean NOT NULL DEFAULT false,       -- moderator approval for public listing
  invite_code text,                                     -- required to join when invite_only
  area_label  text NOT NULL,
  center      geography(Point,4326) NOT NULL,           -- coarse center for discovery/matching
  radius_m    int  NOT NULL DEFAULT 2000,
  max_match_radius_m int NOT NULL DEFAULT 5000,
  offer_response_seconds int NOT NULL DEFAULT 45,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  timezone    text NOT NULL DEFAULT 'Asia/Kolkata',
  safety_info text,
  medical_info text,
  matching_paused boolean NOT NULL DEFAULT false,
  retention_days int NOT NULL DEFAULT 7,                -- post-event data lifetime
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_center_gix ON events USING gist (center);
CREATE INDEX events_status_idx ON events (status, visibility);

CREATE TABLE event_notices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  body       text NOT NULL,
  urgent     boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member',            -- member | event_admin
  muted      boolean NOT NULL DEFAULT false,
  banned     boolean NOT NULL DEFAULT false,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  left_at    timestamptz,
  UNIQUE (user_id, event_id)
);
CREATE INDEX memberships_event_idx ON memberships (event_id) WHERE left_at IS NULL;

-- ---------------------------------------------------------------- catalogue
CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  "group"     text NOT NULL,
  name        jsonb NOT NULL,                           -- {"en": "...", "hi": "..."}
  description jsonb,
  icon        text NOT NULL DEFAULT 'box',
  unit        text NOT NULL,
  alt_units   text[] NOT NULL DEFAULT '{}',
  fractional  boolean NOT NULL DEFAULT false,
  sealed_required boolean NOT NULL DEFAULT false,
  expiry_relevant boolean NOT NULL DEFAULT false,
  restricted  boolean NOT NULL DEFAULT false,
  warning_key text,
  max_request_qty numeric NOT NULL DEFAULT 10,
  max_offer_qty   numeric NOT NULL DEFAULT 100,
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE event_categories (
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  enabled     boolean NOT NULL DEFAULT true,
  max_request_qty numeric,                              -- optional per-event overrides
  max_offer_qty   numeric,
  PRIMARY KEY (event_id, category_id)
);

-- ---------------------------------------------------------------- inventory
-- Accounting model: qty_on_hand is current stock; qty_reserved is held by active
-- matches. Available = on_hand - reserved. DB CHECKs make negative stock and
-- over-reservation impossible even under application bugs.
CREATE TABLE inventory_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES categories(id),
  qty_on_hand  numeric NOT NULL,
  qty_reserved numeric NOT NULL DEFAULT 0,
  unit         text NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}',
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,                             -- auto-expire with the event
  idempotency_key text,
  CHECK (qty_on_hand >= 0),
  CHECK (qty_reserved >= 0),
  CHECK (qty_reserved <= qty_on_hand)
);
CREATE INDEX inventory_event_cat_idx ON inventory_items (event_id, category_id) WHERE active;
CREATE INDEX inventory_user_idx ON inventory_items (user_id, event_id);
CREATE UNIQUE INDEX inventory_idem_idx ON inventory_items (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------- availability & location
CREATE TABLE availability (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  is_on      boolean NOT NULL DEFAULT false,
  until      timestamptz,                               -- NULL = until manually off / event end
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

-- One row per user per event, UPSERTed: by construction there is no movement history.
CREATE TABLE member_locations (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  geog       geography(Point,4326) NOT NULL,            -- coarsened to ~110 m before storage
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,                      -- purged by retention worker
  PRIMARY KEY (user_id, event_id)
);
CREATE INDEX member_locations_gix ON member_locations USING gist (geog);
CREATE INDEX member_locations_exp_idx ON member_locations (expires_at);

-- ---------------------------------------------------------------- requests
CREATE TABLE requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES categories(id),
  qty          numeric NOT NULL,
  qty_fulfilled numeric NOT NULL DEFAULT 0,
  unit         text NOT NULL,
  urgency      text NOT NULL DEFAULT 'standard',
  note         text,
  area_hint    text,
  status       text NOT NULL DEFAULT 'searching',       -- REQUEST_STATUSES (@sahay/shared)
  current_radius_m int NOT NULL DEFAULT 400,
  attempt_count int NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  idempotency_key text NOT NULL,
  CHECK (qty > 0),
  CHECK (qty_fulfilled >= 0 AND qty_fulfilled <= qty),
  UNIQUE (requester_id, idempotency_key)
);
CREATE INDEX requests_event_status_idx ON requests (event_id, status);
CREATE INDEX requests_requester_idx ON requests (requester_id, created_at DESC);
CREATE INDEX requests_expiry_idx ON requests (expires_at) WHERE status IN ('searching','offering');

-- Append-only audit of every state change (server is sole writer).
CREATE TABLE request_transitions (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  from_status text NOT NULL,
  to_status   text NOT NULL,
  actor       text NOT NULL,                            -- system | requester | helper | moderator
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_transitions_req_idx ON request_transitions (request_id);

CREATE TABLE match_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  helper_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  qty         numeric NOT NULL,                          -- min(remaining need, helper available)
  proximity   text NOT NULL DEFAULT 'unknown',
  status      text NOT NULL DEFAULT 'offered',           -- offered|accepted|declined|expired|superseded
  offered_at  timestamptz NOT NULL DEFAULT now(),
  respond_by  timestamptz NOT NULL,
  responded_at timestamptz,
  UNIQUE (request_id, helper_id)                         -- a helper is asked once per request
);
CREATE INDEX match_offers_helper_idx ON match_offers (helper_id, status);
CREATE INDEX match_offers_respond_idx ON match_offers (respond_by) WHERE status = 'offered';

CREATE TABLE matches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  offer_id     uuid NOT NULL REFERENCES match_offers(id),
  event_id     uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helper_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inventory_item_id uuid NOT NULL REFERENCES inventory_items(id),
  qty_reserved numeric NOT NULL,
  proximity    text NOT NULL DEFAULT 'unknown',
  status       text NOT NULL DEFAULT 'active',           -- MATCH_STATUSES (@sahay/shared)
  requester_alias text NOT NULL,                         -- match-specific pseudonyms
  helper_alias    text NOT NULL,
  requester_meeting_state text NOT NULL DEFAULT 'deciding',
  helper_meeting_state    text NOT NULL DEFAULT 'deciding',
  requester_confirmed_qty numeric,                       -- NULL until confirmed
  helper_confirmed_qty    numeric,
  inventory_applied boolean NOT NULL DEFAULT false,      -- reservation released/deducted exactly once
  reliability_applied boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  close_reason text
);
CREATE UNIQUE INDEX matches_one_active_per_request ON matches (request_id) WHERE status = 'active';
CREATE INDEX matches_helper_idx ON matches (helper_id, status);
CREATE INDEX matches_requester_idx ON matches (requester_id, status);

-- ---------------------------------------------------------------- chat
CREATE TABLE conversations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id   uuid NOT NULL UNIQUE REFERENCES matches(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'open',              -- open | readonly | expired
  expires_at timestamptz,                                -- set when match closes
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL DEFAULT 'text',          -- text | quick | system
  body            text NOT NULL,
  client_msg_id   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  delivered_at    timestamptz,
  read_at         timestamptz
);
CREATE INDEX messages_conv_idx ON messages (conversation_id, created_at);
CREATE UNIQUE INDEX messages_idem_idx ON messages (sender_id, client_msg_id) WHERE client_msg_id IS NOT NULL;

-- ---------------------------------------------------------------- reliability
CREATE TABLE reliability_stats (
  user_id   uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  accepted  int NOT NULL DEFAULT 0,
  completed int NOT NULL DEFAULT 0,
  requester_confirmed int NOT NULL DEFAULT 0,
  cancelled_pre_meeting  int NOT NULL DEFAULT 0,
  cancelled_post_meeting int NOT NULL DEFAULT 0,
  timeouts  int NOT NULL DEFAULT 0,
  no_shows  int NOT NULL DEFAULT 0,
  disputes  int NOT NULL DEFAULT 0,
  offers_received_30d  int NOT NULL DEFAULT 0,
  offers_responded_30d int NOT NULL DEFAULT 0,
  label     text NOT NULL DEFAULT 'new_helper',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- trust & safety
CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  match_id    uuid REFERENCES matches(id) ON DELETE SET NULL,
  category    text NOT NULL,
  note        text,
  -- Snapshot of conversation excerpt taken at report time (reporter opt-in);
  -- survives normal chat expiry, deleted by moderation retention instead.
  evidence    jsonb,
  status      text NOT NULL DEFAULT 'open',
  resolution  text,
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX reports_status_idx ON reports (status, created_at);

CREATE TABLE moderation_actions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,
  target_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  target_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  target_match_id uuid REFERENCES matches(id) ON DELETE SET NULL,
  report_id  uuid REFERENCES reports(id) ON DELETE SET NULL,
  reason     text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE appeals (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  moderation_action_id uuid NOT NULL REFERENCES moderation_actions(id) ON DELETE CASCADE,
  body       text NOT NULL,
  status     text NOT NULL DEFAULT 'open',               -- open | upheld | overturned
  resolved_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- Append-only admin audit trail. No UPDATE/DELETE grants in production.
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id   uuid,
  action     text NOT NULL,
  target     text,                                       -- "user:<id>", "event:<id>", ...
  reason     text,
  meta       jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- notifications
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  title_key  text NOT NULL,
  body_key   text NOT NULL,
  params     jsonb NOT NULL DEFAULT '{}',
  deep_link  text,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE notification_prefs (
  user_id   uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  detailed_previews boolean NOT NULL DEFAULT false,
  per_type  jsonb NOT NULL DEFAULT '{}'                  -- {"new_message": false, ...}
);

-- ---------------------------------------------------------------- privacy & ops
CREATE TABLE consent_records (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,                              -- safety_ack | location | notifications
  granted    boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE data_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL,                              -- export | delete
  status     text NOT NULL DEFAULT 'pending',            -- pending | ready | done | failed
  payload    jsonb,                                      -- export bundle (small) or null
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  description text NOT NULL DEFAULT ''
);

INSERT INTO feature_flags (key, enabled, description) VALUES
  ('voice_calls', false, 'In-app voice calling between matched participants (designed, not shipped)'),
  ('public_event_creation_open', false, 'Skip moderation approval for public event listing'),
  ('signup_open', true, 'Allow new account registration (emergency shutdown lever)');
